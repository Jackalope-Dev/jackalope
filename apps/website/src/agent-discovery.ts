import { createHash } from 'node:crypto';
import { guideMarkdown, knowledgeGuides } from '@jackalope/knowledge';
import { agentCard } from '../worker/a2a.ts';
import { serverCard } from '../worker/mcp.ts';
import { siteOrigin } from './content.ts';

/**
 * Machine-readable discovery files under /.well-known/ for AI agents: an Agent
 * Skills index (agentskills.io discovery 0.2.0), the MCP server card and A2A
 * agent card of the read-only website content endpoints in worker/, an RFC 9727
 * API catalog, the OpenAPI description of the public read-only endpoints, an
 * ARD ai-catalog and a website-only Personal Agent Protocol manifest. They
 * describe only what jackalope.dev really serves: there is no OAuth server, and
 * the desktop app's MCP connections are local to each installation.
 */

type Skill = { name: string; description: string; body: string };

const websiteSkill = (origin: string): Skill => ({
  name: 'jackalope-website',
  description:
    'Read jackalope.dev as an agent: product overview, help guides, release notes and blog content as Markdown, plain text or JSON.',
  body: `# Read the Jackalope website

Jackalope is a desktop workspace for coding agents, local Git projects, tasks,
worktrees and review, made by Jackalope Digital LLC. ${origin} is its canonical
website. Everything below is public, read-only and needs no account or key.

## Get any page as Markdown

Request a page with \`Accept: text/markdown\`. The response is the page's main
content as Markdown (\`Content-Type: text/markdown\`), with \`title\`,
\`description\` and \`url\` front matter and an \`x-markdown-tokens\` estimate.
Browsers without that header receive HTML.

\`\`\`
curl -H "Accept: text/markdown" ${origin}/features/
\`\`\`

Help guides also have static mirrors at \`${origin}/knowledge/<guide>/index.md\`.

## MCP server and A2A agent

${origin}/api/mcp is a stateless, read-only MCP server (Streamable HTTP, JSON
responses, no authentication) with four tools: \`search_pages\`, \`read_page\`
(Markdown), \`latest_changes\` (changelog) and \`list_guides\`. Its card is at
${origin}/.well-known/mcp/server-card.json.

${origin}/api/a2a is an A2A agent (JSON-RPC, protocol 1.0 and 0.3) over the same
tools. Send a data part \`{"skill": "<tool>", "arguments": {...}}\`, or plain text:
a page path reads that page, "changelog" or "what's new" lists recent changes,
"guides" lists help guides, and anything else searches the site. Its card is at
${origin}/.well-known/agent-card.json.

Both read only this website's public files and are rate limited per IP address.

## Overviews

- ${origin}/llms.txt: what Jackalope is, availability, supported agents and the page list.
- ${origin}/llms-full.txt: the full marketing, benchmark and changelog text in one file.
- ${origin}/knowledge/llms.txt: every help guide with a link to its Markdown.
- ${origin}/sitemap.xml: every indexable page.

## Release notes

- ${origin}/changelog.json: every changelog entry as JSON, newest first. Each entry has
  \`id\`, \`date\` (YYYY-MM-DD), \`title\`, \`description\`, \`items\`, \`kind\`
  (\`app\` or \`website\`) and \`status\` (Coming soon, In beta, Released or Website), plus
  \`version\` once a beta or stable release contains it.
- ${origin}/feed.xml: blog posts as RSS.

## Limits

The website and its MCP server and A2A agent do not run tasks or expose Jackalope's
agents. Jackalope itself is a desktop app: download it from ${origin}/download/. Its
MCP connections are local to each installation and are not reachable through this site.
`,
});

const guideSkill = (slug: string, name: string, description: string, origin: string): Skill => {
  const guide = knowledgeGuides.find((candidate) => candidate.slug === slug);
  if (!guide) throw new Error(`Agent skill ${name} needs the ${slug} guide.`);
  return { name, description, body: guideMarkdown(guide, origin) };
};

const skills = (origin: string) => [
  websiteSkill(origin),
  guideSkill(
    'getting-started-in-the-beta',
    'jackalope-getting-started',
    'Install the Jackalope desktop app, optionally connect a free account, learn its main pages, send feedback and get updates.',
    origin,
  ),
  guideSkill(
    'terminal-command',
    'jackalope-terminal',
    'Use the jackalope terminal command to start, list and rejoin Jackalope conversations from a project directory.',
    origin,
  ),
];

