import assert from 'node:assert/strict';
import test from 'node:test';
import { speedReport } from '../../../scripts/evaluation/speed.mjs';

const trial = (receipt, variant, elapsedMs, oraclePassed) => ({
  receipt,
  variant,
  elapsedMs,
  oraclePassed,
  case: 'fixture',
  repetition: 1,
  profileFingerprint: 'account',
  reasoningEffort: 'high',
});

test('delivery measurement includes unsuccessful work and requires complete independent reviews', () => {
  const comparison = {
    trials: [trial('a', 'after', 1000, true), trial('b', 'after', 2000, false)],
  };
  const reviews = {
    a: { accepted: true, reviewMinutes: 1, correctionMinutes: 0 },
    b: { accepted: false, reviewMinutes: 1, correctionMinutes: 2 },
  };
  const result = speedReport(comparison, reviews).summary.after;
  assert.equal(result.accepted, 1);
  assert.equal(result.msPerAcceptedResult, 243000);
  assert.equal(speedReport(comparison, { a: reviews.a }).summary.after.msPerAcceptedResult, null);
  assert.equal(speedReport(comparison).summary.after.reviewCoverage, 0);
  assert.throws(() => speedReport(comparison, { a: { accepted: true } }));
  assert.throws(() => speedReport(comparison, { missing: reviews.a }));
  assert.throws(() => speedReport({ trials: [comparison.trials[0], comparison.trials[0]] }));
});

test('comparisons require matching cases and homogeneous measured configurations', () => {
  const trials = [trial('a', 'control', 1000, true), trial('b', 'after', 1000, true)];
  assert.equal(speedReport({ trials }).matchedCases, true);
  assert.equal(
    speedReport({ trials: [trials[0], { ...trials[1], case: 'different' }] }).matchedCases,
    false,
  );
  assert.equal(
    speedReport({
      trials: [...trials, { ...trials[1], receipt: 'c', requestedServiceTier: 'fast' }],
    }).matchedCases,
    false,
  );
});
