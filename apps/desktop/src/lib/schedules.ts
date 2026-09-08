import type { ScheduledTask } from '../stores/scheduleStore.ts';
import type { Runner, RunRequest } from './task-runtime.ts';

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
