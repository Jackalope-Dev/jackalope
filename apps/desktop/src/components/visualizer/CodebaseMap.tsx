import { FolderOpen } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';

const CodebaseExplorer = lazy(() => import('./CodebaseExplorer'));

export function CodebaseMap({ onOpenProject }: { onOpenProject: () => void }) {
  const { projects, activeProjectId } = useProjectStore();
  const project = projects.find((project) => project.id === activeProjectId);
  return (
    <section className="task-page">
      {project ? (
        <Suspense
          fallback={
            <p role="status" className="task-muted">
              Opening codebase…
            </p>
          }
        >
          <CodebaseExplorer key={`${project.id}:${project.path}`} project={project} />
        </Suspense>
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
