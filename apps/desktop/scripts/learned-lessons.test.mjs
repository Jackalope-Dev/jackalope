import assert from 'node:assert/strict';
import test from 'node:test';
import {
  learnedStatus,
  learningMetricRows,
  learningSettings,
  learningSummary,
  ledgerActionLabel,
  lessonAttention,
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

test('curator folds and metrics read in plain words', () => {
  assert.match(
    learningSummary(lifecycle({ status: 'archived', archivedReason: 'merged' })),
    /folded into a similar lesson/,
  );
  assert.equal(ledgerActionLabel('curated'), 'Folded into a similar lesson');
  const rows = learningMetricRows({
    probation: 1,
    active: 2,
    archived: 3,
    deliveries: 4,
    learned: 5,
    promoted: 6,
    archivedEvents: 7,
    restored: 8,
    folded: 9,
    retired: 10,
    missed: 12,
    contradicted: 13,
    stale: 14,
    byAgent: 11,
  });
  assert.equal(rows.length, 14);
  assert.ok(rows.some(([label, value]) => label === 'Missed by agents' && value === 12));
  assert.deepEqual(rows[0], ['New', 1]);
  assert.ok(rows.some(([label, value]) => label === 'Folded as duplicates' && value === 9));
});

test('lessons agents miss or that name something gone ask for a look', () => {
  const learned = (overrides = {}) => ({ managed: true, lifecycle: lifecycle(overrides) });
  assert.equal(lessonAttention({ automatic: learned({ status: 'active' }) }), null);
  assert.match(
    lessonAttention({ automatic: learned({ status: 'active', missedOften: true }) }),
    /Agents keep missing this/,
  );
  assert.equal(
    lessonAttention({ automatic: learned({ status: 'archived', missedOften: true }) }),
    null,
  );
  assert.equal(
    lessonAttention({ stale: 'docs/gone.md', automatic: null }),
    'References docs/gone.md, which no longer exists. Edit or remove this lesson.',
  );
  assert.equal(
    lessonAttention({
      stale: 'docs/gone.md',
      automatic: learned({ status: 'archived', archivedReason: 'stale' }),
    }),
    'References docs/gone.md, which no longer exists.',
  );
  assert.match(
    learningSummary(lifecycle({ status: 'archived', archivedReason: 'ignored' })),
    /agents kept missing it/,
  );
  assert.equal(ledgerActionLabel('missed'), 'Missed by an agent');
  assert.equal(ledgerActionLabel('stale'), 'Out of date');
});
