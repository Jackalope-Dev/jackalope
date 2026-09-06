import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./release-config.mjs', import.meta.url));
function trial(endpoint, overrides = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'jackalope-release-'));
  try {
    const result = spawnSync(
      process.execPath,
      [script, endpoint, 'cHVibGlj', 'a'.repeat(40), 'https://example.com/timestamp'],
      {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: 'test-private-value', ...overrides },
      },
    );
    const path = join(cwd, 'output/release/tauri.release.json');
    return { ...result, config: existsSync(path) ? readFileSync(path, 'utf8') : null };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('release configuration requires HTTPS without credentials', () => {
  for (const url of [
    'http://example.com/update',
    'https://user:password@example.com/update',
    'https://example.com/update#secret',
  ]) {
    const result = trial(url);
    assert.notEqual(result.status, 0);
    assert.equal(result.config, null);
  }
});

test('release configuration never writes private signing material', () => {
  const result = trial('https://example.com/update');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.config.includes('test-private-value'));
  const config = JSON.parse(result.config);
  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.deepEqual(config.plugins.updater.endpoints, ['https://example.com/update']);
});

test('missing signing credentials fail before generating configuration', () => {
  const result = trial('https://example.com/update', { TAURI_SIGNING_PRIVATE_KEY: '' });
  assert.notEqual(result.status, 0);
  assert.equal(result.config, null);
});
