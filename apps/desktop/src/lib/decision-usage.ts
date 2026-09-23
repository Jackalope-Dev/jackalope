import type { DecisionReceipt, DecisionRecord } from './decisions';
import { nativeTask } from './task-runtime.ts';

export interface TaskDecisionUsage {
  id: string;
  projectId: string;
  createdAt: string;
  decision: DecisionReceipt;
}

export const readTaskDecisionUsage = async (): Promise<TaskDecisionUsage[]> => {
  const [strategies, decisions] = await Promise.all([
    nativeTask<TaskDecisionUsage[]>('task_strategy_history'),
    nativeTask<DecisionRecord[]>('decision_history'),
  ]);
  return [...strategies, ...decisions.filter((record) => !record.accountedElsewhere)];
};

export function decisionUsageEntries(decision: DecisionReceipt) {
  if (decision.attempts?.length) return decision.attempts;
  if (decision.modelCallAttempted === false) return [];
  return [
    {
      provider: decision.requestedMode === 'jev' ? ('jev' as const) : ('agent' as const),
      usage: decision.usage,
    },
  ];
}

export function countedTaskDecisions(records: TaskDecisionUsage[], projectId?: string, cutoff = 0) {
  return [...new Map(records.map((record) => [record.id, record])).values()].filter(
    (record) =>
      (!projectId || record.projectId === projectId) &&
      Date.parse(record.createdAt) >= cutoff &&
      record.decision.modelCallAttempted === true,
  );
}
