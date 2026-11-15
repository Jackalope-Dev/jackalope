import { spawnSync } from 'node:child_process';
import { root } from '../lib/paths.mjs';

export const changelogPath = 'apps/website/src/changelog.json';
const publicRemote = 'https://github.com/Jackalope-Dev/jackalope.git';
const releaseTag = /^(beta|stable)-v(\d+)\.(\d+)\.(\d+)$/;

export function gitRunner(cwd = root) {
  return (args) => {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
    });
    return { status: result.error ? 1 : result.status, stdout: result.stdout ?? '' };
  };
}

/** Release tags sorted oldest version first. Store tags mirror these and are ignored. */
export function releaseTags(git) {
  const listed = git([
    'for-each-ref',
    '--format=%(refname:short)%09%(creatordate:short)',
    'refs/tags/beta-v*',
    'refs/tags/stable-v*',
  ]);
  if (listed.status !== 0) throw new Error('Cannot list release tags');
  return listed.stdout
    .split('\n')
    .map((line) => line.trim().split('\t'))
    .map(([name, date]) => ({ name, date, match: releaseTag.exec(name ?? '') }))
    .filter(({ match, date }) => match && /^\d{4}-\d{2}-\d{2}$/.test(date ?? ''))
    .map(({ name, date, match }) => ({
      name,
      date,
      channel: match[1],
      version: `${match[2]}.${match[3]}.${match[4]}`,
      order: [Number(match[2]), Number(match[3]), Number(match[4])],
    }))
    .sort(
      (a, b) =>
        a.order[0] - b.order[0] ||
        a.order[1] - b.order[1] ||
        a.order[2] - b.order[2] ||
        a.name.localeCompare(b.name),
    );
}

/**
 * The changelog ids a release tag shipped. Entries are append-only, so an id in
 * the file at a tag means the commit that added it is an ancestor of that tag.
 * Reading the file at the tag needs only the tag's own tree, not the history.
 */
export function idsAtTag(git, tag) {
  const listed = git(['ls-tree', '--name-only', tag, '--', changelogPath]);
  if (listed.status !== 0) throw new Error(`Cannot read ${tag}`);
  if (!listed.stdout.trim()) return new Set();
  const shown = git(['show', `${tag}:${changelogPath}`]);
  if (shown.status !== 0) throw new Error(`Cannot read the changelog at ${tag}`);
  const entries = JSON.parse(shown.stdout);
  if (!Array.isArray(entries)) throw new Error(`The changelog at ${tag} is not a list`);
  return new Set(entries.map((entry) => entry?.id).filter((id) => typeof id === 'string'));
}

/** Maps each changelog id to the first beta and first stable release that contained it. */
export function releaseMap(git) {
  const tags = releaseTags(git);
  const releases = {};
  for (const tag of tags)
    for (const id of idsAtTag(git, tag.name)) {
      releases[id] ??= {};
      releases[id][tag.channel] ??= { version: tag.version, date: tag.date };
    }
  return { tags: tags.length, releases };
}

/**
 * Brings release tags into a checkout that may be shallow or tagless, such as a
 * Cloudflare build. Only the tag tips are fetched; a full clone stays unshallow.
 */
export function fetchReleaseTags(git, remotes = ['origin', publicRemote]) {
  const shallow = git(['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true';
  for (const remote of remotes) {
    const fetched = git([
      'fetch',
      '--quiet',
      '--no-tags',
      ...(shallow ? ['--depth=1'] : []),
      remote,
      '+refs/tags/beta-v*:refs/tags/beta-v*',
      '+refs/tags/stable-v*:refs/tags/stable-v*',
    ]);
    if (fetched.status === 0) return true;
  }
  return false;
}

/**
 * Reads release state for every changelog entry. A missing tag can only make an
 * entry read Coming soon, never Released, but a build that cannot see any
 * release tags stops unless `required` is off.
 */
export function changelogReleases({
  git = gitRunner(),
  fetch = false,
  remotes = undefined,
  required = false,
  warn = console.warn,
} = {}) {
  const fetched = fetch ? fetchReleaseTags(git, remotes) : true;
  let result;
  try {
    result = releaseMap(git);
  } catch (error) {
    if (required) throw error;
    warn(`Changelog: ${error.message}; every app entry reads Coming soon.`);
    return {};
  }
  if (!result.tags) {
    const reason = fetched
      ? 'No beta-v* or stable-v* tags exist'
      : 'Release tags could not be fetched and none exist locally';
    if (required)
      throw new Error(
        `${reason}. Fetch tags, or set CHANGELOG_RELEASES=skip to build with every app entry as Coming soon.`,
      );
    warn(`Changelog: ${reason}; every app entry reads Coming soon.`);
  } else if (!fetched) warn('Changelog: release tags could not be fetched; using local tags.');
  return result.releases;
}

if (import.meta.main) {
  const releases = changelogReleases({
    fetch: process.argv.includes('--fetch'),
    required: process.argv.includes('--require'),
  });
  process.stdout.write(`${JSON.stringify(releases)}\n`);
}
