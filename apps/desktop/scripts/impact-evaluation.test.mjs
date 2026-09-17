import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { aggregateAttempts } from '../../../scripts/evaluation/attempts.mjs';
import { experimentOptions, variantOrder } from '../../../scripts/evaluation/experiments.mjs';
import { publicImpact } from '../../../scripts/evaluation/impact-export.mjs';
import {
  impactReport,
  pricedBounds,
  pricedUsage,
} from '../../../scripts/evaluation/impact-report.mjs';
import { repositoryCases } from '../../../scripts/evaluation/repository-cases.mjs';
import { reviewResults } from '../../../scripts/evaluation/review-results.mjs';

test('review measurements require matching human answers and remain descriptive', () => {
  const assignments = {
    study: 'study',
    key: [
      { id: 'a', condition: 'diff' },
      { id: 'b', condition: 'evidence' },
    ],
  };
  const response = {
    study: 'study',
    answers: [{ id: 'a', accepted: false, reviewMinutes: 2, notes: 'A required case is missing.' }],
  };
  const report = reviewResults(assignments, response, {
    reviewMethod: 'manual',
    timingUse: 'descriptive',
  });
  assert.equal(report.complete, false);
  assert.equal(report.conditions.diff.medianReviewMinutes, 2);
  assert.equal(report.conditions.evidence.medianReviewMinutes, null);
  assert.equal(report.correctionMinutes, null);
  assert.equal(report.eligibleForCausalClaim, false);
  const assisted = reviewResults(assignments, response, {
    reviewMethod: 'mixed',
    timingUse: 'descriptive',
  });
  assert.equal(assisted.timingUse, 'excluded');
  assert.equal(assisted.conditions.diff.reviewed, 1);
  assert.equal(assisted.conditions.diff.totalReviewMinutes, null);
  assert.equal(reviewResults(assignments, response).conditions.diff.medianReviewMinutes, null);
  assert.throws(() => reviewResults(assignments, { ...response, study: 'other' }), /different/);
  assert.throws(
    () =>
      reviewResults(assignments, {
        ...response,
        answers: [...response.answers, ...response.answers],
      }),
    /duplicate/,
  );
});

test('continuation comparisons charge every attempt and retain missing accounting', () => {
  const run = {
    usage: { reported: true, input: 100, output: 10, cacheRead: 50, cacheWrite: 0 },
    efficiency: { toolCalls: { read: 2 }, launchPromptBytes: 10, verificationCalls: 1 },
  };
  const aggregate = aggregateAttempts({ run, attempts: [run, run] });
  assert.equal(aggregate.usage.input, 200);
  assert.equal(aggregate.efficiency.toolCalls.read, 4);
  assert.equal(aggregate.efficiency.verificationCalls, 2);
  assert.equal(
    aggregateAttempts({ run, attempts: [run, { ...run, usage: { reported: false } }] }).usage,
    null,
  );
});

test('experiment ordering balances repeated pairs and rejects unknown switch values', () => {
  const a = variantOrder(['control', 'after'], 'task', 1, 'frozen');
  assert.deepEqual(variantOrder(['control', 'after'], 'task', 2, 'frozen'), [...a].reverse());
  assert.throws(() => experimentOptions(['--after-result-selection=maybe'], ['after']), /Invalid/);
});

test('cost separates cache reads and missing measurements never become zero', () => {
  const pricing = { source: 'fixture', date: '2026-09-17', input: 10, cachedInput: 1, output: 50 };
  assert.equal(
    pricedUsage({ input: 100, cacheRead: 80, cacheWrite: 0, output: 2 }, pricing),
    0.00038,
  );
  assert.equal(
    pricedUsage({ input: 100, cacheRead: null, cacheWrite: 0, output: 2 }, pricing),
    null,
  );
  assert.equal(
    pricedUsage({ input: 100, cacheRead: 101, cacheWrite: 0, output: 2 }, pricing),
    null,
  );
  assert.equal(pricedUsage({ input: 100, cacheRead: 80, output: 2 }, pricing), null);
  assert.equal(
    pricedUsage({ input: 100, cacheRead: 80, cacheWrite: 10, output: 2 }, pricing),
    null,
  );
  const longPrices = {
    ...pricing,
    longContextThreshold: 50,
    longInputMultiplier: 2,
    longOutputMultiplier: 1.5,
  };
  assert.equal(
    pricedUsage({ input: 100, cacheRead: 80, cacheWrite: 0, output: 2 }, longPrices),
    null,
  );
  assert.deepEqual(
    pricedBounds({ input: 100, cacheRead: 80, cacheWrite: 0, output: 2 }, longPrices),
    { low: 0.00038, high: 0.00071 },
  );
  assert.equal(
    pricedUsage(
      { input: 100, cacheRead: 80, cacheWrite: 0, output: 2, maxRequestInput: 40 },
      longPrices,
    ),
    0.00038,
  );
});

