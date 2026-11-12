import { ContextMenu, DropdownMenu as Menu, Tooltip } from '@jackalope/ui';
import { ChevronRight, Copy, Ellipsis, Plus, Smile, Trash2, X } from 'lucide-react';
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type ReactNode,
  useMemo,
  useState,
} from 'react';
import { type ActiveTab, groupViews, viewLabel, workspaceView } from '../../lib/navigation';
import { type WorkItem, workPresence } from '../../lib/task-collection';
import {
  openExternalSession,
  openWork,
  useWorkspaceWork,
  workProjectId,
} from '../../lib/work-selection';
import { useExecutionStore } from '../../stores/executionStore';
import { useExternalSessionStore } from '../../stores/externalSessionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { type Project, useProjectStore } from '../../stores/projectStore';
import { useChangeStats, useWorkSignalsStore } from '../../stores/workSignalsStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { LatestAgent } from '../agents/AgentAvatar';
import { ProjectIconDialog, ProjectMark } from '../projects/ProjectMark';
import {
  changeSummary,
  isUnread,
  useOpenSignalKey,
  useWorkSignals,
  WorkSignals,
} from '../tasks/WorkSignals';
import { ExternalSessionRows } from './ExternalSessionRows';

/** A project's conversations from outside Jackalope, newest first. */
function useExternalByProject() {
  const sessions = useExternalSessionStore((state) => state.sessions);
  return useMemo(() => {
    const byProject = new Map<string, typeof sessions>();
    for (const session of sessions)
      byProject.set(session.projectId, [...(byProject.get(session.projectId) ?? []), session]);
    return byProject;
  }, [sessions]);
}

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

const STAGE_ORDER: Record<string, number> = { attention: 0, review: 0, working: 1, finished: 2 };

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

type ProjectActions = {
  onOpenProject: (projectId: string, view: ActiveTab) => void;
  onNewWork: (projectId: string) => void;
  onRemoveProject: (project: Project) => void;
  onCopyPath: (project: Project) => void;
};

const projectViews = groupViews('project');

/**
 * A project's actions, shared by its options button and its right-click menu so both
 * offer the same list. `menu` is the DropdownMenu or ContextMenu namespace.
 */
function ProjectMenuItems({
  menu: M,
  project,
  onSetIcon,
  onOpenProject,
  onNewWork,
  onRemoveProject,
  onCopyPath,
}: ProjectActions & {
  menu: typeof Menu | typeof ContextMenu;
  project: Project;
  onSetIcon: (project: Project) => void;
}) {
  return (
    <>
      <M.Item className="workspace-menu-item" onSelect={() => onNewWork(project.id)}>
        <Plus size={16} aria-hidden="true" />
        New work
      </M.Item>
      <M.Separator className="menu-separator" />
      {projectViews.map((view) => (
        <M.Item
          key={view.id}
          className="workspace-menu-item"
          onSelect={() => onOpenProject(project.id, view.id)}
        >
          <view.icon size={16} aria-hidden="true" />
          {viewLabel(view.id)}
        </M.Item>
      ))}
      <M.Separator className="menu-separator" />
      <M.Item className="workspace-menu-item" onSelect={() => onSetIcon(project)}>
        <Smile size={16} aria-hidden="true" />
        Set icon…
      </M.Item>
      <M.Item className="workspace-menu-item" onSelect={() => onCopyPath(project)}>
        <Copy size={16} aria-hidden="true" />
        Copy path
      </M.Item>
      <M.Separator className="menu-separator" />
      <M.Item className="workspace-menu-item" onSelect={() => onRemoveProject(project)}>
        <Trash2 size={16} aria-hidden="true" />
        Remove from Jackalope…
      </M.Item>
    </>
  );
}

/**
 * Right-clicking a project row opens its actions at the pointer. Other props and the ref
 * reach the trigger, so an outer Tooltip trigger can wrap it.
 */
const ProjectContextMenu = forwardRef<
  HTMLElement,
  ProjectActions &
    Omit<ComponentPropsWithoutRef<typeof ContextMenu.Trigger>, 'children'> & {
      project: Project;
      onSetIcon: (project: Project) => void;
      children: ReactNode;
    }
>(
  (
    {
      children,
      project,
      onSetIcon,
      onOpenProject,
      onNewWork,
      onRemoveProject,
      onCopyPath,
      ...trigger
    },
    ref,
  ) => (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild ref={ref} {...trigger}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="workspace-menu min-w-52">
          <ProjectMenuItems
            menu={ContextMenu}
            project={project}
            onSetIcon={onSetIcon}
            onOpenProject={onOpenProject}
            onNewWork={onNewWork}
            onRemoveProject={onRemoveProject}
            onCopyPath={onCopyPath}
          />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  ),
);
ProjectContextMenu.displayName = 'ProjectContextMenu';

