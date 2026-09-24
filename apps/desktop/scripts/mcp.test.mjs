import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  recommendationFor,
  recommendedMatches,
  recommendedServers,
} from '../src/components/mcp/curated-servers.ts';
import { marketplaceSetup, safeMarketplaceUrl } from '../src/components/mcp/marketplace-info.ts';
import { agentCapabilities, connectionSupport } from '../src/lib/agent-capabilities.ts';
import {
  bearerToken,
  connectionFailure,
  effectiveConnections,
  redactConnection,
  withBearerToken,
  withoutBearerToken,
} from '../src/lib/mcp-connection.ts';
import {
  deleteMcpServer,
  listMcpServers,
  probeMcpServer,
  saveMcpServer,
} from '../src/lib/tauri-bridge.ts';
import { useMcpStore } from '../src/stores/mcpStore.ts';
import { useSettingsStore } from '../src/stores/settingsStore.ts';

test('all built-in agents share discovery with explicit transport and account limits', () => {
  for (const agent of ['codex', 'claude', 'grok', 'opencode', 'antigravity', 'gemini']) {
    assert.equal(connectionSupport(agent, 'stdio', true), null);
    assert.equal(connectionSupport(agent, 'http', true), null);
    assert.notEqual(connectionSupport(agent, 'sse', true), null);
  }
  assert.equal(connectionSupport('claude', 'sse', false), null);
  assert.notEqual(connectionSupport('codex', 'sse', false), null);
  assert.notEqual(connectionSupport('antigravity', 'http', false), null);
  assert.notEqual(connectionSupport('gemini', 'stdio', false), null);
  assert.notEqual(connectionSupport('unknown', 'http', true), null);
  assert.equal(agentCapabilities('antigravity').accounts, true);
  assert.equal(agentCapabilities('opencode').capacity, false);
});

test('marketplace opt-out blocks search and detail fetches and discards in-flight results', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let release;
  globalThis.fetch = async () => {
    calls++;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  try {
    useSettingsStore.getState().setUseMcpMarketplace(false);
    await useMcpStore.getState().searchMarketplace('private query');
    await useMcpStore.getState().inspectServer({ id: 'test', description: 'test' });
    assert.equal(calls, 0);
    useSettingsStore.getState().setUseMcpMarketplace(true);
    const request = useMcpStore.getState().searchMarketplace('test');
    assert.equal(calls, 1);
    useSettingsStore.getState().setUseMcpMarketplace(false);
    release({ ok: true, json: async () => ({ servers: [{ id: 'stale' }] }) });
    await request;
    assert.deepEqual(useMcpStore.getState().marketplaceServers, []);
    assert.equal(useMcpStore.getState().loadingMarketplace, false);
  } finally {
    globalThis.fetch = originalFetch;
    useSettingsStore.getState().setUseMcpMarketplace(true);
  }
});

