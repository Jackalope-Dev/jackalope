import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeTaskChanges } from '../src/lib/task-changes.ts';

test('task deltas retain unchanged identities and apply updates, additions and removals', () => {
  const first = { id: 'a', startedAt: '2026-01-01', result: 'old' };
  const second = { id: 'b', startedAt: '2026-01-02', result: '' };
  const before = [second, first];
  assert.equal(mergeTaskChanges(before, { ids: ['a', 'b'], runs: [], revision: 1 }), before);
  assert.equal(
    mergeTaskChanges(before, { ids: ['a', 'b'], runs: [{ ...first }], revision: 1 }),
    before,
  );
  const changed = { ...first, result: 'new' };
  const added = { id: 'c', startedAt: '2026-01-03' };
  const after = mergeTaskChanges(before, {
    ids: ['a', 'b', 'c'],
    runs: [changed, added],
    revision: 2,
  });
  assert.deepEqual(
    after.map((run) => run.id),
    ['c', 'b', 'a'],
  );
  assert.equal(after[1], second);
  assert.equal(after[2], changed);
  assert.deepEqual(mergeTaskChanges(after, { ids: ['b'], runs: [], revision: 3 }), [second]);
});

test('selecting and leaving a task replaces its summary without losing full results', () => {
  const summary = { id: 'a', startedAt: '', result: '', detailsOmitted: true };
  const full = { ...summary, result: 'Full result', detailsOmitted: false };
  const selected = mergeTaskChanges([summary], { ids: ['a'], runs: [full], revision: 1 });
  assert.equal(selected[0].result, 'Full result');
  assert.equal(mergeTaskChanges(selected, { ids: ['a'], runs: [], revision: 1 }), selected);
  assert.equal(
    mergeTaskChanges(selected, { ids: ['a'], runs: [summary], revision: 1 })[0].detailsOmitted,
    true,
  );
});
