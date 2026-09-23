import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_THEME } from '@jackalope/brand/theme';
import { portableSettings, syncDecision, syncedTheme } from '../src/lib/settings-sync.ts';

const local = portableSettings(DEFAULT_THEME, {
  mascotReactions: true,
  notifications: 'all',
  osNotifications: true,
});
test('portable settings exclude new fields, secrets, paths and arbitrary theme names by default', () => {
  const settings = portableSettings(
    { ...DEFAULT_THEME, name: 'private name', providerKey: 'secret' },
    {
      mascotReactions: true,
      notifications: 'all',
      osNotifications: true,
      worktreeParentDir: '/private',
      apiKey: 'secret',
      futureSetting: 'unreviewed',
    },
  );
  assert.deepEqual(settings, local);
  assert.equal(syncedTheme(settings).accentHex, DEFAULT_THEME.accentHex);
});
test('fresh devices restore cloud preferences, while concurrent edits require a choice', () => {
  const remote = { ...local, atmosphere: 50 };
  const edited = { ...local, notifications: 'none' };
  assert.equal(syncDecision(local, null, null), 'upload');
  assert.equal(syncDecision(local, null, remote), 'download');
  assert.equal(syncDecision(local, local, remote), 'download');
  assert.equal(syncDecision(edited, local, local), 'upload');
  assert.equal(syncDecision(edited, local, remote), 'conflict');
  assert.equal(syncDecision(remote, local, remote), 'same');
});
