import type { MarketingPage } from './marketing-content.ts';

export const growthPages: MarketingPage[] = [
  {
    path: '/roadmap/',
    kind: 'Roadmap',
    title: 'Jackalope roadmap | What comes next',
    description:
      'Follow plans for Jackalope desktop releases, coding-agent support, project tools, and remote work.',
    headline: 'Where we go next.',
    lede: 'Our priorities for Jackalope. In development means work is underway; planned and exploring items are not available features or promised release dates.',
    image: 'tasks',
    signals: ['In development', 'Planned', 'Exploring'],
    sections: [
      {
        title: 'In development: the desktop launch.',
        paragraphs: [
          'We are preparing Jackalope for macOS, Windows, and Linux, including installation, updates, agent sign-in, and recovery of saved work. Public downloads are not yet open; join the waitlist for an invitation when access is ready.',
        ],
      },
      {
        title: 'Planned: more agents and richer project tools.',
        paragraphs: [
          'We want to expand agent support beyond Codex, Claude Code, Grok, and OpenCode, and improve tool connections and usage reporting. Gemini CLI is under evaluation. Goose and Aider execution support is on the backlog.',
        ],
        bullets: [
          'More agent-specific tools, questions, and account controls.',
          'GitHub pull requests, CI checks, and issue intake.',
          'Better project understanding and guidance on usage and capacity.',
        ],
      },
      {
        title: 'Exploring: work beyond your desktop.',
        paragraphs: [
          'Remote hosts, phone access, and shared team workspaces are future work. We are exploring ways to steer and review tasks across machines while keeping control of projects and connected services clear.',
        ],
      },
      {
        title: 'Follow the progress.',
        paragraphs: [
          'The changelog records completed development milestones. This roadmap records intent and may change as we learn from early users. We have not announced a public launch date or price.',
        ],
      },
    ],
    related: [
      {
        href: '/changelog/',
        label: 'Read the changelog',
      },
      {
        href: '/agents/',
        label: 'Current agent compatibility',
      },
      {
        href: '/tour/',
        label: 'Watch the app tour',
      },
    ],
  },
  {
    path: '/compare/',
    kind: 'Workspace comparison',
    title: 'Compare coding-agent workspaces | Jackalope',
    description:
      'Compare Jackalope with Superset, Orca, Conductor, Emdash, Braid, Worktree, Codius, and Hermes by the workflow you want.',
    headline: 'Your agents are a choice. So is your workspace.',
    lede: 'Choose a workspace around the way you brief agents, follow parallel work, and review changes. Here is how Jackalope fits.',
    image: 'review',
    signals: ['Your agent accounts', 'Project context', 'Parallel worktrees', 'Combined review'],
    sections: [
      {
        title: 'Keep the whole task together.',
        paragraphs: [
          'Jackalope brings project instructions, agent accounts, independent tasks, and combined code review into one desktop workspace. Give each task the context it needs, follow questions and results, and decide which changes to bring together.',
        ],
      },
      {
        title: 'Find the workflow that fits.',
        paragraphs: [
          'These summaries reflect official product pages reviewed September 8, 2026. Follow the sources below for current availability and details.',
        ],
        bullets: [
          'Superset: a workspace for different coding agents, parallel tasks, recurring work, and remote hosts.',
          'Orca: an agent workspace with terminals, browser tools, diffs, and a mobile companion.',
          'Conductor: parallel coding agents with cloud workspaces and shared sessions.',
          'Emdash: parallel agents, scheduled work, an in-app browser, and reusable prompts and tools.',
          'Braid: parallel agent sessions with integrated terminals, editing, and GitHub review controls.',
          'Worktree: shared agent conversations and code review for human teams.',
          'Codius: desktop, web, and phone access to coding agents on hosts you control.',
          'Hermes by Nous Research: an agent with persistent memory and automation, rather than a workspace primarily for supervising different coding agents.',
        ],
      },
      {
        title: 'See Jackalope in action.',
        paragraphs: [
          'Watch the app tour, explore agent compatibility, or join the early-access waitlist. Use the roadmap to follow plans for additional platforms, integrations, and remote work.',
        ],
      },
    ],
    related: [
      {
        href: 'https://superset.sh/',
        label: 'Superset',
      },
      {
        href: 'https://www.onorca.dev/',
        label: 'Orca',
      },
      {
        href: 'https://www.conductor.build/',
        label: 'Conductor',
      },
      {
        href: 'https://emdash.com/',
        label: 'Emdash',
      },
      {
        href: 'https://getbraid.dev/',
        label: 'Braid',
      },
      {
        href: 'https://tryworktree.com/',
        label: 'Worktree',
      },
      {
        href: 'https://codius.ai/',
        label: 'Codius',
      },
      {
        href: 'https://hermes-agent.nousresearch.com/',
        label: 'Hermes by Nous Research',
      },
      {
        href: '/compare/terminal-tabs/',
        label: 'Jackalope and terminal tabs',
      },
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
          'Let an agent navigate pages, fill forms, use the keyboard, and capture screenshots at different sizes and themes. Browser sessions stay with their task, and you can stop them when needed.',
          'Choose the tools available to the task, then include the states you want the agent to check in your brief.',
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
          'Review the states that matter: keyboard navigation, small screens, and error recovery. A screenshot shows one moment; try the changed behavior before accepting the work.',
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
    'Tell us which agents and workflows matter to you, and bring other developers into early access.',
  sections: [
    {
      title: 'A workspace for the way you build.',
      paragraphs: [
        'Your projects, agent accounts, and review habits shape how you work. Share the parts that take too much effort today so we can focus on what helps.',
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
