import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionWork } from '../src/lib/live-session.ts';
import { knownSessionRevisions, mergeSessionChanges } from '../src/lib/session-changes.ts';
import { suggestTopics, topicDraft } from '../src/lib/session-topics.ts';
import { pendingWorkFeedback, saveWorkFeedback } from '../src/lib/work-feedback.ts';
import { attentionQueue, workSummary } from '../src/lib/workbench.ts';
import {
  clearPerformanceSamples,
  measureNative,
  performanceSummary,
  recordPerformance,
  setPerformanceRecording,
} from '../src/lib/workbench-performance.ts';

test('attention prioritizes lost history and unanswered questions without starving older reviews', () => {
  const review = { id: 'review', stage: 'review', date: '2026-01-01', run: {} };
  const question = {
    id: 'question',
    stage: 'attention',
    date: '2026-01-02',
    run: { prompts: [{ status: 'pending' }] },
  };
  const history = {
    id: 'history',
    stage: 'attention',
    date: '2026-01-03',
    run: { persistenceError: 'Disk full' },
  };
  assert.deepEqual(
    attentionQueue([review, question, history, { stage: 'working' }]).map((item) => item.id),
    ['history', 'question', 'review'],
  );
});

test('return receipts detect equal-length edits and never persist transcript contents', () => {
  const run = { id: 'run', status: 'review', result: 'private-one', prompts: [] };
  const one = workSummary(run);
  const two = workSummary({ ...run, result: 'private-two' });
  assert.notEqual(one.fingerprint, two.fingerprint);
  assert.ok(!one.fingerprint.includes('private'));
  assert.ok(one.fingerprint.length < 80);
  assert.match(
    workSummary({ ...run, verification: { result: { success: true }, tree: null } }).checks,
    /attention/,
  );
});

test('topic suggestions are reversible metadata and drafts preserve source order', () => {
  const messages = [
    { id: 'a', text: '# UI\nKeep focus', canceled: false },
    { id: 'b', text: '# API\nHandle retries', canceled: false },
    { id: 'c', text: '# UI\nUse a visible label', canceled: false },
    { id: 'd', text: '# UI\nCanceled', canceled: true },
  ];
  const before = structuredClone(messages);
  let id = 0;
  const topics = suggestTopics(messages, () => String(++id));
  assert.equal(topics.length, 2);
  assert.deepEqual(topics[0].messageIds, ['a', 'c']);
  assert.deepEqual(messages, before);
  const draft = topicDraft(
    { id: 'chat', title: 'Original conversation', messages },
    { ...topics[0], messageIds: ['c', 'a', 'd'] },
  );
  assert.ok(draft.indexOf('Source message a') < draft.indexOf('Source message c'));
  assert.ok(!draft.includes('Canceled'));
  assert.ok(!draft.includes('Handle retries'));
  assert.match(draft, /Check the current repository/);
  const unicode = suggestTopics([{ id: 'unicode', text: '😀'.repeat(100) }], () => 'unicode');
  assert.ok(unicode[0].title.isWellFormed());
  assert.ok(new TextEncoder().encode(unicode[0].title).length <= 240);
});

test('pane feedback preserves separate receipts and existing data when storage fails', () => {
  const storage = new Map();
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let fail = false;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return storage.size;
      },
      key: (index) => [...storage.keys()][index] ?? null,
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        if (fail) throw Error('Storage full');
        storage.set(key, value);
      },
    },
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  try {
    saveWorkFeedback('task', 'attempt-one', 'Keep the existing draft.');
    saveWorkFeedback('task', 'attempt-two', 'Keep this separate receipt.');
    saveWorkFeedback('other-task', 'other', 'Unrelated feedback');
    storage.set('jackalope-work-feedback:task:corrupt', '{');
    const items = pendingWorkFeedback('task');
    assert.equal(items.length, 2);
    assert.notEqual(items[0].key, items[1].key);
    assert.deepEqual(
      items.map((item) => item.runId),
      ['attempt-one', 'attempt-two'],
    );
    const before = [...storage];
    fail = true;
    assert.throws(() => saveWorkFeedback('task', 'attempt-three', 'Unsaved'), /Storage full/);
    assert.deepEqual([...storage], before);
    assert.equal(storage.get('jackalope-work-feedback:task:corrupt'), '{');
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});

