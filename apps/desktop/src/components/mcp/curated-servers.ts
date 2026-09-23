import type { AllMcpsServer } from '../../stores/mcpStore';

export interface McpRecommendation {
  publisher: string;
  group: 'Code & browser' | 'Plan & collaborate' | 'Design & operate';
  authentication: 'none' | 'token' | 'oauth';
  setup: string;
  documentation: string;
  registryId?: string;
}

type Recommendation = McpRecommendation & {
  id: string;
  name: string;
  description: string;
  source: string;
  endpoint?: string;
  command?: string;
  args?: string[];
};

const recommendations: Recommendation[] = [
  {
    id: 'github-github-mcp-server',
    name: 'GitHub',
    publisher: 'GitHub',
    group: 'Code & browser',
    description: 'Work with repositories, issues, pull requests, and code reviews.',
    source: 'https://github.com/github/github-mcp-server',
    documentation: 'https://github.com/github/github-mcp-server#remote-github-mcp-server',
    endpoint: 'https://api.githubcopilot.com/mcp/',
    authentication: 'token',
    setup:
      'Use a GitHub personal access token with access to the repositories you want to work with.',
    registryId: 'github-github-mcp-server',
  },
  {
    id: 'upstash-context7',
    name: 'Context7',
    publisher: 'Upstash',
    group: 'Code & browser',
    description: 'Give agents current library documentation and version-specific code examples.',
    source: 'https://github.com/upstash/context7',
    documentation: 'https://github.com/upstash/context7#installation',
    endpoint: 'https://mcp.context7.com/mcp',
    authentication: 'none',
    setup:
      'Connect remotely. You can add a Context7 API key as a bearer token for your account limits.',
    registryId: 'upstash-context7',
  },
  {
    id: 'chrome-devtools-mcp',
    name: 'Chrome DevTools',
    publisher: 'Chrome DevTools',
    group: 'Code & browser',
    description:
      'Inspect browser errors, network requests, and performance while developing your app.',
    source: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    documentation: 'https://github.com/ChromeDevTools/chrome-devtools-mcp#requirements',
    command: 'npx',
    args: [
      '-y',
      'chrome-devtools-mcp@1.9.0',
      '--isolated',
      '--no-usage-statistics',
      '--no-performance-crux',
    ],
    authentication: 'none',
    setup:
      'Requires Node.js 20.19+ and Google Chrome. Starts a separate browser profile; usage reporting is disabled.',
    registryId: 'chrome-devtools-mcp',
  },
  {
    id: 'microsoft-playwright-mcp',
    name: 'Playwright',
    publisher: 'Microsoft',
    group: 'Code & browser',
    description:
      'Explore websites and exercise browser workflows with accessibility-based automation.',
    source: 'https://github.com/microsoft/playwright-mcp',
    documentation: 'https://github.com/microsoft/playwright-mcp#requirements',
    command: 'npx',
    args: ['-y', '@playwright/mcp@0.0.81', '--isolated'],
    authentication: 'none',
    setup:
      'Requires Node.js 18+ and a supported browser. Starts an isolated session. Jackalope also includes basic task browser tools.',
    registryId: 'microsoft-playwright-mcp',
  },
  {
    id: 'linear',
    name: 'Linear',
    publisher: 'Linear',
    group: 'Plan & collaborate',
    description: 'Bring issues and project context into tasks, then update work in Linear.',
    source: 'https://linear.app/docs/mcp',
    documentation: 'https://linear.app/docs/mcp',
    endpoint: 'https://mcp.linear.app/mcp',
    authentication: 'oauth',
    setup:
      'Sign in through your selected agent. A Linear API key can also be used as a bearer token with on-demand tools.',
    registryId: 'linear',
  },
  {
    id: 'notion-remote',
    name: 'Notion',
    publisher: 'Notion',
    group: 'Plan & collaborate',
    description: 'Find workspace knowledge and read or update pages, documents, and databases.',
    source: 'https://developers.notion.com/guides/mcp/overview',
    documentation: 'https://developers.notion.com/guides/mcp/get-started-with-mcp',
    endpoint: 'https://mcp.notion.com/mcp',
    authentication: 'oauth',
    setup: 'Sign in to the Notion workspace you want to use through your selected agent.',
  },
  {
    id: 'atlassian-mcp-server',
    name: 'Jira & Confluence',
    publisher: 'Atlassian',
    group: 'Plan & collaborate',
    description: 'Connect Jira work and Confluence knowledge to your development tasks.',
    source: 'https://github.com/atlassian/atlassian-mcp-server',
    documentation: 'https://support.atlassian.com/atlassian-ai-gateway/docs/configure-oauth-2-1/',
    endpoint: 'https://mcp.atlassian.com/v2/mcp',
    authentication: 'oauth',
    setup:
      'Sign in through your selected agent. Your organization may need to allow the MCP client.',
    registryId: 'atlassian-mcp-server',
  },
  {
    id: 'figma-mcp-server',
    name: 'Figma',
    publisher: 'Figma',
    group: 'Design & operate',
    description: 'Use design context, components, and variables while building an interface.',
    source: 'https://github.com/figma/mcp-server-guide',
    documentation: 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/',
    endpoint: 'https://mcp.figma.com/mcp',
    authentication: 'oauth',
    setup:
      'Sign in through a supported Codex or Claude client. Available tools and limits depend on your Figma access.',
    registryId: 'figma-mcp-server',
  },
  {
    id: 'getsentry-sentry-mcp',
    name: 'Sentry',
    publisher: 'Sentry',
    group: 'Design & operate',
    description: 'Investigate production errors and performance with context from Sentry.',
    source: 'https://github.com/getsentry/sentry-mcp',
    documentation: 'https://mcp.sentry.dev/',
    endpoint: 'https://mcp.sentry.dev/mcp',
    authentication: 'oauth',
    setup:
      'Sign in through your selected agent. Add your organization and project to the endpoint to narrow access.',
    registryId: 'getsentry-sentry-mcp',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    publisher: 'Supabase',
    group: 'Design & operate',
    description: 'Inspect database schemas, project configuration, and application logs.',
    source: 'https://github.com/supabase/mcp',
    documentation: 'https://supabase.com/docs/guides/ai-tools/mcp',
    endpoint: 'https://mcp.supabase.com/mcp?read_only=true',
    authentication: 'oauth',
    setup:
      'Starts in read-only mode. Use the publisher setup guide to add a project_ref and limit access to a development project.',
    registryId: 'supabase',
  },
];

export const recommendationGroups = [
  'Code & browser',
  'Plan & collaborate',
  'Design & operate',
] as const;

export function recommendationFor(id: string): McpRecommendation | undefined {
  return recommendations.find((item) => item.id === id);
}

export const recommendedServers: AllMcpsServer[] = recommendations.map((item) => ({
  id: item.id,
  name: item.name,
  description: item.description,
  category: item.group,
  url: item.source,
  isOfficial: false,
  isVerifiedActive: false,
  upvotes: 0,
  githubStars: 0,
  npmDownloads: null,
  qualityScore: 0,
  installName: item.id,
  installConfidence: 'high',
  installNote: item.setup,
  installKind: item.endpoint ? 'remote' : 'stdio',
  envVars: [],
  detailUrl: item.registryId ? `https://allmcps.com/mcp/${item.registryId}` : undefined,
  claudeConfigSnippet: {
    mcpServers: {
      [item.id]: item.endpoint
        ? { url: item.endpoint }
        : { command: item.command, args: item.args },
    },
  },
}));

export function recommendedMatches(query: string) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return recommendedServers.filter((server) => {
    const item = recommendationFor(server.id);
    const text =
      `${server.name} ${server.description} ${item?.publisher ?? ''} ${item?.group ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
