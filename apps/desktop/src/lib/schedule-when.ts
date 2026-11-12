import { parseScheduleTiming } from './schedules.ts';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The repeat choices the When picker writes; anything else is a custom cron expression. */
export type ScheduleRepeat = 'daily' | 'weekdays' | 'weekly' | 'hourly' | 'custom';

const clock = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return new Date(Date.UTC(2000, 0, 1, hour, minute)).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
};

/** A plain-language reading of a schedule, such as "Every weekday at 9:00 AM". */
export function describeSchedule(expression: string) {
  const timing = parseScheduleTiming(expression);
  if (!timing) return `Custom schedule · ${expression.trim() || 'no expression yet'}`;
  if (timing.repeat === 'hourly') {
    const minute = timing.time.split(':')[1];
    return timing.hours === '1'
      ? `Every hour at :${minute}`
      : `Every ${timing.hours} hours at :${minute}, from midnight`;
  }
  const at = clock(timing.time);
  if (timing.repeat === 'daily') return `Every day at ${at}`;
  if (timing.repeat === 'weekdays') return `Every weekday at ${at}`;
  return `Every ${WEEKDAYS[Number(timing.weekday)]} at ${at}`;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function wallClock(date: Date, timeZone: string): WallClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    })
      .formatToParts(date)
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

const wallUtc = (wall: WallClock) =>
  Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);

/** The instant a wall-clock time occurs in a timezone, or null when it doesn't (a DST gap). */
function instantAt(wall: WallClock, timeZone: string) {
  let guess = wallUtc(wall);
  for (let pass = 0; pass < 2; pass++)
    guess += wallUtc(wall) - wallUtc(wallClock(new Date(guess), timeZone));
  return wallUtc(wallClock(new Date(guess), timeZone)) === wallUtc(wall) ? new Date(guess) : null;
}

/**
 * The next runs of a schedule the When picker writes, in its own timezone. Custom cron
 * expressions return none here: the scheduler validates and times those when saved.
 */
export function upcomingRuns(expression: string, timeZone: string, after = new Date(), count = 3) {
  const timing = parseScheduleTiming(expression);
  if (!timing) return [];
  let zone = timeZone;
  try {
    wallClock(after, zone);
  } catch {
    zone = 'UTC';
  }
  const [hour, minute] = timing.time.split(':').map(Number);
  const hours =
    timing.repeat === 'hourly'
      ? Array.from({ length: 24 }, (_, value) => value).filter(
          (value) => value % Number(timing.hours ?? '1') === 0,
        )
      : [hour];
  const today = wallClock(after, zone);
  const runs: Date[] = [];
  for (let offset = 0; offset < 15 && runs.length < count; offset++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const weekday = date.getUTCDay();
    if (timing.repeat === 'weekdays' && (weekday === 0 || weekday === 6)) continue;
    if (timing.repeat === 'weekly' && weekday !== Number(timing.weekday)) continue;
    for (const runHour of hours) {
      const instant = instantAt(
        {
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
          day: date.getUTCDate(),
          hour: runHour,
          minute,
        },
        zone,
      );
      if (instant && instant > after) runs.push(instant);
      if (runs.length === count) break;
    }
  }
  return runs;
}

/** A run time as the person reads it, in the schedule's timezone. */
export function formatRun(date: Date, timeZone: string) {
  try {
    return date.toLocaleString(undefined, {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return date.toLocaleString();
  }
}
