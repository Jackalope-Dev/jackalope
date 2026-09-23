import assert from 'node:assert/strict';
import test from 'node:test';
import { liveActivity } from '../src/lib/task-live-activity.ts';

const run = {
  status: 'running',
  startedAt: '2026-09-17T00:00:00Z',
  activity: ['Reading src/a.ts', 'Editing src/a.ts', 'Editing src/a.ts'],
};
test('live activity uses existing tool events and collapses repeated updates', () => {
  const state = liveActivity(run);
  assert.equal(state.current, 'Editing src/a.ts');
  assert.equal(state.kind, 'edit');
  assert.deepEqual(state.recent, ['Reading src/a.ts']);
});
test('native checks and queued checks take precedence over old agent activity', () => {
  const progress = {
    label: 'Running project checks',
    detail: '\x1b[32mCompiling crate\x1b[0m\nfull log',
    startedAt: '2026-09-17T00:01:00Z',
  };
  assert.equal(liveActivity({ ...run, progress }).current, 'Compiling crate');
  assert.equal(liveActivity({ ...run, progress }).since, progress.startedAt);
  assert.equal(
    liveActivity({ ...run, progress: { label: 'Waiting for project checks', detail: '' } }).current,
    'Waiting for project checks',
  );
});
test('command previews show outcomes without shell arguments or captured output', () => {
  const state = liveActivity({
    ...run,
    activity: [
      'private command\nExit: 0\nprivate output',
      'private command\nExit: 7\nprivate output',
    ],
  });
  assert.equal(state.current, 'Command failed (exit 7)');
  assert.equal(state.kind, 'attention');
  assert.deepEqual(state.recent, ['Command finished']);
});
test('questions and stopping do not imply that the agent is still editing', () => {
  assert.equal(
    liveActivity({ ...run, prompts: [{ status: 'pending' }] }).current,
    'Waiting for your answer',
  );
  assert.deepEqual(liveActivity({ ...run, status: 'stopping' }).recent, []);
  assert.equal(liveActivity({ ...run, status: 'review' }), null);
  assert.equal(liveActivity({ ...run, activity: ['Tool request failed'] }).kind, 'attention');
  assert.equal(liveActivity({ ...run, activity: ['Reading src/error-handler.ts'] }).kind, 'read');
});
