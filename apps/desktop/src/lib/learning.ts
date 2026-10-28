/**
 * Learned lessons: entries Jackalope wrote from conversations and finished
 * work. Their lifecycle lives on `automatic.lifecycle`; hand-written and older
 * automatic lessons have none.
 */

export type LearnedStatus = 'probation' | 'active' | 'archived';

export interface Lifecycle {
  /** Text so a newer status still loads; unknown values read as active. */
  status: string;
  statement: string;
  /** `reflection` (background) or `session` (`/learn`). */
  origin: string;
  bornAt: string;
  deliveries: number;
  opportunities: number;
  idle: number;
  lastDeliveredAt?: string | null;
  archivedReason?: string | null;
}

export interface LedgerRecord {
  id: string;
  entryId: string;
  at: string;
  action: string;
  reason: string;
  origin: string;
  revision: number;
  title: string;
  evidence?: string[];
}

/** Reported tool calls between background reflections of a running task. */
export const LEARNING_CADENCES = [25, 50, 100, 200] as const;
const DEFAULT_LEARNING_CADENCE = 50;

interface LearningPreferences {
  preferences?: { learnAutomatically?: boolean; learningCadence?: number };
}

export function learningSettings(project: LearningPreferences | undefined) {
  const cadence = project?.preferences?.learningCadence;
  return {
    automatic: project?.preferences?.learnAutomatically !== false,
    cadence:
      cadence !== undefined && cadence >= 10 && cadence <= 1000
        ? cadence
        : DEFAULT_LEARNING_CADENCE,
  };
}

export function learnedStatus(lifecycle: Lifecycle | null | undefined): LearnedStatus | null {
  if (!lifecycle) return null;
  if (lifecycle.status === 'archived' || lifecycle.status === 'probation') return lifecycle.status;
  return 'active';
}

const STATUS_LABELS: Record<LearnedStatus, string> = {
  probation: 'New',
  active: 'Active',
  archived: 'Archived',
};

const ARCHIVE_REASONS: Record<string, string> = {
  unused: 'not used by recent tasks',
  capacity: 'the project reached its limit of learned lessons',
  retired: 'you said it no longer applies',
  user: 'archived by you',
};

/** One line describing a learned lesson's status and use. */
export function learningSummary(lifecycle: Lifecycle): string {
  const status = learnedStatus(lifecycle) ?? 'active';
  const uses =
    lifecycle.deliveries === 1 ? 'Used in 1 task' : `Used in ${lifecycle.deliveries} tasks`;
  if (status === 'archived') {
    const reason = lifecycle.archivedReason && ARCHIVE_REASONS[lifecycle.archivedReason];
    return reason ? `${uses} · Archived: ${reason}` : `${uses} · Archived`;
  }
  if (status === 'probation') return `${uses} · New until it is used in 2 tasks`;
  return uses;
}

export function statusLabel(status: LearnedStatus): string {
  return STATUS_LABELS[status];
}

const ACTION_LABELS: Record<string, string> = {
  born: 'Learned',
  merged: 'Seen again',
  patched: 'Updated',
  retired: 'Retired',
  promoted: 'Now active',
  archived: 'Archived',
  restored: 'Restored',
  edited: 'Edited',
  deleted: 'Removed',
};

export function ledgerActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}
