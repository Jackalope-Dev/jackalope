import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeRefresh } from '../src/lib/observe-refresh.ts';

test('refresh events do not starve polling and a change during a read gets reconciled', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  let changed;
  let finish;
  let calls = 0;
  let stopped = false;
  const stop = observeRefresh({
    refresh: () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    interval: () => 15_000,
    subscribe: async (notify) => {
      changed = notify;
      return () => {
        stopped = true;
      };
    },
  });
  await Promise.resolve();
  assert.equal(calls, 1);
  changed();
  finish();
  await Promise.resolve();
  t.mock.timers.tick(100);
  assert.equal(calls, 2);
  finish();
  await Promise.resolve();
  changed();
  t.mock.timers.tick(50);
  changed();
  t.mock.timers.tick(50);
  assert.equal(calls, 3);
  stop();
  finish();
  await Promise.resolve();
  t.mock.timers.tick(60_000);
  assert.equal(calls, 3);
  assert.equal(stopped, true);
  delete globalThis.window;
  delete globalThis.document;
});
