import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorktreeReader } from '../src/lib/worktree-reads.ts';

test('worktree listing finishes independently of slow cleanup checks and coalesces duplicates', async () => {
  let finish;
  let inspections = 0;
  const entries = [{ path: '/repo', cleanup: null }];
  const read = createWorktreeReader(async (_path, _target, inspect) => {
    if (!inspect) return entries;
    inspections++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const inspection = read('/repo', 'master', true);
  assert.equal(read('/repo', 'master', true), inspection);
  assert.deepEqual(await read('/repo', 'master', false), entries);
  assert.equal(inspections, 1);
  finish(entries);
  await inspection;
});

test('a stuck worktree read times out, can retry, and ignores late results', async () => {
  let finish;
  let calls = 0;
  const read = createWorktreeReader(
    async () => {
      if (++calls > 1) return [{ path: '/new' }];
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    10,
    10,
  );
  await assert.rejects(read('/repo', undefined, true), /Cleanup checks took too long/);
  assert.deepEqual(await read('/repo', undefined, true), [{ path: '/new' }]);
  finish([{ path: '/old' }]);
  assert.deepEqual(await read('/repo', undefined, true), [{ path: '/new' }]);
});
