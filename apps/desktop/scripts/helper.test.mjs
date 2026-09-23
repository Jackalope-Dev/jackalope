import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_THEME } from '@jackalope/brand/theme';
import {
  guideMarkdown,
  knowledgeFiles,
  knowledgeGuides,
} from '../../../packages/knowledge/src/index.ts';
import { helperPreferencePatch, helperTheme, sameHelperValue } from '../src/lib/helper-actions.ts';

test('helper theme changes preserve saved palette and automatic appearance', () => {
  const base = { ...DEFAULT_THEME, appearance: 'automatic', harmony: 'trio', atmosphere: 31 };
  const next = helperTheme(base, { scope: 'app', accent: '#a855f7' });
  assert.equal(next.appearance, 'automatic');
  assert.equal(next.harmony, 'trio');
  assert.equal(next.atmosphere, 31);
  assert.equal(base.accentHex, DEFAULT_THEME.accentHex);
  assert.equal(helperTheme(base, { scope: 'project', appearance: 'light' }).isDark, false);
  assert.throws(() => helperTheme(base, { scope: 'app', atmosphere: 65 }));
  assert.throws(() => helperTheme(base, { scope: 'app', accent: '#bad' }));
});

test('helper preference changes reject execution, privacy and unknown settings', () => {
  assert.deepEqual(helperPreferencePatch({ notifications: 'none', mascot_animations: false }), {
    notifications: 'none',
    mascotReactions: false,
  });
  for (const change of [
    { telemetryEnabled: true },
    { concurrencyLimit: 100 },
    { os_notifications: 'true' },
    { notifications: 'invalid' },
    {},
  ])
    assert.throws(() => helperPreferencePatch(change));
  assert.equal(sameHelperValue({ a: 1, b: { c: false } }, { b: { c: false }, a: 1 }), true);
  assert.equal(sameHelperValue({ a: false }, { a: true }), false);
});

test('agent-readable docs preserve callouts, code and source attribution', () => {
  const guide = knowledgeGuides.find((guide) => guide.slug === 'ask-jackalope');
  assert.ok(guide);
  const markdown = guideMarkdown(
    {
      ...guide,
      sections: [
        {
          id: 'test',
          question: 'Question',
          paragraphs: ['Answer'],
          bullets: ['Detail'],
          codeBox: { title: 'Example', code: 'literal code' },
          callout: { kind: 'note', text: 'A meaningful limit' },
        },
      ],
    },
    'https://jackalope.dev',
  );
  assert.match(markdown, /https:\/\/jackalope.dev\/knowledge\/ask-jackalope\//);
  assert.match(markdown, /```\nliteral code\n```/);
  assert.match(markdown, /> A meaningful limit/);
  assert.equal(Object.keys(knowledgeFiles('https://jackalope.dev')).length, knowledgeGuides.length);
});
