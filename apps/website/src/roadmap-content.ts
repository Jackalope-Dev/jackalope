export const roadmapHeadline = 'A little further. A lot more possible.';
export const roadmapLede =
  'Explore what’s implemented, what we’re validating, and what we’re considering next. Plans may change as we learn from contributors and early users.';

export const roadmapStages = [
  {
    id: 'built',
    label: 'Built',
    caption: 'The foundation',
    status: 'Implemented · Prerelease',
    title: 'Your work, together.',
    description:
      'One place for your projects, agents, and everything between an idea and a reviewed result. The local workspace is built; release validation is still underway.',
    next: 'Next, make that foundation ready for everyday work.',
    link: { label: 'Explore agent compatibility', href: '/agents/' },
    items: [
      {
        title: 'Your agents. One workspace.',
        summary: 'Projects, accounts, and context that stay with the task.',
        detail:
          'Codex, Claude Code, Grok Build, OpenCode, Kimi Code, and Antigravity adapters are implemented, with provider-specific limits. Kimi supports routing, structured questions, task tokens, and membership quota. Kimi and OpenCode accept direct project tools. Grok models and Antigravity subscription quota are detected through their CLIs. Antigravity remains a worker. Antigravity named profiles use Gemini API keys with separate billing; its subscription login is shared. Named accounts, project preferences, saved ideas, and persistent task history keep work organized. Installed-agent acceptance is still in progress.',
      },
      {
        title: 'Room to work in parallel.',
        summary: 'Separate worktrees. Shared context. Review before integration.',
        detail:
          'Repository-aware plans preserve the full request. Parallel queues prioritize dependencies and share capacity across projects. Optional verified snapshots let dependent tasks continue before final review, with structured progress reports and recorded execution timings. Installed acceptance and repeated quality evaluations remain in progress. Tasks save checkpoints with project-level commit attribution. Review the patch and message, then merge as one commit and clean up finished worktrees and branches. Worktrees separate changes; they do not sandbox an agent’s access to your computer.',
      },
      {
        title: 'Tools that travel with the work.',
        summary: 'In-app help, MCP connections, browser sessions, and recurring tasks.',
        detail:
          'Ask Jackalope connects your default agent to official help and reviewed changes to appearance, preferences, and tasks. External agents can use the same tools through an opt-in local MCP connection. Automatic project lessons learn from explicit preferences, reviewed feedback, and repository patterns, with editable sources and evidence-based performance insights. Codebase maps, task-owned browsers, hourly recurring tasks, and capacity-aware routing keep work connected. Local change-only monitors check committed content without model calls.',
      },
    ],
  },
  {
    id: 'now',
    label: 'In progress',
    caption: 'Getting launch-ready',
    status: 'Current focus · In development',
    title: 'Make it feel like home.',
    description:
      'The next step is confidence: from the first sign-in to coming back to unfinished work. We’re preparing Jackalope for real projects and everyday use.',
    next: 'A dependable local workspace comes before a wider release.',
    link: { label: 'Follow the development changelog', href: '/changelog/' },
    items: [
      {
        title: 'A first run worth coming back to.',
        summary: 'Setup, agent sign-in, and a clear path to your first task.',
        detail:
          'We’re validating project setup, account switching, helper actions, tool permissions, and real-agent task flows in the installed app. Clear retry and recovery paths should make it easy to pick up where you left off.',
      },
      {
        title: 'Ready for your everyday machine.',
        summary: 'Installation, updates, and recovery of saved work.',
        detail:
          'We’re preparing for macOS, Windows, and Linux, with agent detection, browsers, secure account storage, task notifications, and process cleanup ready for native testing. Account connections and settings sync are enabled across platforms. Desktop control still needs macOS and Linux support. Signed installation and upgrades need acceptance on each platform; public downloads are not open yet.',
      },
      {
        title: 'The small things that earn trust.',
        summary: 'Keyboard access, performance, and feedback from early users.',
        detail:
          'Task updates, history loading, and rich rendering have local performance improvements. Installed startup, memory, accessibility, saved-data recovery, and external beta trials remain release work. Required account access in every build, optional settings sync, and feedback flows also need installed-app and delivery checks before wider use.',
      },
    ],
  },
  {
    id: 'next',
    label: 'Up next',
    caption: 'A more capable companion',
    status: 'Planned · Not available yet',
    title: 'Less juggling. More doing.',
    description:
      'Give your agents a better understanding of the work, connect more of your workflow, and make the choices around usage easier to understand.',
    next: 'These priorities will evolve with what we learn from early users.',
    link: { label: 'See today’s connected workspace', href: '/knowledge/' },
    items: [
      {
        title: 'More agents at the table.',
        summary: 'Broader execution support and deeper provider controls.',
        detail:
          'Gemini CLI, Aider, and Goose execution protocols are on the backlog. Account setup and model discovery do not yet mean those agents can run tasks. We also plan richer questions, permissions, and account controls for supported providers.',
      },
      {
        title: 'From an issue to a reviewed change.',
        summary: 'GitHub pull requests, CI checks, and issue intake.',
        detail:
          'We plan guarded GitHub workflows that bring issues, review, and CI evidence closer to the task. Deeper repository understanding and opt-in proactive proposals should help you choose the next useful action, with approval kept explicit.',
      },
      {
        title: 'A clearer picture of your limits.',
        summary: 'Richer usage coverage, measured budgets, and routing guidance.',
        detail:
          'Build on current capacity-aware routing with broader provider reporting and monetary budgets. Reported, estimated, stale, and unavailable usage should remain distinct. Recovery and failover will need clear ownership so unfinished work is never silently replayed.',
      },
    ],
  },
  {
    id: 'horizon',
    label: 'Further out',
    caption: 'Beyond one desktop',
    status: 'Exploring · No committed scope',
    title: 'Your next idea could start anywhere.',
    description:
      'A task shouldn’t lose its thread when you step away. We’re exploring how to bring the same continuity and control to work across machines.',
    next: 'Remote workflows come first; team collaboration follows what proves useful.',
    link: { label: 'Explore the local workflow', href: '/tour/' },
    items: [
      {
        title: 'Your machines, connected.',
        summary: 'Pair a trusted host and keep control of where work runs.',
        detail:
          'Remote execution needs scoped identity, host capabilities, pairing, and safe reconnect behavior. The intention is to dispatch, steer, and review across machines while keeping project and tool permissions understandable. Remote execution is not available today.',
      },
      {
        title: 'Check in from your phone.',
        summary: 'Follow a task, answer a question, or review the next step.',
        detail:
          'A remote companion could keep you connected to work running on a trusted machine. Phone access is exploratory; the interaction, permission model, and delivery are still to be designed.',
      },
      {
        title: 'More ways to work together.',
        summary: 'Shared workflows, team spaces, and hosting choices.',
        detail:
          'We intend to explore team collaboration and managed or self-hosted remote services after validating individual remote workflows. Shared remote workspaces are future work. We have not announced pricing or a release date for these plans.',
      },
    ],
  },
] as const;
