import { DropdownMenu as Menu } from '@jackalope/ui';
import { ChevronRight, Ellipsis, Plus, Trash2, X } from 'lucide-react';
import { useMemo } from 'react';
import { collectWorkspaceWork, type WorkItem, workPresence } from '../../lib/task-collection';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { type Project, useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { useChangeStats, useWorkSignalsStore } from '../../stores/workSignalsStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { AgentStack } from '../agents/AgentAvatar';
import { isUnread, useOpenSignalKey, useWorkSignals, WorkSignals } from '../tasks/WorkSignals';
import { Tooltip } from '../ui/Tooltip';
import { type ActiveTab, viewLabel, WORKSPACE_VIEWS } from './navigation';

/** Finished rows shown per project before the rest are left to the Work page. */
const RECENT_PER_PROJECT = 3;

/** Why a row needs you, when its status alone would only say "Needs attention". */
function attentionReason(item: WorkItem): string | undefined {
  const run = item.run;
  if (run?.prompts?.some((prompt) => prompt.status === 'pending')) return 'Question waiting';
  if (run?.persistenceError) return 'History needs saving';
  if (run?.verificationError || run?.verification?.result.success === false) return 'Check failed';
  const error = item.session?.error || run?.error;
  if (error) return `Failed · ${error.split('\n')[0]}`;
  if (run?.status === 'stopped') return 'Stopped before finishing';
  if (run?.status === 'interrupted') return 'Interrupted';
  return undefined;
}

/** What a closed row must change from to come back: its stage, activity or open questions. */
function closedState(item: WorkItem) {
  const questions = item.run?.prompts?.filter((prompt) => prompt.status === 'pending').length;
  return [item.stage, item.date, item.run?.id, item.run?.status, questions].join('|');
}

function workProjectId(item: WorkItem) {
  return (
    item.run?.projectId ??
    item.session?.request.projectId ??
    item.managed?.request.projectId ??
    item.idea?.projectId
  );
}

const STAGE_ORDER: Record<string, number> = { attention: 0, review: 0, working: 1, finished: 2 };

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

/** Opens a work item in the main view, switching to its project. */
export function selectWorkItem(item: WorkItem) {
  useExecutionStore
    .getState()
    .select(item.run && !item.session && !item.managed ? item.run.id : null);
  useLiveSessionStore.getState().select(item.session?.id ?? null);
  useManagedTaskStore.getState().select(item.managed?.id ?? null);
  const projectId = workProjectId(item);
  if (projectId) useProjectStore.getState().selectProject(projectId);
}

/** Work started in the sidebar, grouped by project: what needs you, then running, then recent. */
function useProjectWork() {
  const work = useWorkspaceWork();
  const dismissed = useWorkSignalsStore((state) => state.dismissed);
  return useMemo(() => {
    const byProject = new Map<string, WorkItem[]>();
    for (const item of work) {
      if (!(item.run || item.session || item.managed)) continue;
      if (!(item.stage in STAGE_ORDER) || dismissed[item.id] === closedState(item)) continue;
      const projectId = workProjectId(item);
      if (!projectId) continue;
      byProject.set(projectId, [...(byProject.get(projectId) ?? []), item]);
    }
    for (const [projectId, items] of byProject) {
      const sorted = [...items].sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]);
      const live = sorted.filter((item) => item.stage !== 'finished');
      const recent = sorted.filter((item) => item.stage === 'finished');
      byProject.set(projectId, [...live, ...recent.slice(0, RECENT_PER_PROJECT)]);
    }
    return byProject;
  }, [work, dismissed]);
}

