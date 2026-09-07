import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, GitBranch, Plus, Search, Settings2 } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { Feature } from '../../lib/telemetry';
import { telemetry } from '../../stores/communityStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { AgentManager } from '../agents/AgentManager';
import { BrowserHarness } from '../browser/BrowserHarness';
import { Companion } from '../mascot/Companion';
import { CompanionSources } from '../mascot/CompanionSources';
import { McpWorkspace } from '../mcp/McpWorkspace';
import { ProjectPreferences } from '../projects/ProjectPreferences';
import { WorktreeManager } from '../projects/WorktreeManager';
import { ScheduleManager } from '../schedules/ScheduleManager';
import { ScheduleNotice } from '../schedules/ScheduleNotice';
import { SettingsDialog } from '../settings/SettingsDialog';
import { UpdateNotice } from '../settings/UpdateNotice';
import { CaptureTask } from '../tasks/CaptureTask';
import { HistoryRecoveryNotice } from '../tasks/HistoryRecoveryNotice';
import { ProjectSetup } from '../tasks/ProjectSetup';
import { RunnerConnections } from '../tasks/RunnerConnections';
import { UnsavedTasksNotice } from '../tasks/TaskSaveRecovery';
import { TaskWorkspace } from '../tasks/TaskWorkspace';
import { UsageDashboard } from '../tasks/UsageDashboard';
import { ArcColorPicker } from '../theme/ArcColorPicker';
import { CodebaseMap } from '../visualizer/CodebaseMap';
import { CommandPalette } from './CommandPalette';
import { type ActiveTab, WORKSPACE_VIEWS } from './navigation';
import { ResizeHandles } from './ResizeHandles';
import { TitleBar } from './TitleBar';

export type { ActiveTab } from './navigation';

