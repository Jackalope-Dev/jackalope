import { FieldCheck, Input, SegmentedControl, Select, SelectItem } from '@jackalope/ui';
import { CalendarClock } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import {
  describeSchedule,
  formatRun,
  type ScheduleRepeat,
  upcomingRuns,
} from '../../lib/schedule-when';
import {
  parseScheduleTiming,
  scheduleHourIntervals,
  scheduleTimingExpression,
} from '../../lib/schedules';
import './when-picker.css';

const REPEATS: { id: ScheduleRepeat; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'hourly', label: 'Hourly' },
  { id: 'custom', label: 'Custom' },
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The same two shape rules the scheduler applies before it times a custom expression. */
function cronProblem(expression: string) {
  const fields = expression.trim().split(/\s+/).filter(Boolean);
  if (fields.length !== 5) return 'Use five fields: minute, hour, day, month, weekday.';
  if (fields[2] !== '*' && fields[4] !== '*')
    return 'Choose a day of the month or a weekday, not both.';
  return '';
}

/**
 * When something runs, shared by schedules and bot wake-ups: a repeat choice, only that
 * choice's fields, a plain-language summary and the next runs in the schedule's timezone.
 * It reads and writes the same five-field cron expression both already save.
 */
export function WhenPicker({
  expression,
  timezone,
  onChange,
  allowCustom = true,
  idPrefix,
}: {
  expression: string;
  timezone: string;
  onChange: (expression: string) => void;
  allowCustom?: boolean;
  /** Stable ids for the fields (`<prefix>-time`, `-minute`, `-hours`, `-cron`). */
  idPrefix?: string;
}) {
  const generated = useId();
  const id = idPrefix ?? generated;
  const parsed = parseScheduleTiming(expression);
  const [custom, setCustom] = useState(!parsed);
  const [last, setLast] = useState({
    repeat: 'weekdays',
    time: '09:00',
    weekday: '1',
    hours: '6',
    ...parsed,
  });
  const timing = parsed ? { ...last, ...parsed } : last;
  const repeat: ScheduleRepeat = custom ? 'custom' : (timing.repeat as ScheduleRepeat);
  const update = (next: Partial<typeof last>) => {
    const merged = { ...timing, ...next };
    setLast(merged);
    const value = scheduleTimingExpression(
      merged.repeat,
      merged.time,
      merged.weekday,
      merged.hours,
    );
    if (value) onChange(value);
  };
  const runs = useMemo(
    () => (custom ? [] : upcomingRuns(expression, timezone)),
    [custom, expression, timezone],
  );
  const problem = custom ? cronProblem(expression) : '';
  const repeats = allowCustom || custom ? REPEATS : REPEATS.filter((item) => item.id !== 'custom');
  return (
    <div className="when-picker">
      <SegmentedControl
        label="Repeat"
        items={repeats}
        value={repeat}
        onChange={(next) => {
          setCustom(next === 'custom');
          if (next !== 'custom') update({ repeat: next });
        }}
      />
      <div className="when-picker-fields">
        {repeat === 'hourly' && (
          <>
            <label className="when-picker-field" htmlFor={`${id}-hours`}>
              <span>Every</span>
              <Select
                id={`${id}-hours`}
                aria-label="Hourly interval"
                value={timing.hours ?? '6'}
                onValueChange={(hours) => update({ hours })}
              >
                {scheduleHourIntervals.map((hours) => (
                  <SelectItem key={hours} value={hours}>
                    {hours === '1' ? 'hour' : `${hours} hours`}
                  </SelectItem>
                ))}
              </Select>
            </label>
            <label className="when-picker-field" htmlFor={`${id}-minute`}>
              <span>At minute</span>
              <Input
                id={`${id}-minute`}
                className="when-picker-minute"
                type="number"
                min={0}
                max={59}
                required
                value={Number(timing.time.split(':')[1])}
                onChange={(event) => {
                  if (!/^\d{1,2}$/.test(event.target.value) || Number(event.target.value) > 59)
                    return;
                  update({ time: `00:${event.target.value.padStart(2, '0')}` });
                }}
              />
            </label>
          </>
        )}
        {(repeat === 'daily' || repeat === 'weekdays' || repeat === 'weekly') && (
          <label className="when-picker-field" htmlFor={`${id}-time`}>
            <span>At</span>
            <Input
              id={`${id}-time`}
              className="when-picker-time"
              type="time"
              required
              value={timing.time}
              onChange={(event) => update({ time: event.target.value })}
            />
          </label>
        )}
        {repeat === 'weekly' && (
          <fieldset className="when-picker-days">
            <legend className="ui-sr-only">Day of the week</legend>
            {DAYS.map((day, index) => (
              <label key={day} className="when-picker-day" title={DAY_NAMES[index]}>
                <input
                  type="radio"
                  className="ui-sr-only"
                  name={`${id}-day`}
                  value={index}
                  checked={timing.weekday === String(index)}
                  onChange={() => update({ weekday: String(index) })}
                />
                <span aria-hidden="true">{day}</span>
                <span className="ui-sr-only">{DAY_NAMES[index]}</span>
              </label>
            ))}
          </fieldset>
        )}
        {repeat === 'custom' && (
          <div className="when-picker-field when-picker-cron">
            <label htmlFor={`${id}-cron`}>Cron expression</label>
            <Input
              id={`${id}-cron`}
              aria-describedby={`${id}-cron-check`}
              required
              spellCheck={false}
              value={expression}
              placeholder="0 9 * * 1-5"
              onChange={(event) => onChange(event.target.value)}
            />
            <FieldCheck id={`${id}-cron-check`} tone={problem ? 'error' : 'info'}>
              {problem || 'Minute, hour, day, month, weekday. The scheduler checks it when saved.'}
            </FieldCheck>
          </div>
        )}
      </div>
      <div className="when-picker-summary" aria-live="polite">
        <CalendarClock size={16} aria-hidden="true" />
        <div>
          <strong>{describeSchedule(expression)}</strong>
          {runs.length > 0 ? (
            <ul className="when-picker-runs" aria-label="Next runs">
              {runs.map((run) => (
                <li key={run.toISOString()}>{formatRun(run, timezone)}</li>
              ))}
            </ul>
          ) : (
            <p>Next runs show once the schedule is saved.</p>
          )}
          <p className="when-picker-zone">Times in {timezone || 'UTC'}.</p>
        </div>
      </div>
    </div>
  );
}
