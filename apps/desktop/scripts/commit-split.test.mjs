import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  commitBody,
  commitCount,
  commitFiles,
  commitTitle,
  dependencyLabel,
  splitFailure,
} from '../src/lib/commit-split.ts';

const units = [
  { id: 'h1', path: 'src/search.ts', added: 4, removed: 1, whole: false, lock: false },
  { id: 'h2', path: 'src/search.ts', added: 2, removed: 0, whole: false, lock: false },
  { id: 'h3', path: 'src/search.ts', added: 1, removed: 3, whole: false, lock: false },
  { id: 'h4', path: 'package.json', added: 1, removed: 0, whole: true, lock: false },
  { id: 'h5', path: 'pnpm-lock.yaml', added: 9, removed: 2, whole: true, lock: true },
];

test('commit messages split into a title and an optional body', () => {
  assert.equal(commitTitle('  Add search\n\nIndexes titles first.\n'), 'Add search');
  assert.equal(commitBody('  Add search\n\nIndexes titles first.\n'), 'Indexes titles first.');
  assert.equal(commitBody('Add search'), '');
  assert.equal(commitTitle(''), '');
});

test('a commit lists its share of each file, with lock files marked', () => {
  const commit = {
    message: 'Add search',
    hunks: ['h1', 'h3', 'h4', 'h5'],
    files: ['src/search.ts', 'package.json', 'pnpm-lock.yaml'],
  };
  assert.deepEqual(commitFiles(commit, units), [
    {
      path: 'src/search.ts',
      hunks: 2,
      totalHunks: 3,
      added: 5,
      removed: 4,
      whole: false,
      lock: false,
    },
    {
      path: 'package.json',
      hunks: 1,
      totalHunks: 1,
      added: 1,
      removed: 0,
      whole: true,
      lock: false,
    },
    {
      path: 'pnpm-lock.yaml',
      hunks: 1,
      totalHunks: 1,
      added: 9,
      removed: 2,
      whole: true,
      lock: true,
    },
  ]);
});

test('dependencies read as one-based commit numbers', () => {
  assert.equal(dependencyLabel(undefined), '');
  assert.equal(dependencyLabel([]), '');
  assert.equal(dependencyLabel([0]), 'Needs 1');
  assert.equal(dependencyLabel([2, 0, 2]), 'Needs 1 and 3');
  assert.equal(dependencyLabel([3, 0, 1]), 'Needs 1, 2 and 4');
});

test('split failures follow the native error code, not its wording', () => {
  const coded = (code, message) => Object.assign(new Error(message), { code });
  const mismatch = splitFailure(coded('treeMismatch', 'anything'));
  assert.equal(mismatch.recovery, 'propose');
  assert.match(mismatch.message, /refused this split.*keeps its current commits/);
  assert.deepEqual(splitFailure(coded('proposalStale', 'anything')), {
    message: 'The integration changed after this split was proposed. Propose a new split.',
    recovery: 'propose',
  });
  // A reference that moved without its saved plan needs a fresh review, not a new split.
  assert.deepEqual(
    splitFailure({
      code: 'reviewStale',
      message: 'The integration reference changed. Prepare a fresh review.',
    }),
    { message: 'The integration reference changed. Prepare a fresh review.', recovery: 'refresh' },
  );
  assert.deepEqual(splitFailure(new Error('Commit 2 did not apply')), {
    message: 'Commit 2 did not apply',
    recovery: null,
  });
  assert.deepEqual(splitFailure('plain text'), { message: 'plain text', recovery: null });
  assert.equal(commitCount(1), 'one commit');
  assert.equal(commitCount(4), '4 commits');
});
