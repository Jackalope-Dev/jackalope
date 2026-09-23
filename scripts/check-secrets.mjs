import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
  return result.stdout;
}
run('gitleaks', ['git', root, '--log-opts=--all', '--redact', '--no-banner']);
const snapshot = mkdtempSync(path.join(tmpdir(), 'jackalope-secrets-'));
if (path.dirname(path.resolve(snapshot)) !== path.resolve(tmpdir()))
  throw new Error('Unexpected scan directory');
try {
  const files = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], true)
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
