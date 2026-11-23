/** The landing page's facts, kept as data so every number shown has one source. */

export const roster = [
  { id: 'codex', name: 'Codex' },
  { id: 'claude', name: 'Claude Code' },
  { id: 'gemini', name: 'Gemini CLI' },
  { id: 'grok', name: 'Grok' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'kimi', name: 'Kimi Code' },
  { id: 'antigravity', name: 'Antigravity' },
];

export const providers = [
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'ollama', name: 'Ollama' },
];

export interface LandingPane {
  name: string;
  kind: string;
  summary: string;
  href: string;
  tags: string[];
  facts: { value: string; label: string }[];
}

/** The five things the product does, shown as panes side by side. */
export function landingPanes(platforms: string): LandingPane[] {
  return [
    {
      name: 'Parallel',
      kind: 'Agents',
      summary:
        'Give three tasks to three agents and they work at the same time. Questions come to you while the rest keeps moving.',
      href: '/parallel-coding-agents/',
      tags: roster.map((agent) => agent.name),
      facts: [{ value: '1', label: 'workspace for all your coding agents' }],
    },
    {
      name: 'Isolated',
      kind: 'Git worktrees',
      summary:
        'Each task gets its own branch and folder, so agents working at once never overwrite each other.',
      href: '/git-worktrees-for-ai-agents/',
      tags: ['Branch per task', 'Folder per task'],
      facts: [{ value: '1', label: 'Git worktree per task' }],
    },
    {
      name: 'Reviewed',
      kind: 'Review',
      summary:
        'The diff, the checks and the merge wait in one view. Nothing lands until you approve it.',
      href: '/blog/review-ai-generated-code-checklist/',
      tags: ['Changes', 'Checks', 'Merge'],
      facts: [{ value: '0', label: 'merges without you' }],
    },
    {
      name: 'Remembered',
      kind: 'Project context',
      summary:
        'Run /init once to write your project guidance. Save what an agent learns with /learn. The next task starts with both.',
      href: '/features/project-context-for-coding-agents/',
      tags: ['/init', '/learn'],
      facts: [{ value: 'AGENTS.md', label: 'a plain file you can edit' }],
    },
    {
      name: 'Local',
      kind: 'Desktop app',
      summary:
        'Repositories and credentials stay on your computer. Agents reach their providers under your settings.',
      href: '/download/',
      tags: [...platforms.replace(' and ', ', ').split(', '), 'Apache 2.0'],
      facts: [{ value: '$0', label: 'for your account. Bring the agents you already pay for.' }],
    },
  ];
}

export const moreFeatures = [
  {
    title: 'Work and personal accounts',
    detail: 'Named profiles per agent, with project defaults and usage tracked by account.',
    href: '/blog/work-and-personal-accounts/',
  },
  {
    title: 'Browser automation',
    detail: 'Agents open pages, click through flows, take screenshots and audit what they built.',
    href: '/knowledge/mcp-and-browser-automation/',
  },
  {
    title: 'Desktop control',
    detail: 'On Windows, agents can use an app you select, the way you would.',
    href: '/knowledge/mcp-and-browser-automation/',
  },
  {
    title: 'Scheduled tasks',
    detail: 'Run chores on a schedule with a history for every run, while the app is open.',
    href: '/features/recurring-coding-agent-tasks/',
  },
  {
    title: 'Branch watchers',
    detail: 'Run a check whenever a branch changes. Watching makes no model calls.',
    href: '/features/recurring-coding-agent-tasks/',
  },
  {
    title: 'Bots',
    detail: 'Give a helper a role, an agent and the tools it may use, then ask it anything.',
    href: '/knowledge/bots/',
  },
];
