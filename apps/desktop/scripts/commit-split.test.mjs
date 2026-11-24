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

test('a refused split explains that the integration is unchanged', () => {
  assert.match(
    splitFailure('The split commits do not add up to the reviewed files.'),
    /refused this split.*keeps its current commits/,
  );
  assert.match(
    splitFailure('The integration changed since these commits were proposed. Split it again.'),
    /Propose a new split/,
  );
  assert.match(
    splitFailure('Project commit settings changed. Prepare a fresh review.'),
    /Refresh the merge/,
  );
  assert.equal(
    splitFailure('Commit 2 did not apply'),
    'The split was not applied: Commit 2 did not apply',
  );
  assert.equal(commitCount(1), 'one commit');
  assert.equal(commitCount(4), '4 commits');
});
