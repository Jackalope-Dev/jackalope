import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, GitBranch, LifeBuoy, Plus, Search, Settings2 } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { openExternalUrl } from '../../lib/tauri-bridge';
import type { Feature } from '../../lib/telemetry';
import { telemetry } from '../../stores/communityStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Companion } from '../mascot/Companion';
import { CompanionSources } from '../mascot/CompanionSources';
import { ScheduleNotice } from '../schedules/ScheduleNotice';
import type { SettingsCategory } from '../settings/SettingsPage';
import { UpdateNotice } from '../settings/UpdateNotice';
import { CaptureTask } from '../tasks/CaptureTask';
import { HistoryRecoveryNotice } from '../tasks/HistoryRecoveryNotice';
import { UnsavedTasksNotice } from '../tasks/TaskSaveRecovery';
import { TaskWorkspace } from '../tasks/TaskWorkspace';
import { ArcColorPicker } from '../theme/ArcColorPicker';
import { LoadingState } from '../ui/LoadingState';
import { Tooltip } from '../ui/Tooltip';
import { InvitationsButton } from './InvitationsButton';
import { type ActiveTab, WORKSPACE_VIEWS } from './navigation';
import { ResizeHandles } from './ResizeHandles';
import { TitleBar } from './TitleBar';

export type { ActiveTab } from './navigation';

