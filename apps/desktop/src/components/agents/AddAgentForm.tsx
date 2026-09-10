import { useId, useState } from 'react';
import { type BuiltinAgentId, builtinAgents } from '../../lib/agent-catalog';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import './agent-manager.css';

export function AddAgentForm({ onAdded }: { onAdded: () => void }) {
  const adapterId = useId();
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [adapter, setAdapter] = useState<BuiltinAgentId>('codex');
  const add = () => {
    if (!name.trim() || !path.trim()) return;
    useAgentConfigStore.getState().addCustomAgent({
      id: `custom-${crypto.randomUUID()}`,
      name: name.trim(),
      command: path.trim(),
      adapter,
      models: [],
      description: `Uses the ${adapter} CLI interface.`,
      enabled: true,
    });
    onAdded();
  };
  return (
    <div className="agent-manager">
      <div className="agent-manual-form">
        <label className="task-label">
          Name
          <input className="task-input" value={name} onChange={(e) => setName(e.target.value)} />
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
          </Select>
        </label>
        <label className="task-label">
          Absolute executable path
          <input
            className="task-input"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="C:\Tools\agent.exe"
          />
        </label>
        <Button type="button" onClick={add} disabled={!name.trim() || !path.trim()}>
          Add agent
        </Button>
      </div>
    </div>
  );
}
