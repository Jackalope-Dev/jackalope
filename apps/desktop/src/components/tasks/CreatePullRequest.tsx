import { Checkbox, ConfirmDialog, FormField, Input, Textarea } from '@jackalope/ui';
import { GitPullRequestCreate } from 'lucide-react';
import { useRef, useState } from 'react';
import { nativeTask, type TaskRun } from '../../lib/task-runtime';
import { Button } from '../ui/button';

/** Commit failures arrive as structured objects; everything else as text. */
function message(cause: unknown) {
  if (cause && typeof cause === 'object' && 'message' in cause)
    return String((cause as { message: unknown }).message);
  return String(cause);
}

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
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(true);
  const [uncommitted, setUncommitted] = useState<string[] | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  const attempt = useRef(0);
  const checkout = { repoPath: run.projectPath, worktreePath: run.workspace };
  const prepare = (open: boolean) => {
    if (!open) return;
    setTitle('');
    setBody('');
    setDraft(true);
    setDraftError('');
    setDrafting(true);
    const current = ++attempt.current;
    void nativeTask<{ title: string; body: string }>('git_generate_pull_request', {
      ...checkout,
      base: run.baseHead,
    })
      .then((text) => {
        if (current !== attempt.current) return;
        // Keep anything the person typed while the draft was being written.
        setTitle((typed) => typed || text.title);
        setBody((typed) => typed || text.body);
      })
      .catch((cause) => {
        if (current === attempt.current) setDraftError(message(cause));
      })
      .finally(() => {
        if (current === attempt.current) setDrafting(false);
      });
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
          body,
          draft,
        }),
      );
    } catch (cause) {
      throw new Error(message(cause));
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
          <FormField
            label="Title"
            description={
              drafting
                ? 'Drafting from the changes…'
                : draftError
                  ? `Could not draft from the changes: ${draftError}`
                  : undefined
            }
          >
            <Input
              value={title}
              placeholder={drafting ? 'Drafting…' : undefined}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              rows={6}
              value={body}
              disabled={busy}
              onChange={(event) => setBody(event.target.value)}
            />
          </FormField>
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
