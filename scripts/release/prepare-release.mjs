import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertVersions, compare, prepare, root, version } from './catalog.mjs';

export function nextVersion(current, bump) {
  const parts = version(current).split('.').map(BigInt);
  const index = ['major', 'minor', 'patch'].indexOf(bump);
  if (index === -1) {
    if (compare(version(bump), current) <= 0) throw new Error('Use a higher release version');
    return bump;
  }
  parts[index]++;
  for (let i = index + 1; i < parts.length; i++) parts[i] = 0n;
  return version(parts.join('.'));
}

/**
 * The environment without the repository a Git hook exported, so commands act on
 * `cwd` rather than the repository whose hook launched this script.
 */
export function gitEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|PREFIX)$/.test(key))
      delete env[key];
  return env;
}

export const gitAt =
  (directory) =>
  (...args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      windowsHide: true,
      env: gitEnvironment(),
    }).trim();

export function versionFloor(git, current) {
  let highest = version(current);
  const consider = (value) => {
    if (compare(value, highest) > 0) highest = value;
  };
  for (const branch of ['master', 'beta', 'stable']) {
    const ref = `refs/remotes/origin/${branch}`;
    if (git('for-each-ref', '--format=%(refname)', ref))
      consider(JSON.parse(git('show', `${ref}:package.json`)).version);
  }
  for (const tag of git('tag', '--list').split('\n')) {
    const match = /^(?:(?:beta|stable)-v|store-(?:beta|stable)\/v)(\d+\.\d+\.\d+)$/.exec(tag);
    if (match) consider(version(match[1]));
  }
  return highest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [bump, merged, ...extra] = process.argv.slice(2);
  if (!bump || (merged && merged !== '--merged') || extra.length)
    throw new Error('Usage: pnpm release:prepare patch|minor|major|VERSION [--merged]');
  const git = gitAt(root);
  if (!/^(beta|stable|release\/(beta|stable)\/[^/]+)$/.test(git('branch', '--show-current')))
    throw new Error('Prepare releases on beta, stable or a release/channel/version branch');
  if (merged) {
    git('rev-parse', '--verify', 'MERGE_HEAD');
    if (git('diff', '--name-only', '--diff-filter=U'))
      throw new Error('Resolve and stage merge conflicts before preparing the release');
  } else if (git('status', '--porcelain', '--untracked-files=normal'))
    throw new Error('Review and commit existing changes before preparing a release');
  const current = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
  await assertVersions(current);
  await prepare(nextVersion(versionFloor(git, current), bump));
}
