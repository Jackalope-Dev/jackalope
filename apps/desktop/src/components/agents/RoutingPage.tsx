import { SegmentedControl } from '@jackalope/ui';
import { useShallow } from 'zustand/react/shallow';
import { useAgentScopeStore } from '../../stores/agentScopeStore';
import { useActiveProject } from '../../stores/projectStore';
import { RoutingPreferences } from '../settings/RoutingSetup';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';

/**
 * Agents → Routing (formerly Settings → Decisions). It shares the Agents page's scope, so a
 * project's routing override is edited here for the active project.
 */
export function RoutingPage() {
  const project = useActiveProject();
  const { scope, setScope } = useAgentScopeStore(
    useShallow((s) => ({ scope: s.scope, setScope: s.setScope })),
  );
  const projectId = scope === 'project' ? project?.id : undefined;
  return (
    <WorkspacePage className="routing-page">
      <WorkspaceHeading
        title="Routing"
        description="How Jackalope picks an agent and model for each task."
      />
      {project && (
        <SegmentedControl
          label="Apply routing to"
          value={scope}
          onChange={(value) => setScope(value as 'project' | 'app')}
          items={[
            { id: 'project', label: project.name },
            { id: 'app', label: 'All projects' },
          ]}
        />
      )}
      <RoutingPreferences key={projectId ?? 'app'} projectId={projectId} />
    </WorkspacePage>
  );
}
