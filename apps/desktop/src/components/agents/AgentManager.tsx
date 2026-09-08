import { Plus, RefreshCw, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { builtinAgents } from '../../lib/agent-catalog';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';
import { AddAgentForm } from './AddAgentForm';
import { AgentAccounts } from './AgentAccounts';
import './agent-manager.css';

export function AgentManager() {
  const config = useAgentConfigStore();
  const { runners, discovering, discover } = useExecutionStore();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(config.defaultMetaAgent);
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
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="agent-manager">
      <div>
        <h2 className="text-xl font-medium">Agent configuration</h2>
        <p className="task-muted mt-2">
          Choose an agent to manage its models, executable and accounts.
        </p>
      </div>
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
      <nav className="agent-chooser" aria-label="Agent to configure">
        {agents.map((agent) => (
          <Button
            key={agent.id}
            variant={selected?.id === agent.id ? 'secondary' : 'ghost'}
            aria-pressed={selected?.id === agent.id}
            onClick={() => setSelectedAgent(agent.id)}
          >
            {agent.name}
          </Button>
        ))}
      </nav>
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
                    disabled={!enabled || !runner?.available}
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
                    Use model IDs supported by this account. An empty restricted list blocks
                    Jackalope launches; CLI use outside the app is unchanged.
                  </p>
                </div>
              </section>
              {!('isCustom' in agent) && (
                <section aria-label="Agent accounts">
                  <h3 className="text-base font-medium mt-6">Accounts</h3>
                  <div className="agent-config-fields">
                    <AgentAccounts agentId={agent.id} agentName={agent.name} />
                  </div>
                </section>
              )}
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
