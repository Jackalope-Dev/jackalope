import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { cutRelease } from './cut-release.mjs';
import { gitAt, gitEnvironment } from './prepare-release.mjs';

async function repository(t) {
  const base = await mkdtemp(resolve(tmpdir(), 'jackalope-release-cut-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const remote = resolve(base, 'origin.git');
  const directory = resolve(base, 'source');
  await mkdir(directory);
  execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe', env: gitEnvironment() });
  const git = gitAt(directory);
  git('init', '-b', 'master');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', resolve(base, 'no-hooks'));
  const files = {
    '.gitignore': '.worktrees/\n',
    'package.json': '{"version":"0.1.0"}',
    'apps/desktop/package.json': '{"version":"0.1.0"}',
    'apps/desktop/src-tauri/tauri.conf.json': '{"version":"0.1.0"}',
    'apps/desktop/src-tauri/Cargo.toml': 'version = "0.1.0"\n',
    'apps/desktop/src-tauri/Cargo.lock': 'name = "jackalope-desktop"\nversion = "0.1.0"\n',
    'app.txt': 'base\n',
  };
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(dirname(resolve(directory, file)), { recursive: true });
    await writeFile(resolve(directory, file), contents);
  }
  git('add', '.');
  git('commit', '-m', 'Fixture baseline');
  git('branch', 'beta');
  git('branch', 'stable');
  git('remote', 'add', 'origin', remote);
  git('push', 'origin', 'master', 'beta', 'stable');
  return { directory, git };
}

test('cuts beta and stable snapshots without committing, advancing master or taking later development', async (t) => {
  const { directory, git } = await repository(t);
  await writeFile(resolve(directory, 'beta-feature.txt'), 'tested feature');
  git('add', '.');
  git('commit', '-m', 'Fixture feature');
  git('push', 'origin', 'master');
  git('tag', 'store-stable/v2.0.0');
  git('push', 'origin', 'refs/tags/store-stable/v2.0.0');
  const master = git('rev-parse', 'HEAD');
  await writeFile(resolve(directory, 'local-only.txt'), 'unfinished development');
  const beta = await cutRelease(directory, 'beta', 'patch');
  assert.equal(beta.version, '2.0.1');
  const betaGit = gitAt(beta.path);
  assert.equal(betaGit('rev-parse', 'HEAD'), beta.destination);
  assert.equal(betaGit('rev-parse', 'MERGE_HEAD'), master);
  assert.equal(git('rev-parse', 'HEAD'), master);
  assert.equal(git('rev-parse', 'origin/beta'), beta.destination);
  assert.match(git('status', '--porcelain'), /local-only/);
  assert.match(await readFile(resolve(beta.path, 'releases/2.0.1.md'), 'utf8'), /Status: draft/);
  await assert.rejects(readFile(resolve(beta.path, 'local-only.txt')));
  betaGit('add', '.');
  betaGit('commit', '-m', 'Fixture beta release');
  betaGit('push', 'origin', 'HEAD:beta');
  const betaSource = betaGit('rev-parse', 'HEAD');
  await writeFile(resolve(directory, 'later-development.txt'), 'not accepted yet');
  git('add', 'later-development.txt');
  git('commit', '-m', 'Fixture later development');
  git('push', 'origin', 'master');
  const stable = await cutRelease(directory, 'stable', 'patch');
  assert.equal(stable.version, '2.0.2');
  assert.equal(stable.source, betaSource);
  assert.equal(await readFile(resolve(stable.path, 'beta-feature.txt'), 'utf8'), 'tested feature');
  await assert.rejects(readFile(resolve(stable.path, 'later-development.txt')));
  assert.equal(gitAt(stable.path)('rev-parse', 'HEAD'), stable.destination);
  await assert.rejects(cutRelease(directory, 'beta', '1.0.0'), /higher release version/);
  await assert.rejects(cutRelease(directory, 'master', 'patch'), /Channel/);
});

test('conflicting cuts preserve both branches and leave the isolated merge for resolution', async (t) => {
  const { directory, git } = await repository(t);
  git('switch', 'beta');
  await writeFile(resolve(directory, 'app.txt'), 'beta fix\n');
  git('add', '.');
  git('commit', '-m', 'Fixture beta fix');
  git('push', 'origin', 'beta');
  const previous = git('rev-parse', 'HEAD');
  git('switch', 'master');
  await writeFile(resolve(directory, 'app.txt'), 'master change\n');
  git('add', '.');
  git('commit', '-m', 'Fixture master change');
  git('push', 'origin', 'master');
  await assert.rejects(cutRelease(directory, 'beta', 'patch'), /Resolve and stage conflicts/);
  const cut = resolve(directory, '.worktrees/release-beta-0.1.1');
  assert.equal(gitAt(cut)('rev-parse', 'HEAD'), previous);
  assert.equal(git('rev-parse', 'origin/beta'), previous);
  const conflict = await readFile(resolve(cut, 'app.txt'), 'utf8');
  assert.match(conflict, /beta fix/);
  assert.match(conflict, /master change/);
  await assert.rejects(readFile(resolve(cut, 'releases/0.1.1.md')));
});
