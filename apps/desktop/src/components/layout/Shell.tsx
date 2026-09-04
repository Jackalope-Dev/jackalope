import { useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useMascotStore } from '../../stores/mascotStore';
import { ArcColorPicker } from '../theme/ArcColorPicker';
import { JackalopeMascot } from '../mascot/JackalopeMascot';
import { KanbanBoard } from '../kanban/KanbanBoard';
import { WorktreeManager } from '../projects/WorktreeManager';
import { AgentFleet } from '../fleet/AgentFleet';
import { ScheduleManager } from '../schedules/ScheduleManager';
import { BrowserHarness } from '../browser/BrowserHarness';
import { CodebaseMap } from '../visualizer/CodebaseMap';
import { DeviceMesh } from '../mesh/DeviceMesh';
import { CommandPalette } from './CommandPalette';
import {
  KanbanSquare,
  GitBranch,
  Bot,
  CalendarClock,
  Globe,
  Network,
  Share2,
  FolderGit2,
  HelpCircle,
  Laptop,
  CheckCircle,
  Sparkles,
  Command,
} from 'lucide-react';

interface ShellProps {
  onRestartOnboarding: () => void;
}

export type ActiveTab =
  | 'kanban'
  | 'worktrees'
  | 'agents'
  | 'schedules'
  | 'browser'
  | 'topology'
  | 'mesh';

