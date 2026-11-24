import { describeError } from '@jackalope/contracts/errors';
import { Button, Checkbox, ConfirmDialog } from '@jackalope/ui';
import { GitPullRequestCreate } from 'lucide-react';
import { useRef, useState } from 'react';
import { invokeNative } from '../../lib/native/transport';
import { workingChanges } from '../../lib/project-git';
import type { TaskRun } from '../../lib/run-types';
import { type ChangeRequestTarget, type HostKind, hostTerms } from '../../lib/source-control';
import { DraftedMessageFields, useDraftedMessage } from './DraftedMessage';

/**
 * Commits the task's remaining changes with the project's commit policy, pushes
 * its branch and opens a pull request through the GitHub CLI (a merge request through
 * the GitLab CLI, or a pull request through the Bitbucket API, on those hosts). Each step runs
 * only after the person confirms the title, description and draft choice. The title
 * and description are drafted from the branch's diff alone, so they describe the code
 * rather than the request or conversation that produced it.
 */
export function CreatePullRequest({
  run,
  provider,
  disabled,
  onCreated,
}: {
  run: TaskRun;
  /** The project's code host; GitHub until it is known. */
  provider?: HostKind;
  disabled?: boolean;
  onCreated: (url: string) => void;
}) {
  const { noun, via } = hostTerms(provider);
  const [draft, setDraft] = useState(true);
  const [uncommitted, setUncommitted] = useState<string[] | null>(null);
  // Where GitLab or Bitbucket will open it; GitHub's CLI chooses as it always has.
  const [target, setTarget] = useState<ChangeRequestTarget | null>(null);
  const [targetError, setTargetError] = useState('');
  const [inFork, setInFork] = useState(false);
  const hosted = !!provider && provider !== 'github';
  const reading = useRef(0);
  const readTarget = (fork: boolean) => {
    const read = ++reading.current;
    setTargetError('');
    void invokeNative<ChangeRequestTarget | null>('task_pull_request_target', {
      id: run.id,
      inFork: fork,
    })
      .then((next) => read === reading.current && setTarget(next))
      .catch((cause) => read === reading.current && setTargetError(describeError(cause)));
  };
  const checkout = { repoPath: run.projectPath, worktreePath: run.workspace };
  const message = useDraftedMessage(() =>
    invokeNative<{ title: string; body: string }>('git_generate_pull_request', {
      ...checkout,
      base: run.baseHead,
      ...(provider && provider !== 'github' ? { provider } : {}),
    }),
  );
  const title = message.title;
  const prepare = (open: boolean) => {
    if (!open) return;
    message.reset();
    setDraft(true);
    message.write(false);
    setUncommitted(null);
    setTarget(null);
    setInFork(false);
    if (hosted) readTarget(false);
    void workingChanges(checkout)
      .then((changes) => setUncommitted(changes.files.map((file) => file.path)))
      .catch(() => setUncommitted([]));
  };
  const create = async () => {
    if (!title.trim()) throw new Error(`Write a ${noun} title.`);
    try {
      if (uncommitted?.length)
        await invokeNative('git_commit_changes', {
          ...checkout,
          paths: uncommitted,
          title: title.trim(),
          body: '',
          agents: run.agent ? [run.agent] : [],
        });
      await invokeNative('git_push_changes', checkout);
      onCreated(
        await invokeNative<string>('task_pull_request_create', {
          id: run.id,
          title: title.trim(),
          body: message.body,
          draft,
          ...(hosted ? { inFork } : {}),
        }),
      );
    } catch (cause) {
      throw new Error(describeError(cause));
    }
  };
  const steps = uncommitted?.length
    ? `Commits ${uncommitted.length} changed ${uncommitted.length === 1 ? 'file' : 'files'} with your commit settings, pushes ${run.branch} and opens the ${noun} with ${via}.`
    : `Pushes ${run.branch} and opens the ${noun} with ${via}.`;
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" disabled={disabled}>
          <GitPullRequestCreate size={16} aria-hidden="true" /> Create {noun}
        </Button>
      }
      title={`Create ${noun}`}
      description={uncommitted === null ? 'Reading the task’s changes…' : steps}
      label={draft ? `Open draft ${noun}` : `Open ${noun}`}
      busyLabel="Opening…"
      variant="primary"
      disabled={uncommitted === null || !title.trim()}
      onOpenChange={prepare}
      onConfirm={create}
    >
      {({ busy }) => (
        <div className="workspace-stack">
          {hosted && (target || targetError) && (
            <p className="task-muted">
              {target
                ? `Into ${target.repository}${target.branch ? ` → ${target.branch}` : ''}${target.forked ? ` from your fork ${target.fork}` : ''}.`
                : `Could not read where it will open: ${targetError}`}
            </p>
          )}
          {provider === 'gitlab' && (target?.forked || inFork) && (
            <label className="flex items-center gap-3 min-h-11">
              <Checkbox
                checked={inFork}
                disabled={busy}
                onChange={(event) => {
                  setInFork(event.target.checked);
                  readTarget(event.target.checked);
                }}
              />
              Open it in the fork instead
            </label>
          )}
          <DraftedMessageFields message={message} busy={busy} />
          <label className="flex items-center gap-3 min-h-11">
            <Checkbox
              checked={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.checked)}
            />
            Open as a draft
          </label>
        </div>
      )}
    </ConfirmDialog>
  );
}
