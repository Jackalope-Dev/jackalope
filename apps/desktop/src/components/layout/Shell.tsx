import { InlineNotice, LoadingState, SearchIcon, Tooltip } from '@jackalope/ui';
import { PanelLeftClose, PanelLeftOpen, Plus, Settings2 } from 'lucide-react';
import {
  type CSSProperties,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { navigateWorkspace, useAppEvent } from '../../lib/app-events';
import { unreadBotConversations } from '../../lib/bot-conversations';
import { needsYou, useBotHubStore } from '../../lib/bot-hub';
import { observeBots } from '../../lib/bot-hub-sync';
import { describeError } from '../../lib/errors';
import { helperTheme } from '../../lib/helper-actions';
import type { LiveSession } from '../../lib/live-session';
import { isTauriEnvironment } from '../../lib/native/env';
import { planningDraft } from '../../lib/planning';
import { displayShortcut, matchesShortcut, resolveShortcuts } from '../../lib/shortcuts';
import { swarmConnection } from '../../lib/swarm';
import { useFeatureTelemetry } from '../../lib/use-feature-telemetry';
import { WindowGlass } from '../../lib/window-glass';
import { openConversation, openRun, selectWork } from '../../lib/work-selection';
import { observeWorkbenchPerformance } from '../../lib/workbench-performance';
import { useAgentScopeStore } from '../../stores/agentScopeStore';
import { useBotStore } from '../../stores/botStore';
import { openChanges } from '../../stores/commitReviewStore';
import { useExecutionStore } from '../../stores/executionStore';
import { observeHelper, useHelperStore } from '../../stores/helperStore';
import { useHostContextStore } from '../../stores/hostContextStore';
import { observeLiveSessions, useLiveSessionStore } from '../../stores/liveSessionStore';
import { observeManagedTasks, useManagedTaskStore } from '../../stores/managedTaskStore';
import { useOnboardingStore } from '../../stores/onboardingStore';
import {
  mergeProjectRegistry,
  type Project,
  useActiveProject,
  useProjectStore,
} from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTaskStore } from '../../stores/taskStore';
import { useThemeStore } from '../../stores/themeStore';
import { observeWorkbenchPreferences } from '../../stores/workbenchStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { AccessNoticeSlot } from '../account/AccessBoundary';
import { useTrackOpenWork } from '../tasks/WorkSignals';
import { ShortcutSheet } from './ShortcutSheet';
import { WelcomeDialog } from './WelcomeDialog';
import { WhatsNewDialog } from './WhatsNewDialog';
import { CollapsedProjects, NeedsYouCount, WorkSidebar } from './WorkSidebar';
import { WorkspaceStatusBar } from './WorkspaceStatusBar';
import { WorkTabs } from './WorkTabs';
import './workspace-shell.css';
import { useShallow } from 'zustand/react/shallow';
import { CompanionSources } from '../mascot/CompanionSources';
import { ScheduleNotice } from '../schedules/ScheduleNotice';
import type { ComposerSeed } from '../sessions/SessionStart';
import type { SettingsCategory } from '../../lib/settings-categories';
import { UpdateNotice } from '../settings/UpdateNotice';
import { HistoryRecoveryNotice } from '../tasks/HistoryRecoveryNotice';

import { UnsavedTasksNotice } from '../tasks/TaskSaveRecovery';
import { DismissButton } from '../ui/DismissButton';
import { PageErrorBoundary } from '../ui/PageErrorBoundary';
import { ResizeHandle } from '../ui/ResizeHandle';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSubnavigation } from '../ui/WorkspaceSubnavigation';
import { COMMANDS, type Command, type CommandContext, findCommand } from './commands';
import {
  type ActiveTab,
  DEFAULT_WORKSPACE_TAB,
  groupViews,
  highlightedView,
  type PageTab,
  PRIMARY_VIEWS,
  viewLabel,
  workspaceView,
} from '../../lib/navigation';
import { ResizeHandles } from './ResizeHandles';
import { TitleBar } from './TitleBar';
import { VIEW_PAGES, type ViewContext } from './workspace-views';


