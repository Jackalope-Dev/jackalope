import { Button, Checkbox, ConfirmDialog } from '@jackalope/ui';
import { GitCommitHorizontal, GitMerge } from 'lucide-react';
import { useRef, useState } from 'react';
import { invokeNative } from '../../lib/native/transport';
import { workingChanges } from '../../lib/project-git';
import type { TaskRun } from '../../lib/run-types';
import { DraftedMessageFields, errorMessage, useDraftedMessage } from './DraftedMessage';

const files = (count: number) => `${count} changed ${count === 1 ? 'file' : 'files'}`;

/**
 * Lands a task that worked in the project checkout without a pull request: `commit`
 * commits it on the branch it is already on, `merge` commits what remains on the task's
 * branch and merges that branch into `target` locally. Pushing is a separate opt-in.
 */
export function LocalDelivery({
  run,
  target,
  mode,
  disabled,
  onDone,
}: {
  run: TaskRun;
  target: string;
  mode: 'commit' | 'merge';
  disabled?: boolean;
  onDone: (summary: string) => void;
}) {
  const [uncommitted, setUncommitted] = useState<string[] | null>(null);
  const [push, setPush] = useState(false);
  // Drafting starts as soon as the file list loads, before state reflects it.
  const paths = useRef<string[]>([]);
  const checkout = { repoPath: run.projectPath, worktreePath: run.workspace };
  const message = useDraftedMessage(() =>
    invokeNative<{ title: string; body: string }>('git_generate_commit_message', {
      ...checkout,
      paths: paths.current,
    }),
  );
  const prepare = (open: boolean) => {
    if (!open) return;
    message.reset();
    setPush(false);
    setUncommitted(null);
    void workingChanges(checkout)
      .then((changes) => {
        paths.current = changes.files.map((file) => file.path);
        setUncommitted(paths.current);
        if (paths.current.length) message.write(false);
      })
      .catch(() => setUncommitted([]));
  };
  const pending = uncommitted?.length ?? 0;
  const confirm = async () => {
    if (pending && !message.title.trim()) throw new Error('Write a commit title.');
    const done: string[] = [];
    try {
      if (pending) {
        await invokeNative('git_commit_changes', {
          ...checkout,
          paths: uncommitted,
          title: message.title.trim(),
          body: message.body,
          agents: run.agent ? [run.agent] : [],
        });
        done.push(`Committed ${files(pending)} to ${mode === 'merge' ? run.branch : target}`);
      }
      if (mode === 'merge') {
        await invokeNative<string>('task_merge_locally', { id: run.id, target });
        done.push(`merged ${run.branch} into ${target}`);
      }
      if (push) {
        await invokeNative('git_push_changes', checkout);
        done.push(`pushed ${target}`);
      }
    } catch (cause) {
      if (done.length) onDone(`${done.join(', ')}.`);
      throw new Error(
        done.length
          ? `${done.join(', ')}, then stopped: ${errorMessage(cause)}`
          : errorMessage(cause),
      );
    }
    const summary = done.join(', ');
    onDone(`${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`);
  };
  const description =
    uncommitted === null
      ? 'Reading the task’s changes…'
      : mode === 'merge'
        ? pending
          ? `Commits ${files(pending)} on ${run.branch} with your commit settings, then merges ${run.branch} into ${target} in the project checkout.`
          : `Merges ${run.branch} into ${target} in the project checkout and leaves ${target} checked out.`
        : pending
          ? `Commits ${files(pending)} to ${target} with your commit settings.`
          : `Everything on ${target} is already committed.`;
  const label =
    mode === 'merge' ? `Merge into ${target}` : pending ? `Commit to ${target}` : `Push ${target}`;
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" disabled={disabled}>
          {mode === 'merge' ? (
            <GitMerge size={16} aria-hidden="true" />
          ) : (
            <GitCommitHorizontal size={16} aria-hidden="true" />
          )}
          {mode === 'merge' ? `Merge into ${target}` : `Commit to ${target}`}
        </Button>
      }
      title={mode === 'merge' ? `Merge into ${target}` : `Commit to ${target}`}
      description={description}
      label={push && label !== `Push ${target}` ? `${label} and push` : label}
      busyLabel={mode === 'merge' ? 'Merging…' : 'Committing…'}
      variant="primary"
      disabled={
        uncommitted === null ||
        (!!pending && !message.title.trim()) ||
        (mode === 'commit' && !pending && !push)
      }
      onOpenChange={prepare}
      onConfirm={confirm}
    >
      {({ busy }) => (
        <div className="workspace-stack">
          {pending > 0 && <DraftedMessageFields message={message} busy={busy} rows={4} />}
          <label className="flex items-center gap-3 min-h-11">
            <Checkbox
              checked={push}
              disabled={busy}
              onChange={(event) => setPush(event.target.checked)}
            />
            Push {target} afterwards
          </label>
        </div>
      )}
    </ConfirmDialog>
  );
}
