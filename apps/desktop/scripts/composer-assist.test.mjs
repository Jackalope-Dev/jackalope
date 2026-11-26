import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composerCommands,
  composingKey,
  insertMention,
  matchCommands,
  mentionQuery,
  parseCommand,
  slashQuery,
} from '../src/lib/composer-commands.ts';
import { proseMention, strongFileMatch } from '../src/lib/file-search.ts';
import {
  attachesPaste,
  insertPasted,
  pastedTextLabel,
  restorePaste,
} from '../src/lib/large-paste.ts';
import { caretAtEdge, historyEntries, stepHistory } from '../src/lib/prompt-history.ts';
import { compactTokens, contextShare, isReasoningEffort } from '../src/lib/reasoning-effort.ts';

test('only the commands a composer supports are offered, built-in names first', () => {
  const names = (context) => composerCommands(context).map((command) => command.name);
  assert.deepEqual(names({}), []);
  assert.deepEqual(names({ model: true, effort: true, plan: true }), ['model', 'effort', 'plan']);
  assert.deepEqual(names({ clear: true, btw: true }), ['clear', 'btw']);
  const withSkills = composerCommands({
    btw: true,
    provider: [
      { name: 'review', description: 'Review the diff' },
      { name: 'btw', description: 'A skill cannot shadow a built-in command' },
      { name: 'bad name', description: 'Not a command name' },
    ],
  });
  assert.deepEqual(
    withSkills.map((command) => [command.id, command.name]),
    [
      ['btw', 'btw'],
      ['provider', 'review'],
    ],
  );
  assert.deepEqual(
    matchCommands(composerCommands({ model: true, effort: true }), 'E').map((c) => c.name),
    ['effort'],
  );
});

test('a slash command is only recognised at the start of the draft, before any space', () => {
  assert.equal(slashQuery('/', 1), '');
  assert.equal(slashQuery('/mod', 4), 'mod');
  assert.equal(slashQuery('/btw why', 8), null);
  assert.equal(slashQuery('hi /model', 9), null);
  assert.equal(slashQuery('/model', 0), null);
  // Typing `/` before an existing draft offers nothing that could replace the draft.
  assert.equal(slashQuery('/fix the login bug', 1), null);
  assert.equal(slashQuery('/cfix the login bug', 2), null);
  assert.equal(slashQuery('/mo\n', 3), 'mo');
  assert.equal(slashQuery('/model  ', 6), 'model');
  assert.deepEqual(parseCommand('  /BTW  what changed?\nand why '), {
    name: 'btw',
    argument: 'what changed?\nand why',
  });
  assert.deepEqual(parseCommand('/clear'), { name: 'clear', argument: '' });
  assert.equal(parseCommand('/ nothing'), null);
  assert.equal(parseCommand('no command'), null);
});

test('a mention starts the draft or follows whitespace and inserts its path', () => {
  assert.deepEqual(mentionQuery('see @src/ap', 11), { start: 4, query: 'src/ap' });
  assert.deepEqual(mentionQuery('@', 1), { start: 0, query: '' });
  assert.equal(mentionQuery('mail me@example.com', 19), null);
  assert.equal(mentionQuery('see @src now', 12), null);
  const inserted = insertMention('see @ap and more', 4, 7, 'src/app.ts');
  assert.equal(inserted.text, 'see @src/app.ts and more');
  assert.equal(inserted.caret, 'see @src/app.ts '.length);
  assert.equal(insertMention('@ap', 0, 3, 'docs/My Notes.md').text, '@"docs/My Notes.md" ');
});

test('history browsing keeps the draft and edits, and stops at either end', () => {
  const entries = historyEntries([' first ', 'first', '', 'second']);
  assert.deepEqual(entries, ['first', 'second']);
  assert.equal(stepHistory(entries, null, 'draft', 'down'), null);
  assert.equal(stepHistory([], null, 'draft', 'up'), null);
  let step = stepHistory(entries, null, 'my draft', 'up');
  assert.equal(step.text, 'second');
  step = stepHistory(entries, step.browse, 'second, edited', 'up');
  assert.equal(step.text, 'first');
  step = stepHistory(entries, step.browse, 'first', 'up');
  assert.equal(step.text, 'first');
  step = stepHistory(entries, step.browse, 'first', 'down');
  assert.equal(step.text, 'second, edited');
  step = stepHistory(entries, step.browse, 'second, edited', 'down');
  assert.equal(step.text, 'my draft');
  assert.equal(step.browse, null);
  assert.equal(caretAtEdge('one\ntwo', 2, 2, 'up'), true);
  assert.equal(caretAtEdge('one\ntwo', 5, 5, 'up'), false);
  assert.equal(caretAtEdge('one\ntwo', 5, 5, 'down'), true);
  assert.equal(caretAtEdge('one\ntwo', 0, 3, 'up'), false);
});

