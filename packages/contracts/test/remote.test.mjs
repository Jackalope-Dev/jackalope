import assert from 'node:assert/strict';
import test from 'node:test';
import {
  askedText,
  draftKey,
  prepareRemoteRequest,
  requestText,
  taskStatus,
  workTitle,
} from '../src/remote.ts';

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

test('remote sends retain their identity across reload and change it only for a new action', () => {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  const action = { action: 'start', projectId: 'project', text: 'Fix the focus order' };
  const { id } = prepareRemoteRequest(storage, 'draft', action);
  assert.equal(prepareRemoteRequest(storage, 'draft', JSON.parse(JSON.stringify(action))).id, id);
  assert.notEqual(
    prepareRemoteRequest(storage, 'draft', { ...action, text: 'A new request' }).id,
    id,
  );
  const first = prepareRemoteRequest(storage, 'followup', {
    action: 'followup',
    runId: 'old',
    text: 'Fix focus',
  });
  const retry = prepareRemoteRequest(storage, 'followup', {
    action: 'followup',
    runId: 'new',
    text: 'Fix focus',
  });
  assert.deepEqual(retry, first);
  assert.throws(
    () =>
      prepareRemoteRequest(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error('Quota');
          },
        },
        'draft',
        action,
      ),
    /Quota/,
  );
});

test('the host messages stand for the request, and older host prompts are parsed', () => {
  const prompt = [
    'Live session: Fix',
    'Instructions',
    '',
    'User message 8465324d-d302-4373-bb75-8d9fb063a288:',
    'Old text',
  ].join('\n');
  assert.equal(
    askedText({ title: prompt, messages: [' Fix it ', '', 'Phone only'] }),
    'Fix it\n\nPhone only',
  );
  assert.equal(askedText({ title: prompt }), 'Old text');
  assert.equal(askedText({ title: prompt, messages: [] }), 'Old text');
});

test('drafts are keyed per item, with new work under its own key', () => {
  assert.equal(draftKey('jackalope-mobile:a', { newWork: true }), 'jackalope-mobile:a:draft:new');
  assert.equal(draftKey('remote', 'session'), 'remote:draft:session');
});
