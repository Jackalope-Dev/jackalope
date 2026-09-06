import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pnpm = process.env.npm_execpath;
if (!pnpm || !/\.[cm]?js$/i.test(pnpm)) throw new Error('Run this check with pnpm verify.');
const checks = [
  [process.execPath, [pnpm, 'check']],
  [process.execPath, ['scripts/check-docs.mjs']],
  [process.execPath, ['--test', 'scripts/release/*.test.mjs']],
  [process.execPath, [pnpm, '--filter', '@jackalope/server', 'types']],
  [process.execPath, [pnpm, '--filter', '@jackalope/server', 'typecheck']],
  [process.execPath, [pnpm, '--filter', '@jackalope/server', 'test']],
  [process.execPath, [pnpm, '--filter', '@jackalope/server', 'build']],
  [process.execPath, [pnpm, '--filter', '@jackalope/desktop', 'test']],
  ['cargo', ['fmt', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', '--check']],
  [
    'cargo',
    [
      'test',
      '--locked',
      '--manifest-path',
      'apps/desktop/src-tauri/Cargo.toml',
      '--lib',
      '--no-default-features',
    ],
  ],
  [process.execPath, [pnpm, 'build']],
];
for (const [command, args] of checks) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
