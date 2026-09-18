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
import { retrievalSuite } from '../../../scripts/evaluation/retrieval-cases.mjs';
import { checkScope } from '../../../scripts/evaluation/scope.mjs';

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
    [
      '--after-batch-read=on',
      '--after-result-queries=on',
      '--after-result-preview=on',
      '--after-verification-flow=final',
      '--after-execution-profile=lean',
      '--after-jev-preparation=on',
    ],
    ['control', 'after'],
  );
  assert.equal(options.control['batch-read'], 'off');
  assert.equal(options.control['jev-preparation'], 'off');
  assert.equal(experimentEnvironment(options.after).JACKALOPE_JEV_PREPARATION, 'on');
  assert.equal(options.control['execution-profile'], 'standard');
  assert.equal(options.control['result-queries'], 'off');
  assert.equal(options.control['result-preview'], 'off');
  assert.equal(experimentEnvironment(options.after).JACKALOPE_RESULT_QUERIES, 'on');
  assert.equal(experimentEnvironment(options.after).JACKALOPE_RESULT_PREVIEW, 'on');
  assert.equal(experimentEnvironment(options.after).JACKALOPE_VERIFICATION_FLOW, 'final');
  assert.throws(() => experimentOptions(['--after-jev-assistance=skip'], ['after']));
});

test('retrieval suites have disjoint seeds and exact independently checked oracles', async () => {
  const pilot = retrievalSuite('pilot').cases;
  const held = retrievalSuite().cases;
  assert.deepEqual(retrievalSuite(), retrievalSuite());
  assert.ok(held.every((item) => !pilot.some((p) => p.source.seed === item.source.seed)));
  const fields = {
    incidents: ['active', 'severity', 'critical', 'affected'],
    products: ['available', 'region', 'west', 'quantity'],
    jobs: ['finished', 'conclusion', 'failure', 'duration'],
    tickets: ['open', 'priority', 'urgent', 'customer'],
  };
  for (const fixture of [...pilot, ...held]) {
    const root = await mkdtemp(join(tmpdir(), 'jackalope-retrieval-'));
    try {
      const expected = [];
      for (const { report } of fixture.toolFixtures) {
        const name = Object.keys(report)[0];
        const [flag, state, match, column] = fields[name];
        for (const row of report[name])
          if (row[flag] === true && row[state] === match)
            expected.push({ id: row.id, [column]: row[column] });
      }
      expected.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const run = () =>
        spawnSync(process.execPath, ['-e', fixture.oracle, '--', 'oracle', root], {
          encoding: 'utf8',
          windowsHide: true,
        });
      await writeFile(join(root, 'answer.json'), JSON.stringify(expected));
      assert.equal(run().status, 0, fixture.id);
      const wrong = expected.length ? expected.slice(1) : [{ id: 'invented' }];
      await writeFile(join(root, 'answer.json'), JSON.stringify(wrong));
      assert.notEqual(run().status, 0, fixture.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('custom suites reject test edits and extra artifacts independently of their behavioral oracle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jackalope-scope-'));
  const fixture = { files: { 'check.mjs': 'original' }, allowedFiles: ['answer.json'] };
  try {
    await writeFile(join(root, 'check.mjs'), 'original');
    await writeFile(join(root, 'answer.json'), '[]');
    assert.equal((await checkScope(fixture, root)).passed, true);
    await writeFile(join(root, 'check.mjs'), 'bypassed');
    assert.equal((await checkScope(fixture, root)).passed, false);
    await writeFile(join(root, 'check.mjs'), 'original');
    await writeFile(join(root, 'extra.txt'), 'unexpected');
    assert.equal((await checkScope(fixture, root)).passed, false);
    assert.equal((await checkScope(fixture, undefined)).passed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
