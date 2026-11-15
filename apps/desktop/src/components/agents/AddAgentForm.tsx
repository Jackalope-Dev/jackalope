import {
  Button,
  DialogFooter,
  InlineNotice,
  Input,
  LinkButton,
  Select,
  SelectItem,
} from '@jackalope/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ACP_PRESETS,
  orderedPresets,
  presetCommandNames,
  presetPath,
  splitArguments,
} from '../../lib/acp-presets';
import { type BuiltinAgentId, builtinAgents } from '../../lib/agent-catalog';
import { type AgentProbeResult, probeExecutable } from '../../lib/agent-profiles';
import { openExternalUrl } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import './agent-manager.css';

type AdapterChoice = BuiltinAgentId | 'acp';

/** The agent picker's entry for a CLI Jackalope has no preset for. */
const OTHER = 'other';
const windows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform);

export function AddAgentForm({ onAdded, onCancel }: { onAdded: () => void; onCancel: () => void }) {
  const adapterId = useId();
  const presetId = useId();
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [args, setArgs] = useState('acp');
  const [adapter, setAdapter] = useState<AdapterChoice>('acp');
  const acp = adapter === 'acp';
  const [choice, setChoice] = useState(OTHER);
  const preset = ACP_PRESETS.find((item) => item.id === choice);
  // Which known agent CLIs are installed, by command name.
  const [located, setLocated] = useState<Record<string, string>>({});
  const [probe, setProbe] = useState<AgentProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const probeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const runProbe = useCallback((value: string, delay = 600) => {
    clearTimeout(probeTimer.current);
    setProbe(null);
    if (!value.trim()) return;
    probeTimer.current = setTimeout(async () => {
      setProbing(true);
      try {
        setProbe(await probeExecutable(value.trim()));
      } catch {
        setProbe({ valid: false, version: null, error: 'The executable could not be checked.' });
      } finally {
        setProbing(false);
      }
    }, delay);
  }, []);
  useEffect(() => () => clearTimeout(probeTimer.current), []);
  useEffect(() => {
    let current = true;
    void invokeNative<Record<string, string>>('agent_locate_executables', {
      names: presetCommandNames(windows),
    })
      .then((found) => current && setLocated(found))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);

  const choose = (id: string) => {
    setChoice(id);
    const next = ACP_PRESETS.find((item) => item.id === id);
    if (!next) return;
    const found = presetPath(next, located, windows) ?? '';
    setAdapter('acp');
    setName(next.name);
    setArgs(next.args.join(' '));
    setPath(found);
    runProbe(found, 0);
  };

  const add = () => {
    if (!name.trim() || !path.trim()) return;
    const parsed = splitArguments(args);
    useAgentConfigStore.getState().addCustomAgent({
      id: `custom-${crypto.randomUUID()}`,
      name: name.trim(),
      command: path.trim(),
      adapter,
      args: acp ? (parsed.length ? parsed : ['acp']) : undefined,
      models: [],
      description: acp
        ? 'ACP CLI already signed in on this computer.'
        : `Uses the ${adapter} CLI interface.`,
      enabled: true,
    });
    onAdded();
  };
  return (
    <div className="agent-manager">
      <div className="agent-manual-form">
        <label htmlFor={presetId} className="task-label">
          Agent
          <Select id={presetId} value={choice} onValueChange={choose}>
            {orderedPresets(located, windows).map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
                {presetPath(item, located, windows) ? ' · Installed' : ''}
              </SelectItem>
            ))}
            <SelectItem value={OTHER}>Another CLI</SelectItem>
          </Select>
        </label>
        {preset && !presetPath(preset, located, windows) && (
          <InlineNotice
            action={
              <LinkButton external onClick={() => void openExternalUrl(preset.url).catch(() => {})}>
                Get {preset.name}
              </LinkButton>
            }
          >
            {preset.name} was not found on this computer. Install it and sign in, then enter its
            path below.
          </InlineNotice>
        )}
        <label className="task-label">
          Name
          <Input className="task-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {!preset && (
          <label htmlFor={adapterId} className="task-label">
            CLI interface
            <Select
              id={adapterId}
              value={adapter}
              onValueChange={(value) => setAdapter(value as typeof adapter)}
            >
              <SelectItem value="acp">ACP agent</SelectItem>
              {builtinAgents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </Select>
          </label>
        )}
        <label className="task-label">
          Absolute executable path
          <Input
            className="task-input"
            value={path}
            onChange={(e) => {
              setPath(e.target.value);
              runProbe(e.target.value);
            }}
            placeholder={windows ? 'C:\\Tools\\agent.exe' : '/usr/local/bin/agent'}
          />
        </label>
        {acp && (
          <label className="task-label">
            Arguments
            <Input
              className="task-input"
              value={args}
              onChange={(event) => setArgs(event.target.value)}
              placeholder="acp"
            />
            <span className="task-muted">
              Sign in with this CLI first. Jackalope starts it with these arguments and talks to it
              over the Agent Client Protocol.{preset?.note ? ` ${preset.note}` : ''}
            </span>
          </label>
        )}
        {probing && <p className="task-muted text-sm">Checking executable…</p>}
        {probe && !probing && (
          <InlineNotice tone={!probe.valid ? 'error' : probe.version ? 'success' : 'warning'}>
            {!probe.valid
              ? probe.error || 'File not found'
              : probe.version
                ? `Found: ${probe.version}`
                : 'Executable found but its version could not be read'}
          </InlineNotice>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={add} disabled={!name.trim() || !path.trim()}>
          Add agent
        </Button>
      </DialogFooter>
    </div>
  );
}
