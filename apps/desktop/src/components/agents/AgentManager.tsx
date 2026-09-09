import { ArrowLeft, Plus, RefreshCw, Star, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { builtinAgents } from '../../lib/agent-catalog';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';
import { AddAgentForm } from './AddAgentForm';
import { AgentAccounts } from './AgentAccounts';
import { AgentInstallGuide } from './AgentInstallGuide';
import { AgentModels } from './AgentModels';
import { AgentSupport } from './AgentSupport';
import './agent-manager.css';

export function AgentManager({ initialAgentId }: { initialAgentId?: string }) {
  const config = useAgentConfigStore();
  const { runners, discovering, discover } = useExecutionStore();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [modelsRevision, setModelsRevision] = useState(0);
  const refreshModels = useCallback(() => setModelsRevision((value) => value + 1), []);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedAgent] = useState(initialAgentId ?? config.defaultMetaAgent);
  const desktop = isTauriEnvironment();
  const agents = [...builtinAgents, ...config.customAgents];
  const selected = agents.find((agent) => agent.id === selectedAgent) ?? agents[0];
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
    <div className="agent-manager">
      <Button variant="ghost" className="self-start" onClick={() => navigateWorkspace('agents')}>
        <ArrowLeft size={16} />
        Back to agents
      </Button>
      <h1 className="text-2xl font-medium">Configure {selected?.name ?? 'agent'}</h1>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void save()}
          disabled={!desktop || busy || discovering}
        >
          <RefreshCw size={15} />
          {busy || discovering ? 'Checking…' : 'Save & check agents'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAdding(!adding)}>
          <Plus size={15} />
          Add agent manually
        </Button>
      </div>
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="task-muted">
          Agent settings saved. Existing runs keep their current configuration.
        </p>
      )}
      {adding && (
        <AddAgentForm
          onAdded={() => {
            setAdding(false);
            setSaved(false);
          }}
        />
      )}
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
            <section key={agent.id} className="agent-config-row">
              <div className="agent-config-heading">
                <div className="agent-config-identity">
                  <h3 className="font-medium">
                    {agent.name}
                    {config.defaultMetaAgent === agent.id && (
                      <span className="ml-3 text-sm text-[var(--color-accent-ink)]">Default</span>
                    )}
                  </h3>
                  <p className="task-muted">
                    {runner?.available
                      ? runner.signedIn
                        ? 'Ready · existing CLI sign-in'
                        : 'Installed · sign-in checked by the CLI on launch'
                      : runner?.detail || 'Not checked yet'}
                  </p>
                </div>
                <div className="agent-config-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={
                      !enabled ||
                      !runner?.available ||
                      !['codex', 'claude', 'grok', 'opencode'].includes(
                        ('adapter' in agent ? agent.adapter : undefined) ?? agent.id,
                      )
                    }
                    onClick={() => {
                      config.setDefaultMetaAgent(agent.id);
                      setSaved(false);
                    }}
                  >
                    <Star size={15} />
                    Use as default
                  </Button>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(value) => {
                      config.toggleAgent(agent.id, value);
                      setSaved(false);
                    }}
                    label={`Enable ${agent.name}`}
                  />
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
              </div>
              {agent.id === 'antigravity' && !runner?.available && (
                <AgentInstallGuide desktopInstalled={runner?.desktopInstalled} />
              )}
              {(
                <section aria-label="Agent accounts">
                  <h3 className="text-base font-medium mt-6">Accounts</h3>
                  <div className="agent-config-fields">
                    <AgentAccounts
                      key={agent.id}
                      agentId={('adapter' in agent ? agent.adapter : undefined) || agent.id}
                      agentName={agent.name}
                      onChanged={refreshModels}
                    />
                  </div>
                </section>
              )}
              <AgentSupport
                adapter={('adapter' in agent ? agent.adapter : undefined) ?? agent.id}
              />
              <section aria-label="Models and executable">
                <h3 className="text-base font-medium mt-4">Models & executable</h3>
                <div className="agent-config-fields">
                  <label className="task-label">
                    Executable override
                    <input
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
                  <div className="agent-model-restriction">
                    <span>Allow only the listed models</span>
                    <Switch
                      checked={options.restrictModels}
                      onCheckedChange={(value) => update({ restrictModels: value })}
                      label={`Allow only listed models for ${agent.name}`}
                    />
                  </div>
                  <div className="agent-model-fields">
                    <label className="task-label">
                      Allowed model IDs (one per line)
                      <textarea
                        className="task-input"
                        rows={3}
                        value={options.models.join('\n')}
                        onChange={(e) => update({ models: e.target.value.split('\n') })}
                      />
                    </label>
                    <label className="task-label">
                      Default model ID
                      <input
                        className="task-input"
                        value={options.defaultModel}
                        onChange={(e) => update({ defaultModel: e.target.value })}
                        placeholder="CLI default or first allowed model"
                      />
                    </label>
                  </div>
                  <p className="task-muted">
                    Use supported model IDs. An empty restricted list blocks task launches.
                  </p>
                </div>
              </section>
            </section>
          );
        })}
      {!config.defaultMetaAgent && (
        <p className="task-error">
          Choose an enabled default agent before starting internal agent work.
        </p>
      )}
    </div>
  );
}
