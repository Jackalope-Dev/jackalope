import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const dependency = (file) => fileURLToPath(new URL(`../node_modules/${file}`, import.meta.url));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout;
}

function git(args) {
  return run('git', args, { stdio: 'pipe', encoding: 'utf8' });
}

function hookPath(hook) {
  return resolve(root, git(['rev-parse', '--git-path', `hooks/${hook}`]).trim());
}

function install() {
  if (process.env.CI || process.env.NODE_ENV === 'production' || process.env.LEFTHOOK === '0')
    return;
  if (!existsSync(resolve(root, '.git'))) return;
  const customPath = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (customPath.error) throw customPath.error;
  if (customPath.status !== 1) {
    throw new Error(
      'An existing core.hooksPath needs manual integration before installing Lefthook.',
    );
  }
  for (const hook of ['pre-commit', 'pre-push']) {
    const path = hookPath(hook);
    if (!existsSync(path)) continue;
    const source = readFileSync(path, 'utf8');
    if (source.includes('call_lefthook run')) continue;
    const backup = `${path}.before-lefthook`;
    if (existsSync(backup) && readFileSync(backup, 'utf8') !== source) {
      throw new Error(`Cannot replace a different preserved hook: ${backup}`);
    }
    copyFileSync(path, backup);
  }
  run(process.execPath, [dependency('lefthook/bin/index.js'), 'install']);
}

function preserved(hook, args, input) {
  if (!['pre-commit', 'pre-push'].includes(hook)) throw new Error('Unsupported Git hook.');
  const path = `${hookPath(hook)}.before-lefthook`;
  if (!existsSync(path)) return;
  const gitShell = resolve(git(['--exec-path']).trim(), '../../../bin/sh.exe');
  const shell = process.platform === 'win32' && existsSync(gitShell) ? gitShell : 'sh';
  run(
    shell,
    [path, ...args],
    input === undefined ? {} : { input, stdio: ['pipe', 'inherit', 'inherit'] },
  );
}

function push(args) {
  const input = readFileSync(0, 'utf8');
  preserved('pre-push', args, input);
  const revisions = input
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/)[1]);
  const pushed = revisions.filter((revision) => !/^0+$/.test(revision));
  if (!pushed.length) return;
  if (git(['status', '--porcelain', '--untracked-files=normal']).trim()) {
    throw new Error(
      'Push checks require a clean checkout so validation matches the committed code. Finish committing your intended changes or push from a clean worktree. No files were changed.',
    );
  }
  const head = git(['rev-parse', 'HEAD']).trim();
  for (const revision of pushed) {
    if (!revision || git(['rev-parse', '--verify', `${revision}^{commit}`]).trim() !== head) {
      throw new Error(
        'Push checks can only validate the checked-out commit. Check out the branch or tag being pushed first.',
      );
    }
  }
}

function staged() {
  run('git', ['diff', '--cached', '--check']);
  const files = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .split('\0')
    .filter((file) => /\.(?:[cm]?[jt]sx?|jsonc?|css|graphql|gql)$/.test(file));
  for (const file of files) {
    // Read the index so an unstaged fix cannot hide a broken partial commit.
    const content = git(['show', `:${file}`]);
    const checked = run(
      process.execPath,
      [
        dependency('@biomejs/biome/bin/biome'),
        'check',
        '--write',
        '--error-on-warnings',
        `--stdin-file-path=${file}`,
      ],
      { input: content, stdio: ['pipe', 'pipe', 'inherit'], encoding: 'utf8' },
    );
    if (checked !== content) {
      console.error(
        `Staged Biome checks failed for ${file}. Format/fix the file and stage the intended changes again.`,
      );
      process.exit(1);
    }
  }
  console.log(`Staged checks passed (${files.length} supported files).`);
}

const [action, ...args] = process.argv.slice(2);
if (action === 'install') install();
else if (action === 'preserved') preserved(args[0], args.slice(1));
else if (action === 'push') push(args);
else if (action === 'staged') staged();
else throw new Error('Expected install, preserved or staged.');
