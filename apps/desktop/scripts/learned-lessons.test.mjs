import assert from 'node:assert/strict';
import test from 'node:test';
import {
  learnedStatus,
  learningSettings,
  learningSummary,
  ledgerActionLabel,
} from '../src/lib/learning.ts';

const lifecycle = (overrides = {}) => ({
  status: 'probation',
  statement: 'Always run pnpm verify.',
  origin: 'reflection',
  bornAt: '2026-10-01T00:00:00Z',
  deliveries: 0,
  opportunities: 0,
  idle: 0,
  ...overrides,
});

test('learning is on by default with a bounded cadence', () => {
  assert.deepEqual(learningSettings(undefined), { automatic: true, cadence: 50 });
  assert.deepEqual(learningSettings({ preferences: { learnAutomatically: false } }), {
    automatic: false,
    cadence: 50,
  });
  assert.equal(learningSettings({ preferences: { learningCadence: 100 } }).cadence, 100);
  assert.equal(learningSettings({ preferences: { learningCadence: 5 } }).cadence, 50);
});

test('only learned lessons have a status, and unknown statuses read as active', () => {
  assert.equal(learnedStatus(undefined), null);
  assert.equal(learnedStatus(null), null);
  assert.equal(learnedStatus(lifecycle()), 'probation');
  assert.equal(learnedStatus(lifecycle({ status: 'archived' })), 'archived');
  assert.equal(learnedStatus(lifecycle({ status: 'pinned' })), 'active');
});

test('summaries explain probation, use and why a lesson was archived', () => {
  assert.equal(learningSummary(lifecycle()), 'Used in 0 tasks · New until it is used in 2 tasks');
  assert.equal(learningSummary(lifecycle({ status: 'active', deliveries: 1 })), 'Used in 1 task');
  assert.equal(
    learningSummary(lifecycle({ status: 'archived', deliveries: 3, archivedReason: 'unused' })),
    'Used in 3 tasks · Archived: not used by recent tasks',
  );
  assert.equal(
    learningSummary(lifecycle({ status: 'archived', archivedReason: 'from-the-future' })),
    'Used in 0 tasks · Archived',
  );
  assert.equal(ledgerActionLabel('born'), 'Learned');
  assert.equal(ledgerActionLabel('unknown-action'), 'unknown-action');
});
