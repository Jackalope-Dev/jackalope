import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import actions from '../src/components/layout/menu-actions.json' with { type: 'json' };

// commands.ts imports UI modules Node can't load here, so read its command ids from source.
const commands = readFileSync(
  new URL('../src/components/layout/commands.ts', import.meta.url),
  'utf8',
);
const ids = new Set([...commands.matchAll(/^ {4}id: '([A-Za-z]+)',$/gm)].map((match) => match[1]));

test('every tray and app menu action names a command', () => {
  assert.ok(ids.has('newWork') && ids.has('help'), 'command ids are read from commands.ts');
  for (const [item, command] of Object.entries(actions))
    assert.ok(ids.has(command), `${item} runs ${command}, which is not a command`);
});
