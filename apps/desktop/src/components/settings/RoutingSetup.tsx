import { characterPaths } from '@jackalope/brand/character';
import {
  Badge,
  Button,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  FormField,
  Input,
  Select,
  SelectItem,
} from '@jackalope/ui';
import { Check, ExternalLink, KeyRound, Route, SlidersHorizontal, Zap } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { JevFallback } from '../../lib/decisions';
import {
  type RoutingMode,
  type RoutingSettings,
  routingSettings,
} from '../../lib/routing-settings';
import { isTauriEnvironment, openExternalUrl } from '../../lib/tauri-bridge';
import { InlineNotice } from '../ui/InlineNotice';
import './routing.css';

export function RoutingCircuit({ mode }: { mode: RoutingMode }) {
  return (
    <div className="routing-circuit" aria-hidden="true" key={mode}>
      <svg viewBox="0 0 520 146" fill="none" aria-hidden="true">
        <g className="routing-circuit-traces">
          <path d="M36 32H126L166 73H224M36 73H224M36 114H126L166 73" />
          <path d="M296 73H354L394 32H484M296 73H484M354 73L394 114H484" />
        </g>
        <g className="routing-circuit-signals">
          <path pathLength="100" d="M36 32H126L166 73H224" />
          <path pathLength="100" d="M36 114H126L166 73H224" />
          <path pathLength="100" d="M296 73H354L394 32H484" />
          <path pathLength="100" d="M296 73H484" />
          <path pathLength="100" d="M296 73H354L394 114H484" />
        </g>
        {[32, 73, 114].map((y) => (
          <g key={y}>
            <circle cx="36" cy={y} r="4" />
            <circle cx="484" cy={y} r="4" />
          </g>
        ))}
        <rect className="routing-circuit-chip" x="221" y="34" width="78" height="78" rx="22" />
        <svg
          x="238"
          y="46"
          width="45"
          height="53"
          viewBox="38 4 105 117"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d={characterPaths.farEar} />
          <path d={characterPaths.nearEar} />
          <path d={characterPaths.antler} />
          <path d={characterPaths.head} />
        </svg>
      </svg>
      <div className="routing-circuit-labels">
        <span>Your task</span>
        <span>Jackalope</span>
        <span>Your agents</span>
      </div>
    </div>
  );
}

