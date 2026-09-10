import { comparisonLinks } from './comparison-content.ts';
import type { MarketingPage } from './marketing-content.ts';
import { roadmapHeadline, roadmapLede, roadmapStages } from './roadmap-content.ts';

export const growthPages: MarketingPage[] = [
  {
    path: '/roadmap/',
    kind: 'Roadmap',
    title: 'Jackalope roadmap | What comes next',
    description:
      'Follow plans for Jackalope desktop releases, coding-agent support, project tools, and remote work.',
    headline: roadmapHeadline,
    lede: roadmapLede,
    image: 'tasks',
    signals: roadmapStages.map((stage) => stage.label),
    sections: roadmapStages.map((stage) => ({
      title: `${stage.label}: ${stage.title}`,
      paragraphs: [stage.status, stage.description, stage.next],
      bullets: stage.items.map((item) => `${item.title} ${item.summary} ${item.detail}`),
    })),
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
        title: 'Choose the requirement you cannot compromise on.',
        paragraphs: [
          'Start with where the code must run, who needs access, and which agents and accounts you already use. Then compare how a change reaches review. A remote host, a shared human conversation, and a local plan of dependent agent tasks solve different problems.',
          'The table below is an editorial starting point based on official product documentation reviewed September 9, 2026. It is not a performance ranking or a claim that other products lack unlisted features. Open a detailed comparison for the relevant sources and tradeoffs.',
        ],
      },
      {
        title: 'Match the workspace to the requirement.',
        paragraphs: [
          'Use this to narrow a trial to the workflows you actually need. Jackalope’s current focus is local task continuity, project context, and combined review; remote hosts and shared human teams remain future work.',
        ],
        table: {
          columns: ['Requirement', 'Products to examine', 'What to check'],
          rows: [
            [
              'Remote machines and scheduled work',
              'Superset, Codius, Emdash',
              'Where the task runs, whether it survives disconnects, and how you recover a result.',
            ],
            [
              'Browser feedback beside terminals and diffs',
              'Orca, Emdash',
              'How a selected UI element, screenshot, or failed check reaches the agent and its review.',
            ],
            [
              'Shared human participation',
              'Conductor, Worktree',
              'Who can join, send instructions, access files, and continue while the owner is offline.',
            ],
            [
              'Project setup and branch review',
              'Braid',
              'Dependency installation, local configuration, branch status, and the full PR lifecycle.',
            ],
            [
              'A persistent agent with messaging',
              'Hermes Agent',
              'Memory ownership, execution backends, scheduled delivery, and approval boundaries.',
            ],
            [
              'Local tasks with dependent changes',
              'Jackalope',
              'Account binding, frozen task context, prerequisite integration, and combined patch review.',
            ],
            [
              'One focused coding session',
              'Your terminal and editor',
              'Whether manual worktrees and existing review tools already cover the coordination you need.',
            ],
          ],
        },
        links: [
          {
            href: '/compare/superset/',
            label: 'Jackalope vs Superset',
          },
          {
            href: '/compare/orca/',
            label: 'Jackalope vs Orca',
          },
          {
            href: '/compare/conductor/',
            label: 'Jackalope vs Conductor',
          },
          {
            href: '/compare/emdash/',
            label: 'Jackalope vs Emdash',
          },
          {
            href: '/compare/braid/',
            label: 'Jackalope vs Braid',
          },
          {
            href: '/compare/worktree/',
            label: 'Jackalope vs Worktree',
          },
          {
            href: '/compare/codius/',
            label: 'Jackalope vs Codius',
          },
          {
            href: '/compare/hermes/',
            label: 'Jackalope vs Hermes Agent',
          },
          {
            href: '/compare/terminal-tabs/',
            label: 'Jackalope and terminal tabs',
          },
        ],
      },
      {
        title: 'Use the same small trial for each candidate.',
        paragraphs: [
          'Pick a feature with one shared contract, one consumer, and an independent documentation change. Record the baseline build, give the workers explicit scopes, and request one correction after their first results. Keep the model and test conditions comparable where the products permit it.',
          'At review, record whether you can recover the original request, identify the account used, find the current patch, and match the checks to that patch. Include a failed setup or disconnected session in the trial. Measure time spent repeating context and repairing the workflow, rather than counting open agents.',
        ],
        links: [
          {
            href: '/guides/run-codex-and-claude-code-in-parallel/',
            label: 'A worked parallel plan',
          },
          {
            href: '/guides/review-ai-generated-code/',
            label: 'What to inspect in the result',
          },
        ],
      },
      {
        title: 'Separate availability from a roadmap.',
        paragraphs: [
          'Jackalope is coming soon. Its tour uses sample data, and public pricing has not been announced. Your installed agents and provider accounts supply model access. Check current downloads and plans on each alternative’s own site before making a purchase or migration decision.',
          'Treat workspace fees, model usage, and remote compute as separate costs. A documented feature is a reason to run a trial, not evidence that a particular account, repository, or deployment has passed one.',
        ],
        links: [
          {
            href: '/agents/',
            label: 'Check Jackalope agent compatibility',
          },
          {
            href: '/tour/',
            label: 'Watch the sample workspace tour',
          },
          {
            href: '/roadmap/',
            label: 'See what remains planned',
          },
        ],
      },
    ],
    related: [
      ...comparisonLinks,
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
      {
        title: 'Recognize the point where bookkeeping becomes work.',
        paragraphs: [
          'Try your next two tasks with a short record beside each terminal: project, branch, account, requested result, and current blocker. If that is easy to maintain and your review tools preserve the evidence you need, a terminal workflow may be enough.',
          'A workspace becomes more useful when you repeatedly reopen sessions to remember a decision, miss a waiting question, or lose track of which patch a test run covered. Those are observable costs you can compare with Jackalope’s task history and review flow when early access is available.',
        ],
      },
      {
        title: 'Move one workflow at a time.',
        paragraphs: [
          'Keep your existing editor and CLI configuration while trying one local project. Reproduce its build in a fresh task worktree, complete a small change, ask for a follow-up, and inspect the result. Include cleanup in the trial so you know where unfinished files remain.',
          'You can still inspect worktrees with ordinary Git tools. Review project instructions and tool configuration in both places; adding a workspace does not remove the agent’s existing permissions or provider costs.',
        ],
        links: [
          {
            href: 'https://git-scm.com/docs/git-worktree',
            label: 'Manage worktrees with Git',
          },
          {
            href: '/agents/',
            label: 'Check the agent you already use',
          },
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
    title: 'Browser automation for coding agents | Jackalope',
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
      {
        title: 'Example: verify a broken search dropdown.',
        paragraphs: [
          'Include the page URL, a query with several results, and the expected keyboard behavior in the task. Ask the agent to reproduce the failure, make the change, and then check Arrow keys, Enter, Escape, and focus after the dropdown closes.',
          'Capture the open list and a narrow layout. Also check zero results and a failed search request. These states answer different questions: a screenshot can show clipping, while an actual keyboard interaction checks whether selection and focus work.',
        ],
      },
      {
        title: 'Keep browser and native acceptance separate.',
        paragraphs: [
          'The selected agent needs a supported path to the browser tools. Check connection support before assigning the task; OpenCode uses its own CLI tools rather than Jackalope project-tool delivery. Use a test account and environment appropriate to the actions in the brief.',
          'A browser preview does not exercise a packaged desktop application’s native permissions or operating-system integration. For a change that crosses that boundary, retain the browser evidence and name the additional installed-app check needed before acceptance.',
        ],
        links: [
          {
            href: '/knowledge/mcp-and-browser-automation/',
            label: 'Browser sessions and agent tool support',
          },
          {
            href: '/agents/',
            label: 'Compare adapter capabilities',
          },
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
  seoTitle: 'Help shape a coding-agent workspace',
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
