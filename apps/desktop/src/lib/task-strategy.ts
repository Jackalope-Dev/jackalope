import type { DecisionReceipt } from './decisions';
import type { RunRequest } from './task-runtime';
import { nativeTask } from './task-runtime.ts';

export interface TaskAssessment {
  id: string;
  sourceHead: string;
  strategy: 'single' | 'investigate' | 'parallel';
  parallelAvailable: boolean;
  reason: string;
  decision: DecisionReceipt;
  createdAt: string;
  cached: boolean;
}

export const assessTask = (request: RunRequest, intent: string, operationId: string) =>
  nativeTask<TaskAssessment>('task_strategy_assess', { request, intent, operationId });
export const cancelAssessment = (operationId: string) =>
  nativeTask<void>('task_strategy_cancel', { operationId });

export function assessmentKey(request: RunRequest, intent: string) {
  return JSON.stringify({ ...request, id: undefined, intent });
}
