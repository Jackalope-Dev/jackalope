import assert from 'node:assert/strict';
import test from 'node:test';
import { requiredChecks, waitForSourceChecks } from './source-checks.mjs';

const green = requiredChecks.map((name, id) => ({
  name,
  id,
  status: 'completed',
  conclusion: 'success',
  app: { slug: 'github-actions' },
}));
test('publication waits for pending source CI and rejects failures, missing checks and stale green runs', async () => {
  let reads = 0;
  await waitForSourceChecks(async () => (++reads === 1 ? [] : green), {
    attempts: 2,
    pause: async () => {},
  });
  assert.equal(reads, 2);
  await assert.rejects(
    waitForSourceChecks(async () => [], { attempts: 1 }),
    /not ready/,
  );
  const failed = { ...green[0], id: 1000, conclusion: 'failure' };
  await assert.rejects(
    waitForSourceChecks(async () => [...green, failed], { attempts: 1 }),
    /failed/,
  );
  const pending = { ...failed, status: 'in_progress', conclusion: null };
  await assert.rejects(
    waitForSourceChecks(async () => [...green, pending], { attempts: 1 }),
    /not ready/,
  );
  await assert.rejects(
    waitForSourceChecks(
      async () => green.map((item) => ({ ...item, app: { slug: 'another-app' } })),
      { attempts: 1 },
    ),
    /not ready/,
  );
});
