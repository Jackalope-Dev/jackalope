import assert from 'node:assert/strict';
import test from 'node:test';

const { candidateDetail, lastActivity, recommendedPaths } = await import(
  '../src/lib/project-discovery.ts'
);

const candidate = (extra) => ({
  path: '/Code/atlas',
  name: 'atlas',
  hasCommits: true,
  lastCommitAt: '2026-11-20T10:00:00Z',
  remoteHost: 'github.com',
  sessions: 3,
  lastSessionAt: '2026-11-22T10:00:00Z',
  sources: ['sessions', 'folders'],
  recommended: true,
  ...extra,
});

test('a repository says why it is listed', () => {
  assert.deepEqual(candidateDetail(candidate()), ['3 agent conversations', 'github.com']);
  assert.deepEqual(
    candidateDetail(candidate({ sessions: 1, hasCommits: false, remoteHost: null })),
    ['1 agent conversation', 'No commits yet'],
  );
  assert.deepEqual(candidateDetail(candidate({ sessions: 0, remoteHost: null })), []);
});

test('last activity is the newer of a conversation and a commit', () => {
  assert.equal(lastActivity(candidate())?.toISOString(), '2026-11-22T10:00:00.000Z');
  assert.equal(
    lastActivity(candidate({ lastSessionAt: null }))?.toISOString(),
    '2026-11-20T10:00:00.000Z',
  );
  assert.equal(lastActivity(candidate({ lastSessionAt: null, lastCommitAt: 'soon' })), null);
});

test('the recommended repositories start chosen', () => {
  assert.deepEqual(
    [...recommendedPaths([candidate(), candidate({ path: '/Code/beacon', recommended: false })])],
    ['/Code/atlas'],
  );
});
