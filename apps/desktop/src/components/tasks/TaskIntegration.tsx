import { useCallback, useEffect, useState } from 'react';
import { type QueueView, queueSnapshot } from '../../lib/queue';
import type { TaskRun } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { MergeReview } from './MergeReview';

export function TaskIntegration({ run, onApplied }: { run: TaskRun; onApplied: () => void }) {
  const project = useProjectStore((state) => state.projects.find((p) => p.id === run.projectId));
  const runs = useExecutionStore((state) => state.runs);
  const [queue, setQueue] = useState<QueueView>();
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const next = await queueSnapshot();
      setQueue(next);
      setError('');
      if (next.mergedRunIds.includes(run.id)) onApplied();
    } catch (cause) {
      setError(String(cause));
    }
  }, [run.id, onApplied]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (error)
    return (
      <p role="alert" className="task-error">
        {error}
      </p>
    );
  if (!project)
    return <p className="task-muted">Restore this project before integrating its changes.</p>;
  if (!queue)
    return (
      <p role="status" className="task-muted">
        Checking integration history…
      </p>
    );
  return (
    <div>
      {run.checkpoint && (
        <p className="task-notice">
          Checkpoint saved: {run.checkpoint.head.slice(0, 8)} ·{' '}
          {run.checkpoint.message.split('\n')[0]}
        </p>
      )}
      {run.checkpointError && (
        <p role="alert" className="task-error">
          Automatic checkpoint needs attention: {run.checkpointError}
        </p>
      )}
      <MergeReview
        project={project}
        runs={runs}
        items={queue.items}
        merged={queue.mergedRunIds}
        onChanged={refresh}
        onlyRunId={run.id}
      />
    </div>
  );
}
