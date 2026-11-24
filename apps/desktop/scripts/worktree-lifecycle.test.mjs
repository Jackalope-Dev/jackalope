import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectTerminalCommands,
  worktreeCommandsForRegistry,
} from '../src/lib/terminal-commands.ts';
import {
  FIRST_PASS_DELAY_MS,
  PASS_INTERVAL_MS,
  retentionDays,
  retentionLabel,
  worktreeName,
} from '../src/lib/worktree-retention.ts';

test('saved commands without lifecycle options load as before and run nowhere new', () => {
  const saved = [
    { id: 'a', name: 'Test', command: 'pnpm test' },
    { id: 'b', name: 'Install', command: ' pnpm install ', runOnWorktreeCreate: true },
    { id: 'c', name: 'Dev', command: 'pnpm dev', stopWhenFinished: true },
    { id: 'd', name: '', command: 'echo unnamed', runOnWorktreeCreate: true },
    { id: 'e', name: 'Blank', command: '  ', runOnWorktreeCreate: true },
  ];
  assert.deepEqual(worktreeCommandsForRegistry(saved), [
    { name: 'Install', command: 'pnpm install' },
  ]);
  assert.equal(worktreeCommandsForRegistry([saved[0], saved[2]]), undefined);
  assert.equal(worktreeCommandsForRegistry(undefined), undefined);
  assert.equal(worktreeCommandsForRegistry('not a list'), undefined);
  const buttons = projectTerminalCommands({ terminalCommands: saved });
  assert.deepEqual(
    buttons.map((item) => item.id),
    ['a', 'b', 'c'],
  );
  assert.equal(buttons[2].stopWhenFinished, true);
});

test('automatic cleanup is off unless a valid retention period is saved', () => {
  assert.equal(retentionDays(undefined), undefined);
  assert.equal(retentionDays({}), undefined);
  for (const invalid of [0, -1, 1.5, 366, Number.NaN]) {
    assert.equal(retentionDays({ worktreeRetentionDays: invalid }), undefined, String(invalid));
  }
  assert.equal(retentionDays({ worktreeRetentionDays: 7 }), 7);
  assert.equal(retentionLabel(1), 'After 1 day');
  assert.equal(retentionLabel(14), 'After 14 days');
  assert.equal(worktreeName('/repo/.worktrees/fix-login-909b03/'), 'fix-login-909b03');
  assert.equal(worktreeName('C:\\repo\\.worktrees\\task'), 'task');
  assert.ok(FIRST_PASS_DELAY_MS >= 5 * 60 * 1000, 'never on the startup path');
  assert.ok(PASS_INTERVAL_MS >= 60 * 60 * 1000);
});
