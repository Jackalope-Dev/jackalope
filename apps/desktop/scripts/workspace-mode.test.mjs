import assert from 'node:assert/strict';
import test from 'node:test';
import { captureDraftForProject } from '../src/lib/capture-draft.ts';
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

test('a fresh draft defaults to isolation only for worktree projects', () => {
  const draft = (workspaceMode) =>
    captureDraftForProject({}, { id: 'p', preferences: { workspaceMode } }, null).isolated;
  assert.equal(draft(undefined), true);
  assert.equal(draft('worktree'), true);
  assert.equal(draft('branch'), false);
  assert.equal(draft('ask'), false);
});
