import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Bot,
  ChevronDown,
  Download,
  FolderGit2,
  FolderKanban,
  GitBranch,
  Layers,
  Moon,
  Paintbrush,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sliders,
  Sun,
  TestTube2,
  Wrench,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { PRESET_THEMES } from '../../lib/theme-engine';
import { type MascotMood, useMascotStore } from '../../stores/mascotStore';
import { useProjectStore } from '../../stores/projectStore';
import {
  type DefaultRunnerId,
  type NotificationLevel,
  useSettingsStore,
} from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { JackalopeMascot } from '../mascot/JackalopeMascot';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { useDialogFocus } from '../ui/useDialogFocus';
import './settings.css';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  initialScope?: 'app' | 'project';
  initialProjectId?: string;
}

export function SettingsDialog({
  open,
  onClose,
  initialScope = 'app',
  initialProjectId,
}: SettingsDialogProps) {
  const dialogFocus = useDialogFocus();
  const settings = useSettingsStore();
  const { currentTheme, setTheme } = useThemeStore();
  const { mood, setMood, pet } = useMascotStore();
  const { projects, activeProjectId, updateProject, updateProjectPreferences } =
    useProjectStore();

  const [scope, setScope] = useState<'app' | 'project'>(initialScope);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    initialProjectId || activeProjectId || projects[0]?.id || '',
  );
  const [appCategory, setAppCategory] = useState<
    'general' | 'agents' | 'git' | 'privacy' | 'advanced'
  >('general');
  const [projectCategory, setProjectCategory] = useState<
    'repo' | 'agent' | 'instructions' | 'verification' | 'worktrees'
  >('repo');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedExport, setCopiedExport] = useState(false);

  const activeProject = projects.find((p) => p.id === selectedProjectId) ?? projects[0];

  const isAdvanced = settings.experienceMode === 'advanced';

  const companionMoods: MascotMood[] = ['idle', 'thinking', 'working', 'success', 'sleep'];

  const handleExport = () => {
    const data = settings.exportSettings();
    navigator.clipboard.writeText(data).then(() => {
      setCopiedExport(true);
      setTimeout(() => setCopiedExport(false), 2000);
    });
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="settings-dialog-overlay" />
        <Dialog.Content {...dialogFocus} className="settings-dialog appearance-panel" aria-label="Settings and Preferences">
          {/* Top Bar */}
          <header className="settings-header">
            <div className="flex items-center gap-3 min-w-0">
              <Settings2 className="size-5 text-[var(--color-accent-ink)] shrink-0" />
              <Dialog.Title className="text-base font-semibold tracking-tight hidden sm:inline">
                Settings
              </Dialog.Title>

              {/* Scope Switcher */}
              <div className="settings-scope-switcher">
                <button
                  type="button"
                  onClick={() => setScope('app')}
                  className={`settings-scope-pill ${scope === 'app' ? 'is-active' : ''}`}
                >
                  App-wide
                </button>

                {projects.length > 0 ? (
                  <DropdownMenu.Root>
                    <div className="inline-flex items-center">
                      <button
                        type="button"
                        onClick={() => setScope('project')}
                        className={`settings-scope-pill ${scope === 'project' ? 'is-active' : ''}`}
                      >
                        <span className="truncate max-w-36">
                          {activeProject ? `Project: ${activeProject.name}` : 'Project'}
                        </span>
                      </button>
                      <DropdownMenu.Trigger asChild>
                        <button
                          type="button"
                          className="px-1.5 py-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                          aria-label="Select project for settings"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </DropdownMenu.Trigger>
                    </div>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        className="workspace-menu min-w-48 z-[90]"
                        align="start"
                        sideOffset={6}
                      >
                        <DropdownMenu.Label className="menu-label">
                          Select Project
                        </DropdownMenu.Label>
                        {projects.map((p) => (
                          <DropdownMenu.Item
                            key={p.id}
                            onSelect={() => {
                              setSelectedProjectId(p.id);
                              setScope('project');
                            }}
                            className="workspace-menu-item"
                          >
                            <span className="flex-1 truncate">{p.name}</span>
                          </DropdownMenu.Item>
                        ))}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                ) : (
                  <button
                    type="button"
                    onClick={() => setScope('project')}
                    className={`settings-scope-pill ${scope === 'project' ? 'is-active' : ''}`}
                  >
                    Project
                  </button>
                )}
              </div>
            </div>

            {/* Right Header Actions: Filter, Mode Switcher, Close */}
            <div className="flex items-center gap-3">
              {/* Filter */}
              <div className="relative hidden md:block">
                <Search
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter settings…"
                  className="bg-[var(--color-surface-sunken)] text-xs rounded-lg pl-8 pr-3 py-1.5 border border-[var(--color-border-subtle)] focus:border-[var(--color-accent-ink)] outline-none w-36 focus:w-48 transition-all"
                />
              </div>

              {/* Simple / Advanced Toggle */}
              <button
                type="button"
                onClick={() =>
                  settings.updateSettings({
                    experienceMode: isAdvanced ? 'essential' : 'advanced',
                  })
                }
                className={`settings-mode-pill ${isAdvanced ? 'is-advanced' : ''}`}
                title={
                  isAdvanced
                    ? 'Advanced mode enabled: showing all technical dials'
                    : 'Simple mode: showing essential settings'
                }
              >
                <Sliders size={13} />
                <span>{isAdvanced ? 'Advanced' : 'Simple'}</span>
              </button>

              <Dialog.Close asChild>
                <button
                  type="button"
                  className="quiet-icon"
                  aria-label="Close settings"
                  onClick={onClose}
                >
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>
          </header>

          <Dialog.Description className="sr-only">
            Configure application-wide preferences and per-project options for Jackalope.
          </Dialog.Description>

          {/* Body */}
          <div className="settings-body">
            {/* Sidebar Navigation */}
            <aside className="settings-sidebar">
              {scope === 'app' ? (
                <>
                  <button
                    type="button"
                    onClick={() => setAppCategory('general')}
                    className={`settings-nav-item ${appCategory === 'general' ? 'is-active' : ''}`}
                  >
                    <Paintbrush size={15} />
                    <span>Appearance & Mascot</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAppCategory('agents')}
                    className={`settings-nav-item ${appCategory === 'agents' ? 'is-active' : ''}`}
                  >
                    <Bot size={15} />
                    <span>Agents & Execution</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAppCategory('git')}
                    className={`settings-nav-item ${appCategory === 'git' ? 'is-active' : ''}`}
                  >
                    <GitBranch size={15} />
                    <span>Git & Worktrees</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAppCategory('privacy')}
                    className={`settings-nav-item ${appCategory === 'privacy' ? 'is-active' : ''}`}
                  >
                    <ShieldCheck size={15} />
                    <span>Privacy & Telemetry</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAppCategory('advanced')}
                    className={`settings-nav-item ${appCategory === 'advanced' ? 'is-active' : ''}`}
                  >
                    <Wrench size={15} />
                    <span>Advanced & System</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setProjectCategory('repo')}
                    className={`settings-nav-item ${projectCategory === 'repo' ? 'is-active' : ''}`}
                  >
                    <FolderKanban size={15} />
                    <span>Repository & Details</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setProjectCategory('agent')}
                    className={`settings-nav-item ${projectCategory === 'agent' ? 'is-active' : ''}`}
                  >
                    <Bot size={15} />
                    <span>Preferred Runner</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setProjectCategory('instructions')}
                    className={`settings-nav-item ${projectCategory === 'instructions' ? 'is-active' : ''}`}
                  >
                    <Layers size={15} />
                    <span>Task Instructions</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setProjectCategory('verification')}
                    className={`settings-nav-item ${projectCategory === 'verification' ? 'is-active' : ''}`}
                  >
                    <TestTube2 size={15} />
                    <span>Verification & Tests</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setProjectCategory('worktrees')}
                    className={`settings-nav-item ${projectCategory === 'worktrees' ? 'is-active' : ''}`}
                  >
                    <FolderGit2 size={15} />
                    <span>Worktree Isolation</span>
                  </button>
                </>
              )}
            </aside>

            {/* Content Canvas */}
            <main className="settings-content">
              {scope === 'app' ? (
                /* ================= APP-WIDE SETTINGS ================= */
                <div>
                  {appCategory === 'general' && (
                    <section>
                      <div className="settings-section-header">
                        <h2 className="settings-section-title">Appearance & Mascot</h2>
                        <p className="settings-section-subtitle">
                          Personalize Jackalope's visual theme, companion reactions, and alert
                          behavior.
                        </p>
                      </div>

                      {/* Mascot Interactive Box */}
                      <div className="settings-companion-box">
                        <div
                          className="settings-companion-avatar cursor-pointer"
                          onClick={pet}
                          title="Click to pet!"
                        >
                          <JackalopeMascot size="lg" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Jackalope Mascot Companion</span>
                            <button
                              type="button"
                              onClick={pet}
                              className="text-xs text-[var(--color-accent-ink)] hover:underline"
                            >
                              Pet companion
                            </button>
                          </div>
                          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                            Reacts to agent tasks, celebrating success and resting when idle.
                          </p>
                          <div className="settings-mood-chips">
                            {companionMoods.map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => setMood(m)}
                                className={`settings-mood-chip ${mood === m ? 'is-active' : ''}`}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="settings-group">
                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Appearance Mode</span>
                            <span className="settings-row-description">
                              Choose light or dark surface palette.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <div className="inline-flex rounded-lg border border-[var(--color-border)] p-1 bg-[var(--color-surface-sunken)]">
                              <button
                                type="button"
                                onClick={() => setTheme({ ...currentTheme, isDark: false })}
                                className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                                  !currentTheme.isDark
                                    ? 'bg-[var(--color-surface-elevated)] text-[var(--color-accent-ink)] shadow-sm'
                                    : 'text-[var(--color-text-secondary)]'
                                }`}
                              >
                                <Sun size={13} />
                                Light
                              </button>
                              <button
                                type="button"
                                onClick={() => setTheme({ ...currentTheme, isDark: true })}
                                className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                                  currentTheme.isDark
                                    ? 'bg-[var(--color-surface-elevated)] text-[var(--color-accent-ink)] shadow-sm'
                                    : 'text-[var(--color-text-secondary)]'
                                }`}
                              >
                                <Moon size={13} />
                                Dark
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Theme Preset</span>
                            <span className="settings-row-description">
                              Select from handcrafted atmospheric palettes.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <Select
                              value={currentTheme.id}
                              onValueChange={(themeId) => {
                                const preset = PRESET_THEMES.find((p) => p.id === themeId);
                                if (preset) {
                                  setTheme({
                                    ...preset,
                                    isDark: currentTheme.isDark,
                                    atmosphere: currentTheme.atmosphere,
                                  });
                                }
                              }}
                            >
                              {PRESET_THEMES.map((theme) => (
                                <SelectItem key={theme.id} value={theme.id}>
                                  {theme.name}
                                </SelectItem>
                              ))}
                            </Select>
                          </div>
                        </div>

                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Atmosphere Tint</span>
                            <span className="settings-row-description">
                              Adjust ambient perimeter color saturation.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={currentTheme.atmosphere}
                              onChange={(e) =>
                                setTheme({
                                  ...currentTheme,
                                  atmosphere: Number(e.target.value),
                                })
                              }
                              className="theme-range w-32 cursor-pointer"
                              aria-label="Atmosphere Tint"
                            />
                            <span className="text-xs text-[var(--color-text-muted)] w-8 text-right">
                              {currentTheme.atmosphere}%
                            </span>
                          </div>
                        </div>

                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Companion Reactions</span>
                            <span className="settings-row-description">
                              Allow mascot to celebrate task completions and express mood.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <Switch
                              checked={settings.mascotReactions}
                              onCheckedChange={(checked) =>
                                settings.updateSettings({ mascotReactions: checked })
                              }
                              label="Companion Reactions"
                            />
                          </div>
                        </div>

                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Completion Sound Alerts</span>
                            <span className="settings-row-description">
                              Play subtle auditory chime when background tasks finish.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <Switch
                              checked={settings.soundAlerts}
                              onCheckedChange={(checked) =>
                                settings.updateSettings({ soundAlerts: checked })
                              }
                              label="Sound Alerts"
                            />
                          </div>
                        </div>

                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Task Notifications</span>
                            <span className="settings-row-description">
                              Desktop notification triggers when tasks complete or encounter errors.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <Select
                              value={settings.notifications}
                              onValueChange={(val) =>
                                settings.updateSettings({
                                  notifications: val as NotificationLevel,
                                })
                              }
                            >
                              <SelectItem value="all">All tasks</SelectItem>
                              <SelectItem value="failures-only">Failures only</SelectItem>
                              <SelectItem value="none">Disabled</SelectItem>
                            </Select>
                          </div>
                        </div>
                      </div>
                    </section>
                  )}

                  {appCategory === 'agents' && (
                    <section>
                      <div className="settings-section-header">
                        <h2 className="settings-section-title">Agents & Execution</h2>
                        <p className="settings-section-subtitle">
                          Set application defaults for agent runners and parallel task coordination.
                        </p>
                      </div>

                      <div className="settings-group">
                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Default Agent Runner</span>
                            <span className="settings-row-description">
                              Fallback runner when a project has no specific override.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <Select
                              value={settings.defaultRunner}
                              onValueChange={(val) =>
                                settings.updateSettings({
                                  defaultRunner: val as DefaultRunnerId,
                                })
                              }
                            >
                              <SelectItem value="codex">Codex (CLI)</SelectItem>
                              <SelectItem value="claude">Claude Code (CLI)</SelectItem>
                              <SelectItem value="grok">Grok (CLI)</SelectItem>
                            </Select>
                          </div>
                        </div>

                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Parallel Concurrency Limit</span>
                            <span className="settings-row-description">
                              Maximum concurrent agent execution slots (1 to 6).
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <input
                              type="range"
                              min={1}
                              max={6}
                              value={settings.concurrencyLimit}
                              onChange={(e) =>
                                settings.updateSettings({
                                  concurrencyLimit: Number(e.target.value),
                                })
                              }
                              className="theme-range w-28 cursor-pointer"
                              aria-label="Parallel Concurrency Limit"
                            />
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[var(--color-surface-sunken)] border border-[var(--color-border)]">
                              {settings.concurrencyLimit} {settings.concurrencyLimit === 1 ? 'task' : 'tasks'}
                            </span>
                          </div>
                        </div>

                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Auto-scroll Activity Stream</span>
                            <span className="settings-row-description">
                              Keep activity logs scrolled to latest output as agents run.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <Switch
                              checked={settings.autoScrollLogs}
                              onCheckedChange={(checked) =>
                                settings.updateSettings({ autoScrollLogs: checked })
                              }
                              label="Auto-scroll Activity Stream"
                            />
                          </div>
                        </div>

                        {isAdvanced && (
                          <>
                            <div className="settings-row">
                              <div className="settings-row-info">
                                <span className="settings-row-label">
                                  <span>Activity Log Buffer Limit</span>
                                  <span className="settings-badge-advanced">Advanced</span>
                                </span>
                                <span className="settings-row-description">
                                  Maximum output lines retained in active memory per task run.
                                </span>
                              </div>
                              <div className="settings-control-wrapper">
                                <Select
                                  value={String(settings.maxLogLines)}
                                  onValueChange={(val) =>
                                    settings.updateSettings({ maxLogLines: Number(val) })
                                  }
                                >
                                  <SelectItem value="500">500 lines</SelectItem>
                                  <SelectItem value="1000">1,000 lines</SelectItem>
                                  <SelectItem value="2500">2,500 lines</SelectItem>
                                  <SelectItem value="5000">5,000 lines</SelectItem>
                                </Select>
                              </div>
                            </div>

                            <div className="settings-row">
                              <div className="settings-row-info">
                                <span className="settings-row-label">
                                  <span>Execution Timeout</span>
                                  <span className="settings-badge-advanced">Advanced</span>
                                </span>
                                <span className="settings-row-description">
                                  Automatically stop long-running task attempts after duration.
                                </span>
                              </div>
                              <div className="settings-control-wrapper">
                                <Select
                                  value={String(settings.taskTimeoutMinutes)}
                                  onValueChange={(val) =>
                                    settings.updateSettings({
                                      taskTimeoutMinutes: Number(val),
                                    })
                                  }
                                >
                                  <SelectItem value="0">No timeout (Infinite)</SelectItem>
                                  <SelectItem value="15">15 minutes</SelectItem>
                                  <SelectItem value="30">30 minutes</SelectItem>
                                  <SelectItem value="60">60 minutes</SelectItem>
                                </Select>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </section>
                  )}

                  {appCategory === 'git' && (
                    <section>
                      <div className="settings-section-header">
                        <h2 className="settings-section-title">Git & Worktrees</h2>
                        <p className="settings-section-subtitle">
                          Manage repository branch naming, default base branch, and worktree isolation.
                        </p>
                      </div>

                      <div className="settings-group">
                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Task Branch Prefix</span>
                            <span className="settings-row-description">
                              Prefix applied to automatically created worktree branches.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <input
                              type="text"
                              value={settings.branchPrefix}
                              onChange={(e) =>
                                settings.updateSettings({ branchPrefix: e.target.value })
                              }
                              placeholder="jackalope/"
                              className="settings-input"
                            />
                          </div>
                        </div>

                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Default Base Branch</span>
                            <span className="settings-row-description">
                              Branch used as the foundation when isolating new tasks.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <input
                              type="text"
                              value={settings.baseBranch}
                              onChange={(e) =>
                                settings.updateSettings({ baseBranch: e.target.value })
                              }
                              placeholder="auto (master / main)"
                              className="settings-input"
                            />
                          </div>
                        </div>

                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Worktree Folder Name</span>
                            <span className="settings-row-description">
                              Relative subfolder inside repository where task worktrees are checked out.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <input
                              type="text"
                              value={settings.worktreeParentDir}
                              onChange={(e) =>
                                settings.updateSettings({
                                  worktreeParentDir: e.target.value,
                                })
                              }
                              placeholder=".worktrees"
                              className="settings-input"
                            />
                          </div>
                        </div>

                        {isAdvanced && (
                          <div className="settings-row">
                            <div className="settings-row-info">
                              <span className="settings-row-label">
                                <span>Auto-clean Worktree on Merge</span>
                                <span className="settings-badge-advanced">Advanced</span>
                              </span>
                              <span className="settings-row-description">
                                Delete worktree folder and branch immediately after successful merge.
                              </span>
                            </div>
                            <div className="settings-control-wrapper">
                              <Switch
                                checked={settings.pruneWorktreeOnMerge}
                                onCheckedChange={(checked) =>
                                  settings.updateSettings({ pruneWorktreeOnMerge: checked })
                                }
                                label="Auto-clean Worktree on Merge"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {appCategory === 'privacy' && (
                    <section>
                      <div className="settings-section-header">
                        <h2 className="settings-section-title">Privacy & Telemetry</h2>
                        <p className="settings-section-subtitle">
                          Control diagnostic reporting and review Jackalope's strict data boundary.
                        </p>
                      </div>

                      <div className="settings-group">
                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Anonymous Usage Telemetry</span>
                            <span className="settings-row-description">
                              Sends coarse engagement events and coarse timing metrics to help improve
                              Jackalope.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <Switch
                              checked={settings.telemetryEnabled}
                              onCheckedChange={(checked) =>
                                settings.updateSettings({ telemetryEnabled: checked })
                              }
                              label="Anonymous Usage Telemetry"
                            />
                          </div>
                        </div>

                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Crash & Error Reporting</span>
                            <span className="settings-row-description">
                              Sends anonymized exception signatures (error types and call locations)
                              when unexpected crashes occur.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <Switch
                              checked={settings.crashReportingEnabled}
                              onCheckedChange={(checked) =>
                                settings.updateSettings({ crashReportingEnabled: checked })
                              }
                              label="Crash & Error Reporting"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Disclosure Callout Box */}
                      <div className="settings-disclosure-box">
                        <strong>Strict Data Boundary Invariant:</strong>
                        <p className="mt-1">
                          Jackalope runs against private source repositories. Telemetry never captures,
                          stores, or transmits:
                        </p>
                        <ul className="list-disc list-inside mt-2 space-y-1 text-xs">
                          <li>Task prompts or intent instructions</li>
                          <li>Agent output, files, diffs, or code content</li>
                          <li>Repository paths, URLs, or project names</li>
                          <li>Environment variables or credentials</li>
                        </ul>
                      </div>
                    </section>
                  )}

                  {appCategory === 'advanced' && (
                    <section>
                      <div className="settings-section-header">
                        <h2 className="settings-section-title">Advanced & Diagnostics</h2>
                        <p className="settings-section-subtitle">
                          Developer overrides, custom CLI executable paths, and configuration export.
                        </p>
                      </div>

                      <div className="settings-group">
                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Debug Logging</span>
                            <span className="settings-row-description">
                              Print verbose CLI adapter logs and IPC traces to terminal.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <Switch
                              checked={settings.debugLogging}
                              onCheckedChange={(checked) =>
                                settings.updateSettings({ debugLogging: checked })
                              }
                              label="Debug Logging"
                            />
                          </div>
                        </div>

                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Codex Executable Path Override</span>
                            <span className="settings-row-description">
                              Custom binary path if not present in system PATH.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <input
                              type="text"
                              value={settings.customRunnerPaths.codex ?? ''}
                              onChange={(e) =>
                                settings.updateSettings({
                                  customRunnerPaths: {
                                    ...settings.customRunnerPaths,
                                    codex: e.target.value,
                                  },
                                })
                              }
                              placeholder="e.g. /usr/local/bin/codex"
                              className="settings-input"
                            />
                          </div>
                        </div>

                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Claude Code Executable Override</span>
                            <span className="settings-row-description">
                              Custom binary path for claude CLI.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <input
                              type="text"
                              value={settings.customRunnerPaths.claude ?? ''}
                              onChange={(e) =>
                                settings.updateSettings({
                                  customRunnerPaths: {
                                    ...settings.customRunnerPaths,
                                    claude: e.target.value,
                                  },
                                })
                              }
                              placeholder="e.g. /opt/homebrew/bin/claude"
                              className="settings-input"
                            />
                          </div>
                        </div>

                        <div className="settings-row">
                          <div className="settings-row-info">
                            <span className="settings-row-label">Grok Executable Override</span>
                            <span className="settings-row-description">
                              Custom binary path for grok CLI.
                            </span>
                          </div>
                          <div className="settings-control-wrapper">
                            <input
                              type="text"
                              value={settings.customRunnerPaths.grok ?? ''}
                              onChange={(e) =>
                                settings.updateSettings({
                                  customRunnerPaths: {
                                    ...settings.customRunnerPaths,
                                    grok: e.target.value,
                                  },
                                })
                              }
                              placeholder="e.g. /usr/bin/grok"
                              className="settings-input"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Config Management */}
                      <div className="flex items-center justify-between pt-2">
                        <Button variant="outline" size="sm" onClick={handleExport}>
                          <Download size={14} />
                          {copiedExport ? 'Copied to clipboard!' : 'Export config to clipboard'}
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (window.confirm('Reset all settings to default values?')) {
                              settings.resetAll();
                            }
                          }}
                          className="text-[var(--color-accent-ink)]"
                        >
                          <RotateCcw size={14} />
                          Reset all to defaults
                        </Button>
                      </div>
                    </section>
                  )}
                </div>
              ) : (
                /* ================= PER-PROJECT SETTINGS ================= */
                <div>
                  {!activeProject ? (
                    <div className="text-center py-16">
                      <FolderKanban className="size-10 mx-auto text-[var(--color-text-muted)] mb-3" />
                      <h3 className="text-base font-medium">No project selected</h3>
                      <p className="text-xs text-[var(--color-text-secondary)] mt-1 max-w-sm mx-auto">
                        Add or open a repository first to configure project-specific settings.
                      </p>
                    </div>
                  ) : (
                    <>
                      {projectCategory === 'repo' && (
                        <section>
                          <div className="settings-section-header">
                            <h2 className="settings-section-title">Repository & Details</h2>
                            <p className="settings-section-subtitle">
                              Metadata and local configuration for {activeProject.name}.
                            </p>
                          </div>

                          <div className="settings-group">
                            <div className="settings-row">
                              <div className="settings-row-info">
                                <span className="settings-row-label">Project Name</span>
                                <span className="settings-row-description">
                                  Display label in the workspace header and project switcher.
                                </span>
                              </div>
                              <div className="settings-control-wrapper">
                                <input
                                  type="text"
                                  value={activeProject.name}
                                  onChange={(e) =>
                                    updateProject(activeProject.id, { name: e.target.value })
                                  }
                                  className="settings-input"
                                />
                              </div>
                            </div>

                            <div className="settings-row">
                              <div className="settings-row-info">
                                <span className="settings-row-label">Repository Path</span>
                                <span className="settings-row-description">
                                  Absolute folder path on your local filesystem.
                                </span>
                              </div>
                              <div className="settings-control-wrapper">
                                <code className="text-xs font-mono px-2 py-1 rounded bg-[var(--color-surface-sunken)] border border-[var(--color-border-subtle)] truncate max-w-64">
                                  {activeProject.path}
                                </code>
                              </div>
                            </div>

                            <div className="settings-row">
                              <div className="settings-row-info">
                                <span className="settings-row-label">Active Branch</span>
                                <span className="settings-row-description">
                                  Current primary checkout branch.
                                </span>
                              </div>
                              <div className="settings-control-wrapper">
                                <span className="text-xs font-mono font-medium text-[var(--color-accent-ink)]">
                                  {activeProject.gitBranch}
                                </span>
                              </div>
                            </div>
                          </div>
                        </section>
                      )}

                      {projectCategory === 'agent' && (
                        <section>
                          <div className="settings-section-header">
                            <h2 className="settings-section-title">Preferred Agent Runner</h2>
                            <p className="settings-section-subtitle">
                              Choose which agent Jackalope uses by default for tasks in this project.
                            </p>
                          </div>

                          <div className="settings-group">
                            <div className="settings-row">
                              <div className="settings-row-info">
                                <span className="settings-row-label">Project Agent Runner</span>
                                <span className="settings-row-description">
                                  Overrides the app-wide runner when starting tasks in {activeProject.name}.
                                </span>
                              </div>
                              <div className="settings-control-wrapper">
                                <Select
                                  value={activeProject.preferences?.preferredRunner ?? 'inherit'}
                                  onValueChange={(val) =>
                                    updateProjectPreferences(activeProject.id, {
                                      preferredRunner: val as
                                        | 'inherit'
                                        | 'codex'
                                        | 'claude'
                                        | 'grok',
                                    })
                                  }
                                >
                                  <SelectItem value="inherit">
                                    Inherit App Default ({settings.defaultRunner})
                                  </SelectItem>
                                  <SelectItem value="codex">Codex</SelectItem>
                                  <SelectItem value="claude">Claude Code</SelectItem>
                                  <SelectItem value="grok">Grok</SelectItem>
                                </Select>
                              </div>
                            </div>

                            <div className="settings-row">
                              <div className="settings-row-info">
                                <span className="settings-row-label">
                                  Isolate Tasks by Default
                                </span>
                                <span className="settings-row-description">
                                  Start new tasks in their own isolated Git worktree branch instead of
                                  editing current checkout.
                                </span>
                              </div>
                              <div className="settings-control-wrapper">
                                <Switch
                                  checked={
                                    activeProject.preferences?.isolatedByDefault ?? true
                                  }
                                  onCheckedChange={(checked) =>
                                    updateProjectPreferences(activeProject.id, {
                                      isolatedByDefault: checked,
                                    })
                                  }
                                  label="Isolate Tasks by Default"
                                />
                              </div>
                            </div>
                          </div>
                        </section>
                      )}

                      {projectCategory === 'instructions' && (
                        <section>
                          <div className="settings-section-header">
                            <h2 className="settings-section-title">Task Custom Instructions</h2>
                            <p className="settings-section-subtitle">
                              Persistent guidelines and repository context automatically injected into
                              prompts for this project.
                            </p>
                          </div>

                          <div className="settings-group p-4">
                            <label
                              htmlFor="project-instructions"
                              className="text-xs font-medium text-[var(--color-text-secondary)] block mb-2"
                            >
                              Repository Guidelines & Conventions
                            </label>
                            <textarea
                              id="project-instructions"
                              value={activeProject.preferences?.customInstructions ?? ''}
                              onChange={(e) =>
                                updateProjectPreferences(activeProject.id, {
                                  customInstructions: e.target.value,
                                })
                              }
                              placeholder="e.g. Always verify with pnpm build before completing a task. Follow the guidelines in docs/DESIGN.md. Maintain clean TypeScript strict mode."
                              rows={6}
                              className="settings-textarea"
                            />
                            <p className="text-xs text-[var(--color-text-muted)] mt-2">
                              These instructions will be appended to every task prompt dispatched in{' '}
                              <strong>{activeProject.name}</strong>.
                            </p>
                          </div>
                        </section>
                      )}

                      {projectCategory === 'verification' && (
                        <section>
                          <div className="settings-section-header">
                            <h2 className="settings-section-title">Verification & Tests</h2>
                            <p className="settings-section-subtitle">
                              Configure automatic test and build commands to verify agent work.
                            </p>
                          </div>

                          <div className="settings-group">
                            <div className="settings-row">
                              <div className="settings-row-info">
                                <span className="settings-row-label">Verification Command</span>
                                <span className="settings-row-description">
                                  Shell command executed to verify task results (e.g. tests or build).
                                </span>
                              </div>
                              <div className="settings-control-wrapper">
                                <input
                                  type="text"
                                  value={activeProject.preferences?.verifyCommand ?? ''}
                                  onChange={(e) =>
                                    updateProjectPreferences(activeProject.id, {
                                      verifyCommand: e.target.value,
                                    })
                                  }
                                  placeholder="e.g. pnpm test or cargo test"
                                  className="settings-input font-mono text-xs"
                                />
                              </div>
                            </div>

                            <div className="settings-row">
                              <div className="settings-row-info">
                                <span className="settings-row-label">Auto-suggest Verification</span>
                                <span className="settings-row-description">
                                  Prominently prompt to run verification command when an agent finishes.
                                </span>
                              </div>
                              <div className="settings-control-wrapper">
                                <Switch
                                  checked={activeProject.preferences?.autoVerify ?? true}
                                  onCheckedChange={(checked) =>
                                    updateProjectPreferences(activeProject.id, {
                                      autoVerify: checked,
                                    })
                                  }
                                  label="Auto-suggest Verification"
                                />
                              </div>
                            </div>
                          </div>
                        </section>
                      )}

                      {projectCategory === 'worktrees' && (
                        <section>
                          <div className="settings-section-header">
                            <h2 className="settings-section-title">Worktree Isolation</h2>
                            <p className="settings-section-subtitle">
                              Project-specific overrides for worktree locations and branch naming.
                            </p>
                          </div>

                          <div className="settings-group">
                            <div className="settings-row">
                              <div className="settings-row-info">
                                <span className="settings-row-label">Custom Worktree Folder</span>
                                <span className="settings-row-description">
                                  Override the default worktree parent folder (.worktrees) for this project.
                                </span>
                              </div>
                              <div className="settings-control-wrapper">
                                <input
                                  type="text"
                                  value={activeProject.preferences?.worktreeDir ?? ''}
                                  onChange={(e) =>
                                    updateProjectPreferences(activeProject.id, {
                                      worktreeDir: e.target.value,
                                    })
                                  }
                                  placeholder=".worktrees"
                                  className="settings-input"
                                />
                              </div>
                            </div>

                            <div className="settings-row">
                              <div className="settings-row-info">
                                <span className="settings-row-label">Custom Base Branch</span>
                                <span className="settings-row-description">
                                  Override foundation branch for new task worktrees in this project.
                                </span>
                              </div>
                              <div className="settings-control-wrapper">
                                <input
                                  type="text"
                                  value={activeProject.preferences?.baseBranch ?? ''}
                                  onChange={(e) =>
                                    updateProjectPreferences(activeProject.id, {
                                      baseBranch: e.target.value,
                                    })
                                  }
                                  placeholder="e.g. master or develop"
                                  className="settings-input"
                                />
                              </div>
                            </div>
                          </div>
                        </section>
                      )}
                    </>
                  )}
                </div>
              )}
            </main>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
