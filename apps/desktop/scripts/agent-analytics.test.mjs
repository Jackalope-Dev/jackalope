import assert from 'node:assert/strict';
import test from 'node:test';
import { computeAgentAnalytics } from '../src/lib/agent-analytics.ts';
import { generateAgentInsights } from '../src/lib/agent-insights.ts';

const mockRuns = [
  {
    id: 'run-1',
    taskId: 't1',
    projectId: 'p1',
    projectName: 'Jackalope',
    prompt: 'Implement auth handlers',
    agent: 'codex',
    model: 'gpt-4o',
    status: 'reviewed',
    durationMs: 12000,
    usage: { reported: true, input: 4000, output: 800 },
    routing: {
      decisions: [],
      handoffs: [],
      attempts: 1,
    },
  },
  {
    id: 'run-2',
    taskId: 't2',
    projectId: 'p1',
    projectName: 'Jackalope',
    prompt: 'Build settings UI',
    agent: 'claude',
    model: 'claude-3-5-sonnet',
    status: 'review',
    durationMs: 28000,
    usage: { reported: true, input: 6000, output: 1200 },
    routing: {
      decisions: [],
      handoffs: [],
      attempts: 1,
    },
  },
  {
    id: 'run-3',
    taskId: 't3',
    projectId: 'p1',
    projectName: 'Jackalope',
    prompt: 'Refactor core harness',
    agent: 'codex',
    model: 'gpt-4o',
    status: 'reviewed',
    durationMs: 14000,
    usage: { reported: true, input: 5000, output: 900 },
    routing: {
      decisions: [],
      handoffs: [
        {
          agent: 'codex',
          model: 'gpt-4o',
          recordedAt: '2026-09-08',
          failure: { message: 'Provider rate limit exceeded' },
          result: 'partial',
          usage: { reported: true, input: 5000, output: 900 },
        },
      ],
      attempts: 2,
    },
  },
];

test('computeAgentAnalytics calculates per-agent speed, tokens and handoff saves', () => {
  const { metrics, impact } = computeAgentAnalytics(mockRuns);

  assert.equal(metrics.length, 2); // codex & claude

  const codex = metrics.find((m) => m.agent === 'codex');
  assert.ok(codex);
  assert.equal(codex.tasksCount, 2);
  assert.equal(codex.avgDurationMs, 13000); // (12000 + 14000) / 2
  assert.equal(codex.totalTokens, 10700); // (4800 + 5900)
  assert.equal(codex.successRate, 100);

  const claude = metrics.find((m) => m.agent === 'claude');
  assert.ok(claude);
  assert.equal(claude.tasksCount, 1);
  assert.equal(claude.avgDurationMs, 28000);
  assert.equal(claude.totalTokens, 7200);

  // Impact summary
  assert.equal(impact.totalTasks, 3);
  assert.equal(impact.totalHandoffs, 1);
  assert.equal(impact.rescuedTasksCount, 1);
  assert.equal(impact.estimatedTokensSaved, 25000);
  assert.ok(impact.hoursSaved > 0);
  assert.equal(impact.fastestAgent, 'codex');
});

test('generateAgentInsights produces actionable resilience and speed insights', () => {
  const { metrics, impact } = computeAgentAnalytics(mockRuns);
  const insights = generateAgentInsights(mockRuns, metrics, impact);

  assert.ok(insights.length >= 3);

  // Should contain handoff save insight
  const handoffInsight = insights.find((i) => i.id === 'handoff-resilience');
  assert.ok(handoffInsight);
  assert.ok(handoffInsight.description.includes('salvaged 1 task(s)'));
  assert.ok(handoffInsight.badge.includes('Quota Saves'));

  // Should contain speed comparison (Codex 2.2x faster than Claude)
  const speedInsight = insights.find((i) => i.id === 'codex-speed-win');
  assert.ok(speedInsight);
  assert.ok(speedInsight.badge.includes('Speedup'));

  // Should contain local LLM cost tip
  const localModelTip = insights.find((i) => i.id === 'local-models-tip');
  assert.ok(localModelTip);
});
