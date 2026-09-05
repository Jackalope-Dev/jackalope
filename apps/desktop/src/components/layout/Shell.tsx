import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, GitBranch, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { BrowserHarness } from '../browser/BrowserHarness';
import { KanbanBoard } from '../kanban/KanbanBoard';
import { JackalopeMascot } from '../mascot/JackalopeMascot';
import { DeviceMesh } from '../mesh/DeviceMesh';
import { WorktreeManager } from '../projects/WorktreeManager';
import { ScheduleManager } from '../schedules/ScheduleManager';
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

export function Shell() {
  const [setupOpen, setSetupOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('kanban');
  const [commandsOpen, setCommandsOpen] = useState(false);
  const { projects, activeProjectId, selectProject } = useProjectStore();
  const project = projects.find((item) => item.id === activeProjectId);
  const view = WORKSPACE_VIEWS.find((item) => item.id === activeTab) ?? WORKSPACE_VIEWS[0];
  const shortcut = navigator.platform.includes('Mac') ? '⌘ K' : 'Ctrl K';

  useEffect(() => {
    const openCommands = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandsOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', openCommands);
    return () => window.removeEventListener('keydown', openCommands);
  }, []);

  return (
    <div className="workspace-shell">
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
          <span className="hidden lg:flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
            <GitBranch className="size-3" />
            {project?.gitBranch}
          </span>
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
                      <span className="block text-[11px] text-[var(--color-text-muted)] mt-1">
                        {item.description}
                      </span>
                    </span>
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </nav>
        <div className="flex items-center gap-2">
          <JackalopeMascot size="sm" bubbleAlign="end" bubbleSide="below" />
        </div>
      </div>
      <main className="workspace-canvas" aria-label={view.label}>
        {['schedules', 'browser', 'topology', 'mesh', 'board'].includes(activeTab) && (
          <p className="task-notice px-8">
            Prototype preview · these records and controls are not connected to task execution.
          </p>
        )}
        {activeTab === 'kanban' && <TaskWorkspace />}
        {activeTab === 'board' && <KanbanBoard />}
        {activeTab === 'worktrees' && <WorktreeManager />}
        {activeTab === 'agents' && <RunnerConnections />}
        {activeTab === 'usage' && <UsageDashboard onTask={() => setActiveTab('kanban')} />}
        {activeTab === 'schedules' && <ScheduleManager />}
        {activeTab === 'browser' && <BrowserHarness />}
        {activeTab === 'topology' && <CodebaseMap />}
        {activeTab === 'mesh' && <DeviceMesh />}
      </main>
      <ProjectSetup open={setupOpen} onClose={() => setSetupOpen(false)} />
      <CommandPalette
        isOpen={commandsOpen}
        onClose={() => setCommandsOpen(false)}
        onNavigate={setActiveTab}
      />
    </div>
  );
}
