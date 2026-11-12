import {
  Button,
  FormField,
  Input,
  SearchField,
  SettingActions,
  SettingBody,
  SettingGroup,
  SettingRow,
} from '@jackalope/ui';
import { ArrowUpRight, KeyRound } from 'lucide-react';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { navigateWorkspace, openDevices } from '../../lib/app-events';
import { isTauriEnvironment } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useAgentScopeStore } from '../../stores/agentScopeStore';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { AuditLogWorkspace } from '../audit/AuditLogWorkspace';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { AppearancePreferences } from './AppearancePreferences';
import { ArchivedHistory } from './ArchivedHistory';
import { JackalopeAccount } from './JackalopeAccount';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { NotificationSettings } from './NotificationSettings';
import { PrivacySettings } from './PrivacySettings';
import { ReferralSettings } from './ReferralSettings';
import { ReleaseSupport } from './ReleaseSupport';
import { SystemInfoView } from './SystemInfo';
import { WindowBehaviorSettings } from './WindowBehaviorSettings';
import './settings.css';
import { describeError } from '@jackalope/contracts/errors';
import { useShallow } from 'zustand/react/shallow';
import {
  SETTINGS_CATEGORIES,
  SETTINGS_GROUPS,
  type SettingsCategory,
  settingsCategory,
  sidebarCategory,
} from '../../lib/settings-categories';
import { ArtifactsConnection } from './ArtifactsConnection';
import { ComputersSettings } from './ComputersSettings';
import { DesktopPreferences } from './DesktopPreferences';
import { IssueConnections } from './IssueConnections';
import { SwarmSettings } from './SwarmConnection';

/** Opens the page a settings entry stands for; Devices lands on sharing this computer. */
function openCategoryPage(category: SettingsCategory) {
  const page = settingsCategory(category).page;
  if (page === 'remote-hosts') openDevices('share');
  else if (page) navigateWorkspace(page);
}

interface SettingsPageProps {
  onClose: () => void;
  /** The project a project link (openProjectSettings) asked about. */
  initialProjectId?: string;
  initialCategory?: SettingsCategory;
}
/**
 * App-wide settings. Project links redirect: a project's settings open its page's Settings
 * tab, its routing opens Agents → Routing scoped to it, and its appearance opens here with
 * that project's override.
 */
