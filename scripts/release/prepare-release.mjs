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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3)
    throw new Error('Usage: pnpm release:prepare patch|minor|major|VERSION');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  if (!['master', 'beta'].includes(git('branch', '--show-current')))
    throw new Error('Prepare releases on master (stable) or beta');
  if (git('status', '--porcelain', '--untracked-files=normal'))
    throw new Error('Review and commit existing changes before preparing a release');
  const current = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
  await assertVersions(current);
  await prepare(nextVersion(current, process.argv[2]));
}
