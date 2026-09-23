import assert from 'node:assert/strict';
import test from 'node:test';
import { createPersistStorage } from '../src/lib/persist-storage.ts';

test('non-browser stores keep independent state and support arbitrary storage keys', () => {
  const first = createPersistStorage();
  const second = createPersistStorage();
  const saved = { state: { enabled: false }, version: 1 };
  for (const key of ['jackalope-settings', 'constructor', '__proto__']) {
    assert.equal(first.getItem(key), null);
    first.setItem(key, saved);
    assert.deepEqual(first.getItem(key), saved);
    assert.equal(second.getItem(key), null);
    first.removeItem(key);
    assert.equal(first.getItem(key), null);
  }
});

test('browser persistence retains the existing JSON format and surfaces storage failures', () => {
  const previous = globalThis.window;
  const storage = createPersistStorage();
  const saved = { state: { notifications: 'none' }, version: 0 };
  const entries = new Map([['jackalope-settings', JSON.stringify(saved)]]);
  globalThis.window = {
    localStorage: {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
      removeItem: (key) => entries.delete(key),
    },
  };
  try {
    assert.deepEqual(storage.getItem('jackalope-settings'), saved);
    storage.setItem('jackalope-agent-config-v1', saved);
    assert.equal(entries.get('jackalope-agent-config-v1'), JSON.stringify(saved));
    storage.removeItem('jackalope-settings');
    assert.equal(entries.has('jackalope-settings'), false);
    entries.set('broken', '{');
    assert.throws(() => storage.getItem('broken'), SyntaxError);
    globalThis.window.localStorage.setItem = () => {
      throw new Error('Quota exceeded');
    };
    assert.throws(() => storage.setItem('jackalope-settings', saved), /Quota exceeded/);
    Object.defineProperty(globalThis.window, 'localStorage', {
      get() {
        throw new Error('Storage denied');
      },
    });
    assert.throws(() => storage.getItem('jackalope-agent-config-v1'), /Storage denied/);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
