import type { Review } from '@jackalope/contracts/runs';
import { isActive } from '@jackalope/contracts/runs';
import { invokeNative } from './native/transport.ts';
import type { RewindOutcome, RewindPreview } from './rewind.ts';
import type { ChangeStats, TaskRun } from './run-types.ts';

export const stopTask = (id: string) => invokeNative<void>('task_stop', { id });
export const markReviewed = (id: string) => invokeNative<void>('task_mark_reviewed', { id });
export const stopPreview = (id: string) => invokeNative<void>('task_preview_stop', { id });
/** Start a fresh attempt at a task whose last attempt did not finish. */
/**
 * `focus` leads the progress context when the retry picks up a quota-stopped attempt's work;
 * `switchTo` moves work a usage limit stopped to another agent or account.
 */
export const retryTask = (
  id: string,
  focus?: string,
  switchTo?: { agent: string; profileId: string | null },
) =>
  invokeNative<string>('task_retry', {
    id,
    focus: focus?.trim() || null,
    switchTo: switchTo ?? null,
  });
/** Retries a usage-limited attempt once its reported reset passes, or cancels that. */
export const resumeAtReset = (id: string, schedule: boolean) =>
  invokeNative<void>('task_resume_at_reset', { id, schedule });
/** What rewinding to `runId`'s turn would do; rejects with the reason it cannot. */
export const previewRewind = (runId: string) =>
  invokeNative<RewindPreview>('task_rewind_preview', { runId });
/** Rewinds to `runId`'s turn, provided `latestRunId` is still the newest turn. */
export const rewindTo = (runId: string, latestRunId: string) =>
  invokeNative<RewindOutcome>('task_rewind', { runId, latestRunId });
/** Undoes the rewind kept on `runId`, the latest turn, until the next turn starts. */
export const undoRewind = (runId: string) => invokeNative<void>('task_rewind_undo', { runId });
/** Marks an interrupted attempt stopped once the person confirmed nothing from it still runs. */
export const releaseInterrupted = (id: string) =>
  invokeNative<TaskRun>('task_release_interrupted', { id });

export interface WorkspaceProcess {
  pid: number;
  name: string;
  directory: string;
}
/** Processes running in an attempt's workspace; `null` when this system cannot tell. */
export const workspaceProcesses = (id: string) =>
  invokeNative<WorkspaceProcess[] | null>('task_workspace_processes', { id });
export const taskReview = (id: string) => invokeNative<Review>('task_review', { id });
/** Diff size per attempt, keyed by id; attempts whose diff cannot be read are left out. */
export const taskChangeStats = (ids: string[]) =>
  invokeNative<Record<string, ChangeStats>>('task_change_stats', { ids });
/** Loads an archived attempt back into history. */
export const restoreArchivedTask = (id: string) =>
  invokeNative<void>('task_restore_archived', { id });
export const respondToPrompt = (runId: string, promptId: string, answer: string) =>
  invokeNative<boolean>('task_respond_prompt', { runId, promptId, answer });

interface SettleOptions {
  /** What the person wrote that waits for the stop, named in errors: `follow-up`, `message`. */
  saved: string;
  /** Extra condition the stopped attempt must meet, checked on each read. */
  settled?: (run: TaskRun) => boolean;
  /** The next attempt resumes the agent's session, so the stopped one must have one. */
  resumable?: boolean;
  wait?: () => Promise<void>;
  attempts?: number;
}

/** Polls `read` until attempt `id` is no longer active, refusing interrupted or missing ownership. */
export async function waitForStoppedAttempt(
  id: string,
  read: () => Promise<TaskRun | undefined>,
  {
    saved,
    settled = () => true,
    resumable = false,
    wait = () => new Promise((resolve) => setTimeout(resolve, 250)),
    attempts = 120,
  }: SettleOptions,
): Promise<TaskRun> {
  for (let i = 0; i < attempts; i++) {
    const run = await read();
    if (!run || run.id !== id)
      throw new Error(`The original attempt is unavailable. Your ${saved} is still saved.`);
    if (run.status === 'interrupted')
      throw new Error(
        `Inspect interrupted ownership before continuing. Your ${saved} is still saved.`,
      );
    if (!isActive(run) && settled(run)) {
      if (resumable && !run.sessionId)
        throw new Error(
          `The agent did not provide a resumable session. Your ${saved} is still saved.`,
        );
      return run;
    }
    await wait();
  }
  throw new Error(
    `The agent is still stopping. Your ${saved} is saved; send it once work has stopped.`,
  );
}

/** Stops attempt `id` and waits until it has settled, so the next attempt can follow it. */
export async function stopAndSettle(
  id: string,
  read: () => Promise<TaskRun | undefined>,
  options: SettleOptions,
): Promise<TaskRun> {
  await stopTask(id);
  return waitForStoppedAttempt(id, read, options);
}
