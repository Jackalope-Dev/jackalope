import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AWAY_THRESHOLD_MS,
  awaySince,
  buildCatchUp,
  catchUpHeadline,
  plainSummary,
} from '../src/lib/catch-up.ts';
import { collectWork, workPresence } from '../src/lib/task-collection.ts';

const since = '2026-10-30T09:00:00.000Z';
const base = {
  projectId: 'p',
  projectName: 'Shop',
  projectPath: 'C:/code/shop',
  workspace: 'C:/code/shop/.worktrees/task',
  targetBranch: 'main',
  startedAt: '2026-10-30T08:00:00.000Z',
  endedAt: '2026-10-30T10:00:00.000Z',
  status: 'review',
  result: '',
  prompt: 'Make search faster',
  sessionId: null,
};
const passed = {
  command: 'pnpm test',
  checkedAt: '2026-10-30T10:01:00.000Z',
  tree: 'abc1234',
  result: {
    success: true,
    exitCode: 0,
    timedOut: false,
    stdout: '',
    stderr: '',
    truncated: false,
    durationMs: 1,
  },
};

function catchUp(runs, extra = {}) {
  return buildCatchUp({
    items: collectWork(null, [], runs),
    runs,
    since,
    actionFor: (item) => workPresence(item).action,
    ...extra,
  });
}

test('away starts only after the threshold and ignores a first run', () => {
  const now = Date.parse('2026-10-30T12:00:00.000Z');
  assert.equal(awaySince(null, now), null);
  assert.equal(awaySince('not a time', now), null);
  assert.equal(awaySince(new Date(now - AWAY_THRESHOLD_MS + 1000).toISOString(), now), null);
  assert.equal(awaySince(since, now), since);
});

test('nothing changed while away keeps the catch-up hidden', () => {
  const old = { ...base, id: 'old', taskId: 'old', endedAt: '2026-10-30T08:30:00.000Z' };
  assert.equal(catchUp([old]), null);
});

test('work the person already opened after it changed is not reported again', () => {
  const run = { ...base, id: 'r', taskId: 'r', verification: passed };
  assert.equal(catchUp([run], { seen: { r: '2026-10-30T10:05:00.000Z' } }), null);
  assert.ok(catchUp([run], { seen: { r: '2026-10-30T09:30:00.000Z' } }));
});

test('a passing review names the call, its evidence, low risk and the next step', () => {
  const run = {
    ...base,
    id: 'r',
    taskId: 'r',
    result:
      '## Summary\n\nSearch is faster because of a missing index on products.\n\nMore detail.',
    verification: passed,
    reviewCaptures: {
      capturedAt: '2026-10-30T10:02:00.000Z',
      beforeAvailable: true,
      notes: [],
      pages: [
        {
          path: '/search',
          viewport: 'desktop',
          width: 1280,
          height: 800,
          reasons: [],
          criteria: [],
          after: {
            id: 'shot',
            name: 'after',
            url: '',
            filePath: '',
            width: 1,
            height: 1,
            timestamp: '',
          },
        },
      ],
    },
  };
  const result = catchUp([run], { changedFiles: { r: 3 } });
  assert.equal(result.headline, '“Make search faster” is ready for your review.');
  assert.deepEqual(
    result.happened.map((event) => [event.outcome, event.detail]),
    [['Ready for your review', 'Search is faster because of a missing index on products.']],
  );
  assert.equal(result.happened[0].picture.image.id, 'shot');
  const [decision] = result.waiting;
  assert.equal(decision.kind, 'review');
  assert.equal(decision.decision, 'Decide whether to merge these changes into main.');
  assert.equal(decision.changes, 'Merging adds its changes to main.');
  assert.deepEqual(decision.evidence, [
    'Project checks passed',
    'Before and after screenshots of 1 page',
    '3 files changed',
  ]);
  assert.equal(decision.risk.level, 'low');
  assert.equal(decision.suggestion, 'Review the changes, then merge them.');
  assert.equal(decision.action, 'Review and merge');
});

test('a review without checks says the risk is unknown and suggests nothing', () => {
  const run = { ...base, id: 'r', taskId: 'r' };
  const [decision] = catchUp([run]).waiting;
  assert.equal(decision.risk.level, 'unknown');
  assert.deepEqual(decision.evidence, ['No project checks ran']);
  assert.equal(decision.suggestion, undefined);
});

