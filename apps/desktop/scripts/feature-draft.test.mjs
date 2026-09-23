import assert from 'node:assert/strict';
import test from 'node:test';
import { featureDraftKey } from '../src/lib/feature-draft.ts';

const current = 'jackalope-feature-plan:project';
const legacy = `${current}:multi`;
const draft = { goal: 'Keep my work', agent: 'auto', steps: [], runId: 'saved-run' };
const storage = (values) => ({ getItem: (key) => values[key] ?? null });

test('unfinished split drafts remain reachable from feature planning without rewriting saved data', () => {
  const values = { [legacy]: JSON.stringify(draft) };
  assert.equal(featureDraftKey(storage(values), 'project'), legacy);
  assert.deepEqual(JSON.parse(values[legacy]), draft);
  assert.equal(
    featureDraftKey(storage(values), 'other-project'),
    'jackalope-feature-plan:other-project',
  );
});

test('current drafts take precedence until imported, then unfinished legacy work can resume', () => {
  const values = { [current]: JSON.stringify(draft), [legacy]: JSON.stringify(draft) };
  assert.equal(featureDraftKey(storage(values), 'project'), current);
  values[current] = JSON.stringify({ ...draft, added: true });
  assert.equal(featureDraftKey(storage(values), 'project'), legacy);
  values[legacy] = JSON.stringify({ ...draft, added: true });
  assert.equal(featureDraftKey(storage(values), 'project'), current);
});

test('unreadable or malformed drafts cannot hide a recoverable legacy draft', () => {
  for (const broken of ['{', '{}', 'null', '[]', JSON.stringify({ ...draft, steps: null })]) {
    const values = { [current]: broken, [legacy]: JSON.stringify(draft) };
    assert.equal(featureDraftKey(storage(values), 'project'), legacy);
    assert.equal(values[current], broken);
  }
  assert.equal(
    featureDraftKey(
      {
        getItem: () => {
          throw new Error('unavailable');
        },
      },
      'project',
    ),
    current,
  );
});