const skillFile = (skill: Skill) =>
  `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.body}`;

const digest = (source: string) => `sha256:${createHash('sha256').update(source).digest('hex')}`;

const openApi = (origin: string) => ({
  openapi: '3.1.0',
  info: {
    title: 'Jackalope website content',
    version: '1.0.0',
    description:
      'Public, read-only content endpoints of the Jackalope website. No authentication. The Jackalope desktop app has no public web API.',
  },
  servers: [{ url: origin }],
  components: {
    schemas: {
      ReleasePoint: {
        type: 'object',
        required: ['version', 'date'],
        properties: { version: { type: 'string' }, date: { type: 'string', format: 'date' } },
      },
    },
  },
  paths: {
    '/changelog.json': {
      get: {
        summary: 'Changelog entries, newest first',
        responses: {
          '200': {
            description: 'Every public changelog entry',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['id', 'date', 'title', 'description', 'items', 'kind', 'status'],
                    properties: {
                      id: { type: 'string' },
                      date: { type: 'string', format: 'date' },
                      title: { type: 'string' },
                      description: { type: 'string' },
                      items: { type: 'array', items: { type: 'string' } },
                      note: { type: 'string' },
                      kind: { type: 'string', enum: ['app', 'website'] },
                      state: {
                        type: 'string',
                        enum: ['website', 'coming-soon', 'beta', 'released'],
                      },
                      status: {
                        type: 'string',
                        enum: ['Website', 'Coming soon', 'In beta', 'Released'],
                      },
                      version: { type: 'string' },
                      release: {
                        type: 'object',
                        description: 'First beta and stable releases that contained the entry',
                        properties: {
                          beta: { $ref: '#/components/schemas/ReleasePoint' },
                          stable: { $ref: '#/components/schemas/ReleasePoint' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/llms.txt': {
      get: {
        summary: 'Product overview for language models',
        responses: { '200': { description: 'llms.txt', content: { 'text/plain': {} } } },
      },
    },
    '/llms-full.txt': {
      get: {
        summary: 'Full site text for language models',
        responses: { '200': { description: 'llms-full.txt', content: { 'text/plain': {} } } },
      },
    },
    '/feed.xml': {
      get: {
        summary: 'Blog posts as RSS',
        responses: { '200': { description: 'RSS 2.0', content: { 'application/rss+xml': {} } } },
      },
    },
    '/api/mcp': {
      post: {
        summary: 'Read-only MCP server (Streamable HTTP, JSON-RPC 2.0)',
        description:
          'Methods: initialize, ping, tools/list, tools/call. Tools are listed in /.well-known/mcp/server-card.json.',
        requestBody: { required: true, content: { 'application/json': {} } },
        responses: {
          '200': { description: 'JSON-RPC response', content: { 'application/json': {} } },
          '202': { description: 'Notification accepted' },
          '429': { description: 'Rate limited' },
        },
      },
    },
    '/api/a2a': {
      get: {
        summary: 'A2A agent card',
        responses: { '200': { description: 'Agent card', content: { 'application/json': {} } } },
      },
      post: {
        summary: 'A2A agent (JSON-RPC 2.0, protocol 1.0 and 0.3)',
        requestBody: { required: true, content: { 'application/json': {} } },
        responses: {
          '200': { description: 'JSON-RPC response', content: { 'application/json': {} } },
          '429': { description: 'Rate limited' },
        },
      },
    },
    '/{page}': {
      get: {
        summary: 'Any website page, as HTML or as Markdown',
        description: 'Send Accept: text/markdown for the Markdown rendering of the page.',
        parameters: [
          {
            name: 'page',
            in: 'path',
            required: true,
            description: 'Page path, for example features/ or knowledge/git-worktrees/',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'The page',
            content: { 'text/html': {}, 'text/markdown': {} },
          },
          '404': { description: 'No such page' },
        },
      },
    },
  },
});

export function agentDiscoveryFiles(origin = siteOrigin): Record<string, string> {
  const list = skills(origin);
  const skillFiles = Object.fromEntries(
    list.map((skill) => [`.well-known/agent-skills/${skill.name}/SKILL.md`, skillFile(skill)]),
  );
  const skillUrl = (name: string) => `${origin}/.well-known/agent-skills/${name}/SKILL.md`;
  const host = new URL(origin).hostname;
  return {
    ...skillFiles,
    '.well-known/agent-skills/index.json': JSON.stringify(
      {
        $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
        skills: list.map((skill) => ({
          name: skill.name,
          type: 'skill-md',
          description: skill.description,
          url: `/.well-known/agent-skills/${skill.name}/SKILL.md`,
          digest: digest(skillFiles[`.well-known/agent-skills/${skill.name}/SKILL.md`]),
        })),
      },
      null,
      2,
    ),
    'openapi.json': JSON.stringify(openApi(origin), null, 2),
    '.well-known/mcp/server-card.json': JSON.stringify(serverCard(origin), null, 2),
    '.well-known/agent-card.json': JSON.stringify(agentCard(origin), null, 2),
    '.well-known/poppy.json': JSON.stringify(
      { protocol_version: '0.1', organization: { name: 'Jackalope', domain: host }, web: {} },
      null,
      2,
    ),
    '.well-known/api-catalog': JSON.stringify(
      {
        linkset: [
          {
            anchor: `${origin}/`,
            'service-desc': [{ href: `${origin}/openapi.json`, type: 'application/openapi+json' }],
            'service-doc': [{ href: skillUrl('jackalope-website'), type: 'text/markdown' }],
          },
          {
            anchor: `${origin}/api/mcp`,
            'service-desc': [
              { href: `${origin}/.well-known/mcp/server-card.json`, type: 'application/json' },
            ],
            'service-doc': [{ href: skillUrl('jackalope-website'), type: 'text/markdown' }],
          },
          {
            anchor: `${origin}/api/a2a`,
            'service-desc': [
              { href: `${origin}/.well-known/agent-card.json`, type: 'application/json' },
            ],
            'service-doc': [{ href: skillUrl('jackalope-website'), type: 'text/markdown' }],
          },
        ],
      },
      null,
      2,
    ),
    '.well-known/ai-catalog.json': JSON.stringify(
      {
        specVersion: '1.0',
        host: { displayName: 'Jackalope', identifier: `did:web:${host}` },
        entries: [
          {
            identifier: `urn:air:${host}:server:website`,
            displayName: 'Jackalope website content MCP server',
            type: 'application/mcp-server-card+json',
            url: `${origin}/.well-known/mcp/server-card.json`,
            representativeQueries: [
              'search the Jackalope website',
              'read a Jackalope help guide as Markdown',
              'what is new in Jackalope',
            ],
          },
          {
            identifier: `urn:air:${host}:agent:website`,
            displayName: 'Jackalope website agent',
            type: 'application/a2a-agent-card+json',
            url: `${origin}/.well-known/agent-card.json`,
            representativeQueries: [
              'ask the Jackalope website agent for recent changes',
              'find Jackalope pages about git worktrees',
            ],
          },
          {
            identifier: `urn:air:${host}:api:website-content`,
            displayName: 'Jackalope website content',
            type: 'application/openapi+json',
            url: `${origin}/openapi.json`,
            representativeQueries: [
              'what changed in the latest Jackalope release',
              'get the Jackalope features page as Markdown',
              'list Jackalope help guides',
            ],
          },
          {
            identifier: `urn:air:${host}:skill:jackalope-website`,
            displayName: 'Read the Jackalope website',
            type: 'text/markdown',
            url: skillUrl('jackalope-website'),
            representativeQueries: [
              'what is Jackalope',
              'which coding agents does Jackalope support',
            ],
          },
          {
            identifier: `urn:air:${host}:skill:jackalope-getting-started`,
            displayName: 'Get started with Jackalope',
            type: 'text/markdown',
            url: skillUrl('jackalope-getting-started'),
            representativeQueries: [
              'how do I install Jackalope',
              'how do I connect my Jackalope account',
            ],
          },
          {
            identifier: `urn:air:${host}:skill:jackalope-terminal`,
            displayName: 'Work with Jackalope from the terminal',
            type: 'text/markdown',
            url: skillUrl('jackalope-terminal'),
            representativeQueries: [
              'start a Jackalope conversation from the terminal',
              'rejoin a Jackalope session from the command line',
            ],
          },
        ],
      },
      null,
      2,
    ),
  };
}
