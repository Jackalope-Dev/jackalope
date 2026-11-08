import assert from 'node:assert/strict';
import test from 'node:test';
import actions from '../src/components/layout/menu-actions.json' with { type: 'json' };
import { defaultShortcuts } from '../src/lib/shortcuts.ts';

test('every tray and app menu action names a shortcut command', () => {
  for (const [item, command] of Object.entries(actions))
    assert.ok(
      Object.hasOwn(defaultShortcuts, command),
      `${item} runs ${command}, which is not a command`,
    );
});
