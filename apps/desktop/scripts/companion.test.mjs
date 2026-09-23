import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taskNotices } from '../src/lib/companion-tasks.ts';
import { shouldNotify, sortNotices, useCompanionStore } from '../src/stores/companionStore.ts';

const run = (id, status, extra = {}) => ({
  id,
  taskId: id,
  projectId: 'project-a',
  projectName: 'Project A',
  prompt: 'Build the search page',
  status,
  startedAt: '2026-09-06T12:00:00Z',
  prompts: [],
  ...extra,
});

test('a task question has a stable identity, targets its exact attempt, and clears when answered', () => {
  const task = run('a', 'running', {
    prompts: [{ id: 'question-a', status: 'pending', question: 'Which scope?' }],
  });
  let selected;
  const first = taskNotices([task], (value) => {
    selected = value;
  });
  assert.equal(first[0].kind, 'attention');
  assert.match(first[0].detail, /Which scope/);
  first[0].onOpen();
  assert.equal(selected, task);
  assert.equal(taskNotices([{ ...task }], () => {})[0].id, first[0].id);
  task.prompts[0].status = 'answered';
  assert.deepEqual(
    taskNotices([task], () => {}),
    [],
  );
});

test('retries replace old failures and retain the original task title', () => {
  const failed = run('old', 'failed');
  const retry = run('new', 'running', {
    taskId: 'old',
    startedAt: '2026-09-06T13:00:00Z',
    prompt: 'Retry with a smaller scope',
  });
  assert.deepEqual(
    taskNotices([retry, failed], () => {}),
    [],
  );
  const notices = taskNotices([{ ...retry, status: 'review' }, failed], () => {});
  assert.equal(notices.length, 1);
  assert.match(notices[0].detail, /Build the search page/);
  assert.equal(notices[0].id, 'task:new:review');
});

test('stale questions on terminal runs do not mask failure or review', () => {
  for (const status of ['failed', 'interrupted', 'review']) {
    const notices = taskNotices(
      [run('a', status, { prompts: [{ id: 'q', status: 'pending' }] })],
      () => {},
    );
    assert.equal(notices.length, 1);
    assert.equal(notices[0].id, `task:a:${status}`);
  }
  for (const status of ['stopped', 'reviewed', 'starting'])
    assert.equal(taskNotices([run('a', status)], () => {}).length, 0);
});

test('notifications follow the latest attempt across timestamp offsets', () => {
  const old = run('old', 'failed', { startedAt: '2026-09-06T19:00:00Z' });
  const current = run('current', 'running', {
    taskId: 'old',
    startedAt: '2026-09-06T14:00:00-06:00',
  });
  assert.deepEqual(
    taskNotices([current, old], () => {}),
    [],
  );
});

test('attention sorts first and duplicate sources do not produce duplicate notices', () => {
  const info = { id: 'update', kind: 'info' };
  assert.deepEqual(
    sortNotices([
      info,
      { id: 'result', kind: 'success' },
      { id: 'question', kind: 'attention' },
      info,
    ]).map((notice) => notice.id),
    ['question', 'result', 'update'],
  );
});

test('quiet preferences suppress interruption without filtering the notification sources', () => {
  for (const kind of ['attention', 'success', 'info']) {
    assert.equal(shouldNotify(kind, 'none'), false);
    assert.equal(shouldNotify(kind, 'all'), true);
    assert.equal(shouldNotify(kind, 'failures-only'), kind === 'attention');
  }
});

test('marking a notice read persists acknowledgment without resolving or deleting its source', () => {
  const saved = new Map();
  globalThis.localStorage = { setItem: (key, value) => saved.set(key, value) };
  const state = useCompanionStore.getState;
  const notice = {
    id: 'save:one',
    title: 'Unsaved history',
    detail: 'Keep app open',
    kind: 'attention',
  };
  state().publish('save', [notice]);
  state().markRead([notice.id]);
  assert.deepEqual(state().sources.save, [notice]);
  assert.deepEqual(JSON.parse(saved.get('jackalope-companion-read-v1')), ['save:one']);
  state().publish('save', [{ ...notice }]);
  assert.ok(state().readIds.includes(notice.id));
  globalThis.localStorage.setItem = () => {
    throw new Error('Storage full');
  };
  assert.doesNotThrow(() => state().markRead(['other']));
  state().remove('save');
  assert.equal(state().sources.save, undefined);
  delete globalThis.localStorage;
});
