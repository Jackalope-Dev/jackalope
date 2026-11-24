/** One occurrence of the query: which row, which searchable part of it, and which occurrence there. */
export interface TranscriptMatch {
  row: number;
  part: number;
  nth: number;
}

/** Counting stops here so a one-letter query over a long transcript stays responsive. */
export const MATCH_LIMIT = 5_000;

/**
 * Lowercases for case-insensitive matching when that keeps every character's offset, so
 * a match found here maps straight onto the rendered text; null when it would not.
 */
export function foldCase(text: string) {
  const lower = text.toLowerCase();
  return lower.length === text.length ? lower : null;
}

/** Start offsets of `needle` in `haystack`, without overlaps, at most `limit` of them. */
export function occurrences(haystack: string, needle: string, limit = Number.POSITIVE_INFINITY) {
  const starts: number[] = [];
  if (!needle) return starts;
  let from = 0;
  while (starts.length < limit) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    starts.push(at);
    from = at + needle.length;
  }
  return starts;
}

/** Case-insensitive occurrences where folding keeps offsets, otherwise exact ones. */
function search(text: string, needle: string, limit?: number) {
  const haystack = foldCase(text);
  const folded = foldCase(needle);
  return haystack !== null && folded !== null
    ? occurrences(haystack, folded, limit)
    : occurrences(text, needle, limit);
}

/**
 * Searches each row's text parts in order: the data, not what happens to be rendered.
 * A part that is not loaded yet (null) counts the occurrences `unloaded` reports for its
 * row, so find also covers text that only the native side holds.
 */
export function findMatches(
  rows: readonly (readonly (string | null)[])[],
  query: string,
  unloaded?: ReadonlyMap<number, number>,
) {
  const needle = query.trim();
  const matches: TranscriptMatch[] = [];
  if (!needle) return { matches, truncated: false };
  for (let row = 0; row < rows.length; row++) {
    const parts = rows[row];
    for (let part = 0; part < parts.length; part++) {
      const text = parts[part];
      const count =
        text === null
          ? Math.min(unloaded?.get(row) ?? 0, MATCH_LIMIT - matches.length)
          : text
            ? search(text, needle, MATCH_LIMIT - matches.length).length
            : 0;
      for (let nth = 0; nth < count; nth++) matches.push({ row, part, nth });
      if (matches.length >= MATCH_LIMIT) return { matches, truncated: true };
    }
  }
  return { matches, truncated: false };
}

/**
 * Where a new search starts: the first match in `row` or after it, else the nearest one
 * before it, since a conversation is usually read from its end. -1 without matches.
 */
export function firstMatchFrom(matches: readonly TranscriptMatch[], row: number) {
  const index = matches.findIndex((match) => match.row >= row);
  return index < 0 ? matches.length - 1 : index;
}

/** The next or previous match, wrapping at either end. */
export function stepMatch(current: number, total: number, direction: 1 | -1) {
  if (!total) return -1;
  if (current < 0) return direction === 1 ? 0 : total - 1;
  return (current + direction + total) % total;
}

/** "3 of 12", "1 of 5,000+" or "No matches" for the find bar's status. */
export function matchLabel(current: number, total: number, truncated: boolean) {
  if (!total) return 'No matches';
  const count = `${total.toLocaleString()}${truncated ? '+' : ''}`;
  return current < 0 ? `${count} matches` : `${(current + 1).toLocaleString()} of ${count}`;
}

/**
 * Where the rendered text of `element` contains `query`, as DOM ranges. Matching uses the
 * same case folding as `findMatches`, so the nth range lines up with the nth data match
 * whenever the text renders as written.
 */
export function textRanges(element: Element, query: string, limit = 500): Range[] {
  const needle = query.trim();
  if (!needle) return [];
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const offsets: number[] = [];
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
    offsets.push(text.length);
    text += (node as Text).data;
  }
  const starts = search(text, needle, limit);
  // Finds the text node holding `offset`; `end` prefers the node a match ends in.
  const locate = (offset: number, end: boolean) => {
    let low = 0;
    let high = nodes.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (offsets[middle] < offset || (!end && offsets[middle] === offset)) low = middle;
      else high = middle - 1;
    }
    return { node: nodes[low], offset: offset - offsets[low] };
  };
  return starts.map((start) => {
    const range = document.createRange();
    const from = locate(start, false);
    const to = locate(start + needle.length, true);
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  });
}
