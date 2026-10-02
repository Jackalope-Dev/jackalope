import { Split } from 'lucide-react';
import { useState } from 'react';
import { isActive, nativeTask, type TaskRun } from '../../lib/task-runtime';
import { Button } from '../ui/button';

/** Lets the agent of a running isolated task spin off separable work as subtasks. */
export function SplitTaskButton({
  run,
  onResult,
}: {
  run: TaskRun;
  onResult: (message: string, failed: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  if (!isActive(run) || run.workspace === run.projectPath || !run.baseHead) return null;
  return (
    <Button
      variant="outline"
      disabled={busy || asked || run.status === 'stopping'}
      loading={busy}
      loadingLabel="Asking…"
      onClick={async () => {
        setBusy(true);
        try {
          await nativeTask('task_request_split', { runId: run.id });
          setAsked(true);
          onResult(
            'Asked the agent to split off independent work. New subtasks appear here when it creates them.',
            false,
          );
        } catch (cause) {
          onResult(String(cause), true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Split size={14} aria-hidden="true" />
      {asked ? 'Split requested' : 'Split this task'}
    </Button>
  );
}
