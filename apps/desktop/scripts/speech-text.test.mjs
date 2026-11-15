import assert from 'node:assert/strict';
import test from 'node:test';
import { speakableText, utterances } from '../src/lib/speech-text.ts';

test('a reply is read as prose, with code and addresses named or dropped', () => {
  const reply = [
    '## Found it',
    '',
    'The **lockfile** check fails because `cache-key` ignores the _pnpm_ version. See [the run](https://ci.example/run/42) or https://ci.example/all.',
    '',
    '```ts',
    'const key = hash(lockfile);',
    '```',
    '',
    '| File | Lines |',
    '| --- | --- |',
    '| a.ts | 12 |',
    '',
    '- [x] Fixed the key',
    '2. Added a test',
    '> Note: rerun CI',
  ].join('\n');
  assert.equal(
    speakableText(reply),
    [
      'Found it.',
      'The lockfile check fails because cache-key ignores the pnpm version. See the run or link',
      'Code block.',
      'Fixed the key',
      'Added a test',
      'Note: rerun CI',
    ].join('\n'),
  );
  // Names with underscores and an unfinished code block survive.
  assert.equal(speakableText('Run verify_quick now'), 'Run verify_quick now');
  assert.equal(speakableText('Start\n```\nstill streaming'), 'Start\nCode block.');
  assert.equal(speakableText('```\nonly code\n```'), 'Code block.');
});

test('long text is split into short utterances without losing words', () => {
  const sentence =
    'This sentence has a clause, and another clause; then a third one that keeps going. ';
  const text = sentence.repeat(6).trim();
  const parts = utterances(text, 120);
  assert.equal(parts.length, 6);
  assert.ok(
    parts.every((part) => part.length <= 120),
    JSON.stringify(parts),
  );
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '));
  const unbroken = utterances('word '.repeat(100).trim(), 50);
  assert.ok(unbroken.every((part) => part.length <= 50));
  assert.equal(unbroken.join(' '), 'word '.repeat(100).trim());
  assert.deepEqual(utterances('One.\n\nTwo.'), ['One.', 'Two.']);
  assert.deepEqual(utterances(''), []);
});
