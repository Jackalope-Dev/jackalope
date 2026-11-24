import assert from 'node:assert/strict';
import test from 'node:test';

const { activeIn, importable, initialSelection, worthOffering } = await import(
  '../src/lib/imported-conversations.ts'
);

const day = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-11-24T12:00:00Z');
const session = (key, status, daysAgo) => ({
  key,
  agent: 'claude',
  agentName: 'Claude Code',
  sessionId: key,
  title: key,
  cwd: '/repo',
  lastAt: new Date(now - daysAgo * day).toISOString(),
  messages: 2,
  status,
});
const groups = [
  {
    path: '/repo',
    projectId: 'project-1',
    exists: true,
    repository: true,
    sessions: [
      session('fresh', 'new', 1),
      session('grown', 'changed', 20),
      session('done', 'imported', 3),
      session('continued', 'continued', 2),
    ],
  },
  {
    path: '/other',
    projectId: null,
    exists: true,
    repository: true,
    sessions: [session('outside', 'new', 200)],
  },
];

test('only new and grown sessions in a project can be imported', () => {
  assert.deepEqual(
    groups.flatMap((group) =>
      group.sessions.filter((item) => importable(group, item)).map((item) => item.key),
    ),
    ['fresh', 'grown'],
  );
  assert.deepEqual([...initialSelection(groups)], ['fresh', 'grown']);
});

test('the date filter keeps sessions active in the period and drops empty groups', () => {
  assert.equal(activeIn(groups, 'all', now), groups);
  const week = activeIn(groups, 'week', now);
  assert.deepEqual(
    week.map((group) => group.sessions.map((item) => item.key)),
    [['fresh', 'done', 'continued']],
  );
  assert.equal(activeIn(groups, 'year', now).length, 2);
  const unreadable = [{ ...groups[0], sessions: [{ ...session('x', 'new', 0), lastAt: 'soon' }] }];
  assert.deepEqual(activeIn(unreadable, 'week', now), []);
});

test('the offer appears only for a new conversation in a folder that exists', () => {
  assert.equal(worthOffering({ groups, stores: [] }), true);
  assert.equal(worthOffering({ groups: [], stores: [] }), false);
  assert.equal(
    worthOffering({
      groups: [
        { ...groups[1], exists: false },
        { ...groups[0], sessions: [groups[0].sessions[2]] },
      ],
      stores: [],
    }),
    false,
  );
});

test('import progress is announced at quarters, not with every conversation', async () => {
  const { importMilestone } = await import('../src/lib/imported-conversations.ts');
  const milestones = Array.from({ length: 41 }, (_, done) => importMilestone({ done, total: 40 }));
  assert.equal(new Set(milestones).size, 5);
  assert.deepEqual([milestones[0], milestones[9], milestones[10], milestones[40]], [0, 0, 1, 4]);
  assert.equal(importMilestone({ done: 0, total: 0 }), 0);
});
