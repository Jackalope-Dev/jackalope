import { Checkbox, ConfirmDialog } from '@jackalope/ui';
import { GitPullRequestCreate } from 'lucide-react';
import { useState } from 'react';
import { nativeTask, type TaskRun } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { DraftedMessageFields, errorMessage, useDraftedMessage } from './DraftedMessage';

/**
 * Commits the task's remaining changes with the project's commit policy, pushes
 * its branch and opens a pull request through the GitHub CLI. Each step runs
 * only after the person confirms the title, description and draft choice. The title
 * and description are drafted from the branch's diff alone, so they describe the code
 * rather than the request or conversation that produced it.
 */
export function CreatePullRequest({
  run,
  disabled,
  onCreated,
}: {
  run: TaskRun;
  disabled?: boolean;
  onCreated: (url: string) => void;
}) {
  const [draft, setDraft] = useState(true);
  const [uncommitted, setUncommitted] = useState<string[] | null>(null);
  const checkout = { repoPath: run.projectPath, worktreePath: run.workspace };
  const message = useDraftedMessage(() =>
    nativeTask<{ title: string; body: string }>('git_generate_pull_request', {
      ...checkout,
      base: run.baseHead,
    }),
  );
  const title = message.title;
  const prepare = (open: boolean) => {
    if (!open) return;
    message.reset();
    setDraft(true);
    message.write(false);
    setUncommitted(null);
    void nativeTask<{ files: { path: string }[] }>('git_working_changes', checkout)
      .then((changes) => setUncommitted(changes.files.map((file) => file.path)))
      .catch(() => setUncommitted([]));
  };
  const create = async () => {
    if (!title.trim()) throw new Error('Write a pull request title.');
    try {
      if (uncommitted?.length)
        await nativeTask('git_commit_changes', {
          ...checkout,
          paths: uncommitted,
          title: title.trim(),
          body: '',
          agents: run.agent ? [run.agent] : [],
        });
      await nativeTask('git_push_changes', checkout);
      onCreated(
        await nativeTask<string>('task_pull_request_create', {
          id: run.id,
          title: title.trim(),
          body: message.body,
          draft,
        }),
      );
    } catch (cause) {
      throw new Error(errorMessage(cause));
    }
  };
  const steps = uncommitted?.length
    ? `Commits ${uncommitted.length} changed ${uncommitted.length === 1 ? 'file' : 'files'} with your commit settings, pushes ${run.branch} and opens the pull request with your GitHub CLI.`
    : `Pushes ${run.branch} and opens the pull request with your GitHub CLI.`;
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" disabled={disabled}>
          <GitPullRequestCreate size={16} aria-hidden="true" /> Create pull request
        </Button>
      }
      title="Create pull request"
      description={uncommitted === null ? 'Reading the task’s changes…' : steps}
      label={draft ? 'Open draft pull request' : 'Open pull request'}
      busyLabel="Opening…"
      variant="primary"
      disabled={uncommitted === null || !title.trim()}
      onOpenChange={prepare}
      onConfirm={create}
    >
      {({ busy }) => (
        <div className="workspace-stack">
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
