import assert from 'node:assert/strict';
import test from 'node:test';

test('model policy defaults allow discovered models and retain saved restrictions', async () => {
  const { useAgentConfigStore: store } = await import('../src/stores/agentConfigStore.ts');
  const previous = store.getState();
  const { name, storage } = store.persist.getOptions();
  try {
    assert.deepEqual(store.getInitialState().allowedModels, {});
    assert.equal(store.getState().isModelAllowed('new-provider-model'), true);
    storage.setItem(name, {
      version: 0,
      state: { allowedModels: { 'saved-model': false, 'explicitly-enabled': true } },
    });
    await store.persist.rehydrate();
    assert.equal(store.getState().isModelAllowed('saved-model'), false);
    assert.equal(store.getState().isModelAllowed('explicitly-enabled'), true);
    assert.equal(store.getState().isModelAllowed('new-provider-model'), true);
    store.getState().toggleModel('new-provider-model');
    assert.equal(store.getState().isModelAllowed('new-provider-model'), false);
  } finally {
    store.setState(previous, true);
  }
});

test('obsolete preferences retire without losing supported settings or saved opt-outs', async () => {
  const { useSettingsStore: store } = await import('../src/stores/settingsStore.ts');
  const options = store.persist.getOptions();
  await options.storage.setItem(options.name, {
    version: 0,
    state: {
      useMcpMarketplace: false,
      notifications: 'failures-only',
      customRunnerPaths: { codex: '/tools/codex' },
      autoFailoverEnabled: true,
      routingPreference: 'quality',
      maxFailoverRetries: 5,
      experienceMode: 'advanced',
      soundAlerts: true,
      pruneWorktreeOnMerge: true,
      debugLogging: true,
      codebaseDiscoveryEnabled: false,
      discoveryRefreshCadence: 'hourly',
      maxDiscoveryTokens: 1200,
      telemetryEnabled: false,
      crashReportingEnabled: false,
    },
  });
  await store.persist.rehydrate();
  assert.equal(store.getState().useMcpMarketplace, false);
  assert.equal(store.getState().notifications, 'failures-only');
  assert.equal(store.getState().customRunnerPaths.codex, '/tools/codex');
  assert.equal('autoFailoverEnabled' in store.getState(), false);
  assert.equal('routingPreference' in JSON.parse(store.getState().exportSettings()), false);
  for (const key of [
    'experienceMode',
    'soundAlerts',
    'pruneWorktreeOnMerge',
    'debugLogging',
    'codebaseDiscoveryEnabled',
    'discoveryRefreshCadence',
    'maxDiscoveryTokens',
  ]) {
    assert.equal(key in store.getState(), false, key);
    assert.equal(key in JSON.parse(store.getState().exportSettings()), false, key);
  }
  assert.equal(store.getState().telemetryEnabled, false);
  assert.equal(store.getState().crashReportingEnabled, false);
  store.getState().resetAll();
});

test('queue dispatch publishes current policy before invoking the queue and stops on policy failure', async () => {
  const originalWindow = globalThis.window;
  const calls = [];
  let rejectPolicy = false;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command) => {
        calls.push(command);
        if (command === 'agent_save_policy' && rejectPolicy) throw new Error('Policy unavailable');
      },
    },
  };
  try {
    const { queueCommand } = await import('../src/lib/queue.ts');
    await queueCommand('queue_dispatch', { projectId: 'fixture', enabled: true });
    assert.deepEqual(calls, ['agent_save_policy', 'queue_dispatch']);
    calls.length = 0;
    rejectPolicy = true;
    await assert.rejects(queueCommand('queue_add', {}), /Policy unavailable/);
    assert.deepEqual(calls, ['agent_save_policy']);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('account groups preserve explicit selections and expose missing or ambiguous matches', async () => {
  const { accountGroupChoices } = await import('../src/lib/account-groups.ts');
  const entries = [
    {
      agent: 'codex',
      profiles: [
        { id: 'work-codex', name: 'Office', group: 'work' },
        { id: 'personal-codex', name: 'Home', group: 'personal' },
      ],
    },
    { agent: 'claude', profiles: [{ id: 'old', name: 'Work' }] },
    {
      agent: 'grok',
      profiles: [
        { id: 'g1', group: 'work' },
        { id: 'g2', group: 'work' },
      ],
    },
  ];
  const result = accountGroupChoices(entries, 'work');
  assert.deepEqual(result.assignments, { codex: 'work-codex' });
  assert.deepEqual(result.missing, ['claude']);
  assert.deepEqual(result.ambiguous, ['grok']);
  assert.deepEqual(accountGroupChoices(entries, 'personal').assignments, {
    codex: 'personal-codex',
  });
});
