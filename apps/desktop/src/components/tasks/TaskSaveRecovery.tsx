import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState } from 'react';
import { nativeTask, type TaskRun } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';
import { Button } from '../ui/button';

export function UnsavedTasksNotice() {
  const runs = useExecutionStore((state) => state.runs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const unsaved = runs.filter((run) => run.persistenceError);
  const selected = runs.find((run) => run.id === selectedId);
  if (!unsaved.length && !selected) return null;
  return (
    <Dialog.Root
      open={!!selected}
      onOpenChange={(open) => {
        if (!open) setSelectedId(null);
      }}
    >
      {!!unsaved.length && (
        <div className="history-recovery-notice">
          <p role="status" className="min-w-0 flex-1">
            {unsaved.length} {unsaved.length === 1 ? 'task has' : 'tasks have'} unsaved history.
            Keep Jackalope open while you recover it.
          </p>
          <Dialog.Trigger asChild>
            <Button variant="ghost" onClick={() => setSelectedId(unsaved[0].id)}>
              Review unsaved task
            </Button>
          </Dialog.Trigger>
        </div>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content className="task-dialog appearance-panel history-recovery-dialog">
          <Dialog.Close className="task-close" aria-label="Close unsaved task recovery">
            <X size={18} />
          </Dialog.Close>
          <Dialog.Title className="text-xl font-medium pr-10">Recover task history</Dialog.Title>
          <Dialog.Description className="task-muted mt-3">
            {selected?.projectName} · {selected?.agent}. Save this task’s latest state before
            closing Jackalope.
          </Dialog.Description>
          {selected && <TaskSaveRecovery key={selected.id} run={selected} />}
        </Dialog.Content>
      </Dialog.Portal>
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
          <p role="alert" className="task-error">
            {run.persistenceError}
          </p>
          <p className="task-muted">
            The latest task state is still in memory. Keep Jackalope open, free space or restore
            access to the history folder, then retry. Source files stay in the task workspace.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void recover(false)}>
              {busy ? 'Working…' : 'Retry saving'}
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
        <p role="status" className="task-muted break-all">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
    </section>
  );
}
