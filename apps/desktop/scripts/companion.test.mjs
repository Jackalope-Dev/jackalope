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

test('the task on screen gets no notice, since its page already asks', () => {
  const task = run('a', 'running', {
    prompts: [{ id: 'question-a', status: 'pending', question: 'Which scope?' }],
  });
  assert.deepEqual(
    taskNotices([task], () => {}, 'a'),
    [],
  );
  assert.equal(taskNotices([task], () => {}, 'b').length, 1);
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

const notice = (id, kind = 'attention', title = id) => ({ id, kind, title, detail: '' });

test('only notices that arrive after the first load are announced, never launch-time state', async () => {
  const { freshNotices } = await import('../src/lib/companion-announce.ts');
  const existing = [notice('task:a:review', 'success'), notice('task:b:failed')];
  // Before history settles nothing is fresh, so pre-existing review and failure stay quiet.
  assert.deepEqual(freshNotices(existing, new Set(), false), []);
  // After seeding with what was there at launch, only a new transition is fresh.
  const announced = new Set(existing.map((item) => item.id));
  const later = [...existing, notice('task:c:question:q1')];
  assert.deepEqual(
    freshNotices(later, announced, true).map((item) => item.id),
    ['task:c:question:q1'],
  );
  // A state change is a new transition; the same state again is not.
  assert.deepEqual(freshNotices([notice('task:a:failed')], announced, true).length, 1);
  assert.deepEqual(freshNotices([notice('task:a:review', 'success')], announced, true), []);
});

test('several arrivals coalesce into one summary bubble that joins a bubble still showing', async () => {
  const { coalesce, hintStillRelevant } = await import('../src/lib/companion-announce.ts');
  assert.equal(coalesce([]), null);
  const one = coalesce([notice('task:a:review', 'success', 'Ready for your review')]);
  assert.equal(one.title, 'Ready for your review');
  assert.deepEqual(one.ids, ['task:a:review']);
  const many = coalesce([notice('task:b:failed'), notice('plan:p:needs-you')], one);
  assert.equal(many.title, '3 things need you');
  assert.equal(many.kind, 'attention');
  assert.deepEqual(many.ids, ['task:a:review', 'task:b:failed', 'plan:p:needs-you']);
  assert.equal(coalesce([notice('x', 'success'), notice('y', 'info')]).title, '2 updates');
  // A bubble clears once nothing it announced is still waiting.
  assert.equal(hintStillRelevant(many, [notice('task:b:failed')]), true);
  assert.equal(hintStillRelevant(many, []), false);
});

test('the mascot badge counts what needs the person, not every task notice ever raised', async () => {
  const { companionBadge } = await import('../src/lib/companion-announce.ts');
  const notices = [
    // Fourteen old task notices used to make the badge read 14 beside a Work count of 3.
    ...Array.from({ length: 14 }, (_, index) => notice(`task:${index}:review`, 'success')),
    notice('plan:p:needs-you'),
    notice('save:one'),
    notice('referrals:me', 'success'),
  ];
  assert.equal(
    companionBadge({ needsYou: 3, notices, readIds: ['save:one'], proposals: 1 }),
    3 + 1 + 1,
  );
  assert.equal(companionBadge({ needsYou: 0, notices: [], readIds: [], proposals: 0 }), 0);
});
