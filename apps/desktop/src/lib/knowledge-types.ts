import type { Enforcement, Lifecycle } from './learning.ts';

interface ProcessTemplate {
  outcomes: string[];
  steps: string[];
  inputs: string[];
}
export interface KnowledgeEntry {
  automatic?: {
    kind:
      | 'preference'
      | 'adjustment'
      | 'review'
      | 'repository'
      | 'verification'
      | 'correction'
      | 'clarification'
      | 'insight';
    evidence: string[];
    managed: boolean;
    /** Present on lessons the learning loop wrote. */
    lifecycle?: Lifecycle | null;
    resolution?: {
      runId: string;
      requirementId: string;
      tree: string;
      checkedAt: string;
    } | null;
  } | null;
  dismissed?: boolean;
  /** Something the lesson names that the project no longer has. */
  stale?: string | null;
  /** The repository check that enforces it, from an accepted task. */
  enforced?: Enforcement | null;
  process?: ProcessTemplate;
  id: string;
  projectId: string;
  projectPath: string;
  kind: 'memory' | 'workflow';
  title: string;
  content: string;
  keywords: string[];
  enabled: boolean;
  sourceRunId: string | null;
  sourceHead?: string | null;
  revision: number;
  updatedAt: string;
}
export interface ContextSelection {
  advanceWorkflow?: boolean;
  outcomes?: string[];
  inputValues?: Record<string, string>;
  workflowId?: string | null;
  excludedMemoryIds?: string[];
  memoryOff?: boolean;
  /** The lesson a "Make it a check" task enforces. */
  enforcesLessonId?: string | null;
}
export interface ContextReceipt {
  jevPreparation?: JevPreparation | null;
  jevPreparationResult?: Record<string, unknown> | null;
  reasons?: Record<string, string>;
  entries: KnowledgeEntry[];
  bytes: number;
  enforcesLessonId?: string | null;
}

interface JevPreparation {
  state: string | Record<string, unknown> | unknown[];
  questions: Record<
    string,
    | {
        type: 'choice';
        instructions: string | Record<string, unknown> | unknown[];
        criteria: Record<string, unknown>;
      }
    | {
        type: 'score';
        instructions: string | Record<string, unknown> | unknown[];
        criteria: unknown[];
      }
    | {
        type: 'noul';
        instructions: string | Record<string, unknown> | unknown[];
        criteria?: { true?: string; false?: string };
      }
  >;
  sources?: Record<string, { kind: 'file'; path: string; startLine?: number; lines?: number }>;
}
