/**
 * Line-level change ranges, in base-file coordinates, for overlap checks between
 * agents. Precise for typical agent edits; when the changed middle of a file is
 * too large to compare exactly, the whole middle is reported as one change so an
 * overlap is never missed.
 */

/** Base lines [start, end) were replaced; start === end is an insertion before `start`. */
export interface Hunk {
  start: number;
  end: number;
}

/** Above this many cells, the changed middle is treated as one hunk. */
const EXACT_CELL_LIMIT = 4_000_000;

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Hunks that turn `base` into `next`, in base coordinates, sorted and non-overlapping. */
export function changedHunks(base: string[], next: string[]): Hunk[] {
  let prefix = 0;
  while (prefix < base.length && prefix < next.length && base[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < base.length - prefix &&
    suffix < next.length - prefix &&
    base[base.length - 1 - suffix] === next[next.length - 1 - suffix]
  )
    suffix++;
  const a = base.slice(prefix, base.length - suffix);
  const b = next.slice(prefix, next.length - suffix);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0 || b.length === 0 || (a.length + 1) * (b.length + 1) > EXACT_CELL_LIMIT)
    return [{ start: prefix, end: prefix + a.length }];
  return lcsHunks(a, b).map((hunk) => ({ start: hunk.start + prefix, end: hunk.end + prefix }));
}

/** Longest-common-subsequence backtrack over the trimmed middle. */
function lcsHunks(a: string[], b: string[]): Hunk[] {
  const width = b.length + 1;
  // table[i * width + j] = LCS length of a[i..] and b[j..].
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let open: Hunk | null = null;
  let i = 0;
  let j = 0;
  const close = () => {
    if (open) hunks.push(open);
    open = null;
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      close();
      i++;
      j++;
    } else if (
      j < b.length &&
      (i === a.length || table[i * width + j + 1] >= table[(i + 1) * width + j])
    ) {
      open ??= { start: i, end: i };
      j++;
    } else {
      open ??= { start: i, end: i };
      i++;
      open.end = i;
    }
  }
  close();
  return hunks;
}

/**
 * Pairs of hunks that touch the same or adjacent base lines. Git reports such
 * edits as conflicts, so adjacency counts as an overlap here too.
 */
export function overlappingHunks(left: Hunk[], right: Hunk[]): { left: Hunk; right: Hunk }[] {
  const overlaps: { left: Hunk; right: Hunk }[] = [];
  for (const a of left)
    for (const b of right)
      if (a.start <= b.end && b.start <= a.end) overlaps.push({ left: a, right: b });
  return overlaps;
}
