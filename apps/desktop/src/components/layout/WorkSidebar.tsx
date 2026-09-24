import { useMemo } from 'react';
import { collectWorkspaceWork, type WorkItem, workPresence } from '../../lib/task-collection';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { AgentStack } from '../agents/AgentAvatar';

export function useWorkspaceWork() {
  const runs = useExecutionStore((state) => state.runs);
  const sessions = useLiveSessionStore((state) => state.sessions);
  const sessionRuns = useLiveSessionStore((state) => state.runs);
  const queue = useManagedTaskStore((state) => state.queue);
  const ideas = useTaskStore((state) => state.tasks);
  return useMemo(
    () =>
      collectWorkspaceWork(
        null,
        ideas,
        [...new Map([...runs, ...sessionRuns].map((run) => [run.id, run])).values()],
        sessions,
        queue.mergedRunIds,
        false,
        queue,
      ),
    [runs, sessions, sessionRuns, queue, ideas],
  );
}

export function WorkSidebar({ onOpen }: { onOpen: () => void }) {
  const work = useWorkspaceWork();
  const selectedRun = useExecutionStore((state) => state.selectedId);
  const selectedSession = useLiveSessionStore((state) => state.selectedId);
  const selectedManaged = useManagedTaskStore((state) => state.selectedId);
  const activeProject = useProjectStore((state) => state.activeProjectId);
  const scope = useWorkViewStore((state) => state.scope);
  const items = work.filter(
    (item) =>
      scope === 'all' ||
      (item.run?.projectId ??
        item.session?.request.projectId ??
        item.managed?.request.projectId ??
        item.idea?.projectId) === activeProject,
  );
  const open = (item: WorkItem) => {
    useExecutionStore
      .getState()
      .select(item.run && !item.session && !item.managed ? item.run.id : null);
    useLiveSessionStore.getState().select(item.session?.id ?? null);
    useManagedTaskStore.getState().select(item.managed?.id ?? null);
    const projectId =
      item.run?.projectId ?? item.session?.request.projectId ?? item.managed?.request.projectId;
    if (projectId) useProjectStore.getState().selectProject(projectId);
    onOpen();
  };
  return (
    <nav className="work-sidebar-list" aria-label="Recent work">
      {(['attention', 'working', 'finished'] as const).map((group) => {
        const members = items
          .filter(
            (item) =>
              (item.run || item.session || item.managed) &&
              (group === 'attention'
                ? ['attention', 'review'].includes(item.stage)
                : item.stage === group),
          )
          .slice(0, 12);
        return members.length ? (
          <section key={group}>
            <h2>
              {group === 'attention' ? 'Needs you' : group === 'working' ? 'In progress' : 'Recent'}
            </h2>
            {members.map((item) => {
              const presence = workPresence(item);
              const selected = item.managed
                ? item.managed.id === selectedManaged
                : item.session
                  ? item.session.id === selectedSession
                  : item.run?.id === selectedRun;
              return (
                <button
                  type="button"
                  key={item.id}
                  aria-current={selected ? 'page' : undefined}
                  className="work-sidebar-item"
                  onClick={() => open(item)}
                >
                  <AgentStack agents={presence.agents} state={presence.state} size="xs" />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.statusLabel ?? presence.action}</small>
                  </span>
                </button>
              );
            })}
          </section>
        ) : null;
      })}
    </nav>
  );
}
