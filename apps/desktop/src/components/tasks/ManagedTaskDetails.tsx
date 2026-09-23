import { Panel } from '@jackalope/ui';
import { decisionUsageEntries } from '../../lib/decision-usage';
import type { ManagedTask, managedTaskWork } from '../../lib/managed-task';
import { usageEntries } from '../../lib/usage-entries';
import { summarizeUsage } from '../../lib/usage-insights';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';

export function ManagedTaskDetails({
  task,
  work,
}: {
  task: ManagedTask;
  work: ReturnType<typeof managedTaskWork>;
}) {
  const usage = summarizeUsage([
    ...usageEntries(work.work),
    ...(task.assessment.cached ? [] : decisionUsageEntries(task.assessment.decision)),
  ]);
  return (
    <>
      <Panel className="managed-request workspace-stack">
        <WorkspaceSectionHeading title="Your request" />
        <p className="whitespace-pre-wrap">{task.request.prompt}</p>
        <h3>Why this approach</h3>
        <p className="task-muted">{task.assessment.reason}</p>
        {task.assessment.cached && (
          <p className="task-muted">Assessment reused; no additional assessment call.</p>
        )}
        {task.assessment.decision.fallbackReason && (
          <p>{task.assessment.decision.fallbackReason}</p>
        )}
      </Panel>
      <Panel className="workspace-stack">
        <WorkspaceSectionHeading title="Usage" />
        <dl className="managed-measurements">
          <div>
            <dt>Reported tokens</dt>
            <dd>{usage.tokens === null ? 'Unavailable' : usage.tokens.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Estimated cost</dt>
            <dd>{usage.costUsd === null ? 'Unavailable' : `$${usage.costUsd.toFixed(4)}`}</dd>
          </div>
        </dl>
        {!!usage.missing && (
          <p className="task-muted">{usage.missing} usage reports unavailable.</p>
        )}
        {work.missingAttempts.length > 0 && (
          <p className="task-muted">History coverage is incomplete.</p>
        )}
        {!!(usage.costMissing || usage.missing || work.missingAttempts.length) && (
          <p className="task-muted">Cost coverage is incomplete.</p>
        )}
        <p className="task-muted">Includes assessment, planning and execution.</p>
      </Panel>
      {task.delivery && (
        <Panel className="workspace-stack">
          <WorkspaceSectionHeading title="Review and delivery" />
          <dl className="managed-measurements">
            <div>
              <dt>Automatic repairs</dt>
              <dd>
                {task.delivery.repairs.length} / {task.delivery.repairLimit}
              </dd>
            </div>
            <div>
              <dt>Decisions answered</dt>
              <dd>
                {work.work.reduce(
                  (count, run) =>
                    count +
                    (run.prompts?.filter((prompt) => prompt.status === 'answered').length ?? 0),
                  0,
                )}
              </dd>
            </div>
            {task.delivery.reviewSeconds != null && (
              <div>
                <dt>Focused review</dt>
                <dd>{Math.ceil(task.delivery.reviewSeconds / 60)} min</dd>
              </div>
            )}
            {task.delivery.workersFinishedAt && task.delivery.appliedAt && (
              <div>
                <dt>Work finished to applied</dt>
                <dd>
                  {Math.max(
                    0,
                    Math.ceil(
                      (Date.parse(task.delivery.appliedAt) -
                        Date.parse(task.delivery.workersFinishedAt)) /
                        60000,
                    ),
                  )}{' '}
                  min
                </dd>
              </div>
            )}
          </dl>
          {(task.delivery.reviewSeconds != null || task.delivery.appliedAt) && (
            <p className="task-muted">
              Review time counts while this result is visible and the window is focused. Delivery
              time includes waiting.
            </p>
          )}
        </Panel>
      )}
    </>
  );
}
