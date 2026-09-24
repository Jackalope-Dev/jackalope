import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  allowedActions,
  branchProtection,
  environmentPolicies,
  environmentProtection,
  managedRulesets,
} from '../security/github-policy.mjs';
import { root } from './catalog.mjs';

test('production approval cannot be skipped, while the sole maintainer can approve their own run', () => {
  for (const name of ['cloud-stable', 'store-stable', 'service-production']) {
    const policy = environmentProtection(environmentPolicies[name], 123, {
      protection_rules: [{ type: 'wait_timer', wait_timer: 5 }],
    });
    assert.equal(policy.can_admins_bypass, false);
    assert.equal(policy.prevent_self_review, false);
    assert.deepEqual(policy.reviewers, [{ type: 'User', id: 123 }]);
    assert.equal(policy.wait_timer, 5);
  }
  for (const [name, policy] of Object.entries(environmentPolicies)) {
    if (name.startsWith('service-')) assert.ok(!policy.branches.includes('stable'));
    else assert.ok(!policy.branches.includes('master'));
  }
});

test('branch writers and check issuers are constrained without preventing owner development pushes', () => {
  const protection = branchProtection('owner');
  assert.deepEqual(protection.restrictions, { users: ['owner'], teams: [], apps: [] });
  assert.equal(protection.enforce_admins, false);
  assert.ok(protection.required_status_checks.checks.every((check) => check.app_id === 15368));
  assert.equal(protection.required_pull_request_reviews.require_code_owner_reviews, true);
  assert.equal(protection.required_pull_request_reviews.dismiss_stale_reviews, true);
  assert.equal(protection.required_pull_request_reviews.require_last_push_approval, true);
  for (const ruleset of managedRulesets('master')) {
    assert.equal(ruleset.enforcement, 'active');
    assert.deepEqual(ruleset.bypass_actors, []);
    assert.ok(ruleset.rules.some((rule) => rule.type === 'deletion'));
  }
  const history = managedRulesets('master').find((rule) => rule.target === 'branch');
  assert.ok(history.rules.some((rule) => rule.type === 'non_fast_forward'));
  assert.deepEqual(history.conditions.ref_name.include, [
    'refs/heads/master',
    'refs/heads/beta',
    'refs/heads/stable',
  ]);
});

test('every workflow action is approved, SHA-pinned and checks out without persistent credentials', async () => {
  assert.equal(allowedActions.github_owned_allowed, false);
  assert.equal(allowedActions.verified_allowed, false);
  const patterns = allowedActions.patterns_allowed.map(
    (pattern) =>
      new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`),
  );
  assert.ok(!patterns.some((pattern) => pattern.test('unreviewed/action@abcdef')));
  const directory = resolve(root, '.github/workflows');
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.yml')) continue;
    const workflow = await readFile(resolve(directory, name), 'utf8');
    for (const [, action] of workflow.matchAll(/\buses: (\S+)/g)) {
      assert.match(action, /@[a-f0-9]{40}$/, `${name}: mutable action reference`);
      assert.ok(
        patterns.some((pattern) => pattern.test(action)),
        `${name}: ${action} is not approved`,
      );
    }
    for (const block of workflow.split(/(?= {6}- )/)) {
      if (!block.includes('uses: actions/checkout@')) continue;
      assert.match(block, /persist-credentials: false/, name);
    }
  }
});
