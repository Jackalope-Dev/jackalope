import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceModeFor, workspaceRequest } from '../src/lib/workspace-mode.ts';

test('projects without a workspace mode keep isolated worktrees', () => {
  assert.equal(workspaceModeFor(undefined), 'worktree');
  assert.equal(workspaceModeFor({ preferences: {} }), 'worktree');
  assert.equal(workspaceModeFor({ preferences: { isolatedByDefault: false } }), 'current');
  assert.equal(
    workspaceModeFor({ preferences: { isolatedByDefault: false, workspaceMode: 'branch' } }),
    'branch',
  );
});

test('task requests follow the project mode unless the composer chooses isolation', () => {
  assert.deepEqual(workspaceRequest({ preferences: {} }), {
    isolated: true,
    workspaceMode: 'worktree',
  });
  for (const mode of ['branch', 'current', 'ask']) {
    const project = { preferences: { workspaceMode: mode } };
    assert.deepEqual(workspaceRequest(project), { isolated: false, workspaceMode: mode });
    assert.deepEqual(workspaceRequest(project, true), {
      isolated: true,
      workspaceMode: 'worktree',
    });
  }
  // Editing files in a worktree project works on the current branch, as before.
  assert.deepEqual(workspaceRequest({ preferences: {} }, false), {
    isolated: false,
    workspaceMode: 'current',
  });
});
