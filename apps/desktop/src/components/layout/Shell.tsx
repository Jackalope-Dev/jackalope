import { DropdownMenu as Menu, SearchIcon } from '@jackalope/ui';
import { listen } from '@tauri-apps/api/event';
import { Check, ChevronDown, PanelLeftClose, PanelLeftOpen, Plus, Settings2 } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { captureDraftForProject } from '../../lib/capture-draft';
import { openCliTerminal } from '../../lib/cli-terminal';
import { displayShortcut, matchesShortcut, resolveShortcuts } from '../../lib/shortcuts';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import type { Feature } from '../../lib/telemetry';
import { useFeatureTelemetry } from '../../lib/use-feature-telemetry';
import { observeWorkbenchPerformance } from '../../lib/workbench-performance';
import { openChanges } from '../../stores/commitReviewStore';
import { useExecutionStore } from '../../stores/executionStore';
import { observeHelper, useHelperStore } from '../../stores/helperStore';
import { useHostContextStore } from '../../stores/hostContextStore';
import { observeLiveSessions, useLiveSessionStore } from '../../stores/liveSessionStore';
import { observeManagedTasks, useManagedTaskStore } from '../../stores/managedTaskStore';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { type Project, useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { observeWorkbenchPreferences, useWorkbenchStore } from '../../stores/workbenchStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { BranchIndicator } from './BranchIndicator';
import { WorkSidebar } from './WorkSidebar';
import { WorkspaceStatusBar } from './WorkspaceStatusBar';
import './workspace-shell.css';
import { CompanionSources } from '../mascot/CompanionSources';
import { RemoveProjectAction } from '../projects/RemoveProjectAction';
import { ScheduleNotice } from '../schedules/ScheduleNotice';
import type { SettingsCategory } from '../settings/SettingsPage';
import { UpdateNotice } from '../settings/UpdateNotice';
import { CaptureTask } from '../tasks/CaptureTask';
import { HistoryRecoveryNotice } from '../tasks/HistoryRecoveryNotice';
import { UnsavedTasksNotice } from '../tasks/TaskSaveRecovery';
import { TaskWorkspace } from '../tasks/TaskWorkspace';
import { ArcColorPicker } from '../theme/ArcColorPicker';
import { LoadingState } from '../ui/LoadingState';
import { PageErrorBoundary } from '../ui/PageErrorBoundary';
import { Tooltip } from '../ui/Tooltip';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSubnavigation } from '../ui/WorkspaceSubnavigation';
import { InvitationsButton } from './InvitationsButton';
import {
  type ActiveTab,
  AGENT_VIEWS,
  DEFAULT_WORKSPACE_TAB,
  MCP_VIEWS,
  type ProjectSettingsDestination,
  WORKSPACE_VIEWS,
} from './navigation';
import { ResizeHandles } from './ResizeHandles';
import { TitleBar } from './TitleBar';
import { WorkspacePresetPicker } from './WorkspacePresetPicker';

export type { ActiveTab } from './navigation';