test('session deltas keep unchanged identities and remove missing records', () => {
  const session = { id: 'chat', messages: ['preserve'] };
  const run = { id: 'run', result: 'old' };
  const previous = { sessions: [session], runs: [run], error: null };
  const unchanged = mergeSessionChanges(previous, {
    sessions: [],
    runs: [],
    error: null,
    revisions: { 'session:chat': 'one', 'run:run': 'one' },
  });
  assert.equal(unchanged.sessions, previous.sessions);
  assert.equal(unchanged.runs, previous.runs);
  const changed = mergeSessionChanges(previous, {
    sessions: [],
    runs: [{ ...run, result: 'new' }],
    error: null,
    revisions: { 'run:run': 'two' },
  });
  assert.equal(changed.sessions.length, 0);
  assert.equal(changed.runs[0].result, 'new');
  const legacy = { ...previous, error: 'History unavailable' };
  assert.equal(mergeSessionChanges(previous, legacy), legacy);
});

test('session indexing retains queued and failed-launch semantics for large histories', () => {
  const batches = Array.from({ length: 4000 }, (_, index) => ({
    runId: `run-${index}`,
    error: null,
  }));
  const runs = batches.map((batch) => ({ id: batch.runId, status: 'review' }));
  const session = {
    batches: [...batches, { runId: 'missing', error: 'Launch failed' }],
    messages: [
      { id: 'queued', runId: null },
      { id: 'failed', runId: 'missing' },
      { id: 'last', runId: 'run-3999' },
    ],
  };
  const work = sessionWork(session, runs);
  assert.equal(work.latest.id, 'run-3999');
  assert.equal(work.pending, 1);
});

test('large histories bound request cursors without dropping records from the merged inventory', () => {
  const runs = Array.from({ length: 20001 }, (_, index) => ({ id: String(index) }));
  const revisions = Object.fromEntries(runs.map((run) => [`run:${run.id}`, 'one']));
  const known = knownSessionRevisions(revisions);
  assert.equal(Object.keys(known).length, 20000);
  assert.equal(known['run:20000'], undefined);
  assert.deepEqual(knownSessionRevisions(undefined), {});
  assert.equal(knownSessionRevisions(known), known);
  const previous = { sessions: [], runs, revisions, error: null };
  const merged = mergeSessionChanges(previous, {
    sessions: [],
    runs: [{ id: '20000', result: 'updated' }],
    revisions,
    error: null,
  });
  assert.equal(merged.runs.length, 20001);
  assert.equal(merged.runs[0], runs[0]);
  assert.equal(merged.runs[20000].result, 'updated');
  assert.equal(Object.keys(merged.revisions).length, 20001);
});

test('local timing capture is opt-in, bounded and does not change operation failures', async () => {
  clearPerformanceSamples();
  setPerformanceRecording(false);
  recordPerformance('task_review', 10);
  assert.deepEqual(performanceSummary(), []);
  setPerformanceRecording(true);
  recordPerformance('/private/path', 100);
  for (let index = 1; index <= 100; index++) recordPerformance('ui-event', index);
  assert.equal(performanceSummary()[0].p95Ms, 95);
  const failure = new Error('private failure');
  await assert.rejects(
    measureNative('task_review', async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.ok(!JSON.stringify(performanceSummary()).includes('private'));
  for (let index = 0; index < 3000; index++) recordPerformance('ui-event', 1);
  assert.equal(
    performanceSummary().reduce((count, row) => count + row.samples, 0),
    2000,
  );
  setPerformanceRecording(false);
  clearPerformanceSamples();
});
