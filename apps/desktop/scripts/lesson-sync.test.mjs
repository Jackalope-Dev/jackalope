import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_LESSON_SYNC,
  lessonSyncStatus,
  parseLessonSyncView,
  syncsLessons,
} from '../src/lib/lesson-sync.ts';

const view = (overrides = {}) => ({
  ...EMPTY_LESSON_SYNC,
  available: true,
  settingsSync: true,
  enabled: true,
  owner: 'f'.repeat(64),
  lastSyncedAt: '2026-10-28T10:00:00+00:00',
  projects: 2,
  ...overrides,
});

test('the native status is accepted only with allowlisted fields and types', () => {
  assert.deepEqual(parseLessonSyncView(view()), view());
  for (const invalid of [
    null,
    [],
    { ...view(), lessons: [{ content: 'private' }] },
    { ...view(), evidence: ['Task 1'] },
    { ...view(), projectPath: '/private/repo' },
    { ...view(), enabled: 'yes' },
    { ...view(), uploaded: -1 },
    { ...view(), downloaded: 1.5 },
    { ...view(), owner: 'x'.repeat(201) },
  ]) {
    assert.throws(() => parseLessonSyncView(invalid));
  }
  const { reset: _reset, ...missing } = view();
  assert.throws(() => parseLessonSyncView(missing));
});

test('lesson sync is off by default and every project is included until excluded', () => {
  assert.equal(EMPTY_LESSON_SYNC.enabled, false);
  assert.equal(syncsLessons(undefined), true);
  assert.equal(syncsLessons({ preferences: {} }), true);
  assert.equal(syncsLessons({ preferences: { syncLessons: false } }), false);
});

test('status explains prerequisites, progress, resets and what stays local', () => {
  assert.equal(lessonSyncStatus(EMPTY_LESSON_SYNC, false), 'Sign in to sync learned lessons.');
  assert.match(lessonSyncStatus(view({ settingsSync: false }), false), /Turn on settings sync/);
  assert.equal(
    lessonSyncStatus(view({ enabled: false }), false),
    'Learned lessons stay on this desktop.',
  );
  assert.equal(lessonSyncStatus(view(), true), 'Syncing learned lessons…');
  assert.equal(
    lessonSyncStatus(view({ lastSyncedAt: null }), false),
    'Ready to sync learned lessons.',
  );
  assert.equal(
    lessonSyncStatus(view({ keptLocal: 1, unavailableProjects: 2 }), false),
    'Lessons from 2 projects are synced. 2 projects have no commit to match them by and stay local. 1 lesson looks sensitive and stays local.',
  );
  assert.match(
    lessonSyncStatus(view({ enabled: false, reset: true }), false),
    /deleted from another desktop/,
  );
});
