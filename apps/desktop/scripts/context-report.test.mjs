import assert from 'node:assert/strict';
import test from 'node:test';
import { contextReport } from '../../../scripts/evaluation/context-report.mjs';

function comparison() {
  return {
    agent: 'codex',
    model: 'fixture',
    cliVersion: 'fixture-cli',
    plan: { cases: ['a', 'b', 'c'], variants: ['direct', 'after'], repeat: 3 },
    executableHashes: { direct: 'baseline', after: 'candidate' },
    trials: ['direct', 'after'].flatMap((variant) =>
      ['a', 'b', 'c'].flatMap((id) =>
        [1, 2, 3].map((repetition) => ({
          variant,
          case: id,
          repetition,
          receipt: `private/${variant}/${id}/${repetition}`,
          profileFingerprint: 'private-account',
          reasoningEffort: 'medium',
          requestedServiceTier: 'default',
          processExit: 0,
          processTimeout: false,
          budgetStopped: false,
          oraclePassed: true,
          totalTokens: variant === 'direct' ? 100 : 50,
          input: variant === 'direct' ? 80 : 40,
          output: variant === 'direct' ? 20 : 10,
          cacheRead: 30,
          elapsedMs: variant === 'direct' ? 100 : 70,
          promptBytes: 20,
        })),
      ),
    ),
  };
}
test('public context evidence keeps paired failures and excludes private identifiers', () => {
  const data = comparison();
  const report = contextReport(data);
  assert.equal(report.metrics.totalTokens.reductionPercent, 50);
  assert.equal(report.metrics.totalTokens.eligibleForPilotSignal, true);
  assert.equal(report.metrics.totalTokens.eligibleForScopedClaim, false);
  assert.equal(report.totals.after.cachedInputTokens, 270);
  assert.doesNotMatch(JSON.stringify(report), /private/);
  data.trials.at(-1).oraclePassed = false;
  const failed = contextReport(data);
  assert.equal(failed.totals.after.totalTokens, 450);
  assert.equal(failed.metrics.totalTokens.eligibleForScopedClaim, false);
});
test('unmatched settings, missing usage, interruptions and small samples cannot support claims', () => {
  for (const change of [
    (d) => {
      d.trials[0].reasoningEffort = 'high';
    },
    (d) => {
      d.trials[0].totalTokens = null;
    },
    (d) => {
      d.interruptions = [{}];
    },
    (d) => {
      d.trials = d.trials.filter((t) => t.repetition < 3);
    },
    (d) => {
      d.trials[0].profileFingerprint = null;
    },
    (d) => {
      d.trials[0].budgetStopped = true;
    },
  ]) {
    const d = comparison();
    change(d);
    assert.equal(contextReport(d).metrics.totalTokens.eligibleForScopedClaim, false);
  }
  const d = comparison();
  d.trials.push(d.trials[0]);
  assert.throws(() => contextReport(d), /Duplicate/);
});
