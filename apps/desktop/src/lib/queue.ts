import { invokeNative } from './native/transport.ts';

export interface QueueItem {
  stagedDependencies?: boolean;
  feature?: string | null;
  featureId?: string | null;
  contextSelection?: import('./knowledge-types.ts').ContextSelection;
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  agent: string;
  account?: string | null;
  scopes: string[];
  dependencies: string[];
  runId: string | null;
  error: string | null;
  canceled: boolean;
  /** Paths this task handed to subtasks it spawned. */
  excludedScopes?: string[];
  /** Set on subtasks an agent split off with propose_subtask. */
  parentTaskId?: string | null;
}
interface QueueMessage {
  report?: { completed: string[]; remaining: string[]; artifacts: string[] } | null;
  runId?: string | null;
  sourceTree?: string | null;
  resolvedBy?: string | null;
  id: string;
  taskId: string;
  projectId: string;
  kind: string;
  text: string;
  createdAt: string;
  recipientTaskId?: string | null;
  acknowledgedBy?: string[];
}
interface CoordinationAgreement {
  rejectedBy?: string | null;
  resolutionRun?: string | null;
  id: string;
  projectId: string;
  taskId: string;
  kind: 'ownership' | 'interface';
  resource: string;
  paths: string[];
  text: string;
  participants: string[];
  acceptedBy: string[];
  status: string;
  revision: number;
}
interface ScopeAudit {
  projectId: string;
  taskId: string;
  runId: string;
  tree: string | null;
  outside: string[];
  overlaps: string[];
  error: string | null;
  acceptedTree: string | null;
}
interface AssistPolicy {
  projectId: string;
  projectPath: string;
  projectName: string;
  agent: string;
  verifyCommand: string;
  resolve: boolean;
  merge: boolean;
}
interface ReconciliationJob {
  id: string;
  projectId: string;
  sourceIds: string[];
  runId: string | null;
  planId: string | null;
  status: string;
  error: string | null;
  /** Why the project's autonomy policy kept an automatic merge in review. */
  held?: string | null;
}
export interface QueueView {
  managedTasks?: import('./managed-task').ManagedTask[];
  assistPolicies?: AssistPolicy[];
  reconciliations?: ReconciliationJob[];
  agreements?: CoordinationAgreement[];
  scopeAudits?: ScopeAudit[];
  items: QueueItem[];
  messages: QueueMessage[];
  enabledProjects: string[];
  concurrency: number;
  /** Agents that may run at once on project computers, apart from `concurrency`. */
  remoteConcurrency?: number;
  bridgeUrl: string | null;
  bridgeError: string | null;
  mergedRunIds: string[];
  /** Applied integrations whose merge left the target branch; their dependents wait. */
  pausedIntegrations?: PausedIntegration[];
}
interface PausedIntegration {
  planId: string;
  projectPath: string;
  targetBranch: string;
  commit: string;
  /** The native explanation, in the same wording dispatch reports. */
  message: string;
}
export interface IntegrationPlan {
  id: string;
  projectPath: string;
  masterHead: string;
  targetBranch: string;
  integrationHead: string | null;
  runIds: string[];
  files: string[];
  patch: string;
  conflicts: string[];
  status: string;
  createdAt: string;
  appliedAt: string | null;
  commitMessage?: string;
  commitPolicy?: import('./project-git').CommitPolicy;
  cleanupRequested?: boolean;
  cleanupResults?: { workspace: string; removed: boolean; error: string | null }[];
}

export type QueueCommand =
  | 'queue_snapshot'
  | 'queue_dispatch'
  | 'queue_add'
  | 'queue_import'
  | 'queue_cancel'
  | 'queue_release'
  | 'queue_cancel_agreement'
  | 'queue_reconcile_scope'
  | 'queue_assist_policy'
  | 'queue_retry_reconciliation';
export async function queueCommand<T>(
  command: QueueCommand,
  args?: Record<string, unknown>,
): Promise<T> {
  return invokeNative<T>(command, args);
}
export const queueSnapshot = () => queueCommand<QueueView>('queue_snapshot');
export const integrationPlans = () => invokeNative<IntegrationPlan[]>('integration_plans');
export const prepareIntegration = (runIds: string[], commitMessage?: string) =>
  invokeNative<IntegrationPlan>('integration_prepare', { runIds, commitMessage });
export const applyIntegration = (planId: string, cleanup = false) =>
  invokeNative<IntegrationPlan>('integration_apply', { planId, cleanup });
