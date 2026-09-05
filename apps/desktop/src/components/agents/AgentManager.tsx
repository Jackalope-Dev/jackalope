import { useState } from 'react';
import { Plus, RefreshCw, Star, Trash2 } from 'lucide-react';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';
import { Select, SelectItem } from '../ui/Select';

export function AgentManager() {
  const config = useAgentConfigStore();
  const { runners, discovering, discover } = useExecutionStore();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [adapter, setAdapter] = useState<'codex' | 'claude' | 'grok'>('codex');
  const desktop = isTauriEnvironment();
  const agents = [
    { id: 'codex', name: 'Codex' },
    { id: 'claude', name: 'Claude Code' },
    { id: 'grok', name: 'Grok' },
    ...config.customAgents,
  ];
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
  const add = () => {
    if (!name.trim() || !path.trim()) return;
    config.addCustomAgent({
      id: `custom-${crypto.randomUUID()}`,
      name: name.trim(),
      command: path.trim(),
      adapter,
      models: [],
      description: `Uses the ${adapter} CLI interface.`,
      enabled: true,
    });
    setName('');
    setPath('');
    setAdding(false);
    setSaved(false);
  };
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-medium">Choose the agents Jackalope can use</h2>
        <p className="task-muted mt-2">
          Enable your agents, choose their models, and set a default. The default handles internal
          agent work and is the starting choice for new tasks. Repository file scanning runs locally
          without an LLM.
        </p>
        <p className="task-muted mt-2">
          Model restrictions apply to launches from Jackalope, including the queue and
          continuations. They do not change use of the CLI outside Jackalope.
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
        <div className="space-y-3 p-4 bg-[var(--color-surface-elevated)] rounded-xl">
          <h3 className="font-medium">Connect an installed CLI</h3>
          <p className="task-muted">
            Choose the interface this executable supports. Jackalope currently supports Codex,
            Claude Code and Grok; arbitrary command-line programs need an adapter.
          </p>
          <label className="task-label">
            Name
            <input
              className="task-input mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label htmlFor="manual-agent-adapter" className="task-label">
            CLI interface
            <Select
              id="manual-agent-adapter"
              value={adapter}
              onValueChange={(value) => setAdapter(value as typeof adapter)}
            >
              <SelectItem value="codex">Codex</SelectItem>
              <SelectItem value="claude">Claude Code</SelectItem>
              <SelectItem value="grok">Grok</SelectItem>
            </Select>
          </label>
          <label className="task-label">
            Absolute executable path
            <input
              className="task-input mt-1"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="C:\Tools\agent.exe"
            />
          </label>
          <Button type="button" onClick={add} disabled={!name.trim() || !path.trim()}>
            Add agent
          </Button>
        </div>
      )}
      {agents.map((agent) => {
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
          <section key={agent.id} className="py-4 border-b border-[var(--color-border)] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
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
              <div className="flex items-center gap-2">
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
            <details>
              <summary className="task-summary">Models & executable</summary>
              <div className="mt-3 space-y-3">
                <label className="task-label">
                  Executable override
                  <input
                    className="task-input mt-1"
                    value={options.command ?? ('command' in agent ? agent.command : '')}
                    onChange={(e) => update({ command: e.target.value })}
                    placeholder="Leave empty to auto-detect"
                  />
                </label>
                <div className="flex gap-3 items-center">
                  <span>Allow only the listed models</span>
                  <Switch
                    checked={options.restrictModels}
                    onCheckedChange={(value) => update({ restrictModels: value })}
                    label={`Allow only listed models for ${agent.name}`}
                  />
                </div>
                <label className="task-label">
                  Allowed model IDs (one per line)
                  <textarea
                    className="task-input mt-1"
                    rows={3}
                    value={options.models.join('\n')}
                    onChange={(e) => update({ models: e.target.value.split('\n') })}
                  />
                </label>
                <label className="task-label">
                  Default model ID
                  <input
                    className="task-input mt-1"
                    value={options.defaultModel}
                    onChange={(e) => update({ defaultModel: e.target.value })}
                    placeholder="CLI default, or first allowed model when restricted"
                  />
                </label>
                <p className="task-muted">
                  Use exact IDs supported by this CLI and account. An empty restricted list blocks
                  launches. Jackalope passes the selected model to the executable.
                </p>
              </div>
            </details>
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
