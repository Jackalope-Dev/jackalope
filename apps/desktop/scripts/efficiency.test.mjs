import assert from 'node:assert/strict';
import test from 'node:test';
import { routingEvidence } from '../../../scripts/evaluation/routing-evidence.mjs';
import { runUsageBreakdown } from '../src/lib/usage-breakdown.ts';

const usage = (input, output = 0) => ({
  input,
  output,
  cacheRead: input / 2,
  cacheWrite: 0,
  reported: true,
});

test('usage attribution includes router failures and handoffs once, with cached input already included', () => {
  const run = {
    usage: usage(100, 10),
    routing: {
      decisions: [{}, {}],
      attempts: [{ usage: usage(20) }, { usage: usage(30) }],
      handoffs: [{ usage: usage(40) }],
    },
  };
  const report = runUsageBreakdown([run]);
  assert.equal(report.total.tokens, 200);
  assert.equal(report.routing.tokens, 50);
  assert.equal(report.quotaRetries.tokens, 40);
  assert.equal(report.verificationTokens, null);
  assert.equal(
    runUsageBreakdown([{ ...run, routing: { ...run.routing, decisions: [{}] } }]).total.tokens,
    90,
  );
  assert.equal(
    runUsageBreakdown([run, { usage: { ...usage(0), reported: false } }]).total.tokens,
    null,
  );
});

function trials(variant, trainPassed, holdoutPassed, tokens) {
  return ['train', 'holdout'].flatMap((split) =>
    Array.from({ length: 12 }, (_, i) => ({
      case: `${split}-${i % 3}`,
      category: 'contracts',
      split,
      variant,
      effort: 'quick',
      receipt: `${variant}-${split}-${i}`,
      oraclePassed: split === 'train' ? trainPassed : holdoutPassed,
      accepted: null,
      totalTokens: tokens,
    })),
  );
}

test('routing selects using training only and rejects on holdout without choosing a replacement', () => {
  const comparison = {
    agent: 'codex',
    model: 'fixture',
    trials: [...trials('after', true, false, 10), ...trials('control', true, true, 20)],
  };
  const report = routingEvidence([comparison], 'oraclePassed');
  assert.equal(report.selections[0].selected.variant, 'after');
  assert.equal(report.selections[0].heldoutPassed, false);
  assert.equal(routingEvidence([comparison]).selections[0].selected, null);
  comparison.trials[0].totalTokens = null;
  assert.equal(
    routingEvidence([comparison], 'oraclePassed').selections[0].selected.variant,
    'control',
  );
});

test('routing rejects overlap and duplicate evidence and will not learn from a single repeated task', () => {
  const comparison = { agent: 'codex', model: 'fixture', trials: trials('after', true, true, 10) };
  assert.throws(() => routingEvidence([comparison, comparison]), /Duplicate/);
  comparison.trials[12].case = 'train-0';
  assert.throws(() => routingEvidence([comparison]), /overlap/);
  comparison.trials = trials('after', true, true, 10).map((t) => ({ ...t, case: t.split }));
  assert.equal(routingEvidence([comparison], 'oraclePassed').selections[0].selected, null);
});
