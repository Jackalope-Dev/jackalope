import assert from 'node:assert/strict';
import test from 'node:test';
import { describeRewind, groupRewound, pendingRewind, rewindOption } from '../src/lib/rewind.ts';

const turn = (id, minute, adapter = 'claude', extra = {}) => ({
  id,
  taskId: 'task',
  agent: adapter,
  accountBinding: { adapter, profileId: null, directory: '/accounts', label: 'Default' },
  status: 'review',
  startedAt: `2026-11-24T10:${String(minute).padStart(2, '0')}:00Z`,
  endedAt: `2026-11-24T10:${String(minute).padStart(2, '0')}:30Z`,
  workspace: '/work/tree',
  projectPath: '/work/project',
  sessionId: 'session',
  rewind: {
    checkpoint: {
      reference: `refs/jackalope/checkpoints/task/${id}`,
      commit: 'c',
      head: 'h',
      tree: 't',
    },
    mark: { session: 'session', entry: `${id}-last` },
  },
  ...extra,
});

const conversation = (adapter = 'claude') => [
  turn('one', 1, adapter),
  turn('two', 2, adapter),
  turn('three', 3, adapter),
];

test('Claude Code and Codex turns in a worktree offer Edit from here', () => {
  for (const adapter of ['claude', 'codex']) {
    const runs = conversation(adapter);
    for (const run of runs) assert.deepEqual(rewindOption(runs, run), { state: 'available' });
  }
});

test('agents that cannot return their conversation never show the action', () => {
  for (const adapter of ['opencode', 'gemini', 'kimi', 'grok', 'antigravity', 'acp']) {
    const runs = conversation(adapter);
    assert.deepEqual(rewindOption(runs, runs[1]), { state: 'hidden' });
  }
  const runs = conversation();
  // Work in the project checkout or outside Git has nothing Jackalope may restore.
  assert.deepEqual(rewindOption(runs, { ...runs[1], workspace: '/work/project/' }), {
    state: 'hidden',
  });
  assert.deepEqual(rewindOption(runs, { ...runs[1], nonCode: true }), { state: 'hidden' });
});

test('a running turn disables every rewind in its task and hides its own', () => {
  const runs = conversation();
  runs[2] = { ...runs[2], status: 'running' };
  assert.equal(rewindOption(runs, runs[2]).state, 'hidden');
  const option = rewindOption(runs, runs[0]);
  assert.equal(option.state, 'disabled');
  assert.match(option.reason, /Stop the running turn/);
  runs[2] = { ...runs[2], status: 'review', finishing: true };
  assert.equal(rewindOption(runs, runs[0]).state, 'disabled');
});

test('turns saved before checkpoints, or after an unmarked turn, say why they cannot rewind', () => {
  const runs = conversation();
  const { checkpoint: _, ...withoutCheckpoint } = runs[1].rewind;
  runs[1] = { ...runs[1], rewind: withoutCheckpoint };
  assert.match(rewindOption(runs, runs[1]).reason, /saved no copy/);
  runs[1] = { ...runs[1], rewind: { checkpointError: 'disk full' } };
  assert.match(rewindOption(runs, runs[1]).reason, /disk full/);
  // Older saved attempts have no rewind fields at all.
  const old = conversation().map(({ rewind: _, ...run }) => run);
  assert.equal(rewindOption(old, old[1]).state, 'disabled');

  const unmarked = conversation();
  unmarked[0] = { ...unmarked[0], rewind: { checkpoint: unmarked[0].rewind.checkpoint } };
  assert.match(rewindOption(unmarked, unmarked[1]).reason, /did not record/);
  // The first turn needs no earlier conversation.
  assert.equal(rewindOption(unmarked, unmarked[0]).state, 'available');
  assert.equal(
    rewindOption(unmarked, { ...unmarked[0], continues: { adapter: 'claude', sessionId: 'x' } })
      .state,
    'disabled',
  );
});

test('rewound turns collapse, offer nothing, and the latest one carries the pending Undo', () => {
  const rewind = {
    id: 'r1',
    at: 'now',
    turnRunId: 'two',
    turn: 2,
    rewoundRunIds: ['two', 'three'],
    restored: {},
    safety: {},
    resume: { kind: 'claude', session: 'session', at: 'one-last' },
  };
  const runs = conversation();
  runs[1] = { ...runs[1], rewind: { ...runs[1].rewind, rewound: { rewindId: 'r1', at: 'now' } } };
  runs[2] = {
    ...runs[2],
    rewind: { ...runs[2].rewind, rewound: { rewindId: 'r1', at: 'now' }, applied: rewind },
  };
  assert.deepEqual(rewindOption(runs, runs[1]), { state: 'hidden' });
  assert.equal(pendingRewind(runs, 'task')?.id, 'r1');
  // A turn after the rewind continues from turn one, so it is the second in effect.
  const four = turn('four', 4);
  assert.equal(rewindOption([...runs, four], four).state, 'available');
  assert.equal(pendingRewind([...runs, four], 'task'), null);
  runs[2].rewind.applied = { ...rewind, undoneAt: 'later' };
  assert.equal(pendingRewind(runs, 'task'), null);

  const groups = groupRewound(runs, (run) => !!run.rewind?.rewound);
  assert.deepEqual(
    groups.map((group) => [group.rewound, group.items.map((run) => run.id)]),
    [
      [false, ['one']],
      [true, ['two', 'three']],
    ],
  );
});

test('the confirmation says what is undone, what files return and that work is kept', () => {
  const later = describeRewind({
    runId: 'two',
    latestRunId: 'three',
    turn: 2,
    undone: 2,
    conversation: 'codex',
    prompt: 'x',
  });
  assert.equal(
    later.summary,
    'This will undo 2 turns (turns 2 to 3) and restore files to how they were after turn 1. Uncommitted changes made since will be kept in a safety snapshot.',
  );
  assert.match(later.conversation, /^Codex continues from the end of turn 1/);
  const first = describeRewind({
    runId: 'one',
    latestRunId: 'one',
    turn: 1,
    undone: 1,
    conversation: 'new',
    prompt: 'x',
  });
  assert.match(
    first.summary,
    /^This will undo turn 1 and restore files to how they were before the first turn\./,
  );
  assert.match(first.conversation, /new conversation/);
});
