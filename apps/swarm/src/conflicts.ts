import type { ChangedFile } from './changes';
import { changedHunks, type Hunk, overlappingHunks, splitLines } from './diff';
import type { CachedReader } from './objects';

export interface ForkSnapshot {
  fork: string;
  baseCommit: string;
  files: ChangedFile[];
}

export type ConflictKind =
  /** Both agents edited the same or adjacent lines. */
  | 'overlapping-lines'
  /** One agent deleted a file the other changed. */
  | 'delete-vs-edit'
  /** Both agents created the same path with different content. */
  | 'both-added'
  /** The file is binary, too large or started from different versions, so lines cannot be compared. */
  | 'same-file';

export interface Conflict {
  forks: [string, string];
  path: string;
  kind: ConflictKind;
  /** 1-based inclusive line ranges in each fork's base version, for overlapping lines. */
  lines?: { left: [number, number]; right: [number, number] }[];
}

const display = (hunk: Hunk): [number, number] => [
  hunk.start + 1,
  Math.max(hunk.start + 1, hunk.end),
];

/** Conflicts between two forks, comparing only the paths both of them changed. */
export async function conflictsBetween(
  left: ForkSnapshot,
  right: ForkSnapshot,
  readers: { left: CachedReader; right: CachedReader },
): Promise<Conflict[]> {
  const theirs = new Map(right.files.map((file) => [file.path, file]));
  const conflicts: Conflict[] = [];
  for (const mine of left.files) {
    const other = theirs.get(mine.path);
    if (!other) continue;
    // Identical results merge cleanly.
    if (mine.head === other.head) continue;
    const forks: [string, string] = [left.fork, right.fork];
    if (mine.base === null && other.base === null) {
      conflicts.push({ forks, path: mine.path, kind: 'both-added' });
      continue;
    }
    if (mine.head === null || other.head === null) {
      conflicts.push({ forks, path: mine.path, kind: 'delete-vs-edit' });
      continue;
    }
    if (mine.base !== other.base || mine.base === null) {
      conflicts.push({ forks, path: mine.path, kind: 'same-file' });
      continue;
    }
    const [base, a, b] = await Promise.all([
      readers.left.readText(mine.base),
      readers.left.readText(mine.head),
      readers.right.readText(other.head),
    ]);
    if (base === null || a === null || b === null) {
      conflicts.push({ forks, path: mine.path, kind: 'same-file' });
      continue;
    }
    const baseLines = splitLines(base);
    const overlaps = overlappingHunks(
      changedHunks(baseLines, splitLines(a)),
      changedHunks(baseLines, splitLines(b)),
    );
    if (overlaps.length)
      conflicts.push({
        forks,
        path: mine.path,
        kind: 'overlapping-lines',
        lines: overlaps.map(({ left: l, right: r }) => ({ left: display(l), right: display(r) })),
      });
  }
  return conflicts;
}

/** Every pairwise conflict among active forks, in a stable order. */
export async function allConflicts(
  forks: ForkSnapshot[],
  reader: (fork: string) => CachedReader,
): Promise<Conflict[]> {
  const sorted = [...forks].sort((a, b) => a.fork.localeCompare(b.fork));
  const results: Conflict[] = [];
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++)
      results.push(
        ...(await conflictsBetween(sorted[i], sorted[j], {
          left: reader(sorted[i].fork),
          right: reader(sorted[j].fork),
        })),
      );
  return results;
}
