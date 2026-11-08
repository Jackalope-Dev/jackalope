import { appendFileSync, readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { root } from './lib/paths.mjs';
import { git } from './lib/proc.mjs';

const NATIVE = 'apps/desktop/src-tauri/';

/**
 * Files the native build or its tests read besides the Rust crate itself. Files
 * the crate embeds with include_str!/include_bytes! are found by
 * `embeddedInputs`; anything else cannot change a Rust result.
 */
const NATIVE_INPUTS = [
  /^apps\/desktop\/src-tauri\//,
  /^apps\/desktop\/icons\//,
  /^apps\/desktop\/scripts\/fixtures\//,
  /^patches\/glib\//,
  /^\.cargo\//,
  /^rust-toolchain/,
  /^package\.json$/,
  /^pnpm-(lock|workspace)\.yaml$/,
  /^scripts\/verify\.mjs$/,
  /^scripts\/change-scope\.mjs$/,
  /^scripts\/lib\//,
];

/** The repository files outside the crate that `sources` (path → Rust text) embed. */
export function embeddedInputs(sources) {
  const inputs = new Set();
  for (const [file, text] of sources)
    for (const [, target] of text.matchAll(/include_(?:str|bytes)!\(\s*"([^"]+)"\s*\)/g)) {
      const path = posix.normalize(posix.join(posix.dirname(file), target));
      if (!path.startsWith(NATIVE)) inputs.add(path);
    }
  return inputs;
}

let embedded;
function nativeEmbeds() {
  embedded ??= embeddedInputs(
    git(['ls-files', '--', `${NATIVE}*.rs`], { cwd: root })
      .split('\n')
      .filter(Boolean)
      .map((file) => [file, readFileSync(resolve(root, file), 'utf8')]),
  );
  return embedded;
}

/**
 * Paths that nothing in the desktop app, its native build, its tests or the
 * platform trials reads. CI skips the desktop suites only when every changed
 * file matches one of these, so an unlisted path always runs them.
 */
const DESKTOP_INDEPENDENT = [
  /^docs\//,
  /^[^/]+\.md$/,
  /^apps\/website\//,
  /^apps\/swarm\//,
  /^apps\/mobile\//,
  /^apps\/server\//,
];

/** Files changed between `base` and HEAD, or null when Git cannot tell. */
export function changedFiles(base) {
  let diff;
  try {
    diff = git(['diff', '--name-only', '--no-renames', base, 'HEAD'], { cwd: root });
  } catch {
    return null;
  }
  const files = diff.split('\n').filter(Boolean);
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
    shared: files.some((file) => !file.startsWith(NATIVE)),
    native: files.some(
      (file) => NATIVE_INPUTS.some((input) => input.test(file)) || nativeEmbeds().has(file),
    ),
    desktop: files.some((file) => !DESKTOP_INDEPENDENT.some((path) => path.test(file))),
  };
}

// CI: `node scripts/change-scope.mjs <base>` writes desktop=true|false to the step
// outputs. Without a base, or when the diff is unavailable, it reports true.
if (import.meta.main) {
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
