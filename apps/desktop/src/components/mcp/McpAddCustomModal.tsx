import * as Dialog from '@radix-ui/react-dialog';
import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { McpServerConfig } from '../../lib/tauri-bridge';
import { useMcpStore } from '../../stores/mcpStore';
import { Button } from '../ui/button';
import { useDialogFocus } from '../ui/useDialogFocus';

interface McpAddCustomModalProps {
  open: boolean;
  onClose: () => void;
  existingServer?: McpServerConfig | null;
}

export function McpAddCustomModal({
  open,
  onClose,
  existingServer = null,
}: McpAddCustomModalProps) {
  const dialogFocus = useDialogFocus();
  const { saveServer } = useMcpStore();

  const [id, setId] = useState(existingServer?.id || '');
  const [idEdited, setIdEdited] = useState(!!existingServer);
  const [name, setName] = useState(existingServer?.name || '');
  const [scope, setScope] = useState(existingServer?.scope || 'global');
  const [transport, setTransport] = useState<'stdio' | 'http' | 'sse'>(
    existingServer?.transport === 'sse'
      ? 'sse'
      : existingServer?.transport === 'http'
        ? 'http'
        : 'stdio',
  );
  const [command, setCommand] = useState(existingServer?.command || '');
  const [argsStr, setArgsStr] = useState(JSON.stringify(existingServer?.args ?? []));
  const [url, setUrl] = useState(existingServer?.url || '');
  const [description, setDescription] = useState(existingServer?.description || '');
  const [envList, setEnvList] = useState<Array<{ id: string; key: string; value: string }>>(
    existingServer?.env
      ? Object.entries(existingServer.env).map(([key, value]) => ({
          id: crypto.randomUUID(),
          key,
          value,
        }))
      : [],
  );
  const [extraJson, setExtraJson] = useState(JSON.stringify(existingServer?.extra ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddEnv = () => {
    setEnvList([...envList, { id: crypto.randomUUID(), key: '', value: '' }]);
  };

  const handleRemoveEnv = (index: number) => {
    setEnvList(envList.filter((_, i) => i !== index));
  };

  const handleEnvChange = (index: number, field: 'key' | 'value', val: string) => {
    setEnvList(envList.map((item, i) => (i === index ? { ...item, [field]: val } : item)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim() || !name.trim()) {
      setError('Server ID and name are required.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const envRecord: Record<string, string> = {};
      for (const item of envList) {
        if (item.key.trim()) {
          envRecord[item.key.trim()] = item.value;
        }
      }

      const parsedArgs: unknown = JSON.parse(argsStr.trim() || '[]');
      if (!Array.isArray(parsedArgs) || parsedArgs.some((arg) => typeof arg !== 'string'))
        throw new Error('Arguments must be a JSON array of strings.');
      const extra: unknown = JSON.parse(extraJson);
      if (!extra || typeof extra !== 'object' || Array.isArray(extra))
        throw new Error('Advanced connection fields must be a JSON object.');

      const config: McpServerConfig = {
        id: existingServer?.id ?? id.trim(),
        extra: extra as Record<string, unknown>,
        name: name.trim(),
        scope,
        transport,
        command: transport === 'stdio' ? command.trim() : undefined,
        args: transport === 'stdio' ? parsedArgs : [],
        url: transport !== 'stdio' ? url.trim() : undefined,
        env: envRecord,
        description: description.trim() || undefined,
        enabled: true,
      };

      await saveServer(config);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(val) => !val && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content {...dialogFocus} className="task-dialog appearance-panel max-w-lg">
          <Dialog.Close className="task-close" aria-label="Close dialog" disabled={busy}>
            <X size={18} />
          </Dialog.Close>

          <Dialog.Title className="text-xl font-medium tracking-tight mb-1">
            {existingServer ? 'Edit MCP Server' : 'Add Custom MCP Server'}
          </Dialog.Title>
          <Dialog.Description className="text-xs text-[var(--color-text-muted)] mb-4">
            Connect any local stdio executable or remote Streamable HTTP Model Context Protocol
            server.
          </Dialog.Description>

          <p className="task-muted mb-3">
            Global writes to Codex, Claude Code and Grok user configurations. Per-agent edits affect
            only the selected client. Existing sessions need a restart.
          </p>
          <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
            {/* Scope */}
            <div>
              <p className="block font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                Target Scope
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'global', label: 'Global' },
                  { id: 'claude', label: 'Claude Code' },
                  { id: 'codex', label: 'Codex' },
                  { id: 'grok', label: 'Grok' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={scope === item.id}
                    disabled={!!existingServer}
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
            </div>

            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  className="block font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1"
                  htmlFor="McpAddCustomModal-field-1"
                >
                  Server Name
                </label>
                <input
                  id="McpAddCustomModal-field-1"
                  className="task-input w-full text-xs"
                  placeholder="e.g. Postgres DB"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!idEdited) {
                      setId(e.target.value.toLowerCase().replaceAll(/[^a-z0-9_-]/g, '-'));
                    }
                  }}
                  required
                />
              </div>
              <div>
                <label
                  className="block font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1"
                  htmlFor="McpAddCustomModal-field-2"
                >
                  Identifier
                </label>
                <input
                  id="McpAddCustomModal-field-2"
                  className="task-input w-full font-mono text-xs"
                  placeholder="e.g. postgres-db"
                  value={id}
                  disabled={!!existingServer}
                  onChange={(e) => {
                    setIdEdited(true);
                    setId(e.target.value);
                  }}
                  required
                />
              </div>
            </div>

            <details>
              <summary className="task-summary">Advanced connection fields</summary>
              <label className="task-label">
                Headers and client options (JSON object)
                <textarea
                  className="task-input"
                  rows={4}
                  value={extraJson}
                  onChange={(e) => setExtraJson(e.target.value)}
                />
              </label>
              <p className="task-muted">
                Preserves existing authentication and tool options. Use headers for HTTP
                authentication; credentials remain in the agent configuration file.
              </p>
            </details>
            {/* Transport type */}
            <div>
              <p className="block font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                Transport
              </p>
              <div className="flex gap-2">
                {transport === 'sse' && <span>Existing legacy SSE connection</span>}
                <button
                  type="button"
                  aria-pressed={transport === 'stdio'}
                  onClick={() => setTransport('stdio')}
                  className={`px-3 py-1.5 text-xs rounded-md border ${
                    transport === 'stdio'
                      ? 'bg-[var(--color-accent-subtle)] border-[var(--color-accent)] text-[var(--color-accent-ink)] font-semibold'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  stdio (Command)
                </button>
                <button
                  type="button"
                  aria-pressed={transport === 'http'}
                  onClick={() => setTransport('http')}
                  className={`px-3 py-1.5 text-xs rounded-md border ${
                    transport === 'http'
                      ? 'bg-[var(--color-accent-subtle)] border-[var(--color-accent)] text-[var(--color-accent-ink)] font-semibold'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  Streamable HTTP
                </button>
              </div>
            </div>

            {transport === 'stdio' ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1">
                    <label
                      className="block font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1"
                      htmlFor="McpAddCustomModal-field-3"
                    >
                      Command
                    </label>
                    <input
                      id="McpAddCustomModal-field-3"
                      className="task-input w-full font-mono text-xs"
                      placeholder="e.g. npx, uvx, node"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      required
                    />
                  </div>
                  <div className="col-span-2">
                    <label
                      className="block font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1"
                      htmlFor="McpAddCustomModal-field-4"
                    >
                      Arguments (JSON array)
                    </label>
                    <input
                      id="McpAddCustomModal-field-4"
                      className="task-input w-full font-mono text-xs"
                      placeholder="-y @modelcontextprotocol/server-postgres"
                      value={argsStr}
                      onChange={(e) => setArgsStr(e.target.value)}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label
                  className="block font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1"
                  htmlFor="McpAddCustomModal-field-5"
                >
                  Remote Endpoint URL
                </label>
                <input
                  id="McpAddCustomModal-field-5"
                  className="task-input w-full font-mono text-xs"
                  placeholder="https://example.com/mcp"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </div>
            )}

            {/* Description */}
            <div>
              <label
                className="block font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1"
                htmlFor="McpAddCustomModal-field-6"
              >
                Description (Optional)
              </label>
              <input
                id="McpAddCustomModal-field-6"
                className="task-input w-full text-xs"
                placeholder="What capabilities does this MCP provide?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Env vars */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Environment Variables
                </p>
                <button
                  type="button"
                  onClick={handleAddEnv}
                  className="text-xs text-[var(--color-accent-ink)] hover:underline inline-flex items-center gap-1"
                >
                  <Plus size={12} /> Add Variable
                </button>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {envList.map((item, idx) => (
                  <div key={item.id} className="flex gap-1.5 items-center">
                    <input
                      className="task-input flex-1 font-mono text-xs"
                      placeholder="KEY (e.g. API_TOKEN)"
                      aria-label={`Environment variable ${idx + 1} name`}
                      value={item.key}
                      onChange={(e) => handleEnvChange(idx, 'key', e.target.value)}
                    />
                    <input
                      className="task-input flex-1 font-mono text-xs"
                      placeholder="VALUE"
                      aria-label={`Environment variable ${idx + 1} value`}
                      type="password"
                      value={item.value}
                      onChange={(e) => handleEnvChange(idx, 'value', e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveEnv(idx)}
                      aria-label={`Remove environment variable ${idx + 1}`}
                      className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <p role="alert" className="task-error text-xs">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-4 border-t border-[var(--color-border)]">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : existingServer ? 'Save Changes' : 'Add MCP Server'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
