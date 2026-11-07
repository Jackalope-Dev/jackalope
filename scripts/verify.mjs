import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';
import { affected, changedFiles } from './change-scope.mjs';
import { gitEnvironment } from './lib/git-environment.mjs';
import { root } from './lib/paths.mjs';

const pnpm = process.env.npm_execpath;
if (!pnpm || !/\.[cm]?js$/i.test(pnpm)) throw new Error('Run this check with pnpm verify.');

const userCargo = process.env.USERPROFILE
  ? join(process.env.USERPROFILE, '.cargo', 'bin', 'cargo.exe')
  : null;
const cargo = userCargo && existsSync(userCargo) ? userCargo : 'cargo';
// sccache shares compiled dependencies between worktrees; use it when it is
// installed and nothing else wraps rustc. Without it, cargo runs as usual.
if (
  !process.env.RUSTC_WRAPPER &&
  spawnSync('sccache', ['--version'], { stdio: 'ignore', windowsHide: true }).status === 0
) {
  process.env.RUSTC_WRAPPER = 'sccache';
}
const args = process.argv.slice(2);
if (
  args.length > 1 ||
  args.some((arg) => !['--native-only', '--shared-only', '--changed'].includes(arg))
)
  throw new Error('Usage: pnpm verify [--native-only | --shared-only | --changed]');
const nativeOnly = args.includes('--native-only');
const sharedOnly = args.includes('--shared-only');

// Keep the machine responsive while checks run; child processes inherit this.
if (process.env.JACKALOPE_VERIFY_PRIORITY !== 'normal') {
  try {
    setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {}
}

/**
 * With --changed, which halves of the gate the commits since the upstream
 * branch can affect. Unknown history runs everything; CI runs everything unless
 * it passes --shared-only for a change no desktop input reads.
 */
function changedScope() {
  if (sharedOnly) return { shared: true, native: false };
  if (!args.includes('--changed')) return { shared: true, native: true };
  const git = (...gitArgs) =>
    spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8', windowsHide: true });
  const upstream =
    git('rev-parse', '--verify', '--quiet', '@{upstream}').status === 0
      ? '@{upstream}'
      : 'origin/master';
  const merge = git('merge-base', 'HEAD', upstream);
  const base = merge.status === 0 ? merge.stdout.trim() : null;
  const files = base ? changedFiles(base) : null;
  const { shared, native } = affected(files);
  if (files)
    console.log(
      `Checking ${files.length} changed files since ${upstream}: ${[
        shared && 'JavaScript and shared checks',
        native && 'native checks',
      ]
        .filter(Boolean)
        .join(' and ')}.`,
    );
  return { shared, native, base };
}
const scope = changedScope();
// The pre-push hook (--changed) leaves builds and deploy dry-runs to CI, which
// runs the full gate on every push to master and every pull request, and runs
// only the server tests that import a changed file.
const pushing = args.includes('--changed');
const serverTests = pushing && scope.base ? ['--changed', scope.base, '--maxWorkers=4'] : [];

const sharedChecks = [
  [process.execPath, ['scripts/evaluation/website.mjs', '--check']],
  [process.execPath, ['scripts/knowledge.mjs', '--check']],
  [process.execPath, [pnpm, 'check']],
  [process.execPath, [pnpm, 'knip']],
  [process.execPath, [pnpm, 'typecheck']],
  [process.execPath, [pnpm, 'test:scripts']],
  [process.execPath, [pnpm, 'check:docs']],
  [process.execPath, [pnpm, 'check:tokens']],
  [process.execPath, [pnpm, 'check:swarm-bundle']],
  [process.execPath, [pnpm, 'check:changelog']],
  ...(pushing ? [] : [[process.execPath, [pnpm, 'ui:build']]]),
  [process.execPath, [pnpm, '--filter', '@jackalope/server', 'test', ...serverTests]],
  ...['@jackalope/mobile', '@jackalope/swarm', '@jackalope/website', '@jackalope/contracts'].map(
    (name) => [process.execPath, [pnpm, '--filter', name, 'test']],
  ),
];
const sharedBuilds = [
  [process.execPath, [pnpm, '--filter', '@jackalope/server', 'build']],
  [process.execPath, [pnpm, 'build']],
  [process.execPath, [pnpm, '--filter', '@jackalope/mobile', 'build']],
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
const desktopScripts = [process.execPath, [pnpm, '--filter', '@jackalope/desktop', 'test']];
const nativeChecks = [
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
      // CI tests the configuration a platform ships, such as the Windows Store build.
      ...(process.env.JACKALOPE_VERIFY_FEATURES
        ? ['--features', process.env.JACKALOPE_VERIFY_FEATURES]
        : []),
    ],
  ],
];
const checks = [
  [process.execPath, ['scripts/security/dependencies.mjs', '--patch-only']],
  ...(!nativeOnly && scope.shared ? sharedChecks : []),
  ...(!nativeOnly && scope.shared && !pushing ? sharedBuilds : []),
  ...(scope.shared || nativeOnly ? [desktopScripts] : []),
  ...(scope.native ? nativeChecks : []),
];
// Checks that build fixture repositories must act on their own, not on the
// repository whose pre-push hook started this run.
const environment = gitEnvironment();
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
