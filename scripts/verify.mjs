import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pnpm = process.env.npm_execpath;
if (!pnpm || !/\.[cm]?js$/i.test(pnpm)) throw new Error('Run this check with pnpm verify.');

const userCargo = process.env.USERPROFILE
  ? join(process.env.USERPROFILE, '.cargo', 'bin', 'cargo.exe')
  : null;
const cargo = userCargo && existsSync(userCargo) ? userCargo : 'cargo';
const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => !['--native-only', '--changed'].includes(arg)))
  throw new Error('Usage: pnpm verify [--native-only | --changed]');
const nativeOnly = args.includes('--native-only');

// Keep the machine responsive while checks run; child processes inherit this.
if (process.env.JACKALOPE_VERIFY_PRIORITY !== 'normal') {
  try {
    setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {}
}

/**
 * Files the native build or its tests read. Anything else cannot change a Rust
 * result, and Rust sources cannot change a JavaScript one.
 */
const NATIVE_INPUTS = [
  /^apps\/desktop\/src-tauri\//,
  /^apps\/desktop\/icons\//,
  /^apps\/desktop\/src\/lib\/agent-capabilities\.json$/,
  /^\.cargo\//,
  /^rust-toolchain/,
  /^package\.json$/,
  /^pnpm-(lock|workspace)\.yaml$/,
  /^scripts\/verify\.mjs$/,
];

/**
 * With --changed, which halves of the gate the commits since the upstream
 * branch can affect. Unknown history runs everything; CI always runs everything.
 */
function changedScope() {
  if (!args.includes('--changed')) return { shared: true, native: true };
  const git = (...gitArgs) =>
    spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8', windowsHide: true });
  const upstream =
    git('rev-parse', '--verify', '--quiet', '@{upstream}').status === 0
      ? '@{upstream}'
      : 'origin/master';
  const base = git('merge-base', 'HEAD', upstream);
  const diff = base.status === 0 ? git('diff', '--name-only', base.stdout.trim(), 'HEAD') : null;
  const files = diff?.status === 0 ? diff.stdout.split('\n').filter(Boolean) : [];
  if (!files.length) return { shared: true, native: true };
  const native = files.some((file) => NATIVE_INPUTS.some((input) => input.test(file)));
  const shared = files.some((file) => !file.startsWith('apps/desktop/src-tauri/'));
  console.log(
    `Checking ${files.length} changed files since ${upstream}: ${[
      shared && 'JavaScript and shared checks',
      native && 'native checks',
    ]
      .filter(Boolean)
      .join(' and ')}.`,
  );
  return { shared, native };
}
const scope = changedScope();

const sharedChecks = [
  [process.execPath, ['scripts/evaluation/website.mjs', '--check']],
  [process.execPath, ['scripts/knowledge.mjs', '--check']],
  [process.execPath, [pnpm, 'check']],
  [process.execPath, [pnpm, 'knip']],
  [process.execPath, [pnpm, 'typecheck']],
  [process.execPath, [pnpm, 'test:hooks']],
  [process.execPath, ['--test', 'scripts/docs-policy.test.mjs']],
  [process.execPath, [pnpm, 'check:docs']],
  [process.execPath, [pnpm, 'check:tokens']],
  [process.execPath, [pnpm, 'check:changelog']],
  [process.execPath, [pnpm, 'test:release']],
  [process.execPath, [pnpm, 'ui:build']],
  [process.execPath, [pnpm, '--filter', '@jackalope/server', 'types']],
  [process.execPath, [pnpm, '--filter', '@jackalope/server', 'typecheck']],
  [process.execPath, [pnpm, '--filter', '@jackalope/server', 'test']],
  [process.execPath, [pnpm, '--filter', '@jackalope/server', 'build']],
  [process.execPath, [pnpm, 'build']],
  [
    process.execPath,
    [
      pnpm,
      '--filter',
      '@jackalope/server',
      'exec',
      'wrangler',
      'deploy',
      '--config',
      '../website/wrangler.jsonc',
      '--dry-run',
    ],
  ],
];
const nativeChecks = [
  [process.execPath, [pnpm, '--filter', '@jackalope/desktop', 'test']],
  [cargo, ['fmt', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', '--check']],
  // The terminal command is a separate binary; without `--bin` a change that
  // breaks only it would still pass. One invocation compiles both in parallel.
  [
    cargo,
    [
      'test',
      '--locked',
      '--manifest-path',
      'apps/desktop/src-tauri/Cargo.toml',
      '--lib',
      '--bin',
      'jackalope',
      '--no-default-features',
    ],
  ],
];
const desktopScripts = nativeChecks.shift();
const checks = [
  [process.execPath, ['scripts/security/dependencies.mjs', '--patch-only']],
  ...(!nativeOnly && scope.shared ? sharedChecks : []),
  ...(scope.shared || nativeOnly ? [desktopScripts] : []),
  ...(scope.native ? nativeChecks : []),
];
// A Git hook exports the repository it runs for, and in a linked worktree that
// includes GIT_DIR. Checks that build fixture repositories would otherwise commit
// into this repository instead of their own, so they resolve Git from `cwd`.
const environment = { ...process.env };
for (const key of Object.keys(environment))
  if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|PREFIX)$/.test(key))
    delete environment[key];
for (const [command, args] of checks) {
  const started = performance.now();
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  if (result.status !== 0) {
    console.error(`Check failed after ${seconds}s (exit ${result.status ?? 1}).`);
    process.exit(result.status ?? 1);
  }
  console.log(`Check passed in ${seconds}s.`);
}
