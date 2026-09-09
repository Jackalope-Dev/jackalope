import { FileCheck2 } from 'lucide-react';
import { taskTitle } from '../../lib/task-title';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { ValidationJourney } from '../tasks/ValidationJourney';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';

export function BrowserHarness({
  onOpenProject,
  onTask,
}: {
  onOpenProject: () => void;
  onTask: (id: string) => void;
}) {
  const runs = useExecutionStore((state) => state.runs);
  const loading = useExecutionStore((state) => state.loading);
  const error = useExecutionStore((state) => state.error);
  const refresh = useExecutionStore((state) => state.refresh);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const evidenceRuns = runs.filter(
    (run) =>
      run.projectId === activeProjectId &&
      ((run.screenshots?.length ?? 0) > 0 || (run.validationSteps?.length ?? 0) > 0),
  );
  return (
    <section className="task-page">
      <div className="task-home">
        <WorkspaceHeading
          title="Evidence"
          description="Screenshots and check results saved by tasks in this project. Open a task for the full context."
        />
        {error && (
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <p role="alert" className="task-error">
              Could not refresh task evidence: {error}
            </p>
            <Button variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        )}
        {loading ? (
          <LoadingState label={'Loading task evidence…'} />
        ) : evidenceRuns.length === 0 && !error ? (
          <EmptyState
            icon={FileCheck2}
            title="No evidence yet"
            description={
              activeProjectId
                ? 'Run a task from Tasks and ask the agent to record checks or capture screenshots. Saved evidence will appear here.'
                : 'Open a project to review its task evidence.'
            }
            action={
              !activeProjectId ? <Button onClick={onOpenProject}>Open project</Button> : undefined
            }
          />
        ) : (
          <div className="space-y-6">
            {evidenceRuns.map((run) => (
              <section key={run.id} className="space-y-4">
                <header className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-medium [overflow-wrap:anywhere]">
                      {taskTitle(run.prompt)}
                    </h2>
                    <p className="task-muted text-xs mt-1 [overflow-wrap:anywhere]">
                      {run.projectName} · {new Date(run.startedAt).toLocaleString()}
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => onTask(run.id)}>
                    View task
                  </Button>
                </header>
                <ValidationJourney
                  runId={run.id}
                  steps={run.validationSteps ?? []}
                  screenshots={run.screenshots}
                />
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
