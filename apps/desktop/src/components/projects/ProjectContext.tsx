import { useProjectStore } from '../../stores/projectStore';
import { KnowledgeLibrary } from '../knowledge/KnowledgeLibrary';
import { CodebaseMemoryBar } from '../tasks/CodebaseMemoryBar';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';

export function ProjectContext() {
  const project = useProjectStore((state) =>
    state.projects.find((item) => item.id === state.activeProjectId),
  );
  return (
    <WorkspacePage className="project-context-page">
      <WorkspaceHeading title="Project context" description={project?.name} />
      {project ? (
        <>
          <CodebaseMemoryBar project={project} />
          <KnowledgeLibrary project={project} />
        </>
      ) : (
        <p className="task-muted">Choose a project to read its context and saved knowledge.</p>
      )}
    </WorkspacePage>
  );
}
