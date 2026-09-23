import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReadCache } from '../src/lib/read-cache.ts';

test('read caches coalesce, expire, preserve stale data and reject late cache writes', async () => {
  const cache = createReadCache(100, 2);
  let resolve,
    calls = 0;
  const first = cache.read('a', () => {
    calls++;
    return new Promise((done) => {
      resolve = done;
    });
  });
  assert.equal(
    first,
    cache.read('a', () => {
      throw new Error('duplicate');
    }),
  );
  resolve('one');
  await first;
  assert.equal(await cache.read('a', async () => 'wrong'), 'one');
  await assert.rejects(
    cache.read(
      'a',
      async () => {
        throw new Error('offline');
      },
      true,
    ),
  );
  assert.equal(cache.peek('a'), 'one');
  const late = cache.read(
    'a',
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    true,
  );
  cache.clear();
  resolve('late');
  await late;
  assert.equal(cache.peek('a'), undefined);
  await cache.read('a', async () => 1);
  await cache.read('b', async () => 2);
  await cache.read('c', async () => 3);
  assert.equal(cache.peek('a'), undefined);
  const original = Date.now;
  Date.now = () => original() + 101;
  try {
    assert.equal(await cache.read('b', async () => 4), 4);
  } finally {
    Date.now = original;
  }
  assert.equal(calls, 1);
});
