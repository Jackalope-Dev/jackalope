import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * Runs in front of the static assets (wrangler.jsonc run_worker_first) to add
 * what static files cannot: Markdown content negotiation for agents, discovery
 * Link headers on pages, and the RFC 9727 media type for /.well-known/api-catalog.
 * Every other response is the asset response unchanged.
 */

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const siteLinks = [
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</llms.txt>; rel="describedby"; type="text/plain"',
  '</.well-known/agent-skills/index.json>; rel="describedby"; type="application/json"',
  '</knowledge/>; rel="service-doc"; type="text/html"',
];

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

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  '#x27': "'",
};
const decode = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, entity: string) => entities[entity]).trim();

/** Main content of a prerendered page as Markdown, with title, description and URL front matter. */
export function pageMarkdown(html: string, url: string) {
  const title = decode(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
  const description = decode(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '');
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  const main = html.match(/<main[\s>][\s\S]*<\/main>/)?.[0] ?? html;
  const body = NodeHtmlMarkdown.translate(main, { ignore: ['script', 'style', 'svg', 'video'] });
  return `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\nurl: ${JSON.stringify(canonical ? decode(canonical) : url)}\n---\n\n${body.trim()}\n`;
}

async function markdownResponse(request: Request, env: Env, url: URL) {
  const page = new URL(url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`, url.origin);
  let markdown: string | undefined;
  // Help guides publish curated Markdown mirrors; other pages are converted from their HTML.
  const mirror = await env.ASSETS.fetch(new Request(new URL('index.md', page)));
  if (mirror.status === 200) markdown = await mirror.text();
  else {
    const html = await env.ASSETS.fetch(
      new Request(page, { headers: { Accept: 'text/html' }, redirect: 'manual' }),
    );
    if (html.status !== 200 || !html.headers.get('content-type')?.includes('text/html')) return;
    markdown = pageMarkdown(await html.text(), page.href);
  }
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
