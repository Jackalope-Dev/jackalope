import { useEffect, useMemo, useState } from 'react';
import { taskNotices } from '../../lib/companion-tasks';
import { type PlanSummary, planCommands } from '../../lib/plan-mode';
import type { TaskRun } from '../../lib/task-runtime';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useBotStore } from '../../stores/botStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { usePlanStore } from '../../stores/planStore';
import { useProjectStore } from '../../stores/projectStore';
import { useReferralStore } from '../../stores/referralStore';
import { navigateWorkspace, openSettings } from '../layout/navigation';
import { useCompanionNotices } from './useCompanionNotices';

export function openCompanionTask(run: TaskRun) {
  useProjectStore.getState().selectProject(run.projectId);
  useExecutionStore.getState().select(run.id);
  navigateWorkspace('kanban');
  requestAnimationFrame(() => document.getElementById('workspace-content')?.focus());
}

/** Opens a plan on the Plans page, in its own project. */
async function openPlan(id: string) {
  try {
    const view = await planCommands.get(id);
    useProjectStore.getState().selectProject(view.projectId);
  } catch {
    // The Plans page reports a plan it cannot read.
  }
  usePlanStore.getState().select(id);
  navigateWorkspace('plans');
}

export function CompanionSources() {
  const notificationError = useNotificationStore((state) => state.error || state.status?.error);
  const runs = useExecutionStore((state) => state.runs);
  const error = useExecutionStore((state) => state.error);
  const [referralAccount, setReferralAccount] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let alive = true;
    void nativeTask<{ state: string; email: string | null }>('app_account_status')
      .then((account) => {
        if (alive && account.state === 'connected' && account.email)
          setReferralAccount(account.email);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let alive = true;
    let opening = false;
    let unlisten: (() => void) | undefined;
    const open = async () => {
      if (opening || !alive) return;
      opening = true;
      try {
        while (alive) {
          const id = await nativeTask<string | null>('notification_take_open');
          if (!id || !alive) return;
          // Bot cards and suggestions open their bot rather than a task.
          if (id.startsWith('bot:')) {
            useBotStore.getState().select(id.slice(4));
            navigateWorkspace('bots');
            continue;
          }
          // A deviation waiting on a decision opens its plan.
          if (id.startsWith('plan:')) {
            await openPlan(id.slice(5));
            continue;
          }
          await useExecutionStore.getState().refresh();
          const run = useExecutionStore.getState().runs.find((run) => run.id === id);
          if (alive && run) openCompanionTask(run);
          else if (alive) navigateWorkspace('kanban');
        }
      } catch (error) {
        if (alive) useNotificationStore.setState({ error: String(error) });
      } finally {
        opening = false;
      }
    };
    void import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        const stop = await listen('jackalope-notification-open', () => void open());
        if (alive) {
          unlisten = stop;
          void open();
        } else stop();
      })
      .catch((error) => {
        if (alive) useNotificationStore.setState({ error: String(error) });
      });
    window.addEventListener('focus', open);
    return () => {
      alive = false;
      unlisten?.();
      window.removeEventListener('focus', open);
    };
  }, []);
  useCompanionNotices(
    'os-notifications',
    notificationError
      ? [
          {
            id: 'os-notification-error',
            kind: 'attention',
            title: 'OS notifications need attention',
            detail: notificationError,
          },
        ]
      : [],
  );
  useCompanionNotices('tasks', taskNotices(runs, openCompanionTask));
  // Deviations are recorded as attempts report, so re-read plans when runs change.
  const runSignal = useMemo(() => runs.map((run) => `${run.id}:${run.status}`).join(), [runs]);
  const [waitingPlans, setWaitingPlans] = useState<PlanSummary[]>([]);
  useEffect(() => {
    if (!isTauriEnvironment() || !runSignal) return;
    let alive = true;
    void planCommands
      .list()
      .then((result) => alive && setWaitingPlans(result.plans.filter((plan) => plan.needsYou)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [runSignal]);
  const planNotices = useMemo(
    () =>
      waitingPlans.map((plan) => ({
        id: `plan:${plan.id}:needs-you`,
        kind: 'attention' as const,
        title: 'A plan needs your decision',
        detail: `${plan.title}
The work departed from the approved plan.`,
        actionLabel: 'Open plan',
        onOpen: () => void openPlan(plan.id),
      })),
    [waitingPlans],
  );
  useCompanionNotices('plans', planNotices);
  useCompanionNotices(
    'execution',
    error
      ? [
          {
            id: `execution:${error}`,
            title: 'Could not refresh task activity',
            detail: error,
            kind: 'attention',
            actionLabel: 'Open tasks',
            onOpen: () => navigateWorkspace('live-sessions'),
          },
        ]
      : [],
  );
  // Passes only matter once the service confirms signup is still invitation-based.
  const passes = useReferralStore((state) => !!state.referrals && !state.referrals.openSignup);
  useCompanionNotices(
    'referrals',
    referralAccount && passes
      ? [
          {
            id: `referrals:${referralAccount}`,
            title: 'Your Instant Access Passes are ready',
            detail: 'Bring five people straight into Jackalope early access.',
            kind: 'success',
            actionLabel: 'See my passes',
            onOpen: () => openSettings('Invitations'),
          },
        ]
      : [],
  );
  return null;
}