export function RoutingSetup({
  projectId,
  mode,
  onModeChange,
  jevFallback,
  onFallbackChange,
  onReadyChange,
  onSettingsChange,
  disabled = false,
}: {
  projectId?: string;
  mode: RoutingMode | null;
  onModeChange: (mode: RoutingMode) => void;
  jevFallback: JevFallback | null;
  onFallbackChange: (fallback: JevFallback) => void;
  onReadyChange?: (ready: boolean) => void;
  onSettingsChange?: (settings: RoutingSettings) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const desktop = isTauriEnvironment();
  const [settings, setSettings] = useState<RoutingSettings | null>(null);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [replacing, setReplacing] = useState(false);
  const operation = useRef(false);
  const onChangeRef = useRef(onSettingsChange);
  onChangeRef.current = onSettingsChange;
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const value = await routingSettings.read(projectId);
      setSettings(value);
      onChangeRef.current?.(value);
    } catch (error) {
      setError(String(error));
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    if (desktop) void load();
    else setLoading(false);
  }, [desktop, load]);
  useEffect(() => {
    if (mode === null && settings) onModeChange(settings.mode);
  }, [mode, settings, onModeChange]);
  useEffect(() => {
    if (jevFallback === null && settings) onFallbackChange(settings.jevFallback ?? 'local');
  }, [jevFallback, settings, onFallbackChange]);
  const selected = mode ?? settings?.mode ?? 'agent';
  const fallback = jevFallback ?? settings?.jevFallback ?? 'local';
  const ready = !pending && !loading && !!settings && (selected !== 'jev' || settings.connected);
  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);
  const connect = async () => {
    if (!settings || operation.current) return;
    operation.current = true;
    setPending(true);
    setError('');
    try {
      const value = await routingSettings.connect(key.trim(), settings.revision, projectId);
      setSettings(value);
      onChangeRef.current?.(value);
      setKey('');
      setReplacing(false);
    } catch (error) {
      setError(String(error));
    } finally {
      operation.current = false;
      setPending(false);
    }
  };
  const disconnect = async () => {
    if (!settings || operation.current) return;
    operation.current = true;
    setPending(true);
    setError('');
    try {
      const value = await routingSettings.disconnect(settings.revision, projectId);
      setSettings(value);
      onChangeRef.current?.(value);
      onModeChange(value.mode);
      setKey('');
    } catch (error) {
      setError(String(error));
    } finally {
      operation.current = false;
      setPending(false);
    }
  };
  return (
    <div className="routing-setup" aria-busy={pending || loading}>
      <p className="routing-intro">
        Give each task a good start. Choose how Jackalope makes decisions and selects a worker when
        you use Automatic.
      </p>
      <RoutingCircuit mode={selected} />
      <fieldset className="routing-options" disabled={disabled || pending || loading}>
        <legend className="sr-only">Decision method</legend>
        <label className="routing-option" data-selected={selected === 'deterministic'}>
          <input
            type="radio"
            name={`${id}-mode`}
            value="deterministic"
            checked={selected === 'deterministic'}
            onChange={() => {
              onModeChange('deterministic');
              setKey('');
              setError('');
            }}
          />
          <SlidersHorizontal size={20} aria-hidden="true" />
          <span className="routing-option-copy">
            <strong>
              <span className="routing-option-title">Local rules</span>
              <span className="routing-option-tag">No decision-model cost</span>
            </strong>
            <span>Choose using project preferences, available capacity and current workload.</span>
          </span>
        </label>
        <label className="routing-option" data-selected={selected === 'agent'}>
          <input
            type="radio"
            name={`${id}-mode`}
            value="agent"
            checked={selected === 'agent'}
            onChange={() => {
              onModeChange('agent');
              setKey('');
              setError('');
            }}
          />
          <Route size={20} aria-hidden="true" />
          <span className="routing-option-copy">
            <strong>
              <span className="routing-option-title">Agent-powered</span>
              <span className="routing-option-tag">Uses agent capacity</span>
            </strong>
            <span>Your default agent reasons through the task and chooses a worker.</span>
          </span>
        </label>
        <label className="routing-option" data-selected={selected === 'jev'}>
          <input
            type="radio"
            name={`${id}-mode`}
            value="jev"
            checked={selected === 'jev'}
            onChange={() => {
              onModeChange('jev');
              setError('');
            }}
          />
          <Zap size={20} aria-hidden="true" />
          <span className="routing-option-copy">
            <strong>
              <span className="routing-option-title">
                Jev-assisted <Badge>Beta</Badge>
              </span>
              <span className="routing-option-tag">Bring your API key</span>
            </strong>
            <span>
              Use TypeSafe’s decision model to choose a worker, then let your agent do the work.
            </span>
          </span>
        </label>
      </fieldset>
      {selected === 'jev' && (
        <div className="routing-connection">
          <FormField
            label="If Jev is unavailable or uncertain"
            description={
              fallback === 'agent'
                ? 'An extra agent decision uses tokens or subscription capacity.'
                : 'Local rules take over with no additional decision-model cost.'
            }
          >
            <Select
              value={fallback}
              onValueChange={(value) => onFallbackChange(value === 'agent' ? 'agent' : 'local')}
              disabled={disabled || pending || loading}
            >
              <SelectItem value="local">Local (default)</SelectItem>
              <SelectItem value="agent">Agent-powered</SelectItem>
            </Select>
          </FormField>
          <div className="routing-connection-heading">
            <KeyRound size={17} aria-hidden="true" />
            <strong>Your device’s TypeSafe connection</strong>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void openExternalUrl('https://console.typesafe.ai')}
            >
              Get an API key <ExternalLink size={14} />
            </Button>
          </div>
          {settings?.storageError && (
            <InlineNotice tone="error">{settings.storageError}</InlineNotice>
          )}
          {settings?.connected && !replacing ? (
            <div className="routing-connected" role="status">
              <Check size={17} />
              <span>API key connected</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending || disabled}
                onClick={() => setReplacing(true)}
              >
                Replace key
              </Button>
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
            >
              <FormField label="TypeSafe API key">
                <Input
                  id={`${id}-key`}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  maxLength={8192}
                  placeholder="Paste your API key"
                  disabled={!desktop || pending || loading || disabled}
                  onChange={(event) => setKey(event.target.value)}
                />
              </FormField>
              <div className="routing-key-actions">
                <Button
                  type="submit"
                  disabled={!desktop || !settings || !key.trim() || disabled}
                  loading={pending}
                  loadingLabel="Checking connection…"
                >
                  Connect Jev
                </Button>
                {replacing && (
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      setReplacing(false);
                      setKey('');
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
              <p className="routing-detail">Makes one small, billable connection check.</p>
            </form>
          )}
          {settings?.hasKey && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending || disabled}
              onClick={() => void disconnect()}
            >
              Remove key from this device
            </Button>
          )}
        </div>
      )}
      {!desktop && (
        <InlineNotice>Open the desktop app to configure routing and connect Jev.</InlineNotice>
      )}
      {loading && (
        <p role="status" className="routing-detail">
          Loading your routing preference…
        </p>
      )}
      {error && (
        <InlineNotice tone="error">
          {error}
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || loading}
            onClick={() => void load()}
          >
            Reload settings
          </Button>
        </InlineNotice>
      )}
      <Disclosure>
        <DisclosureSummary>More information</DisclosureSummary>
        <DisclosureBody className="routing-detail">
          <p>
            <strong>Local rules.</strong> Fast and predictable, with no decision-model cost. Does
            not ask a model to assess the task’s reasoning needs.
          </p>
          <p>
            <strong>Agent-powered.</strong> Uses agent tokens or subscription capacity for routing.
            Can take longer and cost more per decision.
          </p>
          <p>
            <strong>Jev-assisted.</strong> Potentially faster, lower-cost decisions that save agent
            capacity. Gains vary by task. Jev has separate API billing and receives task
            instructions, selected context and eligible worker details. If it is uncertain or
            unavailable, your chosen fallback takes over. Agent-powered fallback makes one
            additional decision attempt; local rules remain available if that attempt fails.
          </p>
          <p>
            Jackalope stores your TypeSafe key securely on this device and sends it only to TypeSafe
            for authentication. The key is shared across projects on this device; removing it
            switches Jev projects to local rules.
          </p>
          <p>
            Specific agent choices and continued sessions keep their assigned worker. Coding,
            testing and your approval controls stay with your existing agents and Jackalope.
          </p>
        </DisclosureBody>
      </Disclosure>
    </div>
  );
}

