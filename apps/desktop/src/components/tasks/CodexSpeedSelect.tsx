import { useId } from 'react';
import type { RunRequest } from '../../lib/task-runtime';
import { Select, SelectItem } from '../ui/Select';

export function CodexSpeedSelect({
  value,
  onChange,
  disabled,
}: {
  value: RunRequest['codexSpeed'];
  onChange: (value: RunRequest['codexSpeed']) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="workspace-stack">
      <label htmlFor={id}>Codex speed</label>
      <Select
        disabled={disabled}
        id={id}
        aria-label="Codex speed"
        aria-describedby={`${id}-help`}
        value={value ?? 'provider'}
        onValueChange={(next) =>
          onChange(next === 'fast' || next === 'standard' ? next : undefined)
        }
      >
        <SelectItem value="provider">Use provider setting</SelectItem>
        <SelectItem value="standard">Standard</SelectItem>
        <SelectItem value="fast">Fast · higher usage</SelectItem>
      </Select>
      <p id={`${id}-help`} className="task-muted">
        Applies when Codex runs this work, including planned assignments. Fast requests faster
        processing at higher usage cost without changing model effort. Availability depends on the
        model and account.
      </p>
    </div>
  );
}
