import { Checkbox } from '@jackalope/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { connectionSupport } from '../../lib/agent-capabilities';
import { builtinAgents } from '../../lib/agent-catalog';
import { bearerToken, withBearerToken, withoutBearerToken } from '../../lib/mcp-connection';
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
import type { SavedMcpConnection } from './McpConnectionResult';

export function McpConnectionForm({
  initial,
  editing = false,
  initialAuthentication,
  onCancel,
  onSaved,
  onBusyChange,
}: {
  initial?: Partial<McpServerConfig>;
  editing?: boolean;
  initialAuthentication?: 'none' | 'token' | 'oauth';
  onCancel: () => void;
  onSaved: (saved: SavedMcpConnection) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { projects, activeProjectId } = useProjectStore();
  const project = projects.find((project) => project.id === activeProjectId);
  const initialToken = bearerToken(initial?.extra);
  const defaultsToAgentSignIn =
    initialAuthentication === 'oauth' ||
    (initial?.managed &&
      initial.transport === 'http' &&
      initial.discovery === false &&
      !Object.keys(initial.extra ?? {}).length);
  const [name, setName] = useState(initial?.name ?? '');
  const [id, setId] = useState(initial?.id ?? '');
  const [idEdited, setIdEdited] = useState(!!initial?.id);
  const [scope, setScope] = useState(
    initial?.scope ?? (project ? `project:${project.id}` : 'global'),
  );
  const [agents, setAgents] = useState<string[] | null>(
    initial?.agents ?? (defaultsToAgentSignIn ? ['codex', 'claude'] : null),
  );
  const [transport, setTransport] = useState(initial?.transport ?? 'http');
  const [authentication, setAuthentication] = useState(
    initialAuthentication ??
      (initialToken !== undefined
        ? 'token'
        : Object.keys(initial?.extra ?? {}).length
          ? 'advanced'
          : defaultsToAgentSignIn
            ? 'oauth'
            : 'none'),
  );
  const [token, setToken] = useState(initialToken ?? '');
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
  const [extra, setExtra] = useState(
    JSON.stringify(
      initialToken !== undefined
        ? withoutBearerToken(initial?.extra ?? {})
        : (initial?.extra ?? {}),
      null,
      2,
    ),
  );
  const [discovery, setDiscovery] = useState(
    initial?.discovery ?? initialAuthentication !== 'oauth',
  );
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
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
      const agentSignIn = transport === 'http' && authentication === 'oauth';
      if (
        agentSignIn &&
        (discovery || !agents || agents.some((agent) => !['codex', 'claude'].includes(agent)))
      )
        throw new Error(
          'For agent sign-in, turn off on-demand tools and select Codex, Claude, or both.',
        );
      if (
        !legacy &&
        (agents ?? builtinAgents.map((agent) => agent.id)).some((agent) =>
          connectionSupport(agent, transport, transport !== 'sse' && discovery),
        )
      )
        throw new Error(
          'The selected agents do not all support this connection. Enable on-demand tools or choose compatible agents.',
        );
      let parsed: unknown;
      try {
        parsed = JSON.parse(extra || '{}');
      } catch {
        throw new Error(
          'Client options must be valid JSON. Check the syntax in Advanced settings.',
        );
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Client options must be a JSON object.');
      if (transport !== 'stdio' && authentication === 'token' && !token.trim())
        throw new Error('Enter a bearer token.');
      if (
        !editing &&
        useMcpStore.getState().servers.some((server) => server.id === id && server.scope === scope)
      )
        throw new Error(
          'A connection with this identifier already exists here. Edit it from Connections, or choose a different identifier in Advanced settings.',
        );
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
      const server: McpServerConfig = {
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
        extra:
          transport !== 'stdio' && authentication === 'token'
            ? withBearerToken(parsed as Record<string, unknown>, token.trim())
            : authentication === 'oauth' && transport === 'http'
              ? withoutBearerToken(parsed as Record<string, unknown>)
              : (parsed as Record<string, unknown>),
        enabled,
        discovery: !legacy && transport !== 'sse' && discovery,
      };
      await useMcpStore.getState().saveServer(server);
      if (enabled && !agentSignIn && transport !== 'sse') {
        setChecking(true);
        await useMcpStore.getState().probeServer(server);
      }
      onSaved({ server, agentSignIn });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setChecking(false);
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
          </div>
          <fieldset className="mcp-scope-options" aria-label="Connection type">
            {[
              { id: 'http', label: 'Remote URL' },
              { id: 'stdio', label: 'Local command' },
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
              <p className="task-muted">
                This runs a process on your computer. Save and check starts it and may download
                packages.
              </p>
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
          {transport !== 'stdio' && (
            <>
              <FormField label="Authentication">
                <select
                  className="task-input"
                  value={authentication}
                  onChange={(event) => {
                    const next = event.target.value;
                    let options: Record<string, unknown>;
                    try {
                      const parsed: unknown = JSON.parse(extra || '{}');
                      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                        throw new Error();
                      options = parsed as Record<string, unknown>;
                    } catch {
                      setError(
                        'Fix the client options JSON in Advanced settings before changing authentication.',
                      );
                      return;
                    }
                    if (authentication === 'token' && next === 'advanced' && token.trim())
                      options = withBearerToken(options, token.trim());
                    if (next === 'token') {
                      setToken(bearerToken(options) ?? token);
                      options = withoutBearerToken(options);
                    }
                    if (next === 'none' || next === 'oauth') options = withoutBearerToken(options);
                    setExtra(JSON.stringify(options, null, 2));
                    setAuthentication(next);
                    if (next === 'oauth') {
                      setDiscovery(false);
                      setAgents(['codex', 'claude']);
                    } else if (authentication === 'oauth') {
                      setDiscovery(true);
                      setAgents(null);
                    }
                  }}
                >
                  {!Object.keys(initial?.extra ?? {}).length && (
                    <option value="none">No authentication</option>
                  )}
                  <option value="token">Bearer token / API key</option>
                  {transport === 'http' && !legacy && (
                    <option value="oauth">Sign in through Codex or Claude</option>
                  )}
                  <option value="advanced">Use headers or client options</option>
                </select>
              </FormField>
              {authentication === 'token' && (
                <FormField label="Bearer token">
                  <Input
                    type="password"
                    autoComplete="off"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    required
                    placeholder="Token from the service"
                  />
                </FormField>
              )}
              {authentication === 'oauth' && (
                <InlineNotice>
                  After saving, sign in separately through each selected agent. This connection is
                  available to those agents through their own accounts.
                </InlineNotice>
              )}
              {authentication === 'advanced' && (
                <p className="task-muted">
                  Your existing headers and client options are preserved below.
                </p>
              )}
            </>
          )}
          <details
            className="mcp-advanced-settings"
            open={authentication === 'advanced' || env.length > 0 || undefined}
          >
            <summary>Advanced settings</summary>
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
                onChange={(event) => {
                  setExtra(event.target.value);
                  if (authentication === 'none') setAuthentication('advanced');
                }}
                spellCheck={false}
              />
            </FormField>
          </details>
        </section>
        <section className="mcp-form-section">
          <h2>Availability</h2>
          {editing && (
            <Switch label="Connection enabled" checked={enabled} onCheckedChange={setEnabled} />
          )}
          {legacy ? (
            <p className="task-muted">
              Editing the existing {scope} client configuration. Existing agent sessions need a
              restart. This client controls credential storage; use environment-variable references
              for secrets where it supports them.
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
              <p className="task-muted">
                Jackalope protects this saved configuration with your operating system’s credential
                storage. Selected agents and tools receive the credentials they need when a task
                runs.
              </p>
              <h3>Agents</h3>
              <div className="mcp-scope-options">
                <Button
                  type="button"
                  variant={agents === null ? 'secondary' : 'outline'}
                  disabled={authentication === 'oauth' && transport === 'http'}
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
                        disabled={
                          authentication === 'oauth' &&
                          transport === 'http' &&
                          !['codex', 'claude'].includes(agent.id)
                        }
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
                  disabled={
                    transport === 'sse' || (authentication === 'oauth' && transport === 'http')
                  }
                  onCheckedChange={(value) => {
                    setDiscovery(value);
                    if (!value)
                      setAgents(
                        (agents ?? builtinAgents.map((agent) => agent.id)).filter(
                          (agent) => !connectionSupport(agent, transport, false),
                        ),
                      );
                  }}
                />
              </div>
              <p className="task-muted">
                Loads relevant tools as tasks need them. Uses these credentials for selected agents.
                Direct connections depend on the selected agent and transport. On-demand tools
                support every agent adapter.
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
        <Button
          type="submit"
          disabled={busy}
          loading={busy}
          loadingLabel={checking ? 'Checking connection…' : 'Saving connection…'}
        >
          {(transport === 'http' && authentication === 'oauth') || transport === 'sse'
            ? 'Save connection'
            : 'Save and check'}
        </Button>
      </DialogFooter>
    </form>
  );
}
