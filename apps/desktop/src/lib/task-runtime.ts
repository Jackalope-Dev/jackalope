import { isTauriEnvironment } from './tauri-bridge.ts';

export interface Runner {
  id: string;
  name: string;
  available: boolean;
  signedIn: boolean;
  account: string;
  detail: string;
}
export interface RunUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reported: boolean;
  estimatedCostUsd: number | null;
}
export interface TaskRun {
  routing?: {
    attempts?: {
      agent: string;
      model: string | null;
      binding: { adapter: string; profileId: string | null; directory: string; label: string };
      usage: RunUsage;
      error: string | null;
      recordedAt: string;
    }[];
    decisions: {
      orchestrator: string;
      orchestratorModel: string | null;
      orchestratorAccount: string;
      agent: string;
      model: string | null;
      account: string;
      profileId: string | null;
      reason: string;
      remainingPercent: number | null;
      expectedUsagePercent: number | null;
      checkedAt: string;
      usage: RunUsage;
    }[];
    handoffs: {
      agent: string;
      model: string | null;
      binding: { adapter: string; profileId: string | null; directory: string; label: string };
      sessionId: string | null;
      result: string;
      usage: RunUsage;
      failure: { modelOnly: boolean; message: string };
      recordedAt: string;
    }[];
  } | null;
  contract?: import('./task-outcomes').TaskContract;
  monitorChange?: { before: string; after: string; path: string; branch: string } | null;
  contextReceipt?: import('./knowledge').ContextReceipt;
  id: string;
  taskId: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  workspace: string;
  branch: string;
  baseHead: string;
  agent: string;
  account: string;
  connectionIds?: string[] | null;
  targetBranch?: string | null;
  verifyCommand?: string | null;
  prepareCommand?: string | null;
  autoVerify?: boolean;
  finishing?: boolean;
  verificationError?: string | null;
  verification?: Verification | null;
  accountBinding?: {
    adapter: string;
    profileId: string | null;
    directory: string;
    label: string;
  } | null;
  model: string | null;
  prompt: string;
  status:
    | 'starting'
    | 'running'
    | 'stopping'
    | 'stopped'
    | 'interrupted'
    | 'failed'
    | 'review'
    | 'reviewed';
  startedAt: string;
  endedAt: string | null;
  sessionId: string | null;
  result: string;
  detailsOmitted?: boolean;
  activity: string[];
  diagnostics: string[];
  error: string | null;
  persistenceError: string | null;
  exitCode: number | null;
  usage: RunUsage;
  mcpUsage?: {
    searches: number;
    calls: number;
    failures: number;
    catalogTools: number;
    catalogBytes: number;
    schemaBytesReturned: number;
  };
  usageObservations?: {
    messageId: string;
    parentToolUseId: string | null;
    model: string | null;
    input: number;
    output: number;
  }[];
  prompts?: PendingUserPrompt[];
  validationSteps?: ValidationStep[];
  screenshots?: ScreenshotArtifact[];
}
export interface ArchivedRun {
  id: string;
  taskId: string;
  projectName: string;
  agent: string;
  prompt: string;
  status: TaskRun['status'];
  startedAt: string;
  endedAt: string | null;
}
export interface PendingUserPrompt {
  id: string;
  runId: string;
  question: string;
  inputType: 'text' | 'choice' | 'confirmation';
  options: string[];
  defaultValue?: string | null;
  status: 'pending' | 'answered';
  answer?: string | null;
  createdAt: string;
  answeredAt?: string | null;
}
export interface ValidationStep {
  id: string;
  step: string;
  status: 'pending' | 'in_progress' | 'passed' | 'failed';
  notes?: string | null;
  evidence: string[];
  timestamp: string;
}
export interface ScreenshotArtifact {
  id: string;
  name: string;
  url: string;
  filePath: string;
  width: number;
  height: number;
  timestamp: string;
}
export interface RunRequest {
  contextSelection?: import('./knowledge').ContextSelection;
  connectionIds?: string[];
  model?: string;
  id: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  agent: string;
  /** Explicit account (agent-profile id) to run this agent as, if the project picked one. */
  agentProfileId?: string;
  targetBranch?: string;
  verifyCommand?: string;
  prepareCommand?: string;
  autoVerify?: boolean;
  prompt: string;
  isolated: boolean;
  previousRunId?: string;
  taskId?: string;
}
export interface Verification {
  command: string;
  checkedAt: string;
  tree: string | null;
  result: {
    exitCode: number | null;
    success: boolean;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    truncated: boolean;
    durationMs: number;
  };
}
export interface Review {
  files: string[];
  diff: string;
  note: string;
}
export const isActive = (run: TaskRun) => ['starting', 'running', 'stopping'].includes(run.status);
export const statusLabel: Record<TaskRun['status'], string> = {
  starting: 'Preparing workspace',
  running: 'Working',
  stopping: 'Stopping',
  stopped: 'Stopped',
  interrupted: 'Interrupted',
  failed: 'Needs attention',
  review: 'Ready to review',
  reviewed: 'Reviewed',
};

export async function nativeTask<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriEnvironment())
    throw new Error(
      'Open the desktop app to connect projects and run agents. This browser preview does not execute work.',
    );
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export async function respondToPrompt(
  runId: string,
  promptId: string,
  answer: string,
): Promise<boolean> {
  return nativeTask<boolean>('task_respond_prompt', { runId, promptId, answer });
}
