import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root } from './lib/paths.mjs';
import { git, run } from './lib/proc.mjs';

/**
 * Modes:
 * - no argument: every commit on every ref, then the working files (CI, releases).
 * - `--push <remote>`: only the commits a push sends, read from the pre-push input,
 *   then the working files. A secret on another local branch is checked when that
 *   branch is pushed, so it cannot block unrelated work.
 * - `--staged`: only the staged changes (pre-commit), so a secret never reaches a commit.
 */
const [mode, remote] = process.argv.slice(2);
const scan = (logOpts) =>
  run('gitleaks', ['git', root, `--log-opts=${logOpts}`, '--redact', '--no-banner']);

if (mode === '--staged') {
  run('gitleaks', ['git', root, '--staged', '--redact', '--no-banner']);
  process.exit(0);
}
if (mode === '--push') {
  if (!remote || remote.startsWith('-'))
    throw new Error('Usage: check-secrets.mjs --push <remote>');
  const tips = readFileSync(0, 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[1])
    .filter((sha) => sha && !/^0+$/.test(sha));
  // What the push sends: commits reachable from the pushed tips that the remote
  // does not already have, whether the branch is new or updated.
  if (tips.length) scan(`${tips.join(' ')} --not --remotes=${remote}`);
} else if (mode) {
  throw new Error(`Unknown option ${mode}`);
} else {
  scan('--all');
}
const snapshot = mkdtempSync(path.join(tmpdir(), 'jackalope-secrets-'));
if (path.dirname(path.resolve(snapshot)) !== path.resolve(tmpdir()))
  throw new Error('Unexpected scan directory');
try {
  const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean);
  for (const file of new Set(files)) {
    const source = path.join(root, file);
    if (!existsSync(source)) continue;
    const target = path.join(snapshot, file);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  run('gitleaks', ['dir', snapshot, '--redact', '--no-banner']);
} finally {
  rmSync(snapshot, { recursive: true, force: true });
}
