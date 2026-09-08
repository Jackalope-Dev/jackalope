import type { MarketingPage } from './marketing-content.ts';

export const growthPages: MarketingPage[] = [
  {
    path: '/compare/',
    kind: 'Workspace comparison',
    title: 'Compare coding-agent workspaces | Jackalope',
    description:
      'Compare Jackalope, Braid, Emdash, Worktree, and Codius by the workflow you need: local review, GitHub, shared sessions, or remote work.',
    headline: 'More agents is the beginning. What happens next?',
    lede: 'Choose a workspace around how you work, where your projects run, and how you review the result. Here is where Jackalope fits alongside other coding-agent tools.',
    image: 'review',
    signals: [
      'Local project ownership',
      'Task context',
      'Combined review',
      'Cross-platform launch planned',
    ],
    sections: [
      {
        title: 'Choose the workflow, then the workspace.',
        paragraphs: [
          'Jackalope focuses on the path from a task brief to reviewed changes: project context, bounded coordination updates, snapshot-bound evidence, and an explicit combined integration decision. We are preparing our first launch for macOS, Windows, and Linux.',
          'These comparisons summarize public product descriptions checked September 8, 2026. They are not performance benchmarks or independent product tests. Capabilities change; check the linked official sources before choosing.',
        ],
        bullets: [
          'Braid: consider it when integrated terminals, an editor, and GitHub PR/CI controls are central to your workflow.',
          'Emdash: consider it for a broad agent catalog, parallel development, and a larger developer-tool surface.',
          'Worktree: consider it when shared workspaces and collaborative agent sessions matter.',
          'Codius: consider it when you need desktop, web, and phone access to coding agents on hosts you control.',
        ],
      },
      {
        title: 'Where Jackalope fits.',
        paragraphs: [
          'You want to run independent tasks with your own coding-agent accounts and return to a clear review queue. Project instructions and selected tools travel with each task. Dependencies wait for integrated changes, and changed source files can make previous evidence stale.',
          'Separate Git worktrees are useful, but they are not a security sandbox or proof that two changes work together. Jackalope makes the combined review an explicit step.',
        ],
      },
      {
        title: 'Be clear about the gaps.',
        paragraphs: [
          'Jackalope is in prerelease. Deep GitHub PR/CI workflows, issue-tracker intake, remote hosts, phone control, and shared human-team workspaces are future work. If these are essential today, evaluate tools that already offer them.',
          'Bring your own supported coding agents and accounts. Provider charges still apply. There is no confirmed public release date or price.',
        ],
      },
    ],
    related: [
      { href: 'https://getbraid.dev/', label: 'Braid: official product' },
      { href: 'https://emdash.com/', label: 'Emdash: official product' },
      { href: 'https://tryworktree.com/', label: 'Worktree: official product' },
      { href: 'https://codius.ai/', label: 'Codius: official product' },
      { href: '/compare/terminal-tabs/', label: 'Jackalope and terminal tabs' },
    ],
  },
  {
    path: '/compare/terminal-tabs/',
    kind: 'Workflow comparison',
    title: 'Coding agents: Jackalope or terminal tabs? | Jackalope',
    description:
      'When do terminal sessions work well, and when does a coding-agent workspace help? Compare task context, Git worktrees, questions, and review.',
    headline: 'Keep your terminal. Give the work a home.',
    lede: 'Terminal tabs are a good way to start a coding agent. A workspace becomes useful when you are juggling projects, questions, branches, and several changes that need one review.',
    image: 'tasks',
    signals: ['Your existing agents', 'Visible questions', 'Task history', 'Combined patches'],
    sections: [
      {
        title: 'A single focused session can stay simple.',
        paragraphs: [
          'If you usually work on one task at a time, your preferred terminal and editor may already fit. You can create worktrees with Git, run checks yourself, and inspect changes with your usual tools. Jackalope is another way to organize that workflow, not a requirement for using coding agents.',
        ],
      },
      {
        title: 'Parallel work adds coordination work.',
        paragraphs: [
          'With multiple sessions, you need to remember which project, branch, account, brief, and result belongs to each one. You also need to spot a question or failure without repeatedly checking every tab. Jackalope keeps these records attached to tasks and groups work by what needs your attention.',
        ],
        bullets: [
          'Pick a task and see its result, evidence, and follow-up attempts together.',
          'Give independent tasks separate worktrees and define dependencies in a parallel plan.',
          'Choose project context and accounts explicitly.',
        ],
      },
      {
        title: 'Review the combination, not just each reply.',
        paragraphs: [
          'Two isolated tasks can still make incompatible assumptions. Jackalope prepares a combined patch for review and rechecks the source and target before integration. The final decision stays explicit.',
          'The interface tour uses sample project data. Try this same workflow on a disposable repository when you receive early access.',
        ],
      },
    ],
    related: [
      { href: '/compare/', label: 'Compare coding-agent workspaces' },
      { href: '/guides/review-ai-generated-code/', label: 'Review agent-generated code' },
      { href: '/git-worktrees-for-ai-agents/', label: 'Understand Git worktrees' },
    ],
  },
  {
    path: '/features/browser-automation-for-coding-agents/',
    kind: 'Product guide',
    title: 'Browser automation and evidence for coding agents | Jackalope',
    description:
      'Keep browser sessions, screenshots, and accessibility findings attached to coding-agent tasks in Jackalope.',
    headline: 'Give browser work a place in the task.',
    lede: 'A UI change needs more than a confident summary. Jackalope gives agent tasks owned browser sessions and recorded evidence you can return to during review.',
    image: 'review',
    signals: [
      'Task-owned sessions',
      'Screenshots',
      'Accessibility findings',
      'Reviewable evidence',
    ],
    sections: [
      {
        title: 'Inspect the interface as part of the work.',
        paragraphs: [
          'The native browser tools support navigation, accessibility snapshots, form and keyboard actions, screenshots, and viewport or theme changes. Sessions belong to a task so its browser work can stay bounded and cancellable.',
          'Agents use the tools their adapter and task configuration expose. Tool availability is not a guarantee that the agent exercised every state.',
        ],
      },
      {
        title: 'Keep useful evidence with the change.',
        paragraphs: [
          'Screenshots and recorded accessibility findings can stay attached to the task. Review them alongside the result and patch, then ask for a correction when the evidence misses a meaningful state.',
        ],
        bullets: [
          'Check a narrow viewport as well as your normal window size.',
          'Exercise keyboard focus and the actual error or empty state.',
          'Inspect light and dark appearance when a change touches shared controls.',
        ],
      },
      {
        title: 'Evidence supports a decision.',
        paragraphs: [
          'A browser screenshot shows a captured state. It does not establish native window behavior, installed-app acceptance, or a complete accessibility audit. Keep those checks separate and explicit.',
        ],
      },
    ],
    related: [
      { href: '/guides/review-ai-generated-code/', label: 'Review agent-generated changes' },
      { href: '/tour/', label: 'Watch the interface tour' },
      { href: '/features/project-context-for-coding-agents/', label: 'Project context and tools' },
    ],
  },
];