export function WorkSidebar({
  activeTab,
  onOpen,
  onAddProject,
  ...actions
}: ProjectActions & {
  activeTab: ActiveTab;
  onOpen: () => void;
  onAddProject: () => void;
}) {
  const [iconFor, setIconFor] = useState<Project | null>(null);
  const projects = useProjectStore((state) => state.projects);
  const activeProject = useProjectStore((state) => state.activeProjectId);
  const collapsed = useWorkViewStore((state) => state.collapsedProjects);
  const scope = useWorkViewStore((state) => state.scope);
  const byProject = useProjectWork();
  const selectedRun = useExecutionStore((state) => state.selectedId);
  const selectedSession = useLiveSessionStore((state) => state.selectedId);
  const selectedManaged = useManagedTaskStore((state) => state.selectedId);
  const selectedExternal = useExternalSessionStore((state) => state.selectedKey);
  const external = useExternalByProject();
  const signals = useWorkSignals();
  const openKey = useOpenSignalKey();
  const stats = useChangeStats(
    [...byProject.values()]
      .flat()
      .slice(0, 48)
      .map((item) => item.run),
  );
  const somethingOpen = Boolean(
    selectedRun || selectedSession || selectedManaged || selectedExternal,
  );
  const projectView = workspaceView(activeTab).group === 'project';
  const open = (item: WorkItem) => {
    openWork(item);
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
        const outside = external.get(project.id) ?? [];
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
            <ProjectContextMenu project={project} onSetIcon={setIconFor} {...actions}>
              <div
                className="project-tree-head"
                data-active={project.id === activeProject || undefined}
              >
                {items.length || outside.length ? (
                  <button
                    type="button"
                    className="project-tree-toggle"
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`}
                    aria-expanded={expanded}
                    aria-controls={expanded && items.length ? listId : undefined}
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
                  onClick={() => actions.onOpenProject(project.id, 'kanban')}
                  title={project.path}
                >
                  <ProjectMark project={project} />
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
                      onClick={() => actions.onNewWork(project.id)}
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
                        <ProjectMenuItems
                          menu={Menu}
                          project={project}
                          onSetIcon={setIconFor}
                          {...actions}
                        />
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu.Root>
                </span>
              </div>
            </ProjectContextMenu>
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
                  const change = item.run ? stats[item.run.id]?.value : undefined;
                  const tooltip = [item.title, status, change?.files ? changeSummary(change) : '']
                    .filter(Boolean)
                    .join('\n');
                  return (
                    <li key={item.id} className="work-sidebar-row">
                      <button
                        type="button"
                        aria-current={selected ? 'page' : undefined}
                        className="work-sidebar-item"
                        data-stage={item.stage}
                        data-unread={unread || undefined}
                        title={tooltip}
                        onClick={() => open(item)}
                      >
                        <LatestAgent agents={presence.agents} state={presence.state} size="xs" />
                        <span className="work-sidebar-title">
                          {item.title}
                          {status && <span className="sr-only">, {status}</span>}
                        </span>
                        <WorkSignals item={item} unread={unread} stats={change} compact />
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
            {expanded && (
              <ExternalSessionRows
                sessions={outside}
                selectedKey={selectedExternal}
                onOpen={(session) => {
                  openExternalSession(session.key, session.projectId);
                  onOpen();
                }}
              />
            )}
          </section>
        );
      })}
      <ProjectIconDialog project={iconFor} onOpenChange={(next) => !next && setIconFor(null)} />
    </nav>
  );
}

/** Projects as initials while the sidebar shows icons only. */
export function CollapsedProjects(actions: ProjectActions) {
  const { onOpenProject } = actions;
  const [iconFor, setIconFor] = useState<Project | null>(null);
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
            <ProjectContextMenu project={project} onSetIcon={setIconFor} {...actions}>
              <button
                type="button"
                className="project-rail-item"
                aria-label={attention ? `${project.name}, ${attention} need you` : project.name}
                data-active={project.id === activeProject || undefined}
                onClick={() => onOpenProject(project.id, 'kanban')}
              >
                <ProjectMark project={project} />
                {attention > 0 && <span className="project-rail-dot" aria-hidden="true" />}
              </button>
            </ProjectContextMenu>
          </Tooltip>
        );
      })}
      <ProjectIconDialog project={iconFor} onOpenChange={(next) => !next && setIconFor(null)} />
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
