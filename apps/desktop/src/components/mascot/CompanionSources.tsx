import { useEffect, useState } from 'react';
import { taskNotices } from '../../lib/companion-tasks';
import type { TaskRun } from '../../lib/task-runtime';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { useProjectStore } from '../../stores/projectStore';
import { navigateWorkspace, openSettings } from '../layout/navigation';
import { useCompanionNotices } from './useCompanionNotices';

export function openCompanionTask(run: TaskRun) {
  useProjectStore.getState().selectProject(run.projectId);
  useExecutionStore.getState().select(run.id);
  navigateWorkspace('kanban');
  requestAnimationFrame(() => document.getElementById('workspace-content')?.focus());
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
            onOpen: () => navigateWorkspace('kanban'),
          },
        ]
      : [],
  );
  useCompanionNotices(
    'referrals',
    referralAccount
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
