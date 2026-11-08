import type { ScheduledTask } from '../stores/scheduleStore.ts';
import { invokeNative } from './native/transport.ts';
import type { Runner, RunRequest } from './run-types.ts';

export const scheduleHourIntervals = ['1', '2', '3', '4', '6', '8', '12'];

export function parseScheduleTiming(expression: string) {
  const hourly = /^(\d{1,2}) (?:\*|\*\/(\d{1,2})) \* \* \*$/.exec(expression.trim());
  if (hourly && Number(hourly[1]) < 60 && scheduleHourIntervals.includes(hourly[2] ?? '1')) {
    return {
      repeat: 'hourly',
      time: `00:${hourly[1].padStart(2, '0')}`,
      weekday: '1',
      hours: hourly[2] ?? '1',
    };
  }
  const match = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-7])$/.exec(expression.trim());
  if (!match || Number(match[1]) > 59 || Number(match[2]) > 23) return null;
  return {
    repeat: match[3] === '*' ? 'daily' : match[3] === '1-5' ? 'weekdays' : 'weekly',
    time: `${match[2].padStart(2, '0')}:${match[1].padStart(2, '0')}`,
    weekday: match[3] === '7' ? '0' : /^[0-6]$/.test(match[3]) ? match[3] : '1',
  };
}

export function scheduleTimingExpression(
  repeat: string,
  time: string,
  weekday: string,
  hours = '6',
) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || !/^[0-6]$/.test(weekday)) return null;
  if (repeat === 'hourly') {
    if (!scheduleHourIntervals.includes(hours)) return null;
    return `${Number(time.split(':')[1])} ${hours === '1' ? '*' : `*/${hours}`} * * *`;
  }
  if (!['daily', 'weekdays', 'weekly'].includes(repeat)) return null;
  const [hour, minute] = time.split(':').map(Number);
  return `${minute} ${hour} * * ${repeat === 'daily' ? '*' : repeat === 'weekdays' ? '1-5' : weekday}`;
}

export interface ScheduleDefinition {
  monitor?: { path: string; action: 'notify' | 'run' } | null;
  id: string;
  name: string;
  expression: string;
  timezone: string;
  rawPrompt?: string;
  missed: 'skip' | 'once';
  enabled: boolean;
  request: RunRequest;
}

/** Mirrors `OutcomeKind` in src-tauri/src/commands/schedules.rs. */
type ScheduleOutcomeKind =
  | 'reserved'
  | 'started'
  | 'failedToStart'
  | 'signedOut'
  | 'overlap'
  | 'busy'
  | 'missed'
  | 'paused'
  | 'starting'
  | 'invalid'
  | 'monitorAttention'
  | 'unrelated'
  | 'baseline'
  | 'unchanged'
  | 'changeDetected'
  | 'interruptedDispatch';

/** Outcomes that ask the person to look at the schedule. */
const ACTIONABLE_OUTCOMES: ReadonlySet<ScheduleOutcomeKind> = new Set([
  'failedToStart',
  'changeDetected',
  'monitorAttention',
  'interruptedDispatch',
]);

export const needsAction = (event: ScheduleOccurrence) =>
  !!event.kind && ACTIONABLE_OUTCOMES.has(event.kind);

interface ScheduleOccurrence {
  dueAt: string;
  runId: string | null;
  /** Display text, shown as written. */
  outcome: string;
  kind?: ScheduleOutcomeKind;
  change?: { before: string; after: string; path: string; branch: string } | null;
}

export interface SavedSchedule {
  localChecks?: number;
  quietChecks?: number;
  webhook?: { createdAt: string } | null;
  lastNotice?: ScheduleOccurrence | null;
  definition: ScheduleDefinition;
  nextAt: string;
  history: ScheduleOccurrence[];
}

export interface ScheduleLedger {
  schedules: SavedSchedule[];
  error: string | null;
}

export const listSchedules = () => invokeNative<ScheduleLedger>('schedule_list');

export function savedPlanDraft(
  plan: ScheduledTask,
  id: string,
  runners: Pick<Runner, 'id' | 'name'>[],
): ScheduleDefinition {
  const runner = runners.find(
    (item) => item.id === plan.assignedAgentProvider || item.name === plan.assignedAgentProvider,
  );
  const prompt = [plan.prompt, plan.description].filter((value) => value?.trim()).join('\n\n');
  return {
    id,
    name: plan.name,
    expression: plan.cronExpression,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    rawPrompt: prompt,
    missed: 'skip',
    enabled: false,
    request: {
      id,
      projectId: plan.targetProjectId,
      projectName: '',
      projectPath: '',
      agent: runner?.id ?? '',
      prompt,
      isolated: true,
    },
  };
}
