import assert from 'node:assert/strict';
import test from 'node:test';
import {
  replaceLocation,
  startHistory,
  stepHistory,
  visitLocation,
} from '../src/lib/navigation-history.ts';

const at = (tab, extra = {}) => ({ tab, projectId: 'p1', ...extra });

test('visiting records each new location once', () => {
  let history = startHistory(at('kanban'));
  history = visitLocation(history, at('agents'));
  history = visitLocation(history, at('agents'));
  history = visitLocation(history, at('preferences', { category: 'General' }));
  history = visitLocation(history, at('preferences', { category: 'Routing' }));
  assert.deepEqual(
    history.entries.map((entry) => entry.category ?? entry.tab),
    ['kanban', 'agents', 'General', 'Routing'],
  );
  assert.equal(history.index, 3);
});

test('back and forward move along the history and stop at its ends', () => {
  let history = startHistory(at('kanban'));
  history = visitLocation(history, at('agents'));
  assert.equal(stepHistory(history, 1), null);
  const back = stepHistory(history, -1);
  assert.equal(back.entries[back.index].tab, 'kanban');
  assert.equal(stepHistory(back, -1), null);
  assert.equal(stepHistory(back, 1).index, 1);
});

test('visiting after going back drops the forward entries', () => {
  let history = startHistory(at('kanban'));
  history = visitLocation(history, at('agents'));
  history = visitLocation(history, at('usage'));
  history = stepHistory(stepHistory(history, -1), -1);
  history = visitLocation(history, at('bots'));
  assert.deepEqual(
    history.entries.map((entry) => entry.tab),
    ['kanban', 'bots'],
  );
});

test('a location without a project is replaced, not kept as a step back', () => {
  let history = startHistory({ tab: 'kanban', projectId: null });
  history = visitLocation(history, at('kanban'));
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].projectId, 'p1');
});

test('a switch of project is a step of its own', () => {
  let history = startHistory(at('project-overview'));
  history = visitLocation(history, { tab: 'project-overview', projectId: 'p2' });
  assert.equal(history.entries.length, 2);
});

test('the history keeps its most recent fifty locations', () => {
  let history = startHistory(at('kanban'));
  for (let step = 0; step < 80; step += 1)
    history = visitLocation(history, at(step % 2 ? 'agents' : 'usage', { category: `${step}` }));
  assert.equal(history.entries.length, 50);
  assert.equal(history.index, 49);
  assert.equal(history.entries.at(-1).category, '79');
});

test('replacing swaps only the showing entry', () => {
  let history = startHistory(at('kanban'));
  history = visitLocation(history, at('agents'));
  history = replaceLocation(stepHistory(history, -1), at('bots'));
  assert.deepEqual(
    history.entries.map((entry) => entry.tab),
    ['bots', 'agents'],
  );
  assert.equal(history.index, 0);
});