// The sidebar's default width matches workspace-shell.css; dragging keeps it in this range.
const SIDEBAR_WIDTH = 248;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
const CommandPalette = lazy(() =>
  import('./CommandPalette').then((m) => ({ default: m.CommandPalette })),
);
const RemoveProjectAction = lazy(() =>
  import('../projects/RemoveProjectAction').then((m) => ({ default: m.RemoveProjectAction })),
);

/** Swarm is a beta Cloudflare integration; its project tab appears once it is connected. */
function useSwarmConfigured() {
  const [configured, setConfigured] = useState(false);
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let alive = true;
    swarmConnection()
      .then((connection) => alive && setConfigured(connection.configured))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return configured;
}

/** Bot conversations open on the Bots page, never in Work or Chat. */
function openInBots(session: LiveSession) {
  if (!session.persona) return false;
  useBotStore.getState().openConversation(session.id, session.persona.botId);
  navigateWorkspace('bots');
  return true;
}

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
  useEffect(observeLiveSessions, []);
  useEffect(observeBots, []);
  const botsWaiting = useBotHubStore((state) => needsYou(state).count);
  const { botSessions, botRuns } = useLiveSessionStore(
    useShallow((state) => ({ botSessions: state.sessions, botRuns: state.runs })),
  );
  const { seen, seenFloor } = useBotStore(
    useShallow((state) => ({ seen: state.seen, seenFloor: state.seenFloor })),
  );
  const botsUnread = useMemo(
    () => unreadBotConversations(botSessions, botRuns, seen, seenFloor),
    [botSessions, botRuns, seen, seenFloor],
  );
  useEffect(observeManagedTasks, []);
  const canvas = useRef<HTMLElement>(null);
  const removeReturnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (focusOnMount && !initialDraftKey && !initialTaskAgent && !initialCapture)
      canvas.current?.focus();
  }, [focusOnMount, initialDraftKey, initialTaskAgent, initialCapture]);
  const openProjectSetup = () => useOnboardingStore.getState().begin();
  const [activeTab, setActiveTab] = useState<ActiveTab>(DEFAULT_WORKSPACE_TAB);
  useTauriEvent<{ id: string; pane: string; sessionId?: string }>(
    'work-pane-open',
    async (payload) => {
      if (payload.sessionId) {
        await useLiveSessionStore.getState().refresh(payload.sessionId);
        const session = useLiveSessionStore
          .getState()
          .sessions.find((session) => session.id === payload.sessionId);
        if (session && openInBots(session)) return;
        openConversation(payload.sessionId);
        useWorkViewStore.getState().open(`session:${payload.sessionId}`, payload.pane);
        setActiveTab('kanban');
      } else {
        selectWork({ task: payload.id });
        await useExecutionStore.getState().refresh();
        openRun(payload.id);
        useWorkViewStore.getState().open(payload.id, payload.pane);
        setActiveTab('kanban');
      }
    },
  );
  useTauriEvent<string>('live-session-open', async (payload) => {
    await useLiveSessionStore.getState().refresh(payload);
    const session = useLiveSessionStore.getState().sessions.find((item) => item.id === payload);
    if (session && openInBots(session)) return;
    openConversation(payload);
    setActiveTab('kanban');
  });
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
  useAppEvent('configure-agent', (agent) => {
    setConfiguredAgent(agent);
    setActiveTab('agent-settings');
  });
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('General');
  const [settingsProjectId, setSettingsProjectId] = useState<string>();
  const view = workspaceView(activeTab);
  useFeatureTelemetry(view.feature);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [removingProject, setRemovingProject] = useState<Project | null>(null);
  // Keep the command palette mounted after first use so close transitions can finish.
  const [commandsSeen, setCommandsSeen] = useState(false);
  useEffect(() => {
    if (commandsOpen) setCommandsSeen(true);
  }, [commandsOpen]);
  const [scheduleRunId, setScheduleRunId] = useState<string>();
  const [composerFocus, setComposerFocus] = useState(0);
  const focusComposer = useCallback(() => {
    selectWork();
    setActiveTab('kanban');
    setComposerFocus((value) => value + 1);
  }, []);
  const [composerSeed, setComposerSeed] = useState<ComposerSeed | null>(null);
  /** Loads a saved draft, idea or agent choice into the Work composer. */
  const openInComposer = useCallback(
    ({ ideaId, agent, draftKey }: { ideaId?: string; agent?: string; draftKey?: string }) => {
      const saved = draftKey ? useExecutionStore.getState().drafts[draftKey] : undefined;
      const idea = ideaId
        ? useTaskStore.getState().tasks.find((task) => task.id === ideaId)
        : undefined;
      const fromIdea = idea ? planningDraft(idea) : undefined;
      const projectId = saved?.projectId || idea?.projectId;
      const projects = useProjectStore.getState();
      if (
        projectId &&
        projectId !== projects.activeProjectId &&
        projects.projects.some((p) => p.id === projectId)
      )
        projects.selectProject(projectId);
      setComposerSeed({
        id: crypto.randomUUID(),
        text: saved?.prompt ?? fromIdea?.prompt ?? '',
        agent: saved?.agent || agent || fromIdea?.agent || undefined,
        contextSelection: saved?.contextSelection ?? fromIdea?.contextSelection,
        readOnly: saved?.readOnly,
        ideaId: idea?.id,
        draftKey,
      });
      focusComposer();
    },
    [focusComposer],
  );
  const composerSeedApplied = useCallback((seed: ComposerSeed) => {
    if (seed.draftKey)
      useExecutionStore.setState((state) => {
        const drafts = { ...state.drafts };
        if (seed.draftKey) delete drafts[seed.draftKey];
        return { drafts };
      });
    setComposerSeed((current) => (current?.id === seed.id ? null : current));
  }, []);
  const initialEntry = useRef({ initialDraftKey, initialTaskAgent, initialCapture });
  useEffect(() => {
    const entry = initialEntry.current;
    if (entry.initialDraftKey || entry.initialTaskAgent)
      openInComposer({ draftKey: entry.initialDraftKey, agent: entry.initialTaskAgent });
    else if (entry.initialCapture) focusComposer();
  }, [openInComposer, focusComposer]);
  // Helpers, conversation topics and lesson checks prepare a draft, then open it here.
  useAppEvent('helper-draft', (key) => {
    if (useExecutionStore.getState().drafts[key]) openInComposer({ draftKey: key });
  });
  const { projects, activeProjectId, selectProject } = useProjectStore(
    useShallow((s) => ({
      projects: s.projects,
      activeProjectId: s.activeProjectId,
      selectProject: s.selectProject,
    })),
  );
  // `/diff` in the terminal: open Changes on that checkout, in its project.
  useTauriEvent<string>('jackalope:open-changes', (path) => {
    const owner = useProjectStore
      .getState()
      .projects.find((project) => path === project.path || path.startsWith(`${project.path}/`));
    if (owner) useProjectStore.getState().selectProject(owner.id);
    openChanges(path);
  });
  useTauriEvent('jackalope:projects-registered', () => void mergeProjectRegistry());
  // `/theme` in the terminal: a project with its own theme changes alone,
  // otherwise the app-wide accent changes.
  useTauriEvent<{ projectId: string; accent: string }>(
    'jackalope:set-accent',
    ({ projectId, accent }) => {
      const projects = useProjectStore.getState();
      const own = projects.projects.find((project) => project.id === projectId)?.preferences?.theme;
      if (own) {
        projects.updateProjectPreferences(projectId, {
          theme: helperTheme(own, { scope: 'project', accent }),
        });
      } else {
        const themes = useThemeStore.getState();
        themes.setAppTheme(helperTheme(themes.appTheme, { scope: 'app', accent }));
      }
    },
  );
  useTauriEvent<string>('jackalope-tray-open-task', (taskId) =>
    useWorkViewStore.getState().open(taskId),
  );
  const switchProject = (id: string) => {
    if (id === activeProjectId) return;
    const project = projects.find((item) => item.id === id);
    if (!project) return;
    selectWork();
    selectProject(id);
  };
  /** A project row opens that project's work list, or one of its pages from its menu. */
  const openProject = (id: string, tab: ActiveTab) => {
    switchProject(id);
    if (tab === 'kanban') {
      selectWork();
      useWorkViewStore.getState().setScope('project');
    }
    setActiveTab(tab);
  };
  useTrackOpenWork();
  const selectedTaskId = useExecutionStore((state) => state.selectedId);
  const selectedSessionId = useLiveSessionStore((state) => state.selectedId);
  const selectedManagedId = useManagedTaskStore((state) => state.selectedId);
  const workRequest = useWorkViewStore((state) => state.request);
  useEffect(() => {
    if (!workRequest) return;
    const session = useLiveSessionStore
      .getState()
      .sessions.find((item) => `session:${item.id}` === workRequest.id);
    if (session && openInBots(session)) return;
    if (session) {
      openConversation(session.id);
      setActiveTab('kanban');
      return;
    }
    const run = useExecutionStore.getState().runs.find((item) => item.id === workRequest.id);
    if (!run) return;
    const owner = useLiveSessionStore
      .getState()
      .sessions.find((item) => item.id === run.liveSessionId);
    if (owner && openInBots(owner)) return;
    if (run.liveSessionId) {
      selectProject(run.projectId);
      selectWork({ conversation: run.liveSessionId });
    } else openRun(run.id);
    setActiveTab('kanban');
  }, [workRequest, selectProject]);
  const project = useActiveProject();
  const swarmConfigured = useSwarmConfigured();
  const navigate = useCallback((tab: ActiveTab) => {
    const settings = workspaceView(tab).settings;
    if (tab === 'preferences' || settings) {
      setSettingsProjectId(undefined);
      setSettingsCategory(settings ?? 'General');
      setActiveTab('preferences');
    } else setActiveTab(tab);
  }, []);
  useAppEvent('navigate', navigate);
  useAppEvent('open-settings', (destination) => {
    setSettingsCategory(typeof destination === 'string' ? destination : destination.category);
    setSettingsProjectId(typeof destination === 'string' ? undefined : destination.projectId);
    setActiveTab('preferences');
  });
  useAppEvent('open-agents', (scope) => {
    useAgentScopeStore.getState().setScope(scope);
    setActiveTab('agents');
  });
  useAppEvent('open-cloud-resources', (projectId) => {
    selectProject(projectId);
    setActiveTab('cloud-resources');
  });
  const shortcutSettings = useSettingsStore((state) => state.shortcuts);
  const shortcuts = resolveShortcuts(shortcutSettings);
  const navCollapsed = useWorkViewStore((state) => state.navCollapsed);
  const toggleNav = useWorkViewStore((state) => state.toggleNav);
  const navWidth = useWorkViewStore((state) => state.sizes.sidebar);
  const workScope = useWorkViewStore((state) => state.scope);
  const shortcut = displayShortcut(shortcuts.search);
  const remoteHost = useHostContextStore((state) => state.host);
  const toggleSettings = () =>
    activeTab === 'preferences' ? setActiveTab(previousView.current) : navigate('preferences');
  const commandContext: CommandContext = {
    focusComposer,
    setSearchOpen: setCommandsOpen,
    openSettings: () => navigate('preferences'),
    toggleSettings,
    toggleSidebar: () => useWorkViewStore.getState().toggleNav(),
    terminalProject: remoteHost ? undefined : project,
  };
  const [commandError, setCommandError] = useState('');
  const runCommand = (command: Command, shortcut = false) => {
    setCommandError('');
    const run = shortcut && command.onShortcut ? command.onShortcut : command.run;
    void Promise.resolve(run(commandContext)).catch((cause) =>
      setCommandError(describeError(cause)),
    );
  };
  const commandRef = useRef({ commandContext, runCommand });
  commandRef.current = { commandContext, runCommand };
  useTauriEvent<string>('desktop-action', (action) => {
    const command = findCommand(action);
    if (command) commandRef.current.runCommand(command);
  });
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const bindings = resolveShortcuts(shortcutSettings);
      const { commandContext, runCommand } = commandRef.current;
      const command = COMMANDS.find(
        (item) =>
          item.shortcut &&
          matchesShortcut(event, bindings[item.shortcut]) &&
          (item.available?.(commandContext) ?? true),
      );
      if (!command) return;
      event.preventDefault();
      runCommand(command, true);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcutSettings]);

  const page = VIEW_PAGES[view.settings ? 'preferences' : (activeTab as PageTab)];
  const subnavigation = groupViews(view.group, activeTab, swarmConfigured);
  const viewContext: ViewContext = {
    activeProjectId,
    project,
    open: navigate,
    openProjectSetup,
    openInComposer,
    focusComposer,
    composer: { focus: composerFocus, seed: composerSeed, onSeedApplied: composerSeedApplied },
    schedule: {
      runId: scheduleRunId,
      open: (id) => {
        const run = useExecutionStore.getState().runs.find((r) => r.id === id);
        if (run) selectProject(run.projectId);
        setScheduleRunId(id);
        setActiveTab('schedules');
      },
      handled: () => setScheduleRunId(undefined),
    },
    settings: {
      category: settingsCategory,
      projectId: settingsProjectId,
      open: (category) => {
        setSettingsProjectId(undefined);
        setSettingsCategory(category);
        setActiveTab('preferences');
      },
      close: () => setActiveTab(previousView.current),
    },
    configuredAgent,
  };
  const projectActions = {
    onOpenProject: openProject,
    onNewWork: (id: string) => {
      switchProject(id);
      focusComposer();
    },
    onCopyPath: (item: Project) => {
      setCommandError('');
      void Promise.resolve()
        .then(() => navigator.clipboard.writeText(item.path))
        .catch((cause) =>
          setCommandError(`Could not copy the path of ${item.name}: ${describeError(cause)}`),
        );
    },
    onRemoveProject: (item: Project) => {
      removeReturnFocus.current = document.activeElement as HTMLElement | null;
      setRemovingProject(item);
    },
  };
  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-content">
        Skip to workspace
      </a>
      <WindowGlass />
      <ResizeHandles />
      <TitleBar
        themePicker
        settings={{
          open: toggleSettings,
          shortcut: displayShortcut(shortcuts.settings),
          current: activeTab === 'preferences',
        }}
        center={
          <Tooltip content={`Search work, projects and commands (${shortcut})`}>
            <button
              type="button"
              onClick={() => setCommandsOpen(true)}
              onMouseDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              className="command-trigger command-jump"
              aria-label="Search commands"
            >
              <SearchIcon className="app-titlebar-search-icon" />
              <span>Search or jump to…</span>
              <kbd>{shortcut}</kbd>
            </button>
          </Tooltip>
        }
      />
      <AccessNoticeSlot />
      <div className="workspace-body">
        <aside
          id="workspace-navigation"
          className="workspace-navigation"
          data-collapsed={navCollapsed || undefined}
          style={
            navWidth === undefined
              ? undefined
              : ({ '--sidebar-width': `${navWidth}px` } as CSSProperties)
          }
        >
          <div className="workspace-navigation-top">
            <Tooltip side="right" content={`New work (${displayShortcut(shortcuts.newWork)})`}>
              <button
                type="button"
                className="workspace-new-work"
                onClick={focusComposer}
                aria-label="New work"
              >
                <Plus size={16} aria-hidden="true" />
                <span>New work</span>
              </button>
            </Tooltip>
            <Tooltip
              side="right"
              content={`${navCollapsed ? 'Expand' : 'Collapse'} sidebar (${displayShortcut(shortcuts.sidebar)})`}
            >
              <button
                type="button"
                className="workspace-nav-toggle"
                aria-label={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!navCollapsed}
                onClick={toggleNav}
              >
                {navCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </button>
            </Tooltip>
          </div>
          <nav aria-label="Workspace" className="workspace-nav-list">
            {PRIMARY_VIEWS.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  if (item.id === 'kanban') {
                    // Work lists every project; a project row opens one project's work.
                    selectWork();
                    useWorkViewStore.getState().setScope('all');
                  }
                  setActiveTab(item.id);
                }}
                aria-current={
                  item.id === 'kanban'
                    ? activeTab === 'kanban' &&
                      !selectedTaskId &&
                      !selectedSessionId &&
                      !selectedManagedId &&
                      workScope === 'all'
                      ? 'page'
                      : undefined
                    : view.group === item.group
                      ? 'page'
                      : undefined
                }
                aria-label={
                  item.id === 'bots' && (botsWaiting > 0 || botsUnread > 0)
                    ? [
                        item.label,
                        botsWaiting ? `${botsWaiting} waiting on you` : '',
                        botsUnread
                          ? `${botsUnread} new ${botsUnread === 1 ? 'reply' : 'replies'}`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(', ')
                    : item.label
                }
                title={item.label}
                className="workspace-nav-item"
                data-unread={(item.id === 'bots' && !botsWaiting && botsUnread > 0) || undefined}
              >
                <item.icon aria-hidden="true" />
                <span>{item.label}</span>
                {item.id === 'kanban' && <NeedsYouCount />}
                {item.id === 'bots' && botsWaiting > 0 && (
                  <small className="workspace-nav-count" aria-hidden="true">
                    {botsWaiting}
                  </small>
                )}
              </button>
            ))}
          </nav>
          {navCollapsed ? (
            <CollapsedProjects {...projectActions} />
          ) : (
            <WorkSidebar
              {...projectActions}
              activeTab={activeTab}
              onOpen={() => setActiveTab('kanban')}
              onAddProject={openProjectSetup}
            />
          )}
          <Tooltip side="right" content={`Settings (${displayShortcut(shortcuts.settings)})`}>
            <button
              type="button"
              className="workspace-nav-item workspace-settings"
              aria-label="Settings"
              aria-current={activeTab === 'preferences' ? 'page' : undefined}
              onClick={() => navigate('preferences')}
            >
              <Settings2 aria-hidden="true" />
              <span>Settings</span>
            </button>
          </Tooltip>
        </aside>
        {!navCollapsed && (
          <ResizeHandle
            orientation="vertical"
            label="Resize sidebar"
            controls="workspace-navigation"
            className="workspace-navigation-resizer"
            value={navWidth ?? SIDEBAR_WIDTH}
            min={SIDEBAR_MIN}
            max={SIDEBAR_MAX}
            onResize={(width) => useWorkViewStore.getState().setSize('sidebar', width)}
            onReset={() => useWorkViewStore.getState().setSize('sidebar', null)}
          />
        )}
        <main
          ref={canvas}
          id="workspace-content"
          tabIndex={-1}
          className="workspace-canvas"
          aria-label={view.label}
        >
          {view.group !== 'settings' && view.group !== 'tasks' && subnavigation.length > 1 && (
            <WorkspaceSubnavigation
              label={`${view.group.charAt(0).toUpperCase()}${view.group.slice(1)} views`}
              value={highlightedView(activeTab)}
              onChange={navigate}
              items={subnavigation.map((item) => ({ id: item.id, label: viewLabel(item.id) }))}
            />
          )}
          {commandError && (
            <InlineNotice
              tone="error"
              action={<DismissButton onDismiss={() => setCommandError('')} />}
            >
              {commandError}
            </InlineNotice>
          )}
          {activeTab === 'kanban' && <WorkTabs />}
          <PageErrorBoundary
            feature={view.feature}
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
                  <WorkspaceHeading title={view.label} />
                  <LoadingState compact label={`Opening ${view.label}…`} />
                </WorkspacePage>
              }
            >
              {page(viewContext)}
            </Suspense>
          </PageErrorBoundary>
        </main>
      </div>
      <UpdateNotice />
      {removingProject && (
        <Suspense fallback={null}>
          <RemoveProjectAction
            project={removingProject}
            open
            onOpenChange={(open) => {
              if (!open) {
                setRemovingProject(null);
                requestAnimationFrame(() => {
                  const target = removeReturnFocus.current;
                  (target?.isConnected ? target : canvas.current)?.focus();
                });
              }
            }}
          />
        </Suspense>
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
        onInvitations={() => {
          setSettingsProjectId(undefined);
          setSettingsCategory('Invitations');
          setActiveTab('preferences');
        }}
      />

      <Suspense fallback={null}>
        {commandsSeen && (
          <CommandPalette
            isOpen={commandsOpen}
            onClose={() => setCommandsOpen(false)}
            onNavigate={navigate}
            onSelectProject={switchProject}
            context={commandContext}
            onCommand={(command) => runCommand(command)}
          />
        )}
      </Suspense>
      <WelcomeDialog />
      <WhatsNewDialog />
      <ShortcutSheet />
    </div>
  );
}
