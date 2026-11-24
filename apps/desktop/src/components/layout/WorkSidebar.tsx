import { ContextMenu, DropdownMenu as Menu, Tooltip } from '@jackalope/ui';
import {
  ChevronRight,
  Code2,
  Copy,
  Ellipsis,
  Folder,
  FolderInput,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  Palette,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Smile,
  Star,
  StarOff,
  Trash2,
  X,
} from 'lucide-react';
import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type FocusEvent,
  forwardRef,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import { openProjectSettings } from '../../lib/app-events';
import { type Editor, editorName } from '../../lib/editor';
import { fileManagerName } from '../../lib/native/env';
import { type ActiveTab, workspaceView } from '../../lib/navigation';
import { projectNameHints } from '../../lib/project-name-hints';
import { attentionReason, type WorkItem, workPresence } from '../../lib/task-collection';
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
import { GENERAL_PROJECT_ID, type Project, useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { type SidebarFolder, useSidebarStore } from '../../stores/sidebarStore';
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
import './work-sidebar.css';

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

/** What a closed row must change from to come back: its stage, activity or open questions. */
function closedState(item: WorkItem) {
  const questions = item.run?.prompts?.filter((prompt) => prompt.status === 'pending').length;
  return [item.stage, item.date, item.run?.id, item.run?.status, questions].join('|');
}

const STAGE_ORDER: Record<string, number> = {
  attention: 0,
  review: 0,
  working: 1,
  inReview: 1,
  finished: 2,
};

/** Work started in the sidebar, grouped by project: what needs you, then running, then recent. */
export function useProjectWork() {
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

/** A new folder in the project, opened for naming; `workId` moves that work into it. */
function newFolder(projectId: string, workId?: string) {
  const store = useSidebarStore.getState();
  const id = store.addFolder(projectId, 'New folder');
  if (workId) store.place(workId, id);
  const view = useWorkViewStore.getState();
  if (view.collapsedProjects[projectId]) view.toggleProject(projectId);
  store.setRenaming(id);
}

/** A closing menu returns focus to its trigger, which would end a rename it just started. */
function keepRenameFocus(event: Event) {
  if (useSidebarStore.getState().renaming) event.preventDefault();
}

type ProjectActions = {
  onOpenProject: (projectId: string, view: ActiveTab) => void;
  onNewWork: (projectId: string) => void;
  onRemoveProject: (project: Project) => void;
  onCopyPath: (project: Project) => void;
  onRevealPath: (project: Project) => void;
  onOpenInEditor: (project: Project, editor: Editor) => void;
};

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
  onRevealPath,
  onOpenInEditor,
}: ProjectActions & {
  menu: typeof Menu | typeof ContextMenu;
  project: Project;
  onSetIcon: (project: Project) => void;
}) {
  const editor = useSettingsStore((state) => state.preferredEditor);
  const favorite = useSidebarStore((state) => state.favorites.includes(`project:${project.id}`));
  return (
    <>
      <M.Item className="workspace-menu-item" onSelect={() => onNewWork(project.id)}>
        <Plus size={16} aria-hidden="true" />
        New work
      </M.Item>
      <M.Separator className="menu-separator" />
      {/* The project's other views are its page's own subnavigation. */}
      <M.Item
        className="workspace-menu-item"
        onSelect={() => onOpenProject(project.id, 'project-overview')}
      >
        <LayoutGrid size={16} aria-hidden="true" />
        Open project
      </M.Item>
      <M.Item className="workspace-menu-item" onSelect={() => onOpenInEditor(project, editor)}>
        <Code2 size={16} aria-hidden="true" />
        Open in {editorName(editor)}
      </M.Item>
      <M.Item className="workspace-menu-item" onSelect={() => onRevealPath(project)}>
        <FolderOpen size={16} aria-hidden="true" />
        Reveal in {fileManagerName()}
      </M.Item>
      <M.Separator className="menu-separator" />
      <M.Item
        className="workspace-menu-item"
        onSelect={() => useSidebarStore.getState().toggleFavorite(`project:${project.id}`)}
      >
        {favorite ? (
          <StarOff size={16} aria-hidden="true" />
        ) : (
          <Star size={16} aria-hidden="true" />
        )}
        {favorite ? 'Remove from favorites' : 'Add to favorites'}
      </M.Item>
      <M.Item className="workspace-menu-item" onSelect={() => newFolder(project.id)}>
        <FolderPlus size={16} aria-hidden="true" />
        New folder
      </M.Item>
      <M.Item className="workspace-menu-item" onSelect={() => onSetIcon(project)}>
        <Smile size={16} aria-hidden="true" />
        Set icon…
      </M.Item>
      <M.Item
        className="workspace-menu-item"
        onSelect={() => openProjectSettings(project.id, 'Appearance')}
      >
        <Palette size={16} aria-hidden="true" />
        Appearance…
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
      onRevealPath,
      onOpenInEditor,
      ...trigger
    },
    ref,
  ) => (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild ref={ref} {...trigger}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="workspace-menu min-w-52" onCloseAutoFocus={keepRenameFocus}>
          <ProjectMenuItems
            menu={ContextMenu}
            project={project}
            onSetIcon={onSetIcon}
            onOpenProject={onOpenProject}
            onNewWork={onNewWork}
            onRemoveProject={onRemoveProject}
            onCopyPath={onCopyPath}
            onRevealPath={onRevealPath}
            onOpenInEditor={onOpenInEditor}
          />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  ),
);
ProjectContextMenu.displayName = 'ProjectContextMenu';

