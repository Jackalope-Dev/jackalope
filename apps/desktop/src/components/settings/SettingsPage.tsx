import {
  Button,
  FormField,
  Input,
  SearchField,
  SegmentedControl,
  Select,
  SelectItem,
  SettingActions,
  SettingBody,
  SettingGroup,
  SettingRow,
  Switch,
} from '@jackalope/ui';
import { KeyRound } from 'lucide-react';

import { useEffect, useRef, useState } from 'react';
import { isTauriEnvironment } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { AuditLogWorkspace } from '../audit/AuditLogWorkspace';
import { ProjectPreferences } from '../projects/ProjectPreferences';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { AppearancePreferences } from './AppearancePreferences';
import { ArchivedHistory } from './ArchivedHistory';
import { JackalopeAccount } from './JackalopeAccount';
import { NotificationSettings } from './NotificationSettings';
import { PrivacySettings } from './PrivacySettings';
import { ReferralSettings } from './ReferralSettings';
import { ReleaseSupport } from './ReleaseSupport';
import { RoutingPreferences } from './RoutingSetup';
import { SystemInfoView } from './SystemInfo';
import { WindowBehaviorSettings } from './WindowBehaviorSettings';
import './settings.css';
import { useShallow } from 'zustand/react/shallow';
import { ArtifactsConnection } from './ArtifactsConnection';
import { ComputersSettings } from './ComputersSettings';
import {
  SETTINGS_CATEGORIES,
  SETTINGS_GROUPS,
  type SettingsCategory,
  settingsCategory,
  sidebarCategory,
} from '../../lib/settings-categories';
import { DesktopPreferences } from './DesktopPreferences';
import { IssueConnections } from './IssueConnections';
import { RemoteAccess } from './RemoteAccess';
import { SavedActions } from './SavedActions';
import { describeError } from '../../lib/errors';

interface SettingsPageProps {
  onClose: () => void;
  initialScope?: 'app' | 'project';
  initialProjectId?: string;
  initialCategory?: SettingsCategory;
}
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
  const { currentTheme } = useThemeStore(useShallow((s) => ({ currentTheme: s.currentTheme })));
  const { projects, activeProjectId } = useProjectStore(
    useShallow((s) => ({ projects: s.projects, activeProjectId: s.activeProjectId })),
  );
  const [scope, setScope] = useState<'app' | 'project'>(initialScope);
  const [selectedProjectId, setSelectedProjectId] = useState(
    initialProjectId ?? activeProjectId ?? '',
  );
  const project = projects.find((project) => project.id === selectedProjectId);
  const scopedCategories = SETTINGS_CATEGORIES.filter((entry) =>
    scope === 'project' ? 'project' in entry : !('app' in entry),
  ).map((entry) => entry.id);
  const [category, setCategory] = useState<SettingsCategory>(
    initialCategory ?? (initialScope === 'project' ? 'Project' : 'General'),
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
  const visible = scopedCategories.filter(matches);
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
      <div className="settings-scope-bar">
        <SegmentedControl
          label="Settings scope"
          value={scope}
          onChange={(value) => {
            setScope(value);
            setCategory(value === 'app' ? 'General' : 'Project');
            setQuery('');
          }}
          items={[
            { id: 'app', label: 'App-wide' },
            { id: 'project', label: 'Per project' },
          ]}
        />
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
        {scope === 'project' && <p className="task-muted">App-wide restrictions still apply.</p>}
      </div>
      <div className="settings-body">
        <nav className="settings-sidebar" aria-label="Settings categories">
          {SETTINGS_GROUPS.map((group) => {
            const items = SETTINGS_CATEGORIES.filter(
              (entry) =>
                entry.group === group &&
                !('within' in entry) &&
                scopedCategories.includes(entry.id),
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
              {c === 'Jackalope account' && (
                <JackalopeAccount onInvitations={() => setCategory('Invitations')} />
              )}
              {c === 'Connected work' && <IssueConnections />}
              {c === 'Computers' && <ComputersSettings />}
              {c === 'Cloudflare' && <ArtifactsConnection />}
              {c === 'Desktop' && <DesktopPreferences />}
              {c === 'Saved actions' && <SavedActions />}
              {c === 'Remote access' && <RemoteAccess />}
              {c === 'Invitations' && (
                <ReferralSettings onAccount={() => setCategory('Jackalope account')} />
              )}
              {c === 'Decisions' && (
                <RoutingPreferences
                  key={scope === 'project' ? project?.id : 'app'}
                  projectId={scope === 'project' ? project?.id : undefined}
                />
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
              {c === 'Appearance' && (scope === 'app' || project) && (
                <AppearancePreferences projectId={scope === 'project' ? project?.id : undefined} />
              )}
              {c === 'Privacy' && (
                <>
                  <PrivacySettings />
                  <SettingGroup>
                    <SettingRow
                      title="Use MCP marketplace"
                      description="Allow searches and server details from allmcps.com."
                    >
                      <Switch
                        label="Use MCP marketplace"
                        checked={settings.useMcpMarketplace}
                        onCheckedChange={settings.setUseMcpMarketplace}
                      />
                    </SettingRow>
                    <SettingBody>
                      <p className="settings-row-description">
                        Publisher avatars load from GitHub. Marketplace searches go to AllMCPs,
                        which publicly logs requests. Your connected agents and MCP servers use
                        their own services.
                      </p>
                    </SettingBody>
                  </SettingGroup>
                </>
              )}
              {c === 'Project' && (
                <ProjectPreferences embedded projectId={project?.id ?? '__none'} />
              )}
              {c === 'System' && <SystemInfoView />}
              {c === 'Diagnostics' && <AuditLogWorkspace />}
              {c === 'Updates & support' && <ReleaseSupport />}
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
                    description="Erase this profile's projects, task history, drafts, queue, audit log, agent selections and appearance. Jackalope restarts for first-time setup. Repositories, worktrees, external agent sign-ins and agent MCP configuration files are preserved."
                  >
                    <SettingBody>
                      <p className="settings-row-description">
                        Stop active tasks and pause queues before resetting. Existing worktrees will
                        remain on disk and can be managed after reopening the repository.
                      </p>
                      {confirming && (
                        <FormField label="Type RESET to confirm permanent deletion">
                          <Input
                            id="reset-confirmation"
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
