import assert from 'node:assert/strict';
import test from 'node:test';
import { createTelemetry } from '../src/lib/telemetry.ts';

test('nothing sends before consent or after opt-out, and errors have a separate gate', async () => {
  const calls = [];
  const client = createTelemetry(async (events) => calls.push(events));
  client.track({ name: 'app_opened' });
  await client.flush();
  assert.equal(calls.length, 0);
  client.configure(true, false);
  client.track({ name: 'app_error', code: 'ui_error' });
  client.track({ name: 'feature_used', feature: 'tasks' });
  await client.flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0][0]).sort(), ['feature', 'id', 'name']);
  client.track({ name: 'app_opened' });
  client.configure(false, false);
  await client.flush();
  assert.equal(calls.length, 1);
  client.stop();
});
test('failed batches reuse event IDs, remain bounded, and stop after three attempts', async () => {
  const calls = [];
  const client = createTelemetry(async (events) => {
    calls.push(events);
    throw Error('offline');
  });
  client.configure(true, true);
  for (let i = 0; i < 100; i++) client.track({ name: 'app_opened' });
  await client.flush();
  await client.flush();
  await client.flush();
  await client.flush();
  assert.equal(calls.length, 3);
  assert.equal(calls[0].length, 50);
  assert.deepEqual(calls[0], calls[1]);
  client.stop();
});
test('opt-out while a request is pending discards its failed retry', async () => {
  let reject;
  let calls = 0;
  const client = createTelemetry(() => {
    calls++;
    return new Promise((_, r) => {
      reject = r;
    });
  });
  client.configure(true, true);
  client.track({ name: 'app_opened' });
  const pending = client.flush();
  client.configure(false, false);
  reject(Error('offline'));
  await pending;
  client.configure(true, true);
  await client.flush();
  assert.equal(calls, 1);
  client.stop();
});
