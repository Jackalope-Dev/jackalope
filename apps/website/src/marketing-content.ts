export type MarketingPage = {
  path: string;
  kind: string;
  title: string;
  description: string;
  headline: string;
  lede: string;
  image: 'tasks' | 'review' | 'agents';
  signals: string[];
  sections: Array<{
    title: string;
    paragraphs: string[];
    bullets?: string[];
  }>;
  related: Array<{ href: string; label: string }>;
};

export const marketingPages: MarketingPage[] = [
  {
    path: '/parallel-coding-agents/',
    kind: 'Product guide',
    title: 'Parallel coding agents with one review workflow | Jackalope',
    description:
      'Run Codex, Claude Code, Grok, and OpenCode in parallel Git worktrees while Jackalope keeps project context, progress, and review together.',
    headline: 'Run coding agents in parallel. Keep the work coherent.',
    lede: 'Jackalope is a Windows desktop workspace for assigning focused tasks to Codex, Claude Code, Grok, and OpenCode, following their progress, and reviewing the combined result before integration.',
    image: 'tasks',
    signals: [
      'Multiple agents',
      'Isolated worktrees',
      'Shared project context',
      'Explicit integration',
    ],
    sections: [
      {
        title: 'Parallel work needs more than extra terminals.',
        paragraphs: [
          'Opening several coding-agent sessions is easy. Keeping their briefs, dependencies, questions, changes, and decisions aligned is the harder part. Jackalope turns each outcome into a durable task and keeps related work visible at the project level.',
          'A parallel plan can define focused tasks, file scopes, dependencies, assigned agents, and a concurrency limit. Independent tasks can run at the same time; dependent work waits for the changes it needs to be explicitly integrated.',
        ],
      },
      {
        title: 'Separate the files. Coordinate the decisions.',
        paragraphs: [
          'Each parallel task can receive its own Git worktree and branch, preventing two agents from editing the same checkout. Jackalope also delivers a bounded project briefing and relevant coordination messages so agents can understand related work without treating another task’s message as permission or proof.',
        ],
        bullets: [
          'Choose Codex, Claude Code, Grok, or OpenCode per task.',
          'Keep task questions and follow-up attempts attached to the original outcome.',
          'Pause dispatch without pretending already-running work has stopped.',
          'Inspect each result and the combined patch before changing the target branch.',
        ],
      },
      {
        title: 'Return to one review queue.',
        paragraphs: [
          'A finished response is not the finish line. Jackalope keeps the result, patch, reported checks, evidence, and attempt history together. When several tasks belong together, review preparation checks their current source state and produces a combined result without silently modifying your main checkout.',
          'Jackalope is in prerelease. The website tour uses fictional Atlas project data, and public Windows release acceptance is still in progress.',
        ],
      },
    ],
    related: [
      { href: '/git-worktrees-for-ai-agents/', label: 'Git worktrees for AI agents' },
      {
        href: '/guides/run-codex-and-claude-code-in-parallel/',
        label: 'Run Codex and Claude Code together',
      },
      { href: '/guides/review-ai-generated-code/', label: 'Review agent-generated code' },
    ],
  },
  {
    path: '/git-worktrees-for-ai-agents/',
    kind: 'Workflow guide',
    title: 'Git worktrees for AI coding agents | Jackalope',
    description:
      'Learn how Jackalope uses isolated Git worktrees to run AI coding agents in parallel and guards review, integration, recovery, and cleanup.',
    headline: 'Give every coding-agent task its own Git worktree.',
    lede: 'Worktrees let several coding agents work on one repository without sharing a working directory. Jackalope adds task ownership, review, recovery, and guarded integration around that Git primitive.',
    image: 'review',
    signals: [
      'One task per checkout',
      'Target-branch checks',
      'Combined patch review',
      'Recoverable cleanup',
    ],
    sections: [
      {
        title: 'Why worktrees matter for coding agents.',
        paragraphs: [
          'Two agents in one checkout can overwrite files, change the active branch, or make a clean review difficult. A Git worktree gives each task a separate working directory and branch while sharing the repository’s object database.',
          'Isolation does not eliminate semantic conflicts. Two locally correct patches can still disagree about an API or shared assumption. That is why Jackalope treats the combined review as a separate decision.',
        ],
      },
      {
        title: 'Jackalope owns the task lifecycle around Git.',
        paragraphs: [
          'Jackalope starts from a resolved target commit, records which attempt owns the worktree, and protects active or interrupted work from cleanup. Review preparation rechecks the task source, current changes, target branch, and worktree state before producing an integration result.',
        ],
        bullets: [
          'Dependencies wait for integrated changes, not a successful process exit.',
          'Integration uses explicit review and a fast-forward-only target update.',
          'Dirty or diverged state stops the operation instead of being hidden by an automatic stash or reset.',
          'Recoverable work can be archived before removal when cleanup is explicitly chosen.',
        ],
      },
      {
        title: 'Use worktrees as a boundary, not a guarantee.',
        paragraphs: [
          'File scopes help schedule work and explain ownership, but they are not a filesystem sandbox. Agents still operate under their CLI permissions, and generated code still needs project checks and human review. Jackalope makes those boundaries visible instead of presenting isolation as automatic correctness.',
        ],
      },
    ],
    related: [
      { href: '/parallel-coding-agents/', label: 'Parallel coding agents' },
      { href: '/guides/review-ai-generated-code/', label: 'A practical review workflow' },
      {
        href: '/features/project-context-for-coding-agents/',
        label: 'Project context for every task',
      },
    ],
  },
  {
    path: '/agents/',
    kind: 'Agent compatibility',
    title: 'Coding agents supported by Jackalope: Codex, Claude Code, Grok & OpenCode',
    description:
      'Compare Jackalope support for Codex, Claude Code, Grok, and OpenCode across tasks, project connections, accounts, continuation, and reported usage.',
    headline: 'Bring the coding agents you already use.',
    lede: 'Jackalope works around installed agent CLIs and their provider accounts. Choose an agent per task while keeping the brief, progress, changes, and review in one project workflow.',
    image: 'agents',
    signals: ['Codex', 'Claude Code', 'Grok', 'OpenCode'],
    sections: [
      {
        title: 'One workspace does not mean one provider.',
        paragraphs: [
          'Different tasks benefit from different agents, models, accounts, and tools. Jackalope keeps the task identity stable while allowing each new task to use the configured runner that fits the work.',
          'Agent capabilities are presented explicitly. Codex and Claude Code receive the richest project-connection delivery; Grok supports on-demand discovery through the project bridge; OpenCode uses its own CLI configuration.',
        ],
      },
      {
        title: 'Common workflow, honest capability differences.',
        paragraphs: [
          'All four built-in adapters participate in tasks, follow-up attempts, review, account profiles, and reported task usage where the CLI exposes it. Provider subscriptions, limits, permissions, and data policies still apply.',
        ],
        bullets: [
          'Use named work and personal sign-in profiles for supported agents.',
          'Choose allowed runners and default accounts per project.',
          'Keep continuations on the account that started the attempt.',
          'Treat missing usage reports as unknown, never zero.',
        ],
      },
      {
        title: 'Choose depth over a logo wall.',
        paragraphs: [
          'Jackalope focuses on four verified native adapters instead of claiming universal compatibility. Gemini CLI is being evaluated and will not be listed as supported until its integration is verified.',
        ],
      },
    ],
    related: [
      { href: '/agents/codex/', label: 'Use Codex with Jackalope' },
      { href: '/agents/claude-code/', label: 'Use Claude Code with Jackalope' },
      {
        href: '/guides/run-codex-and-claude-code-in-parallel/',
        label: 'Run Codex and Claude Code in parallel',
      },
    ],
  },
  {
    path: '/agents/codex/',
    kind: 'Agent integration',
    title: 'Run Codex in a desktop project workspace | Jackalope',
    description:
      'Run Codex tasks in isolated Git worktrees with project context, MCP connections, account profiles, reported usage, and review in Jackalope.',
    headline: 'Give Codex a project-aware place to work.',
    lede: 'Use your installed Codex CLI and OpenAI account while Jackalope keeps each task connected to its project, selected tools, worktree, result, and review.',
    image: 'agents',
    signals: ['Installed Codex CLI', 'Project MCP', 'Account profiles', 'Usage windows'],
    sections: [
      {
        title: 'Start Codex with the right project context.',
        paragraphs: [
          'Save project instructions, lessons, and reusable workflows once. For each task, choose the context and project connections that belong with the brief. Jackalope records what was delivered so the result remains inspectable.',
          'Codex supports project-selected stdio and HTTP MCP connections through Jackalope. Existing Codex configuration remains subject to the CLI’s own settings and permissions.',
        ],
      },
      {
        title: 'Keep accounts and attempts attributable.',
        paragraphs: [
          'Create named Codex sign-in profiles, select one for a project, and keep continuations on the account that began the work. Jackalope can display supported account capacity windows and reported task usage without reading private credential files.',
        ],
        bullets: [
          'Run one task directly or assign Codex inside a parallel plan.',
          'Receive project coordination messages during bridged work.',
          'Inspect the result, patch, evidence, and attempt history together.',
          'Export reported usage by project and account profile.',
        ],
      },
      {
        title: 'Codex still owns model access and permissions.',
        paragraphs: [
          'Jackalope does not include an OpenAI subscription or bypass Codex permissions. Availability, model access, connected tools, and provider-side limits remain part of your Codex setup.',
        ],
      },
    ],
    related: [
      { href: '/agents/claude-code/', label: 'Claude Code integration' },
      { href: '/features/project-context-for-coding-agents/', label: 'Project context and tools' },
      {
        href: '/guides/run-codex-and-claude-code-in-parallel/',
        label: 'Codex and Claude Code together',
      },
    ],
  },
  {
    path: '/agents/claude-code/',
    kind: 'Agent integration',
    title: 'Run Claude Code in a desktop project workspace | Jackalope',
    description:
      'Run Claude Code tasks with isolated Git worktrees, project MCP connections, in-app questions, account profiles, usage reporting, and review.',
    headline: 'Keep Claude Code connected to the whole task.',
    lede: 'Use your installed Claude Code CLI and Anthropic account while Jackalope keeps the brief, questions, project tools, worktree, result, and review together.',
    image: 'agents',
    signals: ['Installed Claude Code', 'Project MCP', 'In-app questions', 'Account profiles'],
    sections: [
      {
        title: 'Move from prompt to durable task.',
        paragraphs: [
          'A Jackalope task can launch Claude Code with selected project instructions and tools, surface questions while it runs, and retain follow-up attempts under the same outcome. The task remains understandable after the terminal session ends.',
          'Claude Code supports project-selected stdio, HTTP, and SSE connections through Jackalope. Existing Claude configuration and provider permissions remain in effect.',
        ],
      },
      {
        title: 'Use Claude Code alone or beside another agent.',
        paragraphs: [
          'Assign Claude Code to a focused worktree while Codex, Grok, or OpenCode handles independent work. Jackalope tracks scopes and dependencies, delivers relevant coordination messages, and returns every result to the same review workflow.',
        ],
        bullets: [
          'Create separate named sign-in profiles for work and personal projects.',
          'Keep task continuation tied to its original account profile.',
          'Read reported usage with explicit missing-data coverage.',
          'Review the combined patch before integrating related tasks.',
        ],
      },
      {
        title: 'Bring your existing Anthropic access.',
        paragraphs: [
          'Jackalope does not include Claude model access. Your Claude Code installation, subscription, organization policies, tools, and usage limits continue to govern the agent.',
        ],
      },
    ],
    related: [
      { href: '/agents/codex/', label: 'Codex integration' },
      { href: '/parallel-coding-agents/', label: 'Parallel coding agents' },
      { href: '/guides/review-ai-generated-code/', label: 'Review agent-generated code' },
    ],
  },
  {
    path: '/agents/grok/',
    kind: 'Agent integration',
    title: 'Run Grok coding-agent tasks in isolated worktrees | Jackalope',
    description:
      'Run Grok coding-agent tasks in isolated Git worktrees with project context, on-demand HTTP tool discovery, task history, and review in Jackalope.',
    headline: 'Give Grok focused work without losing the project around it.',
    lede: 'Use your installed Grok CLI and xAI access while Jackalope keeps the task brief, isolated worktree, selected context, result, and review in one durable workspace.',
    image: 'agents',
    signals: ['Installed Grok CLI', 'HTTP tool discovery', 'Isolated attempts', 'Review history'],
    sections: [
      {
        title: 'Keep Grok work bounded and attributable.',
        paragraphs: [
          'Assign Grok a focused outcome inside a standalone task or a parallel plan. Jackalope prepares the worktree, records the selected project context, and keeps follow-up attempts attached to the original request.',
          'Supported HTTP project tools can be discovered on demand. Jackalope does not claim stdio tool delivery, provider usage reporting, or the same account workflow available for every adapter.',
        ],
      },
      {
        title: 'Use the same review boundary across different agents.',
        paragraphs: [
          'A Grok result returns to the same task-aware review flow as Codex, Claude Code, and OpenCode work. You can inspect the exact patch and combine related results deliberately instead of treating a completed process as an accepted change.',
        ],
        bullets: [
          'Run work in a project-owned Git worktree.',
          'Keep task attempts and corrections together.',
          'Coordinate discoveries with related project tasks.',
          'Review before an explicit integration action.',
        ],
      },
      {
        title: 'Bring your existing xAI access.',
        paragraphs: [
          'Jackalope does not include model access or bypass Grok permissions. CLI availability, provider access, configuration, and limits remain part of your Grok setup.',
        ],
      },
    ],
    related: [
      { href: '/agents/', label: 'Compare supported coding agents' },
      { href: '/parallel-coding-agents/', label: 'Coordinate parallel agent tasks' },
      { href: '/guides/review-ai-generated-code/', label: 'Review agent-generated code' },
    ],
  },
  {
    path: '/agents/opencode/',
    kind: 'Agent integration',
    title: 'Run OpenCode tasks in isolated Git worktrees | Jackalope',
    description:
      'Run OpenCode tasks in isolated Git worktrees with project context, task history, coordination, and review while retaining OpenCode CLI configuration.',
    headline: 'Put OpenCode inside a durable project workflow.',
    lede: 'Use your installed OpenCode CLI while Jackalope gives each task a focused worktree and keeps its context, attempts, result, and review attached to the project.',
    image: 'agents',
    signals: [
      'Installed OpenCode CLI',
      'Own CLI configuration',
      'Isolated attempts',
      'Combined review',
    ],
    sections: [
      {
        title: 'Add structure around the agent session.',
        paragraphs: [
          'Launch OpenCode for one task or assign it beside other agents in a plan. Jackalope owns the worktree and task lifecycle while OpenCode continues to use its own CLI configuration and permissions.',
          'Project-selected MCP delivery is not currently enabled for OpenCode. The capability boundary is shown explicitly so adapter breadth does not get confused with feature parity.',
        ],
      },
      {
        title: 'Keep the output connected to its intent.',
        paragraphs: [
          'The brief, attempts, questions, result, patch, and integration decision stay together after the process exits. Related tasks can exchange coordination messages and wait for integrated dependencies rather than process completion alone.',
        ],
        bullets: [
          'Run in a separate project-owned Git worktree.',
          'Continue or correct work under the same task.',
          'Review changes with the requested outcome in view.',
          'Combine selected task results before integration.',
        ],
      },
      {
        title: 'OpenCode remains independently configured.',
        paragraphs: [
          'Jackalope does not bundle provider access or rewrite OpenCode configuration. Models, credentials, tools, permissions, and provider limits remain part of your OpenCode setup.',
        ],
      },
    ],
    related: [
      { href: '/agents/', label: 'Compare supported coding agents' },
      { href: '/git-worktrees-for-ai-agents/', label: 'How task worktrees work' },
      { href: '/features/project-context-for-coding-agents/', label: 'Project context boundaries' },
    ],
  },
  {
    path: '/guides/run-codex-and-claude-code-in-parallel/',
    kind: 'Practical guide',
    title: 'How to run Codex and Claude Code in parallel | Jackalope',
    description:
      'A practical workflow for running Codex and Claude Code in separate Git worktrees, coordinating dependencies, and reviewing their combined changes.',
    headline: 'Run Codex and Claude Code together without sharing a checkout.',
    lede: 'Give each agent a focused outcome, isolate its files in a Git worktree, and make the combined result a deliberate review step.',
    image: 'tasks',
    signals: ['Two focused briefs', 'Two worktrees', 'Visible dependencies', 'One combined review'],
    sections: [
      {
        title: '1. Split the outcome, not the context.',
        paragraphs: [
          'Start with one project goal, then separate work only where the tasks can be reviewed independently. Give Codex and Claude Code concrete outcomes, relevant file scopes, and a shared description of the project constraints.',
          'Use a dependency when one task truly requires another task’s integrated code. Parallel work should not be an excuse to hide ordering assumptions.',
        ],
      },
      {
        title: '2. Launch each task in its own worktree.',
        paragraphs: [
          'Jackalope resolves the target branch and creates isolated workspaces for the assigned agents. Each attempt receives the project briefing, selected context, and supported tools. You can follow progress, answer questions, and stop an individual task without losing the rest of the plan.',
        ],
        bullets: [
          'Use Codex for one reviewable slice and Claude Code for another.',
          'Avoid broad overlapping scopes when the same files or contracts are involved.',
          'Send coordination notes for discoveries that affect related work.',
          'Rerun or continue a task when its result needs correction.',
        ],
      },
      {
        title: '3. Review the combination, not only the parts.',
        paragraphs: [
          'Passing checks in two worktrees does not prove the patches work together. Inspect each result, prepare the combined patch, and run the checks that matter against the integrated state before accepting it.',
          'Jackalope keeps integration explicit and stops when the target or source state has changed. It does not automatically stash, reset, or overwrite unrelated work.',
        ],
      },
    ],
    related: [
      { href: '/agents/codex/', label: 'Codex in Jackalope' },
      { href: '/agents/claude-code/', label: 'Claude Code in Jackalope' },
      { href: '/git-worktrees-for-ai-agents/', label: 'How agent worktrees work' },
    ],
  },
  {
    path: '/guides/review-ai-generated-code/',
    kind: 'Practical guide',
    title: 'How to review AI-generated code before integration | Jackalope',
    description:
      'Review AI-generated code with the original brief, exact patch snapshot, checks, evidence, follow-ups, and combined integration state in view.',
    headline: 'Review the outcome, the evidence, and the exact code together.',
    lede: 'Agent output can sound complete while the code is stale, incomplete, or incompatible with another patch. Jackalope organizes review around the task and the snapshot that produced its evidence.',
    image: 'review',
    signals: ['Original intent', 'Snapshot-bound checks', 'Visible patch', 'Explicit decision'],
    sections: [
      {
        title: 'Begin with the promised outcome.',
        paragraphs: [
          'Read the original task before the summary. Check whether the result satisfies the requested behavior and constraints, rather than accepting a confident completion message as proof.',
          'Jackalope keeps attempts, questions, corrections, and the final result under one task so the reasoning behind a change does not disappear into terminal history.',
        ],
      },
      {
        title: 'Match evidence to the code it describes.',
        paragraphs: [
          'Recorded checks and previews belong to a particular content snapshot. If files change afterward, the earlier evidence becomes stale and the behavior needs to be checked again. Missing evidence stays missing rather than being presented as a pass.',
        ],
        bullets: [
          'Inspect changed files and the patch, not only the agent summary.',
          'Review the commands and outputs that matter for the project.',
          'Try the changed behavior when automated checks cannot establish it.',
          'Ask for a focused correction instead of silently editing around a misunderstood result.',
        ],
      },
      {
        title: 'Review integrations as their own artifact.',
        paragraphs: [
          'Independent patches can conflict semantically even when Git can combine them. Jackalope prepares a combined review from the selected task results and rechecks the source and target state before an explicit integration action.',
        ],
      },
    ],
    related: [
      { href: '/parallel-coding-agents/', label: 'Parallel work in one review queue' },
      { href: '/git-worktrees-for-ai-agents/', label: 'Worktree isolation and integration' },
      {
        href: '/features/project-context-for-coding-agents/',
        label: 'Keep the original context attached',
      },
    ],
  },
  {
    path: '/features/project-context-for-coding-agents/',
    kind: 'Feature',
    title: 'Project context for AI coding agents | Jackalope',
    description:
      'Give coding-agent tasks selected project instructions, lessons, reusable workflows, history, and MCP tools while retaining an inspectable context receipt.',
    headline: 'Carry project knowledge forward without copying it into every prompt.',
    lede: 'Jackalope keeps project instructions, learned constraints, reusable workflows, relevant task history, and supported connections close to the task that needs them.',
    image: 'tasks',
    signals: ['Instructions', 'Lessons', 'Workflows', 'Selected tools'],
    sections: [
      {
        title: 'Context belongs to the project and the task.',
        paragraphs: [
          'Save stable project guidance once, then decide what a new task should receive. Jackalope creates a bounded context receipt so you can inspect the instructions, history, knowledge, and tools that accompanied an attempt.',
          'This is deliberate context assembly, not an unlimited memory claim. Search results and historical material remain bounded, and selected connections are additional to whatever the agent CLI already exposes globally.',
        ],
      },
      {
        title: 'Turn useful work into a repeatable workflow.',
        paragraphs: [
          'A successful task can become a reusable workflow with named inputs and explicit step gates. Future runs keep their own outcomes and evidence instead of flattening repeated work into one opaque automation log.',
        ],
        bullets: [
          'Store project instructions and reviewed lessons separately.',
          'Choose context and tools when composing a task.',
          'Inspect what the agent received after launch.',
          'Keep corrections and continuations attached to the original task.',
        ],
      },
      {
        title: 'Connections remain capability-aware.',
        paragraphs: [
          'Codex and Claude Code support direct project connection delivery. Grok can discover supported HTTP tools on demand, while OpenCode continues to use its own CLI configuration. Jackalope exposes those differences rather than promising identical support.',
        ],
      },
    ],
    related: [
      { href: '/features/recurring-coding-agent-tasks/', label: 'Repeat work with context intact' },
      { href: '/agents/', label: 'Compare agent capabilities' },
      { href: '/blog/from-brief-to-review/', label: 'From brief to review' },
    ],
  },
  {
    path: '/features/recurring-coding-agent-tasks/',
    kind: 'Feature',
    title: 'Recurring AI coding-agent tasks with review history | Jackalope',
    description:
      'Schedule recurring coding-agent work with its project, account, context, missed-run policy, isolated worktree, result, and review history intact.',
    headline: 'Repeat the work. Keep every run reviewable.',
    lede: 'Jackalope recurring tasks preserve the project setup around a task and record each occurrence as its own result instead of hiding repeated work behind a cron expression.',
    image: 'tasks',
    signals: ['Paused by default', 'Project-bound', 'Run history', 'Review-ready notifications'],
    sections: [
      {
        title: 'A schedule should not erase task ownership.',
        paragraphs: [
          'Choose the project, agent, account, execution target, timezone, and missed-run policy for recurring work. Each occurrence uses the guarded task launcher and receives its own attempt, worktree, result, and history.',
          'New schedules begin paused. Jackalope does not wake a closed app or sleeping computer, and it does not silently replay interrupted dispatch after a restart.',
        ],
      },
      {
        title: 'Use repetition where the outcome stays inspectable.',
        paragraphs: [
          'Recurring tasks fit dependency checks, repository audits, documentation refreshes, triage, and other focused work where every run should return evidence for review.',
        ],
        bullets: [
          'Skip or catch up one missed occurrence according to the saved policy.',
          'Prevent a schedule from overlapping its own active or interrupted run.',
          'Link failure and review-ready notifications to the actual occurrence.',
          'Retain reviewed history on disk with bounded loading and restore controls.',
        ],
      },
      {
        title: 'Automation remains a proposal for review.',
        paragraphs: [
          'A scheduled agent response does not prove the result is correct or integrated. Jackalope preserves the same review boundaries used by manually launched tasks.',
        ],
      },
    ],
    related: [
      {
        href: '/features/project-context-for-coding-agents/',
        label: 'Project context and reusable workflows',
      },
      { href: '/guides/review-ai-generated-code/', label: 'Review every generated change' },
      { href: '/parallel-coding-agents/', label: 'Coordinate several tasks' },
    ],
  },
];