export function Shell({ onRestartOnboarding }: ShellProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('kanban');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const { projects, activeProjectId, selectProject } = useProjectStore();
  const { petCount } = useMascotStore();

  const activeProject = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[var(--color-bg)] text-[var(--color-text-primary)]">
      {/* Top Application Bar */}
      <header className="h-12 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-md flex items-center justify-between px-4 z-20 shrink-0 select-none">
        {/* Left: Brand & Workspace Switcher */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
            <span className="font-extrabold tracking-tight text-sm text-[var(--color-text-primary)]">
              JACKALOPE
            </span>
          </div>

          <div className="h-4 w-px bg-[var(--color-border)]" />

          {/* Project Switcher */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--color-surface-sunken)] border border-[var(--color-border)] text-xs font-mono">
            <FolderGit2 className="w-3.5 h-3.5 text-[var(--color-accent)]" />
            <select
              value={activeProjectId || ''}
              onChange={(e) => selectProject(e.target.value)}
              className="bg-transparent border-0 text-xs text-[var(--color-text-primary)] focus:outline-none cursor-pointer"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id} className="bg-[var(--color-surface-elevated)]">
                  {p.name} ({p.gitBranch})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Center: Command Palette Trigger Button */}
        <button
          onClick={() => setIsCommandPaletteOpen(true)}
          className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] hover:bg-[var(--color-surface-hover)] text-xs text-[var(--color-text-secondary)] transition-all cursor-pointer shadow-sm w-72"
        >
          <Command className="w-3 h-3 text-[var(--color-accent)]" />
          <span className="flex-1 text-left">Quick Search & Commands...</span>
          <kbd className="px-1.5 py-0.5 rounded bg-[var(--color-surface-elevated)] border border-[var(--color-border)] font-mono text-[9px]">
            ⌘K
          </kbd>
        </button>

        {/* Right: Actions, Theme Picker & Onboarding */}
        <div className="flex items-center gap-2.5">
          {/* Multi-Device Mesh Pill */}
          <button
            onClick={() => setActiveTab('mesh')}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-xs text-[var(--color-text-secondary)] cursor-pointer transition-all"
            title="Connected Device Mesh"
          >
            <Laptop className="w-3.5 h-3.5 text-emerald-400" />
            <span>3 Devices</span>
          </button>

          {/* Arc / Zen Style Dynamic Color Picker */}
          <ArcColorPicker />

          {/* Help / Restart Onboarding */}
          <button
            onClick={onRestartOnboarding}
            className="p-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
            title="Replay Onboarding Guide"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side Navigation Rail */}
        <aside className="w-56 border-r border-[var(--color-border)] bg-[var(--color-surface)]/50 flex flex-col justify-between p-3 shrink-0">
          <div className="space-y-1">
            <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--color-text-muted)] px-3 py-1.5">
              Control Plane
            </div>

            <nav className="space-y-0.5">
              <button
                onClick={() => setActiveTab('kanban')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'kanban'
                    ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-accent)]/20 shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] border border-transparent'
                }`}
              >
                <KanbanSquare className="w-4 h-4" />
                <span>Task Pipeline</span>
              </button>

              <button
                onClick={() => setActiveTab('worktrees')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'worktrees'
                    ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-accent)]/20 shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] border border-transparent'
                }`}
              >
                <GitBranch className="w-4 h-4" />
                <span>Git Worktrees</span>
              </button>

              <button
                onClick={() => setActiveTab('agents')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'agents'
                    ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-accent)]/20 shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] border border-transparent'
                }`}
              >
                <Bot className="w-4 h-4" />
                <span>Agent Fleet & Logs</span>
              </button>

              <button
                onClick={() => setActiveTab('schedules')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'schedules'
                    ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-accent)]/20 shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] border border-transparent'
                }`}
              >
                <CalendarClock className="w-4 h-4" />
                <span>Automated Tasks</span>
              </button>

              <button
                onClick={() => setActiveTab('browser')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'browser'
                    ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-accent)]/20 shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] border border-transparent'
                }`}
              >
                <Globe className="w-4 h-4" />
                <span>Browser Sandbox</span>
              </button>

              <button
                onClick={() => setActiveTab('topology')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'topology'
                    ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-accent)]/20 shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] border border-transparent'
                }`}
              >
                <Network className="w-4 h-4" />
                <span>Topology Map</span>
              </button>

              <button
                onClick={() => setActiveTab('mesh')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'mesh'
                    ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-accent)]/20 shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] border border-transparent'
                }`}
              >
                <Share2 className="w-4 h-4" />
                <span>Device Mesh</span>
              </button>
            </nav>
          </div>

          {/* Proactive Tip Card in Sidebar */}
          <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-accent)]">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Proactive Tip</span>
            </div>
            <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed">
              Press <b>⌘K</b> anytime to switch between agent logs, cron routines, and worktrees.
            </p>
          </div>
        </aside>

        {/* Center Canvas */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[var(--color-bg)]">
          {activeTab === 'kanban' && <KanbanBoard />}
          {activeTab === 'worktrees' && <WorktreeManager />}
          {activeTab === 'agents' && <AgentFleet />}
          {activeTab === 'schedules' && <ScheduleManager />}
          {activeTab === 'browser' && <BrowserHarness />}
          {activeTab === 'topology' && <CodebaseMap />}
          {activeTab === 'mesh' && <DeviceMesh />}
        </main>
      </div>

      {/* Persistent Bottom Status Bar with Jackalope Mascot Pet */}
      <footer className="h-10 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 flex items-center justify-between px-4 shrink-0 text-xs text-[var(--color-text-secondary)] z-20">
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="flex items-center gap-1 text-emerald-400">
            <CheckCircle className="w-3 h-3" />
            <span>Tauri IPC Ready</span>
          </span>
          <span>•</span>
          <span>Branch: <b>{activeProject?.gitBranch || 'main'}</b></span>
          <span>•</span>
          <span className="hidden md:inline">Engine: <b>Rust Tokio Async</b></span>
        </div>

        {/* Mascot Mascot Host in Status Bar */}
        <div className="flex items-center gap-2.5">
          <span className="hidden sm:inline text-[11px] text-[var(--color-text-muted)]">
            {petCount > 0 ? `Petted ${petCount}x` : 'Click Jackalope to pet'}
          </span>
          <JackalopeMascot size="sm" showBubble={true} />
        </div>
      </footer>

      {/* Global Command Palette Modal */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigate={(tab) => setActiveTab(tab)}
      />
    </div>
  );
}
