import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAgentMarkdown } from '../src/lib/markdown-normalize.ts';

test('a whole answer fenced as markdown renders as markdown', () => {
  assert.equal(
    normalizeAgentMarkdown('```markdown\n## Jev\n\n- Routes tasks\n```'),
    '## Jev\n\n- Routes tasks',
  );
  assert.equal(normalizeAgentMarkdown('```md\n**Bold**\n```\n'), '**Bold**');
  assert.equal(
    normalizeAgentMarkdown('```\n## Summary\n- One\n- Two\n```'),
    '## Summary\n- One\n- Two',
  );
});

test('indented answers are dedented', () => {
  assert.equal(normalizeAgentMarkdown('    ## Title\n\n    - item'), '## Title\n\n- item');
});

test('real code and mixed answers are left alone', () => {
  for (const content of [
    '```ts\nconst a = 1;\n```',
    '```\nconst a = 1;\n```',
    'Here is code:\n\n```ts\nconst a = 1;\n```',
    '## Title\n\n    indented example',
    'plain sentence',
  ])
    assert.equal(normalizeAgentMarkdown(content), content, content);
});

test('leading front matter becomes a readable list instead of a heading', () => {
  const plan =
    'recommendedShape: subtasks\nshapeReason: One shared module lands first.\nworkers: 3\n---\n\n# One growth queue';
  const expected =
    '- **Recommended shape:** subtasks\n- **Shape reason:** One shared module lands first.\n- **Workers:** 3\n\n# One growth queue';
  assert.equal(normalizeAgentMarkdown(plan), expected);
  assert.equal(normalizeAgentMarkdown(`---\n${plan}`), expected);
  assert.equal(
    normalizeAgentMarkdown('---\ntitle: "Plan"\nempty:\n---\nBody'),
    '- **Title:** Plan\n\nBody',
  );
});

test('prose that merely contains a colon before a rule is left alone', () => {
  for (const content of ['Note: read this\n\n---\n\nMore', 'Summary\n---\nBody'])
    assert.equal(normalizeAgentMarkdown(content), content, content);
});
