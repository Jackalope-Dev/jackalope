import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('every tray and app menu action names a registered command', () => {
  const actions = JSON.parse(read('../src/components/layout/menu-actions.json'));
  const registry = read('../src/components/layout/commands.ts');
  const ids = new Set([...registry.matchAll(/^ {4}id: '([^']+)',$/gm)].map((match) => match[1]));
  assert.ok(ids.has('newWork'), 'the command ids are read from commands.ts');
  for (const [item, command] of Object.entries(actions))
    assert.ok(ids.has(command), `${item} runs ${command}, which commands.ts does not define`);
});

test('the native menus read their actions from the shared file', () => {
  const native = read('../src-tauri/src/window_behavior.rs');
  assert.match(native, /include_str!\("\.\.\/\.\.\/src\/components\/layout\/menu-actions\.json"\)/);
  assert.doesNotMatch(native, /"desktop-action", "/);
});
