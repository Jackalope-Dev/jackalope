import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionMarkdown } from '../src/lib/session-export.ts';

test('a conversation exports as its messages and replies in order', () => {
  const message = (id, text, runId, extra = {}) => ({
    id,
    text,
    createdAt: '2026-11-01T10:00:00.000Z',
    runId,
    canceled: false,
    ...extra,
  });
  const session = {
    id: 's',
    title: ' Fix the lockfile check ',
    request: { projectName: 'Shop' },
    createdAt: '2026-11-01T09:59:00.000Z',
    messages: [
      message('m1', 'Why does the check fail?', 'r1'),
      message('m2', ' Also look at CI. ', 'r1'),
      message('m3', 'Never mind', null, { canceled: true }),
      message('m4', 'Nightly sweep', 'r2', { origin: { kind: 'wake', label: 'Nightly sweep' } }),
      message('m5', 'Still waiting', 'r3'),
    ],
  };
  const runs = [
    { id: 'r1', result: '## Found it\nThe cache key ignores the pnpm version.\n' },
    { id: 'r2', result: 'Nothing to update.' },
    { id: 'r3', result: '' },
  ];
  assert.equal(
    sessionMarkdown(session, runs, 'codex'),
    [
      '# Fix the lockfile check',
      'Shop · 2026-11-01',
      '**You**\n\nWhy does the check fail?',
      '**You**\n\nAlso look at CI.',
      '**codex**\n\n## Found it\nThe cache key ignores the pnpm version.',
      '**Nightly sweep**\n\nNightly sweep',
      '**codex**\n\nNothing to update.',
      '**You**\n\nStill waiting',
    ].join('\n\n') + '\n',
  );
  const bot = sessionMarkdown({ ...session, persona: { name: 'Scout' } }, runs, 'codex');
  assert.match(bot, /\*\*Scout\*\*\n\n## Found it/);
  assert.equal(
    sessionMarkdown({ ...session, title: '', messages: [] }, [], 'codex'),
    '# Conversation\n\nShop · 2026-11-01\n',
  );
});
