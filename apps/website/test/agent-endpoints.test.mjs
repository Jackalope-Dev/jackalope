import assert from 'node:assert/strict';
import test from 'node:test';
import { routeText } from '../worker/a2a.ts';
import worker from '../worker/index.ts';

const origin = 'https://jackalope.dev';
const files = {
  '/llms.txt': `# Jackalope\n\n## Agent interfaces\n\n- [Website MCP server](${origin}/api/mcp): not a page\n\n## Pages\n\n- [Download Jackalope](${origin}/download/): Get the desktop app.\n- [Git worktrees | Jackalope](${origin}/knowledge/git-worktrees/): Isolate parallel agents with worktrees.\n\n## Optional\n\n- [Full text](${origin}/llms-full.txt)\n`,
  '/knowledge/llms.txt': `# Jackalope knowledgebase\n\n## Guides\n\n- [Git worktrees](${origin}/knowledge/git-worktrees/index.md): Work on separate branches.\n`,
  '/changelog.json': JSON.stringify([
    {
      id: 'b',
      date: '2026-11-20',
      title: 'Skills sync.',
      description: 'Skills sync between computers.',
      items: ['Choose which skills sync.'],
      status: 'Coming soon',
    },
    {
      id: 'a',
      date: '2026-11-01',
      title: 'Worktree cleanup.',
      description: 'Old worktrees are removed.',
      items: [],
      status: 'Released',
      version: '1.2.0',
    },
  ]),
  '/knowledge/git-worktrees/index.md': '# Git worktrees\n\nGuide text.\n',
};
const assets = {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (Object.hasOwn(files, pathname)) return new Response(files[pathname]);
    return new Response('missing', { status: 404, headers: { 'Content-Type': 'text/html' } });
  },
};

const limited = new Set();
const env = {
  ASSETS: assets,
  API_LIMITER: { limit: async ({ key }) => ({ success: !limited.has(key) }) },
};

