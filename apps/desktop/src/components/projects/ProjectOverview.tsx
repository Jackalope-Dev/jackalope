import { FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { queueSnapshot } from '../../lib/queue';
import { taskTitle } from '../../lib/task-title';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { navigateWorkspace } from '../layout/navigation';
import { ProjectReturn } from '../tasks/ProjectReturn';
import { WorkspaceReadiness } from '../tasks/WorkspaceReadiness';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { InlineNotice } from '../ui/InlineNotice';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
export function ProjectOverview({ onOpenProject }: { onOpenProject: () => void }) {
  const project = useProjectStore((state) =>
    state.projects.find((p) => p.id === state.activeProjectId),
  );
  const runs = useExecutionStore((state) => state.runs);
  const [integrated, setIntegrated] = useState<string[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    if (isTauriEnvironment())
      void queueSnapshot()
        .then((value) => {
          if (alive) setIntegrated(value.mergedRunIds);
        })
        .catch((cause) => {
          if (alive) setError(String(cause));
        });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <WorkspacePage>
      <WorkspaceHeading
        title={project?.name ?? 'Your project'}
        description={project?.description || project?.path}
        action={
          project && (
            <Button
              onClick={() => {
                useWorkViewStore.getState().setScope('project');
                useExecutionStore.getState().select(null);
                navigateWorkspace('kanban');
              }}
            >
              Open project work
            </Button>
          )
        }
      />
      {error && (
        <InlineNotice tone="error">Integration receipts could not be loaded. {error}</InlineNotice>
      )}
      {project ? (
        <div className="workspace-sections">
          <section className="workspace-stack">
            <h2>Pick up where you left off</h2>
            <ProjectReturn
              key={project.id}
              project={project}
              runs={runs}
              integratedIds={integrated}
              expanded
              onOpen={(id) => useWorkViewStore.getState().open(id)}
            />
            {!runs.some((run) => run.projectId === project.id) && (
              <p className="task-muted">
                Describe a small change, inspect the result and try it before integrating.
              </p>
            )}
          </section>
          <WorkspaceReadiness project={project} expanded />
          {runs.some((run) => run.projectId === project.id && integrated.includes(run.id)) && (
            <section className="workspace-stack">
              <h2>Recent local deliveries</h2>
              {runs
                .filter((run) => run.projectId === project.id && integrated.includes(run.id))
                .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
                .slice(0, 3)
                .map((run) => (
                  <div key={run.id} className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p>{taskTitle(run.prompt)}</p>
                      <p className="task-muted">
                        Integrated locally · publication and deployment not checked here
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => useWorkViewStore.getState().open(run.id, 'delivery')}
                    >
                      View delivery
                    </Button>
                  </div>
                ))}
            </section>
          )}
          <section className="workspace-stack">
            <h2>Project tools</h2>
            <div className="task-detail-utilities">
              <Button variant="outline" onClick={() => navigateWorkspace('project-knowledge')}>
                Workflows & context
              </Button>
              <Button variant="outline" onClick={() => navigateWorkspace('topology')}>
                Explore codebase
              </Button>
              <Button variant="outline" onClick={() => navigateWorkspace('worktrees')}>
                Workspaces
              </Button>
              <Button variant="outline" onClick={() => navigateWorkspace('project-settings')}>
                Project settings
              </Button>
              <Button variant="outline" onClick={() => navigateWorkspace('mcps')}>
                Connections
              </Button>
              <Button variant="outline" onClick={() => navigateWorkspace('usage')}>
                Usage
              </Button>
            </div>
          </section>
        </div>
      ) : (
        <EmptyState
          icon={FolderOpen}
          title="Start with a project"
          description="Open a local project or create a new one."
          action={<Button onClick={onOpenProject}>Add project</Button>}
        />
      )}
    </WorkspacePage>
  );
}
