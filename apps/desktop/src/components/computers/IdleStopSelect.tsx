import { useState } from 'react';
import { type ComputerStatus, IDLE_STOP_CHOICES, setComputerIdleStop } from '../../lib/computers';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import './computers.css';

/** When an unused local sandbox stops. Applies at once. */
export function IdleStopSelect({
  computer,
  disabled,
  onChanged,
}: {
  computer: ComputerStatus;
  disabled?: boolean;
  onChanged: (status: ComputerStatus) => void;
}) {
  const [error, setError] = useState('');
  return (
    <div className="computer-idle-stop">
      <Select
        aria-label={`Stop ${computer.name} when idle`}
        value={String(computer.settings.idleStopMinutes ?? 10)}
        disabled={disabled}
        onValueChange={(value) => {
          setError('');
          void setComputerIdleStop(computer.id, Number(value))
            .then(onChanged)
            .catch((cause) => setError(String(cause)));
        }}
      >
        {IDLE_STOP_CHOICES.map((choice) => (
          <SelectItem key={choice.minutes} value={String(choice.minutes)}>
            {choice.label}
          </SelectItem>
        ))}
      </Select>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </div>
  );
}
