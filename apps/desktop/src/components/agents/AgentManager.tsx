import { FormField, Input, DropdownMenu as Menu, SegmentedControl } from '@jackalope/ui';
import { ArrowLeft, MoreHorizontal, Star } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { builtinAgents } from '../../lib/agent-catalog';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useAgentScopeStore } from '../../stores/agentScopeStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Switch } from '../ui/Switch';
import { AgentAccounts } from './AgentAccounts';
import { AgentInstallGuide } from './AgentInstallGuide';
import { AgentModels } from './AgentModels';
import { AgentSupport } from './AgentSupport';
import { LocalAiSetup } from './LocalAiSetup';
import { ManagedRuntimeSettings } from './ManagedRuntimeSettings';
import { ProviderMark } from './ProviderMark';
import './agents-workspace.css';
import './agent-manager.css';

export function AgentManager({ initialAgentId }: { initialAgentId?: string }) {
  const config = useAgentConfigStore();
  const { projects, activeProjectId } = useProjectStore(
    useShallow((s) => ({ projects: s.projects, activeProjectId: s.activeProjectId })),
  );
  const activeProject = projects.find((item) => item.id === activeProjectId);
  const { scope, setScope } = useAgentScopeStore(
    useShallow((s) => ({ scope: s.scope, setScope: s.setScope })),
  );
  const project = scope === 'project' ? activeProject : undefined;
  const defaultAgent = project ? project.preferences?.preferredRunner : config.defaultMetaAgent;
  const { runners, discovering, discover } = useExecutionStore(
    useShallow((s) => ({ runners: s.runners, discovering: s.discovering, discover: s.discover })),
  );
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const markChanged = () => {
    setSaved(false);
    setDirty(true);
  };
  const [modelsRevision, setModelsRevision] = useState(0);
  const refreshModels = useCallback(() => setModelsRevision((value) => value + 1), []);
  const [busy, setBusy] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(initialAgentId ?? defaultAgent);
  const desktop = isTauriEnvironment();
  const agents = [...builtinAgents, ...config.customAgents];
  const availableIds = new Set(
    runners.filter((runner) => runner.available).map((runner) => runner.id),
  );
  const detectedIds = new Set(
    runners
      .filter((runner) => runner.available || runner.desktopInstalled)
      .map((runner) => runner.id),
  );
  const detectedAgents = agents
    .filter((agent) => detectedIds.has(agent.id))
    .sort((a, b) => Number(availableIds.has(b.id)) - Number(availableIds.has(a.id)));
  const otherAgents = agents.filter((agent) => !detectedIds.has(agent.id));
  const groups = [
    { id: 'detected', label: 'Detected', agents: detectedAgents },
    { id: 'other', label: 'Other agents', agents: otherAgents },
  ];
  const selected =
    agents.find((agent) => agent.id === selectedAgent) ?? detectedAgents[0] ?? agents[0];
  const selectedRunner = runners.find((r) => r.id === selected?.id);
  const selectedEnabled = selected ? config.isAgentEnabled(selected.id, project?.id) : false;
  const isDefault = !!selected && defaultAgent === selected.id;
  const orchestrates =
    !!selected &&
    ['codex', 'claude', 'grok', 'opencode', 'kimi'].includes(
      ('adapter' in selected ? selected.adapter : undefined) ?? selected.id,
    );
  const defaultBlockedReason =
    !project && !orchestrates
      ? `${selected?.name} cannot orchestrate routing. Choose Codex, Claude, Grok, OpenCode or Kimi Code.`
      : !selectedEnabled
        ? `Enable ${selected?.name} before making it the default.`
        : !selectedRunner?.available
          ? `${selected?.name} is not available on this computer yet.`
          : undefined;

  const save = async () => {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await syncAgentConfig();
      await discover();
      setSaved(true);
      setDirty(false);
      refreshModels();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const makeDefault = () => {
    if (!selected) return;
    config.setDefaultMetaAgent(selected.id, project?.id);
    markChanged();
  };

  const options = selected
    ? (config.runnerOptions[selected.id] ?? {
        models: [],
        restrictModels: false,
        defaultModel: '',
      })
    : { models: [], restrictModels: false, defaultModel: '' };

  const update = (patch: Partial<typeof options>) => {
    if (!selected) return;
    config.setRunnerOptions(selected.id, { ...options, ...patch });
    markChanged();
  };

  return (
    <div className="agent-manager workspace-stack">
      <div className="agent-manager-toolbar">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigateWorkspace('agents')}
          className="agent-manager-back"
        >
          <ArrowLeft size={16} />
          Back to agents
        </Button>

        <section className="agent-switcher" aria-label="Select agent to configure">
          {groups
            .filter((group) => group.agents.length)
            .map((group) => (
              <fieldset
                key={group.id}
                className="agent-switcher-group"
                data-group={group.id}
                aria-label={group.label}
              >
                <span className="agent-switcher-label" aria-hidden="true">
                  {group.label}
                </span>
                <div className="agent-switcher-strip">
                  {group.agents.map((agent) => {
                    const isCurrent = agent.id === selected?.id;
                    const isAgentDef = defaultAgent === agent.id;
                    const isAgentOn = config.isAgentEnabled(agent.id, project?.id);
                    const runner = runners.find((runner) => runner.id === agent.id);
                    const appOnly = runner?.desktopInstalled && !runner.available;
                    return (
                      <Button
                        key={agent.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-pressed={isCurrent}
                        aria-label={`${agent.name}${isAgentDef ? ', default agent' : ''}${!isAgentOn ? ', disabled for tasks' : ''}${appOnly ? ', desktop app only' : ''}`}
                        className={`agent-switcher-tab ${isCurrent ? 'active' : ''}`}
                        onClick={() => {
                          setSelectedAgent(agent.id);
                          setSaved(false);
                        }}
                      >
                        <ProviderMark provider={agent.id} size={18} />
                        <span className="agent-switcher-name">{agent.name}</span>
                        {appOnly ? (
                          <span className="agent-switcher-note">App only</span>
                        ) : (
                          !isAgentOn && <span className="agent-switcher-note">Off</span>
                        )}
                        {isAgentDef && <Star size={12} aria-hidden="true" />}
                      </Button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
        </section>
      </div>

      {activeProject && (
        <SegmentedControl
          label="Apply agent choices to"
          value={scope}
          onChange={(value) => setScope(value as 'project' | 'app')}
          items={[
            { id: 'project', label: activeProject.name },
            { id: 'app', label: 'All projects' },
          ]}
        />
      )}
      <p className="task-muted">
        {project
          ? `Enablement, default and accounts apply to ${project.name}. Connections, models and executable settings are shared across projects.`
          : 'Enablement, default and accounts apply to every project unless a project overrides them.'}
      </p>

      {/* Agents show their product mark; animated characters belong to bots and activity. */}
      <div className="agent-hero-card">
        <div className="agent-hero-mascot" aria-hidden="true">
          <ProviderMark provider={selected?.id ?? 'auto'} size={56} />
        </div>

        <div className="agent-hero-info">
          <div className="agent-hero-title-row">
            <h1 className="agent-hero-title">{selected?.name ?? 'Agent'}</h1>
          </div>
          {!selectedRunner?.available ? (
            <p className="agent-hero-status">{selectedRunner?.detail || 'Not installed'}</p>
          ) : (
            !selectedRunner.signedIn && <p className="agent-hero-status">Not signed in</p>
          )}
          {selected?.description && (
            <p className="agent-hero-description">{selected.description}</p>
          )}
        </div>

        <div className="agent-hero-actions">
          <div className="agent-hero-toggle">
            <Switch
              checked={selectedEnabled}
              disabled={!!project && !!selected && !config.isAgentEnabled(selected.id)}
              onCheckedChange={(value) => {
                if (selected) {
                  config.toggleAgent(selected.id, value, project?.id);
                  markChanged();
                }
              }}
              label={`Enable ${selected?.name}${project ? ` for ${project.name}` : ' app-wide'}`}
            />
            <span className="agent-hero-toggle-label">
              {selectedEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>

          <div className="agent-hero-buttons">
            {dirty ? (
              <Button
                type="button"
                size="sm"
                onClick={() => void save()}
                disabled={!desktop || busy || discovering}
                loading={busy || discovering}
                loadingLabel="Saving…"
              >
                Save changes
              </Button>
            ) : (
              !isDefault && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!!defaultBlockedReason}
                  title={defaultBlockedReason}
                  onClick={makeDefault}
                >
                  <Star size={14} />
                  Make default
                </Button>
              )
            )}

            <Menu.Root>
              <Menu.Trigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`${selected?.name ?? 'Agent'} options`}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </Button>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content className="workspace-menu" align="end" sideOffset={6}>
                  {dirty && !isDefault && (
                    <Menu.Item
                      className="workspace-menu-item"
                      disabled={!!defaultBlockedReason}
                      onSelect={makeDefault}
                    >
                      Make default
                    </Menu.Item>
                  )}
                  <Menu.Item
                    className="workspace-menu-item"
                    disabled={!desktop || busy || discovering}
                    onSelect={() => void save()}
                  >
                    Check agents again
                  </Menu.Item>
                  {'isCustom' in selected && (
                    <>
                      <Menu.Separator className="menu-separator" />
                      <Menu.Item
                        className="workspace-menu-item"
                        onSelect={() => {
                          config.removeCustomAgent(selected.id);
                          markChanged();
                        }}
                      >
                        Remove {selected.name}
                      </Menu.Item>
                    </>
                  )}
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          </div>
        </div>
      </div>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {saved && (
        <InlineNotice tone="success">
          Agent settings saved. Existing runs keep their current configuration.
        </InlineNotice>
      )}
      {!project && !config.defaultMetaAgent && (
        <InlineNotice tone="error">
          Choose an enabled default agent before starting internal agent work.
        </InlineNotice>
      )}

      {selected?.id === 'opencode' && (
        <div className="agent-settings-card">
          <h2 className="agent-settings-card-header agent-settings-card-title">Local models</h2>
          <div className="agent-settings-card-body">
            <LocalAiSetup onConnected={refreshModels} />
          </div>
        </div>
      )}

      {selected?.id === 'antigravity' && !selectedRunner?.available && (
        <div className="agent-settings-card">
          <h2 className="agent-settings-card-header agent-settings-card-title">Install</h2>
          <div className="agent-settings-card-body">
            <AgentInstallGuide desktopInstalled={selectedRunner?.desktopInstalled} />
          </div>
        </div>
      )}

      <div className="agent-settings-sections">
        <section className="agent-settings-card" aria-label="Agent accounts">
          <h2 className="agent-settings-card-header agent-settings-card-title">Accounts</h2>
          <div className="agent-settings-card-body agent-config-fields">
            {selected && (
              <AgentAccounts
                key={`${project?.id ?? 'app'}:${selected.id}`}
                projectId={project?.id}
                agentId={('adapter' in selected ? selected.adapter : undefined) || selected.id}
                agentName={selected.name}
                onChanged={refreshModels}
              />
            )}
          </div>
        </section>

        <section className="agent-settings-card" aria-label="Models and executable">
          <h2 className="agent-settings-card-header agent-settings-card-title">Models</h2>
          <div className="agent-settings-card-body agent-config-fields">
            {selected && (
              <>
                <FormField
                  label="Executable command override"
                  description="Leave blank to find it on PATH."
                >
                  <Input
                    className="task-input"
                    value={options.command ?? ('command' in selected ? selected.command : '')}
                    onChange={(e) => update({ command: e.target.value })}
                    placeholder={`Auto-detect (${('defaultBinary' in selected && selected.defaultBinary) || selected.id})`}
                  />
                </FormField>

                <AgentModels
                  key={selected.id}
                  agentId={selected.id}
                  revision={modelsRevision}
                  agentProfileId={
                    project?.preferences?.agentAccounts?.[
                      ('adapter' in selected ? selected.adapter : undefined) ?? selected.id
                    ]
                  }
                  selected={options.models}
                  defaultModel={options.defaultModel}
                  restricted={options.restrictModels}
                  onChange={update}
                />
                {desktop &&
                  (('adapter' in selected ? selected.adapter : selected.id) ?? selected.id) ===
                    'opencode' && <ManagedRuntimeSettings />}
              </>
            )}
          </div>
        </section>

        <section className="agent-settings-card" aria-label="Agent support">
          <h2 className="agent-settings-card-header agent-settings-card-title">Capabilities</h2>
          <div className="agent-settings-card-body">
            {selected && (
              <AgentSupport
                adapter={('adapter' in selected ? selected.adapter : undefined) ?? selected.id}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
