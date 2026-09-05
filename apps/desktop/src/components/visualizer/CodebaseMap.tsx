import { Network } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';

export function CodebaseMap() {
  return (
    <section className="task-page">
      <WorkspaceHeading
        title="Codebase"
        description="Explore your project's modules and dependencies."
      />
      <EmptyState
        icon={Network}
        title="Codebase mapping is not available yet"
        description="A map will appear here when repository analysis can provide module relationships."
      />
    </section>
  );
}
