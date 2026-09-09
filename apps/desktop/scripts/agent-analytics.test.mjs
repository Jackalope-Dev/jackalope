import assert from 'node:assert/strict';
import test from 'node:test';
import { computeAgentAnalytics, recordedOutcome } from '../src/lib/agent-analytics.ts';
import { generateAgentInsights } from '../src/lib/agent-insights.ts';

const run = (id, extra = {}) => ({
  id,
  taskId: id,
  projectId: 'p',
  projectPath: '/repo',
  projectName: 'Project',
  agent: 'codex',
  prompt: 'Fix focus',
  status: 'review',
  startedAt: '2026-09-09T12:00:00Z',
  endedAt: '2026-09-09T12:01:00Z',
  contextReceipt: { entries: [], bytes: 0 },
  ...extra,
});
const contract = (accepted) => ({
  requirements: [{ id: 'outcome', checkpoint: false, receipt: { accepted, tree: 'abc' } }],
});

test('empty history has no invented insights, performance or savings', () => {
  const result = computeAgentAnalytics([]);
  assert.equal(result.outcomes.acceptanceRate, null);
  assert.deepEqual(result.metrics, []);
  assert.deepEqual(generateAgentInsights([]), []);
  assert.equal('hoursSaved' in result, false);
});

test('completed or marked-reviewed tasks are not inferred human acceptance', () => {
  const records = [
    run('a'),
    run('b', { status: 'reviewed' }),
    run('c', { contract: contract(true) }),
    run('d', { contract: contract(false) }),
  ];
  const { outcomes, metrics } = computeAgentAnalytics(records);
  assert.equal(outcomes.acceptanceRate, 50);
  assert.equal(outcomes.measured, 2);
  assert.equal(outcomes.total, 4);
  assert.equal(metrics[0].completed, 4);
  assert.equal(
    recordedOutcome(
      run('partial', {
        contract: {
          requirements: [...contract(true).requirements, { id: 'pending', receipt: null }],
        },
      }),
    ),
    null,
  );
  assert.equal(
    recordedOutcome(
      run('checkpoint', {
        contract: { requirements: [{ checkpoint: true, receipt: { accepted: true } }] },
      }),
    ),
    null,
  );
});

test('latest attempts determine outcomes, duplicate records and project-local task ids are safe', () => {
  const first = run('a', { taskId: 't', contract: contract(true) });
  const next = run('b', { taskId: 't', startedAt: '2026-09-10T12:00:00Z' });
  const other = run('c', { taskId: 't', projectId: 'other', contract: contract(false) });
  const { outcomes, metrics } = computeAgentAnalytics([first, first, next, other]);
  assert.equal(outcomes.total, 2);
  assert.equal(outcomes.accepted, 0);
  assert.equal(outcomes.changes, 1);
  assert.equal(metrics[0].attempts, 3);
});

test('duration excludes active and mixed-agent attempts, preserves zero and missing', () => {
  const records = [
    run('a'),
    run('b', { status: 'running', endedAt: null }),
    run('c', { routing: { handoffs: [{}] }, status: 'failed' }),
    run('d', { durationMs: 0 }),
    run('e', { endedAt: 'invalid' }),
  ];
  const data = computeAgentAnalytics(records);
  assert.equal(data.metrics[0].durationSamples, 2);
  assert.equal(data.metrics[0].avgDurationMs, 30000);
  assert.equal(data.handoffs, 1);
  assert.equal(data.completedAfterHandoff, 0);
  assert.equal(computeAgentAnalytics([run('f', { endedAt: null })]).metrics[0].avgDurationMs, null);
});

test('findings link actual failed checks and review corrections without generic recommendations', () => {
  const correction = run('a', { contract: contract(false) });
  const check = run('b', { verification: { result: { success: false } } });
  const findings = generateAgentInsights([correction, check]);
  assert.deepEqual(
    findings.map((f) => f.id),
    ['review-changes', 'failed-checks'],
  );
  assert.equal(findings[0].runs[0].id, 'a');
  assert.equal(findings[1].runs[0].id, 'b');
});

test('context comparisons require observed decisions in both groups and disclaim causality', () => {
  const records = Array.from({ length: 6 }, (_, i) =>
    run(String(i), {
      contract: contract(i !== 0),
      contextReceipt: { entries: i < 3 ? [{ id: 'lesson' }] : [] },
    }),
  );
  const comparison = generateAgentInsights(records).find((f) => f.id === 'context-outcomes');
  assert.ok(comparison.description.includes('2/3 accepted'));
  assert.ok(comparison.description.includes('not a controlled comparison'));
  assert.equal(
    generateAgentInsights(records.slice(1)).some((f) => f.id === 'context-outcomes'),
    false,
  );
});

test('accepted requirements from different snapshots do not imply one accepted result', () => {
  const requirements = [
    { checkpoint: false, receipt: { accepted: true, tree: 'before' } },
    { checkpoint: false, receipt: { accepted: true, tree: 'after' } },
  ];
  assert.equal(recordedOutcome(run('mixed', { contract: { requirements } })), null);
});
