import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(new URL('./git-hooks.mjs', import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'jackalope-hook-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, CI: '', LEFTHOOK: '', NODE_ENV: 'test' };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  const run = (command, args, options = {}) =>
    spawnSync(command, args, { cwd: root, env, encoding: 'utf8', windowsHide: true, ...options });
  const git = (...args) => {
    const result = run('git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git('init', '--quiet');
  git('config', 'core.autocrlf', 'false');
  copyFileSync(new URL('../biome.json', import.meta.url), join(root, 'biome.json'));
  copyFileSync(new URL('../lefthook.yml', import.meta.url), join(root, 'lefthook.yml'));
  mkdirSync(join(root, 'scripts'));
  writeFileSync(
    join(root, 'scripts/git-hooks.mjs'),
    `import ${JSON.stringify(pathToFileURL(script).href)};\n`,
  );
  const write = (file, content) => writeFileSync(join(root, file), content);
  const hook = (...args) => run(process.execPath, [script, ...args]);
  const lefthook = (args, options) =>
    run(
      process.execPath,
      [
        fileURLToPath(new URL('../node_modules/lefthook/bin/index.js', import.meta.url)),
        'run',
        ...args,
      ],
      options,
    );
  return { root, run, git, write, hook, lefthook };
}

test('staged checks reject an invalid index even when the working file is fixed', (t) => {
  const { root, git, write, hook } = fixture(t);
  write('sample file.ts', 'export const value=1;\n');
  git('add', 'sample file.ts');
  const index = readFileSync(join(root, '.git/index'));
  write('sample file.ts', 'export const value = 1;\n');
  const result = hook('staged');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Staged Biome checks failed/);
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
  assert.equal(readFileSync(join(root, 'sample file.ts'), 'utf8'), 'export const value = 1;\n');
});

test('staged checks accept a valid index without changing unstaged edits', (t) => {
  const { root, git, write, hook } = fixture(t);
  write('sample file.ts', 'export const value = 1;\n');
  git('add', 'sample file.ts');
  const index = readFileSync(join(root, '.git/index'));
  write('sample file.ts', 'export const value=2;\n');
  const result = hook('staged');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(join(root, '.git/index')), index);
  assert.equal(readFileSync(join(root, 'sample file.ts'), 'utf8'), 'export const value=2;\n');
});

test('staged whitespace is checked even for files Biome does not support', (t) => {
  const { git, write, hook } = fixture(t);
  write('notes.md', 'text \t\n');
  git('add', 'notes.md');
  const result = hook('staged');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /trailing whitespace/);
});

test('empty indexes and unsupported files do not invoke Biome', (t) => {
  const { git, write, hook } = fixture(t);
  assert.equal(hook('staged').status, 0);
  write('notes.md', '# Notes\n');
  git('add', 'notes.md');
  assert.equal(hook('staged').status, 0);
});

test('install preserves a local hook and its arguments, stdin and failure result', (t) => {
  const { root, run, write, hook } = fixture(t);
  mkdirSync(join(root, '.git/hooks'), { recursive: true });
  const original = '#!/bin/sh\nprintf "%s\\n" "$1" "$2"\ncat\nexit 7\n';
  write('.git/hooks/pre-push', original);
  const result = hook('install');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(root, '.git/hooks/pre-push.before-lefthook'), 'utf8'), original);
  assert.match(readFileSync(join(root, '.git/hooks/pre-push'), 'utf8'), /call_lefthook run/);
  const repeated = hook('install');
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(readFileSync(join(root, '.git/hooks/pre-push.before-lefthook'), 'utf8'), original);
  const preserved = run(
    process.execPath,
    [script, 'preserved', 'pre-push', 'origin', 'test remote'],
    {
      input: 'refs/heads/master abc refs/heads/master def\n',
    },
  );
  assert.equal(preserved.status, 7, preserved.stderr);
  assert.match(preserved.stdout, /origin\ntest remote\nrefs\/heads\/master abc/);
});

test('installation refuses to overwrite a custom hooks path', (t) => {
  const { git, hook } = fixture(t);
  git('config', 'core.hooksPath', '.custom-hooks');
  const result = hook('install');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /manual integration/);
  assert.equal(git('config', '--get', 'core.hooksPath').trim(), '.custom-hooks');
});

test('Lefthook executes staged checks and propagates their failures', (t) => {
  const { git, write, lefthook } = fixture(t);
  write('sample.ts', 'export const value = 1;\n');
  git('add', 'sample.ts');
  const valid = lefthook(['pre-commit']);
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  write('sample.ts', 'export const value=1;\n');
  git('add', 'sample.ts');
  const invalid = lefthook(['pre-commit']);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stdout + invalid.stderr, /Staged Biome checks failed/);
});

test('Lefthook forwards push refs and stops before verification on a dirty checkout', (t) => {
  const { root, git, lefthook } = fixture(t);
  const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
  const sourceGit = (...args) => {
    const result = spawnSync('git', args, { cwd: sourceRoot, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const objects = sourceGit('rev-parse', '--path-format=absolute', '--git-path', 'objects');
  writeFileSync(join(root, '.git/objects/info/alternates'), `${objects}\n`);
  const head = sourceGit('rev-parse', 'HEAD');
  git('update-ref', 'HEAD', head);
  const result = lefthook(['pre-push', 'origin', 'test-remote'], {
    input: `refs/heads/master ${head} refs/heads/master ${'0'.repeat(40)}\n`,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /require a clean checkout/);
  assert.doesNotMatch(result.stdout + result.stderr, /ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND/);
});
