import { describeError } from '@jackalope/contracts/errors';
import {
  Badge,
  Button,
  ConfirmDialog,
  ExternalLinkIcon,
  FormField,
  InlineNotice,
  DropdownMenu as Menu,
  Select,
  SelectItem,
} from '@jackalope/ui';
import {
  CircleX,
  GitMerge,
  GitPullRequest,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { openExternalUrl } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import { workingChanges } from '../../lib/project-git';
import {
  checksHandoff,
  conflictHandoff,
  isOpenPullRequest,
  pullRequestPhaseView,
  reviewHandoff,
  type TrackedPullRequest,
} from '../../lib/pull-requests';
import type { TaskRun } from '../../lib/run-types';
import { usePullRequestStore } from '../../stores/pullRequestStore';
import { ActionError } from '../ui/ActionError';
import { DraftedMessageFields, useDraftedMessage } from './DraftedMessage';

const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`;

function checksSummary(pr: TrackedPullRequest) {
  if (!pr.checkedAt) return 'Reading from GitHub…';
  if (!pr.checks) return 'No checks reported';
  if (pr.failing.length) return `${pr.failing.length} of ${count(pr.checks, 'check')} failed`;
  if (pr.pending) return `${pr.pending} of ${count(pr.checks, 'check')} running`;
  return `${count(pr.checks, 'check')} passed`;
}

/**
 * The pull request a task opened: where it stands on GitHub and the next step. Fixes go
 * back to the task's own agent as an editable follow-up; pushing and merging each ask first.
 */
export function TaskPullRequest({
  run,
  pullRequest: pr,
  disabled,
  onHandoff,
}: {
  run: TaskRun;
  pullRequest: TrackedPullRequest;
  disabled?: boolean;
  onHandoff: (text: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const view = pullRequestPhaseView(pr.phase);
  const open = isOpenPullRequest(pr);
  const refresh = () => usePullRequestStore.getState().refresh(run.taskId);
  const act = async (work: () => Promise<void> | void) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };
  const fix =
    pr.phase === 'failing'
      ? {
          label: 'Ask the agent to fix',
          draft: async () => checksHandoff(run, pr.url, pr.failing),
        }
      : pr.phase === 'changes'
        ? {
            label: 'Ask the agent to address it',
            draft: async () => {
              // The threads are a convenience; the agent can read them itself without them.
              const threads = pr.number
                ? await invokeNative<{ text: string }>('project_github_context', {
                    projectPath: run.projectPath,
                    kind: 'review',
                    number: String(pr.number),
                  })
                    .then((context) => context.text)
                    .catch(() => '')
                : '';
              return reviewHandoff(run, pr.url, threads);
            },
          }
        : pr.phase === 'conflict'
          ? {
              label: 'Ask the agent to resolve',
              draft: async () => conflictHandoff(run, pr.url),
            }
          : null;
  return (
    <section className="task-pull-request" aria-label="Pull request">
      <div className="task-pull-request-summary">
        <GitPullRequest size={16} aria-hidden="true" />
        <span className="task-pull-request-title">
          Pull request{pr.number ? ` #${pr.number}` : ''}
        </span>
        <Badge
          variant={
            view.tone === 'warning' ? 'warning' : view.tone === 'success' ? 'success' : 'outline'
          }
        >
          {view.label}
        </Badge>
        <span className="task-muted">
          {checksSummary(pr)}
          {pr.checkedAt &&
            ` · Checked ${new Date(pr.checkedAt).toLocaleTimeString([], { timeStyle: 'short' })}`}
        </span>
      </div>
      {pr.failing.length > 0 && <p className="task-muted">Failed: {pr.failing.join(', ')}</p>}
      <div className="flex flex-wrap gap-2">
        {fix && (
          <Button
            variant="primary"
            disabled={disabled || busy}
            loading={busy}
            loadingLabel="Drafting…"
            onClick={() => void act(async () => onHandoff(await fix.draft()))}
          >
            <Sparkles size={16} aria-hidden="true" /> {fix.label}
          </Button>
        )}
        {pr.phase === 'ready' && (
          <MergePullRequest run={run} url={pr.url} disabled={disabled || busy} onMerged={refresh} />
        )}
        {open && <PushUpdate run={run} disabled={disabled || busy} onPushed={refresh} />}
        <Button
          variant="outline"
          onClick={() => void act(() => openExternalUrl(pr.url))}
          aria-label="Open pull request on GitHub"
        >
          Open on GitHub <ExternalLinkIcon />
        </Button>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button variant="ghost" aria-label="Pull request options">
              <MoreHorizontal size={18} />
            </Button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className="workspace-menu" align="end" sideOffset={8}>
              <Menu.Item className="workspace-menu-item" onSelect={() => void act(refresh)}>
                <RefreshCw size={16} aria-hidden="true" />
                Check GitHub now
              </Menu.Item>
              <Menu.Item
                className="workspace-menu-item"
                onSelect={() => usePullRequestStore.getState().untrack(run.taskId)}
              >
                <CircleX size={16} aria-hidden="true" />
                Stop following this pull request
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
      {pr.error && (
        <InlineNotice tone="warning">
          GitHub could not be read, so this may be out of date. {pr.error}
        </InlineNotice>
      )}
      <ActionError error={error} />
    </section>
  );
}

