import { isTauriEnvironment } from './tauri-bridge';

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
  activity: string[];
  diagnostics: string[];
  error: string | null;
  persistenceError: string | null;
  exitCode: number | null;
  usage: RunUsage;
}
export interface RunRequest {
  id: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  agent: string;
  prompt: string;
  isolated: boolean;
  previousRunId?: string;
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
