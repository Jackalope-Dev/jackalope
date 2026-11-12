import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeDispatchPaused,
  describeSeveralPaused,
  parseDispatchPaused,
  pathLabel,
  pausedDispatchMessages,
} from '../src/lib/dispatch-paused.ts';

const current =
  'Dispatch paused: the target branch main in /tmp/work space/pocket-shop no longer contains integration 1793747743638073-63600-350 (commit 0123456789ab). Merge that commit back into main, or reset main to a commit that includes it, before running dependent work.';
const earlier =
  'Dispatch paused: the target branch in /tmp/pocket-shop no longer contains integration 1793747743638073-63600-350. Restore that integration before running dependent work.';

test('reads the project, branch, integration and commit from the native message', () => {
  assert.deepEqual(parseDispatchPaused(current), {
    projectPath: '/tmp/work space/pocket-shop',
    branch: 'main',
    integrationId: '1793747743638073-63600-350',
    commit: '0123456789ab',
  });
});

test('still reads messages from versions that did not name the branch', () => {
  assert.deepEqual(parseDispatchPaused(earlier), {
    projectPath: '/tmp/pocket-shop',
    branch: null,
    integrationId: '1793747743638073-63600-350',
    commit: null,
  });
});

test('other errors are not treated as a paused dispatch', () => {
  assert.equal(parseDispatchPaused('Git could not start.'), null);
  assert.equal(parseDispatchPaused(null), null);
});

test('describes the pause by project name in plain words', () => {
  const paused = parseDispatchPaused(current);
  const { title, body } = describeDispatchPaused(paused, 'pocket-shop');
  assert.equal(title, 'Dependent work in pocket-shop is paused');
  assert.match(
    body,
    /^The main branch no longer includes a merge Jackalope made earlier \(commit 0123456789ab\)/,
  );
  assert.match(body, /Merge that commit back into main/);
  assert.doesNotMatch(body, /\/tmp\//);
  assert.equal(pathLabel('/tmp/work space/pocket-shop/'), 'pocket-shop');
});

test('paused dispatch messages come from the queue view and dispatch errors, once each', () => {
  const message =
    'Dispatch paused: the target branch main in /work/shop no longer contains integration plan-1 (commit 0123456789ab). Merge that commit back into main, or reset main to a commit that includes it, before running dependent work.';
  const other =
    'Dispatch paused: the target branch main in /work/blog no longer contains integration plan-2 (commit abcdefabcdef). Merge that commit back into main, or reset main to a commit that includes it, before running dependent work.';
  assert.deepEqual(pausedDispatchMessages([{ message }, { message: other }], message), [
    message,
    other,
  ]);
  assert.deepEqual(pausedDispatchMessages(undefined, 'Git could not start.'), []);
  assert.deepEqual(pausedDispatchMessages([{ message }, { message: other }], null, '/work/blog/'), [
    other,
  ]);
});

test('several pauses read as one summary that counts the projects', () => {
  const { title, body } = describeSeveralPaused(4);
  assert.equal(title, 'Dependent work is paused in 4 projects');
  assert.match(body, /Merge the listed commit back/);
});
