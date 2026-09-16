import type { RunUsage } from './task-runtime';

export type DecisionMode = 'deterministic' | 'agent' | 'jev';
export type DecisionKind = 'worker_selection' | 'task_strategy';
export type DecisionProvider = 'local_rules' | 'agent' | 'jev';

export interface DecisionReceipt {
  version: 1;
  kind: DecisionKind;
  requestedMode: DecisionMode;
  provider: DecisionProvider;
  policyRevision: number;
  concentration: number | null;
  fallbackReason: string | null;
  usage: RunUsage;
}
