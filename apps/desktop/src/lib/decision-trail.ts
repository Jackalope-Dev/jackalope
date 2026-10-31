import type { DecisionEntry, TaskRun } from './task-runtime.ts';

/** How a reviewer should read one evidence pointer. */
export type PointerState = 'found' | 'missing' | 'external' | 'unchecked';

/** One attempt's entries; each retry or continuation starts a new group. */
export interface TrailGroup {
  runId: string;
  attempt: number;
  startedAt: string;
  entries: DecisionEntry[];
}

type TrailRun = Pick<TaskRun, 'id' | 'startedAt' | 'decisions'>;

/**
 * Groups the decision trail of a task's attempts, oldest first, up to and including
 * `currentId` so an earlier attempt never shows decisions made after it. Attempts with
 * no entries are skipped; a task without any entries returns no groups.
 */
export function decisionTrail(attempts: TrailRun[], currentId?: string): TrailGroup[] {
  const ordered = [...attempts].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const end = currentId ? ordered.findIndex((run) => run.id === currentId) : -1;
  return ordered
    .slice(0, end < 0 ? ordered.length : end + 1)
    .map((run, index) => ({
      runId: run.id,
      attempt: index + 1,
      startedAt: run.startedAt,
      entries: run.decisions ?? [],
    }))
    .filter((group) => group.entries.length > 0);
}

/** Entries a later entry corrected, keyed by the corrected id with the correcting entry. */
export function supersededBy(groups: TrailGroup[]): Map<string, DecisionEntry> {
  const map = new Map<string, DecisionEntry>();
  for (const group of groups)
    for (const entry of group.entries) if (entry.supersedes) map.set(entry.supersedes, entry);
  return map;
}

/** Pointer states for an entry, in evidence order; unchecked until the attempt ends. */
export function pointerStates(
  entry: DecisionEntry,
): { pointer: string; state: PointerState; note?: string }[] {
  return entry.evidence.map((pointer, index) => {
    const check = entry.checks?.[index];
    const state = check?.pointer === pointer ? check.state : undefined;
    return {
      pointer,
      state: state === 'found' || state === 'missing' || state === 'external' ? state : 'unchecked',
      note: check?.note ?? undefined,
    };
  });
}

/** Evidence pointers Jackalope looked for and could not find. */
export function missingPointers(groups: TrailGroup[]): number {
  return groups
    .flatMap((group) => group.entries)
    .flatMap(pointerStates)
    .filter((item) => item.state === 'missing').length;
}

/** Plain-text lines for handoffs, newest last and bounded. */
export function trailHandoff(entries: DecisionEntry[], limit = 12): string {
  return entries
    .slice(-limit)
    .map((entry) => {
      const evidence = pointerStates(entry)
        .map(({ pointer, state }) => (state === 'missing' ? `${pointer} (not found)` : pointer))
        .join(', ');
      return `- [${entry.phase}] ${entry.decision}: ${entry.why} → ${entry.result}${evidence ? ` (evidence: ${evidence})` : ''}`;
    })
    .join('\n');
}
