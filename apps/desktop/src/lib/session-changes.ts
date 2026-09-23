import type { SessionSnapshot } from './live-session.ts';

export function knownSessionRevisions(revisions: SessionSnapshot['revisions']) {
  if (!revisions) return {};
  const entries = Object.entries(revisions);
  return entries.length <= 20000 ? revisions : Object.fromEntries(entries.slice(0, 20000));
}

function merge<T extends { id: string }>(
  previous: T[],
  changed: T[],
  prefix: string,
  revisions: Record<string, string>,
) {
  const updates = new Map(changed.map((item) => [item.id, item]));
  const next = previous
    .filter((item) => `${prefix}:${item.id}` in revisions)
    .map((item) => {
      const update = updates.get(item.id);
      updates.delete(item.id);
      return update ?? item;
    });
  next.push(...updates.values());
  return next.length === previous.length && next.every((item, index) => item === previous[index])
    ? previous
    : next;
}
export function mergeSessionChanges(
  previous: SessionSnapshot,
  snapshot: SessionSnapshot,
): SessionSnapshot {
  if (!snapshot.revisions) return snapshot;
  return {
    ...snapshot,
    sessions: merge(previous.sessions, snapshot.sessions, 'session', snapshot.revisions),
    runs: merge(previous.runs, snapshot.runs, 'run', snapshot.revisions),
  };
}
