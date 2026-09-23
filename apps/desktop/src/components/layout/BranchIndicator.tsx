import { Popover } from '@jackalope/ui';
import { GitBranch } from 'lucide-react';
import { sessionWork } from '../../lib/live-session';
import { managedTaskWork } from '../../lib/managed-task';
import { openChanges } from '../../stores/commitReviewStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useHostContextStore } from '../../stores/hostContextStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { navigateWorkspace } from './navigation';

/**
 * The project, remote host and the work in focus: the selected task, plan or
 * conversation. The branch control and the changes count both follow it.
 */
export function useFocusedWork() {
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
  /** Where that work's files are: its worktree, or the project folder. */
  const checkout = (run?.workspace || '').trim() || project?.path || '';
  return { host, project, run, managed, checkout };
}

/** The branch in focus, beside the project name, with where it lives and what to do with it. */
export function BranchIndicator() {
  const { host, project, run, managed, checkout } = useFocusedWork();
  if (!project || host) return null;
  const branch = run
    ? run.branch || (run.workspace ? 'Branch unknown' : 'Preparing workspace')
    : managed
      ? 'Plan workspaces'
      : project.gitBranch || 'Branch unknown';
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="chrome-branch" title={`Branch: ${branch}`}>
          <GitBranch size={14} aria-hidden="true" />
          <span className="chrome-branch-name">{branch}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="workspace-menu statusbar-details"
          side="bottom"
          align="start"
          sideOffset={8}
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
          <div className="flex flex-wrap gap-2">
            {!managed && (
              <Popover.Close asChild>
                <Button onClick={() => openChanges(checkout)}>Review changes</Button>
              </Popover.Close>
            )}
            <Popover.Close asChild>
              <Button variant="outline" onClick={() => navigateWorkspace('worktrees')}>
                Manage worktrees
              </Button>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