/** What every work row in the tree reads, computed once for the whole sidebar. */
type RowContext = {
  signals: ReturnType<typeof useWorkSignals>;
  openKey: ReturnType<typeof useOpenSignalKey>;
  stats: ReturnType<typeof useChangeStats>;
  selected: (item: WorkItem) => boolean;
  open: (item: WorkItem) => void;
};

/** A work row's actions, shared by its options button and its right-click menu. */
function WorkMenuItems({
  menu: M,
  item,
  folders,
}: {
  menu: typeof Menu | typeof ContextMenu;
  item: WorkItem;
  folders: SidebarFolder[];
}) {
  const { pinned, favorite, folder } = useSidebarStore(
    useShallow((state) => ({
      pinned: state.pinnedWork.includes(item.id),
      favorite: state.favorites.includes(`work:${item.id}`),
      folder: state.placement[item.id],
    })),
  );
  const store = useSidebarStore.getState;
  const projectId = workProjectId(item);
  return (
    <>
      <M.Item className="workspace-menu-item" onSelect={() => store().togglePinnedWork(item.id)}>
        {pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}
        {pinned ? 'Unpin' : 'Pin'}
      </M.Item>
      <M.Item
        className="workspace-menu-item"
        onSelect={() => store().toggleFavorite(`work:${item.id}`)}
      >
        {favorite ? (
          <StarOff size={16} aria-hidden="true" />
        ) : (
          <Star size={16} aria-hidden="true" />
        )}
        {favorite ? 'Remove from favorites' : 'Add to favorites'}
      </M.Item>
      {projectId && (
        <>
          <M.Separator className="menu-separator" />
          {folders
            .filter((candidate) => candidate.id !== folder)
            .map((candidate) => (
              <M.Item
                key={candidate.id}
                className="workspace-menu-item"
                onSelect={() => store().place(item.id, candidate.id)}
              >
                <FolderInput size={16} aria-hidden="true" />
                <span className="work-sidebar-menu-label">Move to {candidate.name}</span>
              </M.Item>
            ))}
          {folder && folders.some((candidate) => candidate.id === folder) && (
            <M.Item className="workspace-menu-item" onSelect={() => store().place(item.id, null)}>
              <FolderMinus size={16} aria-hidden="true" />
              Remove from folder
            </M.Item>
          )}
          <M.Item className="workspace-menu-item" onSelect={() => newFolder(projectId, item.id)}>
            <FolderPlus size={16} aria-hidden="true" />
            Move to new folder
          </M.Item>
        </>
      )}
    </>
  );
}

/** Opens `children`'s menu at the pointer on right-click; the ref reaches the trigger so a Tooltip can wrap it. */
const RowContextMenu = forwardRef<
  HTMLElement,
  Omit<ComponentPropsWithoutRef<typeof ContextMenu.Trigger>, 'children' | 'content'> & {
    content: ReactNode;
    children: ReactNode;
  }
>(({ content, children, ...trigger }, ref) => (
  <ContextMenu.Root>
    <ContextMenu.Trigger asChild ref={ref} {...trigger}>
      {children}
    </ContextMenu.Trigger>
    <ContextMenu.Portal>
      <ContextMenu.Content className="workspace-menu min-w-52" onCloseAutoFocus={keepRenameFocus}>
        {content}
      </ContextMenu.Content>
    </ContextMenu.Portal>
  </ContextMenu.Root>
));
RowContextMenu.displayName = 'RowContextMenu';

