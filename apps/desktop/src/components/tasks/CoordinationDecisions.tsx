import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import type { QueueCommand, QueueView } from '../../lib/queue';
import type { TaskRun } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

export function CoordinationDecisions({
  queue,
  projectId,
  runs,
  busy,
  act,
}: {
  queue: QueueView;
  projectId: string;
  runs: TaskRun[];
  busy: boolean;
  act: (command: QueueCommand, args: Record<string, unknown>) => Promise<void>;
}) {
  const title = (id: string) => queue.items.find((item) => item.id === id)?.title ?? 'Manual task';
  const agreements = (queue.agreements ?? []).filter((a) => a.projectId === projectId);
  const audits = (queue.scopeAudits ?? []).filter(
    (a) => a.projectId === projectId && (a.error || a.outside.length || a.overlaps.length),
  );
  return (
    <div className="coordination-decisions">
      {audits.map((audit) => {
        const run = runs.find((r) => r.id === audit.runId);
        const active =
          run && ['starting', 'running', 'stopping', 'interrupted'].includes(run.status);
        const accepted = audit.tree && audit.tree === audit.acceptedTree;
        return (
          <article className="queue-message" key={audit.runId}>
            <h3>Changed files · {title(audit.taskId)}</h3>
            {audit.error && <InlineNotice tone="error">{audit.error}</InlineNotice>}
            {audit.overlaps.length > 0 && (
              <InlineNotice tone="error">
                These files also changed in another task. Reconcile the edits before merging.
              </InlineNotice>
            )}
            <Disclosure>
              <DisclosureSummary className="task-summary">
                Review files outside the assignment or shared with another task
              </DisclosureSummary>
              <ul className="coordination-paths">
                {[...new Set([...audit.outside, ...audit.overlaps])].map((path) => (
                  <li key={path}>
                    {path}
                    {audit.overlaps.includes(path) ? ' · Overlapping edits' : ''}
                  </li>
                ))}
              </ul>
              {audit.outside.length > 0 && !accepted && (
                <>
                  <p>
                    Accepting allows these extra files in this saved version. Further edits require
                    another review.
                  </p>
                  <Button
                    variant="outline"
                    disabled={
                      busy || !!active || !!audit.error || !!audit.overlaps.length || !audit.tree
                    }
                    onClick={() =>
                      void act('queue_reconcile_scope', { runId: audit.runId, tree: audit.tree })
                    }
                  >
                    Accept these extra files
                  </Button>
                  {active && (
                    <p className="task-muted">
                      Stop the task and resolve any interrupted process before accepting.
                    </p>
                  )}
                </>
              )}
              {accepted && <p className="task-muted">Extra files accepted for this version.</p>}
            </Disclosure>
          </article>
        );
      })}
      {agreements
        .slice()
        .reverse()
        .map((agreement) => (
          <article className="queue-message" key={agreement.id}>
            <h3>
              {agreement.resource} ·{' '}
              {agreement.kind === 'ownership' ? 'Ownership' : 'Interface agreement'}
            </h3>
            <p>
              {title(agreement.taskId)} · {agreement.status}
            </p>
            <p>{agreement.text}</p>
            {agreement.resolutionRun && (
              <p className="task-muted">
                Resolved by the reconciliation agent; individual owner responses remain recorded
                below.
              </p>
            )}
            {agreement.paths.length > 0 && (
              <p className="task-muted">{agreement.paths.join(', ')}</p>
            )}
            {agreement.participants.length > 0 && (
              <ul>
                {agreement.participants.map((id) => (
                  <li key={id}>
                    {title(id)} ·{' '}
                    {agreement.rejectedBy === id
                      ? 'Rejected'
                      : agreement.acceptedBy.includes(id)
                        ? 'Agreed'
                        : agreement.status === 'pending'
                          ? 'Awaiting agreement'
                          : 'No response recorded'}
                  </li>
                ))}
              </ul>
            )}
            {agreement.kind === 'ownership' &&
              !['released', 'canceled'].includes(agreement.status) && (
                <Disclosure>
                  <DisclosureSummary className="task-summary">
                    Release this responsibility
                  </DisclosureSummary>
                  <p>
                    The owner must be stopped. Changes in the claimed paths must be preserved
                    through integration or removed from this worktree first.
                  </p>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act('queue_cancel_agreement', {
                        id: agreement.id,
                        revision: agreement.revision,
                      })
                    }
                  >
                    Release ownership
                  </Button>
                </Disclosure>
              )}
            {agreement.kind === 'interface' &&
              ['pending', 'rejected'].includes(agreement.status) && (
                <Disclosure>
                  <DisclosureSummary className="task-summary">
                    Resolve this decision
                  </DisclosureSummary>
                  <p>
                    Continue the affected tasks to reach agreement. If this interface is no longer
                    needed, cancel its gate to allow dependent work and review.
                  </p>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act('queue_cancel_agreement', {
                        id: agreement.id,
                        revision: agreement.revision,
                      })
                    }
                  >
                    Cancel interface gate
                  </Button>
                </Disclosure>
              )}
          </article>
        ))}
    </div>
  );
}
