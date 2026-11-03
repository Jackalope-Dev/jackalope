import assert from 'node:assert/strict';
import test from 'node:test';
import { affected } from './change-scope.mjs';

test('unknown changes run every suite', () => {
  assert.deepEqual(affected(null), { shared: true, native: true, desktop: true });
});

test('documentation and website changes skip the desktop suites', () => {
  const scope = affected(['docs/STATUS.md', 'README.md', 'apps/website/src/App.tsx']);
  assert.equal(scope.desktop, false);
  assert.equal(scope.native, false);
});

test('one desktop input among independent changes runs the desktop suites', () => {
  for (const file of [
    '.github/workflows/verify.yml',
    'pnpm-lock.yaml',
    'package.json',
    'packages/ui/src/index.ts',
    'scripts/verification/linux-desktop-control.py',
    'apps/server/admin/metrics.ts',
    'apps/desktop/src/App.tsx',
    'releases/0.1.32.md',
  ])
    assert.equal(affected(['docs/STATUS.md', file]).desktop, true, file);
});

test('nested Markdown is not treated as documentation', () => {
  assert.equal(affected(['apps/desktop/src-tauri/resources/notes.md']).desktop, true);
});

test('files the native build embeds run the native checks', () => {
  for (const file of [
    'packages/knowledge/catalog.json',
    'scripts/evaluation/cases.json',
    'apps/desktop/scripts/fixtures/telemetry-events.json',
    'patches/glib/src/lib.rs',
  ])
    assert.equal(affected([file]).native, true, file);
});

test('Rust-only changes skip the shared half', () => {
  assert.equal(affected(['apps/desktop/src-tauri/src/lib.rs']).shared, false);
});
