import type { BlogPost } from './blog-types.ts';

export const recentPosts: BlogPost[] = [
  {
    slug: 'coding-agents-from-the-terminal',
    cover: { kind: 'agents', tone: 'indigo', label: 'Say it where you already are.' },
    title: 'Run coding agents from your terminal without losing the thread.',
    seoTitle: 'Run AI coding agents from the terminal',
    category: 'Product notes',
    date: '2026-09-24',
    readingTime: '4 min read',
    description:
      'Start routed coding-agent conversations from any Git repository, answer agent questions in place, and move a conversation between the app and your terminal.',
    sections: [
      {
        id: 'why-terminal',
        title: 'Start where the idea shows up',
        paragraphs: [
          'Many coding tasks start in a terminal: a failing test, a stack trace, a TODO you just grepped. Switching to another window to describe the work breaks that moment. The jackalope command lets you describe it right there, in the repository you are already in.',
          'Run jackalope in any Git repository and type what you need, the same way you would in a chat. The repository becomes a Jackalope project if it was not one already, and the conversation uses the same accounts, agents and approved access as the desktop app.',
        ],
        code: {
          label: 'Common commands',
          language: 'sh',
          value:
            'jackalope              # start a conversation in this repository\njackalope --continue   # rejoin the latest one here\njackalope ls           # list open conversations\njackalope attach 5cd0  # rejoin one by id prefix',
        },
      },
      {
        id: 'routing',
        title: 'See which agent took the work, and why',
        paragraphs: [
          'You do not have to pick an agent first. Jackalope routes each conversation using your project’s decision preferences, the agents you allow and their reported capacity. The status line names the agent and model it chose, the branch, the step it is on and the reason for the choice, so a routing decision is never a mystery.',
          'Prefer a specific agent? Use /agent to choose the one for your next conversation, or /agents to see which ones are installed and ready.',
        ],
        links: [{ label: 'How routing works', href: '/knowledge/task-routing-and-quotas/' }],
      },
      {
        id: 'questions',
        title: 'Answer questions without leaving the conversation',
        paragraphs: [
          'Agents sometimes need a decision: which API to keep, whether a setting is per device or per account. When one asks, its choices open in the terminal and you answer with one keypress. Open-ended questions are answered by typing a reply.',
          'Output arrives as the agent works, including the files it reads and changes and the checks it runs. /stop stops the current work, /retry runs the last message again, and /pause holds queued messages until you are ready.',
        ],
      },
      {
        id: 'several-sessions',
        title: 'Keep several conversations going',
        paragraphs: [
          'Each terminal can hold its own conversation, so a bug fix and a feature can run side by side. /sessions switches between conversations in the current project and /projects moves to another repository.',
          'Leaving with /quit or Ctrl+C does not stop the work. The conversation keeps running in Jackalope, and you can rejoin it from any terminal or from the app.',
        ],
      },
      {
        id: 'app-and-terminal',
        title: 'Move between the app and your own terminal',
        paragraphs: [
          'The same conversation is available in both places. In the app, choose Terminal in the bottom status bar or press Cmd+J (Ctrl+J on Windows and Linux) to open the command for the current project. Open in Terminal continues that conversation in your system terminal.',
          'If Jackalope is not open when you run the command, it asks whether to open the app or run in the background, and remembers your answer. Opening the app later shows the same session rather than starting a second copy.',
        ],
      },
      {
        id: 'review',
        title: 'Review the result where review belongs',
        paragraphs: [
          'A terminal is a good place to start and steer work; a diff with checks beside it is a better place to accept it. When the work is ready, /diff opens the changes in the app so you can inspect files and check output, then commit or merge deliberately.',
          'The jackalope command installs with the app on macOS, Windows and Linux. Jackalope is in early access: running work requires an approved account and an installed, signed-in agent CLI or a connected API provider.',
        ],
        links: [
          { label: 'Terminal command guide', href: '/knowledge/terminal-command/' },
          { label: 'Review and merge AI changes', href: '/knowledge/review-and-merge/' },
        ],
      },
    ],
    related: [
      {
        label: 'Use Claude Code and Codex together',
        href: '/blog/claude-code-and-codex-together/',
      },
      {
        label: 'Git worktrees for coding agents',
        href: '/blog/git-worktrees-for-ai-coding-agents/',
      },
      { label: 'Compare Jackalope and terminal tabs', href: '/compare/terminal-tabs/' },
    ],
  },
  {
    slug: 'chat-to-reviewed-code-change',
    title: 'Keep the conversation. Review the change.',
    seoTitle: 'From coding-agent chat to a reviewed change',
    category: 'Product notes',
    date: '2026-09-17',
    readingTime: '3 min read',
    description:
      'Queue follow-ups, review one combined result, and keep approval separate from merging in Jackalope’s latest task and chat workflows.',
    cover: { kind: 'review', tone: 'mint', label: 'From conversation to change' },
    sections: [
      {
        title: 'Can a coding-agent chat become a reviewable change?',
        paragraphs: [
          'Yes. In Jackalope, a chat keeps its messages, agent account, and changes in one isolated workspace. You can queue a correction while the agent works, pause before review, and inspect the patch and saved checks before merging. These workflows are implemented in the prerelease source; installed-provider and platform acceptance remain in progress.',
          'Consider a settings form that needs keyboard access. Your first message asks for focus handling. While the agent works, you notice that validation errors also need a clear label. Queue that follow-up so the next batch receives it in order. If the current approach is wrong, use Stop and send to stop the active attempt before continuing with the new direction.',
        ],
        links: [{ label: 'Start and continue a chat', href: '/knowledge/chat-and-follow-ups/' }],
      },
      {
        title: 'Keep a larger request together.',
        paragraphs: [
          'A chat is useful for successive corrections in one workspace. A reviewed plan is useful when a request has separate assignments that need coordination. Project Decisions preferences can assess the approach using local rules, an agent, or optional Jev assistance. Review the proposed scope before starting planned work.',
          'For a settings change spanning a shared schema and two screens, follow Plan, Work, Check, and Review under one parent task. Jackalope prepares a combined result and keeps conflict resolution and bounded check repairs with that task. Individual worker success still needs a final check of the assembled change.',
        ],
        links: [
          {
            label: 'Understand decision methods and usage',
            href: '/knowledge/task-routing-and-quotas/',
          },
        ],
      },
      {
        title: 'Review the result that will reach your branch.',
        paragraphs: [
          'The Review view separates Changes, Checks, and Merge. Browse the changed files, inspect the form in a local preview, and read the check output for the current patch. A file marked reviewed helps you track your place; it does not approve the outcome. Approve work records your acceptance, and merging remains a separate action.',
          'If you want another agent to inspect the change, prepare an agent-review request from the toolbar. You can edit the request before submitting it. Ask a concrete question, such as whether a keyboard user can reach and correct every invalid field, instead of treating a second agent’s approval as a guarantee.',
        ],
        links: [
          { label: 'Review, approve, and merge changes', href: '/knowledge/review-and-merge/' },
        ],
      },
      {
        title: 'Finish one change before starting the next.',
        paragraphs: [
          'Pause chat dispatch and run or cancel queued messages before preparing a merge. If either the source files or target branch changes, refresh the review and required checks. After integration, start a new chat from the updated branch; the old session retains its history without continuing to edit an already-delivered workspace.',
          'A local merge does not publish a branch, open a pull request, or deploy an application. Those remain explicit next steps. The useful outcome is a change you can explain and check, with the conversation and evidence still available when you return.',
        ],
      },
    ],
    related: [
      { label: 'AI code review checklist', href: '/blog/review-ai-generated-code-checklist/' },
      { label: 'Parallel work and handoffs', href: '/blog/parallel-work-clearer-handoffs/' },
      { label: 'Recent development milestones', href: '/changelog/' },
    ],
  },
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
