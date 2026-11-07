import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * Files the native build or its tests read, including the files it embeds with
 * include_str!/include_bytes!. Anything else cannot change a Rust result.
 */
const NATIVE_INPUTS = [
  /^apps\/desktop\/src-tauri\//,
  /^apps\/desktop\/icons\//,
  /^apps\/desktop\/src\/lib\/agents\.json$/,
  /^apps\/desktop\/scripts\/fixtures\//,
  /^packages\/knowledge\/catalog\.json$/,
  /^scripts\/evaluation\/cases\.json$/,
  /^patches\/glib\//,
  /^\.cargo\//,
  /^rust-toolchain/,
  /^package\.json$/,
  /^pnpm-(lock|workspace)\.yaml$/,
  /^scripts\/verify\.mjs$/,
  /^scripts\/change-scope\.mjs$/,
];

/**
 * Paths that nothing in the desktop app, its native build, its tests or the
 * platform trials reads. CI skips the desktop suites only when every changed
 * file matches one of these, so an unlisted path always runs them. Desktop
 * tests import apps/server/admin, so that folder is not listed.
 */
const DESKTOP_INDEPENDENT = [
  /^docs\//,
  /^[^/]+\.md$/,
  /^apps\/website\//,
  /^apps\/swarm\//,
  /^apps\/mobile\//,
  /^apps\/server\/(?!admin\/)/,
];

/** Files changed between `base` and HEAD, or null when Git cannot tell. */
export function changedFiles(base) {
  const diff = spawnSync('git', ['diff', '--name-only', '--no-renames', base, 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (diff.status !== 0) return null;
  const files = diff.stdout.split('\n').filter(Boolean);
  return files.length ? files : null;
}

/**
 * Which checks a set of changed files can affect. `shared` and `native` are the
 * halves of `pnpm verify` (Rust sources cannot change a JavaScript result);
 * `desktop` covers CI's native and desktop platform suites. Unknown changes
 * (null) affect everything.
 */
export function affected(files) {
  if (!files) return { shared: true, native: true, desktop: true };
  return {
    shared: files.some((file) => !file.startsWith('apps/desktop/src-tauri/')),
    native: files.some((file) => NATIVE_INPUTS.some((input) => input.test(file))),
    desktop: files.some((file) => !DESKTOP_INDEPENDENT.some((path) => path.test(file))),
  };
}

// CI: `node scripts/change-scope.mjs <base>` writes desktop=true|false to the step
// outputs. Without a base, or when the diff is unavailable, it reports true.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2];
  const files = base ? changedFiles(base) : null;
  const { desktop } = affected(files);
  console.log(
    files
      ? `${files.length} changed files since ${base}: desktop suites ${desktop ? 'run' : 'skipped'}.`
      : 'No comparable base: desktop suites run.',
  );
  if (!desktop) console.log(files.join('\n'));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `desktop=${desktop}\n`);
}
