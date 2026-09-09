import type { ScheduledTask } from '../stores/scheduleStore.ts';
import type { Runner, RunRequest } from './task-runtime.ts';

export function parseScheduleTiming(expression: string) {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-7])$/.exec(expression.trim());
  if (!match || Number(match[1]) > 59 || Number(match[2]) > 23) return null;
  return {
    repeat: match[3] === '*' ? 'daily' : match[3] === '1-5' ? 'weekdays' : 'weekly',
    time: `${match[2].padStart(2, '0')}:${match[1].padStart(2, '0')}`,
    weekday: match[3] === '7' ? '0' : /^[0-6]$/.test(match[3]) ? match[3] : '1',
  };
}

export function scheduleTimingExpression(repeat: string, time: string, weekday: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || !/^[0-6]$/.test(weekday)) return null;
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
