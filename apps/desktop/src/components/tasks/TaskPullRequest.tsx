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
import {
  type HostKind,
  hostTerms,
  type MergeMethod,
  mergeMethodLabel,
  mergeMethods,
} from '../../lib/source-control';
import { usePullRequestStore } from '../../stores/pullRequestStore';
import { ActionError } from '../ui/ActionError';
import { DraftedMessageFields, useDraftedMessage } from './DraftedMessage';

const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`;

function checksSummary(pr: TrackedPullRequest) {
  if (!pr.checkedAt) return `Reading from ${hostTerms(pr.provider).host}…`;
  const noun = pr.provider === 'gitlab' ? 'pipeline job' : 'check';
  if (!pr.checks) return `No ${noun}s reported`;
  if (pr.failing.length) return `${pr.failing.length} of ${count(pr.checks, noun)} failed`;
  if (pr.pending) return `${pr.pending} of ${count(pr.checks, noun)} running`;
  return `${count(pr.checks, noun)} passed`;
}

/**
 * The pull request (a merge request on GitLab) a task opened: where it stands on its host
 * and the next step. Fixes go back to the task's own agent as an editable follow-up;
 * pushing and merging each ask first.
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
  const view = pullRequestPhaseView(pr.phase, pr.provider);
  const terms = hostTerms(pr.provider);
  /** The host's own record of an item, as a labeled excerpt; a convenience the agent can do without. */
  const context = (kind: 'review' | 'ci', number: string) =>
    invokeNative<{ text: string }>('project_github_context', {
      projectPath: run.projectPath,
      kind,
      number,
    })
      .then((context) => context.text)
      .catch(() => '');
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
          draft: async () =>
            pr.provider && pr.provider !== 'github'
              ? checksHandoff(
                  run,
                  pr.url,
                  pr.failing,
                  pr.provider,
                  pr.pipeline ? await context('ci', pr.pipeline) : '',
                )
              : checksHandoff(run, pr.url, pr.failing),
        }
      : pr.phase === 'changes'
        ? {
            label: 'Ask the agent to address it',
            draft: async () => {
              const threads = pr.number ? await context('review', String(pr.number)) : '';
              return reviewHandoff(run, pr.url, threads, pr.provider);
            },
          }
        : pr.phase === 'conflict'
          ? {
              label: 'Ask the agent to resolve',
              draft: async () => conflictHandoff(run, pr.url, pr.provider),
            }
          : null;
  return (
    <section className="task-pull-request" aria-label={terms.Noun}>
      <div className="task-pull-request-summary">
        <GitPullRequest size={16} aria-hidden="true" />
        <span className="task-pull-request-title">
          {terms.Noun}
          {pr.number ? ` ${pr.provider === 'gitlab' ? '!' : '#'}${pr.number}` : ''}
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
      {open && pr.blocker && <p className="task-muted">{pr.blocker}</p>}
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
          <MergePullRequest
            run={run}
            url={pr.url}
            provider={pr.provider}
            head={pr.headRefOid}
            methods={mergeMethods(pr.provider, pr.mergeMethods)}
            disabled={disabled || busy}
            onMerged={refresh}
          />
        )}
        {open && <PushUpdate run={run} disabled={disabled || busy} onPushed={refresh} />}
        <Button
          variant="outline"
          onClick={() => void act(() => openExternalUrl(pr.url))}
          aria-label={`Open ${terms.noun} on ${terms.host}`}
        >
          Open on {terms.host} <ExternalLinkIcon />
        </Button>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button variant="ghost" aria-label={`${terms.Noun} options`}>
              <MoreHorizontal size={18} />
            </Button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className="workspace-menu" align="end" sideOffset={8}>
              <Menu.Item className="workspace-menu-item" onSelect={() => void act(refresh)}>
                <RefreshCw size={16} aria-hidden="true" />
                Check {terms.host} now
              </Menu.Item>
              <Menu.Item
                className="workspace-menu-item"
                onSelect={() => usePullRequestStore.getState().untrack(run.taskId)}
              >
                <CircleX size={16} aria-hidden="true" />
                Stop following this {terms.noun}
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
      {pr.error && (
        <InlineNotice tone="warning">
          {terms.host} could not be read, so this may be out of date. {pr.error}
        </InlineNotice>
      )}
      <ActionError error={error} />
    </section>
  );
}

/** What merging does on each host, in the confirmation. */
function mergeDescription(provider: HostKind | undefined, branch: string, target: string) {
  if (provider === 'gitlab')
    return `Merges ${branch} into ${target} on GitLab with your GitLab CLI. GitLab still requires its pipeline, approvals and threads to allow it. Anything that deploys from that branch will run.`;
  if (provider === 'bitbucket')
    return `Merges ${branch} into ${target} on Bitbucket with your API token, under the repository's merge checks. Anything that deploys from that branch will run.`;
  return `Merges ${branch} into ${target} on GitHub with your GitHub CLI. Anything that deploys from that branch will run.`;
}

function MergePullRequest({
  run,
  url,
  provider,
  head,
  methods,
  disabled,
  onMerged,
}: {
  run: TaskRun;
  url: string;
  provider?: HostKind;
  /** The head commit last read; GitLab and Bitbucket merge only at it. */
  head?: string;
  methods: MergeMethod[];
  disabled?: boolean;
  onMerged: () => Promise<void>;
}) {
  const [method, setMethod] = useState<MergeMethod>(methods[0] ?? 'merge');
  const title = provider === 'gitlab' ? 'Merge this merge request' : 'Merge pull request';
  return (
    <ConfirmDialog
      trigger={
        <Button variant="primary" disabled={disabled}>
          <GitMerge size={16} aria-hidden="true" /> {provider === 'gitlab' ? 'Merge' : title}
        </Button>
      }
      title={title}
      description={mergeDescription(
        provider,
        run.branch || 'the task branch',
        run.targetBranch?.trim() || 'its target',
      )}
      label={provider === 'gitlab' ? 'Merge' : title}
      busyLabel="Merging…"
      variant="primary"
      onOpenChange={(open) => {
        if (open && !methods.includes(method)) setMethod(methods[0] ?? 'merge');
      }}
      onConfirm={async () => {
        try {
          await invokeNative(
            'task_pull_request_merge',
            provider && provider !== 'github' && head
              ? { id: run.id, url, method, head }
              : { id: run.id, url, method },
          );
        } catch (cause) {
          throw new Error(describeError(cause));
        }
        await onMerged();
      }}
    >
      {({ busy }) =>
        methods.length > 1 ? (
          <FormField label="Merge method">
            <Select
              value={method}
              disabled={busy}
              onValueChange={(value) => setMethod(value as MergeMethod)}
            >
              {methods.map((item) => (
                <SelectItem key={item} value={item}>
                  {mergeMethodLabel(provider, item)}
                </SelectItem>
              ))}
            </Select>
          </FormField>
        ) : null
      }
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
