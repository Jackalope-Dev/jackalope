import type { RunUsage } from './task-runtime';

export type DecisionMode = 'deterministic' | 'agent' | 'jev';
export type JevFallback = 'local' | 'agent';
export type DecisionKind = 'worker_selection' | 'task_strategy';
export type DecisionProvider = 'local_rules' | 'agent' | 'jev';

export interface DecisionAttempt {
  provider: DecisionProvider;
  usage: RunUsage;
}

export interface DecisionReceipt {
  version: 1;
  kind: DecisionKind;
  requestedMode: DecisionMode;
  provider: DecisionProvider;
  policyRevision: number;
  modelCallAttempted?: boolean;
  attempts?: DecisionAttempt[];
  concentration: number | null;
  fallbackReason: string | null;
  usage: RunUsage;
}
