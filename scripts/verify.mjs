import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pnpm = process.env.npm_execpath;
if (!pnpm || !/\.[cm]?js$/i.test(pnpm)) throw new Error('Run this check with pnpm verify.');

const userCargo = process.env.USERPROFILE
  ? join(process.env.USERPROFILE, '.cargo', 'bin', 'cargo.exe')
  : null;
const cargo = userCargo && existsSync(userCargo) ? userCargo : 'cargo';

const checks = [
  [process.execPath, ['scripts/security/dependencies.mjs', '--patch-only']],
  [process.execPath, ['scripts/knowledge.mjs', '--check']],
  [process.execPath, [pnpm, 'check']],
  [process.execPath, ['--test', 'scripts/docs-policy.test.mjs']],
  [process.execPath, [pnpm, 'check:docs']],
  [process.execPath, [pnpm, 'check:changelog']],
  [process.execPath, [pnpm, 'test:release']],
  [process.execPath, [pnpm, '--filter', '@jackalope/server', 'types']],
  [process.execPath, [pnpm, '--filter', '@jackalope/server', 'typecheck']],
  [process.execPath, [pnpm, '--filter', '@jackalope/server', 'test']],
  [process.execPath, [pnpm, '--filter', '@jackalope/server', 'build']],
  [process.execPath, [pnpm, '--filter', '@jackalope/desktop', 'test']],
  [cargo, ['fmt', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', '--check']],
  [
    cargo,
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
