import {
  Button,
  FormField,
  Input,
  LoadingState,
  SearchField,
  SettingActions,
  SettingBody,
  SettingGroup,
  SettingRow,
} from '@jackalope/ui';
import { ArrowUpRight, KeyRound } from 'lucide-react';

import { type ReactNode, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { navigateWorkspace } from '../../lib/app-events';
import { isTauriEnvironment } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import { type ActiveTab, highlightedView, type PageTab } from '../../lib/navigation';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useAgentScopeStore } from '../../stores/agentScopeStore';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { useViewTabStore } from '../../stores/viewTabStore';
import { AuditLogWorkspace } from '../audit/AuditLogWorkspace';
import { PageErrorBoundary } from '../ui/PageErrorBoundary';
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

interface SettingsPageProps {
  onClose: () => void;
  /** The project a project link (openProjectSettings) asked about. */
  initialProjectId?: string;
  /** The open category; Shell holds it so Back and Forward step through categories. */
  category: SettingsCategory;
  onCategory: (category: SettingsCategory) => void;
  /** Renders a workspace page inside Settings; `open` is where its own links lead. */
  renderPage: (tab: PageTab, open: (tab: ActiveTab) => void) => ReactNode;
}
/**
 * App-wide settings. Categories that are also workspace pages (Agents, Routing, Tools,
 * Connected apps, Devices) show that page here. Project links: a project's settings open its
 * page's Settings tab, its routing shows here scoped to it, and its appearance opens here
 * with that project's override.
 */
export function SettingsPage({
  onClose,
  category: openCategory,
  onCategory,
  initialProjectId,
  renderPage,
}: SettingsPageProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const settings = useSettingsStore();
  const agents = useAgentConfigStore();
  const { currentTheme } = useThemeStore(useShallow((s) => ({ currentTheme: s.currentTheme })));
  const selectProject = useProjectStore((s) => s.selectProject);
  const redirect = Boolean(initialProjectId) && openCategory === 'Project';
  useLayoutEffect(() => {
    if (!initialProjectId) return;
    if (openCategory === 'Project') {
      selectProject(initialProjectId);
      navigateWorkspace('project-settings');
    } else if (openCategory === 'Routing') {
      selectProject(initialProjectId);
      useAgentScopeStore.getState().setScope('project');
    }
  }, [initialProjectId, openCategory, selectProject]);
  const categories = SETTINGS_CATEGORIES.map((entry) => entry.id);
  const category: SettingsCategory = redirect ? 'General' : openCategory;
  /** A page reached from a category's own page (the tool marketplace from Tools). */
  const [within, setWithin] = useState<{ category: SettingsCategory; tab: PageTab }>();
  const categoryPage = settingsCategory(category).page as PageTab | undefined;
  const pageTab = within?.category === category ? within.tab : categoryPage;
  const openFromPage = (tab: ActiveTab) => {
    if (categoryPage && highlightedView(tab) === categoryPage)
      setWithin({ category, tab: tab as PageTab });
    else navigateWorkspace(tab);
  };
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
  const select = (next: SettingsCategory) => {
    // Devices opens on sharing this computer, the part that is a setting.
    if (settingsCategory(next).page === 'remote-hosts')
      useViewTabStore.getState().setDevices('share');
    onCategory(next);
    setWithin(undefined);
    setQuery('');
    setMessage('');
    setConfirming(false);
    setConfirmation('');
  };
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
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`settings-nav-item ${sidebarCategory(category) === c && !query ? 'is-active' : ''}`}
                      aria-current={sidebarCategory(category) === c && !query ? 'page' : undefined}
                      onClick={() => select(c)}
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
          {visible.map((c) => {
            const entry = settingsCategory(c);
            // The open category shows its page; search lists it as a row that leads there.
            const page = entry.page && !entry.hidden && !query.trim() ? pageTab : undefined;
            const elsewhere = entry.hidden ? entry.page : undefined;
            return (
              <section
                key={c}
                className="settings-section"
                ref={c === category ? selectedSection : undefined}
              >
                <PageErrorBoundary key={c} feature="settings">
                  {!page && (
                    <WorkspaceSectionHeading title={c === 'Project' ? 'Project settings' : c} />
                  )}
                  {entry.page && !page && (
                    <SettingGroup>
                      <SettingRow title={c} description={entry.summary}>
                        <Button
                          variant="outline"
                          onClick={() => (elsewhere ? navigateWorkspace(elsewhere) : select(c))}
                        >
                          Open {c === 'Project' ? 'project settings' : c}
                          {elsewhere && <ArrowUpRight size={14} aria-hidden="true" />}
                        </Button>
                      </SettingRow>
                    </SettingGroup>
                  )}
                  {page && (
                    <Suspense fallback={<LoadingState compact label={`Opening ${c}…`} />}>
                      {renderPage(page, openFromPage)}
                    </Suspense>
                  )}
                  {c === 'Jackalope account' && (
                    <JackalopeAccount onInvitations={() => select('Invitations')} />
                  )}
                  {c === 'Connected work' && <IssueConnections />}
                  {c === 'Computers' && <ComputersSettings />}
                  {c === 'Cloudflare' && <ArtifactsConnection />}
                  {c === 'Swarm' && <SwarmSettings />}
                  {c === 'Editor & terminal' && <DesktopPreferences />}
                  {c === 'Keyboard shortcuts' && <KeyboardShortcuts />}
                  {c === 'Invitations' && (
                    <ReferralSettings onAccount={() => select('Jackalope account')} />
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
                  {c === 'Appearance' && (
                    <AppearancePreferences overrideProjectId={initialProjectId} />
                  )}
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
                            Stop active tasks and pause queues before resetting. Existing worktrees
                            will remain on disk and can be managed after reopening the repository.
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
                </PageErrorBoundary>
              </section>
            );
          })}
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
