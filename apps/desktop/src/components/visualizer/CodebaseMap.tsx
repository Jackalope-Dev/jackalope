import { FolderOpen } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';

const CodebaseExplorer = lazy(() => import('./CodebaseExplorer'));

export function CodebaseMap({ onOpenProject }: { onOpenProject: () => void }) {
  const { projects, activeProjectId } = useProjectStore();
  const project = projects.find((project) => project.id === activeProjectId);
  return (
    <WorkspacePage>
      {project ? (
        <Suspense
          fallback={
            <>
              <WorkspaceHeading title="Codebase" />
              <LoadingState label="Opening codebase…" />
            </>
          }
        >
          <CodebaseExplorer key={`${project.id}:${project.path}`} project={project} />
        </Suspense>
      ) : (
        <>
          <WorkspaceHeading title="Codebase" />
          <EmptyState
            icon={FolderOpen}
            title="Choose a project"
            description="Open a repository to inspect its context."
            action={<Button onClick={onOpenProject}>Open project</Button>}
          />
        </>
      )}
    </WorkspacePage>
  );
}
