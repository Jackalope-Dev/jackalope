import type { QueueCommand, QueueView } from '../../lib/queue';
import type { Project } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

export function CoordinationAutomation({
  project,
  queue,
  busy,
  act,
  onSelect,
}: {
  project: Project;
  queue: QueueView;
  busy: boolean;
  act: (command: QueueCommand, args: Record<string, unknown>) => Promise<void>;
  onSelect: (id: string) => void;
}) {
  const policy = queue.assistPolicies?.find((p) => p.projectId === project.id);
  const verifyCommand = project.preferences?.verifyCommand ?? '';
  const save = (field: 'resolve' | 'merge', checked: boolean) =>
    act('queue_assist_policy', {
      policy: {
        projectId: project.id,
        projectPath: project.path,
        projectName: project.name,
        agent: 'auto',
        verifyCommand,
        resolve: policy?.resolve ?? false,
        merge: policy?.merge ?? false,
        [field]: checked,
      },
    });
  const jobs = queue.reconciliations?.filter((j) => j.projectId === project.id) ?? [];
  return (
    <section
      className="queue-coordination coordination-decisions"
      aria-label="Automatic coordination"
    >
      <details>
        <summary className="task-summary">Automatic coordination</summary>
        <p>
          When the queue is running, Jackalope can use your default agent to reconcile completed
          work in a separate worktree. This uses your connected agent account and allowance.
        </p>
        {!verifyCommand && (
          <p className="task-muted">Save a project verification command to enable these options.</p>
        )}
        <label className="coordination-option">
          <input
            type="checkbox"
            checked={policy?.resolve ?? false}
            disabled={busy || (!verifyCommand && !policy?.resolve)}
            onChange={(e) => void save('resolve', e.target.checked)}
          />
          Resolve conflicts and interface decisions automatically
        </label>
        <label className="coordination-option">
          <input
            type="checkbox"
            checked={policy?.merge ?? false}
            disabled={busy || (!verifyCommand && !policy?.merge)}
            onChange={(e) => void save('merge', e.target.checked)}
          />
          Merge verified work automatically
        </label>
        <p className="task-muted">
          Automatic merging creates a local commit on the target branch after saved checks and
          required outcome acceptance pass. It does not push or remove source worktrees. Otherwise,
          results stay in Review & merge. Pausing the queue stops new automatic actions; running
          agents continue.
        </p>
      </details>
      {jobs
        .slice(-10)
        .reverse()
        .map((job) => (
          <article key={job.id} className="queue-message">
            <h3>Reconciliation · {job.status === 'review' ? 'Ready for review' : job.status}</h3>
            <p>{job.sourceIds.length} source tasks</p>
            {job.error && <InlineNotice tone="error">{job.error}</InlineNotice>}
            {job.runId && (
              <Button variant="outline" onClick={() => onSelect(job.runId as string)}>
                Open reconciliation task
              </Button>
            )}
            {['failed', 'reserved'].includes(job.status) && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void act('queue_retry_reconciliation', { id: job.id })}
              >
                Retry reconciliation
              </Button>
            )}
          </article>
        ))}
    </section>
  );
}
