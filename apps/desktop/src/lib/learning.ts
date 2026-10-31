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
  /** `reflection` (background), `session` (`/learn`) or `agent`. */
  origin: string;
  bornAt: string;
  deliveries: number;
  opportunities: number;
  idle: number;
  lastDeliveredAt?: string | null;
  archivedReason?: string | null;
  /** Times the person restated it after it was supplied. */
  misses?: number;
  /** Agents keep missing it; supplied first among equally matching lessons. */
  missedOften?: boolean;
}

/** The repository check that enforces a lesson; see `Enforcement` in Rust. */
export interface Enforcement {
  /** The command or file the accepted task reported. */
  by: string;
  runId: string;
  taskId?: string;
  at: string;
  /** What the check names that the project no longer has. */
  missing?: string | null;
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
  merged: 'folded into a similar lesson; restore to keep it separate',
  ignored: 'agents kept missing it while it was new',
  stale: 'it names something the project no longer has',
  enforced: 'the repository now enforces it',
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

/**
 * Why a lesson needs a look, or null. `stale` names something the project
 * no longer has; lessons you wrote are only flagged, never changed.
 */
export function lessonAttention(entry: {
  stale?: string | null;
  enforced?: Enforcement | null;
  automatic?: { managed: boolean; lifecycle?: Lifecycle | null } | null;
}): string | null {
  const lifecycle = entry.automatic?.lifecycle;
  if (entry.stale) {
    const archived = learnedStatus(lifecycle) === 'archived';
    return archived
      ? `References ${entry.stale}, which no longer exists.`
      : `References ${entry.stale}, which no longer exists. Edit or remove this lesson.`;
  }
  if (entry.enforced?.missing) {
    return `The check that enforced this names ${entry.enforced.missing}, which no longer exists. Make it a check again or turn the lesson back on.`;
  }
  if (lifecycle?.missedOften && learnedStatus(lifecycle) !== 'archived') {
    return 'Agents keep missing this. It is supplied first among equally matching lessons.';
  }
  return null;
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
  curated: 'Folded into a similar lesson',
  missed: 'Missed by an agent',
  contradicted: 'Contradicted',
  stale: 'Out of date',
  enforced: 'Made a check',
  unenforced: 'No longer enforced',
  unreported: 'Check not reported',
};

export function ledgerActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** Local learning counts for calibrating thresholds; see `knowledge_learning_metrics`. */
export interface LearningMetrics {
  probation: number;
  active: number;
  archived: number;
  deliveries: number;
  learned: number;
  promoted: number;
  archivedEvents: number;
  restored: number;
  folded: number;
  retired: number;
  /** Times a supplied lesson was restated or contradicted. */
  missed: number;
  contradicted: number;
  /** Lessons found to name something the project no longer has. */
  stale: number;
  byAgent: number;
  /** Lessons a repository check now enforces, from accepted tasks. */
  enforced?: number;
  since?: string | null;
}

/** Label and value pairs for the Project context summary. */
export function learningMetricRows(metrics: LearningMetrics): [string, number][] {
  return [
    ['New', metrics.probation],
    ['Active', metrics.active],
    ['Archived', metrics.archived],
    ['Times supplied to tasks', metrics.deliveries],
    ['Learned', metrics.learned],
    ['Suggested by an agent', metrics.byAgent],
    ['Became active', metrics.promoted],
    ['Archived (all reasons)', metrics.archivedEvents],
    ['Folded as duplicates', metrics.folded],
    ['Retired by you', metrics.retired],
    ['Restored', metrics.restored],
    ['Missed by agents', metrics.missed],
    ['Contradicted after use', metrics.contradicted],
    ['Found out of date', metrics.stale],
    ['Made into checks', metrics.enforced ?? 0],
  ];
}

/** The draft key "Make it a check" uses; `helper-` drafts open in the composer. */
export function lessonCheckDraftKey(entryId: string): string {
  return `helper-lesson-check-${entryId}`;
}

interface CheckableLesson {
  kind: string;
  enabled: boolean;
  enforced?: Enforcement | null;
  automatic?: { lifecycle?: Lifecycle | null } | null;
}

/**
 * How prominently a lesson offers "Make it a check": first for lessons agents
 * keep missing or whose check disappeared, on demand for any other lesson,
 * and not at all once a check enforces it.
 */
export function lessonCheckOffer(entry: CheckableLesson): 'suggested' | 'available' | null {
  if (entry.kind !== 'memory') return null;
  if (entry.enforced && !entry.enforced.missing) return null;
  const lifecycle = entry.automatic?.lifecycle;
  if (entry.enforced?.missing) return 'suggested';
  if (lifecycle?.missedOften && learnedStatus(lifecycle) !== 'archived') return 'suggested';
  return 'available';
}

/** An enforced lesson still supplied to tasks, which the person may retire. */
export function canRetireEnforced(entry: CheckableLesson): boolean {
  return (
    !!entry.enforced &&
    !entry.enforced.missing &&
    entry.enabled &&
    learnedStatus(entry.automatic?.lifecycle) !== 'archived'
  );
}
