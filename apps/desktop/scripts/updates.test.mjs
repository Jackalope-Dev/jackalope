import assert from 'node:assert/strict';
import test from 'node:test';
import { createUpdateStore, UPDATE_INTERVAL } from '../src/stores/updateStore.ts';

function fixture(overrides = {}) {
  let time = 1000;
  const calls = [];
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const bridge = {
    desktop: () => true, now: () => time,
    status: async check => { calls.push(check); return { currentVersion: '0.1.0', configured: true, availableVersion: check ? '0.2.0' : null, notes: 'Improvements' }; },
    install: async () => {}, ...overrides,
  };
  const store = createUpdateStore(bridge, storage);
  return { store, calls, storage, bridge, advance: () => { time += UPDATE_INTERVAL; } };
}
test('automatic checks are throttled, deduplicated, opt-out persists and manual checks remain available', async () => {
  const f = fixture();
  await Promise.all([f.store.getState().check(true), f.store.getState().check(true)]);
  assert.deepEqual(f.calls, [false, true]);
  await f.store.getState().check(true);
  assert.equal(f.calls.length, 2);
  f.advance(); await f.store.getState().check(true);
  assert.equal(f.calls.length, 3);
  f.store.getState().setAutoCheck(false);
  f.advance(); await f.store.getState().check(true);
  assert.equal(f.calls.length, 3);
  const reopened = createUpdateStore(f.bridge, f.storage);
  assert.equal(reopened.getState().autoCheck, false);
  assert.equal(reopened.getState().release, null);
  await f.store.getState().check();
  assert.equal(f.calls.length, 4);
});
test('browser and unconfigured builds never request an update feed', async () => {
  const browser = fixture({ desktop: () => false });
  await browser.store.getState().check(); assert.deepEqual(browser.calls, []);
  const f = fixture({ status: async check => { assert.equal(check, false); return { configured: false }; } });
  await f.store.getState().check(true); assert.equal(f.store.getState().lastChecked, null);
});
test('failed checks retain the known update, avoid retry storms, and allow retry', async () => {
  const f = fixture(); await f.store.getState().check();
  f.store.getState().dismiss();
  f.bridge.status = async () => { throw new Error('Offline'); };
  await f.store.getState().check();
  assert.match(f.store.getState().error, /Offline/);
  assert.equal(f.store.getState().release.availableVersion, '0.2.0');
  assert.equal(f.store.getState().dismissedVersion, '0.2.0');
  f.bridge.status = async () => ({ configured: true, availableVersion: '0.3.0' });
  await f.store.getState().check(true);
  assert.equal(f.store.getState().release.availableVersion, '0.2.0');
  await f.store.getState().check();
  assert.equal(f.store.getState().release.availableVersion, '0.3.0');
  assert.equal(f.store.getState().error, null);
});
test('install sends only the reviewed version, exposes progress, prevents double install and recovers after failure', async () => {
  let rejectInstall; let count = 0;
  const f = fixture({ install: (version, progress) => {
    count++; assert.equal(version, '0.2.0');
    progress({ phase: 'downloading', downloaded: 50, total: 100 });
    return new Promise((_, reject) => { rejectInstall = reject; });
  } });
  await f.store.getState().check();
  const pending = f.store.getState().install();
  assert.equal(f.store.getState().installing, true);
  assert.equal(f.store.getState().progress.downloaded, 50);
  await f.store.getState().install(); await f.store.getState().check();
  assert.equal(count, 1); assert.equal(f.calls.length, 2);
  rejectInstall(new Error('Signature rejected')); await pending;
  assert.equal(f.store.getState().installing, false);
  assert.equal(f.store.getState().progress, null);
  assert.match(f.store.getState().error, /Signature rejected/);
});
