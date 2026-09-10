import assert from 'node:assert/strict';
import test from 'node:test';
import { usageEntries } from '../src/lib/usage-entries.ts';
import {
  summarizeUsage,
  usageCutoff,
  usageDateKey,
  usageInsights,
} from '../src/lib/usage-insights.ts';

const usage = (input, reported = true) => ({
  input,
  output: 0,
  cacheRead: input / 2,
  cacheWrite: 0,
  estimatedCostUsd: null,
  reported,
});
const binding = { adapter: 'codex', profileId: 'one', directory: 'private', label: 'Work' };
const run = (id, extra = {}) => ({
  id,
  taskId: id,
  projectId: 'p1',
  projectName: 'One',
  projectPath: '/one',
  prompt: 'Task',
  agent: 'codex',
  account: 'Work',
  startedAt: '2026-09-10T12:00:00Z',
  status: 'review',
  usage: usage(100),
  ...extra,
});
const accepted = {
  requirements: [{ id: 'a', checkpoint: false, receipt: { accepted: true, tree: 'tree' } }],
};

test('task totals include all attempts, router failures and handoffs once; latest reviews own outcomes', () => {
  const first = run('first', {
    taskId: 'same',
    startedAt: '2026-09-08T12:00:00Z',
    usage: usage(200),
    status: 'failed',
  });
  const last = run('last', {
    taskId: 'same',
    contract: accepted,
    routing: {
      decisions: [{}, {}],
      attempts: [
        { agent: 'codex', binding, usage: usage(20), error: 'failed', recordedAt: first.startedAt },
        { agent: 'codex', binding, usage: usage(30), recordedAt: first.startedAt },
      ],
      handoffs: [{ agent: 'claude', binding, usage: usage(40), recordedAt: first.startedAt }],
    },
  });
  const other = run('other', {
    projectId: 'p2',
    projectPath: '/two',
    projectName: 'Two',
    contract: undefined,
  });
  const entries = usageEntries([first, last, other, last]);
  const result = usageInsights(entries, [last, first, other], 'all');
  assert.equal(result.total.tokens, 490);
  assert.equal(result.routing.tokens, 50);
  assert.equal(result.handoffs.tokens, 40);
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0].attempts, 2);
  assert.equal(result.tasks[0].tokens, 390);
  assert.equal(result.accepted, 1);
  assert.equal(result.outcomes[0].tokens, 390);
  assert.equal(result.outcomes[2].tokens, 100);
  assert.equal(result.total.cacheRead, 245);
  assert.equal(result.agents.find((r) => r.id === 'claude').tokens, 40);
  const limited = usageInsights(
    entries.filter((r) => r.id === 'first'),
    [first, last],
    'all',
  );
  assert.equal(limited.tasks[0].outcome, 'accepted');
  assert.equal(limited.total.tokens, 200);
});

test('missing reports never become zero or a complete overhead percentage; explicit zero survives', () => {
  const runs = [run('known'), run('unknown', { usage: usage(1000, false) })];
  const data = usageInsights(usageEntries(runs), runs, 'all');
  assert.equal(data.total.tokens, 100);
  assert.equal(data.total.missing, 1);
  assert.equal(data.routingPercent, null);
  assert.equal(data.tasks.find((t) => t.run.id === 'unknown').tokens, null);
  assert.equal(summarizeUsage([{ usage: usage(0) }]).tokens, 0);
  assert.equal(summarizeUsage([{ usage: usage(0, false) }]).tokens, null);
  assert.equal(summarizeUsage([]).tokens, 0);
});

test('legacy routing uses decisions only without attempts, and exhausted worker usage is not counted twice', () => {
  const decision = {
    orchestrator: 'claude',
    orchestratorModel: 'model',
    orchestratorAccount: 'Personal',
    checkedAt: '2026-09-10T12:00:00Z',
    usage: usage(25),
  };
  const legacy = run('legacy', { routing: { decisions: [decision], handoffs: [] } });
  assert.equal(summarizeUsage(usageEntries([legacy])).tokens, 125);
  assert.equal(usageEntries([legacy])[1].agent, 'claude');
  assert.equal(
    summarizeUsage(usageEntries([{ ...legacy, routing: { ...legacy.routing, attempts: [] } }]))
      .tokens,
    100,
  );
  const exhausted = {
    ...legacy,
    routing: { ...legacy.routing, handoffs: [{ agent: 'codex', binding, usage: usage(100) }] },
  };
  assert.equal(summarizeUsage(usageEntries([exhausted])).tokens, 125);
});

test('calendar buckets include quiet days, preserve missing days and keep task identities separate', () => {
  const now = new Date(2026, 8, 10, 18);
  assert.equal(new Date(usageCutoff('7', now)).getDate(), 4);
  assert.equal(new Date(usageCutoff('7', now)).getHours(), 0);
  const runs = [
    run('a', { startedAt: now.toISOString(), taskId: 'shared' }),
    run('b', {
      startedAt: now.toISOString(),
      taskId: 'shared',
      projectPath: '/different',
      usage: usage(0, false),
    }),
  ];
  const result = usageInsights(usageEntries(runs), runs, '7', now);
  assert.equal(result.trend.length, 7);
  assert.equal(result.trend[0].tokens, 0);
  assert.equal(result.trend.at(-1).tokens, 100);
  assert.equal(result.trend.at(-1).missing, 1);
  assert.equal(result.tasks.length, 2);
  assert.equal(usageDateKey('invalid'), 'Undated');
  assert.equal(usageInsights(usageEntries(runs), runs, 'all').trend.length, 1);
});
