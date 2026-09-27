/** A published release's notes, as shown after updating. */
export interface ReleaseNotes {
  version: string;
  sections: { title: string; items: string[] }[];
}

/** Sections worth showing someone who just updated; known issues stay in the file. */
const SHOWN = ['Highlights', 'Improvements', 'Fixes'];

/**
 * Parses a `releases/<version>.md` file: `## Section` headings with `- item`
 * bullets, continuation lines joined. Returns null for a draft or an empty file.
 */
export function parseReleaseNotes(version: string, markdown: string): ReleaseNotes | null {
  if (!/^Status:\s*ready\s*$/im.test(markdown)) return null;
  const sections: ReleaseNotes['sections'] = [];
  let current: ReleaseNotes['sections'][number] | null = null;
  for (const raw of markdown.split('\n')) {
    const heading = raw.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = SHOWN.includes(heading[1]) ? { title: heading[1], items: [] } : null;
      if (current) sections.push(current);
      continue;
    }
    if (!current) continue;
    const bullet = raw.match(/^-\s+(.*)$/);
    if (bullet) current.items.push(bullet[1].trim());
    else if (raw.trim() && current.items.length)
      current.items[current.items.length - 1] += ` ${raw.trim()}`;
  }
  const shown = sections.filter(
    (section) => section.items.length && !section.items.every((item) => /^TODO\b/.test(item)),
  );
  return shown.length ? { version, sections: shown } : null;
}

/**
 * Whether to show what changed in `current`. Someone who finished setup before
 * this was tracked (`seen` unset) has updated; a fresh install has not.
 */
export function shouldShowReleaseNotes(
  current: string,
  seen: string | null,
  setupComplete: boolean,
): boolean {
  if (seen === null) return setupComplete;
  return seen !== current;
}