const RepoTodos = lazy(() =>
  import('../tasks/RepoTodos').then((module) => ({ default: module.RepoTodos })),
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
  const canvas = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusOnMount && !initialTaskAgent && !initialCapture) canvas.current?.focus();
  }, [focusOnMount, initialTaskAgent, initialCapture]);
  const [setupOpen, setSetupOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<'General' | 'System' | 'Diagnostics'>(
    'General',
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>('kanban');
  useEffect(() => {
    const feature: Partial<Record<ActiveTab, Feature>> = {
      kanban: 'tasks',
      topology: 'codebase',
      agents: 'agents',
      mcps: 'connections',
      usage: 'usage',
      browser: 'browser',
      schedules: 'schedules',
      worktrees: 'worktrees',
    };
    const selected = feature[activeTab];
    if (selected) telemetry.track({ name: 'feature_used', feature: selected });
  }, [activeTab]);
  useEffect(() => {
    if (settingsOpen) telemetry.track({ name: 'feature_used', feature: 'settings' });
  }, [settingsOpen]);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [capture, setCapture] = useState<{ ideaId?: string; agent?: string; draftKey?: string } | null>(
    initialTaskAgent ? { agent: initialTaskAgent, draftKey: initialDraftKey } : initialCapture ? {} : null,
  );
  const [scheduleRunId, setScheduleRunId] = useState<string>();
  const { projects, activeProjectId, selectProject } = useProjectStore();
  const project = projects.find((item) => item.id === activeProjectId);
  const view = WORKSPACE_VIEWS.find((item) => item.id === activeTab) ?? WORKSPACE_VIEWS[0];
  const navigate = useCallback((tab: ActiveTab) => {
    if (tab === 'audit' || tab === 'mesh') {
      setSettingsCategory(tab === 'audit' ? 'Diagnostics' : 'System');
      setSettingsOpen(true);
    } else setActiveTab(tab);
  }, []);
  useEffect(() => {
    const handle = (event: Event) => navigate((event as CustomEvent<ActiveTab>).detail);
    window.addEventListener('jackalope:navigate', handle);
    return () => window.removeEventListener('jackalope:navigate', handle);
  }, [navigate]);
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
        setSettingsOpen((open) => !open);
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
                <Menu.Item className="workspace-menu-item" onSelect={() => setSetupOpen(true)}>
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
          <button
            type="button"
            className="command-trigger"
            onClick={() => setCapture({})}
            aria-label="Capture a task"
            title="New task (Ctrl+Shift+N)"
          >
            <Plus size={16} />
            <span>New task</span>
          </button>
          <button
            type="button"
            onClick={() => setCommandsOpen(true)}
            className="command-trigger"
            aria-label="Search commands"
          >
            <Search className="size-3.5" />
            <span className="hidden sm:inline">Jump to…</span>
            <kbd>{shortcut}</kbd>
          </button>
          <ArcColorPicker />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="quiet-icon"
            aria-label="Settings and preferences"
            title="Settings (Ctrl+,)"
          >
            <Settings2 className="size-4" />
          </button>
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
        <div className="workspace-nav-support">
          <Menu.Root>
            <Menu.Trigger asChild>
              <button
                type="button"
                className="workspace-nav-item"
                aria-label="Agents and connections"
              >
                Agents & connections
                <ChevronDown size={14} />
              </button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content className="workspace-menu" align="end" sideOffset={8}>
                {WORKSPACE_VIEWS.filter((item) => ['agents', 'mcps'].includes(item.id)).map(
                  (item) => (
                    <Menu.Item
                      key={item.id}
                      className="workspace-menu-item"
                      onSelect={() => navigate(item.id)}
                    >
                      <item.icon size={16} />
                      {item.label}
                    </Menu.Item>
                  ),
                )}
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>
      <main
        ref={canvas}
        id="workspace-content"
        tabIndex={-1}
        className="workspace-canvas"
        aria-label={view.label}
      >
        {WORKSPACE_VIEWS.filter((item) => item.group === view.group).length > 1 && (
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
                          : item.label}
                </button>
              ))}
            </nav>
          </div>
        )}
        {activeTab === 'kanban' && (
          <TaskWorkspace
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
          <WorktreeManager key={activeProjectId} onOpenProject={() => setSetupOpen(true)} />
        )}
        {activeTab === 'repo-todos' && (
          <Suspense
            fallback={
              <p className="workspace-page" role="status">
                Opening repository TODOs…
              </p>
            }
          >
            <RepoTodos
              key={project?.path ?? activeProjectId}
              onOpenProject={() => setSetupOpen(true)}
            />
          </Suspense>
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
        {activeTab === 'agent-settings' && (
          <section className="workspace-page">
            <AgentManager />
          </section>
        )}
        {activeTab === 'project-settings' && <ProjectPreferences key={activeProjectId} />}
        {activeTab === 'mcps' && <McpWorkspace />}
        {activeTab === 'schedules' && (
          <ScheduleManager
            key={activeProjectId}
            sourceRunId={scheduleRunId}
            onSourceHandled={() => setScheduleRunId(undefined)}
            onOpenProject={() => setSetupOpen(true)}
            onPlanning={() => {
              useExecutionStore.getState().select(null);
              setActiveTab('kanban');
            }}
          />
        )}
        {activeTab === 'browser' && (
          <BrowserHarness
            onOpenProject={() => setSetupOpen(true)}
            onTask={(id) => {
              useExecutionStore.getState().select(id);
              setActiveTab('kanban');
            }}
          />
        )}
        {activeTab === 'topology' && <CodebaseMap onOpenProject={() => setSetupOpen(true)} />}
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
          setSettingsOpen(true);
        }}
      />
      <ProjectSetup open={setupOpen} onClose={() => setSetupOpen(false)} />
      <CommandPalette
        isOpen={commandsOpen}
        onClose={() => setCommandsOpen(false)}
        onNavigate={navigate}
        onCapture={() => setCapture({})}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SettingsDialog
        key={settingsCategory + String(settingsOpen)}
        initialCategory={settingsCategory}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
