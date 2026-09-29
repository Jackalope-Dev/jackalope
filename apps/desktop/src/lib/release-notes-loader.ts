import { parseReleaseNotes, type ReleaseNotes } from './release-notes';

// Release cuts add releases/<version>.md before building, so each build carries
// the notes for its own version. Loaded on demand; most launches never ask.
const files = import.meta.glob<string>('../../../../releases/*.md', {
  query: '?raw',
  import: 'default',
});

export async function loadReleaseNotes(version: string): Promise<ReleaseNotes | null> {
  const load = Object.entries(files).find(([path]) => path.endsWith(`/${version}.md`))?.[1];
  return load ? parseReleaseNotes(version, await load()) : null;
}
