import { DropdownMenu as Menu } from '@jackalope/ui';
import { Check, ChevronDown, GitBranch, Plus, Search, Settings2 } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { captureDraftForProject } from '../../lib/capture-draft';
import { shortcutLabel } from '../../lib/platform-shortcuts';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import type { Feature } from '../../lib/telemetry';
import { telemetry } from '../../stores/communityStore';
import { useExecutionStore } from '../../stores/executionStore';
import { observeHelper, useHelperStore } from '../../stores/helperStore';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { type Project, useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Companion } from '../mascot/Companion';
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
  type ProjectSettingsDestination,
  USAGE_VIEWS,
  type UsageView,
  WORKSPACE_VIEWS,
} from './navigation';
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
  const projectSwitcher = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnMount && !initialDraftKey && !initialTaskAgent && !initialCapture)
      canvas.current?.focus();
  }, [focusOnMount, initialDraftKey, initialTaskAgent, initialCapture]);
  const openProjectSetup = () => useOnboardingStore.getState().begin();
  const [activeTab, setActiveTab] = useState<ActiveTab>('kanban');
  useEffect(observeHelper, []);
  useEffect(() => {
    useHelperStore.setState({ screen: activeTab });
  }, [activeTab]);
  const [usageView, setUsageView] = useState<UsageView>('tokens');
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
  const [settingsProjectId, setSettingsProjectId] = useState<string>();
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
    useExecutionStore.getState().select(null);
    setActiveTab('kanban');
    setComposerFocus((value) => value + 1);
  }, []);
  const { projects, activeProjectId, selectProject } = useProjectStore();
  const switchProject = (id: string) => {
    if (id === activeProjectId) return;
    const project = projects.find((item) => item.id === id);
    if (!project) return;
    const execution = useExecutionStore.getState();
    execution.draft('capture', captureDraftForProject(execution.drafts, project, activeProjectId));
    selectProject(id);
  };
  const selectedTaskId = useExecutionStore((state) => state.selectedId);
  const project = projects.find((item) => item.id === activeProjectId);
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
  const shortcut = shortcutLabel('K');
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
        focusComposer();
      } else if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        if (activeTab === 'preferences') setActiveTab(previousView.current);
        else navigate('preferences');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, focusComposer, navigate]);

  return (
    <div className="workspace-shell">
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
          {project && (
            <span className="hidden lg:flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <GitBranch className="size-3" />
              {project.gitBranch}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {(activeTab !== 'kanban' || selectedTaskId) && (
            <Tooltip content={`New task (${shortcutLabel('Shift+N')})`}>
              <button
                type="button"
                className="command-trigger"
                onClick={focusComposer}
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
          {!isTauriEnvironment() && showThemePicker && <ArcColorPicker />}
          {!isTauriEnvironment() && (
            <Tooltip content={`Settings (${shortcutLabel(',')})`}>
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
            <WorkspaceSubnavigation
              label={`${view.group} views`}
              value={activeTab}
              onChange={navigate}
              items={WORKSPACE_VIEWS.filter((item) => item.group === view.group).map((item) => ({
                id: item.id,
                label:
                  item.id === 'kanban'
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
                              : item.label,
              }))}
            />
          )}
        {activeTab === 'usage' && (
          <WorkspaceSubnavigation
            label="Usage views"
            items={USAGE_VIEWS}
            value={usageView}
            onChange={setUsageView}
          />
        )}
        <PageErrorBoundary
          key={`${activeTab}:${activeProjectId}:${settingsCategory}`}
          onBack={activeTab === 'kanban' ? undefined : () => setActiveTab('kanban')}
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
            {activeTab === 'usage' && (
              <UsageDashboard view={usageView} onTask={() => setActiveTab('kanban')} />
            )}
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
            {activeTab === 'topology' && <CodebaseMap onOpenProject={openProjectSetup} />}
          </Suspense>
        </PageErrorBoundary>
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
            onCapture={focusComposer}
            onOpenSettings={() => setActiveTab('preferences')}
          />
        )}
      </Suspense>
    </div>
  );
}