const METHODS = [
  { id: 'merge', label: 'Merge commit' },
  { id: 'squash', label: 'Squash and merge' },
  { id: 'rebase', label: 'Rebase and merge' },
] as const;

function MergePullRequest({
  run,
  url,
  disabled,
  onMerged,
}: {
  run: TaskRun;
  url: string;
  disabled?: boolean;
  onMerged: () => Promise<void>;
}) {
  const [method, setMethod] = useState<(typeof METHODS)[number]['id']>('merge');
  return (
    <ConfirmDialog
      trigger={
        <Button variant="primary" disabled={disabled}>
          <GitMerge size={16} aria-hidden="true" /> Merge pull request
        </Button>
      }
      title="Merge pull request"
      description={`Merges ${run.branch || 'the task branch'} into ${run.targetBranch?.trim() || 'its target'} on GitHub with your GitHub CLI. Anything that deploys from that branch will run.`}
      label="Merge pull request"
      busyLabel="Merging…"
      variant="primary"
      onConfirm={async () => {
        try {
          await invokeNative('task_pull_request_merge', { id: run.id, url, method });
        } catch (cause) {
          throw new Error(describeError(cause));
        }
        await onMerged();
      }}
    >
      {({ busy }) => (
        <FormField label="Merge method">
          <Select
            value={method}
            disabled={busy}
            onValueChange={(value) => setMethod(value as typeof method)}
          >
            {METHODS.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.label}
              </SelectItem>
            ))}
          </Select>
        </FormField>
      )}
    </ConfirmDialog>
  );
}

/** Commits what the agent changed since the pull request opened and pushes the branch. */
function PushUpdate({
  run,
  disabled,
  onPushed,
}: {
  run: TaskRun;
  disabled?: boolean;
  onPushed: () => Promise<void>;
}) {
  const [uncommitted, setUncommitted] = useState<string[] | null>(null);
  const paths = useRef<string[]>([]);
  const checkout = { repoPath: run.projectPath, worktreePath: run.workspace };
  const message = useDraftedMessage(() =>
    invokeNative<{ title: string; body: string }>('git_generate_commit_message', {
      ...checkout,
      paths: paths.current,
    }),
  );
  const pending = uncommitted?.length ?? 0;
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" disabled={disabled}>
          <Upload size={16} aria-hidden="true" /> Push update
        </Button>
      }
      title="Push update"
      description={
        uncommitted === null
          ? 'Reading the task’s changes…'
          : pending
            ? `Commits ${count(pending, 'changed file')} on ${run.branch} with your commit settings and pushes the branch, which updates the pull request and reruns its checks.`
            : `Pushes ${run.branch}, which updates the pull request and reruns its checks.`
      }
      label={pending ? 'Commit and push' : 'Push'}
      busyLabel="Pushing…"
      variant="primary"
      disabled={uncommitted === null || (!!pending && !message.title.trim())}
      onOpenChange={(open) => {
        if (!open) return;
        message.reset();
        setUncommitted(null);
        void workingChanges(checkout)
          .then((changes) => {
            paths.current = changes.files.map((file) => file.path);
            setUncommitted(paths.current);
            if (paths.current.length) message.write(false);
          })
          .catch(() => setUncommitted([]));
      }}
      onConfirm={async () => {
        try {
          if (pending)
            await invokeNative('git_commit_changes', {
              ...checkout,
              paths: uncommitted,
              title: message.title.trim(),
              body: message.body,
              agents: run.agent ? [run.agent] : [],
            });
          await invokeNative('git_push_changes', checkout);
        } catch (cause) {
          throw new Error(describeError(cause));
        }
        await onPushed();
      }}
    >
      {({ busy }) =>
        pending > 0 ? <DraftedMessageFields message={message} busy={busy} rows={4} /> : null
      }
    </ConfirmDialog>
  );
}