/** The options button that appears beside a row on hover or focus. */
function RowOptions({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button type="button" className="work-sidebar-options" aria-label={label}>
          <Ellipsis size={14} aria-hidden="true" />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="workspace-menu min-w-52"
          side="right"
          align="start"
          collisionPadding={12}
          onCloseAutoFocus={keepRenameFocus}
        >
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * One piece of work in the tree. Pinned rows and rows in folders always show, so only the
 * rest can be closed.
 */
function WorkRow({
  item,
  row,
  folders,
  pinned,
  closable,
}: {
  item: WorkItem;
  row: RowContext;
  folders: SidebarFolder[];
  pinned?: boolean;
  closable?: boolean;
}) {
  const presence = workPresence(item);
  const selected = row.selected(item);
  const unread = isUnread(item, row.signals, row.openKey);
  const needsYou = ['attention', 'review'].includes(item.stage);
  const status =
    (needsYou && item.statusLabel !== 'Ready to review' ? attentionReason(item) : undefined) ??
    item.statusLabel ??
    presence.action;
  const change = item.run ? row.stats[item.run.id]?.value : undefined;
  const tooltip = [item.title, status, change?.files ? changeSummary(change) : '']
    .filter(Boolean)
    .join('\n');
  const close = closable && item.stage !== 'working';
  return (
    <li className="work-sidebar-row" data-actions={close ? 2 : 1}>
      <RowContextMenu content={<WorkMenuItems menu={ContextMenu} item={item} folders={folders} />}>
        <button
          type="button"
          aria-current={selected ? 'page' : undefined}
          className="work-sidebar-item"
          data-stage={item.stage}
          data-unread={unread || undefined}
          data-pinned={pinned || undefined}
          title={tooltip}
          onClick={() => row.open(item)}
        >
          <LatestAgent agents={presence.agents} state={presence.state} size="xs" />
          <span className="work-sidebar-title">
            {item.title}
            {status && <span className="sr-only">, {status}</span>}
            {pinned && <span className="sr-only">, pinned</span>}
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
      </RowContextMenu>
      <span className="work-sidebar-actions">
        <RowOptions label={`${item.title} options`}>
          <WorkMenuItems menu={Menu} item={item} folders={folders} />
        </RowOptions>
        {close && (
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
                const current = event.currentTarget
                  .closest('.work-sidebar-row')
                  ?.querySelector<HTMLElement>('.work-sidebar-item');
                const index = current ? rows.indexOf(current) : -1;
                const next = rows[index + 1] ?? rows[index - 1];
                useWorkSignalsStore.getState().dismiss(item.id, closedState(item));
                next?.focus();
              }}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </Tooltip>
        )}
      </span>
    </li>
  );
}

/** Edits a folder's name in place: Enter or leaving the field saves, Escape cancels. */
function FolderName({ projectId, folder }: { projectId: string; folder: SidebarFolder }) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    // After the menu that started the rename has closed.
    const frame = requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = input.current?.value.trim();
    const store = useSidebarStore.getState();
    if (save && name) store.renameFolder(projectId, folder.id, name);
    store.setRenaming(null);
  };
  return (
    <span className="work-sidebar-item work-sidebar-folder-head" data-editing>
      <FolderOpen size={15} aria-hidden="true" className="work-sidebar-folder-icon" />
      <input
        ref={input}
        className="work-sidebar-rename"
        defaultValue={folder.name}
        aria-label="Folder name"
        maxLength={60}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            finish(false);
          }
        }}
        onBlur={(event: FocusEvent<HTMLInputElement>) => {
          if (event.currentTarget.isConnected) finish(true);
        }}
      />
    </span>
  );
}

