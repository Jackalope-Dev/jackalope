import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { nativeTask, type TaskRun } from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { useExecutionStore } from '../../stores/executionStore';
import { returnToCompanion, useCompanionNotices } from '../mascot/useCompanionNotices';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { InlineNotice } from '../ui/InlineNotice';

export function UnsavedTasksNotice() {
  const runs = useExecutionStore((state) => state.runs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const unsaved = runs.filter((run) => run.persistenceError);
  const selected = runs.find((run) => run.id === selectedId);
  useCompanionNotices(
    'unsaved',
    unsaved.map((run) => ({
      id: `unsaved:${run.id}`,
      title: 'Task history has not been saved',
      detail: `${run.projectName} · ${taskTitle(run.prompt)}\nKeep Jackalope open while you recover this task’s history.`,
      kind: 'attention',
      actionLabel: 'Recover task history',
      onOpen: () => setSelectedId(run.id),
    })),
  );
  if (!unsaved.length && !selected) return null;
  return (
    <Dialog.Root
      open={!!selected}
      onOpenChange={(open) => {
        if (!open) setSelectedId(null);
      }}
    >
      <DialogContent className="history-recovery-dialog" onCloseAutoFocus={returnToCompanion}>
        <DialogCloseButton label="Close unsaved task recovery" />
        <DialogHeader
          title="Recover task history"
          description={
            <>
              {selected?.projectName} · {selected?.agent}. Save this task’s latest state before
              closing Jackalope.
            </>
          }
        />
        {selected && <TaskSaveRecovery key={selected.id} run={selected} />}
      </DialogContent>
    </Dialog.Root>
  );
}

export function TaskSaveRecovery({ run }: { run: TaskRun }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const recover = async (copy: boolean) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      if (copy) {
        const path = await nativeTask<string | null>('task_export_recovery', { id: run.id });
        if (path)
          setMessage(`Recovery copy saved to ${path}. The task history still needs to be saved.`);
      } else {
        await nativeTask('task_retry_save', { id: run.id });
        setMessage('Task history saved.');
      }
      await useExecutionStore.getState().refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!run.persistenceError && !message && !error) return null;
  return (
    <section className="my-4 space-y-3" aria-label="Save task history">
      {run.persistenceError && (
        <>
          <h2 className="font-medium">Keep your latest work safe</h2>
          <InlineNotice tone="error">{run.persistenceError}</InlineNotice>
          <p className="task-muted">
            The latest task state is still in memory. Keep Jackalope open, free space or restore
            access to the history folder, then retry. Source files stay in the task workspace.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() => void recover(false)}
              loading={busy}
              loadingLabel="Working…"
            >
              Retry saving
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void recover(true)}>
              Save recovery copy…
            </Button>
          </div>
          <p className="task-muted text-xs">
            A recovery copy contains this task’s prompt, output and local paths, not the project’s
            source files. Keep it private. A running task may change after the copy is saved.
          </p>
        </>
      )}
      {message && (
        <InlineNotice tone="success" className="break-all">
          {message}
        </InlineNotice>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </section>
  );
}