// Workspace views and heavy dialogs load on demand so the first paint ships only
// the task workspace. Each stays in its own chunk keyed by the tab that shows it.
const RepoTodos = lazy(() => import('../tasks/RepoTodos').then((m) => ({ default: m.RepoTodos })));
const CodebaseMap = lazy(() =>
  import('../visualizer/CodebaseMap').then((m) => ({ default: m.CodebaseMap })),
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
  const canvas = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusOnMount && !initialDraftKey && !initialTaskAgent && !initialCapture)
      canvas.current?.focus();
  }, [focusOnMount, initialDraftKey, initialTaskAgent, initialCapture]);
  const openProjectSetup = () => useOnboardingStore.getState().begin();
  const [activeTab, setActiveTab] = useState<ActiveTab>('kanban');
  const previousView = useRef<ActiveTab>('kanban');
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
  useEffect(() => {
    const feature: Partial<Record<ActiveTab, Feature>> = {
      kanban: 'tasks',
      topology: 'codebase',
      agents: 'agents',
      mcps: 'connections',
      'mcp-marketplace': 'connections',
      usage: 'usage',
      browser: 'browser',
      schedules: 'schedules',
      worktrees: 'worktrees',
    };
    const selected = feature[activeTab];
    if (selected) telemetry.track({ name: 'feature_used', feature: selected });
  }, [activeTab]);
  useEffect(() => {
    if (activeTab === 'preferences') telemetry.track({ name: 'feature_used', feature: 'settings' });
  }, [activeTab]);
  const [commandsOpen, setCommandsOpen] = useState(false);
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
  const { projects, activeProjectId, selectProject } = useProjectStore();
  const selectedTaskId = useExecutionStore((state) => state.selectedId);
  const project = projects.find((item) => item.id === activeProjectId);
  const view = WORKSPACE_VIEWS.find((item) => item.id === activeTab) ?? WORKSPACE_VIEWS[0];
  const navigate = useCallback((tab: ActiveTab) => {
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
      setSettingsCategory((event as CustomEvent<SettingsCategory>).detail);
      setActiveTab('preferences');
    };
    window.addEventListener('jackalope:open-settings', handle);
    return () => window.removeEventListener('jackalope:open-settings', handle);
  }, []);
  const shortcut = navigator.platform.includes('Mac') ? '⌘ K' : 'Ctrl K';
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandsOpen((open) => !open);
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'n'
      ) {
        event.preventDefault();
        setCapture({});
      } else if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        setActiveTab((current) =>
          current === 'preferences' ? previousView.current : 'preferences',
        );
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-content">
        Skip to workspace
      </a>
      <ResizeHandles />
      <TitleBar />
      <header className="workspace-chrome">
        <div className="flex items-center gap-4 min-w-0">
          <img src="/mascot.svg" alt="Jackalope" className="size-8 shrink-0" />
          <Menu.Root>
            <Menu.Trigger asChild>
              <button type="button" className="project-switcher" aria-label="Switch project">
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
                    onSelect={() => selectProject(item.id)}
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
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
          {project && (
            <span className="hidden lg:flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <GitBranch className="size-3" />
              {project.gitBranch}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {(activeTab !== 'kanban' || selectedTaskId) && (
            <Tooltip content="New task (Ctrl+Shift+N)">
              <button
                type="button"
                className="command-trigger"
                onClick={() => setCapture({})}
                aria-label="Capture a task"
              >
                <Plus size={16} />
                <span>New task</span>
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
              <Search className="size-3.5" />
              <span className="hidden sm:inline">Jump to…</span>
              <kbd>{shortcut}</kbd>
            </button>
          </Tooltip>
          {showThemePicker && <ArcColorPicker />}
          <Tooltip content="Help Center">
            <button
              type="button"
              onClick={() => void openExternalUrl('https://jackalope.dev/knowledge/')}
              className="quiet-icon"
              aria-label="Help and knowledgebase"
            >
              <LifeBuoy className="size-4" />
            </button>
          </Tooltip>
          <Tooltip content="Settings (Ctrl+,)">
            <button
              type="button"
              onClick={() => setActiveTab('preferences')}
              className="quiet-icon"
              aria-label="Settings and preferences"
            >
              <Settings2 className="size-4" />
            </button>
          </Tooltip>
        </div>
      </header>
      <div className="workspace-navigation">
        <nav aria-label="Workspace" className="flex items-center gap-1">
          {WORKSPACE_VIEWS.filter((item) => item.primary).map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              aria-current={view.group === item.group ? 'page' : undefined}
              className="workspace-nav-item"
            >
              <item.icon className="size-3.5" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <InvitationsButton
          onClick={() => {
            setSettingsCategory('Invitations');
            setActiveTab('preferences');
          }}
        />
      </div>
      <main
        ref={canvas}
        id="workspace-content"
        tabIndex={-1}
        className="workspace-canvas"
        aria-label={view.label}
      >
        {view.group !== 'settings' &&
          view.group !== 'agents' &&
          WORKSPACE_VIEWS.filter((item) => item.group === view.group).length > 1 && (
            <div>
              <nav aria-label={`${view.group} views`} className="workspace-subnavigation">
                {WORKSPACE_VIEWS.filter((item) => item.group === view.group).map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-current={activeTab === item.id ? 'page' : undefined}
                    onClick={() => navigate(item.id)}
                    className="workspace-nav-item"
                  >
                    {item.id === 'kanban'
                      ? 'Work'
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
                                : item.label}
                  </button>
                ))}
              </nav>
            </div>
          )}
        <Suspense fallback={<LoadingState label={`Opening ${view.label}…`} />}>
          {activeTab === 'kanban' && (
            <TaskWorkspace
              onOpenProject={openProjectSetup}
              onCapture={(ideaId) => setCapture({ ideaId })}
              onSchedule={(id) => {
                const run = useExecutionStore.getState().runs.find((r) => r.id === id);
                if (run) selectProject(run.projectId);
                setScheduleRunId(id);
                setActiveTab('schedules');
              }}
            />
          )}
          {activeTab === 'worktrees' && (
            <WorktreeManager key={activeProjectId} onOpenProject={openProjectSetup} />
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
              key={settingsCategory}
              initialCategory={settingsCategory}
              onClose={() => setActiveTab(previousView.current)}
            />
          )}
          {activeTab === 'agent-settings' && (
            <section className="workspace-page agent-settings-page w-full">
              <AgentManager key={configuredAgent} initialAgentId={configuredAgent} />
            </section>
          )}
          {activeTab === 'project-settings' && <ProjectPreferences key={activeProjectId} />}
          {activeTab === 'project-knowledge' && <ProjectContext key={activeProjectId} />}
          {(activeTab === 'mcps' || activeTab === 'mcp-marketplace') && (
            <McpWorkspace
              view={activeTab === 'mcps' ? 'configured' : 'marketplace'}
              onViewChange={(next) => navigate(next === 'configured' ? 'mcps' : 'mcp-marketplace')}
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
          {activeTab === 'topology' && <CodebaseMap onOpenProject={openProjectSetup} />}
        </Suspense>
      </main>
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
      <ScheduleNotice />
      <HistoryRecoveryNotice />
      <UnsavedTasksNotice />
      <CompanionSources />
      <Companion
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
            onCapture={() => setCapture({})}
            onOpenSettings={() => setActiveTab('preferences')}
          />
        )}
      </Suspense>
    </div>
  );
}
