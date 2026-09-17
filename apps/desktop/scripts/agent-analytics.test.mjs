import assert from 'node:assert/strict';
import test from 'node:test';
import { latestTaskRuns, recordedOutcome } from '../src/lib/agent-analytics.ts';

const run = (id, extra = {}) => ({
  id,
  taskId: id,
  projectId: 'p',
  projectPath: '/repo',
  projectName: 'Project',
  agent: 'codex',
  prompt: 'Fix focus',
  status: 'review',
  startedAt: '2026-09-09T12:00:00Z',
  endedAt: '2026-09-09T12:01:00Z',
  contextReceipt: { entries: [], bytes: 0 },
  ...extra,
});
const contract = (accepted) => ({
  requirements: [{ id: 'outcome', checkpoint: false, receipt: { accepted, tree: 'abc' } }],
});

test('empty history has no task outcomes', () => {
  assert.deepEqual(latestTaskRuns([]), []);
});

test('completed or marked-reviewed tasks are not inferred human acceptance', () => {
  const records = [
    run('a'),
    run('b', { status: 'reviewed' }),
    run('c', { contract: contract(true) }),
    run('d', { contract: contract(false) }),
  ];
  assert.deepEqual(records.map(recordedOutcome), [null, null, 'accepted', 'changes']);
  assert.equal(
    recordedOutcome(
      run('partial', {
        contract: {
          requirements: [...contract(true).requirements, { id: 'pending', receipt: null }],
        },
      }),
    ),
    null,
  );
  assert.equal(
    recordedOutcome(
      run('checkpoint', {
        contract: { requirements: [{ checkpoint: true, receipt: { accepted: true } }] },
      }),
    ),
    null,
  );
});

test('latest attempts determine outcomes, duplicate records and project-local task ids are safe', () => {
  const first = run('a', { taskId: 't', contract: contract(true) });
  const next = run('b', { taskId: 't', startedAt: '2026-09-10T12:00:00Z' });
  const other = run('c', { taskId: 't', projectId: 'other', contract: contract(false) });
  const latest = latestTaskRuns([first, first, next, other]);
  assert.deepEqual(latest, [next, other]);
  assert.deepEqual(latest.map(recordedOutcome), [null, 'changes']);
});

test('accepted requirements from different snapshots do not imply one accepted result', () => {
  const requirements = [
    { checkpoint: false, receipt: { accepted: true, tree: 'before' } },
    { checkpoint: false, receipt: { accepted: true, tree: 'after' } },
  ];
  assert.equal(recordedOutcome(run('mixed', { contract: { requirements } })), null);
});
