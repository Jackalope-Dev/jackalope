import assert from 'node:assert/strict';
import test from 'node:test';
import { executionEvaluation } from '../src/lib/execution-evaluation.ts';

const run = (id, patch = {}) => ({
  id,
  taskId: 'task',
  projectId: 'p',
  projectPath: '/repo',
  startedAt: '2026-09-10T12:00:00Z',
  endedAt: '2026-09-10T12:01:00Z',
  usage: { reported: false, input: 0, output: 0 },
  ...patch,
});

test('evaluation preserves unknown acceptance, effort and tokens in old records', () => {
  const result = executionEvaluation([run('one')]).episodes[0];
  assert.equal(result.outcome, null);
  assert.equal(result.reportedTokens, null);
  assert.equal(result.acceptedAfterMs, null);
  assert.equal(result.reviewMinutes, null);
  assert.equal(result.escapedDefects, null);
  assert.equal(result.timingCoverage, 0);
});

test('evaluation combines attempts without duplicating input records or claiming interrupted timing', () => {
  const first = run('one', { stages: [{ stage: 'execution', endedAt: 'now', durationMs: 1000 }] });
  const next = run('two', {
    startedAt: '2026-09-10T12:02:00Z',
    endedAt: '2026-09-10T12:03:00Z',
    stages: [{ stage: 'execution', endedAt: null, durationMs: null }],
    contract: {
      requirements: [
        {
          checkpoint: false,
          receipt: { accepted: true, tree: 'abc', recordedAt: '2026-09-10T12:04:00Z' },
        },
      ],
    },
  });
  const result = executionEvaluation([first, first, next]);
  assert.equal(result.episodes[0].attempts, 2);
  assert.equal(result.episodes[0].acceptedAfterMs, 240000);
  assert.equal(result.episodes[0].followUpAttempts, 1);
  assert.equal(result.episodes[0].requestedCorrections, 0);
  assert.equal(result.stageTotalsMs.execution, 1000);
  assert.ok(!JSON.stringify(result).includes('projectPath'));
});