test('large or overflowing pastes become attachments and undo restores them in place', () => {
  assert.equal(attachesPaste('short'), false);
  assert.equal(attachesPaste('   \n  '.repeat(10000)), false);
  assert.equal(attachesPaste('a'.repeat(32 * 1024 - 1)), false);
  assert.equal(attachesPaste('a'.repeat(32 * 1024)), true);
  // Multi-byte characters count by their UTF-8 size.
  assert.equal(attachesPaste('é'.repeat(16 * 1024)), true);
  assert.equal(attachesPaste('twelve chars', 11), true);
  assert.equal(pastedTextLabel('a\nb'), 'Pasted text · 3 characters, 2 lines');
  const reference = 'Attached file: /p/.jackalope/attachments/x.txt';
  assert.equal(
    restorePaste(`Fix this\n${reference}\nthanks`, reference, 'LOG'),
    'Fix this\nLOG\nthanks',
  );
  assert.equal(restorePaste('Fix this', reference, 'LOG'), 'Fix this\n\nLOG');
  assert.equal(restorePaste('', reference, 'LOG'), 'LOG');
});

test('context is shown only when reported, as a share of a reported window', () => {
  assert.equal(contextShare(undefined), null);
  assert.equal(contextShare({ used: 0, window: 100 }), null);
  assert.deepEqual(contextShare({ used: 50_000 }), {
    used: 50_000,
    window: null,
    share: null,
    level: 'normal',
  });
  assert.equal(contextShare({ used: 150_000, window: 200_000 }).level, 'high');
  assert.equal(contextShare({ used: 300_000, window: 200_000 }).share, 1);
  assert.equal(contextShare({ used: 300_000, window: 200_000 }).level, 'full');
  assert.equal(compactTokens(950), '950');
  assert.equal(compactTokens(48_213), '48.2k');
  assert.equal(compactTokens(200_000), '200k');
  assert.equal(compactTokens(1_000_000), '1M');
  assert.equal(isReasoningEffort('xhigh'), true);
  assert.equal(isReasoningEffort('none'), false);
});

test('Enter accepts a mention only for a close match, and prose stays quiet', () => {
  assert.equal(strongFileMatch('src/search.tsx', 'sea'), true);
  assert.equal(strongFileMatch('src/search.tsx', 'src/se'), true);
  assert.equal(strongFileMatch('apps/desktop/src/App.tsx', 'desktop/src'), true);
  assert.equal(strongFileMatch('src/search.tsx', 'S'), false);
  // A subsequence that only scatters across the path is weak.
  assert.equal(strongFileMatch('src/components/sessions/SessionStart.tsx', 'sam'), false);
  assert.equal(strongFileMatch('src/search.tsx', 'arch'), false);
  assert.equal(proseMention('sam'), true);
  assert.equal(proseMention('José'), true);
  assert.equal(proseMention('src/se'), false);
  assert.equal(proseMention('app.ts'), false);
});

test('an IME composition key never sends', () => {
  assert.equal(composingKey({ isComposing: true, keyCode: 13 }), true);
  assert.equal(composingKey({ isComposing: false, keyCode: 229 }), true);
  assert.equal(composingKey({ isComposing: false, keyCode: 13 }), false);
});

test('pasted text that could not be saved lands where it was pasted', () => {
  const at = { start: 4, end: 9, value: 'Fix [sel] now' };
  assert.equal(insertPasted('Fix [sel] now', 'LOG', at), 'Fix LOG now');
  assert.equal(insertPasted('Fix it later', 'LOG', at), 'Fix it later\n\nLOG');
  assert.equal(insertPasted('', 'LOG', { start: null, end: null, value: 'x' }), 'LOG');
});
