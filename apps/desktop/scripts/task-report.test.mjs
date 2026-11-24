import assert from 'node:assert/strict';
import test from 'node:test';
import {
  stageTotals,
  takeaway,
  timeBreakdown,
  toolLabel,
  toolUse,
  waitingMs,
} from '../src/lib/task-report.ts';

const run = (efficiency = {}, extra = {}) => ({
  startedAt: '2026-11-24T10:00:00Z',
  endedAt: '2026-11-24T10:20:00Z',
  efficiency,
  ...extra,
});
const time = (wallMs, calls = 0, longestMs = 0) => ({ wallMs, calls, longestMs });

test('time breakdown groups measured kinds and leaves waiting on the person out', () => {
  const breakdown = timeBreakdown([
    run({
      activity: {
        think: time(240_000),
        read: time(120_000, 9, 4_000),
        search: time(60_000, 4),
        check: time(480_000, 3, 300_000),
        ask: time(900_000, 1),
      },
    }),
    run({ activity: { check: time(120_000, 1, 120_000), edit: time(0, 6) } }),
    run({ toolCalls: { Read: 3 } }),
  ]);
  assert.equal(breakdown.measured, true);
  assert.equal(breakdown.measuredAttempts, 2);
  assert.equal(breakdown.attempts, 3);
  assert.equal(breakdown.workingMs, 1_020_000);
  assert.deepEqual(
    breakdown.groups.map((group) => [group.id, group.ms]),
    [
      ['think', 240_000],
      ['read', 180_000],
      ['check', 600_000],
      ['app', 0],
      ['other', 0],
    ],
  );
  assert.equal(breakdown.lines[0].kind, 'check');
  assert.equal(breakdown.lines[0].calls, 4);
  assert.equal(breakdown.lines[0].longestMs, 300_000);
  assert.ok(!breakdown.lines.some((line) => line.kind === 'ask'));
  assert.match(takeaway(breakdown), /^Tests and builds took 59% of the agent's time/);
});

test('attempts recorded before measurement report no breakdown or takeaway', () => {
  const breakdown = timeBreakdown([run({ toolCalls: { Bash: 2 } })]);
  assert.equal(breakdown.measured, false);
  assert.equal(takeaway(breakdown), null);
});

test('tools merge counts and timings across attempts, slowest first', () => {
  const tools = toolUse([
    run({
      toolCalls: { Read: 5, mcp__jackalope__browser_navigate: 2 },
      toolTime: {
        mcp__jackalope__browser_navigate: { kind: 'app', totalMs: 9_000, longestMs: 7_000 },
      },
    }),
    run({ toolCalls: { Read: 2, 'linear:get_issue': 1 } }),
  ]);
  assert.deepEqual(
    tools.map((tool) => [tool.label, tool.calls, tool.totalMs]),
    [
      ['Browser navigate', 2, 9_000],
      ['Read', 7, null],
      ['Get issue (linear)', 1, null],
    ],
  );
  assert.equal(toolLabel('mcp__claude_ai_Linear__get_issue'), 'Get issue (claude_ai_Linear)');
  assert.equal(toolLabel('command_execution'), 'Shell commands');
});

test('waiting counts only answers the person gave, and stages split setup, agent and checks', () => {
  const runs = [
    run(
      {},
      {
        prompts: [
          { createdAt: '2026-11-24T10:01:00Z', answeredAt: '2026-11-24T10:04:00Z' },
          {
            createdAt: '2026-11-24T10:05:00Z',
            answeredAt: '2026-11-24T10:05:30Z',
            answeredBy: { agent: 'codex' },
          },
          { createdAt: '2026-11-24T10:06:00Z', answeredAt: null },
        ],
        stages: [
          { stage: 'preparation', durationMs: 30_000 },
          { stage: 'routing', durationMs: 5_000 },
          { stage: 'execution', durationMs: 600_000 },
          { stage: 'verification', durationMs: 90_000 },
          { stage: 'execution', durationMs: null },
        ],
      },
    ),
  ];
  assert.equal(waitingMs(runs), 180_000);
  assert.deepEqual(stageTotals(runs), {
    setupMs: 35_000,
    agentMs: 600_000,
    checkMs: 90_000,
    elapsedMs: 1_200_000,
  });
});
