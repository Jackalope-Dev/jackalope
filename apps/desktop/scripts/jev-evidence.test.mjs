import assert from 'node:assert/strict';
import test from 'node:test';
import { jevEvidence } from '../../../scripts/evaluation/jev-evidence.mjs';

const trial = {
  id: 'a',
  caseId: 'case-a',
  configuration: 'fixed-model-and-harness',
  category: 'bugfix',
  variant: 'jev',
  split: 'holdout',
  accepted: true,
  model: 'jev-fixture',
  rubricRevision: 2,
  inputHash: 'fixture-hash',
  totalTokens: 100,
  totalCostUsd: 0.1,
  elapsedMs: 1000,
  correctionMinutes: 1,
};

test('Jev comparisons retain failed attempts in completion costs and keep unknown measurements unknown', () => {
  const report = jevEvidence([
    trial,
    {
      ...trial,
      id: 'b',
      caseId: 'case-b',
      accepted: false,
      totalTokens: 200,
      totalCostUsd: null,
      correctionMinutes: 3,
      fallback: true,
    },
  ]);
  const group = report.summaries[0];
  assert.equal(group.tokens.perAcceptedResult, 300);
  assert.equal(group.costUsd.perAcceptedResult, null);
  assert.equal(group.costUsd.coverage, 1);
  assert.equal(group.correctionMinutes.perAcceptedResult, 4);
  assert.equal(group.fallbacks, 1);
  assert.equal(group.minimumSample, false);
});

test('Jev comparisons reject repeated receipts, overlapping splits and missing model provenance', () => {
  assert.throws(() => jevEvidence([trial, trial]), /Duplicate/);
  assert.throws(() => jevEvidence([trial, { ...trial, id: 'b', split: 'train' }]), /both training/);
  assert.throws(() => jevEvidence([{ ...trial, model: undefined }]), /returned model/);
  assert.throws(() => jevEvidence([{ ...trial, totalCostUsd: -1 }]), /Invalid/);
});
