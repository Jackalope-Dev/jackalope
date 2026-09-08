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

test('first launch resumes after opening a project, including across hydration', async () => {
  store.setState({ status: 'new', step: 'project' });
  store.getState().initialize(false);
  assert.equal(store.getState().status, 'active');
  assert.equal(store.getState().step, 'theme');
  store.getState().go('project');
  store.getState().go('agent');
  const saved = values.get('jackalope-onboarding-v1');
  store.setState({ status: 'new', step: 'project' });
  values.set('jackalope-onboarding-v1', saved);
  await store.persist.rehydrate();
  store.getState().initialize(true);
  assert.equal(store.getState().status, 'active');
  assert.equal(store.getState().step, 'agent');
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
  assert.equal(store.getState().step, 'theme');
  store.getState().finish();
  assert.equal(store.getState().status, 'complete');
});