const post = (path, body, headers = {}) =>
  worker.fetch(
    new Request(`${origin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  );
const rpc = async (method, params, id = 1) =>
  (await post('/api/mcp', { jsonrpc: '2.0', id, method, params })).json();

test('MCP initialize, tools/list and notifications', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'jackalope-website');
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
  const fallback = await rpc('initialize', { protocolVersion: '1999-01-01' });
  assert.equal(fallback.result.protocolVersion, '2025-11-25');

  const list = await rpc('tools/list', {});
  assert.deepEqual(
    list.result.tools.map((tool) => tool.name),
    ['search_pages', 'read_page', 'latest_changes', 'list_guides'],
  );
  assert.ok(list.result.tools.every((tool) => tool.annotations.readOnlyHint));

  const note = await post('/api/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(note.status, 202);
  assert.equal((await rpc('nope', {})).error.code, -32601);
});

test('MCP tools read the site content with bounded arguments', async () => {
  const search = await rpc('tools/call', {
    name: 'search_pages',
    arguments: { query: 'worktrees' },
  });
  assert.deepEqual(
    search.result.structuredContent.results.map((page) => page.url),
    [`${origin}/knowledge/git-worktrees/`],
  );

  const page = await rpc('tools/call', {
    name: 'read_page',
    arguments: { path: '/knowledge/git-worktrees' },
  });
  assert.match(page.result.content[0].text, /# Git worktrees/);
  const missing = await rpc('tools/call', { name: 'read_page', arguments: { path: '/nope/' } });
  assert.equal(missing.result.isError, true);
  const offsite = await rpc('tools/call', {
    name: 'read_page',
    arguments: { path: 'https://example.com/' },
  });
  assert.equal(offsite.result.isError, true);

  const changes = await rpc('tools/call', {
    name: 'latest_changes',
    arguments: { limit: 1 },
  });
  assert.equal(changes.result.structuredContent.entries.length, 1);
  assert.equal(changes.result.structuredContent.entries[0].title, 'Skills sync.');
  const filtered = await rpc('tools/call', {
    name: 'latest_changes',
    arguments: { query: 'worktree' },
  });
  assert.equal(filtered.result.structuredContent.entries[0].version, '1.2.0');

  const guides = await rpc('tools/call', { name: 'list_guides', arguments: {} });
  assert.equal(guides.result.structuredContent.guides[0].url, `${origin}/knowledge/git-worktrees/`);

  const tooMany = await rpc('tools/call', {
    name: 'search_pages',
    arguments: { query: 'x', limit: 500 },
  });
  assert.equal(tooMany.error.code, -32602);
  assert.equal((await rpc('tools/call', { name: 'delete_site' })).error.code, -32602);
});

test('MCP transport rejects other methods, batches, bad JSON and large bodies', async () => {
  const get = await worker.fetch(new Request(`${origin}/api/mcp`), env);
  assert.equal(get.status, 405);
  const options = await worker.fetch(new Request(`${origin}/api/mcp`, { method: 'OPTIONS' }), env);
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('access-control-allow-origin'), '*');
  assert.equal((await (await post('/api/mcp', '[]')).json()).error.code, -32600);
  assert.equal((await (await post('/api/mcp', '{')).json()).error.code, -32700);
  assert.equal((await post('/api/mcp', 'x'.repeat(70 * 1024))).status, 413);
});

test('rate limit applies per IP', async () => {
  limited.add('203.0.113.9');
  const response = await post(
    '/api/mcp',
    { jsonrpc: '2.0', id: 1, method: 'ping' },
    { 'cf-connecting-ip': '203.0.113.9' },
  );
  assert.equal(response.status, 429);
  limited.clear();
});

test('A2A serves its card and answers skills and plain text', async () => {
  const card = await (await worker.fetch(new Request(`${origin}/api/a2a`), env)).json();
  assert.equal(card.supportedInterfaces[0].url, `${origin}/api/a2a`);
  assert.equal(card.skills.length, 4);

  const send = async (message, version) =>
    (
      await post(
        '/api/a2a',
        {
          jsonrpc: '2.0',
          id: 7,
          method: version === '1.0' ? 'SendMessage' : 'message/send',
          params: { message },
        },
        version ? { 'A2A-Version': version } : {},
      )
    ).json();

  const v1 = await send(
    { role: 'ROLE_USER', parts: [{ data: { skill: 'list_guides', arguments: {} } }] },
    '1.0',
  );
  assert.equal(v1.result.message.role, 'ROLE_AGENT');
  assert.equal(v1.result.message.metadata.skill, 'list_guides');
  assert.ok(v1.result.message.parts[1].data.guides);

  const v03 = await send({ role: 'user', parts: [{ kind: 'text', text: "what's new?" }] });
  assert.equal(v03.result.kind, 'message');
  assert.equal(v03.result.metadata.skill, 'latest_changes');

  const unknown = await send({ parts: [{ data: { skill: 'run_task' } }] }, '1.0');
  assert.equal(unknown.error.code, -32602);
  const task = await post('/api/a2a', { jsonrpc: '2.0', id: 1, method: 'GetTask', params: {} });
  assert.equal((await task.json()).error.code, -32001);
});

test('A2A keyword routing', () => {
  assert.deepEqual(routeText('read /download/ please', origin), {
    name: 'read_page',
    args: { path: '/download/' },
  });
  assert.deepEqual(routeText(`${origin}/knowledge/git-worktrees/`, origin), {
    name: 'read_page',
    args: { path: '/knowledge/git-worktrees/' },
  });
  assert.equal(routeText('show the changelog', origin).name, 'latest_changes');
  assert.equal(routeText('what is new in Jackalope', origin).name, 'latest_changes');
  assert.equal(routeText('list all guides', origin).name, 'list_guides');
  assert.deepEqual(routeText('parallel agents', origin), {
    name: 'search_pages',
    args: { query: 'parallel agents' },
  });
});
