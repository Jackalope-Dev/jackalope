import { type Assets, pageUrl, readPageMarkdown } from './markdown.ts';
import { LIMITS, toolDefinitions } from './tool-definitions.ts';

export type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export class ToolInputError extends Error {}

type Listing = { title: string; url: string; description: string };

const toolNames = new Set(toolDefinitions.map((tool) => tool.name));
export const isTool = (name: string) => toolNames.has(name);

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });
const json = (data: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
});
const failure = (message: string): ToolResult => ({ ...text(message), isError: true });

function stringArg(args: Record<string, unknown>, key: string, required: boolean) {
  const value = args[key];
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || (required && !value.trim()))
    throw new ToolInputError(`"${key}" must be a non-empty string`);
  if (value.length > LIMITS.queryChars)
    throw new ToolInputError(`"${key}" is limited to ${LIMITS.queryChars} characters`);
  return value.trim();
}

function limitArg(args: Record<string, unknown>, fallback: number, max: number) {
  const value = args.limit;
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max)
    throw new ToolInputError(`"limit" must be an integer from 1 to ${max}`);
  return value;
}

const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

async function assetText(assets: Assets, origin: string, path: string) {
  const response = await assets.fetch(new Request(new URL(path, origin)));
  if (response.status !== 200) throw new Error(`${path} returned ${response.status}`);
  return response.text();
}

/** `- [Title](url): description` lines of one llms.txt section (or the whole file). */
function listings(source: string, section?: string) {
  const body = section ? (source.split(`## ${section}\n`)[1]?.split('\n## ')[0] ?? '') : source;
  return [...body.matchAll(/^- \[([^\]]+)\]\(([^)\s]+)\): (.*)$/gm)].map(
    ([, title, url, description]): Listing => ({ title, url, description }),
  );
}

async function searchPages(assets: Assets, origin: string, args: Record<string, unknown>) {
  const terms = words(stringArg(args, 'query', true));
  const limit = limitArg(args, 10, LIMITS.searchResults);
  const pages = listings(await assetText(assets, origin, '/llms.txt'), 'Pages');
  const results = pages
    .map((page) => {
      const title = page.title.toLowerCase();
      const rest = `${page.description} ${page.url}`.toLowerCase();
      const score = terms.reduce(
        (sum, term) => sum + (title.includes(term) ? 2 : 0) + (rest.includes(term) ? 1 : 0),
        0,
      );
      return { page, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((result) => result.page);
  return json({ query: terms.join(' '), results });
}

async function readPage(assets: Assets, origin: string, args: Record<string, unknown>) {
  const raw = stringArg(args, 'path', true);
  const target = new URL(raw, origin);
  if (target.origin !== origin) return failure(`read_page only reads ${origin} pages.`);
  if (/\.[a-z0-9]+$/i.test(target.pathname) || target.pathname.startsWith('/.well-known/'))
    return failure('Pass a page path such as /download/, not a file.');
  const page = pageUrl(target.pathname, origin);
  const markdown = await readPageMarkdown(assets, page);
  if (markdown === undefined)
    return failure(`No page at ${page.href}. Use search_pages to find one.`);
  return text(
    markdown.length > LIMITS.pageChars
      ? `${markdown.slice(0, LIMITS.pageChars)}\n\n[Cut at ${LIMITS.pageChars} characters. Full page: ${page.href}]`
      : markdown,
  );
}

async function latestChanges(assets: Assets, origin: string, args: Record<string, unknown>) {
  const terms = words(stringArg(args, 'query', false));
  const limit = limitArg(args, 5, LIMITS.changelogEntries);
  const entries = JSON.parse(await assetText(assets, origin, '/changelog.json')) as Record<
    string,
    unknown
  >[];
  const matching = entries.filter((entry) => {
    const haystack = JSON.stringify([entry.title, entry.description, entry.items]).toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
  return json({
    source: `${origin}/changelog.json`,
    entries: matching.slice(0, limit).map((entry) => ({
      date: entry.date,
      title: entry.title,
      description: entry.description,
      items: entry.items,
      status: entry.status,
      ...(entry.version ? { version: entry.version } : {}),
      url: `${origin}/changelog/`,
    })),
  });
}

async function listGuides(assets: Assets, origin: string) {
  const guides = listings(await assetText(assets, origin, '/knowledge/llms.txt'), 'Guides').map(
    (guide) => ({
      title: guide.title,
      description: guide.description,
      url: guide.url.replace(/index\.md$/, ''),
      markdown: guide.url,
    }),
  );
  return json({ guides });
}

/** Runs one tool. Bad arguments throw ToolInputError; a missing page is an isError result. */
export async function callTool(
  assets: Assets,
  origin: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (name) {
    case 'search_pages':
      return searchPages(assets, origin, args);
    case 'read_page':
      return readPage(assets, origin, args);
    case 'latest_changes':
      return latestChanges(assets, origin, args);
    case 'list_guides':
      return listGuides(assets, origin);
    default:
      throw new ToolInputError(`Unknown tool "${name}"`);
  }
}