test('marketplace detail renders the API server fields, not raw JSON', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      server: {
        description: 'Description',
        aiOverview: 'Overview',
        aiFeatures: ['One feature'],
        tools: [{ name: 'query', description: 'Read data' }],
        readme: '# Instructions',
        license: 'MIT',
      },
    }),
  });
  try {
    await useMcpStore.getState().inspectServer({ id: 'test', description: 'Fallback' });
    assert.equal(
      useMcpStore.getState().inspectingMarkdown,
      'Description\n\nOverview\n\n- One feature',
    );
    assert.equal(useMcpStore.getState().inspectingDetails.tools[0].name, 'query');
    assert.equal(useMcpStore.getState().inspectingDetails.readme, '# Instructions');
    assert.equal(useMcpStore.getState().inspectingDetails.license, 'MIT');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('detail errors are visible and closing discards a late response', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await useMcpStore.getState().inspectServer({ id: 'error', description: 'Listing remains' });
    assert.match(useMcpStore.getState().inspectError, /503/);
    assert.equal(useMcpStore.getState().inspectingDetails, null);
    let release;
    globalThis.fetch = async () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pending = useMcpStore.getState().inspectServer({ id: 'late', description: '' });
    useMcpStore.getState().clearInspecting();
    release({ ok: true, json: async () => ({ server: { readme: 'Late data' } }) });
    await pending;
    assert.equal(useMcpStore.getState().inspectingDetails, null);
    assert.equal(useMcpStore.getState().inspectingServer, null);
    assert.equal(useMcpStore.getState().inspectError, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('setup facts include snippet fields without inventing configuration or authentication', () => {
  const empty = marketplaceSetup({ envVars: [], installKind: 'stdio', installConfidence: 'low' });
  assert.equal(empty.config, undefined);
  assert.equal(empty.reviewNeeded, true);
  const remote = marketplaceSetup({
    envVars: ['TOKEN'],
    installKind: 'stdio',
    installConfidence: 'high',
    claudeConfigSnippet: {
      mcpServers: { test: { url: 'https://example.com/mcp', env: { TOKEN: '', TENANT: '' } } },
    },
  });
  assert.equal(remote.remote, true);
  assert.deepEqual(remote.envVars, ['TOKEN', 'TENANT']);
  assert.equal(safeMarketplaceUrl('javascript:alert(1)'), undefined);
  assert.equal(safeMarketplaceUrl('file:///etc/passwd'), undefined);
  assert.equal(safeMarketplaceUrl('https://example.com/docs'), 'https://example.com/docs');
});

test('settingsStore defaults useMcpMarketplace to true (opt-out)', () => {
  const store = useSettingsStore.getState();
  assert.equal(typeof store.useMcpMarketplace, 'boolean');
  // Verify toggling works
  store.setUseMcpMarketplace(false);
  assert.equal(useSettingsStore.getState().useMcpMarketplace, false);
  store.setUseMcpMarketplace(true);
  assert.equal(useSettingsStore.getState().useMcpMarketplace, true);
});

test('MCP operations require a desktop connection and cannot invent results', async () => {
  const server = { id: 'test', name: 'Test', scope: 'global', transport: 'stdio', command: 'node' };
  for (const operation of [
    () => listMcpServers(),
    () => saveMcpServer(server),
    () => deleteMcpServer(server.id, server.scope),
    () => probeMcpServer(server),
  ])
    await assert.rejects(operation, /desktop app/);
  await useMcpStore.getState().loadServers();
  assert.deepEqual(useMcpStore.getState().servers, []);
  assert.match(useMcpStore.getState().serversError, /desktop app/);
  await useMcpStore.getState().probeServer(server);
  assert.equal(useMcpStore.getState().probeResults['global:test'].ok, false);
  assert.deepEqual(useMcpStore.getState().probeResults['global:test'].tools, []);
});

test('curated presets use publisher endpoints and pinned local packages', () => {
  assert.equal(
    new Set(recommendedServers.map((server) => server.id)).size,
    recommendedServers.length,
  );
  for (const server of recommendedServers) {
    const preset = recommendationFor(server.id);
    assert.ok(preset.publisher);
    assert.ok(preset.documentation.startsWith('https://'));
    const config = marketplaceSetup(server).config;
    if (config.url) assert.ok(config.url.startsWith('https://'));
    else {
      assert.ok(config.args.some((arg) => /@\d+\.\d+\.\d+$/.test(arg)));
      assert.ok(config.args.includes('--isolated'));
    }
  }
  const github = recommendedMatches('github')[0];
  assert.equal(marketplaceSetup(github).config.url, 'https://api.githubcopilot.com/mcp/');
  assert.equal(recommendedMatches('notion')[0].id, 'notion-remote');
  assert.equal(recommendedMatches('jira')[0].id, 'atlassian-mcp-server');
  assert.deepEqual(recommendedMatches('impossible missing'), []);
  assert.equal(
    new URL(marketplaceSetup(recommendedMatches('supabase')[0]).config.url).searchParams.get(
      'read_only',
    ),
    'true',
  );
});

test('token editing preserves unrelated options and removes conflicting bearer headers', () => {
  const options = {
    headers: { authorization: 'Bearer old', 'X-Tenant': 'workspace' },
    http_headers: { Authorization: 'Bearer older', 'X-Client': 'client' },
    bearer_token_env_var: 'OLD_TOKEN',
    enabled_tools: ['read'],
  };
  assert.equal(bearerToken({ headers: { Authorization: 'Bearer current' } }), 'current');
  const stripped = withoutBearerToken(options);
  assert.equal(bearerToken(stripped), undefined);
  assert.equal(options.headers.authorization, 'Bearer old');
  const updated = withBearerToken(stripped, 'replacement');
  assert.deepEqual(updated, {
    headers: { 'X-Tenant': 'workspace', 'X-Client': 'client', Authorization: 'Bearer replacement' },
    enabled_tools: ['read'],
  });
});

test('copied diagnostics omit credentials, argument values and opaque URL paths', () => {
  const redacted = JSON.stringify(
    redactConnection({
      id: 'example',
      transport: 'http',
      url: 'https://user:password@example.com/private-token?access=secret#fragment',
      env: { TENANT: 'private-tenant' },
      extra: {
        headers: { 'X-Key': 'header-secret' },
        api_key: 'api-secret',
        nested: { opaque: 'nested-secret' },
      },
    }),
  );
  for (const secret of ['password', 'private-token', 'secret', 'private-tenant', 'fragment'])
    assert.ok(!redacted.includes(secret));
  const local = JSON.stringify(
    redactConnection({
      id: 'local',
      command: 'private-command',
      args: ['argument-secret'],
      extra: {},
      env: {},
    }),
  );
  assert.ok(!local.includes('private-command'));
  assert.ok(!local.includes('argument-secret'));
  assert.ok(!connectionFailure('401 Bearer super-private').detail.includes('super-private'));
});

test('project overrides shadow managed global connections including disabled overrides', () => {
  const servers = [
    { id: 'shared', scope: 'global', managed: true },
    { id: 'disabled', scope: 'global', managed: true },
    { id: 'legacy', scope: 'global', managed: false },
    { id: 'shared', scope: 'project:p' },
    { id: 'disabled', scope: 'project:p', enabled: false },
    { id: 'other', scope: 'project:q' },
  ];
  assert.deepEqual(effectiveConnections(servers, 'p'), [servers[3]]);
  assert.deepEqual(effectiveConnections(servers, 'q'), [servers[0], servers[1], servers[5]]);
});

test('saving a connection invalidates an older in-flight probe without losing other checks', async () => {
  const previousWindow = globalThis.window;
  let release;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command) => {
        if (command === 'mcp_probe_server')
          return new Promise((resolve) => {
            release = resolve;
          });
        if (command === 'mcp_list_servers') return [];
      },
    },
  };
  try {
    const server = {
      id: 'changing',
      scope: 'global',
      transport: 'http',
      url: 'https://example.com/mcp',
    };
    useMcpStore.setState({ probeResults: { 'global:unrelated': { ok: true, tools: [] } } });
    const pending = useMcpStore.getState().probeServer(server);
    await useMcpStore.getState().saveServer(server);
    release({ ok: true, tools: [{ name: 'stale' }] });
    await pending;
    assert.equal(useMcpStore.getState().probeResults['global:changing'], undefined);
    assert.equal(useMcpStore.getState().probingIds['global:changing'], false);
    assert.equal(useMcpStore.getState().probeResults['global:unrelated'].ok, true);
  } finally {
    globalThis.window = previousWindow;
  }
});
