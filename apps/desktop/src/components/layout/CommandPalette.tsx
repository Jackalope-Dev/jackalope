import { useState, useEffect } from 'react';
import { useMascotStore } from '../../stores/mascotStore';
import { useThemeStore } from '../../stores/themeStore';
import { PRESET_THEMES } from '../../lib/theme-engine';
import {
  KanbanSquare,
  GitBranch,
  Network,
  Share2,
  CalendarClock,
  Globe,
  Bot,
  Sparkles,
  Search,
  Check,
} from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: 'kanban' | 'worktrees' | 'topology' | 'mesh' | 'agents' | 'schedules' | 'browser') => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  onNavigate,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const { pet, say } = useMascotStore();
  const { currentTheme, setTheme } = useThemeStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else {
          // Open
        }
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const NAV_ITEMS = [
    { id: 'kanban', label: 'Go to Task Pipeline (Kanban)', icon: KanbanSquare, category: 'Navigation' },
    { id: 'worktrees', label: 'Go to Git Worktree Harness', icon: GitBranch, category: 'Navigation' },
    { id: 'agents', label: 'Go to Agent Fleet & Terminal Logs', icon: Bot, category: 'Navigation' },
    { id: 'schedules', label: 'Go to Automated Tasks & Cron', icon: CalendarClock, category: 'Navigation' },
    { id: 'browser', label: 'Go to Browser Automation Sandbox', icon: Globe, category: 'Navigation' },
    { id: 'topology', label: 'Go to Topology & Codebase Visualizer', icon: Network, category: 'Navigation' },
    { id: 'mesh', label: 'Go to Multi-Device Mesh', icon: Share2, category: 'Navigation' },
  ] as const;

  const filteredNav = NAV_ITEMS.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase())
  );

  const filteredThemes = PRESET_THEMES.filter((t) =>
    t.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-100">
      <div
        className="fixed inset-0"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl overflow-hidden z-10 flex flex-col">
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)]/40">
          <Search className="w-4 h-4 text-[var(--color-accent)]" />
          <input
            autoFocus
            type="text"
            placeholder="Type a command, view, or theme... (Esc to close)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent border-0 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none"
          />
          <kbd className="px-2 py-0.5 rounded bg-[var(--color-surface-sunken)] border border-[var(--color-border)] font-mono text-[10px] text-[var(--color-text-muted)]">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-3">
          {/* Views & Navigation */}
          {filteredNav.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] px-3 py-1">
                Views & Capabilities
              </div>
              <div className="space-y-0.5">
                {filteredNav.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        onNavigate(item.id);
                        onClose();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-all text-left cursor-pointer"
                    >
                      <Icon className="w-4 h-4 text-[var(--color-accent)]" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick Theme Switching */}
          {filteredThemes.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] px-3 py-1">
                Themes & Accents
              </div>
              <div className="grid grid-cols-2 gap-1 px-1">
                {filteredThemes.map((theme) => {
                  const isSelected = currentTheme.id === theme.id;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => {
                        setTheme(theme);
                        say(`Switched theme to ${theme.name}!`, 2000);
                        onClose();
                      }}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-left hover:bg-[var(--color-surface-hover)] transition-all cursor-pointer"
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                        style={{ backgroundColor: theme.accentHex }}
                      />
                      <span className="truncate text-[var(--color-text-primary)]">{theme.name}</span>
                      {isSelected && <Check className="w-3 h-3 text-[var(--color-accent)] ml-auto" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Mascot Quick Action */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] px-3 py-1">
              Actions
            </div>
            <button
              onClick={() => {
                pet();
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-all text-left cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-[var(--color-accent)]" />
              <span>Pet Jackalope (*happy wiggle*)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