export function SettingsPage({ onClose, initialCategory, initialProjectId }: SettingsPageProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const settings = useSettingsStore();
  const agents = useAgentConfigStore();
  const { currentTheme } = useThemeStore(useShallow((s) => ({ currentTheme: s.currentTheme })));
  const selectProject = useProjectStore((s) => s.selectProject);
  const redirect =
    initialProjectId && (initialCategory === 'Project' || initialCategory === 'Routing');
  useLayoutEffect(() => {
    if (!initialProjectId || !redirect) return;
    selectProject(initialProjectId);
    if (initialCategory === 'Routing') {
      useAgentScopeStore.getState().setScope('project');
      navigateWorkspace('routing');
    } else navigateWorkspace('project-settings');
  }, [initialProjectId, initialCategory, redirect, selectProject]);
  const categories = SETTINGS_CATEGORIES.map((entry) => entry.id);
  const [category, setCategory] = useState<SettingsCategory>(
    initialCategory && !redirect ? initialCategory : 'General',
  );
  const selectedSection = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sidebarCategory(category) !== category)
      selectedSection.current?.scrollIntoView({ block: 'start' });
    // The content panel scrolls on its own, so a new page starts at its top.
    else content.current?.scrollTo({ top: 0 });
  }, [category]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [resetting, setResetting] = useState(false);
  const matches = (section: SettingsCategory) =>
    query.trim()
      ? `${section} ${settingsCategory(section).keywords}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      : sidebarCategory(section) === sidebarCategory(category);
  // Search-only entries (hidden) appear for a query, never as the open page.
  const visible = categories.filter(
    (c) => matches(c) && (query.trim() !== '' || !('hidden' in settingsCategory(c))),
  );
  const exportConfig = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            settings: JSON.parse(settings.exportSettings()),
            theme: currentTheme,
            desktop: isTauriEnvironment() ? await invokeNative('desktop_settings') : undefined,
            agents: JSON.parse(JSON.stringify(agents)),
          },
          null,
          2,
        ),
      );
      setMessage('Preferences copied to clipboard.');
    } catch (error) {
      setMessage(`Could not copy preferences: ${describeError(error)}`);
    }
  };
  const reset = async () => {
    if (confirmation !== 'RESET' || resetting) return;
    setResetting(true);
    setMessage('');
    try {
      if (isTauriEnvironment()) await invokeNative('app_reset', { confirmation });
      else {
        for (const key of Object.keys(localStorage))
          if (key.startsWith('jackalope-')) localStorage.removeItem(key);
        window.location.reload();
      }
    } catch (error) {
      setMessage(`Reset failed: ${describeError(error)}`);
      setResetting(false);
    }
  };
  return (
    <WorkspacePage className="settings-page">
      <WorkspaceHeading
        title="Settings"
        titleRef={heading}
        action={
          <SearchField
            aria-label="Search settings"
            placeholder="Search settings…"
            value={query}
            onValueChange={(value) => setQuery(value)}
            containerClassName="settings-search"
          />
        }
      />
      <p className="sr-only">
        General, appearance, agents, privacy, project preferences and local data. Changes save
        immediately unless a Save button is shown.
      </p>
      <div className="settings-body">
        <nav className="settings-sidebar" aria-label="Settings categories">
          {SETTINGS_GROUPS.map((group) => {
            const items = SETTINGS_CATEGORIES.filter(
              (entry) => entry.group === group && !('within' in entry) && !('hidden' in entry),
            );
            if (!items.length) return null;
            return (
              <div key={group} className="settings-nav-group">
                <span className="settings-nav-label">{group}</span>
                {items.map((entry) => {
                  const c = entry.id;
                  const Icon = ('icon' in entry && entry.icon) || KeyRound;
                  const opensPage = 'page' in entry;
                  if (opensPage)
                    return (
                      <button
                        key={c}
                        type="button"
                        className="settings-nav-item settings-nav-link"
                        onClick={() => openCategoryPage(c)}
                      >
                        <Icon size={16} aria-hidden="true" />
                        {c}
                        <ArrowUpRight
                          size={14}
                          aria-hidden="true"
                          className="settings-nav-link-icon"
                        />
                      </button>
                    );
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`settings-nav-item ${sidebarCategory(category) === c && !query ? 'is-active' : ''}`}
                      aria-current={sidebarCategory(category) === c && !query ? 'page' : undefined}
                      onClick={() => {
                        setCategory(c);
                        setQuery('');
                        setMessage('');
                        setConfirming(false);
                        setConfirmation('');
                      }}
                    >
                      <Icon size={16} aria-hidden="true" />
                      {c}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="settings-content" ref={content}>
          {!visible.length && <p>No settings match “{query}”.</p>}
          {visible.map((c) => (
            <section
              key={c}
              className="settings-section"
              ref={c === category ? selectedSection : undefined}
            >
              <WorkspaceSectionHeading title={c === 'Project' ? 'Project settings' : c} />
              {settingsCategory(c).page && (
                <SettingGroup>
                  <SettingRow title={c} description={settingsCategory(c).summary}>
                    <Button variant="outline" onClick={() => openCategoryPage(c)}>
                      Open {c === 'Project' ? 'project settings' : c}
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </Button>
                  </SettingRow>
                </SettingGroup>
              )}
              {c === 'Jackalope account' && (
                <JackalopeAccount onInvitations={() => setCategory('Invitations')} />
              )}
              {c === 'Connected work' && <IssueConnections />}
              {c === 'Computers' && <ComputersSettings />}
              {c === 'Cloudflare' && <ArtifactsConnection />}
              {c === 'Swarm' && <SwarmSettings />}
              {c === 'Editor & terminal' && <DesktopPreferences />}
              {c === 'Keyboard shortcuts' && <KeyboardShortcuts />}
              {c === 'Invitations' && (
                <ReferralSettings onAccount={() => setCategory('Jackalope account')} />
              )}
              {c === 'General' && (
                <>
                  <WindowBehaviorSettings />
                  <NotificationSettings />
                  <SettingGroup>
                    <SettingRow
                      title="Guided setup"
                      description="Walk through project and agent setup again. Your saved work stays."
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
                    </SettingRow>
                  </SettingGroup>
                </>
              )}
              {c === 'Appearance' && <AppearancePreferences overrideProjectId={initialProjectId} />}
              {c === 'Privacy' && <PrivacySettings />}
              {c === 'System' && <SystemInfoView />}
              {c === 'Diagnostics' && <AuditLogWorkspace />}
              {c === 'Help & community' && <ReleaseSupport />}
              {c === 'Data & reset' && (
                <>
                  <SettingGroup>
                    <SettingRow
                      title="Preferences"
                      description="Copy this profile's preferences as JSON, for support or to compare settings."
                    >
                      <Button variant="outline" onClick={() => void exportConfig()}>
                        Copy preferences
                      </Button>
                    </SettingRow>
                  </SettingGroup>
                  <ArchivedHistory />
                  <SettingGroup
                    tone="danger"
                    title="Reset Jackalope"
                    description="Start this profile over. Jackalope restarts for first-time setup."
                  >
                    <SettingBody>
                      <div className="settings-reset-scope">
                        <div>
                          <h4>Erased</h4>
                          <ul>
                            <li>Projects and their settings</li>
                            <li>Task history, drafts and queue</li>
                            <li>Audit log</li>
                            <li>Agent selections and appearance</li>
                          </ul>
                        </div>
                        <div>
                          <h4>Kept</h4>
                          <ul>
                            <li>Your repositories and worktrees</li>
                            <li>Agent sign-ins outside Jackalope</li>
                            <li>Agent MCP configuration files</li>
                          </ul>
                        </div>
                      </div>
                      <p className="settings-row-description">
                        Stop active tasks and pause queues before resetting. Existing worktrees will
                        remain on disk and can be managed after reopening the repository.
                      </p>
                      {confirming && (
                        <FormField label="Type RESET to confirm permanent deletion">
                          <Input
                            id="reset-confirmation"
                            className="settings-reset-input"
                            autoComplete="off"
                            value={confirmation}
                            disabled={resetting}
                            onChange={(e) => setConfirmation(e.target.value)}
                          />
                        </FormField>
                      )}
                    </SettingBody>
                    <SettingActions>
                      {!confirming ? (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setConfirming(true);
                            setConfirmation('');
                          }}
                        >
                          Reset all local data…
                        </Button>
                      ) : (
                        <>
                          <Button
                            disabled={confirmation !== 'RESET' || resetting}
                            onClick={() => void reset()}
                            loading={resetting}
                            loadingLabel="Restarting…"
                          >
                            Erase local data and restart
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
                        </>
                      )}
                    </SettingActions>
                  </SettingGroup>
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
    </WorkspacePage>
  );
}
