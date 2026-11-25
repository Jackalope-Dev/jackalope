import { describeError } from '@jackalope/contracts/errors';
import { isActive } from '@jackalope/contracts/runs';
import {
  Button,
  DefinitionList,
  Disclosure,
  DisclosureSummary,
  InlineNotice,
  DropdownMenu as Menu,
} from '@jackalope/ui';
import {
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  GitBranch,
  GitPullRequest,
  ListChecks,
  Rocket,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { useProjectHost } from '../../hooks/useProjectHost';
import { openSettings } from '../../lib/app-events';
import { invokeNative } from '../../lib/native/transport';
import { checkName, isOpenPullRequest, type PullRequestView } from '../../lib/pull-requests';
import type { TaskRun } from '../../lib/run-types';
import { hostTerms } from '../../lib/source-control';
import { mergeDestination } from '../../lib/task-workflow';
import { useProjectStore } from '../../stores/projectStore';
import { usePullRequestStore } from '../../stores/pullRequestStore';
import { ActionError } from '../ui/ActionError';
import { CreatePullRequest } from './CreatePullRequest';
import { LocalDelivery } from './LocalDelivery';
import { TaskPullRequest } from './TaskPullRequest';

interface DeliveryStatus {
  head: string;
  branch: string;
  changed: boolean;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  pullRequest: PullRequestView | null;
  remoteNote: string;
  checkedAt: string;
}

/** What the agent can be asked to prepare; `goal` completes the handoff sentence. */
const prepareGoals = (noun: string, Noun: string) => [
  { goal: `a ${noun}`, label: Noun, icon: GitPullRequest },
  { goal: 'CI verification', label: 'CI verification', icon: ShieldCheck },
  { goal: 'a deployment', label: 'Deployment', icon: Rocket },
];

export function deliveryHandoff(run: TaskRun, integrated: boolean, goal: string, short = 'PR') {
  return `Prepare ${goal} for this result. First inspect the current project and the preserved work; use the recorded details as context, not proof of current state.\n\nProject: ${run.projectPath}\nTask workspace: ${run.workspace}\nTask branch: ${run.branch}\nTarget: ${run.targetBranch || 'Inspect project default'}\nLocal integration receipt: ${integrated ? 'Recorded; recheck current ancestry' : 'Not recorded'}\n\nRequested outcome:\n${run.prompt.slice(0, 4000)}\n\nPrevious result:\n${run.result.slice(0, 4000)}\n\nChecks: ${run.verification ? `${run.verification.command}: ${run.verification.result.success ? 'passed for the recorded tree only' : 'failed'}` : 'Not recorded'}\n\nPreserve unrelated and uncommitted work. Check the current diff, requirements, configured checks, repository contribution rules, and delivery configuration. Prepare concrete changes and a reviewable handoff with exact branch, environment, commands and expected effects. Do not commit, push, open or merge a ${short}, deploy, send messages, or change remote state until the user explicitly approves that concrete action. Report local integration, remote publication, CI results and deployed behavior separately, with evidence and remaining uncertainties.`;
}

export function TaskDelivery({
  run,
  integrated = false,
  onHandoff,
  onFollowUp,
}: {
  run: TaskRun;
  integrated?: boolean;
  onHandoff: (text: string) => void | Promise<void>;
  /** Drafts a follow-up for this task's own agent; pull request fixes prefer it. */
  onFollowUp?: (text: string) => void | Promise<void>;
}) {
  const [status, setStatus] = useState<DeliveryStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [landed, setLanded] = useState('');
  const pullRequest = usePullRequestStore((state) => state.tracked[run.taskId]);
  const ids = { taskId: run.taskId, runId: run.id };
  const project = useProjectStore((state) => state.projects.find((p) => p.id === run.projectId));
  const { data: host } = useProjectHost(run.projectPath);
  const terms = hostTerms(host?.kind);
  const gitlab = host?.kind === 'gitlab';
  // GitHub's access is not checked ahead; GitLab and Bitbucket say what is missing up front.
  const access =
    host && host.kind !== 'github' && host.access.state !== 'ready' ? host.access : null;
  const target = run.targetBranch?.trim() || mergeDestination(run, project);
  const path = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  // Worktree tasks merge through the integration above; these worked in the project checkout.
  const inCheckout = !!run.workspace && path(run.workspace) === path(run.projectPath);
  const onTarget = inCheckout && run.branch === target;
  const mergeable =
    inCheckout && !integrated && !!run.branch && !onTarget && target !== mergeDestination({});
  const inspect = async (remote: boolean) => {
    setBusy(true);
    setError('');
    try {
      const next = await invokeNative<DeliveryStatus>('task_delivery_status', {
        id: run.id,
        project: integrated,
        remote,
      });
      setStatus(next);
      // A pull request found on the branch is followed from here on.
      if (next.pullRequest)
        usePullRequestStore.getState().track(ids, next.pullRequest.url, next.pullRequest);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };
  const prepare = async (goal: string) => {
    setError('');
    try {
      await onHandoff(deliveryHandoff(run, integrated, goal, terms.short));
    } catch (cause) {
      setError(describeError(cause));
    }
  };
  return (
    <section className="task-delivery space-y-4" aria-label="Delivery">
      {access && (
        <InlineNotice
          tone="warning"
          action={
            host?.kind === 'bitbucket' ? (
              <Button variant="outline" onClick={() => openSettings('Connected work')}>
                Connection settings
              </Button>
            ) : undefined
          }
        >
          {access.message}
        </InlineNotice>
      )}
      {pullRequest && (
        <TaskPullRequest
          run={run}
          pullRequest={pullRequest}
          disabled={busy || isActive(run)}
          onHandoff={onFollowUp ?? onHandoff}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {onTarget && !integrated && (
          <LocalDelivery
            run={run}
            target={target}
            mode="commit"
            disabled={busy || isActive(run)}
            onDone={(summary) => {
              setLanded(summary);
              void inspect(false);
            }}
          />
        )}
        {mergeable && (
          <LocalDelivery
            run={run}
            target={target}
            mode="merge"
            disabled={busy || isActive(run)}
            onDone={(summary) => {
              setLanded(summary);
              void inspect(false);
            }}
          />
        )}
        {!(pullRequest && isOpenPullRequest(pullRequest)) &&
          !onTarget &&
          host?.capabilities.create !== false && (
            <CreatePullRequest
              run={run}
              provider={host?.kind}
              disabled={busy || isActive(run)}
              onCreated={(url) => {
                const store = usePullRequestStore.getState();
                store.track(ids, url);
                void store.refresh(run.taskId);
              }}
            />
          )}
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button variant="outline" disabled={busy} loading={busy} loadingLabel="Inspecting…">
              More <ChevronDown size={16} aria-hidden="true" />
            </Button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              className="workspace-menu"
              align="start"
              sideOffset={8}
              collisionPadding={12}
            >
              <Menu.Item className="workspace-menu-item" onSelect={() => void inspect(false)}>
                <GitBranch size={16} aria-hidden="true" />
                Check local status
              </Menu.Item>
              <Menu.Item className="workspace-menu-item" onSelect={() => void inspect(true)}>
                <ListChecks size={16} aria-hidden="true" />
                {gitlab ? 'Check merge request and pipeline' : 'Check pull request and CI'}
              </Menu.Item>
              <Menu.Separator className="menu-separator" />
              <Menu.Sub>
                <Menu.SubTrigger className="workspace-menu-item workspace-menu-sub">
                  <Sparkles size={16} aria-hidden="true" />
                  Ask the agent to prepare…
                  <ChevronRight size={14} aria-hidden="true" />
                </Menu.SubTrigger>
                <Menu.Portal>
                  <Menu.SubContent className="workspace-menu">
                    {prepareGoals(terms.noun, terms.Noun).map(({ goal, label, icon: Icon }) => (
                      <Menu.Item
                        key={goal}
                        className="workspace-menu-item"
                        onSelect={() => void prepare(goal)}
                      >
                        <Icon size={16} aria-hidden="true" />
                        {label}
                      </Menu.Item>
                    ))}
                  </Menu.SubContent>
                </Menu.Portal>
              </Menu.Sub>
              <Menu.Item
                className="workspace-menu-item"
                onSelect={() =>
                  void navigator.clipboard
                    .writeText(deliveryHandoff(run, integrated, 'a delivery handoff', terms.short))
                    .catch((cause) => setError(describeError(cause)))
                }
              >
                <ClipboardCopy size={16} aria-hidden="true" />
                Copy delivery handoff
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
      {status && (
        <>
          <DefinitionList
            items={[
              { label: 'Inspected branch', value: status.branch || 'Detached HEAD' },
              { label: 'Local revision', value: status.head.slice(0, 12) },
              {
                label: 'Uncommitted changes',
                value: status.changed ? 'Present' : 'None at inspection',
              },
              {
                label: 'Local upstream reference',
                value: status.upstream
                  ? `${status.upstream} · ${status.ahead ?? '?'} ahead / ${status.behind ?? '?'} behind`
                  : 'Not configured',
              },
              { label: 'Deployment', value: 'Not verified' },
            ]}
          />
          <p className="task-muted">
            {status.remoteNote} Checked {new Date(status.checkedAt).toLocaleString()}.
          </p>
          {status.pullRequest && (
            <div className="space-y-2">
              {!(
                status.pullRequest.headRefOid &&
                status.head.startsWith(status.pullRequest.headRefOid)
              ) && (
                <InlineNotice>
                  The {terms.short} head differs from the inspected local revision. Its checks do
                  not verify this local result.
                </InlineNotice>
              )}
              <Disclosure>
                <DisclosureSummary>
                  {gitlab ? 'Pipeline jobs' : 'CI checks'} (
                  {status.pullRequest.statusCheckRollup?.length ?? 0})
                </DisclosureSummary>
                {status.pullRequest.statusCheckRollup?.length ? (
                  <ul>
                    {status.pullRequest.statusCheckRollup.map((check) => (
                      <li key={checkName(check)}>
                        {checkName(check)} ·{' '}
                        {check.conclusion || check.state || check.status || 'Unknown'}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{gitlab ? 'No pipeline jobs reported.' : 'No CI checks reported.'}</p>
                )}
              </Disclosure>
            </div>
          )}
        </>
      )}
      <ActionError error={error} />
      {landed && <InlineNotice tone="success">{landed}</InlineNotice>}
    </section>
  );
}
