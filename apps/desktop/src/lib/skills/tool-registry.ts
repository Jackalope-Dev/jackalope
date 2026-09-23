/**
 * Curated registry of Model Context Protocol (MCP) tools and capabilities.
 * Adapted from official modelcontextprotocol/servers and community standards.
 */

export interface McpToolDefinition {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  category: 'filesystem' | 'git' | 'browser' | 'database' | 'search' | 'github';
  capabilities: string[];
  isAvailable: boolean;
}

export const VETTED_TOOLS: McpToolDefinition[] = [
  {
    id: 'filesystem',
    name: 'Scoped Filesystem MCP',
    shortLabel: 'Filesystem',
    description:
      'Safe, repository-bounded read, search, and edit operations adhering to directory isolation.',
    category: 'filesystem',
    capabilities: ['read_file', 'write_file', 'list_directory', 'directory_tree'],
    isAvailable: true,
  },
  {
    id: 'git',
    name: 'Git Integration MCP',
    shortLabel: 'Git',
    description:
      'Inspect commits, inspect worktrees, generate diffs, and create conventional commits.',
    category: 'git',
    capabilities: ['git_status', 'git_diff', 'git_log', 'git_commit'],
    isAvailable: true,
  },
  {
    id: 'browser',
    name: 'Playwright Browser MCP',
    shortLabel: 'Browser',
    description:
      'Headless browser automation for UI verification, DOM inspection, and accessibility checks.',
    category: 'browser',
    capabilities: ['navigate', 'screenshot', 'click', 'evaluate_javascript'],
    isAvailable: false,
  },
  {
    id: 'github',
    name: 'GitHub API MCP',
    shortLabel: 'GitHub',
    description: 'Sync issues, create pull requests, read reviews, and manage workflow dispatches.',
    category: 'github',
    capabilities: ['get_issue', 'create_pull_request', 'list_reviews'],
    isAvailable: false,
  },
  {
    id: 'database',
    name: 'PostgreSQL / SQLite MCP',
    shortLabel: 'Database',
    description:
      'Schema inspection, migration testing, and read-only parameterized query analysis.',
    category: 'database',
    capabilities: ['describe_tables', 'read_query', 'verify_schema'],
    isAvailable: false,
  },
  {
    id: 'search',
    name: 'Web & Documentation Search MCP',
    shortLabel: 'Docs Search',
    description: 'Live documentation lookup, library release notes, and API reference retrieval.',
    category: 'search',
    capabilities: ['search_docs', 'fetch_webpage'],
    isAvailable: false,
  },
];

export function getToolById(id: string): McpToolDefinition | undefined {
  return VETTED_TOOLS.find((t) => t.id === id);
}
