import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, GitBranch, Search, Settings2, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { planningDraft } from '../../lib/planning';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { AuditLogWorkspace } from '../audit/AuditLogWorkspace';
import { BrowserHarness } from '../browser/BrowserHarness';
import { KanbanBoard } from '../kanban/KanbanBoard';
import { McpWorkspace } from '../mcp/McpWorkspace';
import { DeviceMesh } from '../mesh/DeviceMesh';
import { WorktreeManager } from '../projects/WorktreeManager';
import { ScheduleManager } from '../schedules/ScheduleManager';
import { SettingsDialog } from '../settings/SettingsDialog';
import { HistoryRecoveryNotice } from '../tasks/HistoryRecoveryNotice';
import { ProjectSetup } from '../tasks/ProjectSetup';
import { RunnerConnections } from '../tasks/RunnerConnections';
import { TaskWorkspace } from '../tasks/TaskWorkspace';
import { UsageDashboard } from '../tasks/UsageDashboard';
import { ArcColorPicker } from '../theme/ArcColorPicker';
import { CodebaseMap } from '../visualizer/CodebaseMap';
import { CommandPalette } from './CommandPalette';
import { type ActiveTab, WORKSPACE_VIEWS } from './navigation';
import { ResizeHandles } from './ResizeHandles';
import { TitleBar } from './TitleBar';

export type { ActiveTab } from './navigation';

export function Shell({ initialTaskAgent }: { initialTaskAgent?: string } = {}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('kanban');
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [newTaskAgent, setNewTaskAgent] = useState<string | null>(initialTaskAgent ?? null);
  const [plannedTaskId, setPlannedTaskId] = useState<string | null>(null);
  const { projects, activeProjectId, selectProject } = useProjectStore();
  const project = projects.find((item) => item.id === activeProjectId);
  const view = WORKSPACE_VIEWS.find((item) => item.id === activeTab) ?? WORKSPACE_VIEWS[0];
  const shortcut = navigator.platform.includes('Mac') ? '⌘ K' : 'Ctrl K';
  const prepareTask = (id: string) => {
    const task = useTaskStore.getState().tasks.find((task) => task.id === id);
    if (!task) return;
    selectProject(task.projectId);
    useExecutionStore.getState().select(null);
    useExecutionStore.getState().draft(`planning:${id}`, planningDraft(task));
    setNewTaskAgent(null);
    setPlannedTaskId(id);
    setActiveTab('kanban');
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandsOpen((open) => !open);
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
              aria-current={activeTab === item.id ? 'page' : undefined}
              className="workspace-nav-item"
            >
              <item.icon className="size-3.5" />
              <span>{item.label}</span>
            </button>
          ))}
          <span className="mx-2 h-4 w-px bg-[var(--color-border)]" />
          <Menu.Root>
            <Menu.Trigger asChild>
              <button
                type="button"
                className="workspace-nav-item"
                data-active={!view.primary || undefined}
                aria-label="Workspace tools"
              >
                <SlidersHorizontal className="size-3.5" />
                <span>{view.primary ? 'Tools' : view.label}</span>
                <ChevronDown className="size-3" />
              </button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content
                className="workspace-menu w-72"
                align="start"
                sideOffset={10}
                collisionPadding={12}
              >
                {WORKSPACE_VIEWS.filter((item) => !item.primary).map((item) => (
                  <Menu.Item
                    key={item.id}
                    className="workspace-menu-item"
                    onSelect={() => setActiveTab(item.id)}
                  >
                    <item.icon className="size-4 shrink-0 text-[var(--color-accent-ink)]" />
                    <span>
                      <span className="block">{item.label}</span>
                      <span className="block text-xs text-[var(--color-text-muted)] mt-1">
                        {item.description}
                      </span>
                    </span>
                  </Menu.Item>
                ))}
                <Menu.Separator className="menu-separator" />
                <Menu.Item className="workspace-menu-item" onSelect={() => setSettingsOpen(true)}>
                  <Settings2 className="size-4 shrink-0 text-[var(--color-accent-ink)]" />
                  <span>
                    <span className="block">Settings & Preferences</span>
                    <span className="block text-xs text-[var(--color-text-muted)] mt-1">
                      Configure application behavior and project options.
                    </span>
                  </span>
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </nav>
      </div>
      <main
        id="workspace-content"
        tabIndex={-1}
        className="workspace-canvas"
        aria-label={view.label}
      >
        <HistoryRecoveryNotice />
        {activeTab === 'kanban' && (
          <TaskWorkspace
            key={plannedTaskId ?? 'tasks'}
            plannedTaskId={plannedTaskId}
            onPlanHandled={() => setPlannedTaskId(null)}
            newTaskAgent={newTaskAgent}
            onNewTaskHandled={() => setNewTaskAgent(null)}
          />
        )}
        {activeTab === 'board' && (
          <KanbanBoard
            key={activeProjectId}
            onOpenProject={() => setSetupOpen(true)}
            onPrepare={prepareTask}
          />
        )}
        {activeTab === 'worktrees' && (
          <WorktreeManager key={activeProjectId} onOpenProject={() => setSetupOpen(true)} />
        )}
        {activeTab === 'agents' && (
          <RunnerConnections
            onNewTask={(agent) => {
              setPlannedTaskId(null);
              useExecutionStore.getState().select(null);
              setNewTaskAgent(agent);
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
        {activeTab === 'audit' && <AuditLogWorkspace />}
        {activeTab === 'mcps' && <McpWorkspace />}
        {activeTab === 'schedules' && (
          <ScheduleManager
            key={activeProjectId}
            onOpenProject={() => setSetupOpen(true)}
            onPlanning={() => setActiveTab('board')}
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
        {activeTab === 'mesh' && <DeviceMesh />}
      </main>
      <ProjectSetup open={setupOpen} onClose={() => setSetupOpen(false)} />
      <CommandPalette
        isOpen={commandsOpen}
        onClose={() => setCommandsOpen(false)}
        onNavigate={setActiveTab}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
