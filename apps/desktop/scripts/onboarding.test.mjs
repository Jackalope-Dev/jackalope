import assert from 'node:assert/strict';
import test from 'node:test';

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
};
globalThis.window = { localStorage: globalThis.localStorage };
const { useOnboardingStore: store } = await import('../src/stores/onboardingStore.ts');
const { useProjectStore: projects } = await import('../src/stores/projectStore.ts');

test('first launch resumes after opening a project, including across hydration', async () => {
  store.setState({ status: 'new', step: 'project' });
  store.getState().initialize(false);
  assert.equal(store.getState().status, 'active');
  assert.equal(store.getState().step, 'project');
  store.getState().go('project');
  store.getState().selectProject('first');
  store.getState().go('agent');
  const saved = values.get('jackalope-onboarding-v1');
  store.setState({ status: 'new', step: 'project' });
  values.set('jackalope-onboarding-v1', saved);
  await store.persist.rehydrate();
  store.getState().initialize(true);
  assert.equal(store.getState().status, 'active');
  assert.equal(store.getState().step, 'agent');
  assert.equal(store.getState().projectId, 'first');
});

test('upgrades with existing projects enter the workspace', () => {
  store.setState({ status: 'new', step: 'project' });
  store.getState().initialize(true);
  assert.equal(store.getState().status, 'complete');
});

test('legacy skipped profiles stay compatible, and guided setup can be completed', () => {
  store.getState().begin();
  store.getState().go('task');
  store.setState({ status: 'skipped' });
  store.getState().initialize(false);
  assert.equal(store.getState().status, 'skipped');
  store.getState().begin();
  assert.equal(store.getState().status, 'active');
  assert.equal(store.getState().step, 'project');
  store.getState().finish();
  assert.equal(store.getState().status, 'complete');
});

test('adding a project clears previous setup context', () => {
  store.getState().begin('first');
  store.getState().go('task');
  store.getState().finish();
  store.getState().begin();
  assert.equal(store.getState().step, 'project');
  assert.equal(store.getState().projectId, null);
});
test('old account and theme steps migrate to project setup', async () => {
  for (const step of ['account', 'theme']) {
    values.set(
      'jackalope-onboarding-v1',
      JSON.stringify({ state: { status: 'active', step }, version: 0 }),
    );
    await store.persist.rehydrate();
    assert.equal(store.getState().step, 'project');
    assert.equal(store.getState().status, 'active');
  }
});

const existingProject = {
  id: 'existing',
  name: 'Existing',
  path: 'C:/Projects/existing',
  gitBranch: 'main',
  agentProvider: 'codex',
  worktrees: [],
  preferences: { preferredRunner: 'codex', customInstructions: 'Keep existing instructions.' },
};
const pendingProject = {
  ...existingProject,
  id: 'pending',
  name: 'Pending',
  path: 'C:/Projects/pending',
  preferences: {
    preferredRunner: 'claude',
    allowedAgents: ['claude'],
    theme: { id: 'project-theme' },
  },
};

test('returning to the project step keeps setup active and saved projects untouched', () => {
  projects.setState({ projects: [existingProject], activeProjectId: existingProject.id });
  store.getState().begin();
  store.getState().stageProject(pendingProject, 'A task that is not ready yet');
  store.getState().go('theme');
  assert.deepEqual(projects.getState().projects, [existingProject]);
  assert.equal(projects.getState().activeProjectId, existingProject.id);
  store.getState().go('project');
  assert.equal(store.getState().status, 'active');
  assert.deepEqual(store.getState().pendingProject, pendingProject);
  assert.equal(store.getState().firstTask, 'A task that is not ready yet');
  assert.deepEqual(projects.getState().projects, [existingProject]);
  assert.equal(projects.getState().activeProjectId, existingProject.id);
});

test('provisional appearance and first task survive reload without registering a project', async () => {
  projects.setState({ projects: [existingProject], activeProjectId: existingProject.id });
  store.getState().begin();
  store.getState().stageProject(pendingProject, 'Keep this draft');
  store.getState().go('theme');
  const saved = values.get('jackalope-onboarding-v1');
  store.getState().finish();
  values.set('jackalope-onboarding-v1', saved);
  await store.persist.rehydrate();
  assert.equal(store.getState().step, 'theme');
  assert.deepEqual(store.getState().pendingProject, pendingProject);
  assert.equal(store.getState().firstTask, 'Keep this draft');
  assert.deepEqual(projects.getState().projects, [existingProject]);
  const completed = projects.getState().completeSetup(store.getState().pendingProject);
  store.getState().finish();
  assert.equal(projects.getState().projects.length, 2);
  assert.equal(projects.getState().activeProjectId, completed.id);
  assert.equal(completed.preferences.theme.id, 'project-theme');
});

test('reconfiguring an existing repository saves only setup preferences and does not duplicate it', () => {
  projects.setState({ projects: [existingProject], activeProjectId: existingProject.id });
  const pending = { ...pendingProject, path: 'C:\\Projects\\existing' };
  store.getState().begin();
  store.getState().stageProject(pending);
  assert.equal(projects.getState().projects[0].preferences.preferredRunner, 'codex');
  projects.getState().updateProjectPreferences(existingProject.id, {
    customInstructions: 'Updated while setup was open.',
  });
  const completed = projects.getState().completeSetup(pending);
  assert.equal(completed.id, existingProject.id);
  assert.equal(projects.getState().projects.length, 1);
  assert.equal(completed.preferences.preferredRunner, 'claude');
  assert.equal(completed.preferences.customInstructions, 'Updated while setup was open.');
});
