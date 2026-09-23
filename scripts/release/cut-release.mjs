import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertVersions, channel, prepare, root } from './catalog.mjs';
import { gitAt, nextVersion, versionFloor } from './prepare-release.mjs';

export async function cutRelease(directory, target, bump, source) {
  channel(target);
  source ??= target === 'beta' ? 'origin/master' : 'origin/beta';
  if (
    !source ||
    source.startsWith('-') ||
    /\s/.test(source) ||
    source.includes(String.fromCharCode(0))
  )
    throw new Error('Use a source branch, tag or commit');
  const git = gitAt(directory);
  git('fetch', 'origin', '--prune', '--tags');
  const revision = git('rev-parse', '--verify', `${source}^{commit}`);
  const destination = git('rev-parse', '--verify', `refs/remotes/origin/${target}^{commit}`);
  const trusted = ['master', 'beta', 'stable'].some((branch) => {
    try {
      git('merge-base', '--is-ancestor', revision, `refs/remotes/origin/${branch}`);
      return true;
    } catch {
      return false;
    }
  });
  if (!trusted) throw new Error('Source must belong to a fetched master, beta or stable branch');
  const current = JSON.parse(git('show', `${revision}:package.json`)).version;
  const next = nextVersion(versionFloor(git, current), bump);
  const branch = `release/${target}/${next}`;
  const path = resolve(directory, '.worktrees', `release-${target}-${next}`);
  git('worktree', 'add', '-b', branch, path, destination);
  const cutGit = gitAt(path);
  try {
    cutGit('merge', '--no-commit', '--no-ff', revision);
  } catch (error) {
    throw new Error(
      `Release merge stopped in ${path}. Resolve and stage conflicts without discarding either branch's changes, then run pnpm release:prepare ${next} --merged there. No commit or push was made.`,
      { cause: error },
    );
  }
  const mergedVersion = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8')).version;
  await assertVersions(mergedVersion, path);
  await prepare(next, path);
  console.log(
    `Prepared ${branch} in ${path}\nSource: ${revision}\nPrevious ${target}: ${destination}\nReview the merge and release notes, mark them ready, and run pnpm install --frozen-lockfile and pnpm verify. Commit yourself, then push HEAD:${target} or open a PR targeting ${target} and retain merge history.`,
  );
  return { path, branch, version: next, source: revision, destination };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, bump = 'patch', source, ...extra] = process.argv.slice(2);
  if (!target || extra.length)
    throw new Error('Usage: pnpm release:cut beta|stable [patch|minor|major|VERSION] [SOURCE]');
  await cutRelease(root, target, bump, source);
}
