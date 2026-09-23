import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAPACITY_CACHE_MS, useCapacityStore } from '../src/stores/capacityStore.ts';

test('capacity refresh coalesces readers, expires cached results and retains data on failure', async () => {
  const originalWindow = globalThis.window;
  const calls = [];
  let release;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: (command, args) => {
        calls.push({ command, args });
        return new Promise((resolve, reject) => {
          release = { resolve, reject };
        });
      },
    },
  };
  const record = {
    agent: 'codex',
    account: 'fixture',
    status: 'reported',
    source: 'fixture',
    observedAt: new Date().toISOString(),
    detail: '',
    windows: [],
  };
  try {
    useCapacityStore.setState({
      records: [],
      lastFetched: 0,
      lastAttempted: 0,
      error: null,
      loading: false,
    });
    const first = useCapacityStore.getState().fetch();
    const second = useCapacityStore.getState().fetch();
    assert.equal(first, second);
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(calls, [{ command: 'capacity_snapshot', args: { refresh: true } }]);
    release.resolve([record]);
    await first;
    await useCapacityStore.getState().fetch();
    assert.equal(calls.length, 1);
    useCapacityStore.setState({ lastFetched: Date.now() - CAPACITY_CACHE_MS - 1 });
    release = null;
    const stale = useCapacityStore.getState().fetch();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(useCapacityStore.getState().records, [record]);
    release.reject(new Error('Temporarily offline'));
    await stale;
    assert.deepEqual(useCapacityStore.getState().records, [record]);
    assert.match(useCapacityStore.getState().error, /Temporarily offline/);
    await useCapacityStore.getState().fetch();
    assert.equal(calls.length, 2);
    release = null;
    const manual = useCapacityStore.getState().fetch(true);
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    release.resolve([{ ...record, account: 'updated' }]);
    await manual;
    assert.equal(calls.length, 3);
    assert.equal(useCapacityStore.getState().records[0].account, 'updated');
    assert.equal(useCapacityStore.getState().error, null);
    assert.equal(useCapacityStore.getState().loading, false);
  } finally {
    globalThis.window = originalWindow;
  }
});
