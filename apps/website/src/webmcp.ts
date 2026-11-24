import { pages } from './content';

/**
 * Registers read-only WebMCP tools (https://webmachinelearning.github.io/webmcp/)
 * so a browser agent can search, read and open site pages without scraping.
 * Browsers without the API skip this.
 */

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

type ModelContext = {
  registerTool?: (tool: Tool, options?: { signal?: AbortSignal }) => unknown;
  provideContext?: (context: { tools: Tool[] }) => unknown;
};

const publicPages = pages.filter((page) => !page.noindex);

/** A same-site page path, or undefined for anything else. */
function sitePath(value: unknown) {
  if (typeof value !== 'string') return;
  const url = new URL(value, window.location.origin);
  return url.origin === window.location.origin ? url.pathname : undefined;
}

const text = (value: string) => ({ content: [{ type: 'text', text: value }] });

const tools: Tool[] = [
  {
    name: 'search_pages',
    description:
      'Search Jackalope website pages (features, guides, comparisons, blog posts) by keyword. Returns titles, paths and descriptions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for, for example "worktree"' },
        limit: { type: 'number', description: 'Maximum results (default 10)' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
    execute: async ({ query, limit }) => {
      const words = String(query ?? '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const max = typeof limit === 'number' && limit > 0 ? Math.min(limit, 50) : 10;
      const results = publicPages
        .map((page) => {
          const haystack = `${page.title} ${page.description} ${page.path}`.toLowerCase();
          return { page, score: words.filter((word) => haystack.includes(word)).length };
        })
        .filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, max)
        .map(({ page }) => ({ title: page.title, path: page.path, description: page.description }));
      return text(JSON.stringify(results));
    },
  },
  {
    name: 'read_page',
    description:
      'Read a Jackalope website page as Markdown. Pass its path, for example "/features/" or "/knowledge/git-worktrees/".',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Page path on jackalope.dev' } },
      required: ['path'],
    },
    annotations: { readOnlyHint: true },
    execute: async ({ path }) => {
      const page = sitePath(path);
      if (!page) return text('Pass a path on this site, such as /features/.');
      const response = await fetch(page, { headers: { Accept: 'text/markdown' } });
      return text(response.ok ? await response.text() : `No page at ${page} (${response.status}).`);
    },
  },
  {
    name: 'latest_changes',
    description: 'List the newest Jackalope changelog entries with their release status.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Maximum entries (default 5)' } },
    },
    annotations: { readOnlyHint: true },
    execute: async ({ limit }) => {
      const max = typeof limit === 'number' && limit > 0 ? Math.min(limit, 50) : 5;
      const response = await fetch('/changelog.json');
      const entries = (await response.json()) as unknown[];
      return text(JSON.stringify(entries.slice(0, max)));
    },
  },
  {
    name: 'open_page',
    description: 'Navigate this tab to a Jackalope website page, such as /download/.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Page path on jackalope.dev' } },
      required: ['path'],
    },
    execute: async ({ path }) => {
      const page = sitePath(path);
      if (!page) return text('Pass a path on this site, such as /download/.');
      window.location.assign(page);
      return text(`Opening ${page}`);
    },
  },
];

export function registerWebMcpTools() {
  const context = ((document as Document & { modelContext?: ModelContext }).modelContext ??
    (navigator as Navigator & { modelContext?: ModelContext }).modelContext) as
    | ModelContext
    | undefined;
  if (!context) return;
  const warn = (error: unknown) => console.warn('WebMCP tools were not registered', error);
  try {
    if (context.registerTool)
      for (const tool of tools) Promise.resolve(context.registerTool(tool)).catch(warn);
    else context.provideContext?.({ tools });
  } catch (error) {
    warn(error);
  }
}
