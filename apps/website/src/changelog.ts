/** The first beta or stable release whose source contained an entry. */
export type ReleasePoint = { version: string; date: string };
type EntryReleases = { beta?: ReleasePoint; stable?: ReleasePoint };
/** Entry id to releases, computed from beta-v* and stable-v* tags at build time. */
export type ReleaseMap = Record<string, EntryReleases>;
type ReleaseState = 'website' | 'coming-soon' | 'beta' | 'released';

const labels: Record<ReleaseState, string> = {
  website: 'Website',
  'coming-soon': 'Coming soon',
  beta: 'In beta',
  released: 'Released',
};

const point = (value: unknown): ReleasePoint | undefined => {
  const candidate = value as Partial<ReleasePoint> | undefined;
  return typeof candidate?.version === 'string' &&
    /^\d+\.\d+\.\d+$/.test(candidate.version) &&
    typeof candidate.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(candidate.date)
    ? { version: candidate.version, date: candidate.date }
    : undefined;
};

/**
 * Adds release state to source entries. Status is never written by hand: an app
 * entry reads Released once a stable tag contains it, In beta once a beta tag
 * does, and Coming soon until then, including when release data is missing.
 * Website entries describe this site and stay outside the app lifecycle.
 */
export function withReleases<T extends { id: string; kind?: string }>(
  entries: readonly T[],
  releases: ReleaseMap,
) {
  return entries.map((entry) => {
    const kind: 'app' | 'website' = entry.kind === 'website' ? 'website' : 'app';
    const known = kind === 'app' && Object.hasOwn(releases, entry.id) ? releases[entry.id] : {};
    const release: EntryReleases = {};
    const beta = point(known?.beta);
    const stable = point(known?.stable);
    if (beta) release.beta = beta;
    if (stable) release.stable = stable;
    const state: ReleaseState =
      kind === 'website' ? 'website' : stable ? 'released' : beta ? 'beta' : 'coming-soon';
    const version = state === 'released' ? stable?.version : state === 'beta' ? beta?.version : '';
    return {
      ...entry,
      kind,
      state,
      status: labels[state],
      ...(version ? { version } : {}),
      ...(beta || stable ? { release } : {}),
    };
  });
}
