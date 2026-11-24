import { NodeHtmlMarkdown } from 'node-html-markdown';

export interface Assets {
  fetch(request: Request): Promise<Response>;
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

/** The page directory URL for a path: /download -> /download/. */
export const pageUrl = (pathname: string, origin: string) =>
  new URL(pathname.endsWith('/') ? pathname : `${pathname}/`, origin);

/**
 * A page as Markdown: the help guide's curated index.md mirror when there is
 * one, otherwise its prerendered HTML converted. Undefined when no page exists.
 */
export async function readPageMarkdown(assets: Assets, page: URL) {
  const mirror = await assets.fetch(new Request(new URL('index.md', page)));
  if (mirror.status === 200) return mirror.text();
  const html = await assets.fetch(
    new Request(page, { headers: { Accept: 'text/html' }, redirect: 'manual' }),
  );
  if (html.status !== 200 || !html.headers.get('content-type')?.includes('text/html')) return;
  return pageMarkdown(await html.text(), page.href);
}
