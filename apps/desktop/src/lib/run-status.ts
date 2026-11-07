import type { RunStatus } from './run-types.ts';

type HasStatus = string | { status: string };
const statusOf = (value: HasStatus) => (typeof value === 'string' ? value : value.status);
const within = (statuses: readonly RunStatus[]) => {
  const set = new Set<string>(statuses);
  return (value: HasStatus) => set.has(statusOf(value));
};

/** The agent process is starting, working or being stopped. */
export const isActive = within(['starting', 'running', 'stopping']);
/** Preparing or working, and not being stopped. */
export const isWorking = within(['starting', 'running']);
/** Active, or cut off by an app restart and able to resume. */
export const isLive = within(['starting', 'running', 'stopping', 'interrupted']);
/** The attempt produced a result to review. */
export const isFinished = within(['review', 'reviewed']);
/** The attempt ended without a result. */
export const isUnfinished = within(['failed', 'stopped', 'interrupted']);
/** The attempt ended and will not resume: a result, a failure or a stop. */
export const isSettled = within(['review', 'reviewed', 'failed', 'stopped']);
/** An attempt that ended without finishing can be tried again from the same task. */
export const canRetry = (run: HasStatus) => isUnfinished(run);

export const statusLabel: Record<RunStatus, string> = {
  starting: 'Preparing workspace',
  running: 'Working',
  stopping: 'Stopping',
  stopped: 'Stopped',
  interrupted: 'Interrupted',
  failed: 'Needs attention',
  review: 'Ready to review',
  reviewed: 'Reviewed',
};

/** A duration as its two largest units: `45s`, `2m 14s`, `3h 05m`, `2d 4h`. */
export function durationLabel(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (!Number.isFinite(seconds)) return '';
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days) return `${days}d ${hours % 24}h`;
  if (hours) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}
/** How long the current step has been running, as a compact `2m 14s`. */
export function elapsedLabel(since: string, now: number = Date.now()): string {
  return durationLabel((now - Date.parse(since)) / 1000);
}
