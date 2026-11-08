import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { allowedActions } from '../security/github-policy.mjs';
import { root } from './catalog.mjs';

test('every workflow action is approved, SHA-pinned and checks out without persistent credentials', async () => {
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
