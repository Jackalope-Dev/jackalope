import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pcmWave } from '../src/lib/dictation.ts';
import {
  defaultShortcuts,
  matchesShortcut,
  normalizeShortcut,
  resolveShortcuts,
} from '../src/lib/shortcuts.ts';
import { validSavedAction } from '../src/stores/savedActionsStore.ts';

test('shortcuts preserve platform modifiers, editing keys and unique bindings', () => {
  const event = {
    key: 'k',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
  };
  assert.equal(matchesShortcut(event, 'Mod+K', 'Win32'), true);
  assert.equal(matchesShortcut(event, 'Mod+K', 'MacIntel'), false);
  assert.equal(
    matchesShortcut({ ...event, ctrlKey: false, metaKey: true }, 'Mod+K', 'MacIntel'),
    true,
  );
  assert.equal(matchesShortcut({ ...event, isComposing: true }, 'Mod+K', 'Win32'), false);
  assert.equal(matchesShortcut({ ...event, shiftKey: true }, 'Mod+K', 'Win32'), false);
  assert.equal(
    matchesShortcut({ ...event, shiftKey: true, key: '!', code: 'Digit1' }, 'Mod+Shift+1', 'Win32'),
    true,
  );
  assert.equal(
    matchesShortcut({ ...event, shiftKey: true, key: '?', code: 'Slash' }, 'Mod+Shift+/', 'Win32'),
    true,
  );
  assert.equal(
    matchesShortcut(
      { ...event, ctrlKey: false, metaKey: true, altKey: true, key: '˚', code: 'KeyK' },
      'Mod+Alt+K',
      'MacIntel',
    ),
    true,
  );
  assert.equal(normalizeShortcut(' shift + mod + p '), 'Mod+Shift+P');
  for (const value of ['K', 'Mod+Mod+K', 'Mod+Q', 'Mod+V', 'Mod+Enter', 'Mod+Shift+W'])
    assert.equal(normalizeShortcut(value), null);
  assert.deepEqual(resolveShortcuts({ search: 'Mod+,' }), defaultShortcuts);
  assert.equal(resolveShortcuts({ search: 'Mod+Shift+P' }).search, 'Mod+Shift+P');
  assert.deepEqual(resolveShortcuts(null), defaultShortcuts);
});

test('local dictation encodes bounded mono PCM without clipping overflow', () => {
  const bytes = pcmWave(new Float32Array([-2, -1, 0, 1, 2]));
  const view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(40, true), 10);
  assert.deepEqual(
    Array.from({ length: 5 }, (_, index) => view.getInt16(44 + index * 2, true)),
    [-32768, -32768, 0, 32767, 32767],
  );
  assert.throws(() => pcmWave(new Float32Array(960001)), /one minute/);
});

test('saved actions reject malformed persistence while retaining project scope', () => {
  const action = {
    id: 'one',
    name: 'Run tests',
    kind: 'command',
    body: 'pnpm test',
    projectId: 'project-one',
  };
  assert.equal(validSavedAction(action), true);
  assert.equal(validSavedAction({ ...action, projectId: null, kind: 'prompt' }), true);
  for (const change of [
    { name: '' },
    { body: '' },
    { body: 'x'.repeat(12001) },
    { kind: 'execute' },
    { projectId: 7 },
  ])
    assert.equal(validSavedAction({ ...action, ...change }), false);
});
