import { agentCard, handleA2aRequest } from './a2a.ts';
import { type Assets, pageUrl, readPageMarkdown } from './markdown.ts';
import { handleMcpMessage } from './mcp.ts';
import { LIMITS } from './tool-definitions.ts';

/**
 * Runs in front of the static assets (wrangler.jsonc run_worker_first) to add
 * what static files cannot: Markdown content negotiation for agents, discovery
 * Link headers on pages, the RFC 9727 media type for /.well-known/api-catalog,
 * and the read-only website content MCP server (/api/mcp) and A2A agent
 * (/api/a2a). Every other response is the asset response unchanged.
 */

interface Env {
  ASSETS: Assets;
  /** Workers rate limiting binding; absent in tests and local tools. */
  API_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const siteLinks = [
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</llms.txt>; rel="describedby"; type="text/plain"',
  '</.well-known/agent-skills/index.json>; rel="describedby"; type="application/json"',
  '</knowledge/>; rel="service-doc"; type="text/html"',
  '</openapi.json>; rel="service-desc"; type="application/openapi+json"',
  '</.well-known/mcp/server-card.json>; rel="describedby"; type="application/json"',
  '</.well-known/agent-card.json>; rel="describedby"; type="application/json"',
];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Session-Id, A2A-Version, A2A-Extensions',
  'Access-Control-Expose-Headers': 'Mcp-Protocol-Version',
};

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      ...cors,
      ...headers,
    },
  });

const rpcError = (code: number, message: string, status = 200) =>
  jsonResponse({ jsonrpc: '2.0', id: null, error: { code, message } }, status);

/** Reads a JSON body of at most LIMITS.bodyBytes, or returns the error response to send. */
async function readJson(request: Request): Promise<{ body: unknown } | { response: Response }> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > LIMITS.bodyBytes)
    return { response: rpcError(-32600, 'Request body is too large', 413) };
  const text = await request.text();
  if (text.length > LIMITS.bodyBytes)
    return { response: rpcError(-32600, 'Request body is too large', 413) };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { response: rpcError(-32700, 'Parse error: body must be JSON') };
  }
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const isMcp = url.pathname === '/api/mcp';
  if (request.method === 'GET' && !isMcp)
    return jsonResponse(agentCard(url.origin), 200, { 'Cache-Control': 'public, max-age=300' });
  if (request.method !== 'POST')
    return jsonResponse({ error: 'Use POST with a JSON-RPC body.' }, 405, {
      Allow: isMcp ? 'POST, OPTIONS' : 'GET, POST, OPTIONS',
    });
  if (env.API_LIMITER) {
    const key = request.headers.get('cf-connecting-ip') || 'unknown';
    const { success } = await env.API_LIMITER.limit({ key });
    if (!success)
      return jsonResponse(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Rate limit exceeded; retry in a minute.' },
        },
        429,
        { 'Retry-After': '60' },
      );
  }
  const parsed = await readJson(request);
  if ('response' in parsed) return parsed.response;
  if (!isMcp)
    return jsonResponse(
      await handleA2aRequest(
        parsed.body,
        request.headers.get('A2A-Version'),
        env.ASSETS,
        url.origin,
      ),
    );
  if (Array.isArray(parsed.body))
    return rpcError(-32600, 'JSON-RPC batches are not supported; send one message per request');
  const answer = await handleMcpMessage(parsed.body, env.ASSETS, url.origin);
  return answer ? jsonResponse(answer) : new Response(null, { status: 202, headers: cors });
}

/** q-value of a media type in an Accept header, 0 when it is not listed. */
function quality(accept: string, type: string) {
  for (const part of accept.toLowerCase().split(',')) {
    const [name, ...params] = part.split(';').map((value) => value.trim());
    if (name !== type) continue;
    const q = params.find((param) => param.startsWith('q='));
    return q ? Number.parseFloat(q.slice(2)) || 0 : 1;
  }
  return 0;
}

export function prefersMarkdown(accept: string | null) {
  if (!accept) return false;
  const markdown = quality(accept, 'text/markdown');
  return markdown > 0 && markdown >= quality(accept, 'text/html');
}

async function markdownResponse(request: Request, env: Env, url: URL) {
  const page = pageUrl(url.pathname, url.origin);
  const markdown = await readPageMarkdown(env.ASSETS, page);
  if (markdown === undefined) return;
  return new Response(request.method === 'HEAD' ? null : markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      Vary: 'Accept',
      'X-Robots-Tag': 'noindex',
      'X-Content-Type-Options': 'nosniff',
      Link: `<${page.href}>; rel="canonical"`,
      'x-markdown-tokens': String(Math.ceil(markdown.length / 4)),
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/mcp' || url.pathname === '/api/a2a')
      return handleApi(request, env, url);
    const isRead = request.method === 'GET' || request.method === 'HEAD';
    const isPagePath =
      !/\.[a-z0-9]+$/i.test(url.pathname) && !url.pathname.startsWith('/.well-known/');
    if (isRead && isPagePath && prefersMarkdown(request.headers.get('accept'))) {
      try {
        const markdown = await markdownResponse(request, env, url);
        if (markdown) return markdown;
      } catch (error) {
        console.error('Markdown rendering failed', url.pathname, error);
      }
    }
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 200) return response;
    if (url.pathname === '/.well-known/api-catalog') {
      const catalog = new Response(response.body, response);
      catalog.headers.set('Content-Type', 'application/linkset+json');
      return catalog;
    }
    if (!isPagePath || !response.headers.get('content-type')?.includes('text/html'))
      return response;
    const page = new Response(response.body, response);
    page.headers.append('Vary', 'Accept');
    for (const link of [...siteLinks, `<${url.pathname}>; rel="alternate"; type="text/markdown"`])
      page.headers.append('Link', link);
    return page;
  },
};
