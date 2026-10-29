/**
 * Account sync of learned lessons. The native host builds and sends every
 * upload; this side only reads its status. Lesson text, evidence and paths
 * never pass through the renderer, and the status view is accepted only with
 * the fields below so nothing else can be persisted or shown by mistake.
 */

export interface LessonSyncView {
  /** Signed in to an approved account on a configured service. */
  available: boolean;
  /** Settings sync is on; lesson sync needs it. */
  settingsSync: boolean;
  enabled: boolean;
  owner: string | null;
  lastSyncedAt: string | null;
  uploaded: number;
  downloaded: number;
  /** Learned lessons that stay on this desktop because they look sensitive. */
  keptLocal: number;
  projects: number;
  /** Included projects without a folder or commit to match them by. */
  unavailableProjects: number;
  /** Synced lessons were deleted from another desktop, which turned sync off. */
  reset: boolean;
}

export const EMPTY_LESSON_SYNC: LessonSyncView = {
  available: false,
  settingsSync: false,
  enabled: false,
  owner: null,
  lastSyncedAt: null,
  uploaded: 0,
  downloaded: 0,
  keptLocal: 0,
  projects: 0,
  unavailableProjects: 0,
  reset: false,
};

const FLAGS = ['available', 'settingsSync', 'enabled', 'reset'] as const;
const COUNTS = ['uploaded', 'downloaded', 'keptLocal', 'projects', 'unavailableProjects'] as const;
const TEXTS = ['owner', 'lastSyncedAt'] as const;
const FIELDS = new Set<string>([...FLAGS, ...COUNTS, ...TEXTS]);

/** The native status, or an error for any unexpected field or type. */
export function parseLessonSyncView(value: unknown): LessonSyncView {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid lesson sync status.');
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record))
    if (!FIELDS.has(key)) throw new Error('Invalid lesson sync status.');
  const view = { ...EMPTY_LESSON_SYNC };
  for (const key of FLAGS) {
    if (typeof record[key] !== 'boolean') throw new Error('Invalid lesson sync status.');
    view[key] = record[key];
  }
  for (const key of COUNTS) {
    const count = record[key];
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
      throw new Error('Invalid lesson sync status.');
    view[key] = count;
  }
  for (const key of TEXTS) {
    const text = record[key];
    if (text !== null && (typeof text !== 'string' || text.length > 200))
      throw new Error('Invalid lesson sync status.');
    view[key] = text;
  }
  return view;
}

/** Whether a project's learned lessons take part in lesson sync. */
export function syncsLessons(project: { preferences?: { syncLessons?: boolean } } | undefined) {
  return project?.preferences?.syncLessons !== false;
}

/** One status line for the lesson sync control. */
export function lessonSyncStatus(view: LessonSyncView, busy: boolean): string {
  if (view.reset)
    return 'Synced lessons were deleted from another desktop, so lesson sync turned off here.';
  if (!view.available) return 'Sign in to sync learned lessons.';
  if (!view.settingsSync) return 'Turn on settings sync to include learned lessons.';
  if (!view.enabled) return 'Learned lessons stay on this desktop.';
  if (busy) return 'Syncing learned lessons…';
  if (!view.lastSyncedAt) return 'Ready to sync learned lessons.';
  const parts = [
    view.projects === 1
      ? 'Lessons from 1 project are synced.'
      : `Lessons from ${view.projects} projects are synced.`,
  ];
  if (view.unavailableProjects)
    parts.push(
      view.unavailableProjects === 1
        ? '1 project has no commit to match it by and stays local.'
        : `${view.unavailableProjects} projects have no commit to match them by and stay local.`,
    );
  if (view.keptLocal)
    parts.push(
      view.keptLocal === 1
        ? '1 lesson looks sensitive and stays local.'
        : `${view.keptLocal} lessons look sensitive and stay local.`,
    );
  return parts.join(' ');
}