/** A named group of a project's work; removing it puts the work back in the project's list. */
function FolderGroup({
  projectId,
  folder,
  items,
  row,
  folders,
}: {
  projectId: string;
  folder: SidebarFolder;
  items: WorkItem[];
  row: RowContext;
  folders: SidebarFolder[];
}) {
  const { open, renaming } = useSidebarStore(
    useShallow((state) => ({
      open: !state.collapsedFolders[folder.id],
      renaming: state.renaming === folder.id,
    })),
  );
  const attention = items.filter((item) => ['attention', 'review'].includes(item.stage)).length;
  const listId = `sidebar-folder-${folder.id}`;
  const store = useSidebarStore.getState;
  const menu = (M: typeof Menu | typeof ContextMenu) => (
    <>
      <M.Item className="workspace-menu-item" onSelect={() => store().setRenaming(folder.id)}>
        <Pencil size={16} aria-hidden="true" />
        Rename
      </M.Item>
      <M.Item
        className="workspace-menu-item"
        onSelect={() => store().removeFolder(projectId, folder.id)}
      >
        <Trash2 size={16} aria-hidden="true" />
        Remove folder, keep its work
      </M.Item>
    </>
  );
  return (
    <li className="work-sidebar-folder">
      <div className="work-sidebar-row" data-actions={1}>
        {renaming ? (
          <FolderName projectId={projectId} folder={folder} />
        ) : (
          <>
            <RowContextMenu content={menu(ContextMenu)}>
              <button
                type="button"
                className="work-sidebar-item work-sidebar-folder-head"
                aria-expanded={open}
                aria-controls={open && items.length ? listId : undefined}
                onClick={() => store().toggleFolder(folder.id)}
                onDoubleClick={() => store().setRenaming(folder.id)}
              >
                {open ? (
                  <FolderOpen size={15} aria-hidden="true" className="work-sidebar-folder-icon" />
                ) : (
                  <Folder size={15} aria-hidden="true" className="work-sidebar-folder-icon" />
                )}
                <span className="work-sidebar-title">{folder.name}</span>
                {(!open || !items.length) && (
                  <span className="work-sidebar-folder-count">
                    {items.length}
                    <span className="sr-only"> items</span>
                  </span>
                )}
                {!open && attention > 0 && (
                  <span className="work-sidebar-state" aria-hidden="true" />
                )}
              </button>
            </RowContextMenu>
            <span className="work-sidebar-actions">
              <RowOptions label={`${folder.name} folder options`}>{menu(Menu)}</RowOptions>
            </span>
          </>
        )}
      </div>
      {open && items.length > 0 && (
        <ul id={listId} className="project-tree-items work-sidebar-folder-items">
          {items.map((item) => (
            <WorkRow key={item.id} item={item} row={row} folders={folders} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Favorite projects and work as large tiles above the tree, like a browser's favorites row.
 * Nothing shows until something is added.
 */
function FavoriteTiles({
  favorites,
  projects,
  work,
  byProject,
  activeProject,
  row,
  actions,
  onSetIcon,
}: {
  favorites: string[];
  projects: Project[];
  work: WorkItem[];
  byProject: Map<string, WorkItem[]>;
  activeProject: string | null;
  row: RowContext;
  actions: ProjectActions;
  onSetIcon: (project: Project) => void;
}) {
  type Tile = { key: string; project: Project } | { key: string; item: WorkItem };
  const tiles = favorites.flatMap((key): Tile[] => {
    const [kind, ...rest] = key.split(':');
    const id = rest.join(':');
    if (kind === 'project') {
      const project = projects.find((candidate) => candidate.id === id);
      return project ? [{ key, project }] : [];
    }
    const item = work.find((candidate) => candidate.id === id);
    return item ? [{ key, item }] : [];
  });
  if (!tiles.length) return null;
  // Like Arc's favorites: a few tiles share one row and grow; more wrap into smaller ones.
  const size = tiles.length <= 2 ? 'large' : tiles.length === 3 ? 'medium' : 'small';
  return (
    <ul
      className="sidebar-favorites"
      aria-label="Favorites"
      data-size={size}
      style={{ '--favorites-columns': Math.min(tiles.length, 4) } as CSSProperties}
    >
      {tiles.map((tile) => {
        if ('project' in tile) {
          const { project } = tile;
          const attention = (byProject.get(project.id) ?? []).filter((item) =>
            ['attention', 'review'].includes(item.stage),
          ).length;
          return (
            <li key={tile.key}>
              <Tooltip side="bottom" content={project.name}>
                <ProjectContextMenu project={project} onSetIcon={onSetIcon} {...actions}>
                  <button
                    type="button"
                    className="sidebar-favorite"
                    aria-label={attention ? `${project.name}, ${attention} need you` : project.name}
                    data-active={project.id === activeProject || undefined}
                    onClick={() => actions.onOpenProject(project.id, 'kanban')}
                  >
                    <ProjectMark project={project} />
                    {attention > 0 && <span className="sidebar-favorite-dot" aria-hidden="true" />}
                  </button>
                </ProjectContextMenu>
              </Tooltip>
            </li>
          );
        }
        const { item } = tile;
        const presence = workPresence(item);
        const needsYou = ['attention', 'review'].includes(item.stage);
        const project = projects.find((candidate) => candidate.id === workProjectId(item));
        return (
          <li key={tile.key}>
            <Tooltip
              side="bottom"
              content={project ? `${item.title} · ${project.name}` : item.title}
            >
              <RowContextMenu
                content={
                  <ContextMenu.Item
                    className="workspace-menu-item"
                    onSelect={() => useSidebarStore.getState().toggleFavorite(tile.key)}
                  >
                    <StarOff size={16} aria-hidden="true" />
                    Remove from favorites
                  </ContextMenu.Item>
                }
              >
                <button
                  type="button"
                  className="sidebar-favorite"
                  aria-label={needsYou ? `${item.title}, needs you` : item.title}
                  aria-current={row.selected(item) ? 'page' : undefined}
                  onClick={() => row.open(item)}
                >
                  <LatestAgent agents={presence.agents} state={presence.state} size="sm" />
                  {project && (
                    <span className="sidebar-favorite-project">
                      <ProjectMark project={project} />
                    </span>
                  )}
                  {needsYou && <span className="sidebar-favorite-dot" aria-hidden="true" />}
                </button>
              </RowContextMenu>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

export function WorkSidebar({
  activeTab,
  onOpen,
  onAddProject,
  onOpenGeneral,
  ...actions
}: ProjectActions & {
  activeTab: ActiveTab;
  onOpen: () => void;
  onAddProject: () => void;
  /** Adds General, for work without a project, and opens its composer. */
  onOpenGeneral: () => void;
}) {
  const [iconFor, setIconFor] = useState<Project | null>(null);
  const projects = useProjectStore((state) => state.projects);
  const activeProject = useProjectStore((state) => state.activeProjectId);
  const collapsed = useWorkViewStore((state) => state.collapsedProjects);
  const scope = useWorkViewStore((state) => state.scope);
  const byProject = useProjectWork();
  const hints = useMemo(() => projectNameHints(projects), [projects]);
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
  const allWork = useWorkspaceWork();
  const allByProject = useMemo(() => {
    const grouped = new Map<string, WorkItem[]>();
    for (const item of allWork) {
      const projectId = item.run || item.session || item.managed ? workProjectId(item) : null;
      if (projectId) grouped.set(projectId, [...(grouped.get(projectId) ?? []), item]);
    }
    return grouped;
  }, [allWork]);
  const { favorites, pinnedWork, folders, placement } = useSidebarStore(
    useShallow((state) => ({
      favorites: state.favorites,
      pinnedWork: state.pinnedWork,
      folders: state.folders,
      placement: state.placement,
    })),
  );
  const row: RowContext = {
    signals,
    openKey,
    stats,
    selected: (item) =>
      item.managed
        ? item.managed.id === selectedManaged
        : item.session
          ? item.session.id === selectedSession
          : item.run?.id === selectedRun,
    open: (item) => {
      openWork(item);
      onOpen();
    },
  };
  const general = projects.find((project) => project.id === GENERAL_PROJECT_ID);
  const projectGroup = (project: Project) => {
    const live = byProject.get(project.id) ?? [];
    const outside = external.get(project.id) ?? [];
    const expanded = !collapsed[project.id];
    const attention = live.filter((item) => ['attention', 'review'].includes(item.stage)).length;
    const running = live.filter((item) => item.stage === 'working').length;
    const all = allByProject.get(project.id) ?? [];
    const folderList = folders[project.id] ?? [];
    const folderIds = new Set(folderList.map((folder) => folder.id));
    // Pinned work and work in folders always shows, in its own place above the rest.
    const pinned = pinnedWork.flatMap((id) => all.find((item) => item.id === id) ?? []);
    const pinnedIds = new Set(pinned.map((item) => item.id));
    const inFolder = (folderId: string) =>
      all.filter((item) => placement[item.id] === folderId && !pinnedIds.has(item.id));
    const items = live.filter(
      (item) => !pinnedIds.has(item.id) && !folderIds.has(placement[item.id] ?? ''),
    );
    // The tree keeps only live work: rows that need the person, are running, are unread or
    // are open. The rest stays one click away on the project's Work page.
    const rest = items.filter(
      (item) =>
        ['attention', 'review', 'working'].includes(item.stage) ||
        isUnread(item, signals, openKey) ||
        row.selected(item),
    );
    const more = items.length - rest.length;
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
            {live.length || outside.length || pinned.length || folderList.length ? (
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
              onClick={() => actions.onOpenProject(project.id, 'kanban')}
              title={project.path}
            >
              <ProjectMark project={project} />
              <span className="project-tree-label">{project.name}</span>
              {hints.has(project.id) && (
                <span className="project-tree-hint">{hints.get(project.id)}</span>
              )}
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
                    onCloseAutoFocus={keepRenameFocus}
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
        {expanded && (pinned.length > 0 || folderList.length > 0 || items.length > 0) && (
          <ul id={listId} className="project-tree-items">
            {pinned.map((item) => (
              <WorkRow key={item.id} item={item} row={row} folders={folderList} pinned />
            ))}
            {folderList.map((folder) => (
              <FolderGroup
                key={folder.id}
                projectId={project.id}
                folder={folder}
                items={inFolder(folder.id)}
                row={row}
                folders={folderList}
              />
            ))}
            {(pinned.length > 0 || folderList.length > 0) && (rest.length > 0 || more > 0) && (
              <li className="work-sidebar-divider" aria-hidden="true" />
            )}
            {rest.map((item) => (
              <WorkRow key={item.id} item={item} row={row} folders={folderList} closable />
            ))}
            {more > 0 && (
              <li className="work-sidebar-row">
                <button
                  type="button"
                  className="work-sidebar-item work-sidebar-more"
                  title={`Open all of ${project.name}'s work`}
                  onClick={() => actions.onOpenProject(project.id, 'kanban')}
                >
                  <span className="work-sidebar-title">
                    {more} more
                    <span className="sr-only"> in {project.name}</span>
                  </span>
                </button>
              </li>
            )}
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
  };
  return (
    <nav className="project-tree" aria-label="Projects">
      <FavoriteTiles
        favorites={favorites}
        projects={projects}
        work={allWork}
        byProject={byProject}
        activeProject={activeProject}
        row={row}
        actions={actions}
        onSetIcon={setIconFor}
      />
      {/* General holds work without a project, so it leads the tree; until it is added,
          this row adds it. */}
      {general ? (
        projectGroup(general)
      ) : (
        <section className="project-tree-group">
          <div className="project-tree-head">
            <span className="project-tree-toggle" aria-hidden="true" />
            <button
              type="button"
              className="project-tree-name"
              title="Work that needs no project, such as a web page or a connection"
              onClick={onOpenGeneral}
            >
              <ProjectMark project={{ id: GENERAL_PROJECT_ID, name: 'General' }} />
              <span className="project-tree-label">General</span>
            </button>
          </div>
        </section>
      )}
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
      {projects.filter((project) => project.id !== GENERAL_PROJECT_ID).map(projectGroup)}
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
  const hints = useMemo(() => projectNameHints(projects), [projects]);
  return (
    <nav className="project-rail" aria-label="Projects">
      {/* General leads here too, as it does in the full tree. */}
      {[
        ...projects.filter((project) => project.id === GENERAL_PROJECT_ID),
        ...projects.filter((project) => project.id !== GENERAL_PROJECT_ID),
      ].map((project) => {
        const attention = (byProject.get(project.id) ?? []).filter((item) =>
          ['attention', 'review'].includes(item.stage),
        ).length;
        const hint = hints.get(project.id);
        const name = hint ? `${project.name} · ${hint}` : project.name;
        return (
          <Tooltip key={project.id} side="right" content={name}>
            <ProjectContextMenu project={project} onSetIcon={setIconFor} {...actions}>
              <button
                type="button"
                className="project-rail-item"
                aria-label={attention ? `${name}, ${attention} need you` : name}
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

/** Work across every project that is waiting on the person; the Work and mascot badges share it. */
export function useNeedsYouCount() {
  const byProject = useProjectWork();
  return [...byProject.values()]
    .flat()
    .filter((item) => ['attention', 'review'].includes(item.stage)).length;
}

/** The needs-you count beside the Work link. */
export function NeedsYouCount() {
  const count = useNeedsYouCount();
  if (!count) return null;
  return (
    <small className="workspace-nav-count">
      {count}
      <span className="sr-only"> need you</span>
    </small>
  );
}
