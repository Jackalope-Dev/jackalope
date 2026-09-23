import assert from 'node:assert/strict';
import test from 'node:test';
import { decisionUsageEntries } from '../src/lib/decision-usage.ts';
import { summarizeUsage } from '../src/lib/usage-insights.ts';

test('Jev and its agent fallback are counted separately, preserving partial coverage', () => {
  const usage = {
    input: 100,
    output: 3,
    cacheRead: 0,
    cacheWrite: 0,
    reported: true,
    estimatedCostUsd: 0.01,
  };
  const attempts = [
    { provider: 'jev', usage },
    { provider: 'agent', usage: { ...usage, reported: false, estimatedCostUsd: null } },
  ];
  const decision = { requestedMode: 'jev', usage: { ...usage, reported: false }, attempts };
  assert.deepEqual(decisionUsageEntries(decision), attempts);
  const summary = summarizeUsage(decisionUsageEntries(decision));
  assert.equal(summary.calls, 2);
  assert.equal(summary.tokens, 103);
  assert.equal(summary.costUsd, 0.01);
  assert.equal(summary.missing, 1);
  assert.deepEqual(decisionUsageEntries({ requestedMode: 'jev', usage }), [
    { provider: 'jev', usage },
  ]);
  assert.deepEqual(
    decisionUsageEntries({ requestedMode: 'deterministic', modelCallAttempted: false, usage }),
    [],
  );
});
