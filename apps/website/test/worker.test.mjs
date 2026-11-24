import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { prefersMarkdown } from '../worker/index.ts';
import { pageMarkdown } from '../worker/markdown.ts';

const page = `<!doctype html><html><head><title>Features &amp; more | Jackalope</title>
<meta name="description" content="What it does." />
<link rel="canonical" href="https://jackalope.dev/features/x/" /></head>
<body><header><nav>Menu</nav></header><main id="main"><h1>Run agents</h1><p>Each task gets a <a href="/knowledge/">worktree</a>.</p><svg><text>icon</text></svg></main><footer>Footer</footer></body></html>`;

const assets = {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/features/x/')
      return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (pathname === '/knowledge/guide/index.md')
      return new Response('# Guide\n', { headers: { 'Content-Type': 'text/markdown' } });
    if (pathname === '/knowledge/guide/')
      return new Response('<main>html</main>', { headers: { 'Content-Type': 'text/html' } });
    if (pathname === '/.well-known/api-catalog')
      return new Response('{"linkset":[]}', {
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    return new Response('missing', { status: 404, headers: { 'Content-Type': 'text/html' } });
  },
};
const get = (path, accept) =>
  worker.fetch(
    new Request(`https://jackalope.dev${path}`, { headers: accept ? { Accept: accept } : {} }),
    { ASSETS: assets },
  );

test('only explicit Markdown preference selects Markdown', () => {
  assert.equal(prefersMarkdown('text/markdown'), true);
  assert.equal(prefersMarkdown('text/markdown, text/html;q=0.5'), true);
  assert.equal(prefersMarkdown('text/html, text/markdown;q=0.5'), false);
  assert.equal(prefersMarkdown('text/markdown;q=0'), false);
  assert.equal(
    prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
    false,
  );
  assert.equal(prefersMarkdown(null), false);
});

test('page Markdown keeps the main content with front matter', () => {
  const markdown = pageMarkdown(page, 'https://example.com/');
  assert.match(markdown, /^---\ntitle: "Features & more \| Jackalope"\n/);
  assert.match(markdown, /description: "What it does."/);
  assert.match(markdown, /url: "https:\/\/jackalope.dev\/features\/x\/"/);
  assert.match(markdown, /# Run agents/);
  assert.match(markdown, /\[worktree\]\(\/knowledge\/\)/);
  assert.doesNotMatch(markdown, /Menu|Footer|icon/);
});

test('Accept: text/markdown returns Markdown; browsers get HTML with discovery links', async () => {
  const markdown = await get('/features/x', 'text/markdown');
  assert.equal(markdown.status, 200);
  assert.equal(markdown.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(markdown.headers.get('x-robots-tag'), 'noindex');
  assert.equal(
    markdown.headers.get('link'),
    '<https://jackalope.dev/features/x/>; rel="canonical"',
  );
  assert.ok(Number(markdown.headers.get('x-markdown-tokens')) > 0);
  assert.match(await markdown.text(), /# Run agents/);

  const html = await get('/features/x/', 'text/html,*/*;q=0.8');
  assert.equal(html.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(html.headers.get('vary'), /Accept/);
  assert.match(html.headers.get('link'), /rel="api-catalog"/);
  assert.match(
    html.headers.get('link'),
    /<\/features\/x\/>; rel="alternate"; type="text\/markdown"/,
  );
});

test('curated mirrors win, missing pages fall through, and the API catalog gets its type', async () => {
  assert.equal(await (await get('/knowledge/guide/', 'text/markdown')).text(), '# Guide\n');
  const missing = await get('/nope/', 'text/markdown');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('content-type'), 'text/html');
  const catalog = await get('/.well-known/api-catalog');
  assert.equal(catalog.headers.get('content-type'), 'application/linkset+json');
});
