import { Input } from '@jackalope/ui';
import { useCallback, useId, useRef, useState } from 'react';
import { type BuiltinAgentId, builtinAgents } from '../../lib/agent-catalog';
import { type AgentProbeResult, probeExecutable } from '../../lib/agent-profiles';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { Button } from '../ui/button';
import { DialogFooter } from '../ui/Dialog';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import './agent-manager.css';

type AdapterChoice = BuiltinAgentId | 'acp';

export function AddAgentForm({ onAdded, onCancel }: { onAdded: () => void; onCancel: () => void }) {
  const adapterId = useId();
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [args, setArgs] = useState('acp');
  const [adapter, setAdapter] = useState<AdapterChoice>('codex');
  const acp = adapter === 'acp';
  const [probe, setProbe] = useState<AgentProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const probeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const runProbe = useCallback((value: string) => {
    clearTimeout(probeTimer.current);
    setProbe(null);
    if (!value.trim()) return;
    probeTimer.current = setTimeout(async () => {
      setProbing(true);
      try {
        const result = await probeExecutable(value.trim());
        setProbe(result);
      } catch {
        setProbe({ exists: false, executable: false, version: null, error: 'Probe failed' });
      } finally {
        setProbing(false);
      }
    }, 600);
  }, []);

  const add = () => {
    if (!name.trim() || !path.trim()) return;
    const parsed = args.trim().split(/\s+/).filter(Boolean);
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
        <label className="task-label">
          Name
          <Input className="task-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label htmlFor={adapterId} className="task-label">
          CLI interface
          <Select
            id={adapterId}
            value={adapter}
            onValueChange={(value) => setAdapter(value as typeof adapter)}
          >
            {builtinAgents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
            <SelectItem value="acp">ACP agent</SelectItem>
          </Select>
        </label>
        <label className="task-label">
          Absolute executable path
          <Input
            className="task-input"
            value={path}
            onChange={(e) => {
              setPath(e.target.value);
              runProbe(e.target.value);
            }}
            placeholder="C:\Tools\agent.exe"
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
              Sign in with this CLI first. Jackalope starts that binary with these arguments.
            </span>
          </label>
        )}
        {probing && <p className="task-muted text-sm">Checking executable…</p>}
        {probe && !probing && (
          <InlineNotice
            tone={
              probe.executable && probe.version ? 'success' : probe.exists ? 'warning' : 'error'
            }
          >
            {probe.version
              ? `Found: ${probe.version}`
              : probe.executable
                ? 'Executable found but version could not be determined'
                : probe.exists
                  ? `File exists but is not executable${probe.error ? `: ${probe.error}` : ''}`
                  : probe.error || 'File not found'}
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
