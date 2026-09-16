import type { DecisionReceipt } from './decisions';
import { nativeTask } from './task-runtime.ts';

export interface TaskDecisionUsage {
  id: string;
  projectId: string;
  createdAt: string;
  decision: DecisionReceipt;
}

export const readTaskDecisionUsage = () => nativeTask<TaskDecisionUsage[]>('task_strategy_history');

export function countedTaskDecisions(records: TaskDecisionUsage[], projectId?: string, cutoff = 0) {
  return [...new Map(records.map((record) => [record.id, record])).values()].filter(
    (record) =>
      (!projectId || record.projectId === projectId) &&
      Date.parse(record.createdAt) >= cutoff &&
      record.decision.modelCallAttempted === true,
  );
}
