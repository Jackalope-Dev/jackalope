import type { ProjectPreferences } from '../stores/projectStore.ts';

/** Retention periods offered in Project settings, in days. */
export const RETENTION_CHOICES = [1, 3, 7, 14, 30] as const;

/** Waits this long after the app opens before the first pass, so startup is never slowed. */
export const FIRST_PASS_DELAY_MS = 10 * 60 * 1000;
/** Then checks this often; retention is counted in days. */
export const PASS_INTERVAL_MS = 60 * 60 * 1000;

/** One worktree a cleanup pass looked at, as the native log records it. */
export interface RetentionEntry {
  project: string;
  worktree: string;
  branch: string;
  outcome: 'removed' | 'kept' | 'failed';
  reason: string;
  at: string;
}

/** The project's retention period in days, or undefined when automatic cleanup is off. */
export function retentionDays(
  preferences: Pick<ProjectPreferences, 'worktreeRetentionDays'> | undefined,
): number | undefined {
  const days = preferences?.worktreeRetentionDays;
  return typeof days === 'number' && Number.isInteger(days) && days >= 1 && days <= 365
    ? days
    : undefined;
}

/** "after 1 day" or "after 7 days", for a settings label. */
export function retentionLabel(days: number) {
  return days === 1 ? 'After 1 day' : `After ${days} days`;
}

/** The worktree's folder name, which is how the task's branch and folder read in a list. */
export function worktreeName(path: string) {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? path
  );
}