test('impact reports retain failed costs and refuse marketing claims on tiny repeated fixtures', () => {
  const comparison = {
    plan: { cases: ['a', 'b', 'c'], repeat: 1 },
    trials: ['control', 'after'].flatMap((variant) =>
      ['a', 'b', 'c'].map((id) => ({
        variant,
        case: id,
        repetition: 1,
        receipt: variant + id,
        oraclePassed: variant === 'control' || id !== 'a',
        elapsedMs: 10,
        totalTokens: 100,
        input: 90,
        cacheRead: 50,
        cacheWrite: 0,
        output: 10,
        source: { family: 'same-module' },
        split: 'holdout',
      })),
    ),
  };
  const report = impactReport(comparison);
  assert.equal(report.totals.after.tokensPerSuccess, 150);
  assert.equal(report.totals.control.tokensPerSuccess, 100);
  assert.equal(report.totals.after.accepted, null);
  assert.equal(report.independentFamilies, 1);
  assert.equal(report.publication.eligible, false);
  assert.equal(report.totals.after.p95Ms, null);
  assert.equal(report.complete, true);
  assert.equal(impactReport({ ...comparison, activeTrial: { case: 'a' } }).complete, false);
  assert.equal(impactReport({ ...comparison, interruptions: [{ usage: null }] }).complete, false);
  const qualityOnly = impactReport(comparison, {
    reviews: Object.fromEntries(
      comparison.trials.map((row) => [
        row.receipt,
        { accepted: true, notes: 'Original patch reviewed.' },
      ]),
    ),
  });
  assert.equal(qualityOnly.totals.after.msPerAcceptedExecution, 15);
  assert.equal(qualityOnly.totals.after.msPerAcceptedResult, null);
  assert.equal(qualityOnly.intervals.acceptedExecutionMs, null);
  assert.equal(report.intervals.elapsedMs, null);
  assert.ok(!qualityOnly.publication.blockers.some((text) => text.includes('acceptance')));
  const separateFamilies = {
    ...comparison,
    trials: comparison.trials.map((row) => ({
      ...row,
      oraclePassed: true,
      source: { family: row.case },
    })),
  };
  const acceptedWithoutTiming = impactReport(separateFamilies, {
    reviews: Object.fromEntries(
      comparison.trials.map((row) => [
        row.receipt,
        { accepted: true, notes: 'Original patch reviewed.' },
      ]),
    ),
  });
  assert.ok(acceptedWithoutTiming.intervals.acceptedExecutionMs);
  assert.equal(acceptedWithoutTiming.intervals.deliveryMs, null);
  assert.equal(acceptedWithoutTiming.publication.scope, 'agent-execution');
  const withHelpers = impactReport(comparison, {
    pricing: {
      undefined: { source: 'fixture', date: '2026-09-17', input: 1, cachedInput: 0.1, output: 2 },
    },
    protocol: { includesHelpers: true },
  });
  assert.equal(withHelpers.totals.after.totalCostBoundsUsd, null);
  assert.ok(withHelpers.publication.blockers.some((text) => text.includes('Helper')));
  const wrongPlan = { ...comparison, plan: { cases: ['a', 'b', 'unrun'], repeat: 1 } };
  assert.equal(impactReport(wrongPlan).complete, false);
  const wrongRepetition = {
    ...comparison,
    trials: comparison.trials.map((row) => ({ ...row, repetition: 2 })),
  };
  assert.equal(impactReport(wrongRepetition).complete, false);
  comparison.trials.forEach((row) => {
    row.helperCostUsd = 1;
  });
  const charged = impactReport(comparison, {
    pricing: {
      undefined: { source: 'fixture', date: '2026-09-17', input: 0, cachedInput: 0, output: 0 },
    },
    protocol: { includesHelpers: true },
  });
  assert.deepEqual(charged.totals.after.totalCostPerSuccessBoundsUsd, { low: 1.5, high: 1.5 });
  const exported = publicImpact(comparison, {
    id: 'privacy-check',
    title: 'Privacy check',
    detail: 'Fixtures only',
    labels: { control: 'Baseline', after: 'Candidate' },
  });
  assert.ok(exported.trialMeasurements.every((row) => row.trialId.length === 64));
  assert.ok(
    exported.trialMeasurements.every(
      (row) => !('receipt' in row) && !('profileFingerprint' in row),
    ),
  );
  comparison.trials.push(comparison.trials[0]);
  assert.throws(() => impactReport(comparison), /Duplicate/);
});

test('repository-derived oracles reject seeded defects and accept preserved reference source', async () => {
  const cases = await repositoryCases();
  for (const fixture of cases) {
    const root = await mkdtemp(path.join(tmpdir(), 'jackalope-repo-oracle-'));
    for (const [name, text] of Object.entries(fixture.files))
      await writeFile(path.join(root, name), text);
    const oracle = path.join(tmpdir(), `${path.basename(root)}.cjs`);
    await writeFile(oracle, fixture.oracle);
    const check = () =>
      spawnSync(process.execPath, [oracle, root], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      });
    assert.notEqual(check().status, 0, `${fixture.id} must reject its defect`);
    for (const [name, text] of Object.entries(fixture.referenceFiles))
      await writeFile(path.join(root, name), text);
    const solved = check();
    assert.equal(solved.status, 0, `${fixture.id}: ${solved.stderr}`);
  }
});
