import { Globe } from 'lucide-react';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { ValidationJourney } from '../tasks/ValidationJourney';
import { EmptyState } from '../ui/EmptyState';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';

export function BrowserHarness() {
  const runs = useExecutionStore((state) => state.runs);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const evidenceRuns = runs.filter(
    (run) =>
      run.projectId === activeProjectId &&
      ((run.screenshots?.length ?? 0) > 0 || (run.validationSteps?.length ?? 0) > 0),
  );
  return (
    <section className="task-page">
      <WorkspaceHeading
        title="Browser"
        description="Review screenshots and validation checkpoints recorded by your tasks."
      />
      <p className="task-muted mb-6">Interactive browsing is not available yet.</p>
      {evidenceRuns.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No browser evidence yet"
          description={
            activeProjectId
              ? 'Screenshots and validation checkpoints will appear here when a task records them.'
              : 'Open a project to review its task evidence.'
          }
        />
      ) : (
        <div className="space-y-6">
          {evidenceRuns.map((run) => (
            <section key={run.id} className="space-y-3">
              <h2 className="text-sm font-semibold break-words">{run.prompt}</h2>
              <p className="task-muted">
                {run.projectName} · {new Date(run.startedAt).toLocaleString()}
              </p>
              <ValidationJourney steps={run.validationSteps ?? []} screenshots={run.screenshots} />
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
