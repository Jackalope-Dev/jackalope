import { Search, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { useProjectStore } from '../../stores/projectStore';
import { type NotificationLevel, useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { AuditLogWorkspace } from '../audit/AuditLogWorkspace';
import { ProjectPreferences } from '../projects/ProjectPreferences';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { AgentPreferences } from './AgentPreferences';
import { AppearancePreferences } from './AppearancePreferences';
import { ArchivedHistory } from './ArchivedHistory';
import { JackalopeAccount } from './JackalopeAccount';
import { NotificationSettings } from './NotificationSettings';
import { PrivacySettings } from './PrivacySettings';
import { ReferralSettings } from './ReferralSettings';
import { ReleaseSupport } from './ReleaseSupport';
import { Setting } from './Setting';
import { SystemInfoView } from './SystemInfo';
import { WindowBehaviorSettings } from './WindowBehaviorSettings';
import './settings.css';

interface SettingsPageProps {
  onClose: () => void;
  initialScope?: 'app' | 'project';
  initialProjectId?: string;
  initialCategory?: SettingsCategory;
}
const categories = [
  'General',
  'Jackalope account',
  'Invitations',
  'Appearance',
  'Agents',
  'Privacy',
  'Project',
  'Updates & support',
  'Data & reset',
  'System',
  'Diagnostics',
] as const;
export type SettingsCategory = (typeof categories)[number];

export function SettingsPage({
  onClose,
  initialScope = 'app',
  initialCategory,
  initialProjectId,
}: SettingsPageProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const settings = useSettingsStore();
  const agents = useAgentConfigStore();
  const { currentTheme } = useThemeStore();
  const { projects, activeProjectId } = useProjectStore();
  const [scope, setScope] = useState<'app' | 'project'>(initialScope);
  const [selectedProjectId, setSelectedProjectId] = useState(
    initialProjectId ?? activeProjectId ?? '',
  );
  const project = projects.find((project) => project.id === selectedProjectId);
  const scopedCategories =
    scope === 'project'
      ? categories.filter((c) => ['Project', 'Appearance', 'Agents'].includes(c))
      : categories.filter((c) => c !== 'Project');
  const [category, setCategory] = useState<SettingsCategory>(
    initialCategory ?? (initialScope === 'project' ? 'Project' : 'General'),
  );
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [resetting, setResetting] = useState(false);
  const matches = (section: SettingsCategory, words: string) =>
    query.trim()
      ? `${section} ${words}`.toLowerCase().includes(query.trim().toLowerCase())
      : section === category;
  const visible = scopedCategories.filter((c) =>
    matches(
      c,
      {
        System: 'device computer operating system architecture git',
        'Jackalope account':
          'connect sign in email membership early access invitations disconnect device',
        Invitations: 'invite referral share link email accepted connected early access',
        Diagnostics: 'activity log routing events errors codebase',
        General:
          'window close exit system tray background quit minimize guided setup onboarding notifications companion animations quiet',
        Appearance: 'theme color light dark atmosphere picker toolbar',
        Agents:
          'default models available detected allowed restrict cli command executable configuration',
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
    <section className="workspace-page settings-page">
      <header className="settings-header">
        <div className="flex items-center gap-3">
          <Settings2 size={20} />
          <h1 ref={heading} tabIndex={-1}>
            Settings
          </h1>
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
      </header>
      <p className="sr-only">
        General, appearance, agents, privacy, project preferences and local data. Changes save
        immediately unless a Save button is shown.
      </p>
      <div className="settings-scope-bar">
        <nav className="settings-scope-switcher" aria-label="Settings scope">
          {(['app', 'project'] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={`settings-scope-pill ${scope === value ? 'is-active' : ''}`}
              aria-pressed={scope === value}
              onClick={() => {
                setScope(value);
                setCategory(value === 'app' ? 'General' : 'Project');
                setQuery('');
              }}
            >
              {value === 'app' ? 'App-wide' : 'Per project'}
            </button>
          ))}
        </nav>
        {scope === 'project' && (
          <Select
            aria-label="Project to configure"
            value={selectedProjectId || '__none'}
            onValueChange={setSelectedProjectId}
          >
            {!projects.length && (
              <SelectItem value="__none" disabled>
                No projects added
              </SelectItem>
            )}
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </Select>
        )}
        <p className="task-muted">
          {scope === 'app'
            ? 'Defaults for Jackalope and projects without overrides.'
            : 'Overrides for this project. App-wide restrictions still apply.'}
        </p>
      </div>
      <div className="settings-body">
        <nav className="settings-sidebar" aria-label="Settings categories">
          {scopedCategories.map((c) => (
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
        <div className="settings-content">
          {!visible.length && <p>No settings match “{query}”.</p>}
          {visible.map((c) => (
            <section key={c} className="settings-section">
              <header className="settings-section-header">
                <h2 className="settings-section-title">{c}</h2>
              </header>
              {c === 'Jackalope account' && (
                <JackalopeAccount onInvitations={() => setCategory('Invitations')} />
              )}
              {c === 'Invitations' && (
                <ReferralSettings onAccount={() => setCategory('Jackalope account')} />
              )}
              {c === 'General' && (
                <>
                  <Setting title="Guided setup">
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
                    description="All notices remain in the helper."
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
                  <NotificationSettings />
                  <Setting title="Companion animations">
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
                  {(scope === 'app' || project) && (
                    <AppearancePreferences
                      projectId={scope === 'project' ? project?.id : undefined}
                    />
                  )}
                </>
              )}
              {c === 'Agents' && (scope === 'app' || project) && (
                <AgentPreferences
                  key={scope === 'project' ? project?.id : 'app'}
                  projectId={scope === 'project' ? project?.id : undefined}
                />
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
                    Publisher avatars load from GitHub. Marketplace searches go to AllMCPs, which
                    publicly logs requests, with User-Agent Jackalope/0.1.0. Your connected agents
                    and MCP servers use their own services.
                  </p>
                </>
              )}
              {c === 'Project' && (
                <ProjectPreferences
                  embedded
                  section="repository"
                  projectId={project?.id ?? '__none'}
                />
              )}
              {c === 'System' && <SystemInfoView />}
              {c === 'Diagnostics' && <AuditLogWorkspace />}
              {c === 'Updates & support' && <ReleaseSupport />}
              {c === 'Data & reset' && (
                <>
                  <Button variant="outline" onClick={() => void exportConfig()}>
                    Copy preferences to clipboard
                  </Button>
                  <ArchivedHistory />
                  <div className="settings-reset-box mt-6">
                    <h3 className="text-base font-semibold">Reset Jackalope</h3>
                    <p className="settings-row-description mt-3">
                      Erase this profile's projects, task history, drafts, queue, audit log, agent
                      selections and appearance. Jackalope restarts for first-time setup.
                      Repositories, worktrees, external agent sign-ins and agent MCP configuration
                      files are preserved.
                    </p>
                    <p className="settings-row-description mt-3">
                      Stop active tasks and pause queues before resetting. Existing worktrees will
                      remain on disk and can be managed after reopening the repository.
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
        </div>
      </div>
    </section>
  );
}
