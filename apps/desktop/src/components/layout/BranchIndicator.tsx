import { Popover } from '@jackalope/ui';
import { GitBranch } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
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
import { selectWorkItem, useWorkspaceWork } from './WorkSidebar';

/**
 * The project, remote host and the work in focus: the selected task, plan or
 * conversation. The branch control and the changes count both follow it.
 */
export function useFocusedWork() {
  const host = useHostContextStore((state) => state.host);
  const runs = useExecutionStore((state) => state.runs);
  const selectedId = useExecutionStore((state) => state.selectedId);
  const {
    sessions,
    selectedId: selectedSession,
    runs: sessionRuns,
  } = useLiveSessionStore(
    useShallow((s) => ({ sessions: s.sessions, selectedId: s.selectedId, runs: s.runs })),
  );
  const { queue, selectedId: selectedManaged } = useManagedTaskStore(
    useShallow((s) => ({ queue: s.queue, selectedId: s.selectedId })),
  );
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

const MAX_SWITCH_TARGETS = 8;
const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, '') === b.replace(/[\\/]+$/, '');

/**
 * Checkouts the header can focus instead: the project folder and each task or
 * chat worktree that still exists. Switching changes focus, never `git checkout`.
 */
function useSwitchTargets(checkout: string) {
  const work = useWorkspaceWork();
  const project = useProjectStore((state) =>
    state.projects.find((item) => item.id === state.activeProjectId),
  );
  if (!project) return [];
  const existing = project.worktrees ?? [];
  const seen = new Set([checkout]);
  const targets: { key: string; branch: string; label: string; open: () => void }[] = [];
  if (!samePath(checkout, project.path)) {
    seen.add(project.path);
    targets.push({
      key: project.path,
      branch: project.plainFolder ? 'No Git' : project.gitBranch || 'Branch unknown',
      label: 'Project checkout',
      open: () => {
        useExecutionStore.getState().select(null);
        useLiveSessionStore.getState().select(null);
        useManagedTaskStore.getState().select(null);
      },
    });
  }
  for (const item of work) {
    const run = item.run;
    const path = run?.workspace?.trim();
    if (!run || !path || item.managed || run.projectId !== project.id) continue;
    if ([...seen].some((known) => samePath(known, path))) continue;
    // Before the worktree list loads, finished work is the likeliest to have been cleaned up.
    const present = existing.length
      ? existing.some((entry) => samePath(entry.path, path))
      : item.stage !== 'finished';
    if (!present) continue;
    seen.add(path);
    targets.push({
      key: path,
      branch: run.branch || 'Branch unknown',
      label: item.title,
      open: () => selectWorkItem(item),
    });
    if (targets.length >= MAX_SWITCH_TARGETS) break;
  }
  return targets;
}

/** The branch in focus, beside the project name, with where it lives and what to do with it. */
export function BranchIndicator() {
  const { host, project, run, managed, checkout } = useFocusedWork();
  const targets = useSwitchTargets(checkout);
  if (!project || host) return null;
  const branch = run
    ? run.branch ||
      (!run.workspace ? 'Preparing workspace' : project.plainFolder ? 'No Git' : 'Branch unknown')
    : managed
      ? 'Plan workspaces'
      : project.plainFolder
        ? 'No Git'
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
          {targets.length > 0 && (
            <section className="branch-switch" aria-labelledby="branch-switch-heading">
              <h2 id="branch-switch-heading">Switch to</h2>
              <ul>
                {targets.map((target) => (
                  <li key={target.key}>
                    <Popover.Close asChild>
                      <button
                        type="button"
                        className="branch-switch-item"
                        title={target.key}
                        onClick={() => {
                          target.open();
                          navigateWorkspace('kanban');
                        }}
                      >
                        <GitBranch size={14} aria-hidden="true" />
                        <span className="branch-switch-name">{target.branch}</span>
                        <span className="branch-switch-label">{target.label}</span>
                      </button>
                    </Popover.Close>
                  </li>
                ))}
              </ul>
            </section>
          )}
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
