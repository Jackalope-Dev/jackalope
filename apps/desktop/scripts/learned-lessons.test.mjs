import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRetireEnforced,
  learnedStatus,
  learningMetricRows,
  learningSettings,
  learningSummary,
  ledgerActionLabel,
  lessonAttention,
  lessonCheckDraftKey,
  lessonCheckOffer,
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
    enforced: 15,
  });
  assert.equal(rows.length, 15);
  assert.ok(rows.some(([label, value]) => label === 'Made into checks' && value === 15));
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

test('lessons agents keep missing suggest a check, and enforced ones stop offering it', () => {
  const lesson = (overrides = {}) => ({
    kind: 'memory',
    enabled: true,
    automatic: { managed: true, lifecycle: lifecycle({ status: 'active' }) },
    ...overrides,
  });
  const enforced = { by: 'pnpm lint:routes', runId: 'r1', at: '2026-10-30T00:00:00Z' };
  assert.equal(lessonCheckOffer(lesson()), 'available');
  assert.equal(lessonCheckOffer(lesson({ automatic: null })), 'available');
  assert.equal(lessonCheckOffer(lesson({ kind: 'workflow' })), null);
  assert.equal(
    lessonCheckOffer(
      lesson({
        automatic: { managed: true, lifecycle: lifecycle({ status: 'active', missedOften: true }) },
      }),
    ),
    'suggested',
  );
  assert.equal(lessonCheckOffer(lesson({ enforced })), null);
  const gone = { ...enforced, missing: 'scripts/check-routes.mjs' };
  assert.equal(lessonCheckOffer(lesson({ enforced: gone })), 'suggested');
  assert.match(lessonAttention({ enforced: gone }), /scripts\/check-routes\.mjs, which no longer/);

  // A written or edited lesson stays supplied until the person retires it.
  assert.equal(canRetireEnforced(lesson({ enforced, automatic: null })), true);
  assert.equal(canRetireEnforced(lesson({ enforced, enabled: false, automatic: null })), false);
  assert.equal(
    canRetireEnforced(
      lesson({
        enforced,
        automatic: {
          managed: true,
          lifecycle: lifecycle({ status: 'archived', archivedReason: 'enforced' }),
        },
      }),
    ),
    false,
  );
  assert.equal(canRetireEnforced(lesson({ enforced: gone, automatic: null })), false);
  assert.match(
    learningSummary(lifecycle({ status: 'archived', archivedReason: 'enforced' })),
    /the repository now enforces it/,
  );
  assert.equal(ledgerActionLabel('enforced'), 'Made a check');
  assert.equal(ledgerActionLabel('unenforced'), 'No longer enforced');
  // Drafts open in the composer through the helper-draft event.
  assert.match(lessonCheckDraftKey('abc'), /^helper-/);
});
