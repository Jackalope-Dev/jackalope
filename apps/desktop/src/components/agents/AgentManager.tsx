import { Input, Panel, PanelBody, PanelHeader, RefreshIcon } from '@jackalope/ui';
import { ArrowLeft, Star, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { builtinAgents } from '../../lib/agent-catalog';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Switch } from '../ui/Switch';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { AgentAccounts } from './AgentAccounts';
import { AgentInstallGuide } from './AgentInstallGuide';
import { AgentModels } from './AgentModels';
import { AgentSupport } from './AgentSupport';
import { LocalAiSetup } from './LocalAiSetup';
import './agents-workspace.css';
import './agent-manager.css';

export function AgentManager({ initialAgentId }: { initialAgentId?: string }) {
  const config = useAgentConfigStore();
  const { runners, discovering, discover } = useExecutionStore();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [modelsRevision, setModelsRevision] = useState(0);
  const refreshModels = useCallback(() => setModelsRevision((value) => value + 1), []);
  const [busy, setBusy] = useState(false);
  const [selectedAgent] = useState(initialAgentId ?? config.defaultMetaAgent);
  const desktop = isTauriEnvironment();
  const agents = [...builtinAgents, ...config.customAgents];
  const selected = agents.find((agent) => agent.id === selectedAgent) ?? agents[0];
  const selectedRunner = runners.find((r) => r.id === selected?.id);
  const selectedEnabled = selected ? config.isAgentEnabled(selected.id) : false;
  const isDefault = !!selected && config.defaultMetaAgent === selected.id;
  const orchestrates =
    !!selected &&
    ['codex', 'claude', 'grok', 'opencode', 'kimi'].includes(
      ('adapter' in selected ? selected.adapter : undefined) ?? selected.id,
    );
  const defaultBlockedReason = !orchestrates
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
      refreshModels();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="agent-manager workspace-stack">
      <WorkspaceHeading
        title={`Configure ${selected?.name ?? 'agent'}`}
        action={
          <div className="flex flex-wrap gap-3">
            <Button variant="ghost" onClick={() => navigateWorkspace('agents')}>
              <ArrowLeft size={16} />
              Back to agents
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void save()}
              disabled={!desktop || busy || discovering}
              loading={busy || discovering}
              loadingLabel="Checking…"
            >
              <RefreshIcon size={16} />
              Save &amp; check agents
            </Button>
            <Button
              type="button"
              variant={isDefault ? 'outline' : 'ghost'}
              aria-pressed={isDefault}
              disabled={
                isDefault || !selectedEnabled || !selectedRunner?.available || !orchestrates
              }
              title={isDefault ? undefined : defaultBlockedReason}
              onClick={() => {
                if (!selected) return;
                config.setDefaultMetaAgent(selected.id);
                setSaved(false);
              }}
            >
              <Star size={15} fill={isDefault ? 'currentColor' : 'none'} />
              {isDefault ? 'Current default agent' : 'Use as default'}
            </Button>
          </div>
        }
      />
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {saved && (
        <p role="status" className="task-muted">
          Agent settings saved. Existing runs keep their current configuration.
        </p>
      )}
      {selected?.id === 'opencode' && <LocalAiSetup onConnected={refreshModels} />}
      {agents
        .filter((agent) => agent.id === selected?.id)
        .map((agent) => {
          const runner = runners.find((r) => r.id === agent.id);
          const options = config.runnerOptions[agent.id] ?? {
            models: [],
            restrictModels: false,
            defaultModel: '',
          };
          const update = (patch: Partial<typeof options>) => {
            config.setRunnerOptions(agent.id, { ...options, ...patch });
            setSaved(false);
          };
          const enabled = config.isAgentEnabled(agent.id);
          return (
            <Panel variant="plain" key={agent.id} className="agent-config-row">
              <PanelHeader className="agent-config-heading">
                <div className="agent-config-identity">
                  <h3 className="font-medium">
                    {agent.name}
                    {config.defaultMetaAgent === agent.id && (
                      <span className="agent-default ml-3">
                        <Star size={12} />
                        Default agent
                      </span>
                    )}
                  </h3>
                  <p className="task-muted">
                    {runner?.available
                      ? runner.signedIn
                        ? 'Ready · account connected'
                        : 'Installed · sign-in checked by the CLI on launch'
                      : runner?.detail || 'Not checked yet'}
                  </p>
                </div>
                <div className="agent-config-actions">
                  <div className="agent-enable">
                    <Switch
                      checked={enabled}
                      onCheckedChange={(value) => {
                        config.toggleAgent(agent.id, value);
                        setSaved(false);
                      }}
                      label={`Enable ${agent.name}`}
                    />
                    <span aria-hidden="true">{enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                  {'isCustom' in agent && (
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Remove ${agent.name}`}
                      onClick={() => {
                        config.removeCustomAgent(agent.id);
                        setSaved(false);
                      }}
                    >
                      <Trash2 size={15} />
                    </Button>
                  )}
                </div>
              </PanelHeader>
              {agent.id === 'antigravity' && !runner?.available && (
                <AgentInstallGuide desktopInstalled={runner?.desktopInstalled} />
              )}
              <section aria-label="Agent accounts">
                <h3 className="text-base font-medium mt-6">Accounts</h3>
                <PanelBody className="agent-config-fields">
                  <AgentAccounts
                    key={agent.id}
                    agentId={('adapter' in agent ? agent.adapter : undefined) || agent.id}
                    agentName={agent.name}
                    onChanged={refreshModels}
                  />
                </PanelBody>
              </section>
              <AgentSupport
                adapter={('adapter' in agent ? agent.adapter : undefined) ?? agent.id}
              />
              <section aria-label="Models and executable">
                <h3 className="text-base font-medium mt-4">Models & executable</h3>
                <PanelBody className="agent-config-fields">
                  <label className="task-label">
                    Executable override
                    <Input
                      className="task-input"
                      value={options.command ?? ('command' in agent ? agent.command : '')}
                      onChange={(e) => update({ command: e.target.value })}
                      placeholder="Leave empty to auto-detect"
                    />
                  </label>
                  <AgentModels
                    key={agent.id}
                    agentId={agent.id}
                    revision={modelsRevision}
                    selected={options.models}
                    defaultModel={options.defaultModel}
                    restricted={options.restrictModels}
                    onChange={update}
                  />
                </PanelBody>
              </section>
            </Panel>
          );
        })}
      {!config.defaultMetaAgent && (
        <InlineNotice tone="error">
          Choose an enabled default agent before starting internal agent work.
        </InlineNotice>
      )}
    </div>
  );
}
