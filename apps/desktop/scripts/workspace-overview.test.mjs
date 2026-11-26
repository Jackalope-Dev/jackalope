import assert from 'node:assert/strict';
import test from 'node:test';
import { liveWork } from '../src/lib/live-work.ts';
import { collectWorkspaceWork } from '../src/lib/task-collection.ts';
import {
  finishedOutcome,
  projectSummaries,
  recentlyFinished,
} from '../src/lib/workspace-overview.ts';

const run = (id, extra = {}) => ({
  id,
  taskId: `task-${id}`,
  projectId: 'a',
  projectPath: '/a',
  workspace: `/a/.worktrees/${id}`,
  prompt: id,
  agent: 'claude',
  model: 'model-a',
  status: 'review',
  startedAt: '2026-11-24T10:00:00Z',
  endedAt: '2026-11-24T10:20:00Z',
  activity: [],
  ...extra,
});
const running = (id, extra = {}) => run(id, { status: 'running', endedAt: null, ...extra });
const emptyQueue = { items: [], messages: [], enabledProjects: [], mergedRunIds: [] };
const conversation = (id, extra = {}) => ({
  id,
  title: id,
  request: { projectId: 'a', agent: 'claude' },
  updatedAt: '2026-11-24T10:00:00Z',
  messages: [],
  batches: [],
  paused: false,
  closed: false,
  ...extra,
});

function live(runs, { sessions = [], queue = emptyQueue, schedules } = {}) {
  const items = collectWorkspaceWork(null, runs, { sessions, queue });
  return liveWork({ items, runs, sessions, queue, schedules });
}

test('running now lists live work only, with what it is doing and who is waiting', () => {
  const finishedTurn = run('old', { liveSessionId: 'old', startedAt: '2026-10-13T22:52:14Z' });
  const entries = live(
    [
      finishedTurn,
      running('search', {
        startedAt: '2026-11-24T10:10:00Z',
        progress: { label: 'Working', detail: 'Editing src/search.ts', startedAt: '' },
      }),
      running('asking', {
        agent: 'codex',
        prompts: [{ id: 'q', status: 'pending', question: 'Which one?' }],
      }),
      running('checking', { finishing: true, startedAt: '2026-11-24T10:12:00Z' }),
    ],
    {
      sessions: [
        // Finished weeks ago, with an answer typed into it later that never ran.
        conversation('old', {
          closed: true,
          paused: true,
          messages: [
            { id: 'sent', runId: 'old', canceled: false },
            { id: 'unsent', runId: null, canceled: false },
          ],
          batches: [{ runId: 'old', error: null, settled: true }],
        }),
      ],
      schedules: { checking: 'Nightly checks' },
    },
  );
  assert.deepEqual(
    entries.map((entry) => entry.key),
    ['task-asking', 'task-checking', 'task-search'],
  );
  assert.equal(entries[0].waiting, true);
  assert.equal(entries[0].phase, 'Waiting for your answer');
  assert.deepEqual(entries[0].agents, ['codex']);
  assert.equal(entries[1].phase, 'Checking result');
  assert.equal(entries[1].schedule, 'Nightly checks');
  assert.equal(entries[2].current, 'Editing src/search.ts');
  assert.equal(entries[2].model, 'model-a');
});

test('running now includes planned workers, bot replies and agent reviews once each', () => {
  const queue = {
    ...emptyQueue,
    enabledProjects: ['managed:plan'],
    managedTasks: [
      {
        id: 'plan',
        title: 'Invoices by team',
        request: { projectId: 'a', agent: 'claude' },
        plannerRunId: 'planner',
        runIds: [],
        createdAt: '2026-11-24T09:00:00Z',
        started: true,
        error: null,
      },
    ],
    items: [
      { id: 'i1', featureId: 'plan', runId: 'w1', error: null, canceled: false },
      { id: 'i2', featureId: 'plan', runId: 'w2', error: null, canceled: false },
    ],
  };
  const runs = [
    run('planner', { status: 'reviewed' }),
    running('w1', { startedAt: '2026-11-24T10:05:00Z' }),
    running('w2', { agent: 'codex', model: 'model-b', startedAt: '2026-11-24T10:01:00Z' }),
    run('result'),
    running('reviewer', { challengeOf: { runId: 'result', kind: 'review' } }),
    running('bot-turn', { liveSessionId: 'bot' }),
  ];
  const sessions = [
    conversation('bot', {
      persona: { botId: 'scout', name: 'Scout' },
      batches: [{ runId: 'bot-turn' }],
    }),
  ];
  const entries = live(runs, { sessions, queue });
  const byKind = Object.fromEntries(entries.map((entry) => [entry.kind, entry]));
  assert.equal(entries.length, 3);
  assert.equal(byKind.planned.workers, 2);
  assert.deepEqual(byKind.planned.agents.sort(), ['claude', 'codex']);
  assert.equal(byKind.planned.model, null, 'workers on different models name none');
  assert.equal(byKind.planned.since, '2026-11-24T10:01:00Z', 'elapsed counts from the first');
  assert.equal(byKind.bot.session.id, 'bot');
  assert.equal(byKind.review.item.run.id, 'result', 'a review opens the task it reviews');
});

