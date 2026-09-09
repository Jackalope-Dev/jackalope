import { ArrowLeft, Check, Key, Plug } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { McpServerConfig } from '../../lib/tauri-bridge';
import { type AllMcpsServer, useMcpStore } from '../../stores/mcpStore';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { McpServerIcon } from './McpServerIcon';
import { marketplaceName } from './marketplace-info';

interface McpConfigureServerProps {
  server: AllMcpsServer;
  onClose: () => void;
  defaultScope?: string;
}

export function McpConfigureServer({
  server,
  onClose,
  defaultScope = 'global',
}: McpConfigureServerProps) {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const { saveServer } = useMcpStore();

  const [scope, setScope] = useState(defaultScope);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState<string[]>([]);
  const [url, setUrl] = useState('');
  const [extraJson, setExtraJson] = useState('{}');
  const [remoteTransport, setRemoteTransport] = useState<'http' | 'sse'>('http');
  const [submitting, setSubmitting] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (server) {
      setScope(defaultScope);
      setError(null);
      setInstalled(false);

      // Extract config from snippet if available
      let detectedCmd = '';
      let detectedArgs: string[] = [];
      let detectedUrl = '';
      const initialEnv: Record<string, string> = {};
      let initialExtra: Record<string, unknown> = {};
      let initialTransport: 'http' | 'sse' = 'http';

      if (server.claudeConfigSnippet?.mcpServers) {
        const firstKey = Object.keys(server.claudeConfigSnippet.mcpServers)[0];
        const cfg = server.claudeConfigSnippet.mcpServers[firstKey];
        if (cfg) {
          initialTransport = cfg.type === 'sse' ? 'sse' : 'http';
          initialExtra = Object.fromEntries(
            Object.entries(cfg).filter(
              ([key]) => !['command', 'args', 'url', 'env', 'type'].includes(key),
            ),
          );
          if (cfg.command) detectedCmd = cfg.command;
          if (cfg.args) detectedArgs = cfg.args;
          if (cfg.url) detectedUrl = cfg.url;
          if (cfg.env) {
            for (const [k, v] of Object.entries(cfg.env)) {
              initialEnv[k] = v || '';
            }
          }
        }
      }

      // Merge any listed envVars
      if (server.envVars && server.envVars.length > 0) {
        for (const ev of server.envVars) {
          if (!(ev in initialEnv)) {
            initialEnv[ev] = '';
          }
        }
      }

      setCommand(detectedCmd);
      setArgs(detectedArgs);
      setUrl(detectedUrl);
      setEnvValues(initialEnv);
      setExtraJson(JSON.stringify(initialExtra, null, 2));
      setRemoteTransport(initialTransport);
    }
  }, [server, defaultScope]);

  if (!server) return null;

  const isRemote = server.installKind === 'remote' || !!url;

  const handleInstall = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const extra: unknown = JSON.parse(extraJson);
      if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
        throw new Error('Advanced connection fields must be a JSON object.');
      }
      const config: McpServerConfig = {
        id: server.id,
        name: server.name,
        scope,
        transport: isRemote ? remoteTransport : 'stdio',
        command: isRemote ? undefined : command,
        args: isRemote ? [] : args,
        url: isRemote ? url : undefined,
        env: envValues,
        description: server.description,
        enabled: true,
        extra: extra as Record<string, unknown>,
      };

      await saveServer(config);
      setInstalled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mcp-configure-page" aria-label={`Configure ${marketplaceName(server)}`}>
      <Button variant="ghost" disabled={submitting} onClick={onClose}>
        <ArrowLeft size={16} />
        Back to server
      </Button>
      <header className="mcp-server-hero">
        <McpServerIcon server={server} />
        <div>
          <h1 ref={heading} tabIndex={-1}>
            Configure {marketplaceName(server)}
          </h1>
          <p className="task-muted">Choose where this connection is available.</p>
        </div>
      </header>
      {installed ? (
        <div className="mcp-configuration-saved" role="status">
          <Check size={28} aria-hidden="true" />
          <h2>Connection saved</h2>
          <p>Restart existing agent sessions to use this connection.</p>
          <Button onClick={onClose}>Back to server</Button>
        </div>
      ) : (
        <>
          <p className="task-notice mb-4">
            Review the publisher and command. Packages may download when the connection starts.
          </p>
          <div className="mcp-configure-fields text-sm">
            {/* Target Scope */}
            <div>
              <p className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
                Target Scope
              </p>
              <div className="mcp-scope-options">
                {[
                  ...(activeProjectId
                    ? [{ id: `project:${activeProjectId}`, label: 'This project' }]
                    : []),
                  { id: 'global', label: 'Global' },
                  { id: 'claude', label: 'Claude Code' },
                  { id: 'codex', label: 'Codex' },
                  { id: 'grok', label: 'Grok' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={scope === item.id}
                    onClick={() => setScope(item.id)}
                    className={`px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                      scope === item.id
                        ? 'bg-[var(--color-accent-subtle)] border-[var(--color-accent)] text-[var(--color-accent-ink)] font-semibold'
                        : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mt-1.5">
                {scope === 'global' &&
                  'Writes to the user configurations for Codex, Claude Code and Grok. Restart existing agent sessions to use changes.'}
                {scope === 'claude' && 'Saved to Claude Code (~/.claude.json).'}
                {scope === 'codex' && 'Saved to Codex configuration (~/.codex/config.toml).'}
                {scope === 'grok' && 'Saved to Grok (~/.grok/config.toml).'}
              </p>
            </div>

            {/* Execution / Command Details */}
            {!isRemote ? (
              <div>
                <p className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
                  Command & Arguments
                </p>
                <div className="p-2.5 rounded-lg bg-[var(--color-surface-sunken)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text-primary)]">
                  <span>{command} </span>
                  <span className="text-[var(--color-text-muted)]">{args.join(' ')}</span>
                </div>
              </div>
            ) : (
              <div>
                <label
                  className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5"
                  htmlFor="McpConfigureServer-field-1"
                >
                  Remote MCP Endpoint URL
                </label>
                <input
                  id="McpConfigureServer-field-1"
                  className="task-input w-full font-mono text-xs"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            )}

            {/* Environment Variables (if needed) */}
            {Object.keys(envValues).length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Key size={14} className="text-[var(--color-accent-ink)]" />
                  <p className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                    Required Environment Variables
                  </p>
                </div>
                <div className="space-y-2">
                  {Object.entries(envValues).map(([key, val]) => (
                    <div key={key}>
                      <div className="text-xs font-mono text-[var(--color-text-primary)] mb-1">
                        {key}
                      </div>
                      <input
                        aria-label={key}
                        type={
                          key.toLowerCase().includes('token') ||
                          key.toLowerCase().includes('pat') ||
                          key.toLowerCase().includes('secret') ||
                          key.toLowerCase().includes('key')
                            ? 'password'
                            : 'text'
                        }
                        className="task-input w-full font-mono text-xs"
                        placeholder={`Enter ${key}`}
                        value={val}
                        onChange={(e) =>
                          setEnvValues((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <section aria-label="Additional connection options">
              <label className="task-label" htmlFor="marketplace-connection-fields">
                Authentication headers and additional client options (JSON)
              </label>
              <textarea
                id="marketplace-connection-fields"
                className="task-input w-full font-mono"
                rows={4}
                value={extraJson}
                onChange={(event) => setExtraJson(event.target.value)}
              />
            </section>

            {error && (
              <p role="alert" className="task-error text-xs">
                {error}
              </p>
            )}
          </div>

          <div className="mcp-configure-actions">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleInstall} disabled={submitting || installed}>
              {installed ? (
                <>
                  <Check size={16} />
                  Saved
                </>
              ) : submitting ? (
                'Saving…'
              ) : (
                <>
                  <Plug size={16} />
                  Save connection
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
