import type { RunUsage } from './task-runtime';

export type DecisionMode = 'deterministic' | 'agent' | 'jev';
export type JevFallback = 'local' | 'agent';
export type DecisionKind =
  | 'worker_selection'
  | 'task_strategy'
  | 'context_selection'
  | 'task_review'
  | 'monitor_relevance'
  | 'assignment_matching';
export type DecisionProvider = 'local_rules' | 'agent' | 'jev';

export interface DecisionAttempt {
  provider: DecisionProvider;
  usage: RunUsage;
}

export interface DecisionReceipt {
  evidence?: {
    recordId: string;
    requestedModel: string;
    model: string | null;
    rubricRevision: number;
    inputHash: string;
    cached: boolean;
    disposition?: string;
    selectedCandidate?: string;
    alternatives?: string[];
    reasonCodes?: string[];
    answers: Record<string, unknown>;
  } | null;
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

export const decisionLabels: Record<DecisionKind, string> = {
  worker_selection: 'Worker selection',
  task_strategy: 'Task strategy',
  context_selection: 'Context selection',
  task_review: 'Result assessment',
  monitor_relevance: 'Monitor relevance',
  assignment_matching: 'Assignment matching',
};

export interface ModelEvidence {
  adapter: string;
  model: string;
  source: string;
  checkedAt: string;
  capabilities: string;
  contextTokens: number | null;
  efforts: string[];
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
}

export interface DecisionOptions {
  objective: 'quality' | 'balanced' | 'economical';
  contextSelection: boolean;
  failureTriage: boolean;
  requirementCoverage: boolean;
  reviewPrioritization: boolean;
  monitorFiltering: boolean;
  assignmentMatching: boolean;
  models: ModelEvidence[];
}

export interface DecisionOptionsView {
  options: DecisionOptions;
  revision: number;
  inherited: boolean;
}

export interface DecisionRecord {
  id: string;
  projectId: string;
  runId: string | null;
  createdAt: string;
  decision: DecisionReceipt;
  requestedModel: string;
  model: string | null;
  rubricRevision: number;
  inputHash: string;
  answers: Record<
    string,
    {
      type: string;
      choice?: string;
      score?: number;
      noul?: number;
      confidence?: number;
      probabilities?: Record<string, number>;
    }
  >;
  accountedElsewhere: boolean;
}
