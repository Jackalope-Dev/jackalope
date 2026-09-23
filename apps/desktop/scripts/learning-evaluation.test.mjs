import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assessCandidate,
  freezeCandidate,
  reflectionSuite,
} from '../../../scripts/evaluation/learning.mjs';

test('learning oracles reject the seeded mistakes and accept contract implementations', async () => {
  const implementations = [
    'export const select=(entries,now)=>entries.filter(e=>!e.disabled&&(e.expiresAt===null||e.expiresAt>now)).map(e=>e.id);',
    'export function select(entries,query){const q=query.trim().normalize("NFC").toLowerCase();return q?[...new Set(entries.filter(id=>id.normalize("NFC").toLowerCase().includes(q)))]:[];}',
  ];
  for (const [index, task] of learningCases.entries()) {
    const root = await mkdtemp(path.join(tmpdir(), 'jackalope-learning-oracle-'));
    try {
      await writeFile(path.join(root, 'select.mjs'), task.files['select.mjs']);
      await writeFile(path.join(root, 'oracle.cjs'), task.oracle);
      const run = () =>
        spawnSync(process.execPath, [path.join(root, 'oracle.cjs'), root], {
          encoding: 'utf8',
          windowsHide: true,
        });
      assert.equal(run().status, 1, task.id);
      await writeFile(path.join(root, 'select.mjs'), implementations[index]);
      const result = run();
      assert.equal(result.status, 0, result.stderr);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

import { learningCases } from '../../../scripts/evaluation/learning-cases.mjs';
import {
  hash,
  promotionDecision,
  trainingEvidence,
  validateCandidate,
  validateLearningCase,
  validatePartitions,
} from '../../../scripts/evaluation/learning-contract.mjs';

test('learning evidence is identical for both arms and strictly precedes scored work', () => {
  for (const task of learningCases) validateLearningCase(task);
  const task = structuredClone(learningCases[0]);
  task.files['PROJECT-HISTORY.json'] = '[]';
  assert.throws(() => validateLearningCase(task), /same prior history/);
  task.files['PROJECT-HISTORY.json'] = JSON.stringify(task.learningHistory);
  task.taskAt = task.learningHistory[0].contract.requirements[0].receipt.recordedAt;
  assert.throws(() => validateLearningCase(task), /precede/);
});

const tasks = ['train', 'validation', 'validation', 'validation', 'validation', 'holdout'].map(
  (split, i) => ({
    id: `case-${i}`,
    split,
    source: { family: `family-${i}` },
    prompt: `Task ${i}`,
    files: {},
    allowedFiles: [],
    oracle: '',
  }),
);
const training = {
  trials: [
    {
      case: 'case-0',
      split: 'train',
      oraclePassed: false,
      behavioralOraclePassed: false,
      trainingDiagnostic: { check: 'Missed an edge case' },
    },
  ],
};
const candidate = {
  version: 1,
  guidance: 'Check boundary values against the current contract.',
  evidence: ['case-0'],
};

test('reflection sees training only; family leakage and oversized candidates are rejected', () => {
  const suite = reflectionSuite({ cases: tasks }, training);
  const evidence = suite.cases[0].files['training.json'];
  assert.ok(evidence.includes('Missed an edge case'));
  assert.ok(!evidence.includes('Task 5'));
  assert.throws(
    () =>
      reflectionSuite(
        { cases: tasks },
        { trials: [{ ...training.trials[0], oraclePassed: true }] },
      ),
    /skip quality reflection/,
  );
  assert.throws(
    () =>
      reflectionSuite(
        { cases: tasks },
        { trials: [{ ...training.trials[0], quotaFailure: true }] },
      ),
    /skip quality reflection/,
  );
  assert.throws(() => trainingEvidence({ trials: [{ split: 'holdout' }] }), /Only training/);
  assert.throws(
    () => validatePartitions([{ ...tasks[0], source: tasks[5].source }, tasks[5]]),
    /crosses/,
  );
  assert.throws(() => validateCandidate({ ...candidate, guidance: 'é'.repeat(601) }), /1,200/);
  assert.throws(
    () => freezeCandidate({ cases: tasks }, { ...candidate, evidence: ['case-5'] }, training),
    /observed training/,
  );
});

const rows = (passed) =>
  tasks
    .filter((task) => task.split === 'validation')
    .map((task) => ({
      case: task.id,
      repetition: 1,
      split: 'validation',
      model: 'same-model',
      effort: 'balanced',
      startedAt: new Date(Date.now() + 1000).toISOString(),
      oraclePassed: passed,
      totalTokens: 100,
      elapsedMs: 100,
    }));

test('candidate selection rejects regressions, mismatches, unknown spend and excessive overhead', () => {
  assert.equal(promotionDecision(rows(false), rows(true)).eligibleForHoldout, true);
  for (const changed of [
    rows(false),
    rows(true).slice(1),
    rows(true).map((row) => ({ ...row, totalTokens: null })),
    rows(true).map((row) => ({ ...row, elapsedMs: 111 })),
    rows(true).map((row) => ({ ...row, model: 'different' })),
  ])
    assert.equal(promotionDecision(rows(false), changed).eligibleForHoldout, false);
  const a = rows(false);
  a[0].oraclePassed = true;
  const b = rows(true);
  b[0].oraclePassed = false;
  assert.ok(promotionDecision(a, b).blockers.some((s) => s.includes('regressed')));
});

test('frozen validation inputs cannot be changed or partially run to unlock holdout', () => {
  const suite = { cases: tasks },
    frozen = freezeCandidate(suite, candidate, training);
  const comparison = {
    plan: { suiteSha256: hash(frozen.validation.cases), variants: ['control', 'after'], repeat: 1 },
    trials: [
      ...rows(false).map((row) => ({ ...row, variant: 'control' })),
      ...rows(true).map((row) => ({ ...row, variant: 'after' })),
    ],
  };
  assert.equal(assessCandidate(frozen, suite, comparison).eligibleForHoldout, true);
  assert.equal(
    assessCandidate(frozen, suite, { ...comparison, activeTrial: {} }).eligibleForHoldout,
    false,
  );
  assert.throws(() => assessCandidate(frozen, { cases: tasks.slice(1) }, comparison), /differs/);
  assert.equal(
    assessCandidate(frozen, suite, { ...comparison, trials: comparison.trials.slice(1) })
      .eligibleForHoldout,
    false,
  );
});
