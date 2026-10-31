import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decisionTrail,
  missingPointers,
  pointerStates,
  supersededBy,
  trailHandoff,
} from '../src/lib/decision-trail.ts';
import { recoveryHandoff } from '../src/lib/project-return.ts';

const entry = (id, extra = {}) => ({
  id,
  at: '2026-10-30T09:00:00Z',
  phase: 'api',
  decision: `Decision ${id}`,
  why: 'Because',
  evidence: [],
  result: 'tests pass',
  ...extra,
});

test('each attempt is its own group and later attempts stay hidden from earlier ones', () => {
  const attempts = [
    { id: 'second', startedAt: '2026-10-30T10:00:00Z', decisions: [entry('b')] },
    { id: 'first', startedAt: '2026-10-30T09:00:00Z', decisions: [entry('a')] },
    { id: 'legacy', startedAt: '2026-10-30T11:00:00Z' },
  ];
  const all = decisionTrail(attempts);
  assert.deepEqual(
    all.map((group) => [group.runId, group.attempt]),
    [
      ['first', 1],
      ['second', 2],
    ],
  );
  assert.deepEqual(
    decisionTrail(attempts, 'first').map((group) => group.runId),
    ['first'],
  );
  assert.deepEqual(decisionTrail([{ id: 'old', startedAt: '2026-01-01T00:00:00Z' }]), []);
});

test('a correction marks the entry it supersedes across attempts', () => {
  const groups = decisionTrail([
    { id: 'one', startedAt: '2026-10-30T09:00:00Z', decisions: [entry('a')] },
    {
      id: 'two',
      startedAt: '2026-10-30T10:00:00Z',
      decisions: [entry('b', { supersedes: 'a' })],
    },
  ]);
  assert.equal(supersededBy(groups).get('a')?.id, 'b');
  assert.equal(supersededBy(groups).has('b'), false);
});

test('pointers stay unchecked until the attempt ends, then missing ones are counted', () => {
  const running = entry('a', { evidence: ['src/a.ts:4', 'commit abc1234'] });
  assert.deepEqual(
    pointerStates(running).map((item) => item.state),
    ['unchecked', 'unchecked'],
  );
  const ended = {
    ...running,
    checks: [
      { pointer: 'src/a.ts:4', state: 'found' },
      { pointer: 'commit abc1234', state: 'missing', note: 'No such commit in this workspace' },
    ],
  };
  assert.deepEqual(
    pointerStates(ended).map((item) => item.state),
    ['found', 'missing'],
  );
  assert.equal(missingPointers([{ runId: 'r', attempt: 1, startedAt: '', entries: [ended] }]), 1);
  const future = { ...running, checks: [{ pointer: 'src/a.ts:4', state: 'stale' }] };
  assert.equal(pointerStates(future)[0].state, 'unchecked');
});

test('recovery handoffs carry recent decisions and flag unbacked evidence', () => {
  const decisions = [
    entry('a', {
      evidence: ['commit abc1234'],
      checks: [{ pointer: 'commit abc1234', state: 'missing' }],
    }),
  ];
  assert.match(trailHandoff(decisions), /commit abc1234 \(not found\)/);
  const handoff = recoveryHandoff(
    {
      status: 'failed',
      result: '',
      error: null,
      workspace: '/saved',
      baseHead: 'abc',
      decisions,
    },
    'Build it',
    'Continue',
  );
  assert.match(handoff, /Recorded decisions \(agent claims/);
  assert.match(handoff, /\[api\] Decision a: Because → tests pass/);
  assert.doesNotMatch(
    recoveryHandoff({ status: 'failed', result: '', workspace: '/saved' }, 'Build', 'Next'),
    /Recorded decisions/,
  );
});
