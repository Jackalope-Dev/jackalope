import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReviewPrompt } from '../src/lib/cross-model-review.ts';

test('peer review request identifies the actual workspace and forbids edits', () => {
  const prompt = buildReviewPrompt(
    'codex',
    ['src/auth.ts'],
    '+const token = secret;',
    'C:/tasks/source',
    'Fix authentication',
  );
  assert.match(prompt, /C:\/tasks\/source/);
  assert.match(prompt, /Fix authentication/);
  assert.match(prompt, /src\/auth.ts/);
  assert.match(prompt, /Do not edit files/);
  assert.match(prompt, /const token = secret/);
  assert.doesNotMatch(prompt, /all checks passed|zero defects|VERDICT: APPROVED/);
});

test('large peer review requests disclose partial patches and keep the source available', () => {
  const prompt = buildReviewPrompt(
    'claude',
    ['large.ts'],
    `${'x'.repeat(40_000)}OMITTED`,
    '/source',
    'Inspect the change',
  );
  assert.match(prompt, /excerpt; inspect the source workspace/);
  assert.match(prompt, /Source workspace: \/source/);
  assert.ok(!prompt.includes('OMITTED'));
});
