import type { BlogPost } from './blog-types.ts';

export const recentPosts: BlogPost[] = [
  {
    slug: 'parallel-work-clearer-handoffs',
    title: 'Parallel work needs a good handoff.',
    seoTitle: 'Clearer handoffs for parallel coding agents',
    category: 'Product notes',
    date: '2026-09-10',
    readingTime: '3 min read',
    description:
      'Keeping the whole request in view, passing on checked work, and bringing related changes back for one considered review.',
    cover: { kind: 'parallel', tone: 'mint', label: 'From one task to the next' },
    sections: [
      {
        title: 'Keep the original request close.',
        paragraphs: [
          'Splitting a feature into tasks creates a new problem: each agent sees a smaller piece of the work. A search component can look finished while the larger request still needs keyboard access, an empty state, and a way to return focus. The handoff needs to carry those expectations forward.',
          'Recent work in Jackalope keeps the complete feature request with each saved task, alongside its own instructions. Planning inspects the repository before proposing file ownership and dependencies. When there is no clear reason to divide the work, the default draft keeps one worker. More agents are useful when there is independent work for them to do.',
        ],
      },
      {
        title: 'Give the next task something concrete to build on.',
        paragraphs: [
          'Imagine one task defining a search interface and a second building the keyboard interaction around it. The second task needs the actual interface, not just a message saying it exists. Jackalope now has an optional way to start dependent work from verified predecessor snapshots. It requires a saved project check and automatic verification.',
          'The next worktree begins with a retained snapshot of the checked predecessor changes. Conflicts or a predecessor that has changed, stopped, or become unavailable block continuation. The original workspaces remain in place, and final review still includes the related tasks together. A passing check allows the next step to use that snapshot; you still decide whether the feature meets the brief.',
        ],
      },
      {
        title: 'Make the handoff useful to the person reviewing.',
        paragraphs: [
          'Structured reports can separate completed work, remaining work, and relevant artifacts. A report stays attached to the attempt and its file snapshot. That makes it easier to inspect what an agent was referring to, while keeping its observations distinct from accepted results.',
          'For a useful handoff, ask for the behavior that changed, the checks run, and any decision the next task must make. Keep predecessor workspaces until the combined review is complete. Two patches can each pass their own checks and still disagree at their shared interface.',
          'These coordination changes are implemented in the prerelease source. Installed execution and recovery checks remain open, and repeatable comparisons are still needed before claiming that staged work improves speed or quality.',
        ],
        links: [{ label: 'How parallel work fits together', href: '/parallel-coding-agents/' }],
      },
    ],
    related: [
      {
        label: 'Using Claude Code and Codex together',
        href: '/blog/claude-code-and-codex-together/',
      },
      { label: 'Reviewing AI-generated code', href: '/blog/review-ai-generated-code-checklist/' },
    ],
  },
  {
    slug: 'focused-guidance-useful-checks',
    title: 'Less noise. More useful context.',
    seoTitle: 'Focused agent guidance and useful checks',
    category: 'Build notes',
    date: '2026-09-10',
    readingTime: '2 min read',
    description:
      'What belongs in a task brief, what belongs in a check result, and why fewer tokens alone cannot tell us if an agent did better.',
    cover: { kind: 'quality', tone: 'honey', label: 'Make every instruction count' },
    sections: [
      {
        title: 'Match the guidance to the work.',
        paragraphs: [
          'A spelling fix should not inherit an investigation routine just because nearby text mentions a bug. A request about design tokens should not be mistaken for work on authentication tokens. Small mismatches can make an otherwise simple brief harder to follow.',
          'Recent changes make automatic guideline selection more selective about those cases, including negated requests and fenced examples. Explicitly selected guidelines and project defaults remain available. The aim is to bring relevant guidance into the task while preserving your choices.',
        ],
      },
      {
        title: 'Keep the useful part of a long check.',
        paragraphs: [
          'A successful check can produce hundreds of repetitive lines. Returning all of them to an agent can bury the warning or summary that deserves attention. Jackalope now compacts recognized passing-test lines in long successful native verification responses, while retaining diagnostics and standard error.',
          'The stored output remains available for closer inspection within the capture limits. Failed checks keep their output within those same limits. This is deliberately conservative: when a line is unfamiliar, hiding it could remove the clue needed to understand a problem.',
        ],
      },
      {
        title: 'Measure the result, including the retries.',
        paragraphs: [
          'A shorter prompt is only useful if the agent still does the right work. The evaluation tooling compares preserved before-and-after versions on the same tasks, with independent checks for the expected behavior and unrelated edits. Failed attempts and their reported usage stay in the comparison.',
          'That gives us a way to investigate changes without turning one small fixture into a broad promise. Representative repositories, more providers, and independent human review remain important next steps. These changes are in development; synthetic checks do not establish better results than a provider’s own app.',
        ],
        links: [
          {
            label: 'Project context and guidance',
            href: '/features/project-context-for-coding-agents/',
          },
        ],
      },
    ],
    related: [
      { label: 'From a clear brief to a considered review', href: '/blog/from-brief-to-review/' },
      { label: 'Follow the development changelog', href: '/changelog/' },
    ],
  },
  {
    slug: 'making-room-for-longer-histories',
    title: 'Making room for longer histories.',
    seoTitle: 'Smoother task history and code review',
    category: 'Build notes',
    date: '2026-09-10',
    readingTime: '2 min read',
    description:
      'A look at the work behind incremental saves, more selective interface updates, and large patches that leave room to keep working.',
    cover: { kind: 'performance', tone: 'indigo', label: 'Keep the work close' },
    sections: [
      {
        title: 'A workspace grows with its projects.',
        paragraphs: [
          'The first task is a small amount of data. A workspace with many saved tasks, long results, and several agents producing output has different demands. Opening a result or switching tasks should not ask the interface to rebuild everything around it.',
          'Recent work changes how task updates move through Jackalope. Output uses durable incremental saves, and the interface receives changed task records. History loads concurrently, while large patch processing and code highlighting move into background workers.',
        ],
      },
      {
        title: 'Keep recovery part of the design.',
        paragraphs: [
          'Saving less work per update must still preserve the work itself. The output journal is flushed before an update is acknowledged. Checkpoints retain compatibility with existing snapshots, and recovery keeps complete journal entries before a damaged tail while preserving the original damaged file.',
          'The same care applies to review. A rich patch view is useful, but access to the original patch still matters. A visual rendering should help you inspect a change without becoming the only way to reach it.',
        ],
      },
      {
        title: 'Test the busy workspace too.',
        paragraphs: [
          'Local fixtures exercise a thousand saved tasks, concurrent output, and large wrapped patches. They help us find unnecessary work and check that keyboard navigation, task selection, and review remain usable as content grows.',
          'Measurements vary with filesystem caching and other processes on the machine. These local checks do not establish installed-app startup, battery use, or a consistent speedup on every device. Installed and cross-platform performance acceptance remain open as we prepare for release.',
        ],
        links: [
          { label: 'Explore the task and review workflow', href: '/blog/from-brief-to-review/' },
        ],
      },
    ],
    related: [
      { label: 'Code review with evidence', href: '/guides/review-ai-generated-code/' },
      { label: 'See what is taking shape', href: '/changelog/' },
    ],
  },
];
