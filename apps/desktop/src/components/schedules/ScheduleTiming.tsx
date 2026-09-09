import { useState } from 'react';
import { parseScheduleTiming, scheduleTimingExpression } from '../../lib/schedules';
import { Input } from '../ui/input';
import { Select, SelectItem } from '../ui/Select';

export function ScheduleTiming({
  expression,
  onChange,
}: {
  expression: string;
  onChange: (expression: string) => void;
}) {
  const parsed = parseScheduleTiming(expression);
  const [custom, setCustom] = useState(!parsed);
  const timing = parsed ?? { repeat: 'weekdays', time: '09:00', weekday: '1' };
  const update = (repeat: string, time: string, weekday: string) => {
    const next = scheduleTimingExpression(repeat, time, weekday);
    if (next) onChange(next);
  };
  return (
    <div className="schedule-fields">
      <label htmlFor="schedule-preset">
        Repeat
        <Select
          id="schedule-preset"
          aria-label="Repeat schedule"
          value={custom ? 'custom' : timing.repeat}
          onValueChange={(repeat) => {
            setCustom(repeat === 'custom');
            if (repeat !== 'custom') update(repeat, timing.time, timing.weekday);
          }}
        >
          <SelectItem value="daily">Every day</SelectItem>
          <SelectItem value="weekdays">Weekdays</SelectItem>
          <SelectItem value="weekly">Every week</SelectItem>
          <SelectItem value="custom">Custom cron</SelectItem>
        </Select>
      </label>
      {!custom && (
        <label htmlFor="schedule-time">
          Time
          <Input
            id="schedule-time"
            type="time"
            required
            value={timing.time}
            onChange={(event) => update(timing.repeat, event.target.value, timing.weekday)}
          />
        </label>
      )}
      {!custom && timing.repeat === 'weekly' && (
        <label htmlFor="schedule-weekday">
          Day
          <Select
            id="schedule-weekday"
            aria-label="Day of week"
            value={timing.weekday}
            onValueChange={(weekday) => update(timing.repeat, timing.time, weekday)}
          >
            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
              (day, index) => (
                <SelectItem key={day} value={String(index)}>
                  {day}
                </SelectItem>
              ),
            )}
          </Select>
        </label>
      )}
      {custom && (
        <label className="schedule-field-wide" htmlFor="schedule-timing">
          Cron expression
          <Input
            id="schedule-timing"
            aria-label="Cron expression"
            aria-describedby="schedule-timing-help"
            required
            value={expression}
            onChange={(event) => onChange(event.target.value)}
          />
          <small id="schedule-timing-help" className="task-muted">
            Minute, hour, day, month, weekday. For example: 0 9 * * 1-5.
          </small>
        </label>
      )}
    </div>
  );
}
