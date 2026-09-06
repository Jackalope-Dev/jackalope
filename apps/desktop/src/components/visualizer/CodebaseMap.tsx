import { FolderOpen, Network } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { CodebaseMemoryBar } from '../tasks/CodebaseMemoryBar';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';

export function CodebaseMap({ onOpenProject }: { onOpenProject: () => void }) {
  const { projects, activeProjectId } = useProjectStore();
  const project = projects.find((project) => project.id === activeProjectId);
  return (
    <section className="task-page">
      <WorkspaceHeading
        title="Codebase"
        description="Review the instructions, commands and planned work found in your repository."
      />
      {project ? (
        <>
          <CodebaseMemoryBar key={project.id} project={project} initiallyExpanded />
          <div className="supporting-details flex items-start gap-3">
            <Network size={20} className="shrink-0 mt-1" />
            <p>
              Module and dependency mapping is not available yet. Repository context above comes
              from local project files.
            </p>
          </div>
        </>
      ) : (
        <EmptyState
          icon={FolderOpen}
          title="Choose a project"
          description="Open a repository to inspect its context."
          action={<Button onClick={onOpenProject}>Open project</Button>}
        />
      )}
    </section>
  );
}