export const growthPost = {
  slug: 'building-for-your-workflow',
  title: 'Help shape a workspace that fits how you build.',
  category: 'From the studio',
  date: '2026-09-08',
  readingTime: '2 min read',
  description:
    'Our first launch is planned for macOS, Windows, and Linux. Tell us which agents and workflows matter to you, then bring other developers into early access.',
  sections: [
    {
      title: 'One launch, three platforms.',
      paragraphs: [
        'We are planning our first launch across macOS, Windows, and Linux. The goal is a familiar Jackalope workspace wherever you build. Platform packaging, sign-in, and installed-app testing are part of that work; we have not announced a launch date.',
      ],
    },
    {
      title: 'Your setup helps set the direction.',
      paragraphs: [
        'Joining starts with an email address. Then, if you want, tell us the operating systems and agents you use and which workflows need the most help. Select more than one, or skip the questions entirely. Your waitlist place does not depend on your answers.',
        'We use those answers to guide product planning. Choosing an agent or workflow is an expression of interest, not a promise that it is supported.',
      ],
    },
    {
      title: 'Bring someone who would use it.',
      paragraphs: [
        'Approved members receive five Instant Access Passes. A valid invitation grants access once the recipient verifies their email, without another manual approval, and that person receives five passes of their own. Downloads appear when a reviewed build is available.',
        'Share with people who would find the workflow useful. The benefit is direct access for the person you invite.',
      ],
    },
  ],
};