// Workspace views and heavy dialogs load on demand so the first paint ships only
// the task workspace. Each stays in its own chunk keyed by the tab that shows it.
const RepoTodos = lazy(() => import('../tasks/RepoTodos').then((m) => ({ default: m.RepoTodos })));
const RemoteHosts = lazy(() =>
  import('../remote/RemoteHosts').then((m) => ({ default: m.RemoteHosts })),
);
const CodebaseMap = lazy(() =>
  import('../visualizer/CodebaseMap').then((m) => ({ default: m.CodebaseMap })),
);
const ProjectOverview = lazy(() =>
  import('../projects/ProjectOverview').then((m) => ({ default: m.ProjectOverview })),
);
const ScheduleManager = lazy(() =>
  import('../schedules/ScheduleManager').then((m) => ({ default: m.ScheduleManager })),
);
const BrowserHarness = lazy(() =>
  import('../browser/BrowserHarness').then((m) => ({ default: m.BrowserHarness })),
);
const UsageDashboard = lazy(() =>
  import('../tasks/UsageDashboard').then((m) => ({ default: m.UsageDashboard })),
);
const CommitReview = lazy(() =>
  import('../projects/CommitReview').then((m) => ({ default: m.CommitReview })),
);
const WorktreeManager = lazy(() =>
  import('../projects/WorktreeManager').then((m) => ({ default: m.WorktreeManager })),
);
const RunnerConnections = lazy(() =>
  import('../tasks/RunnerConnections').then((m) => ({ default: m.RunnerConnections })),
);
const AgentManager = lazy(() =>
  import('../agents/AgentManager').then((m) => ({ default: m.AgentManager })),
);
const McpWorkspace = lazy(() =>
  import('../mcp/McpWorkspace').then((m) => ({ default: m.McpWorkspace })),
);
const ProjectContext = lazy(() =>
  import('../projects/ProjectContext').then((m) => ({ default: m.ProjectContext })),
);
const ProjectPreferences = lazy(() =>
  import('../projects/ProjectPreferences').then((m) => ({ default: m.ProjectPreferences })),
);
const SettingsPage = lazy(() =>
  import('../settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const CommandPalette = lazy(() =>
  import('./CommandPalette').then((m) => ({ default: m.CommandPalette })),
);

export function Shell({
  initialTaskAgent,
  initialCapture,
  initialDraftKey,
  focusOnMount,
}: {
  initialTaskAgent?: string;
  initialCapture?: boolean;
  initialDraftKey?: string;
  focusOnMount?: boolean;
} = {}) {
  const showThemePicker = useSettingsStore((state) => state.showThemePickerInToolbar);
  useEffect(observeLiveSessions, []);
  useEffect(observeManagedTasks, []);
  const canvas = useRef<HTMLElement>(null);
  const projectSwitcher = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnMount && !initialDraftKey && !initialTaskAgent && !initialCapture)
      canvas.current?.focus();
  }, [focusOnMount, initialDraftKey, initialTaskAgent, initialCapture]);
  const openProjectSetup = () => useOnboardingStore.getState().begin();
  const [activeTab, setActiveTab] = useState<ActiveTab>(DEFAULT_WORKSPACE_TAB);
  useEffect(() => {
    if (activeTab === 'live-sessions') {
      useExecutionStore.getState().select(null);
      useManagedTaskStore.getState().select(null);
      setActiveTab('kanban');
    }
  }, [activeTab]);
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<{ id: string; pane: string; sessionId?: string }>(
      'work-pane-open',
      async ({ payload }) => {
        if (payload.sessionId) {
          await useLiveSessionStore.getState().refresh(payload.sessionId);
          if (disposed) return;
          const session = useLiveSessionStore
            .getState()
            .sessions.find((session) => session.id === payload.sessionId);
          if (session) useProjectStore.getState().selectProject(session.request.projectId);
          useLiveSessionStore.getState().select(payload.sessionId);
          useWorkViewStore.getState().open(`session:${payload.sessionId}`, payload.pane);
          setActiveTab('live-sessions');
        } else {
          useLiveSessionStore.getState().select(null);
          useExecutionStore.getState().select(payload.id);
          await useExecutionStore.getState().refresh();
          if (disposed) return;
          const run = useExecutionStore.getState().runs.find((run) => run.id === payload.id);
          if (run) useProjectStore.getState().selectProject(run.projectId);
          useManagedTaskStore.getState().select(null);
          useWorkViewStore.getState().open(payload.id, payload.pane);
          setActiveTab('kanban');
        }
      },
    ).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<string>('live-session-open', async ({ payload }) => {
      await useLiveSessionStore.getState().refresh(payload);
      if (disposed) return;
      const session = useLiveSessionStore.getState().sessions.find((item) => item.id === payload);
      if (session) useProjectStore.getState().selectProject(session.request.projectId);
      useLiveSessionStore.getState().select(payload);
      setActiveTab('live-sessions');
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  useEffect(observeHelper, []);
  useEffect(observeWorkbenchPreferences, []);
  useEffect(observeWorkbenchPerformance, []);
  useEffect(() => {
    useHelperStore.setState({ screen: activeTab });
  }, [activeTab]);
  const previousView = useRef<ActiveTab>(DEFAULT_WORKSPACE_TAB);
  useEffect(() => {
    if (activeTab !== 'preferences') previousView.current = activeTab;
  }, [activeTab]);
  const [configuredAgent, setConfiguredAgent] = useState<string>();
  useEffect(() => {
    const handle = (event: Event) => {
      setConfiguredAgent((event as CustomEvent<string>).detail);
      setActiveTab('agent-settings');
    };
    window.addEventListener('jackalope:configure-agent', handle);
    return () => window.removeEventListener('jackalope:configure-agent', handle);
  }, []);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('General');
  const [settingsProjectId, setSettingsProjectId] = useState<string>();
  const features: Partial<Record<ActiveTab, Feature>> = {
    kanban: 'tasks',
    'live-sessions': 'chat',
    'project-overview': 'project',
    'project-knowledge': 'knowledge',
    'project-settings': 'settings',
    'agent-settings': 'agents',
    preferences: 'settings',
    topology: 'codebase',
    agents: 'agents',
    mcps: 'connections',
    'mcp-marketplace': 'connections',
    usage: 'usage',
    browser: 'browser',
    schedules: 'schedules',
    worktrees: 'worktrees',
  };
  useFeatureTelemetry(features[activeTab]);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [removingProject, setRemovingProject] = useState<Project | null>(null);
  // Keep the command palette mounted after first use so close transitions can finish.
  const [commandsSeen, setCommandsSeen] = useState(false);
  useEffect(() => {
    if (commandsOpen) setCommandsSeen(true);
  }, [commandsOpen]);
  const [capture, setCapture] = useState<{
    ideaId?: string;
    agent?: string;
    draftKey?: string;
  } | null>(
    initialDraftKey || initialTaskAgent
      ? { agent: initialTaskAgent, draftKey: initialDraftKey }
      : initialCapture
        ? {}
        : null,
  );
  const [scheduleRunId, setScheduleRunId] = useState<string>();
  useEffect(() => {
    const handle = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      const draft = useExecutionStore.getState().drafts[key];
      if (key.startsWith('helper-') && draft) setCapture({ draftKey: key });
    };
    window.addEventListener('jackalope:helper-draft', handle);
    return () => window.removeEventListener('jackalope:helper-draft', handle);
  }, []);
  const [composerFocus, setComposerFocus] = useState(0);
  const focusComposer = useCallback(() => {
    setCapture(null);
    useLiveSessionStore.getState().select(null);
    useManagedTaskStore.getState().select(null);
    useExecutionStore.getState().select(null);
    setActiveTab('kanban');
    setComposerFocus((value) => value + 1);
  }, []);
  const { projects, activeProjectId, selectProject } = useProjectStore();
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let disposed = false;
    const stops: Array<() => void> = [];
    void listen('jackalope-tray-new-task', () => focusComposer()).then((unlisten) => {
      if (disposed) unlisten();
      else stops.push(unlisten);
    });
    void listen('jackalope-tray-settings', () => {
      window.dispatchEvent(new CustomEvent('jackalope:open-settings', { detail: 'General' }));
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stops.push(unlisten);
    });
    // `/diff` in the terminal: open Changes on that checkout, in its project.
    void listen<string>('jackalope:open-changes', ({ payload: path }) => {
      const owner = useProjectStore
        .getState()
        .projects.find((project) => path === project.path || path.startsWith(`${project.path}/`));
      if (owner) useProjectStore.getState().selectProject(owner.id);
      openChanges(path);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stops.push(unlisten);
    });
    void listen<string>('jackalope-tray-open-task', ({ payload: taskId }) => {
      useWorkViewStore.getState().open(taskId);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stops.push(unlisten);
    });
    return () => {
      disposed = true;
      for (const stop of stops) stop();
    };
  }, [focusComposer]);
  const switchProject = (id: string) => {
    if (id === activeProjectId) return;
    const project = projects.find((item) => item.id === id);
    if (!project) return;
    const execution = useExecutionStore.getState();
    execution.draft('capture', captureDraftForProject(execution.drafts, project, activeProjectId));
    execution.select(null);
    useLiveSessionStore.getState().select(null);
    useManagedTaskStore.getState().select(null);
    selectProject(id);
  };
  const selectedTaskId = useExecutionStore((state) => state.selectedId);
  const selectedSessionId = useLiveSessionStore((state) => state.selectedId);
  const selectedManagedId = useManagedTaskStore((state) => state.selectedId);
  const workRequest = useWorkViewStore((state) => state.request);
  useEffect(() => {
    if (!workRequest) return;
    const session = useLiveSessionStore
      .getState()
      .sessions.find((item) => `session:${item.id}` === workRequest.id);
    if (session) {
      selectProject(session.request.projectId);
      useLiveSessionStore.getState().select(session.id);
      setActiveTab('live-sessions');
      return;
    }
    const run = useExecutionStore.getState().runs.find((item) => item.id === workRequest.id);
    if (!run) return;
    selectProject(run.projectId);
    if (run.liveSessionId) {
      useLiveSessionStore.getState().select(run.liveSessionId);
      setActiveTab('live-sessions');
    } else {
      useLiveSessionStore.getState().select(null);
      useManagedTaskStore.getState().select(null);
      useExecutionStore.getState().select(run.id);
      setActiveTab('kanban');
    }
  }, [workRequest, selectProject]);
  const project = projects.find((item) => item.id === activeProjectId);
  const preset = useWorkbenchStore((state) => state.presets[activeProjectId ?? ''] ?? 'focus');
  const view = WORKSPACE_VIEWS.find((item) => item.id === activeTab) ?? WORKSPACE_VIEWS[0];
  const navigate = useCallback((tab: ActiveTab) => {
    if (tab === 'preferences' || tab === 'audit' || tab === 'mesh') {
      setSettingsProjectId(undefined);
      setSettingsCategory('General');
    }
    if (tab === 'audit' || tab === 'mesh') {
      setSettingsCategory(tab === 'audit' ? 'Diagnostics' : 'System');
      setActiveTab('preferences');
    } else setActiveTab(tab);
  }, []);
  useEffect(() => {
    const handle = (event: Event) => navigate((event as CustomEvent<ActiveTab>).detail);
    window.addEventListener('jackalope:navigate', handle);
    return () => window.removeEventListener('jackalope:navigate', handle);
  }, [navigate]);
  useEffect(() => {
    const handle = (event: Event) => {
      const destination = (event as CustomEvent<SettingsCategory | ProjectSettingsDestination>)
        .detail;
      setSettingsCategory(typeof destination === 'string' ? destination : destination.category);
      setSettingsProjectId(typeof destination === 'string' ? undefined : destination.projectId);
      setActiveTab('preferences');
    };
    window.addEventListener('jackalope:open-settings', handle);
    return () => window.removeEventListener('jackalope:open-settings', handle);
  }, []);
  const shortcutSettings = useSettingsStore((state) => state.shortcuts);
  const shortcuts = resolveShortcuts(shortcutSettings);
  const navCollapsed = useWorkViewStore((state) => state.navCollapsed) && preset === 'build';
  const toggleNav = useWorkViewStore((state) => state.toggleNav);
  const shortcut = displayShortcut(shortcuts.search);
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<string>('desktop-action', ({ payload }) => {
      if (payload === 'settings') navigate('preferences');
      if (payload === 'newWork') focusComposer();
      if (payload === 'search') setCommandsOpen(true);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [navigate, focusComposer]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const bindings = resolveShortcuts(shortcutSettings);
      if (matchesShortcut(event, bindings.search)) {
        event.preventDefault();
        setCommandsOpen((open) => !open);
      } else if (matchesShortcut(event, bindings.newWork)) {
        event.preventDefault();
        focusComposer();
      } else if (matchesShortcut(event, bindings.settings)) {
        event.preventDefault();
        if (activeTab === 'preferences') setActiveTab(previousView.current);
        else navigate('preferences');
      } else if (preset === 'build' && matchesShortcut(event, bindings.sidebar)) {
        event.preventDefault();
        useWorkViewStore.getState().toggleNav();
      } else if (matchesShortcut(event, bindings.terminal)) {
        const state = useProjectStore.getState();
        const project = state.projects.find((item) => item.id === state.activeProjectId);
        if (project && !useHostContextStore.getState().host) {
          event.preventDefault();
          void openCliTerminal(project.path).catch(() => {});
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, focusComposer, navigate, preset, shortcutSettings]);

  return (
    <div className="workspace-shell" data-mode={preset}>
      <a className="skip-link" href="#workspace-content">
        Skip to workspace
      </a>
      <ResizeHandles />
      <TitleBar onSettings={() => navigate('preferences')} />
      <header className="workspace-chrome">
        <div className="flex items-center gap-4 min-w-0">
          <img src="/mascot.svg" alt="Jackalope" className="size-8 shrink-0" />
          <Menu.Root>
            <Menu.Trigger asChild>
              <button
                ref={projectSwitcher}
                type="button"
                className="project-switcher"
                aria-label="Switch project"
              >
                <span className="truncate max-w-52">{project?.name ?? 'Choose a project'}</span>
                <ChevronDown className="size-3 text-[var(--color-text-muted)]" />
              </button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content
                className="workspace-menu min-w-64"
                align="start"
                sideOffset={12}
                collisionPadding={12}
              >
                <Menu.Label className="menu-label">Your projects</Menu.Label>
                {projects.map((item) => (
                  <Menu.Item
                    key={item.id}
                    onSelect={() => switchProject(item.id)}
                    className="workspace-menu-item"
                  >
                    <span className="flex-1">{item.name}</span>
                    {item.id === activeProjectId && <Check className="size-3.5" />}
                  </Menu.Item>
                ))}
                <Menu.Separator className="menu-separator" />
                <Menu.Item className="workspace-menu-item" onSelect={openProjectSetup}>
                  Add a project…
                </Menu.Item>
                {project && (
                  <Menu.Item
                    className="workspace-menu-item"
                    onSelect={() => setRemovingProject(project)}
                  >
                    Remove from Jackalope…
                  </Menu.Item>
                )}
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
          <BranchIndicator />
          <InvitationsButton
            onClick={() => {
              setSettingsProjectId(undefined);
              setSettingsCategory('Invitations');
              setActiveTab('preferences');
            }}
            onDismiss={() => projectSwitcher.current?.focus()}
          />
        </div>
        <div className="flex items-center gap-3">
          {project && <WorkspacePresetPicker projectId={project.id} />}
          {(activeTab !== 'kanban' || selectedTaskId || selectedSessionId || selectedManagedId) && (
            <Tooltip content={`New work (${displayShortcut(shortcuts.newWork)})`}>
              <button
                type="button"
                className="command-trigger"
                onClick={focusComposer}
                aria-label="New work"
              >
                <Plus size={16} />
                <span>New work</span>
              </button>
            </Tooltip>
          )}
          <Tooltip content={`Search commands (${shortcut})`}>
            <button
              type="button"
              onClick={() => setCommandsOpen(true)}
              className="command-trigger command-jump"
              aria-label="Search commands"
            >
              <SearchIcon className="" />
              <span className="hidden sm:inline">Jump to…</span>
              <kbd>{shortcut}</kbd>
            </button>
          </Tooltip>
          {!isTauriEnvironment() && showThemePicker && <ArcColorPicker />}
          {!isTauriEnvironment() && (
            <Tooltip content={`Settings (${displayShortcut(shortcuts.settings)})`}>
              <button
                type="button"
                onClick={() => navigate('preferences')}
                className="quiet-icon"
                aria-label="Settings and preferences"
              >
                <Settings2 className="size-4" />
              </button>
            </Tooltip>
          )}
        </div>
      </header>
      <div className="workspace-body">
        <aside className="workspace-navigation" data-collapsed={navCollapsed || undefined}>
          {preset === 'build' && (
            <Tooltip
              side="right"
              content={`${navCollapsed ? 'Expand' : 'Collapse'} sidebar (${displayShortcut(shortcuts.sidebar)})`}
            >
              <button
                type="button"
                className="workspace-nav-item workspace-nav-toggle"
                aria-label={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!navCollapsed}
                onClick={toggleNav}
              >
                {navCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              </button>
            </Tooltip>
          )}
          <nav aria-label="Workspace" className="flex items-center gap-1">
            {WORKSPACE_VIEWS.filter((item) => item.primary).map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  if (item.id === 'kanban') {
                    useExecutionStore.getState().select(null);
                    useLiveSessionStore.getState().select(null);
                    useManagedTaskStore.getState().select(null);
                  }
                  setActiveTab(item.id);
                }}
                aria-current={view.group === item.group ? 'page' : undefined}
                aria-label={item.label}
                title={item.label}
                className="workspace-nav-item"
              >
                <item.icon className="size-3.5" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          {preset === 'build' && !navCollapsed && (
            <WorkSidebar onOpen={() => setActiveTab('kanban')} />
          )}
          <button
            type="button"
            className="workspace-nav-item workspace-settings"
            aria-label="Settings"
            aria-current={activeTab === 'preferences' ? 'page' : undefined}
            title="Settings"
            onClick={() => navigate('preferences')}
          >
            <Settings2 size={18} />
            <span>Settings</span>
          </button>
        </aside>
        <main
          ref={canvas}
          id="workspace-content"
          tabIndex={-1}
          className="workspace-canvas"
          aria-label={view.label}
        >
          {view.group === 'agents' && (
            <WorkspaceSubnavigation
              label="Agents views"
              items={AGENT_VIEWS}
              value={
                activeTab === 'agent-settings'
                  ? 'agents'
                  : activeTab === 'mcp-marketplace'
                    ? 'mcps'
                    : activeTab
              }
              onChange={navigate}
            />
          )}
          {view.group !== 'settings' &&
            view.group !== 'tasks' &&
            view.group !== 'agents' &&
            WORKSPACE_VIEWS.filter((item) => item.group === view.group).length > 1 && (
              <WorkspaceSubnavigation
                label={`${view.group} views`}
                value={activeTab}
                onChange={navigate}
                items={WORKSPACE_VIEWS.filter((item) => item.group === view.group).map((item) => ({
                  id: item.id,
                  label:
                    item.id === 'live-sessions'
                      ? 'Chat'
                      : item.id === 'kanban'
                        ? 'Tasks'
                        : item.id === 'project-overview'
                          ? 'Overview'
                          : item.id === 'topology'
                            ? 'Codebase'
                            : item.id === 'agents'
                              ? 'Runners'
                              : item.id === 'agent-settings'
                                ? 'Configuration'
                                : item.id === 'mcps'
                                  ? 'Connections'
                                  : item.id === 'project-settings'
                                    ? 'Settings'
                                    : item.label,
                }))}
              />
            )}
          {(activeTab === 'mcps' || activeTab === 'mcp-marketplace') && (
            <WorkspaceSubnavigation
              label="MCP views"
              items={MCP_VIEWS}
              value={activeTab}
              onChange={navigate}
            />
          )}
          <PageErrorBoundary
            feature={features[activeTab]}
            key={`${activeTab}:${activeProjectId}:${settingsCategory}`}
            onBack={
              activeTab === DEFAULT_WORKSPACE_TAB
                ? undefined
                : () => setActiveTab(DEFAULT_WORKSPACE_TAB)
            }
          >
            <Suspense
              fallback={
                <WorkspacePage>
                  <WorkspaceHeading title={activeTab === 'topology' ? 'Codebase' : view.label} />
                  <LoadingState compact label={`Opening ${view.label}…`} />
                </WorkspacePage>
              }
            >
              {activeTab === 'kanban' && (
                <TaskWorkspace
                  composerVisible={!capture}
                  composerFocus={composerFocus}
                  onCapture={(ideaId) => (ideaId ? setCapture({ ideaId }) : focusComposer())}
                  onSchedule={(id) => {
                    const run = useExecutionStore.getState().runs.find((r) => r.id === id);
                    if (run) selectProject(run.projectId);
                    setScheduleRunId(id);
                    setActiveTab('schedules');
                  }}
                />
              )}
              {activeTab === 'changes' && (
                <CommitReview key={activeProjectId} onOpenProject={openProjectSetup} />
              )}
              {activeTab === 'worktrees' && (
                <WorktreeManager key={activeProjectId} onOpenProject={openProjectSetup} />
              )}
              {activeTab === 'remote-hosts' && (
                <RemoteHosts
                  onSetup={() => {
                    setSettingsProjectId(undefined);
                    setSettingsCategory('Remote access');
                    setActiveTab('preferences');
                  }}
                />
              )}
              {activeTab === 'repo-todos' && (
                <RepoTodos
                  key={project?.path ?? activeProjectId}
                  onCapture={(draftKey) => setCapture({ draftKey })}
                  onOpenProject={openProjectSetup}
                />
              )}
              {activeTab === 'agents' && (
                <RunnerConnections
                  onNewTask={(agent) => {
                    useExecutionStore.getState().select(null);
                    setCapture({ agent });
                    setActiveTab('kanban');
                  }}
                  onRun={(run) => {
                    selectProject(run.projectId);
                    useExecutionStore.getState().select(run.id);
                    setActiveTab('kanban');
                  }}
                />
              )}
              {activeTab === 'usage' && <UsageDashboard onTask={() => setActiveTab('kanban')} />}
              {activeTab === 'preferences' && (
                <SettingsPage
                  key={`${settingsCategory}:${settingsProjectId ?? 'app'}`}
                  initialCategory={settingsCategory}
                  initialScope={settingsProjectId ? 'project' : 'app'}
                  initialProjectId={settingsProjectId}
                  onClose={() => setActiveTab(previousView.current)}
                />
              )}
              {activeTab === 'agent-settings' && (
                <WorkspacePage className="agent-settings-page">
                  <AgentManager key={configuredAgent} initialAgentId={configuredAgent} />
                </WorkspacePage>
              )}
              {activeTab === 'project-settings' && <ProjectPreferences key={activeProjectId} />}
              {activeTab === 'project-knowledge' && <ProjectContext key={activeProjectId} />}
              {(activeTab === 'mcps' || activeTab === 'mcp-marketplace') && (
                <McpWorkspace
                  view={activeTab === 'mcps' ? 'configured' : 'marketplace'}
                  onViewChange={(next) =>
                    navigate(next === 'configured' ? 'mcps' : 'mcp-marketplace')
                  }
                />
              )}
              {activeTab === 'schedules' && (
                <ScheduleManager
                  key={activeProjectId}
                  sourceRunId={scheduleRunId}
                  onSourceHandled={() => setScheduleRunId(undefined)}
                  onOpenProject={openProjectSetup}
                  onPlanning={() => {
                    useExecutionStore.getState().select(null);
                    setActiveTab('kanban');
                  }}
                />
              )}
              {activeTab === 'browser' && (
                <BrowserHarness
                  onOpenProject={openProjectSetup}
                  onTask={(id) => {
                    useExecutionStore.getState().select(id);
                    setActiveTab('kanban');
                  }}
                />
              )}
              {activeTab === 'project-overview' && (
                <ProjectOverview onOpenProject={openProjectSetup} />
              )}
              {activeTab === 'topology' && <CodebaseMap onOpenProject={openProjectSetup} />}
            </Suspense>
          </PageErrorBoundary>
        </main>
      </div>
      {capture && (
        <CaptureTask
          key={capture.ideaId ?? 'capture'}
          {...capture}
          onClose={() => setCapture(null)}
          onStarted={() => {
            setCapture(null);
            setActiveTab('kanban');
          }}
        />
      )}
      <UpdateNotice />
      {removingProject && (
        <RemoveProjectAction
          project={removingProject}
          open
          onOpenChange={(open) => {
            if (!open) {
              setRemovingProject(null);
              requestAnimationFrame(() => projectSwitcher.current?.focus());
            }
          }}
        />
      )}
      <ScheduleNotice />
      <HistoryRecoveryNotice />
      <UnsavedTasksNotice />
      <CompanionSources />
      <WorkspaceStatusBar
        onSearch={() => setCommandsOpen(true)}
        onSettings={() => {
          setSettingsCategory('General');
          setActiveTab('preferences');
        }}
      />

      <Suspense fallback={null}>
        {commandsSeen && (
          <CommandPalette
            isOpen={commandsOpen}
            onClose={() => setCommandsOpen(false)}
            onNavigate={navigate}
            onCapture={focusComposer}
            onSelectProject={switchProject}
            onOpenSettings={() => setActiveTab('preferences')}
          />
        )}
      </Suspense>
    </div>
  );
}
