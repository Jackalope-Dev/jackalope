import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assistanceEvidence } from '../../../scripts/evaluation/assistance.mjs';
import {
  experimentEnvironment,
  experimentOptions,
} from '../../../scripts/evaluation/experiments.mjs';
import {
  optimizationCases,
  toolInvestigationCase,
} from '../../../scripts/evaluation/optimization-cases.mjs';

test('shadow screening retains unavailable decisions and exposes missed relevant evidence', () => {
  const records = [
    {
      id: 'a',
      answers: { relevant: { noul: 0.01 } },
      decision: { usage: { estimatedCostUsd: 0.001 } },
      evidence: { assistance: { mode: 'shadow', operation: 'monitor_relevance' } },
    },
    {
      id: 'b',
      answers: {},
      decision: { fallbackReason: 'timeout', usage: {} },
      evidence: { assistance: { mode: 'shadow', operation: 'monitor_relevance' } },
    },
  ];
  const labels = records.map(({ id }) => ({
    recordId: id,
    questionId: 'relevant',
    relevant: true,
  }));
  const report = assistanceEvidence(records, labels);
  assert.equal(report.falseNegatives, 1);
  assert.equal(report.unavailable, 1);
  assert.equal(report.relevanceRecall, 0.5);
  assert.equal(report.estimatedDecisionCostUsd, null);
  assert.equal(report.actualAgentsAvoided, 0);
  assert.equal(report.publicationEligible, false);
  assert.throws(() => assistanceEvidence(records, [...labels, labels[0]]));
  assert.throws(() => assistanceEvidence(records, [{ ...labels[0], questionId: 'conflict_0' }]));
  assert.throws(() => assistanceEvidence([{ ...records[0], evidence: {} }], [labels[0]]));
});

test('optimization oracles reject broken fixtures and accept independent reference outputs', async () => {
  const solutions = {
    'stable-queue-order':
      'export function ready(jobs, done) { return jobs.filter(job => job.after.every(id => done.includes(id))).sort((a,b) => b.priority-a.priority); }',
    'query-fragment-order':
      "export function withQuery(url,key,value) { const hash=url.indexOf('#'); const base=hash<0?url:url.slice(0,hash); return base+(base.includes('?')?'&':'?')+encodeURIComponent(key)+'='+encodeURIComponent(value)+(hash<0?'':url.slice(hash)); }",
  };
  for (const fixture of [...optimizationCases, toolInvestigationCase()]) {
    const root = await mkdtemp(join(tmpdir(), 'jackalope-oracle-'));
    try {
      for (const [name, text] of Object.entries(fixture.files))
        await writeFile(join(root, name), text);
      const oracle = () =>
        spawnSync(process.execPath, ['-e', fixture.oracle, '--', 'oracle', root], {
          encoding: 'utf8',
          windowsHide: true,
        });
      assert.notEqual(oracle().status, 0, fixture.id);
      const expected = fixture.toolFixtures
        ?.flatMap(({ report }) =>
          report.incidents
            .filter((row) => row.active && row.severity === 'critical')
            .map(({ id, affected }) => ({ id, affected })),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      await writeFile(
        join(root, fixture.allowedFiles[0]),
        solutions[fixture.id] ?? JSON.stringify(expected),
      );
      const result = oracle();
      assert.equal(result.status, 0, `${fixture.id}: ${result.stderr}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('optimization controls are explicit and independently reproducible', () => {
  const options = experimentOptions(
    ['--after-batch-read=on', '--after-verification-flow=final', '--after-execution-profile=lean'],
    ['control', 'after'],
  );
  assert.equal(options.control['batch-read'], 'off');
  assert.equal(options.control['execution-profile'], 'standard');
  assert.equal(experimentEnvironment(options.after).JACKALOPE_VERIFICATION_FLOW, 'final');
  assert.throws(() => experimentOptions(['--after-jev-assistance=skip'], ['after']));
});
