import assert from 'node:assert/strict';
import { test } from 'node:test';
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