test('every waiting item is listed, highest stakes first, never folded into a count', () => {
  const runs = [
    { ...base, id: 'review', taskId: 'review', verification: passed },
    {
      ...base,
      id: 'question',
      taskId: 'question',
      status: 'running',
      endedAt: null,
      prompts: [
        {
          id: 'q',
          runId: 'question',
          question: 'Keep the old search page?',
          inputType: 'choice',
          options: ['Keep', 'Remove'],
          recommended: 'Keep',
          status: 'pending',
          createdAt: '2026-10-30T10:00:00.000Z',
        },
      ],
    },
    {
      ...base,
      id: 'failed-check',
      taskId: 'failed-check',
      verification: { ...passed, result: { ...passed.result, success: false, exitCode: 1 } },
    },
    { ...base, id: 'stopped', taskId: 'stopped', status: 'failed', error: 'Agent crashed\nstack' },
    { ...base, id: 'recovery', taskId: 'recovery', persistenceError: 'Disk full' },
  ];
  const result = catchUp(runs);
  assert.deepEqual(
    result.waiting.map((item) => item.kind),
    ['recovery', 'question', 'failed-check', 'stopped', 'review'],
  );
  assert.equal(
    result.headline,
    '5 things need you: a recovery, a question, a failed check, a stopped task and a review.',
  );
  const question = result.waiting[1];
  assert.equal(question.decision, 'Answer: “Keep the old search page?”');
  assert.equal(question.suggestion, 'Answer “Keep”, which the agent recommends.');
  assert.equal(question.risk.level, 'low');
  assert.equal(result.waiting[2].risk.level, 'high');
  assert.equal(result.waiting[3].evidence[0], 'Last error: Agent crashed');
  assert.equal(result.waiting[0].risk.level, 'high');
  // The question is a call, not an outcome, so it is not also in what happened.
  assert.ok(!result.happened.some((event) => event.item.id === 'question'));
  assert.ok(result.happened.some((event) => event.outcome === 'Failed: Agent crashed'));
});

test('work in the project folder is called out in its risk', () => {
  const run = {
    ...base,
    id: 'r',
    taskId: 'r',
    workspace: base.projectPath,
    status: 'stopped',
  };
  const [decision] = catchUp([run]).waiting;
  assert.equal(decision.kind, 'stopped');
  assert.equal(decision.risk.level, 'medium');
});

test('with nothing waiting the headline says so', () => {
  assert.equal(catchUpHeadline([]), 'Nothing needs you right now.');
});

test('plain summaries skip headings, paths, hashes and code', () => {
  assert.equal(
    plainSummary('# Summary\n```\ncode\n```\nFixed the login redirect. Also more.'),
    'Fixed the login redirect.',
  );
  assert.equal(
    plainSummary('Edited src/lib/search.ts for speed.\nSearch now uses an index.'),
    'Search now uses an index.',
  );
  assert.equal(plainSummary('Committed 9c185a00 to main.'), undefined);
  assert.equal(
    plainSummary('- **Faster search** with a new [index](https://x.dev).'),
    'Faster search with a new index.',
  );
  assert.ok(plainSummary('word '.repeat(60)).length <= 140);
});

test('a question that arrived while away is enough to show the catch-up', () => {
  const run = {
    ...base,
    id: 'q',
    taskId: 'q',
    status: 'running',
    endedAt: null,
    prompts: [
      {
        id: 'p',
        runId: 'q',
        question: 'Which page?',
        inputType: 'text',
        options: [],
        status: 'pending',
        createdAt: '2026-10-30T10:00:00.000Z',
      },
    ],
  };
  const result = catchUp([run]);
  assert.equal(result.happened.length, 0);
  assert.equal(result.headline, '“Make search faster” has a question for you.');
  assert.deepEqual(result.waiting[0].evidence, ['It asks for a written answer']);
});

test('a failing result opens the task instead of offering a merge', () => {
  const run = {
    ...base,
    id: 'f',
    taskId: 'f',
    verification: { ...passed, result: { ...passed.result, success: false, exitCode: 1 } },
  };
  const [decision] = catchUp([run]).waiting;
  assert.equal(decision.kind, 'failed-check');
  assert.equal(decision.action, 'Open task');
});
