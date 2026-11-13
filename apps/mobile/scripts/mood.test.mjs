import assert from 'node:assert/strict';
import test from 'node:test';
import { headline, mood } from '../src/mood.ts';

const activity = (fields) => ({
  needsYou: 0,
  working: 0,
  unreachable: [],
  computers: 1,
  loading: false,
  ...fields,
});

test('the mascot only reflects real activity, needs-you first', () => {
  assert.equal(mood(activity({})), 'idle');
  assert.equal(mood(activity({ working: 2 })), 'working');
  assert.equal(mood(activity({ working: 2, needsYou: 1 })), 'waiting');
  assert.equal(mood(activity({ unreachable: ['Reindeer'] })), 'offline');
  // One of two computers offline isn't the whole picture.
  assert.equal(mood(activity({ computers: 2, unreachable: ['Reindeer'] })), 'idle');
});

test('the headline says what the mood shows', () => {
  assert.equal(headline(activity({ loading: true })), 'Checking your computers…');
  assert.equal(headline(activity({})), 'All caught up');
  assert.equal(headline(activity({ needsYou: 1, working: 2 })), '1 needs you · 2 working');
  assert.equal(headline(activity({ needsYou: 3 })), '3 need you');
  assert.equal(headline(activity({ unreachable: ['Reindeer'] })), "Can't reach Reindeer");
  assert.equal(
    headline(activity({ computers: 2, unreachable: ['A', 'B'] })),
    "Can't reach your computers",
  );
});