test('project summaries put work that needs the person first and gather its status', () => {
  const projects = [
    { id: 'a', name: 'Atlas', gitBranch: 'main', preferences: { baseBranch: 'release' } },
    { id: 'b', name: 'Orbit', gitBranch: 'develop' },
    { id: 'c', name: 'Quiet', gitBranch: 'main', plainFolder: true },
  ];
  const check = (success, checkedAt) => ({
    command: 'pnpm test',
    checkedAt,
    tree: 't',
    result: { success },
  });
  const runs = [
    running('a-live'),
    run('a-ready', { verification: check(true, '2026-11-24T11:00:00Z') }),
    run('a-old', {
      verification: check(false, '2026-11-24T09:00:00Z'),
      endedAt: '2026-11-24T09:00:00Z',
    }),
    run('a-review'),
    run('b-failed', { projectId: 'b', verification: check(false, '2026-11-24T08:00:00Z') }),
    run('b-pr', { projectId: 'b' }),
  ];
  const pullRequests = {
    'task-b-pr': { taskId: 'task-b-pr', runId: 'b-pr', url: 'u', number: 7, phase: 'failing' },
    'task-a-ready': { taskId: 'task-a-ready', runId: 'a-ready', url: 'v', phase: 'merged' },
  };
  const items = collectWorkspaceWork(null, runs, {
    pullRequests,
    ideas: [
      {
        id: 'draft',
        projectId: 'a',
        title: 'Idea',
        rawPrompt: 'Idea',
        status: 'backlog',
        updatedAt: '2026-11-20T00:00:00Z',
      },
    ],
  });
  const summaries = projectSummaries({
    projects,
    items,
    live: liveWork({ items, runs, sessions: [], queue: emptyQueue }),
    runs,
    pullRequests,
    previews: { 'a-ready': 61234 },
  });
  assert.deepEqual(
    summaries.map((summary) => summary.project.name),
    ['Orbit', 'Atlas', 'Quiet'],
  );
  const [orbit, atlas, quiet] = summaries;
  assert.equal(orbit.needsYou, 2, 'a failed check and a failing pull request');
  assert.deepEqual(
    orbit.pullRequests.map(({ pullRequest }) => pullRequest.number),
    [7],
  );
  assert.equal(orbit.lastCheck.success, false);
  assert.equal(orbit.targetBranch, 'develop');
  assert.deepEqual(
    [atlas.running, atlas.needsYou, atlas.reviewReady, atlas.drafts],
    [1, 1, 1, 1],
    'a merged pull request finishes its task',
  );
  assert.equal(atlas.pullRequests.length, 0, 'merged pull requests are not open');
  assert.equal(atlas.lastCheck.success, true, 'the newest check counts');
  assert.equal(atlas.targetBranch, 'release');
  assert.deepEqual(atlas.previews, [
    { runId: 'a-ready', port: 61234, item: items.find((item) => item.run?.id === 'a-ready') },
  ]);
  assert.equal(quiet.targetBranch, undefined);
  assert.equal(quiet.lastActivity, undefined);
});

test('recently finished lists completed and merged work, newest first', () => {
  const runs = [
    run('merged', { status: 'reviewed', endedAt: '2026-11-24T12:00:00Z' }),
    run('ready', { endedAt: '2026-11-24T11:00:00Z' }),
    running('live'),
  ];
  const queue = { ...emptyQueue, mergedRunIds: ['merged'] };
  const items = collectWorkspaceWork(null, runs, { queue });
  const finished = recentlyFinished(items, 5);
  assert.deepEqual(
    finished.map((item) => item.run.id),
    ['merged', 'ready'],
  );
  assert.equal(finishedOutcome(finished[0], queue.mergedRunIds), 'Merged');
  assert.equal(finishedOutcome(finished[1], queue.mergedRunIds), 'Ready to review');
  assert.equal(recentlyFinished(items, 1).length, 1);
});
