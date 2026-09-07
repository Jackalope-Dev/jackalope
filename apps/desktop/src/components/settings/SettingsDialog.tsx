import * as Dialog from '@radix-ui/react-dialog';
import { Search, Settings2, X } from 'lucide-react';
import { useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { type MascotMood, useMascotStore } from '../../stores/mascotStore';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { useProjectStore } from '../../stores/projectStore';
import { type NotificationLevel, useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { AuditLogWorkspace } from '../audit/AuditLogWorkspace';
import { navigateWorkspace } from '../layout/navigation';
import { JackalopeMascot } from '../mascot/JackalopeMascot';
import { ThemeEditor } from '../theme/ThemeEditor';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { useDialogFocus } from '../ui/useDialogFocus';
import { PrivacySettings } from './PrivacySettings';
import { ReleaseSupport } from './ReleaseSupport';
import { Setting } from './Setting';
import { SystemInfoView } from './SystemInfo';
import { WindowBehaviorSettings } from './WindowBehaviorSettings';
import './settings.css';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  initialScope?: 'app' | 'project';
  initialProjectId?: string;
  initialCategory?: Category;
}
const categories = [
  'General',
  'Appearance',
  'Agents',
  'Privacy',
  'Project',
  'Updates & support',
  'Data & reset',
  'System',
  'Diagnostics',
] as const;
type Category = (typeof categories)[number];

export function SettingsDialog({
  open,
  onClose,
  initialScope = 'app',
  initialCategory,
  initialProjectId,
}: SettingsDialogProps) {
  const dialogFocus = useDialogFocus();
  const settings = useSettingsStore();
  const agents = useAgentConfigStore();
  const { currentTheme, setTheme } = useThemeStore();
  const { pet } = useMascotStore();
  const [previewMood, setPreviewMood] = useState<MascotMood>('idle');
  const [category, setCategory] = useState<Category>(
    initialCategory ?? (initialScope === 'project' ? 'Project' : 'General'),
  );
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [resetting, setResetting] = useState(false);
  const matches = (section: Category, words: string) =>
    query.trim()
      ? `${section} ${words}`.toLowerCase().includes(query.trim().toLowerCase())
      : section === category;
  const visible = categories.filter((c) =>
    matches(
      c,
      {
        System: 'device computer operating system architecture git',
        Diagnostics: 'activity log routing events errors codebase',
        General:
          'window close exit system tray background quit minimize guided setup onboarding notifications companion animations quiet',
        Appearance: 'theme color light dark atmosphere mascot companion moods reactions',
        Agents: 'default models allowed restrict manual cli command executable configuration',
        Privacy: 'marketplace MCP network telemetry crash reporting',
        Project: 'repository name path agent instructions verification command',
        'Updates & support':
          'version automatic install release notes help feedback diagnostics report',
        'Data & reset':
          'export clipboard erase delete nuke reset first time setup history local data',
      }[c],
    ),
  );
  const exportConfig = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            settings: JSON.parse(settings.exportSettings()),
            theme: currentTheme,
            desktop: isTauriEnvironment() ? await nativeTask('desktop_settings') : undefined,
            agents: JSON.parse(JSON.stringify(agents)),
          },
          null,
          2,
        ),
      );
      setMessage('Preferences copied to clipboard.');
    } catch (error) {
      setMessage(`Could not copy preferences: ${String(error)}`);
    }
  };
  const reset = async () => {
    if (confirmation !== 'RESET' || resetting) return;
    setResetting(true);
    setMessage('');
    try {
      if (isTauriEnvironment()) await nativeTask('app_reset', { confirmation });
      else {
        for (const key of Object.keys(localStorage))
          if (key.startsWith('jackalope-')) localStorage.removeItem(key);
        window.location.reload();
      }
    } catch (error) {
      setMessage(`Reset failed: ${String(error)}`);
      setResetting(false);
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value && !resetting) {
          setConfirming(false);
          setConfirmation('');
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="settings-dialog-overlay" />
        <Dialog.Content
          {...dialogFocus}
          className="settings-dialog appearance-panel"
          onEscapeKeyDown={(event) => {
            if (resetting) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (resetting) event.preventDefault();
          }}
        >
          <header className="settings-header">
            <div className="flex items-center gap-3">
              <Settings2 size={20} />
              <Dialog.Title className="text-base font-semibold">Settings</Dialog.Title>
            </div>
            <label className="settings-search">
              <Search size={16} />
              <input
                aria-label="Search settings"
                type="search"
                placeholder="Search settings…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <Dialog.Close asChild>
              <button
                type="button"
                className="quiet-icon"
                aria-label="Close settings"
                disabled={resetting}
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">
            General, appearance, agents, privacy, project preferences and local data. Changes save
            immediately unless a Save button is shown.
          </Dialog.Description>
          <div className="settings-body">
            <nav className="settings-sidebar" aria-label="Settings categories">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`settings-nav-item ${category === c && !query ? 'is-active' : ''}`}
                  aria-current={category === c && !query ? 'page' : undefined}
                  onClick={() => {
                    setCategory(c);
                    setQuery('');
                    setMessage('');
                    setConfirming(false);
                    setConfirmation('');
                  }}
                >
                  {c}
                </button>
              ))}
            </nav>
            <main className="settings-content" aria-label="Settings content">
              {!visible.length && <p>No settings match “{query}”.</p>}
              {visible.map((c) => (
                <section key={c} className="settings-section">
                  <h2 className="settings-section-title">{c}</h2>
                  {c === 'General' && (
                    <>
                      <Setting
                        title="Guided setup"
                        description="Choose a project and agent, then prepare your first task."
                      >
                        <Button
                          variant="outline"
                          onClick={() => {
                            onClose();
                            useOnboardingStore.getState().begin();
                          }}
                        >
                          Open guided setup
                        </Button>
                      </Setting>
                      <WindowBehaviorSettings />
                      <Setting
                        title="Companion notifications"
                        description="Choose when Jackalope draws your attention. All notices remain available in the helper."
                      >
                        <Select
                          aria-label="Companion notifications"
                          value={settings.notifications}
                          onValueChange={(value) =>
                            settings.updateSettings({ notifications: value as NotificationLevel })
                          }
                        >
                          <SelectItem value="all">All notifications</SelectItem>
                          <SelectItem value="failures-only">Needs attention only</SelectItem>
                          <SelectItem value="none">Quiet</SelectItem>
                        </Select>
                      </Setting>
                      <Setting
                        title="Companion animations"
                        description="Show reactions and movement for activity. Your reduced-motion preference always applies."
                      >
                        <Switch
                          label="Companion animations"
                          checked={settings.mascotReactions}
                          onCheckedChange={(mascotReactions) =>
                            settings.updateSettings({ mascotReactions })
                          }
                        />
                      </Setting>
                    </>
                  )}
                  {c === 'Appearance' && (
                    <>
                      <p className="settings-section-subtitle mb-6">
                        Changes save immediately and apply throughout Jackalope.
                      </p>
                      <ThemeEditor value={currentTheme} onChange={setTheme} />
                      <div className="settings-companion-box mt-6">
                        <div className="settings-companion-avatar">
                          <JackalopeMascot size="md" overrideMood={previewMood} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">Companion preview</p>
                          <div className="settings-mood-chips">
                            {(
                              ['idle', 'thinking', 'working', 'success', 'sleep'] as MascotMood[]
                            ).map((m) => (
                              <button
                                key={m}
                                type="button"
                                aria-pressed={previewMood === m}
                                className={`settings-mood-chip ${previewMood === m ? 'is-active' : ''}`}
                                onClick={() => setPreviewMood(m)}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                          <Button variant="ghost" size="sm" onClick={pet}>
                            Pet companion
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                  {c === 'Agents' && (
                    <Button
                      onClick={() => {
                        onClose();
                        navigateWorkspace('agent-settings');
                      }}
                    >
                      Open agent configuration
                    </Button>
                  )}
                  {c === 'Privacy' && (
                    <>
                      <PrivacySettings />
                      <div className="settings-group mt-6">
                        <Setting
                          title="Use MCP marketplace"
                          description="Allow searches and server details from allmcps.com. Disabling cancels marketplace requests; configured MCP servers remain available."
                        >
                          <Switch
                            label="Use MCP marketplace"
                            checked={settings.useMcpMarketplace}
                            onCheckedChange={settings.setUseMcpMarketplace}
                          />
                        </Setting>
                      </div>
                      <p className="settings-disclosure-box">
                        Marketplace searches go to AllMCPs, which publicly logs requests, with
                        User-Agent Jackalope/0.1.0. Your connected agents and MCP servers use their
                        own services.
                      </p>
                    </>
                  )}
                  {c === 'Project' && (
                    <Button
                      onClick={() => {
                        if (initialProjectId)
                          useProjectStore.getState().selectProject(initialProjectId);
                        onClose();
                        navigateWorkspace('project-settings');
                      }}
                    >
                      Open project context
                    </Button>
                  )}
                  {c === 'System' && <SystemInfoView />}
                  {c === 'Diagnostics' && <AuditLogWorkspace />}
                  {c === 'Updates & support' && <ReleaseSupport />}
                  {c === 'Data & reset' && (
                    <>
                      <p className="settings-section-subtitle mb-6">
                        Manage this Jackalope profile on this computer.
                      </p>
                      <Button variant="outline" onClick={() => void exportConfig()}>
                        Copy preferences to clipboard
                      </Button>
                      <div className="settings-reset-box mt-6">
                        <h3 className="text-base font-semibold">Reset Jackalope</h3>
                        <p className="settings-row-description mt-3">
                          Erase this profile's projects, task history, drafts, queue, audit log,
                          agent selections and appearance. Jackalope restarts for first-time setup.
                          Repositories, worktrees, external agent sign-ins and agent MCP
                          configuration files are preserved.
                        </p>
                        <p className="settings-row-description mt-3">
                          Stop active tasks and pause queues before resetting. Existing worktrees
                          will remain on disk and can be managed after reopening the repository.
                        </p>
                        {!confirming ? (
                          <Button
                            variant="outline"
                            className="mt-4"
                            onClick={() => {
                              setConfirming(true);
                              setConfirmation('');
                            }}
                          >
                            Reset all local data…
                          </Button>
                        ) : (
                          <div className="mt-4">
                            <label
                              htmlFor="reset-confirmation"
                              className="block text-sm font-medium mb-2"
                            >
                              Type RESET to confirm permanent deletion
                            </label>
                            <input
                              id="reset-confirmation"
                              autoComplete="off"
                              className="settings-input w-full"
                              value={confirmation}
                              disabled={resetting}
                              onChange={(e) => setConfirmation(e.target.value)}
                            />
                            <div className="flex flex-wrap gap-3 mt-4">
                              <Button
                                disabled={confirmation !== 'RESET' || resetting}
                                onClick={() => void reset()}
                              >
                                {resetting ? 'Restarting…' : 'Erase local data and restart'}
                              </Button>
                              <Button
                                variant="ghost"
                                disabled={resetting}
                                onClick={() => {
                                  setConfirming(false);
                                  setConfirmation('');
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </section>
              ))}
              {message && (
                <p role="status" className="settings-disclosure-box">
                  {message}
                </p>
              )}
            </main>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
