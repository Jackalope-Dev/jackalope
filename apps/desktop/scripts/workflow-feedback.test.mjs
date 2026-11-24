import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePatchFiles } from '@pierre/diffs';
import { issuePrompt, issueUrl, workSource } from '../src/lib/issues.ts';
import { appendFeedbackDraft, reviewExcerpt, reviewFeedback } from '../src/lib/review-feedback.ts';

test('review feedback preserves removed code, skips resolved comments and flags stale anchors', () => {
  const patch =
    'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -40,2 +40,2 @@\n const x = 1;\n-return false;\n+return true;\n';
  const file = parsePatchFiles(patch)[0].files[0];
  assert.equal(reviewExcerpt(file, 41, 'deletions'), 'return false;');
  assert.equal(reviewExcerpt(file, 41, 'additions'), 'return true;');
  assert.equal(reviewExcerpt(file, 12, 'additions'), undefined);
  const comment = {
    id: 'a',
    file: 'a.ts',
    line: 41,
    side: 'deletions',
    revision: 'old',
    text: 'Keep this guard.',
    resolved: false,
    excerpt: 'return false;',
  };
  const feedback = reviewFeedback(
    [comment, { ...comment, id: 'b', text: 'Do not send me', resolved: true }],
    'current',
  );
  assert.match(feedback, /a.ts:41 \(original code; earlier patch/);
  assert.match(feedback, /return false/);
  assert.doesNotMatch(feedback, /Do not send me/);
  assert.throws(() => reviewFeedback([{ ...comment, text: 'a'.repeat(21000) }], 'old'), /Shorten/);
});

test('issue drafts remain launchable with Unicode bodies and retain a safe source link', () => {
  const prompt = issuePrompt({
    id: 'TEAM-42',
    title: 'Make the dialog accessible',
    url: 'https://linear.app/team/issue/TEAM-42',
    provider: 'linear',
    kind: 'issue',
    state: 'Todo',
    truncated: false,
    body: '🪶'.repeat(10000),
  });
  assert.ok(new TextEncoder().encode(prompt).length < 12000);
  assert.match(prompt, /excerpt/);
  assert.equal(workSource(prompt), 'https://linear.app/team/issue/TEAM-42');
  for (const url of [
    'javascript:alert(1)',
    'file:///C:/secret',
    'http://example.com',
    'https://password@example.com',
  ])
    assert.throws(() => issueUrl(url));
  assert.equal(workSource('Source: https://password@example.com'), undefined);
});

test('feedback preserves existing drafts, avoids repeat additions, and respects Unicode byte limits', () => {
  const draft = appendFeedbackDraft('Keep the theme.', 'Fix focus.');
  assert.equal(draft, 'Keep the theme.\n\nFix focus.');
  assert.equal(appendFeedbackDraft(draft, 'Fix focus.'), draft);
  assert.throws(() => appendFeedbackDraft('🪶'.repeat(2999), 'More feedback'), /shorten/);
  assert.equal(appendFeedbackDraft('', '🪶'.repeat(3000)).length, 6000);
});
