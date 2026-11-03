import assert from 'node:assert/strict';
import test from 'node:test';
import { moveNewWorkDraft } from '../src/drafts.ts';
import {
  groupWork,
  requestText,
  taskStatus,
  workRows,
  workSummary,
  workTitle,
} from '../src/status.ts';

const task = (fields) => ({
  id: 'run',
  taskId: 'task',
  sessionId: null,
  projectId: 'p',
  projectName: 'Site',
  title: 'Fix the footer',
  status: 'running',
  result: '',
  error: null,
  startedAt: '2026-11-01T10:00:00Z',
  prompts: [],
  activity: [],
  ...fields,
});

test('titles skip section headings and Markdown markers', () => {
  assert.equal(
    workTitle('### 🎯 Objective\n\nThe pre-commit hook rejected a commit'),
    'The pre-commit hook rejected a commit',
  );
  assert.equal(workTitle('Live session: **Ship** the `beta`\nmore'), 'Ship the beta');
  assert.equal(workTitle('- keep snake_case names'), 'keep snake_case names');
  assert.equal(workTitle('## Only a heading'), 'Only a heading');
  assert.equal(workTitle('  \n'), 'Untitled work');
});

test('a live session request shows only the messages, not the host instructions', () => {
  const batch = [
    'Live session: Fix the footer …',
    'Handle the following user messages in order as one coherent batch. Do not commit.',
    'This folder is not a Git repository. Edit files in place.',
    '',
    'User message 8465324d-d302-4373-bb75-8d9fb063a288:',
    'Fix the footer on mobile',
    '- keep the links',
    '',
    'User answer (Scope) 121fa6f3-a12a-4753-a332-1096052ccf16:',
    'Phone only',
    '',
  ].join('\n');
  assert.equal(requestText(batch), 'Fix the footer on mobile\n- keep the links\n\nPhone only');
  assert.equal(workTitle(batch), 'Fix the footer …');
  assert.equal(
    requestText('Live session: Fix the footer …\nHandle the following user messages in'),
    'Fix the footer …',
  );
  assert.equal(requestText('  Plain request\nUser message 1:\n'), 'Plain request\nUser message 1:');
});

test('an unanswered question in the list marks running work as needing you', () => {
  const asked = task({ prompts: [{ id: 'q', status: 'pending' }] });
  assert.equal(taskStatus(asked).label, 'Needs your answer');
  assert.equal(taskStatus(task({})).label, 'Working');
});

test('rows list waiting conversations, then the latest attempt per thread', () => {
  const rows = workRows({
    projects: [{ id: 'p', name: 'Site' }],
    sessions: [
      {
        id: 'waiting',
        title: 'Plan the launch',
        projectId: 'p',
        paused: false,
        error: null,
        pending: 1,
      },
      { id: 'live', title: 'Live', projectId: 'p', paused: false, error: null, pending: 0 },
    ],
    tasks: [
      task({ id: 'new', sessionId: 'live', status: 'review' }),
      task({ id: 'old', sessionId: 'live', status: 'failed' }),
    ],
  });
  assert.deepEqual(
    rows.map((row) => [row.id, row.status.label]),
    [
      ['waiting', 'Queued'],
      ['live', 'Ready to review'],
    ],
  );
  assert.equal(rows[0].projectName, 'Site');
  assert.equal(workSummary(rows), '1 needs you');
  assert.equal(workSummary([]), '');
});

const row = (id, status, startedAt) => ({
  id,
  title: id,
  projectName: 'Site',
  startedAt,
  status: { label: '', variant: 'neutral', ...status },
});

test('groups put unstarted conversations first, then the newest work', () => {
  const groups = groupWork([
    row('old', { needsYou: true, working: false }, '2026-11-01T09:00:00Z'),
    row('waiting', { needsYou: true, working: false }),
    row('new', { needsYou: true, working: false }, '2026-11-01T11:00:00Z'),
    row('running', { needsYou: false, working: true }, '2026-11-01T10:00:00Z'),
    row('done', { needsYou: false, working: false }, '2026-11-01T08:00:00Z'),
  ]);
  assert.deepEqual(
    groups.map(([label, items]) => [label, items.map((item) => item.id)]),
    [
      ['Needs you', ['waiting', 'new', 'old']],
      ['Working', ['running']],
      ['Recent', ['done']],
    ],
  );
  assert.deepEqual(
    groupWork([]).map(([label, items]) => [label, items.length]),
    [
      ['Needs you', 0],
      ['Working', 0],
      ['Recent', 0],
    ],
  );
});

test('summaries count needs and work with plurals', () => {
  const needs = { needsYou: true, working: false };
  const busy = { needsYou: false, working: true };
  assert.equal(
    workSummary([row('a', needs), row('b', needs), row('c', busy)]),
    '2 need you · 1 working',
  );
  assert.equal(workSummary([row('c', busy)]), '1 working');
  assert.equal(workSummary([row('d', { needsYou: false, working: false })]), '');
});

const memoryStorage = (entries = {}) => {
  const items = new Map(Object.entries(entries));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
    removeItem: (key) => items.delete(key),
  };
};

test('a new-work draft follows a change of computer without its send request', () => {
  const storage = memoryStorage({
    'jackalope-mobile:a:draft:new': 'Fix the footer',
    'jackalope-mobile:a:draft:new:request': '{"requestId":"r1"}',
  });
  assert.equal(moveNewWorkDraft(storage, 'a', 'b'), true);
  assert.equal(storage.getItem('jackalope-mobile:b:draft:new'), 'Fix the footer');
  assert.equal(storage.getItem('jackalope-mobile:a:draft:new'), null);
  assert.equal(storage.getItem('jackalope-mobile:b:draft:new:request'), null);
  assert.equal(storage.getItem('jackalope-mobile:a:draft:new:request'), '{"requestId":"r1"}');
});

test('an empty draft leaves the other computer untouched, and storage failures are reported', () => {
  const storage = memoryStorage({ 'jackalope-mobile:b:draft:new': 'Kept' });
  assert.equal(moveNewWorkDraft(storage, 'a', 'b'), true);
  assert.equal(storage.getItem('jackalope-mobile:b:draft:new'), 'Kept');
  const broken = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {},
    removeItem: () => {},
  };
  assert.equal(moveNewWorkDraft(broken, 'a', 'b'), false);
});
