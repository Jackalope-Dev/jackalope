import { Checkbox, RefreshIcon } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, CheckCircle2, Cpu, KeyRound, Server, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  type DetectedKey,
  detectEnvKeys,
  detectLocalLlms,
  importDetectedKey,
  type LocalLlmEndpoint,
} from '../../lib/local-detection';
import { Button } from '../ui/button';
import { useDialogFocus } from '../ui/useDialogFocus';
import './detected-keys.css';

export function DetectedKeysModal({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}) {
  const dialogFocus = useDialogFocus();
  const [keys, setKeys] = useState<DetectedKey[]>([]);
  const [endpoints, setEndpoints] = useState<LocalLlmEndpoint[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const [foundKeys, foundEndpoints] = await Promise.all([detectEnvKeys(), detectLocalLlms()]);
      setKeys(foundKeys);
      setEndpoints(foundEndpoints);
      // Strictly maintain: keys start unselected
      setSelectedKeys(new Set());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void scan();
    }
  }, [open, scan]);

  const toggleKey = (keyName: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(keyName)) {
        next.delete(keyName);
      } else {
        next.add(keyName);
      }
      return next;
    });
  };

  const handleImport = async () => {
    if (selectedKeys.size === 0) return;
    setImporting(true);
    setError(null);
    try {
      let importedCount = 0;
      for (const keyName of selectedKeys) {
        await importDetectedKey(keyName);
        importedCount += 1;
      }
      setSuccessMessage(`Successfully imported ${importedCount} key(s) into Jackalope profiles!`);
      setSelectedKeys(new Set());
      await scan();
      onImported?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          {...dialogFocus}
          className="dialog-content detected-keys-modal max-w-2xl"
          aria-describedby="detected-keys-description"
        >
          <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <KeyRound size={20} className="text-[var(--color-brand)]" />
              <Dialog.Title className="text-lg font-semibold text-[var(--color-text-primary)]">
                Local Models & Ambient Key Discovery
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          <p id="detected-keys-description" className="sr-only">
            Discovery hub for local LLM inference engines and environment API keys with privacy
            guarantees.
          </p>

          <div className="my-4 space-y-4">
            {/* Privacy Guarantee Banner */}
            <div className="privacy-guarantee-banner p-3 rounded-lg border flex gap-3 items-start bg-emerald-500/10 border-emerald-500/30 text-[var(--color-text-primary)]">
              <ShieldCheck size={22} className="text-emerald-500 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <strong className="block font-medium text-emerald-400">
                  Local-Only Privacy Guarantee
                </strong>
                <p className="text-[var(--color-text-secondary)] leading-relaxed">
                  Jackalope inspects environment variables and local ports purely in-memory on your
                  machine.
                  <strong> Keys are NEVER transmitted to any external server or telemetry.</strong>{' '}
                  No keys are added to Jackalope unless you explicitly check them and click import
                  below.
                </p>
              </div>
            </div>

            {error && (
              <div className="p-3 text-xs rounded-md bg-red-500/10 border border-red-500/30 text-red-400">
                {error}
              </div>
            )}

            {successMessage && (
              <div className="p-3 text-xs rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-2">
                <CheckCircle2 size={16} />
                {successMessage}
              </div>
            )}

            {/* Local LLM Inference Engines */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium flex items-center gap-2 text-[var(--color-text-primary)]">
                  <Server size={15} />
                  Local Inference Servers
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void scan()}
                  disabled={loading}
                  loading={loading}
                  loadingLabel="Scanning…"
                  className="h-7 text-xs flex items-center gap-1.5"
                >
                  <RefreshIcon />
                  Re-scan
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {endpoints.map((ep) => (
                  <div
                    key={ep.service}
                    className={`p-3 rounded-lg border transition-all ${
                      ep.online
                        ? 'border-emerald-500/40 bg-emerald-500/5'
                        : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] opacity-70'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">{ep.service}</span>
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${
                          ep.online ? 'bg-emerald-400 animate-pulse' : 'bg-gray-400'
                        }`}
                        title={ep.online ? 'Online' : 'Offline'}
                      />
                    </div>
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1 font-mono">
                      Port {ep.port}
                    </p>
                    <div className="mt-2 text-[11px]">
                      {ep.online ? (
                        <span className="text-emerald-400 font-medium">
                          {ep.models.length > 0
                            ? `${ep.models.length} model(s) loaded`
                            : 'Ready for connection'}
                        </span>
                      ) : (
                        <span className="text-[var(--color-text-muted)]">Not running</span>
                      )}
                    </div>
                    {ep.online && ep.models.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {ep.models.slice(0, 2).map((m) => (
                          <span
                            key={m}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] font-mono truncate max-w-[120px]"
                            title={m}
                          >
                            {m}
                          </span>
                        ))}
                        {ep.models.length > 2 && (
                          <span className="text-[9px] px-1 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]">
                            +{ep.models.length - 2}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Detected Environment Keys */}
            <section className="space-y-2 pt-2 border-t border-[var(--color-border)]">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium flex items-center gap-2 text-[var(--color-text-primary)]">
                  <Cpu size={15} />
                  Detected System Keys ({keys.length})
                </h4>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {selectedKeys.size} selected
                </span>
              </div>

              {keys.length === 0 ? (
                <div className="p-4 text-center rounded-lg border border-dashed border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
                  {loading
                    ? 'Scanning environment variables...'
                    : 'No AI API keys found in system environment variables (e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY).'}
                </div>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {keys.map((k) => {
                    const isChecked = selectedKeys.has(k.keyName);
                    return (
                      <label
                        key={k.keyName}
                        className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-colors ${
                          isChecked
                            ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/5'
                            : 'border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={isChecked}
                            onChange={() => toggleKey(k.keyName)}
                            className="rounded border-[var(--color-border)] text-[var(--color-brand)] focus:ring-[var(--color-brand)]"
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <strong className="text-xs text-[var(--color-text-primary)]">
                                {k.provider}
                              </strong>
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]">
                                {k.targetAgent}
                              </span>
                              {k.isConfigured && (
                                <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                                  <Check size={10} /> Already configured
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-[var(--color-text-muted)] font-mono mt-0.5">
                              {k.keyName} ·{' '}
                              <span className="text-[var(--color-text-secondary)]">
                                {k.maskedPreview}
                              </span>
                            </p>
                          </div>
                        </div>

                        <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide">
                          {k.source}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-[var(--color-border)] mt-4">
            <Dialog.Close asChild>
              <Button variant="outline" size="sm">
                Close
              </Button>
            </Dialog.Close>

            <Button
              size="sm"
              onClick={() => void handleImport()}
              disabled={selectedKeys.size === 0 || importing}
              className="flex items-center gap-2"
              loading={importing}
              loadingLabel="Importing…"
            >
              <Sparkles size={14} />
              Import Selected ({selectedKeys.size})
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
