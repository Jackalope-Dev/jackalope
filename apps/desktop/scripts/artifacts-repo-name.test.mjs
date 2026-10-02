import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestRepoName, validRepoName } from '../src/lib/artifacts-repo-name.ts';

test('project names become valid Artifacts repository names', () => {
  for (const [name, expected] of [
    ['My new project', 'my-new-project'],
    ['Café Ünïcode', 'cafe-unicode'],
    ['  --Leading symbols', 'leading-symbols'],
    ['site.git', 'site'],
    ['v2.0_beta', 'v2.0_beta'],
  ]) {
    assert.equal(suggestRepoName(name), expected);
    assert.ok(validRepoName(expected), expected);
  }
  assert.equal(suggestRepoName('x'.repeat(150)).length, 100);
  assert.equal(suggestRepoName('🚀'), '');
});

test('repository names follow the Artifacts naming rules', () => {
  for (const name of ['', '-app', '.app', 'my app', 'app/sub', 'app.git', 'a'.repeat(101)]) {
    assert.equal(validRepoName(name), false, name);
  }
});
