import assert from 'node:assert/strict';
import test from 'node:test';
import { moveNewWorkDraft } from '../src/drafts.ts';
import { groupWork, isOlder, workAction, workRows, workSummary } from '../src/status.ts';

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
      ['Finished', ['done']],
    ],
  );
  assert.deepEqual(
    groupWork([]).map(([label, items]) => [label, items.length]),
    [
      ['Needs you', 0],
      ['Working', 0],
      ['Finished', 0],
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

test('queued and paused work stays under Working, as on the desktop', () => {
  const groups = groupWork([
    row('queued', { label: 'Queued', needsYou: false, working: false }),
    row('paused', { label: 'Paused', needsYou: false, working: false }),
    row('stopped', { label: 'Stopped', needsYou: false, working: false }),
  ]);
  assert.deepEqual(
    groups.map(([label, items]) => [label, items.map((item) => item.id)]),
    [
      ['Needs you', []],
      ['Working', ['queued', 'paused']],
      ['Finished', ['stopped']],
    ],
  );
});

test('rows name their next step and drop statuses the step already says', () => {
  const status = (label) => ({ label, variant: 'default', needsYou: false, working: false });
  assert.deepEqual(workAction({ status: status('Needs your answer'), conversation: true }), {
    action: 'Answer question',
    showStatus: false,
  });
  assert.equal(
    workAction({ status: status('Ready to review'), conversation: false }).action,
    'Review result',
  );
  assert.equal(
    workAction({ status: status('Ready to review'), conversation: true }).action,
    'Reply',
  );
  assert.deepEqual(workAction({ status: status('Needs attention'), conversation: false }), {
    action: 'Inspect task',
    showStatus: true,
  });
  assert.equal(workAction({ status: status('Stopped'), conversation: false }).showStatus, true);
});

test('titles drop a leading run id, and old waiting work reads as older', () => {
  const [first] = workRows({
    projects: [{ id: 'p', name: 'Site' }],
    sessions: [],
    tasks: [task({ title: 'resume 02f4245e-f796-4353-a8e0-b8cc79871beb Always allow python' })],
  });
  assert.equal(first.title, 'Always allow python');
  const now = Date.parse('2026-11-12T00:00:00Z');
  assert.equal(isOlder({ startedAt: '2026-11-01T00:00:00Z' }, now), true);
  assert.equal(isOlder({ startedAt: '2026-11-10T00:00:00Z' }, now), false);
  assert.equal(isOlder({}, now), false);
});

test('an unreachable computer says whether it is offline and when it was last seen', async () => {
  const { connectionState, lastSeen } = await import('../src/status.ts');
  assert.equal(
    connectionState(
      'The host is unreachable. Work continues there; reconnect to check whether your last action completed.',
    ),
    'offline',
  );
  assert.equal(connectionState('Connection interrupted. Try again.'), 'offline');
  assert.equal(connectionState('This device was removed on the host.'), "can't connect");
  const now = Date.parse('2026-11-12T12:00:00Z');
  assert.equal(lastSeen('2026-11-12T10:00:00Z', now), 'last seen 2h ago');
  assert.equal(lastSeen('2026-11-12T11:59:50Z', now), 'last seen just now');
  assert.equal(lastSeen(undefined, now), 'not reached from this phone yet');
});

test('rows carry the project hint a host sends, and hosts without hints still list', () => {
  const sessions = [
    { id: 's', title: 'Chat', projectId: 'b', paused: false, error: null, pending: 1 },
  ];
  const hinted = workRows({
    projects: [
      { id: 'p', name: 'shop', hint: 'take2' },
      { id: 'b', name: 'shop', hint: 'take3' },
    ],
    sessions,
    tasks: [task({ projectName: 'shop' })],
  });
  assert.deepEqual(
    hinted.map((row) => [row.projectId, row.projectHint]),
    [
      ['b', 'take3'],
      ['p', 'take2'],
    ],
  );
  const older = workRows({ projects: [{ id: 'b', name: 'shop' }], sessions, tasks: [] });
  assert.equal(older[0].projectHint, undefined);
  assert.equal(older[0].projectName, 'shop');
});