export function RoutingPreferences({ projectId }: { projectId?: string }) {
  const [mode, setMode] = useState<RoutingMode | null>(null);
  const [jevFallback, setJevFallback] = useState<JevFallback | null>(null);
  const [settings, setSettings] = useState<RoutingSettings | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const save = async () => {
    if (!settings || !mode || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      setSettings(
        await routingSettings.setMode(mode, settings.revision, projectId, jevFallback ?? 'local'),
      );
      setMessage('Routing preference saved.');
    } catch (error) {
      setError(String(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="routing-preferences">
      <RoutingSetup
        projectId={projectId}
        key={settings?.revision}
        mode={mode}
        jevFallback={jevFallback}
        onFallbackChange={(value) => {
          setJevFallback(value);
          setMessage('');
          setError('');
        }}
        onModeChange={(value) => {
          setMode(value);
          setMessage('');
          setError('');
        }}
        onReadyChange={setReady}
        onSettingsChange={setSettings}
        disabled={saving}
      />
      {projectId && settings && (
        <div className="routing-detail">
          {settings.projectMode
            ? 'This project overrides the app default.'
            : 'This project inherits the app default.'}
          {!settings.projectMode && (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving || !ready}
              onClick={() => void save()}
            >
              Keep this choice for this project
            </Button>
          )}
          {settings.projectMode && (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving || !ready}
              onClick={() => {
                setSaving(true);
                setError('');
                void routingSettings
                  .setMode(null, settings.revision, projectId)
                  .then((value) => {
                    setSettings(value);
                    setMode(value.mode);
                    setJevFallback(value.jevFallback);
                    setMessage('Using the app default.');
                  })
                  .catch((error) => setError(String(error)))
                  .finally(() => setSaving(false));
              }}
            >
              Use app default
            </Button>
          )}
        </div>
      )}
      <Button
        disabled={!ready || (mode === settings?.mode && jevFallback === settings?.jevFallback)}
        loading={saving}
        loadingLabel="Saving…"
        onClick={() => void save()}
      >
        Save routing choice
      </Button>
      {message && (
        <p role="status" className="routing-detail">
          {message}
        </p>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </div>
  );
}
