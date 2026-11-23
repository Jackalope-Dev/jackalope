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

/** Three "#rrggbb" colors the background field flows between. */
export type Palette = [string, string, string];

/** The field seen through the hero letters, and behind sections that set no palette. */
export const heroPalette: Palette = ['#c4b0ff', '#ff6a3d', '#4f22e0'];

export interface LandingCard {
  name: string;
  kind: string;
  summary: string;
  href: string;
  /** The card's solid color and the text color on it; the pair must reach 4.5:1. */
  surface: string;
  ink: string;
  palette: Palette;
  tags: string[];
  facts: { value: string; label: string }[];
}

const INK = '#0d0b13';

/** Card surfaces are the accents of the brand's preset themes, violet deepened for white text. */
export function landingCards(platforms: string): LandingCard[] {
  return [
    {
      name: 'Parallel',
      kind: 'Agents',
      summary:
        'Give three tasks to three agents and they work at the same time. Questions come to you while the rest keeps moving.',
      href: '/parallel-coding-agents/',
      surface: '#5b2be0',
      ink: '#ffffff',
      palette: ['#8b5cf6', '#c4b5fd', '#2e1065'],
      tags: roster.map((agent) => agent.name),
      facts: [
        { value: String(roster.length), label: 'coding agents in one workspace' },
        { value: String(providers.length), label: 'model providers, connected directly' },
      ],
    },
    {
      name: 'Isolated',
      kind: 'Git worktrees',
      summary:
        'Each task gets its own branch and folder, so agents working at once never overwrite each other.',
      href: '/git-worktrees-for-ai-agents/',
      surface: '#10b981',
      ink: INK,
      palette: ['#10b981', '#a7f3d0', '#064e3b'],
      tags: ['Branch per task', 'Folder per task'],
      facts: [{ value: '1', label: 'Git worktree per task' }],
    },
    {
      name: 'Reviewed',
      kind: 'Review',
      summary:
        'The diff, the checks and the merge wait in one view. Nothing lands until you approve it.',
      href: '/blog/review-ai-generated-code-checklist/',
      surface: '#f97316',
      ink: INK,
      palette: ['#f97316', '#fed7aa', '#9a3412'],
      tags: ['Changes', 'Checks', 'Merge'],
      facts: [{ value: '0', label: 'merges without you' }],
    },
    {
      name: 'Remembered',
      kind: 'Project context',
      summary:
        'Run /init once to write your project guidance. Save what an agent learns with /learn. The next task starts with both.',
      href: '/features/project-context-for-coding-agents/',
      surface: '#eab308',
      ink: INK,
      palette: ['#eab308', '#fef08a', '#a16207'],
      tags: ['/init', '/learn'],
      facts: [{ value: 'AGENTS.md', label: 'a plain file you can edit' }],
    },
    {
      name: 'Local',
      kind: 'Desktop app',
      summary:
        'Repositories and credentials stay on your computer. Agents reach their providers under your settings.',
      href: '/download/',
      surface: '#06b6d4',
      ink: INK,
      palette: ['#06b6d4', '#a5f3fc', '#155e75'],
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
