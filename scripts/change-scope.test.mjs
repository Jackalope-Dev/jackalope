import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, embeddedInputs } from './change-scope.mjs';

test('unknown changes run every suite', () => {
  assert.deepEqual(affected(null), { shared: true, native: true, desktop: true });
});

test('documentation, website and server changes skip the desktop suites', () => {
  const scope = affected([
    'docs/STATUS.md',
    'README.md',
    'apps/website/src/App.tsx',
    'apps/server/admin/Dashboard.tsx',
  ]);
  assert.equal(scope.desktop, false);
  assert.equal(scope.native, false);
});

test('one desktop input among independent changes runs the desktop suites', () => {
  for (const file of [
    '.github/workflows/verify.yml',
    'pnpm-lock.yaml',
    'package.json',
    'packages/ui/src/index.ts',
    'packages/contracts/src/telemetry.ts',
    'scripts/verification/linux-desktop-control.py',
    'apps/desktop/src/App.tsx',
    'releases/0.1.32.md',
  ])
    assert.equal(affected(['docs/STATUS.md', file]).desktop, true, file);
});

test('nested Markdown is not treated as documentation', () => {
  assert.equal(affected(['apps/desktop/src-tauri/resources/notes.md']).desktop, true);
});

test('embedded files are resolved from each source file, across lines, outside the crate only', () => {
  const inputs = embeddedInputs([
    [
      'apps/desktop/src-tauri/src/commands/a.rs',
      'include_str!("../../../src/lib/catalog.ts"); include_bytes!("../../icons/x.png");',
    ],
    [
      'apps/desktop/src-tauri/src/commands/b/c.rs',
      'serde_json::from_str(include_str!(\n    "../../../../../../packages/x/catalog.json"\n))',
    ],
  ]);
  assert.deepEqual([...inputs].sort(), [
    'apps/desktop/src/lib/catalog.ts',
    'packages/x/catalog.json',
  ]);
});

test('files the native crate embeds run the native checks', () => {
  for (const file of [
    'apps/desktop/src/lib/agents.json',
    'packages/knowledge/catalog.json',
    'scripts/evaluation/cases.json',
    'apps/desktop/scripts/fixtures/telemetry-events.json',
    'patches/glib/src/lib.rs',
  ])
    assert.equal(affected([file]).native, true, file);
  assert.equal(affected(['apps/desktop/src/lib/agent-capabilities.ts']).native, false);
});

test('Rust-only changes skip the shared half', () => {
  assert.equal(affected(['apps/desktop/src-tauri/src/lib.rs']).shared, false);
});
