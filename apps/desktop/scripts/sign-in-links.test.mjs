import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isClaudeAuthorizationUrl,
  signInUrl,
  terminalSignInLinks,
} from '../src/lib/sign-in-links.ts';

const url = 'https://claude.ai/oauth/authorize?state=fixture&code_challenge=fixture';
const buffer = (lines, cursorY = lines.length) => ({
  baseY: 0,
  cursorY,
  getLine: (row) =>
    lines[row] && {
      isWrapped: lines[row].wrapped ?? false,
      translateToString: () => lines[row].text,
    },
});

test('only HTTPS links without embedded credentials are offered', () => {
  assert.equal(signInUrl(url), url);
  for (const unsafe of [
    'javascript:alert(1)',
    'file:///tmp/login',
    'http://claude.ai',
    'https://user:password@claude.ai',
    'not a URL',
  ]) {
    assert.equal(signInUrl(unsafe), null);
  }
});

test('automatic opening is restricted to Claude authorization endpoints', () => {
  assert.equal(isClaudeAuthorizationUrl(url), true);
  assert.equal(isClaudeAuthorizationUrl(url.replace('claude.ai', 'platform.claude.com')), true);
  assert.equal(isClaudeAuthorizationUrl(url.replace('claude.ai', 'console.anthropic.com')), true);
  for (const other of [
    url.replace('claude.ai', 'claude.ai.example.com'),
    url.replace('/oauth/authorize', '/docs'),
    url.replace('claude.ai', 'claude.ai:444'),
    'invalid',
  ]) {
    assert.equal(isClaudeAuthorizationUrl(other), false);
  }
});

test('terminal soft wrapping preserves the complete URL and duplicate output is deduplicated', () => {
  assert.deepEqual(
    terminalSignInLinks(
      buffer([
        { text: 'Open this link:' },
        { text: url.slice(0, 40) },
        { text: url.slice(40), wrapped: true },
        { text: url },
      ]),
    ),
    [url],
  );
});

test('an unfinished URL is not opened at a poll boundary', () => {
  const lines = [{ text: url.slice(0, 40) }, { text: url.slice(40), wrapped: true }];
  assert.deepEqual(terminalSignInLinks(buffer(lines, 0)), []);
  assert.deepEqual(terminalSignInLinks(buffer(lines, 1)), []);
  assert.deepEqual(terminalSignInLinks(buffer(lines, 2)), [url]);
});
