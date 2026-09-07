import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForStoppedAttempt } from '../src/lib/continue-task.ts';
import { planningDraft } from '../src/lib/planning.ts';
import { collectWork } from '../src/lib/task-collection.ts';
import { latestAttempt, safeResultLink, taskNextAction } from '../src/lib/task-workflow.ts';

const run = {
  id: 'run',
  taskId: 'task',
  projectId: 'a',
  prompt: 'Original intent',
  startedAt: '2026-09-01',
  status: 'review',
  sessionId: 'session',
};

test('global work prioritizes decisions, review, running work and saved projectless ideas', () => {
  const items = collectWork(
    null,
    [
      {
        id: 'idea',
        title: 'Unassigned',
        projectId: '',
        status: 'backlog',
        updatedAt: '2026-09-04',
      },
    ],
    [
      run,
      {
        ...run,
        id: 'waiting',
        taskId: 'waiting',
        projectId: 'b',
        status: 'running',
        prompts: [{ status: 'pending' }],
      },
      { ...run, id: 'working', taskId: 'working', status: 'running' },
    ],
  );
  assert.deepEqual(
    items.map((item) => item.stage),
    ['attention', 'review', 'working', 'ideas'],
  );
  assert.equal(collectWork('', [items.at(-1).idea], [run]).length, 1);
  assert.equal(collectWork(null, [], [run], ['run'])[0].stage, 'finished');
  assert.equal(
    collectWork(null, [], [{ ...run, persistenceError: 'Disk full' }], ['run'])[0].stage,
    'attention',
  );
});

test('latest attempt follows timestamps and current questions override generic working status', () => {
  const newer = { ...run, id: 'new', startedAt: '2026-09-02' };
  assert.equal(latestAttempt([newer, run], run.taskId).id, 'new');
  const offset = { ...run, id: 'offset', startedAt: '2026-09-06T18:42:16-06:00' };
  const utc = { ...run, id: 'utc', startedAt: '2026-09-07T00:41:16Z' };
  assert.equal(latestAttempt([utc, offset], run.taskId).id, 'offset');
  assert.equal(collectWork(null, [], [utc, offset])[0].run.id, 'offset');
  assert.equal(
    taskNextAction({ ...run, status: 'running', prompts: [{ status: 'pending' }] }),
    'Answer a question',
  );
  assert.equal(
    taskNextAction({ ...run, status: 'running', finishing: true }),
    'Checking the result',
  );
});

test('stop and send waits for actual termination and refuses interrupted or missing ownership', async () => {
  let reads = 0;
  let waits = 0;
  const finished = await waitForStoppedAttempt(
    'run',
    async () => ({ ...run, status: ++reads < 3 ? 'stopping' : 'stopped' }),
    async () => {
      waits++;
    },
  );
  assert.equal(finished.status, 'stopped');
  assert.equal(waits, 2);
  await assert.rejects(
    waitForStoppedAttempt(
      'run',
      async () => ({ ...run, status: 'interrupted' }),
      async () => {},
    ),
    /ownership/,
  );
  await assert.rejects(
    waitForStoppedAttempt(
      'run',
      async () => undefined,
      async () => {},
    ),
    /unavailable/,
  );
  await assert.rejects(
    waitForStoppedAttempt(
      'run',
      async () => ({ ...run, sessionId: null }),
      async () => {},
    ),
    /resumable/,
  );
  await assert.rejects(
    waitForStoppedAttempt(
      'run',
      async () => ({ ...run, status: 'stopping' }),
      async () => {},
      2,
    ),
    /still stopping/,
  );
});

test('result links allow only explicit web addresses', () => {
  assert.equal(safeResultLink('https://example.com/result'), 'https://example.com/result');
  for (const href of [
    'javascript:alert(1)',
    'file:///private',
    'data:text/html,x',
    '/relative',
    'shell:run',
  ])
    assert.equal(safeResultLink(href), undefined);
});

test('saved ideas preserve an explicitly empty tool scope', () => {
  assert.deepEqual(planningDraft({ rawPrompt: 'Keep this', connectionIds: [] }).connectionIds, []);
  assert.equal(planningDraft({ rawPrompt: 'Keep this' }).connectionIds, undefined);
});

test('saved ideas restore knowledge selection together with connection scope', () => {
  const contextSelection = { workflowId: 'review', excludedMemoryIds: ['old'], memoryOff: true };
  const draft = planningDraft({ rawPrompt: 'Keep this', connectionIds: [], contextSelection });
  assert.deepEqual(draft.connectionIds, []);
  assert.deepEqual(draft.contextSelection, contextSelection);
});
