import type { CompanionNotice } from '../stores/companionStore.ts';

/** What the mascot's speech bubble shows: one notice, or a summary of several. */
export interface CompanionHint {
  id: string;
  title: string;
  kind: CompanionNotice['kind'];
  /** The notices it announces; a summary covers more than one. */
  ids: string[];
}

const rank = { attention: 0, success: 1, info: 2 };

/**
 * Notices not announced before. Before the first load settles nothing is fresh, so state that
 * already existed at launch or reload is never announced.
 */
export function freshNotices(
  notices: CompanionNotice[],
  announced: ReadonlySet<string>,
  ready: boolean,
): CompanionNotice[] {
  if (!ready) return [];
  return notices.filter((notice) => !announced.has(notice.id));
}

/**
 * One bubble for everything that arrived together: the notice itself when it is alone,
 * otherwise a count. `current` is a bubble still on screen, which the new arrivals join.
 */
export function coalesce(
  fresh: CompanionNotice[],
  current: CompanionHint | null = null,
): CompanionHint | null {
  const ids = [...new Set([...(current?.ids ?? []), ...fresh.map((notice) => notice.id)])];
  if (!ids.length) return null;
  const kind = [...fresh.map((notice) => notice.kind), ...(current ? [current.kind] : [])].sort(
    (a, b) => rank[a] - rank[b],
  )[0];
  if (ids.length === 1) {
    const only = fresh[0] ?? current;
    return only ? { id: ids[0], title: only.title, kind, ids } : null;
  }
  return {
    id: `summary:${ids.join(',')}`,
    title: kind === 'attention' ? `${ids.length} things need you` : `${ids.length} updates`,
    kind,
    ids,
  };
}

/** Whether a bubble still refers to something present, so it can clear itself. */
export function hintStillRelevant(hint: CompanionHint, notices: CompanionNotice[]): boolean {
  const present = new Set(notices.map((notice) => notice.id));
  return hint.ids.some((id) => present.has(id));
}

/**
 * The mascot's badge: the same needs-you count as the Work badge, plus attention notices that
 * are not work items (plan decisions, recovery, errors) the person has not read, plus helper
 * actions waiting for review. Task notices are left out because the work count covers them.
 */
export function companionBadge({
  needsYou,
  notices,
  readIds,
  proposals,
}: {
  needsYou: number;
  notices: CompanionNotice[];
  readIds: readonly string[];
  proposals: number;
}): number {
  const read = new Set(readIds);
  const other = notices.filter(
    (notice) =>
      notice.kind === 'attention' && !notice.id.startsWith('task:') && !read.has(notice.id),
  ).length;
  return needsYou + other + proposals;
}

const announcedStorage = 'jackalope-companion-announced-v1';
let announced: Set<string> | null = null;

/** Notice ids already announced, kept across launches so a restart never repeats them. */
export function announcedIds(): Set<string> {
  if (announced) return announced;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(announcedStorage) ?? '[]');
    announced = new Set(
      Array.isArray(value) ? value.filter((id) => typeof id === 'string').slice(-1000) : [],
    );
  } catch {
    announced = new Set();
  }
  return announced;
}

/** Records notices as announced, including ones the person saw on the page itself. */
export function markAnnounced(ids: Iterable<string>) {
  const set = announcedIds();
  let changed = false;
  for (const id of ids) {
    if (set.has(id)) continue;
    set.add(id);
    changed = true;
  }
  if (!changed) return;
  try {
    localStorage.setItem(announcedStorage, JSON.stringify([...set].slice(-1000)));
  } catch {}
}
