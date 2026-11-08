import assert from 'node:assert/strict';
import test from 'node:test';
import { moveNewWorkDraft } from '../src/drafts.ts';
import { groupWork, workRows, workSummary } from '../src/status.ts';

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
