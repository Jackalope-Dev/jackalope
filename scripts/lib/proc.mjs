import { spawnSync } from 'node:child_process';
import { gitEnvironment } from './git-environment.mjs';
import { root } from './paths.mjs';

/**
 * Runs a command to completion and throws when it cannot start or exits
 * non-zero. Output is inherited unless `stdio` says otherwise; the result's
 * stdout is returned when captured.
 */
export function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} exited ${result.status ?? result.signal}`);
  return result.stdout;
}

/** A command's trimmed stdout. */
export function capture(command, args = [], options = {}) {
  return run(command, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...options })
    .toString()
    .trim();
}

/** Git's trimmed stdout, acting on `cwd` even when a Git hook launched the script. */
export function git(args, options = {}) {
  return capture('git', args, { ...options, env: gitEnvironment(options.env) });
}
