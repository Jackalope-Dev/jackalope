export const knowledgeClips = [
  {
    id: 'composer',
    slug: 'task-composer-and-effort-levels',
    section: 'first-task',
    title: 'From a brief to a task',
    seconds: 7,
    description: 'Write the outcome, then review effort, agent, workspace, context, and tools.',
    transcript:
      'In the Atlas sample project, the composer opens with Balanced effort and a separate worktree. A brief asks for faster search, helpful empty states, and a browser check. The task options are reviewed before Start task is selected. This recording illustrates the interface; it does not launch a native agent.',
  },
  {
    id: 'accounts',
    slug: 'multi-account-and-agents',
    section: 'first-account',
    title: 'Find your agent accounts',
    seconds: 6,
    description: 'See where agent configuration and work or personal account profiles live.',
    transcript:
      'The sample workspace opens agent configuration and moves between Codex, Claude Code, Grok, and OpenCode. The account area shows work and personal profiles, an option to add an account, and sign-in controls. Names and account states are sample data; no provider authentication is performed.',
  },
  {
    id: 'browser',
    slug: 'mcp-and-browser-automation',
    section: 'browser-check-example',
    title: 'Inspect browser evidence',
    seconds: 9,
    description:
      'Follow a sample form interaction and see where its checks and screenshots appear.',
    transcript:
      'A scripted browser example searches for an event and fills a reservation form. The view returns to Jackalope’s Evidence tab, showing two sample checks and a screenshot. The example demonstrates how evidence is presented; it does not verify a real booking or native agent run.',
  },
  {
    id: 'theme',
    slug: 'theme-editor-and-atmosphere',
    section: 'try-a-theme',
    title: 'Preview your workspace theme',
    seconds: 6,
    description: 'Explore appearance, color, and atmosphere before keeping a theme.',
    transcript:
      'The appearance picker switches between light and dark, explores accent colors and atmosphere, and keeps the selected theme. The surrounding sample task composer updates during the preview.',
  },
];

export const knowledgeScreenshots = [
  {
    slug: 'git-worktrees',
    section: 'guarded-integration',
    image: 'review',
    title: 'Start review from the task result',
    alt: 'Atlas sample task result with Review integration, Changes & checks, Evidence, Activity, and Context controls.',
    description:
      'Use the result to orient yourself, then inspect Changes & checks and Evidence before reviewing integration. This is a sample task, not a verified code change.',
  },
  {
    slug: 'troubleshooting-and-diagnostics',
    section: 'history-recovery',
    image: 'tasks',
    title: 'Find work that needs attention',
    alt: 'Atlas sample Tasks page with Needs you, Ready to review, Working, and Saved ideas groups and a Find a task search field.',
    description:
      'Open the affected task to inspect its history and current outcome. These sample groups show where to look; an interrupted task still needs review before retrying.',
  },
];
