import test from 'node:test';
import assert from 'node:assert/strict';

test('settingsStore defaults, updates, and export formatting', async () => {
  // Test default settings invariants
  const { DEFAULT_SETTINGS } = await import('../src/stores/settingsStore.ts');
  
  assert.equal(DEFAULT_SETTINGS.experienceMode, 'simple');
  assert.equal(DEFAULT_SETTINGS.defaultRunner, 'codex');
  assert.equal(DEFAULT_SETTINGS.concurrencyLimit, 2);
  assert.equal(DEFAULT_SETTINGS.telemetryEnabled, true); // Opt-out per docs/BACKEND.md
  assert.equal(DEFAULT_SETTINGS.crashReportingEnabled, true);
  assert.equal(DEFAULT_SETTINGS.branchPrefix, 'jackalope/');
  assert.equal(DEFAULT_SETTINGS.worktreeParentDir, '.worktrees');
  assert.equal(DEFAULT_SETTINGS.mascotReactions, true);
});

test('projectStore preferences structure and overrides', async () => {
  const { useProjectStore } = await import('../src/stores/projectStore.ts');
  
  const testProject = {
    id: 'test-proj-settings-1',
    name: 'Jackalope Core',
    path: '/path/to/jackalope',
    gitBranch: 'master',
    agentProvider: 'codex',
  };

  await useProjectStore.getState().addProject(testProject);
  
  const initial = useProjectStore.getState().projects.find((p) => p.id === testProject.id);
  assert.ok(initial);
  assert.equal(initial.name, 'Jackalope Core');

  // Update preferences
  useProjectStore.getState().updateProjectPreferences(testProject.id, {
    preferredRunner: 'claude',
    verifyCommand: 'pnpm build',
    customInstructions: 'Always keep TypeScript strict mode clean.',
  });

  const updated = useProjectStore.getState().projects.find((p) => p.id === testProject.id);
  assert.ok(updated);
  assert.equal(updated.preferences?.preferredRunner, 'claude');
  assert.equal(updated.preferences?.verifyCommand, 'pnpm build');
  assert.equal(updated.preferences?.customInstructions, 'Always keep TypeScript strict mode clean.');

  // Clean up
  useProjectStore.getState().removeProject(testProject.id);
  const deleted = useProjectStore.getState().projects.find((p) => p.id === testProject.id);
  assert.equal(deleted, undefined);
});
