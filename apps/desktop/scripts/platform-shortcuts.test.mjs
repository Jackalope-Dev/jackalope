import assert from 'node:assert/strict';
import test from 'node:test';
import { shortcutLabel } from '../src/lib/platform-shortcuts.ts';

test('shortcut labels match the supported desktop modifier', () => {
  assert.equal(shortcutLabel('Shift+N', 'MacIntel'), '⌘+Shift+N');
  assert.equal(shortcutLabel(',', 'MacIntel'), '⌘+,');
  assert.equal(shortcutLabel('K', 'Win32'), 'Ctrl+K');
  assert.equal(shortcutLabel('K', 'Linux x86_64'), 'Ctrl+K');
  assert.equal(shortcutLabel('K', ''), 'Ctrl+K');
});
