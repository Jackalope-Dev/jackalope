import { Checkbox } from '@jackalope/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { builtinAgents } from '../../lib/agent-catalog';
import { mcpEndpointError } from '../../lib/mcp-endpoint';
import type { McpServerConfig } from '../../lib/tauri-bridge';
import { useMcpStore } from '../../stores/mcpStore';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { DialogFooter } from '../ui/Dialog';
import { FormField } from '../ui/FormField';
import { InlineNotice } from '../ui/InlineNotice';
import { Input } from '../ui/input';
import { Switch } from '../ui/Switch';
import { Textarea } from '../ui/Textarea';

export function McpConnectionForm({
  initial,
  editing = false,
  onCancel,
  onSaved,
  onBusyChange,
}: {
  initial?: Partial<McpServerConfig>;
  editing?: boolean;
  onCancel: () => void;
  onSaved: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { projects, activeProjectId } = useProjectStore();
  const project = projects.find((project) => project.id === activeProjectId);
  const [name, setName] = useState(initial?.name ?? '');
  const [id, setId] = useState(initial?.id ?? '');
  const [idEdited, setIdEdited] = useState(!!initial?.id);
  const [scope, setScope] = useState(
    initial?.scope ?? (project ? `project:${project.id}` : 'global'),
  );
  const [agents, setAgents] = useState<string[] | null>(initial?.agents ?? null);
  const [transport, setTransport] = useState(initial?.transport ?? 'stdio');
  const [command, setCommand] = useState(initial?.command ?? '');
  const [args, setArgs] = useState(
    (initial?.args ?? []).map((value) => ({ id: crypto.randomUUID(), value })),
  );
  const [url, setUrl] = useState(initial?.url ?? '');
  const [env, setEnv] = useState(
    Object.entries(initial?.env ?? {}).map(([key, value]) => ({
      id: crypto.randomUUID(),
      key,
      value,
    })),
  );
  const [extra, setExtra] = useState(JSON.stringify(initial?.extra ?? {}, null, 2));
  const [discovery, setDiscovery] = useState(initial?.discovery ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const legacy = editing && !initial?.managed && !initial?.scope?.startsWith('project:');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      if (!name.trim() || !/^[a-zA-Z0-9_.-]+$/.test(id) || id === 'jackalope')
        throw new Error(
          'Use a name and an identifier with letters, numbers, dots or dashes. “jackalope” is reserved.',
        );
      if (agents?.length === 0) throw new Error('Choose at least one agent.');
      if (transport === 'stdio' && !command.trim())
        throw new Error('Enter the executable command.');
      if (transport !== 'stdio') {
        const endpointError = mcpEndpointError(url.trim());
        if (endpointError) throw new Error(endpointError);
      }
      if (
        !legacy &&
        !discovery &&
        (!agents || agents.some((id) => !['codex', 'claude'].includes(id)))
      )
        throw new Error(
          'Enable on-demand tools for all agents, or select Codex and Claude for a direct connection.',
        );
      const parsed: unknown = JSON.parse(extra || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Client options must be a JSON object.');
      const keys = env.map((item) => item.key.trim()).filter(Boolean);
      if (
        new Set(keys).size !== keys.length ||
        keys.some((key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      )
        throw new Error(
          'Use unique environment variable names with letters, numbers and underscores.',
        );
      setBusy(true);
      onBusyChange?.(true);
      await useMcpStore.getState().saveServer({
        ...initial,
        id,
        name: name.trim(),
        scope,
        managed: !legacy,
        agents: legacy ? initial?.agents : agents,
        transport,
        command: transport === 'stdio' ? command.trim() : undefined,
        args: transport === 'stdio' ? args.map((item) => item.value) : [],
        url: transport !== 'stdio' ? url.trim() : undefined,
        env: Object.fromEntries(
          env.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value]),
        ),
        extra: parsed as Record<string, unknown>,
        enabled: initial?.enabled ?? true,
        discovery: !legacy && transport !== 'sse' && discovery,
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };
  return (
    <form className="mcp-connection-form" onSubmit={submit}>
      <fieldset disabled={busy} className="mcp-form-grid">
        <section className="mcp-form-section">
          <h2>Connection</h2>
          <div className="mcp-field-pair">
            <FormField label="Name">
              <Input
                required
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!idEdited)
                    setId(event.target.value.toLowerCase().replaceAll(/[^a-z0-9_-]/g, '-'));
                }}
                placeholder="Postgres"
              />
            </FormField>
            <FormField label="Identifier">
              <Input
                required
                disabled={editing}
                value={id}
                onChange={(event) => {
                  setIdEdited(true);
                  setId(event.target.value);
                }}
              />
            </FormField>
          </div>
          <fieldset className="mcp-scope-options" aria-label="Connection type">
            {[
              { id: 'stdio', label: 'Local command' },
              { id: 'http', label: 'Remote URL' },
              ...(transport === 'sse' ? [{ id: 'sse', label: 'Legacy SSE' }] : []),
            ].map((item) => (
              <Button
                type="button"
                key={item.id}
                variant={transport === item.id ? 'secondary' : 'outline'}
                aria-pressed={transport === item.id}
                onClick={() => setTransport(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </fieldset>
          {transport === 'stdio' ? (
            <>
              <FormField label="Command">
                <Input
                  className="font-mono"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="npx, uvx, or an executable path"
                  required
                />
              </FormField>
              <div>
                <div className="mcp-field-heading">
                  <h3>Arguments</h3>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setArgs([...args, { id: crypto.randomUUID(), value: '' }])}
                  >
                    <Plus size={15} />
                    Add argument
                  </Button>
                </div>
                {args.map((item, index) => (
                  <div className="mcp-variable-row" key={item.id}>
                    <Input
                      aria-label={`Argument ${index + 1}`}
                      className="task-input font-mono"
                      value={item.value}
                      onChange={(event) =>
                        setArgs(
                          args.map((arg) =>
                            arg.id === item.id ? { ...arg, value: event.target.value } : arg,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Remove argument ${index + 1}`}
                      onClick={() => setArgs(args.filter((arg) => arg.id !== item.id))}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <FormField label="Endpoint URL">
              <Input
                className="font-mono"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                required
                placeholder="https://example.com/mcp"
              />
            </FormField>
          )}
          <div>
            <div className="mcp-field-heading">
              <h3>Environment variables</h3>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEnv([...env, { id: crypto.randomUUID(), key: '', value: '' }])}
              >
                <Plus size={15} />
                Add variable
              </Button>
            </div>
            {env.map((item, index) => (
              <div className="mcp-variable-row" key={item.id}>
                <Input
                  aria-label={`Variable ${index + 1} name`}
                  className="task-input font-mono"
                  placeholder="API_TOKEN"
                  value={item.key}
                  onChange={(event) =>
                    setEnv(
                      env.map((variable) =>
                        variable.id === item.id
                          ? { ...variable, key: event.target.value }
                          : variable,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Variable ${index + 1} value`}
                  className="task-input"
                  type="password"
                  placeholder="Value"
                  value={item.value}
                  onChange={(event) =>
                    setEnv(
                      env.map((variable) =>
                        variable.id === item.id
                          ? { ...variable, value: event.target.value }
                          : variable,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove variable ${index + 1}`}
                  onClick={() => setEnv(env.filter((variable) => variable.id !== item.id))}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
          </div>
          <FormField label="Headers and client options (JSON)">
            <Textarea
              className="font-mono"
              rows={4}
              value={extra}
              onChange={(event) => setExtra(event.target.value)}
              spellCheck={false}
            />
          </FormField>
        </section>
        <section className="mcp-form-section">
          <h2>Availability</h2>
          {legacy ? (
            <p className="task-muted">
              Editing the existing {scope} client configuration. Existing agent sessions need a
              restart.
            </p>
          ) : (
            <>
              <h3>Where</h3>
              <div className="mcp-scope-options">
                <Button
                  type="button"
                  variant={scope === 'global' ? 'secondary' : 'outline'}
                  disabled={editing}
                  aria-pressed={scope === 'global'}
                  onClick={() => setScope('global')}
                >
                  All projects
                </Button>
                <Button
                  type="button"
                  variant={scope.startsWith('project:') ? 'secondary' : 'outline'}
                  disabled={editing || !project}
                  aria-pressed={scope.startsWith('project:')}
                  onClick={() => project && setScope(`project:${project.id}`)}
                >
                  This project{project ? ` · ${project.name}` : ''}
                </Button>
              </div>
              <p className="task-muted">
                {scope === 'global'
                  ? 'Available to new Jackalope tasks in every project.'
                  : 'Available to new tasks in this project only.'}
              </p>
              <h3>Agents</h3>
              <div className="mcp-scope-options">
                <Button
                  type="button"
                  variant={agents === null ? 'secondary' : 'outline'}
                  aria-pressed={agents === null}
                  onClick={() => setAgents(null)}
                >
                  All agents
                </Button>
                <Button
                  type="button"
                  variant={agents !== null ? 'secondary' : 'outline'}
                  aria-pressed={agents !== null}
                  onClick={() => setAgents(agents ?? ['codex', 'claude'])}
                >
                  Specific agents
                </Button>
              </div>
              {agents !== null && (
                <div className="mcp-agent-options">
                  {builtinAgents.map((agent) => (
                    <label key={agent.id}>
                      <Checkbox
                        checked={agents.includes(agent.id)}
                        onChange={(event) =>
                          setAgents(
                            event.target.checked
                              ? [...agents, agent.id]
                              : agents.filter((id) => id !== agent.id),
                          )
                        }
                      />
                      <span>{agent.name}</span>
                    </label>
                  ))}
                </div>
              )}
              <div className="mcp-field-heading">
                <h3>On-demand tools</h3>
                <Switch
                  label="On-demand tools"
                  checked={discovery}
                  disabled={transport === 'sse'}
                  onCheckedChange={setDiscovery}
                />
              </div>
              <p className="task-muted">
                Loads relevant tools as tasks need them. Uses these credentials for selected agents.
                Direct connections support Codex and Claude; on-demand tools support every agent
                adapter.
              </p>
              {transport !== 'stdio' && (
                <p className="task-muted">
                  On-demand tools use headers or a bearer token environment variable in client
                  options. Agent-managed OAuth needs a direct client connection.
                </p>
              )}
            </>
          )}
        </section>
      </fieldset>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <DialogFooter className="mcp-configure-actions">
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy} loading={busy} loadingLabel={'Saving…'}>
          {editing ? 'Save changes' : 'Add connection'}
        </Button>
      </DialogFooter>
    </form>
  );
}
