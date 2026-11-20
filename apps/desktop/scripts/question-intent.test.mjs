import assert from 'node:assert/strict';
import test from 'node:test';
import { isNonCodeRequest, isQuestionOnly, nonCodeReason } from '../src/lib/question-intent.ts';

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

test('requests to read or operate something outside the code skip code setup', () => {
  for (const text of [
    'Check that https://example.com/pricing loads',
    'Is my Linear MCP connected?',
    'Open my inbox and summarize unread email',
    'Browse to staging.example.com and try the signup form',
    "What's on my calendar today?",
    'Look at the dashboard and tell me if anything is down',
    'Check in on the Notion connection',
  ])
    assert.equal(isNonCodeRequest(text), true, text);
});

test('anything that may touch code keeps the full setup', () => {
  for (const text of [
    'Fix the login page',
    'Check why the MCP server fails in tests',
    'Open src/app.tsx and look at the header',
    'Check the build',
    'Look at the pull request on the website',
    'Add a pricing link to the website',
    'Check the logs',
    'How does the coordinator lock order work?',
    'Review https://github.com/acme/app/pull/12 and the diff',
    'Read the config for the Slack connection',
    '',
    `Check the website${'\n'.repeat(5)}carefully`,
  ])
    assert.equal(isNonCodeRequest(text), false, text);
});

test('an attached window or the General folder skips code setup unless overridden', () => {
  assert.equal(nonCodeReason('Fix the bug', { general: true }), 'general');
  assert.equal(nonCodeReason('Fix the bug', { general: true, treatAsCode: true }), 'general');
  assert.equal(nonCodeReason('Add the shoes to my cart', { window: true }), 'window');
  assert.equal(nonCodeReason('Fix the layout bug in this window', { window: true }), undefined);
  assert.equal(
    nonCodeReason('Add the shoes to my cart', { window: true, treatAsCode: true }),
    undefined,
  );
  assert.equal(nonCodeReason('Is my Linear MCP connected?', {}), 'request');
  assert.equal(nonCodeReason('Is my Linear MCP connected?', { treatAsCode: true }), undefined);
  assert.equal(nonCodeReason('Add a dark mode toggle', {}), undefined);
});
