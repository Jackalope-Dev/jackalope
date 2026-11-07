import type { DecisionReceipt } from './decisions';
import { invokeNative } from './native/transport.ts';
import type { RunRequest } from './run-types';

export interface TaskAssessment {
  id: string;
  sourceHead: string;
  strategy: 'single' | 'investigate' | 'parallel';
  parallelAvailable: boolean;
  reason: string;
  decision: DecisionReceipt;
  createdAt: string;
  cached: boolean;
  /** Plan subtasks without asking; see `auto_plan` in task_strategy.rs. */
  autoPlan?: boolean;
}

export const assessTask = (request: RunRequest, intent: string, operationId: string) =>
  invokeNative<TaskAssessment>('task_strategy_assess', { request, intent, operationId });
export const cancelAssessment = (operationId: string) =>
  invokeNative<void>('task_strategy_cancel', { operationId });

export function assessmentKey(request: RunRequest, intent: string) {
  return JSON.stringify({ ...request, id: undefined, intent });
}
