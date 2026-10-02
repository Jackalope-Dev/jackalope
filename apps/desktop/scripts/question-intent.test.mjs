import assert from 'node:assert/strict';
import test from 'node:test';
import { isQuestionOnly } from '../src/lib/question-intent.ts';

test('questions skip workspace preparation', () => {
  for (const text of [
    'How is Jev used?',
    'Where are bot conversations stored',
    'Explain the coordinator lock order.',
    'what does scope_audit do?',
  ])
    assert.equal(isQuestionOnly(text), true, text);
});

test('requests that may change files keep the full setup', () => {
  for (const text of [
    'Fix the failing login test',
    'How do I add a settings page? Please add it.',
    'Can you update the README?',
    'Add a dark mode toggle',
    '',
    `How does this work?${'\n'.repeat(5)}more`,
    `Why ${'x'.repeat(500)}?`,
  ])
    assert.equal(isQuestionOnly(text), false, text);
});
