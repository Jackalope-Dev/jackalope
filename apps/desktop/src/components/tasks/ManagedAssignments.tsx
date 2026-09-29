import { Panel } from '@jackalope/ui';
import { getAgentMetadata } from '../../lib/agent-catalog';
import type { managedTaskWork } from '../../lib/managed-task';
import { isActive, type TaskRun } from '../../lib/task-runtime';
import { taskDecision } from '../../lib/task-workflow';
import { Button } from '../ui/button';
import { ManagedTaskAgent } from './ManagedTaskAgent';
import { TaskLiveActivity } from './TaskLiveActivity';

export function ManagedAssignments({
  work,
  busy,
  onDetails,
  onActivity,
  onRetry,
}: {
  work: ReturnType<typeof managedTaskWork>;
  busy: boolean;
  onDetails: (run: TaskRun) => void;
  onActivity: (run: TaskRun) => void;
  onRetry: (id: string) => void;
}) {
  return (
    <div className="managed-assignments">
      {work.steps.map(({ item, run }) => (
        <Panel key={item.id} className="managed-assignment">
          <ManagedTaskAgent provider={run?.agent ?? item.agent} run={run} />
          <div className="managed-agent-message">
            <span className="managed-agent-name">
              {getAgentMetadata(run?.agent ?? item.agent)?.name ?? 'Automatic'}
            </span>
            <h3>{item.title}</h3>
            {run && isActive(run) ? (
              <TaskLiveActivity run={run} />
            ) : (
              <p className="managed-agent-update">
                {item.error ||
                  (run
                    ? run.error || taskDecision(run, work.integrated).label
                    : item.canceled
                      ? 'Canceled'
                      : work.paused
                        ? 'Paused'
                        : item.dependencies.length
                          ? 'Waiting for earlier steps'
                          : 'Queued')}
              </p>
            )}
          </div>
          <div className="managed-task-actions">
            {run && (
              <Button
                variant="outline"
                onClick={() => (isActive(run) ? onActivity(run) : onDetails(run))}
              >
                {isActive(run) ? 'View activity' : 'View result'}
              </Button>
            )}
            {(item.error || (run && ['failed', 'stopped'].includes(run.status))) &&
              !work.active.length && (
                <Button variant="outline" disabled={busy} onClick={() => onRetry(item.id)}>
                  Retry assignment
                </Button>
              )}
          </div>
        </Panel>
      ))}
    </div>
  );
}
