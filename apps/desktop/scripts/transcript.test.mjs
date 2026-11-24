import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  keepLoadedReplies,
  loadReplyPages,
  replyOmitted,
  withReplies,
} from '../src/lib/session-replies.ts';
import {
  findMatches,
  firstMatchFrom,
  foldCase,
  MATCH_LIMIT,
  matchLabel,
  occurrences,
  stepMatch,
} from '../src/lib/transcript-find.ts';
import { distanceFromEnd, followAfterScroll, jumpBehavior } from '../src/lib/transcript-follow.ts';

test('find searches every row part, case-insensitively, in reading order', () => {
  const rows = [
    ['Fix the Retry loop', '## Done\nThe retry now stops.'],
    ['Thanks'],
    ['', 'retry retry'],
  ];
  const { matches, truncated } = findMatches(rows, '  RETRY ');
  assert.equal(truncated, false);
  assert.deepEqual(matches, [
    { row: 0, part: 0, nth: 0 },
    { row: 0, part: 1, nth: 0 },
    { row: 2, part: 1, nth: 0 },
    { row: 2, part: 1, nth: 1 },
  ]);
  assert.deepEqual(findMatches(rows, '   ').matches, []);
  assert.deepEqual(occurrences('aaaa', 'aa'), [0, 2]);
  // Lowercasing that changes length would misplace highlights, so such text matches by case.
  assert.equal(foldCase('İstanbul'), null);
  assert.equal(foldCase('Retry'), 'retry');
  assert.equal(findMatches([['İstanbul']], 'İst').matches.length, 1);
});

test('find stops counting at its limit and labels the result', () => {
  const { matches, truncated } = findMatches([['a'.repeat(MATCH_LIMIT + 10)]], 'a');
  assert.equal(matches.length, MATCH_LIMIT);
  assert.equal(truncated, true);
  assert.equal(matchLabel(0, 3, false), '1 of 3');
  assert.equal(matchLabel(-1, 3, false), '3 matches');
  assert.equal(matchLabel(4, MATCH_LIMIT, true), `5 of ${MATCH_LIMIT.toLocaleString()}+`);
  assert.equal(matchLabel(-1, 0, false), 'No matches');
});

test('find starts at the reading position and wraps when stepping', () => {
  const matches = [2, 5, 9].map((row) => ({ row, part: 0, nth: 0 }));
  assert.equal(firstMatchFrom(matches, 0), 0);
  assert.equal(firstMatchFrom(matches, 5), 1);
  // Reading at the end of a conversation starts from the nearest match above.
  assert.equal(firstMatchFrom(matches, 20), 2);
  assert.equal(firstMatchFrom([], 3), -1);
  assert.equal(stepMatch(2, 3, 1), 0);
  assert.equal(stepMatch(0, 3, -1), 2);
  assert.equal(stepMatch(-1, 3, -1), 2);
  assert.equal(stepMatch(-1, 0, 1), -1);
});

test('following continues through growth and stops when the person reads back', () => {
  const end = { top: 1000, height: 1500, client: 500 };
  assert.equal(distanceFromEnd(end), 0);
  // New content grew the transcript; the follow write lands at the new end.
  assert.equal(followAfterScroll(true, end, { top: 1200, height: 1700, client: 500 }), true);
  // Scrolling up with the same layout is reading back.
  assert.equal(followAfterScroll(true, end, { top: 990, height: 1500, client: 500 }), false);
  // A row above measuring smaller moves the offset without the person scrolling.
  assert.equal(followAfterScroll(true, end, { top: 980, height: 1480, client: 500 }), true);
  // Scrolling down to near the end follows again; a small distance alone does not.
  const reading = { top: 600, height: 1500, client: 500 };
  assert.equal(followAfterScroll(false, reading, { top: 985, height: 1500, client: 500 }), true);
  assert.equal(followAfterScroll(false, reading, { top: 590, height: 1500, client: 500 }), false);
  assert.equal(followAfterScroll(false, { ...end, top: 990 }, { ...end, top: 985 }), false);
  assert.equal(followAfterScroll(false, null, end), true);
  assert.equal(jumpBehavior(400, 500, false), 'smooth');
  assert.equal(jumpBehavior(400, 500, true), 'auto');
  assert.equal(jumpBehavior(5000, 500, false), 'auto');
});

test('find counts unloaded text from native counts in reading order', () => {
  const rows = [
    ['first retry', null],
    ['no match', 'retry here'],
    ['', null],
  ];
  const { matches } = findMatches(
    rows,
    'retry',
    new Map([
      [0, 2],
      [2, 1],
    ]),
  );
  assert.deepEqual(matches, [
    { row: 0, part: 0, nth: 0 },
    { row: 0, part: 1, nth: 0 },
    { row: 0, part: 1, nth: 1 },
    { row: 1, part: 1, nth: 0 },
    { row: 2, part: 1, nth: 0 },
  ]);
  assert.equal(findMatches(rows, 'retry').matches.length, 2);
});

test('omitted replies load in pages and fill in without touching other runs', async () => {
  const run = (id, extra = {}) => ({ id, result: '', ...extra });
  const runs = [
    run('a', { resultOmitted: true, resultChars: 3 }),
    run('b', { result: 'kept' }),
    run('c', { resultOmitted: true, resultChars: 2 }),
  ];
  assert.equal(replyOmitted(runs[0]), true);
  assert.equal(replyOmitted(runs[1]), false);
  assert.equal(replyOmitted(undefined), false);
  const asked = [];
  let state = runs;
  await loadReplyPages(
    ['a', 'c', 'a'],
    async (ids) => {
      asked.push(ids);
      // One reply per page, as when a page fills its size cap.
      return ids.slice(0, 1).map((id) => ({ id, result: id.repeat(3) }));
    },
    (replies) => {
      state = withReplies(state, replies);
    },
  );
  assert.deepEqual(asked, [['a', 'c'], ['c']]);
  assert.equal(state[0].result, 'aaa');
  assert.equal(state[0].resultOmitted, false);
  assert.equal(state[1], runs[1]);
  assert.equal(state[2].result, 'ccc');
  // A page with nothing new ends the load instead of asking forever.
  let calls = 0;
  await loadReplyPages(
    ['gone'],
    async () => {
      calls++;
      return [];
    },
    () => {},
  );
  assert.equal(calls, 1);
  assert.equal(withReplies(runs, []), runs);
});

test('a reply resent without its text keeps the text already loaded while its length holds', () => {
  const loaded = { id: 'a', result: 'héllo 👋', status: 'review' };
  const other = { id: 'b', result: 'kept' };
  const previous = [loaded, other];
  // The window moved past `a`: the refresh resends it without its text.
  const resent = { id: 'a', result: '', resultOmitted: true, resultChars: 7, status: 'review' };
  const kept = keepLoadedReplies(previous, [resent, other], [resent]);
  assert.equal(kept[0].result, loaded.result);
  assert.equal(kept[0].resultOmitted, false);
  assert.equal(kept[1], other);
  // A different length means the reply changed: it loads again.
  const changed = { ...resent, resultChars: 8 };
  assert.equal(keepLoadedReplies(previous, [changed, other], [changed])[0], changed);
  // Nothing resent without text leaves the runs as they are.
  const next = [loaded, other];
  assert.equal(keepLoadedReplies(previous, next, [other]), next);
});
