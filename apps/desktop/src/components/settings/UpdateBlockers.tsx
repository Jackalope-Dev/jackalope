import { isLive } from '@jackalope/contracts/runs';
import { Button } from '@jackalope/ui';
import { useMemo } from 'react';
import type { TaskRun } from '../../lib/run-types';
import { runTitle } from '../../lib/task-title';
import { openRun } from '../../lib/work-selection';
import { useExecutionStore } from '../../stores/executionStore';
import { useUpdateStore } from '../../stores/updateStore';
import { StopInterrupted } from '../tasks/ResumeInterrupted';
import './update-blockers.css';

/**
 * Task runs that keep an update from installing. The native install refuses the same set:
 * anything running or interrupted, since it still holds its workspace, and anything whose
 * history is not saved.
 */
export function useUpdateBlockers() {
  const runs = useExecutionStore((state) => state.runs);
  return useMemo(() => runs.filter((run) => run.persistenceError || isLive(run)), [runs]);
}

function reason(run: TaskRun) {
  if (run.persistenceError) return 'History needs saving';
  if (run.status === 'interrupted') return 'Interrupted';
  if (run.status === 'stopping') return 'Stopping';
  return 'Running';
}

/** Names the work blocking an update, with a way to open or release each one. */
export function UpdateBlockers({ runs }: { runs: TaskRun[] }) {
  const open = (id: string) => {
    useUpdateStore.getState().showDetails(false);
    openRun(id);
  };
  return (
    <div className="space-y-2" role="status">
      <p className="text-sm">
        {runs.length === 1
          ? 'This task needs to finish or be stopped before the update installs.'
          : 'These tasks need to finish or be stopped before the update installs.'}
      </p>
      <ul className="update-blockers">
        {runs.map((run) => (
          <li key={run.id}>
            <span className="update-blocker-title">{runTitle(run)}</span>
            <span className="settings-row-description">{reason(run)}</span>
            <span className="update-blocker-actions">
              {run.status === 'interrupted' && !run.persistenceError && (
                <StopInterrupted
                  run={run}
                  onStopped={() => useExecutionStore.getState().refresh()}
                />
              )}
              <Button variant="ghost" onClick={() => open(run.id)}>
                Open
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
