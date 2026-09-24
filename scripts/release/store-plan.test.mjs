import assert from 'node:assert/strict';
import test from 'node:test';
import { storePlan } from './store-plan.mjs';

const base = { GITHUB_REF_NAME: 'beta', GITHUB_EVENT_NAME: 'workflow_dispatch' };
test('Store candidates follow the release branch without enabling submission', () => {
  assert.deepEqual(storePlan(base, { mode: 'candidate' }, ''), {
    enabled: true,
    channel: 'beta',
    mode: 'candidate',
  });
  assert.equal(
    storePlan({ ...base, GITHUB_REF_NAME: 'stable' }, { mode: 'candidate' }, '').channel,
    'stable',
  );
  assert.throws(
    () => storePlan({ ...base, GITHUB_REF_NAME: 'feature' }, { mode: 'candidate' }, ''),
    /branch/,
  );
  assert.throws(
    () => storePlan({ ...base, GITHUB_REF_NAME: 'master' }, { mode: 'submission' }, ''),
    /branch/,
  );
});
test('Store automatic releases require ready notes and installed acceptance', () => {
  const env = {
    ...base,
    GITHUB_EVENT_NAME: 'push',
    STORE_AUTOMATION_ENABLED: 'true',
    STORE_SUBMISSION_ENABLED: 'true',
  };
  assert.equal(storePlan(env, {}, 'Status: draft').enabled, false);
  assert.throws(() => storePlan(env, {}, 'Status: ready'), /acceptance/);
  assert.equal(storePlan({ ...env, STORE_ACCEPTED: 'true' }, {}, 'Status: ready').enabled, true);
  assert.equal(
    storePlan({ ...env, STORE_AUTOMATION_ENABLED: 'false' }, {}, 'Status: ready').enabled,
    false,
  );
});
test('initial Store trial cannot enable stable or automatic submission', () => {
  const env = { ...base, STORE_SUBMISSION_ENABLED: 'true', STORE_BETA_TEST_ENABLED: 'true' };
  assert.equal(storePlan(env, { mode: 'submission' }, '').enabled, true);
  assert.throws(
    () => storePlan({ ...env, GITHUB_REF_NAME: 'stable' }, { mode: 'submission' }, ''),
    /acceptance/,
  );
  assert.throws(
    () =>
      storePlan(
        { ...env, GITHUB_EVENT_NAME: 'push', STORE_AUTOMATION_ENABLED: 'true' },
        {},
        'Status: ready',
      ),
    /acceptance/,
  );
  assert.throws(() => storePlan(base, { mode: 'submission' }, ''), /Partner Center/);
});
