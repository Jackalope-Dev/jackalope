import { Popover } from '@jackalope/ui';
import { GitBranch, ListTodo, Monitor } from 'lucide-react';

import { sessionWork } from '../../lib/live-session';
import { managedTaskWork } from '../../lib/managed-task';
import { isActive } from '../../lib/task-runtime';

import { useExecutionStore } from '../../stores/executionStore';
import { useHostContextStore } from '../../stores/hostContextStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { useProjectStore } from '../../stores/projectStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { Companion } from '../mascot/Companion';

import { Button } from '../ui/button';
import { navigateWorkspace } from './navigation';
import { StatusBarUsage } from './StatusBarUsage';
import { useWorkspaceWork } from './WorkSidebar';

export function WorkspaceStatusBar({
  onSearch,
  onSettings,
}: {
  onSearch: () => void;
  onSettings: () => void;
}) {
  const host = useHostContextStore((state) => state.host);
  const runs = useExecutionStore((state) => state.runs);
  const selectedId = useExecutionStore((state) => state.selectedId);
  const { sessions, selectedId: selectedSession, runs: sessionRuns } = useLiveSessionStore();
  const { queue, selectedId: selectedManaged } = useManagedTaskStore();
  const project = useProjectStore((state) =>
    state.projects.find((item) => item.id === state.activeProjectId),
  );
  const session = sessions.find(
    (item) => item.id === selectedSession && item.request.projectId === project?.id,
  );
  const managed = queue.managedTasks?.find(
    (item) => item.id === selectedManaged && item.request.projectId === project?.id,
  );
  const run =
    runs.find((item) => item.id === selectedId && item.projectId === project?.id) ??
    (managed ? managedTaskWork(managed, queue, runs).combined : undefined) ??
    (session ? sessionWork(session, sessionRuns).latest : undefined);
  const items = useWorkspaceWork();
  const attention = items.filter((item) => ['attention', 'review'].includes(item.stage)).length;
  const active = [
    ...new Map([...runs, ...sessionRuns].map((item) => [item.id, item])).values(),
  ].filter(isActive).length;
  const activity = () => {
    useExecutionStore.getState().select(null);
    useLiveSessionStore.getState().select(null);
    useManagedTaskStore.getState().select(null);
    useWorkViewStore.getState().openList(attention ? 'attention' : 'working');
    navigateWorkspace('kanban');
  };
  return (
    <section className="workspace-statusbar" aria-label="Workspace status">
      <button type="button" onClick={() => navigateWorkspace('remote-hosts')}>
        <Monitor size={15} />
        {host ? `${host.wsl ? 'WSL · ' : ''}${host.name}` : 'This computer'}
      </button>
      {project && !host && (
        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button">
              <GitBranch size={15} />
              <span className="statusbar-branch">
                {run
                  ? run.branch || (run.workspace ? 'Branch unknown' : 'Preparing workspace')
                  : managed
                    ? 'Plan workspaces'
                    : project.gitBranch || 'Branch unknown'}
              </span>
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="workspace-menu statusbar-details"
              side="top"
              align="start"
              collisionPadding={12}
            >
              <strong>
                {run ? 'Task workspace' : managed ? 'Plan workspaces' : 'Project checkout'}
              </strong>
              <p className="work-context-path">
                {run
                  ? run.workspace || 'Workspace is being prepared.'
                  : managed
                    ? 'Assignments use separate workspaces. Select an assignment to inspect its branch.'
                    : project.path}
              </p>
              <Button variant="outline" onClick={() => navigateWorkspace('worktrees')}>
                Manage worktrees
              </Button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      <button type="button" onClick={activity}>
        <ListTodo size={15} />
        {host ? 'This computer: ' : ''}
        {active} running{attention ? ` · ${attention} needs you` : ''}
      </button>
      <StatusBarUsage remote={Boolean(host)} />
      <Companion compact onSearch={onSearch} onSettings={onSettings} />
    </section>
  );
}