export function WorkSidebar({
  activeTab,
  onOpen,
  onOpenProject,
  onNewWork,
  onRemoveProject,
  onAddProject,
}: {
  activeTab: ActiveTab;
  onOpen: () => void;
  onOpenProject: (projectId: string, view: ActiveTab) => void;
  onNewWork: (projectId: string) => void;
  onRemoveProject: (project: Project) => void;
  onAddProject: () => void;
}) {
  const projects = useProjectStore((state) => state.projects);
  const activeProject = useProjectStore((state) => state.activeProjectId);
  const collapsed = useWorkViewStore((state) => state.collapsedProjects);
  const scope = useWorkViewStore((state) => state.scope);
  const byProject = useProjectWork();
  const selectedRun = useExecutionStore((state) => state.selectedId);
  const selectedSession = useLiveSessionStore((state) => state.selectedId);
  const selectedManaged = useManagedTaskStore((state) => state.selectedId);
  const signals = useWorkSignals();
  const openKey = useOpenSignalKey();
  const stats = useChangeStats(
    [...byProject.values()]
      .flat()
      .slice(0, 48)
      .map((item) => item.run),
  );
  const somethingOpen = Boolean(selectedRun || selectedSession || selectedManaged);
  const projectView = WORKSPACE_VIEWS.find((view) => view.id === activeTab)?.group === 'project';
  const projectViews = WORKSPACE_VIEWS.filter(
    (view) => view.group === 'project' && view.id !== 'swarm',
  );
  const open = (item: WorkItem) => {
    selectWorkItem(item);
    onOpen();
  };
  return (
    <nav className="project-tree" aria-label="Projects">
      <div className="project-tree-heading">
        <h2>Projects</h2>
        <Tooltip side="right" content="Add a project">
          <button
            type="button"
            className="project-tree-action"
            aria-label="Add a project"
            onClick={onAddProject}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
      {projects.map((project) => {
        const items = byProject.get(project.id) ?? [];
        const expanded = !collapsed[project.id];
        const attention = items.filter((item) =>
          ['attention', 'review'].includes(item.stage),
        ).length;
        const running = items.filter((item) => item.stage === 'working').length;
        // The project row is "where you are" when its page or its unfiltered work list is open.
        const current =
          project.id === activeProject &&
          (projectView || (activeTab === 'kanban' && !somethingOpen && scope === 'project'));
        const listId = `project-tree-${project.id}`;
        return (
          <section key={project.id} className="project-tree-group">
            <div
              className="project-tree-head"
              data-active={project.id === activeProject || undefined}
            >
              {items.length ? (
                <button
                  type="button"
                  className="project-tree-toggle"
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`}
                  aria-expanded={expanded}
                  aria-controls={expanded ? listId : undefined}
                  onClick={() => useWorkViewStore.getState().toggleProject(project.id)}
                >
                  <ChevronRight size={14} aria-hidden="true" className="project-tree-chevron" />
                </button>
              ) : (
                <span className="project-tree-toggle" aria-hidden="true" />
              )}
              <button
                type="button"
                className="project-tree-name"
                aria-current={current ? 'page' : undefined}
                onClick={() => onOpenProject(project.id, 'kanban')}
                title={project.path}
              >
                <span className="project-tree-mark" aria-hidden="true">
                  {project.name.trim().charAt(0).toUpperCase() || '?'}
                </span>
                <span className="project-tree-label">{project.name}</span>
                {!expanded && (attention > 0 || running > 0) && (
                  <span className="project-tree-counts">
                    {attention > 0 && (
                      <span className="project-tree-count" data-tone="attention">
                        {attention}
                        <span className="sr-only"> need you</span>
                      </span>
                    )}
                    {running > 0 && (
                      <span className="project-tree-count">
                        {running}
                        <span className="sr-only"> running</span>
                      </span>
                    )}
                  </span>
                )}
              </button>
              <span className="project-tree-head-actions">
                <Tooltip side="right" content={`New work in ${project.name}`}>
                  <button
                    type="button"
                    className="project-tree-action"
                    aria-label={`New work in ${project.name}`}
                    onClick={() => onNewWork(project.id)}
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
                </Tooltip>
                <Menu.Root>
                  <Menu.Trigger asChild>
                    <button
                      type="button"
                      className="project-tree-action"
                      aria-label={`${project.name} options`}
                    >
                      <Ellipsis size={14} aria-hidden="true" />
                    </button>
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Content
                      className="workspace-menu min-w-52"
                      side="right"
                      align="start"
                      collisionPadding={12}
                    >
                      {projectViews.map((view) => (
                        <Menu.Item
                          key={view.id}
                          className="workspace-menu-item"
                          onSelect={() => onOpenProject(project.id, view.id)}
                        >
                          <view.icon size={16} aria-hidden="true" />
                          {view.id === 'project-overview' ? 'Overview' : viewLabel(view.id)}
                        </Menu.Item>
                      ))}
                      <Menu.Separator className="menu-separator" />
                      <Menu.Item
                        className="workspace-menu-item"
                        onSelect={() => onRemoveProject(project)}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        Remove from Jackalope…
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Portal>
                </Menu.Root>
              </span>
            </div>
            {expanded && items.length > 0 && (
              <ul id={listId} className="project-tree-items">
                {items.map((item) => {
                  const presence = workPresence(item);
                  const selected = item.managed
                    ? item.managed.id === selectedManaged
                    : item.session
                      ? item.session.id === selectedSession
                      : item.run?.id === selectedRun;
                  const unread = isUnread(item, signals, openKey);
                  const needsYou = ['attention', 'review'].includes(item.stage);
                  const status =
                    (needsYou && item.statusLabel !== 'Ready to review'
                      ? attentionReason(item)
                      : undefined) ??
                    item.statusLabel ??
                    presence.action;
                  return (
                    <li key={item.id} className="work-sidebar-row">
                      <button
                        type="button"
                        aria-current={selected ? 'page' : undefined}
                        className="work-sidebar-item"
                        data-stage={item.stage}
                        data-unread={unread || undefined}
                        title={status ? `${item.title}\n${status}` : item.title}
                        onClick={() => open(item)}
                      >
                        <AgentStack agents={presence.agents} state={presence.state} size="xs" />
                        <span className="work-sidebar-title">
                          {item.title}
                          {status && <span className="sr-only">, {status}</span>}
                        </span>
                        <WorkSignals
                          item={item}
                          unread={unread}
                          stats={item.run ? stats[item.run.id]?.value : undefined}
                        />
                        {needsYou && (
                          <span
                            className="work-sidebar-state"
                            data-tone={item.stage === 'review' ? 'review' : 'attention'}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                      {item.stage !== 'working' && (
                        <Tooltip
                          side="right"
                          content="Close · it stays on the Work page and returns when it changes"
                        >
                          <button
                            type="button"
                            className="work-sidebar-close"
                            aria-label={`Close ${item.title}`}
                            onClick={(event) => {
                              // Keep keyboard focus in the tree once this row is gone.
                              const rows = [
                                ...(event.currentTarget
                                  .closest('nav')
                                  ?.querySelectorAll<HTMLElement>('.work-sidebar-item') ?? []),
                              ];
                              const row = event.currentTarget
                                .closest('.work-sidebar-row')
                                ?.querySelector<HTMLElement>('.work-sidebar-item');
                              const index = row ? rows.indexOf(row) : -1;
                              const next = rows[index + 1] ?? rows[index - 1];
                              useWorkSignalsStore.getState().dismiss(item.id, closedState(item));
                              next?.focus();
                            }}
                          >
                            <X size={13} aria-hidden="true" />
                          </button>
                        </Tooltip>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </nav>
  );
}

/** Projects as initials while the sidebar shows icons only. */
export function CollapsedProjects({
  onOpenProject,
}: {
  onOpenProject: (projectId: string, view: ActiveTab) => void;
}) {
  const projects = useProjectStore((state) => state.projects);
  const activeProject = useProjectStore((state) => state.activeProjectId);
  const byProject = useProjectWork();
  return (
    <nav className="project-rail" aria-label="Projects">
      {projects.map((project) => {
        const attention = (byProject.get(project.id) ?? []).filter((item) =>
          ['attention', 'review'].includes(item.stage),
        ).length;
        return (
          <Tooltip key={project.id} side="right" content={project.name}>
            <button
              type="button"
              className="project-rail-item"
              aria-label={attention ? `${project.name}, ${attention} need you` : project.name}
              data-active={project.id === activeProject || undefined}
              onClick={() => onOpenProject(project.id, 'kanban')}
            >
              <span className="project-tree-mark" aria-hidden="true">
                {project.name.trim().charAt(0).toUpperCase() || '?'}
              </span>
              {attention > 0 && <span className="project-rail-dot" aria-hidden="true" />}
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}

/** Work across every project that is waiting on the person, beside the Work link. */
export function NeedsYouCount() {
  const byProject = useProjectWork();
  const count = [...byProject.values()]
    .flat()
    .filter((item) => ['attention', 'review'].includes(item.stage)).length;
  if (!count) return null;
  return (
    <small className="workspace-nav-count">
      {count}
      <span className="sr-only"> need you</span>
    </small>
  );
}
