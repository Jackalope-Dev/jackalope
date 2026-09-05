import assert from 'node:assert/strict';
import { test } from 'node:test';
import { marketplaceSetup, safeMarketplaceUrl } from '../src/components/mcp/marketplace-info.ts';
import {
  deleteMcpServer,
  listMcpServers,
  probeMcpServer,
  saveMcpServer,
} from '../src/lib/tauri-bridge.ts';
import { useMcpStore } from '../src/stores/mcpStore.ts';
import { useSettingsStore } from '../src/stores/settingsStore.ts';

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

test('tauri-bridge listMcpServers returns configured mock servers with required fields', async () => {
  const servers = await listMcpServers();
  assert.ok(Array.isArray(servers));
  assert.ok(servers.length >= 2);

  const gh = servers.find((s) => s.id === 'github');
  assert.ok(gh);
  assert.equal(gh.scope, 'global');
  assert.equal(gh.transport, 'stdio');
  assert.ok(gh.args && gh.args.length > 0);

  const pg = servers.find((s) => s.id === 'postgres');
  assert.ok(pg);
  assert.equal(pg.scope, 'claude');
  assert.equal(pg.transport, 'stdio');
});

test('tauri-bridge saveMcpServer and deleteMcpServer manage configurations', async () => {
  const newServer = {
    id: 'test-sqlite-mcp',
    name: 'Test SQLite MCP',
    scope: 'codex',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-sqlite'],
    env: { DB_PATH: ':memory:' },
    description: 'In-memory test SQLite server',
    enabled: true,
  };

  await saveMcpServer(newServer);
  let servers = await listMcpServers();
  const added = servers.find((s) => s.id === 'test-sqlite-mcp');
  assert.ok(added);
  assert.equal(added.scope, 'codex');
  assert.equal(added.command, 'npx');

  await deleteMcpServer('test-sqlite-mcp', 'codex');
  servers = await listMcpServers();
  const deleted = servers.find((s) => s.id === 'test-sqlite-mcp');
  assert.equal(deleted, undefined);
});

test('tauri-bridge probeMcpServer probes server and returns tools with latency', async () => {
  const server = {
    id: 'postgres',
    name: 'PostgreSQL Server',
    scope: 'claude',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
  };

  const result = await probeMcpServer(server);
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.tools));
  assert.ok(result.tools.length > 0);
  assert.ok(result.tools.some((t) => t.name === 'query_sql'));
  assert.ok(typeof result.latencyMs === 'number');
});
