import assert from 'node:assert/strict';
import test from 'node:test';

const values = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  },
};
const { useAgentConfigStore: agents, syncAgentConfig } = await import(
  '../src/stores/agentConfigStore.ts'
);
const { useProjectStore: projects, isAgentAllowedForProject } = await import(
  '../src/stores/projectStore.ts'
);
const project = (id, preferences) => ({
  id,
  name: id,
  path: `/fixture/${id}`,
  gitBranch: 'main',
  agentProvider: 'codex',
  worktrees: [],
  preferences,
});

test('project agent lists and defaults survive reload without changing another project or app defaults', async () => {
  agents.setState({
    enabledAgents: { codex: true, claude: true, grok: false },
    defaultMetaAgent: 'codex',
    customAgents: [],
  });
  projects.setState({
    projects: [
      project('work', { preferredRunner: 'claude', agentAccounts: { claude: 'work-login' } }),
      project('personal'),
    ],
  });
  agents.getState().toggleAgent('codex', false, 'work');
  agents.getState().setDefaultMetaAgent('claude', 'work');
  agents.getState().setDefaultMetaAgent('codex', 'personal');
  assert.equal(agents.getState().isAgentEnabled('codex', 'work'), false);
  assert.equal(agents.getState().isAgentEnabled('codex', 'personal'), true);
  assert.equal(agents.getState().isAgentEnabled('codex'), true);
  assert.equal(agents.getState().defaultMetaAgent, 'codex');
  assert.throws(() => agents.getState().setDefaultMetaAgent('codex', 'work'), /Enable/);
  assert.throws(() => agents.getState().toggleAgent('grok', true, 'work'), /app settings/);
  const saved = values.get('jackalope-projects');
  projects.setState({ projects: [] });
  values.set('jackalope-projects', saved);
  await projects.persist.rehydrate();
  assert.equal(agents.getState().isAgentEnabled('codex', 'work'), false);
  assert.equal(projects.getState().projects[0].preferences.preferredRunner, 'claude');
  assert.equal(projects.getState().projects[1].preferences.preferredRunner, 'codex');
  assert.deepEqual(projects.getState().projects[0].preferences.agentAccounts, {
    claude: 'work-login',
  });
  agents.getState().toggleAgent('claude', false, 'work');
  assert.equal(projects.getState().projects[0].preferences.preferredRunner, undefined);
  assert.equal(projects.getState().projects[1].preferences.preferredRunner, 'codex');
});

test('empty project lists block every agent, custom agents remain scoped, and missing projects fail closed', () => {
  projects.setState({ projects: [project('work', { allowedAgents: [] }), project('personal')] });
  agents.getState().addCustomAgent({
    id: 'custom',
    name: 'Custom',
    command: '/fixture/agent',
    adapter: 'codex',
    models: [],
    enabled: true,
    description: '',
  });
  assert.equal(agents.getState().isAgentEnabled('custom', 'work'), false);
  agents.getState().toggleAgent('custom', true, 'work');
  agents.getState().setDefaultMetaAgent('custom', 'work');
  assert.deepEqual(projects.getState().projects[0].preferences.allowedAgents, ['custom']);
  agents.getState().toggleAgent('custom', false, 'work');
  assert.deepEqual(projects.getState().projects[0].preferences.allowedAgents, []);
  assert.equal(agents.getState().isAgentEnabled('custom', 'personal'), true);
  assert.equal(agents.getState().isAgentEnabled('custom', 'removed'), false);
  assert.throws(
    () => agents.getState().toggleAgent('custom', true, 'removed'),
    /no longer available/,
  );
});

test('native policy receives each project list, default and account restrictions independently', async () => {
  const work = {
    allowedAgents: ['claude'],
    preferredRunner: 'claude',
    agentAccounts: { claude: 'work-login' },
    disabledAccounts: { claude: ['personal-login'] },
  };
  const personal = {
    allowedAgents: ['codex'],
    preferredRunner: 'codex',
    agentAccounts: { codex: 'personal-login' },
  };
  projects.setState({ projects: [project('work', work), project('personal', personal)] });
  let saved;
  window.__TAURI_INTERNALS__ = {
    invoke: async (command, args) => {
      assert.equal(command, 'agent_save_policy');
      saved = args.policy;
    },
  };
  try {
    await syncAgentConfig();
    assert.deepEqual(saved.projects.work, work);
    assert.deepEqual(saved.projects.personal, { ...personal, disabledAccounts: {} });
    assert.equal(saved.defaultMetaAgent, 'codex');
  } finally {
    delete window.__TAURI_INTERNALS__;
  }
});

test('usage and quota accounts filter only includes agents enabled on the active project', () => {
  const records = [
    { agent: 'codex', status: 'connected', windows: [{ poolId: '1' }] },
    { agent: 'claude', status: 'connected', windows: [{ poolId: '2' }] },
    { agent: 'grok', status: 'connected', windows: [{ poolId: '3' }] },
    { agent: 'uninstalled', status: 'notInstalled', windows: [{ poolId: '4' }] },
  ];
  projects.setState({
    activeProjectId: 'work',
    projects: [project('work', { allowedAgents: ['claude'] }), project('personal')],
  });
  agents.setState({
    enabledAgents: { codex: true, claude: true, grok: false },
  });

  const filterAccounts = (activeProjectId) => {
    const active = projects.getState().projects.find((p) => p.id === activeProjectId);
    const enabled = agents.getState().enabledAgents;
    const isAgentEnabled = (id) =>
      (enabled[id] ?? true) &&
      (!activeProjectId || (Boolean(active) && isAgentAllowedForProject(active, id)));
    return records.filter(
      (r) => r.status !== 'notInstalled' && isAgentEnabled(r.agent) && r.windows.length > 0,
    );
  };

  assert.deepEqual(
    filterAccounts('work').map((r) => r.agent),
    ['claude'],
  );
  assert.deepEqual(
    filterAccounts('personal').map((r) => r.agent),
    ['codex', 'claude'],
  );
  assert.deepEqual(
    filterAccounts(undefined).map((r) => r.agent),
    ['codex', 'claude'],
  );
});
