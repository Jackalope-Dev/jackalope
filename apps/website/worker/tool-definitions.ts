/**
 * The read-only tools of the jackalope.dev content server, shared by the MCP
 * endpoint (/api/mcp), the A2A agent (/api/a2a) and the build-time server and
 * agent cards. They read only the website's own public files; they cannot reach
 * the Jackalope desktop app or its local MCP connections.
 */

export const SERVER_INFO = {
  name: 'jackalope-website',
  title: 'Jackalope website content',
  version: '1.0.0',
} as const;

export const LIMITS = {
  /** Largest request body either endpoint reads. */
  bodyBytes: 64 * 1024,
  queryChars: 200,
  searchResults: 25,
  changelogEntries: 20,
  /** Longest Markdown read_page returns; longer pages are cut with a note. */
  pageChars: 40_000,
} as const;

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
    additionalProperties: false;
  };
};

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'search_pages',
    title: 'Search website pages',
    description:
      'Search jackalope.dev pages (features, help guides, comparisons, blog posts, legal pages) by keyword. Returns titles, URLs and descriptions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Words to look for, for example "git worktree"',
          maxLength: LIMITS.queryChars,
        },
        limit: {
          type: 'integer',
          description: `Maximum results, 1-${LIMITS.searchResults} (default 10)`,
          minimum: 1,
          maximum: LIMITS.searchResults,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_page',
    title: 'Read a page as Markdown',
    description: `Read one jackalope.dev page as Markdown, by path (for example "/download/" or "/knowledge/git-worktrees/"). Output is cut at ${LIMITS.pageChars} characters.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Page path or full https://jackalope.dev URL',
          maxLength: LIMITS.queryChars,
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'latest_changes',
    title: 'Latest changelog entries',
    description:
      'The newest Jackalope changelog entries from https://jackalope.dev/changelog.json, with release status (Coming soon, In beta, Released or Website).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: `Maximum entries, 1-${LIMITS.changelogEntries} (default 5)`,
          minimum: 1,
          maximum: LIMITS.changelogEntries,
        },
        query: {
          type: 'string',
          description: 'Only entries whose text contains these words',
          maxLength: LIMITS.queryChars,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_guides',
    title: 'List help guides',
    description:
      'Every Jackalope help guide with its description and the URL of its Markdown version.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];
