export type GuideCategory =
  | 'workflows'
  | 'architecture'
  | 'routing'
  | 'agents'
  | 'mcp'
  | 'desktop-control'
  | 'troubleshooting'
  | 'themes';

export interface CategoryInfo {
  id: GuideCategory;
  label: string;
  description: string;
}

export const guideCategories: CategoryInfo[] = [
  {
    id: 'workflows',
    label: 'Workflows',
    description: 'Task composer, effort tiers, Pierre diffs, and recurring schedules.',
  },
  {
    id: 'architecture',
    label: 'Git worktrees',
    description: 'Isolated Git worktrees, concurrency locks, and integration safeguards.',
  },
  {
    id: 'routing',
    label: 'Routing & limits',
    description: 'Automatic agent selection, reported quota windows, and bounded handoff.',
  },
  {
    id: 'agents',
    label: 'Agents & Accounts',
    description: 'Supported coding agents, account profiles, and credential storage limits.',
  },
  {
    id: 'mcp',
    label: 'Tools & browser',
    description: 'Central Model Context Protocol broker, tool gating, and headless browser.',
  },
  {
    id: 'desktop-control',
    label: 'Desktop Control',
    description: 'Attempt-scoped window grants, visual status bars, and physical input protection.',
  },
  {
    id: 'troubleshooting',
    label: 'Troubleshooting',
    description: 'Resolving missing PATH, clearing stale Git locks, and history recovery.',
  },
  {
    id: 'themes',
    label: 'Appearance',
    description: 'Color harmonies, 64-step atmosphere, and mascot companion reactions.',
  },
];

export interface TroubleshootingScenario {
  id: string;
  title: string;
  symptom: string;
  quickFix: string;
  targetSlug: string;
  targetAnchor?: string;
}

export const troubleshootingScenarios: TroubleshootingScenario[] = [
  {
    id: 'cli-not-found',
    title: 'CLI executable not found in PATH',
    symptom:
      'Desktop app reports "CLI not found" or "Command failed: codex/claude not recognized".',
    quickFix:
      'Check the installed command in a fresh terminal, verify persistent PATH, and fully restart Jackalope before checking discovery again.',
    targetSlug: 'fixing-cli-path-on-windows',
  },
  {
    id: 'git-locked',
    title: 'Git index or worktree is locked',
    symptom: 'Unable to create or checkout worktree with error "fatal: .git/index.lock exists".',
    quickFix:
      'Identify the affected checkout and confirm lock ownership before changing files. Use the guide to distinguish an index lock from a protected worktree.',
    targetSlug: 'resolving-git-worktree-locks',
  },
  {
    id: 'rate-limit-429',
    title: 'Hit 5-hour quota or HTTP 429 limit',
    symptom: 'Claude Code or Codex halts with rate limit or subscription window exhaustion.',
    quickFix:
      'Automatic tasks can hand off recognized quota failures when enabled and an eligible alternative remains. Explicit assignments stay pinned; inspect capacity before retrying.',
    targetSlug: 'task-routing-and-quotas',
    targetAnchor: 'three-attempt-failover',
  },
  {
    id: 'input-paused',
    title: 'Desktop control paused unexpectedly',
    symptom: 'Status bar displays "Jackalope is Paused" during window automation.',
    quickFix:
      'Physical mouse movement, keyboard touch, or window focus change immediately pauses control for human safety. Click Resume to continue.',
    targetSlug: 'windows-desktop-control',
    targetAnchor: 'physical-interruption',
  },
  {
    id: 'mcp-timeout',
    title: 'MCP tool connection failed or timed out',
    symptom: 'Agent fails to discover or execute tools configured in MCP → Connections.',
    quickFix:
      'Check the executable or endpoint, authentication, and selected agent’s transport support. Then verify a real tool request.',
    targetSlug: 'mcp-and-browser-automation',
    targetAnchor: 'debugging-mcp',
  },
  {
    id: 'interrupted-task',
    title: 'Task abruptly stopped after reboot',
    symptom: 'A running task attempt appears frozen or incomplete following an unexpected restart.',
    quickFix:
      'Saved local journals retain attempt history. Inspect interrupted work before retrying; it is not automatically resumed.',
    targetSlug: 'troubleshooting-and-diagnostics',
    targetAnchor: 'history-recovery',
  },
];

export interface KnowledgeGuideSection {
  id: string;
  question: string;
  paragraphs: string[];
  bullets?: string[];
  steps?: string[];
  links?: { label: string; href: string }[];
  codeBox?: {
    title: string;
    code: string;
  };
  callout?: {
    kind: 'note' | 'tip' | 'important';
    text: string;
  };
}

export interface KnowledgeGuide {
  slug: string;
  category: GuideCategory;
  title: string;
  shortTitle: string;
  description: string;
  readingTime: string;
  sections: KnowledgeGuideSection[];
}

export const knowledgeGuides: KnowledgeGuide[] = [
  {
    slug: 'terminal-command',
    category: 'workflows',
    title: 'Work with Jackalope from the terminal',
    shortTitle: 'Terminal command',
    description:
      'Use the jackalope command to start and rejoin conversations from any Git repository, and move a conversation between the app and your terminal.',
    readingTime: '3 min read',
    sections: [
      {
        id: 'start-terminal',
        question: 'How do I start a conversation from the terminal?',
        paragraphs: [
          'Open a terminal in a Git repository and run jackalope. Describe the work; Jackalope chooses the agent and shows which one it picked and why, the step it is on and the output as it arrives. The repository becomes a project in the app if it was not one already.',
          'The command uses the same sessions, accounts and approved access as the app. Replies go to the same conversation. When an agent asks a question, its choices open in the terminal so you can answer with one keypress. Type /help for commands such as /agent to choose the next agent, /diff to review and commit in the app, /stop and /sessions.',
        ],
        codeBox: {
          title: 'Common commands',
          code: 'jackalope              # start a conversation here\njackalope --continue   # rejoin the latest one here\njackalope ls           # list open conversations\njackalope attach 5cd0  # rejoin by id prefix',
        },
      },
      {
        id: 'not-running',
        question: 'What if Jackalope is not open?',
        paragraphs: [
          'The command asks whether to open the app or run it in the background, and remembers your answer. Running in the background keeps your work available without a window. Opening the app later brings up the same session rather than a second copy.',
          'Leaving the terminal, with /quit or Ctrl+C, does not stop the work. Rejoin it from any terminal or the app.',
        ],
      },
      {
        id: 'app-terminal',
        question: 'Can I use it inside the app or move it to my own terminal?',
        paragraphs: [
          'Choose Terminal in the bottom status bar, or press Cmd+J (Ctrl+J on Windows and Linux), to open the command for the current project in its own window. Open in Terminal continues the same conversation in your system terminal and closes the app window.',
        ],
      },
      {
        id: 'install-command',
        question: 'Why does my shell say the command is not found?',
        paragraphs: [
          'Installed Jackalope adds the command automatically: on macOS and Linux it links ~/.local/bin/jackalope, and on Windows the installer adds its folder to your PATH. Open a new terminal after installing.',
          'The default macOS shell does not search ~/.local/bin. Choose Install command in the app terminal window to add a link in /usr/local/bin; macOS asks for an administrator password.',
        ],
      },
    ],
  },
  {
    slug: 'chat-and-follow-ups',
    category: 'workflows',
    title: 'Continue coding-agent work with chat and follow-ups',
    shortTitle: 'Chat and follow-ups',
    description:
      'Start a chat, queue corrections, pause work, and review a saved result in Jackalope. Recover after a failed attempt or restart.',
    readingTime: '3 min read',
    sections: [
      {
        id: 'start-chat',
        question: 'How do I start a chat in Jackalope?',
        paragraphs: [
          'Open Tasks → Chat, choose your project and agent account, and send the first message. The session keeps its messages and successive batches in one isolated Git workspace. You need approved Jackalope access, a supported installed agent, and a usable provider account to run work.',
          'Describe one observable change and how it should be checked. Use New task for a structured brief or a reviewed plan when the work needs separate assignments. A chat processes batches in order; it is not a parallel plan.',
        ],
        links: [
          { label: 'Set up an agent and account', href: '/knowledge/multi-account-and-agents/' },
        ],
      },
      {
        id: 'queue-correction',
        question: 'Should I queue a message or stop current work?',
        paragraphs: [
          'Queue message saves a correction for the next batch while the current attempt continues. Messages are processed in order in the same workspace and account. Choose Stop and send when the active attempt needs to stop before the correction runs; Jackalope waits for shutdown and saves the message before resuming.',
          'Pause queue prevents later batches from starting. Stop work also stops the active attempt. Ordinary tasks offer Queue follow-up and Stop & send with the same distinction. A failed save keeps the draft so you can recover it.',
        ],
        codeBox: {
          title: 'A focused follow-up',
          code: 'Keep the existing form layout.\nMake each validation error reachable from its input with a screen reader.\nCheck keyboard focus after a failed submission and report the checks you ran.',
        },
      },
      {
        id: 'resume-session',
        question: 'What happens after failure, restart, or closing a popout?',
        paragraphs: [
          'Failures and app restarts pause dispatch. Open the saved chat, inspect the last attempt and any required action, then explicitly resume or retry when the problem is resolved. Queued messages do not silently replay after a restart.',
          'Pop out opens a compact chat window, and its pin keeps that window on top. Closing the popout leaves execution running. Use the task’s stop controls when you want to stop work.',
        ],
        links: [
          { label: 'Diagnose a stopped task', href: '/knowledge/troubleshooting-and-diagnostics/' },
        ],
      },
      {
        id: 'session-limits',
        question: 'Do session limits enforce a spending cap?',
        paragraphs: [
          'No. Optional batch and estimated-cost thresholds pause subsequent batches. A running batch can exceed the threshold. If cost is unavailable and a cost threshold is set, Jackalope pauses further dispatch instead of assuming the work was free. Provider billing and usage limits remain separate.',
        ],
      },
      {
        id: 'review-chat',
        question: 'How do I merge a finished chat?',
        paragraphs: [
          'Pause dispatch, then run or cancel queued messages. Stop any preview before integration. Review the cumulative patch and checks for the latest batch, approve the outcome when it meets your request, and explicitly merge into the intended branch.',
          'Changes since my last review compares files with a saved review position; it does not approve or merge them. After a successful merge, continue in a new chat from the updated branch. The delivered session retains its history and cannot start more work in the old workspace.',
        ],
        links: [{ label: 'Review and merge step by step', href: '/knowledge/review-and-merge/' }],
        callout: {
          kind: 'note',
          text: 'These workflows are implemented in prerelease source. Installed-provider, recovery, and native-window acceptance remain in progress; check Download for platform availability.',
        },
      },
    ],
  },
  {
    slug: 'review-and-merge',
    category: 'workflows',
    title: 'Review, approve, and merge AI-generated changes',
    shortTitle: 'Review and merge AI changes',
    description:
      'Inspect changed files and checks, approve a task outcome, and merge into your target branch. Learn why a merge can be blocked and how to recover.',
    readingTime: '3 min read',
    sections: [
      {
        id: 'review-changes',
        question: 'What should I review before merging an agent’s work?',
        paragraphs: [
          'Review the current patch against the requested behavior, read checks that apply to that patch, and try the changed flow. In Jackalope, open Review and use Changes, Checks, and Merge to inspect each part. Tasks, planned work, and chats use the same review controls.',
          'Search the changed-file list and inspect the full diff, including unexpected files. For planned work, review the combined result under the parent task. A worker’s passing checks do not prove that several changes work together.',
        ],
        steps: [
          'Read the original outcome and any unanswered questions.',
          'Inspect the patch and compare it with the requested scope.',
          'Read the saved check commands, exit results, and output for the current files.',
          'Use a local preview or the application to check behavior the automated checks do not cover.',
          'Request a correction or approve the outcome, then review the separate merge action.',
        ],
        links: [
          {
            label: 'A practical AI code review checklist',
            href: '/blog/review-ai-generated-code-checklist/',
          },
        ],
      },
      {
        id: 'approval-and-markers',
        question: 'Does marking a file reviewed approve the work?',
        paragraphs: [
          'No. File review markers track your place for the displayed patch and reset when it changes. Approve work records acceptance of the task outcome for its snapshot. Merging is a separate action that applies the prepared change to the target branch.',
          'Agent review prepares an editable request for another agent. It runs only after you submit it. Review its findings and check the actual change; an agent response does not replace your acceptance or required project checks.',
        ],
      },
      {
        id: 'commit-hooks',
        question: 'What happens when a commit hook rejects my commit?',
        paragraphs: [
          'Changes explains that a hook stopped the commit, names the hook when it can and keeps its output under a disclosure. Your staged files and message stay as they were.',
          'Choose Fix with agent to send the hook output to an agent that works in the same checkout and branch. Its progress stays on Changes, with Stop and Open task while it runs. When it finishes, review what it changed and choose Commit again.',
        ],
      },
      {
        id: 'blocked-merge',
        question: 'Why is the merge blocked even though the agent finished?',
        paragraphs: [
          'Finishing an attempt does not establish that the result is ready to integrate. Required checks, outcome acceptance, active work, queued messages, a running preview, or changed source and target files can prevent a merge. The diff remains available so you can inspect the work while resolving the blocker.',
        ],
        bullets: [
          'If checks failed, inspect the output and send the relevant failure with a focused follow-up.',
          'If files or the target branch changed, refresh the prepared review and run the required checks on the new result.',
          'For chat, pause dispatch and run or cancel queued messages before preparing integration.',
          'Stop the task’s preview before continuing, merging, or removing its workspace.',
          'Keep unrelated local changes and the source worktree until you have resolved the reported conflict.',
        ],
        links: [
          { label: 'Worktree and integration safeguards', href: '/knowledge/git-worktrees/' },
        ],
      },
      {
        id: 'merge-and-cleanup',
        question: 'What happens after a local merge?',
        paragraphs: [
          'Inspect the target branch, combined patch, checks, and proposed commit message before applying the merge. A successful local merge puts the reviewed change on that branch. Workspace cleanup is explicit. If cleanup fails, retain the receipt and retry cleanup; do not assume the merge itself failed.',
          'A local merge does not push a branch, create a pull request, or deploy. Delivery can read local Git and optional GitHub PR and CI state through your authenticated CLI and prepare an editable next-step draft. Review its destination and effects before starting publication work.',
          'Review and integration safeguards are implemented in prerelease source. Installed-provider and recovery acceptance remain in progress.',
        ],
        links: [
          {
            label: 'Continue a chat after delivery',
            href: '/knowledge/chat-and-follow-ups/#review-chat',
          },
        ],
      },
    ],
  },
  {
    slug: 'ask-jackalope',
    category: 'workflows',
    title: 'Ask Jackalope: help, appearance and local agent tools',
    shortTitle: 'Ask Jackalope',
    description:
      'Use your configured agent to find answers, personalize Jackalope and prepare work. Connect external agents to the same local tools.',
    readingTime: '4 min read',
    sections: [
      {
        id: 'open-helper',
        question: 'How do I use the helper?',
        paragraphs: [
          'Open the Jackalope companion at the bottom right and choose Ask. Ask a question, request an appearance change, or prepare a task. Activity retains notifications, feedback and task shortcuts.',
          'The helper uses your default agent, configured model and active account. Codex, Claude Code, Grok, OpenCode and Kimi Code have helper adapters; unsupported defaults show a configuration message. Messages and shared context go to that provider and may count toward its usage limits. A question can require several model requests as the helper reads tools and documentation.',
          'The helper works without an open project. It uses an app-owned working directory and does not attach repository files. It retains its own local conversation and reported token usage. Stop ends the active response; interrupted requests are never automatically replayed. New conversation archives the previous record locally.',
        ],
      },
      {
        id: 'try-a-question',
        question: 'Try it: ask for a theme preview',
        paragraphs: [
          'Start with a small request whose result you can see. This example uses appearance context and leaves the final choice with you.',
        ],
        steps: [
          'Open the settings button beside Close to review Ask context. Appearance and project context are on by default; saved choices are preserved.',
          'Ask: “Preview a calm dark theme with a blue accent and low atmosphere.”',
          'Read the proposed values and open the preview. Try reading a task and its controls before choosing Keep theme, or cancel to restore your saved choice.',
        ],
        callout: {
          kind: 'tip',
          text: 'If the helper only describes a change, look for an actual proposal before assuming anything changed. For an answer about the app, ask it to cite the bundled guide it used.',
        },
        links: [
          {
            label: 'Understand appearance previews',
            href: '/knowledge/theme-editor-and-atmosphere/',
          },
        ],
      },
      {
        id: 'context',
        question: 'What can the helper read?',
        paragraphs: [
          'Official knowledgebase guides are bundled with the app, so documentation tools work offline. The selected agent still needs its usual provider connection. Answers should cite the source guide; bundled documentation describes that app build and may differ from newer website content.',
          'App version, current screen and agent availability are shared. Helper settings lets you change sharing for appearance and supported preferences, or project names and selected-project task statuses. Both are on by default; saved choices are preserved. Files, paths, task prompts, results, logs and credentials are excluded from this context.',
          'Each question includes up to eight prior replies from the current helper conversation. Turning off context sharing stops new reads; earlier information can remain in conversation history. Start a new conversation to leave that history out.',
        ],
      },
      {
        id: 'actions',
        question: 'What can it change?',
        paragraphs: [
          'Changes appear as proposals for review. An agent cannot claim a proposal was applied. Review the values in the helper, then apply or cancel.',
        ],
        bullets: [
          'Preview light, dark or automatic appearance, accent color, color harmony and atmosphere. Keep theme saves it; closing or canceling the preview restores the saved appearance.',
          'Change companion animation, notification level, operating-system notifications, toolbar theme picker visibility and log auto-scroll. Undo remains available in the current panel while those values have not changed again.',
          'Open Tasks, Agents, configuration, MCP, Usage, settings, recurring tasks, project context and worktrees.',
          'Prepare a task for a shared project. Open draft creates a separate composer draft without overwriting an existing one. Starting work still uses the normal composer and its checks.',
          'Open a shared task or request that it stop through native cancellation. Choose another enabled, installed default agent without changing an active task or its bound account.',
          'Execution permissions, telemetry consent, credentials, filesystem operations, commits, merges and deletion are outside the helper tool surface.',
        ],
      },
      {
        id: 'connect-agent',
        question: 'How do I connect another agent through MCP?',
        paragraphs: [
          'In Helper settings → External agent connection, choose Connect an external agent, then Copy MCP connection. The copied JSON contains a Streamable HTTP URL on 127.0.0.1 and a bearer credential. Configure it in a compatible local MCP client; clients have different configuration formats.',
          'The copied mcpServers entry can be used with Claude Code HTTP MCP configuration. For Codex, use the URL as the server url and supply the bearer credential through an environment variable named by bearer_token_env_var. Keep the credential out of repository files and shared messages.',
          'Access expires after one hour, when you disconnect, or when Jackalope closes. Enabling a new connection replaces the old credential. A remote cloud agent cannot reach this loopback endpoint directly. There is no public remote management endpoint.',
          'Connected agents can read only the context selected in the helper and can propose actions for review there. The app must be running; fresh app context requires an open workspace. Requests from browser origins are rejected. This is not a security boundary against another process running as the same OS user.',
        ],
      },
      {
        id: 'tool-reference',
        question: 'Which tools are available?',
        paragraphs: [
          'The local MCP server exposes the following tools. set_theme, set_preferences, navigate and prepare_task return proposal IDs; get_action reads the current status and actual application result.',
        ],
        bullets: [
          'search_docs(query), read_doc(slug)',
          'get_app_context(), get_preferences(), list_agents(), list_projects(), list_tasks()',
          'set_theme(scope, appearance?, accent?, harmony?, atmosphere?)',
          'set_preferences(notifications?, mascot_animations?, show_theme_picker?, auto_scroll_logs?, os_notifications?)',
          'navigate(destination), prepare_task(project_id, prompt), get_action(id)',
          'open_task(run_id), stop_task(run_id), set_default_agent(agent)',
        ],
      },
    ],
  },
  {
    slug: 'git-worktrees',
    category: 'architecture',
    title: 'Work on separate branches with Git worktrees',
    shortTitle: 'Git worktrees',
    description:
      'How Jackalope uses native Git worktrees to isolate parallel coding agents, prevent dirty checkout collisions, and enforce guarded fast-forward integration.',
    readingTime: '3 min read',
    sections: [
      {
        id: 'why-worktrees',
        question: 'Why use Git worktrees for parallel tasks?',
        paragraphs: [
          'Separate worktrees give independent tasks their own files, index, and branch while sharing the repository’s Git object database. Each checkout still uses disk space for working files, dependencies, and build output.',
          'Choose an isolated worktree for independent work or use the current checkout deliberately. Worktrees do not sandbox processes: agents retain their local permissions, and shared services, ports, and external resources can still conflict.',
        ],
      },
      {
        id: 'parallel-example',
        question: 'Try it: separate two independent changes',
        paragraphs: [
          'Suppose one task adds an empty state while another updates API documentation. Give each task its own worktree and identify its intended files. If the documentation needs an API change from the first task, record that dependency instead of starting both against an outdated interface.',
        ],
        steps: [
          'Check the project branch and its uncommitted changes. Choose the intended starting state for each task.',
          'Describe each outcome and select a separate worktree. Tell the tasks about shared services or files that could still collide.',
          'Review each result and its checks, then prepare the combined patch in Review & merge. Run the checks needed for the combined result before merging.',
          'Keep the worktrees until the integrated result is verified. Review their remaining files before choosing cleanup.',
        ],
        links: [
          {
            label: 'Diagnose a blocked worktree',
            href: '/knowledge/resolving-git-worktree-locks/',
          },
          {
            label: 'Write a task with clear acceptance checks',
            href: '/knowledge/task-composer-and-effort-levels/',
          },
        ],
      },
      {
        id: 'concurrency-collisions',
        question: 'How does Jackalope coordinate parallel work?',
        paragraphs: [
          'New tasks can recommend focused work, investigation, or a reviewed plan using the project’s Decisions preference. Create a plan uses your selected development agent and its normal capacity. Review the concrete assignments before starting; one parent keeps planning, worker attempts, usage, and the combined result together.',
          'Parallel plans record task scopes, dependencies, and a concurrency limit. The coordinator reserves work before launching an agent; dependencies wait for the changes they need to be integrated.',
          'New managed plans combine groups of completed assignments while other work continues. Shared contracts have one owner or an explicit dependency. Jackalope resolves overlaps in a separate workspace and checks the combined result before handing it to dependent work or final review.',
          'Plan, Work, Check and Review keep the complete result, preview and checks together. Work details expands individual assignments. A failed check can receive up to two automatic repair attempts; a correction authorizes a fresh allowance. If more help is needed, the task keeps the result and offers a correction or another repair. Provider failures and interrupted processes require explicit recovery.',
          'Pause dispatch holds pending work; Stop task also stops active attempts. Restart leaves dispatch paused. Review the final outcomes and combined changes before Apply changes to the target branch. Cleanup follows your selected apply option; the app does not push the changes.',
          'Time and usage includes all attempts and repairs. Focused review counts a visible result window with focus; elapsed delivery time also includes waiting. These measurements do not guarantee savings or establish that someone was actively reading.',
          'Retries can use a fresh worktree. Interrupted work retains its history and ownership information instead of being silently relaunched. Pause stops new dispatch; use Stop for an active task.',
        ],
      },
      {
        id: 'guarded-integration',
        question: 'What happens before changes enter the target branch?',
        paragraphs: [
          'Open Review & merge, select finished tasks, and prepare their combined patch. Inspect the results, changes, and saved checks before choosing Merge tasks into the target branch.',
          'Applying the review rechecks source and target state, dirty files, and saved evidence, then uses a guarded fast-forward. It does not automatically stash, push, or remove task worktrees. A prepared patch does not prove that the combined code builds.',
        ],
      },
      {
        id: 'worktree-cleanup',
        question: 'How do I remove completed worktrees?',
        paragraphs: [
          'Open Project → Worktrees and choose a cleanup action. Integration and task archival do not automatically delete the worktree. Active or interrupted ownership, locks, submodules, and mismatched Git registrations can block removal.',
          'Archive & remove preserves recoverable commits, tracked changes, and untracked non-ignored files before removing an eligible worktree. Review ignored-file handling separately. Prune missing worktrees removes registrations for folders that are already gone.',
        ],
      },
      {
        id: 'manual-worktree-commands',
        question: 'How can I inspect worktrees from a terminal?',
        paragraphs: [
          'Use read-only Git commands to identify the checkout and its changes before choosing cleanup. Check active tasks and archive anything you need to keep.',
        ],
        codeBox: {
          title: 'Inspect a worktree',
          code: 'git worktree list\ngit -C .worktrees/task-auth-flow status --short\ngit -C .worktrees/task-auth-flow log -5 --oneline',
        },
      },
    ],
  },
  {
    slug: 'task-routing-and-quotas',
    category: 'routing',
    title: 'Choose agents and handle usage limits',
    shortTitle: 'Routing & usage limits',
    description:
      'Choose eligible agents using reported capacity, preserve work during quota handoff, and understand pinned tasks and limits.',
    readingTime: '3 min read',
    sections: [
      {
        id: 'lock-hierarchy',
        question: 'How does Jackalope coordinate task execution?',
        paragraphs: [
          'The native coordinator reserves tasks before launch and shares execution guards with the runtime. Routing model calls run outside these locks so other desktop operations can continue.',
          'Task history is saved locally in versioned JSON journals with atomic writes. Interrupted attempts remain visible after restart; they are not automatically replayed.',
        ],
      },
      {
        id: 'routing-subprocess',
        question: 'How does automatic agent selection work?',
        paragraphs: [
          'Settings → Decisions chooses local rules, agent-powered reasoning, or Jev-assisted decisions. Projects inherit the app default unless you override it. Automatic tasks select among eligible agents, configured models, and permitted accounts. Project restrictions, tool compatibility, and reported capacity constrain the options.',
          'Local rules use preferences and current capacity without a model call. Agent-powered routing uses your default agent. Optional Jev uses your TypeSafe key and may reduce routing cost and latency; savings are not guaranteed. Jackalope validates the decision and saves its reason and any reported usage. For Jev uncertainty or service errors, choose Local (the default, with no extra model cost) or Agent-powered fallback, which uses agent tokens or subscription capacity. If that agent attempt fails, local rules take over. Codex, Claude Code, Grok, OpenCode, and Kimi Code can coordinate; Antigravity and Gemini CLI run as workers. Explicit assignments remain available.',
          'Under Routing goals and optional assistance, choose Quality first, Balanced or Economical. Cost-aware choices need sufficient relevant history with complete recorded costs; otherwise quality ranking stays in place. You can add sourced facts for exact models. Unknown capabilities and costs remain unknown.',
          'Additional Jev helpers are off by default. Enable relevant context selection, failure categories, requirement coverage, review priorities, unrelated-change filtering or Automatic assignment matching per app or project. These calls may send guidance, candidate lessons, diffs, results and check output to TypeSafe and have separate API costs. Advice cannot approve work, change explicit assignments or retry a denied action. Usage lists their purposes separately, including calls that launched no worker.',
          'Task assessments use the same project preference. Local fast paths and unchanged recent requests avoid model calls; other eligible requests make one bounded assessment, with one extra agent attempt only when you select that Jev fallback. Both provider attempts remain visible in Usage. Jev classifies the approach but cannot generate or authorize a plan. Usage lists assessment calls separately, including calls that never launched a task, and counts reused assessments once. Real-provider cost and quality comparisons remain open.',
        ],
      },
      {
        id: 'quota-headroom-admission',
        question: 'How does Jackalope use account capacity reports?',
        paragraphs: [
          'Codex, Claude Code, and Grok capacity readers use their installed CLIs. Reported windows, reset times, and coverage vary by provider; missing or stale capacity is not unlimited quota.',
          'Automatic admission leaves a 10-percentage-point reserve in the limiting reported window and accounts for estimated reservations from other local tasks sharing the pool. These estimates reduce risk but cannot prevent provider throttling or account use elsewhere. Monetary budgets are not implemented.',
        ],
      },
      {
        id: 'three-attempt-failover',
        question: 'What happens when an automatic task runs out of quota?',
        paragraphs: [
          'With automatic quota handoff enabled, a recognized provider quota error can trigger another eligible worker. Ordinary test failures and assistant prose do not trigger handoff.',
          'Jackalope stops the owned worker, retains the same attempt and worktree, and supplies progress context to the replacement. It excludes the exhausted account or quota pool and allows at most three handoffs.',
          'If no eligible alternative remains, routing fails, or the handoff limit is reached, work stops with an actionable error and preserves progress. Handoff is not a guarantee of uninterrupted completion.',
        ],
      },
      {
        id: 'task-pinning',
        question: 'What happens to explicitly assigned tasks and continuations?',
        paragraphs: [
          'An explicitly chosen agent stays pinned, as does a continuing session. Quota exhaustion does not silently switch its provider or account. Inspect the error and capacity before retrying; use a new task when a different account is needed.',
        ],
      },
      {
        id: 'capacity-check',
        question: 'What should I do when a task cannot start?',
        paragraphs: [
          'Separate an unavailable worker from an exhausted account. An installed agent can still be excluded by project settings, a missing tool transport, an expired sign-in, or a reported quota window.',
        ],
        steps: [
          'Open the task and read the routing or launch error. Check whether the assignment is Automatic or explicitly pinned.',
          'Check the selected account and its reported capacity. A reset time only describes the provider’s reported window; it does not reserve future capacity.',
          'Review project agent, model, and account restrictions. If the task needs MCP tools, check that the candidate adapter supports their delivery.',
          'Retry after correcting the cause. For a pinned session, create a new task if you deliberately want another account; review and preserve existing work first.',
        ],
        links: [
          {
            label: 'Repair the correct account profile',
            href: '/knowledge/multi-account-and-agents/',
          },
          {
            label: 'Check tool delivery by agent',
            href: '/knowledge/mcp-and-browser-automation/',
          },
        ],
      },
    ],
  },
  {
    slug: 'multi-account-and-agents',
    category: 'agents',
    title: 'Set up agents and account profiles',
    shortTitle: 'Agents & accounts',
    description:
      'Set up supported agent CLIs, choose project accounts, and understand credential storage limits.',
    readingTime: '3 min read',
    sections: [
      {
        id: 'supported-adapters',
        question: 'Which coding agents can run tasks?',
        paragraphs: [
          'Codex, Claude Code, Grok Build, OpenCode, Kimi Code, Antigravity, and Gemini CLI have native task adapters. For DeepSeek and other supported API providers, use Connect an API provider in Agents: Jackalope prepares a private OpenCode runner, saves your protected key and discovers models. No separate OpenCode installation or account is needed. Other agents use their installed CLIs. Model access, permissions, and billing remain with your provider.',
          'Kimi Code uses kimi for tasks, routing, and Ask Jackalope. Antigravity uses agy for worker tasks. Gemini CLI runs worker tasks with automatic file-edit approval and saved-session continuation; shell tools require the CLI’s own permission policy. Discovery of an executable is not proof of valid authentication.',
        ],
      },
      {
        id: 'kimi-code',
        question: 'What does Kimi Code support?',
        paragraphs: [
          'Install the current Kimi Code CLI and select Kimi in Agents → Configuration. Use kimi login for the default account or Add account & sign in for a separate profile. Named profiles use KIMI_CODE_HOME for configuration, sign-in data, and sessions; migrate legacy Python CLI setups before using them.',
          'Kimi tasks stream text and tool activity, offer the CLI’s tool approval choices and structured questions, and continue the exact saved session with its original account. Declining or leaving an approval unanswered stops the attempt. Selected models come from the account’s CLI session configuration.',
          'Kimi supports automatic routing and Ask Jackalope with tools disabled for those requests. Worker token usage uses session-total deltas; cache breakdown, cost, and helper tokens remain unknown. Membership quota requires a managed Kimi account with a current login. Detection and authentication checks do not establish signed-in execution or installed-app acceptance.',
        ],
        links: [
          { href: '/agents/kimi-code/', label: 'Kimi Code setup, project tools, and limits' },
        ],
      },
      {
        id: 'first-account',
        question: 'How do I check a new account before using it?',
        paragraphs: [
          'Use a small task in a project that is appropriate for the account. This helps distinguish CLI discovery, successful sign-in, and the ability to run your chosen model.',
        ],
        steps: [
          'Install the agent CLI and open Agents → Configuration. Select the agent and the intended default or named account.',
          'Complete that profile’s sign-in or key setup. Review provider billing and model access for the selected account.',
          'Choose the account in the project settings, then create an explicitly assigned task: “Read the project instructions and summarize how to run the tests. Do not change files.”',
          'Inspect the bound agent/account and the result. If access fails, repair that same profile before trying a larger task.',
        ],
        links: [
          {
            label: 'Fix an executable Jackalope cannot find',
            href: '/knowledge/fixing-cli-path-on-windows/',
          },
          {
            label: 'Use automatic routing after setup',
            href: '/knowledge/task-routing-and-quotas/',
          },
        ],
      },
      {
        id: 'work-personal-segregation',
        question: 'How do work and personal account profiles differ?',
        paragraphs: [
          'Named Codex, Claude Code, Grok, OpenCode, and Kimi Code profiles use separate supported CLI directories. Choose project defaults in Project → Settings. Continuations retain their bound profile.',
          'Antigravity named profiles require Gemini API keys with separate API billing. Its existing subscription login is shared and can change outside Jackalope. Profiles organize credentials; they do not isolate OS permissions or inherited provider configuration.',
        ],
      },
      {
        id: 'keychain-storage',
        question: 'Where are credentials stored?',
        paragraphs: [
          'Provider CLI sign-ins remain owned by the CLI and its selected profile. Jackalope does not replace each CLI’s credential storage with a universal keychain.',
          'Jackalope-managed agent keys use Windows DPAPI or owner-only files on Unix. The hosted Jackalope account credential has a separate storage contract. Native secure storage and release acceptance on macOS and Linux remain open; do not assume all secrets use those platforms’ keychains.',
          'Agents authenticate with their providers and may send task context under your provider settings. Review the provider and connected tool policies before using sensitive projects.',
        ],
      },
      {
        id: 'credential-drift',
        question: 'How do I recover from an expired agent sign-in?',
        paragraphs: [
          'Open Agents → Configuration and select the affected account. Complete its sign-in flow, using Copy link or Open browser if needed. Check the same profile that the task uses; signing in to the default CLI account does not repair a separate named profile.',
          'Some adapters validate access only when launched. A detected executable or saved credential does not prove the provider will accept the next request.',
        ],
      },
      {
        id: 'execution-boundaries',
        question: 'What do project restrictions control?',
        paragraphs: [
          'Project settings constrain agent, model, account, and selected tool choices within Jackalope. Task settings can narrow the project connections supplied to an agent.',
          'These controls do not create an OS sandbox or a network firewall. CLI-global tools, inherited environment variables, plugins, and local file permissions still apply.',
        ],
      },
    ],
  },
  {
    slug: 'mcp-and-browser-automation',
    category: 'mcp',
    title: 'Use project tools and the built-in browser',
    shortTitle: 'Tools & browser automation',
    description:
      'Choose tools for a task, check agent compatibility, and inspect browser results with useful evidence.',
    readingTime: '3 min read',
    sections: [
      {
        id: 'central-broker',
        question: 'How are project MCP tools delivered?',
        paragraphs: [
          'Configure connections in MCP → Connections and select the project tools for a task. Codex supports direct stdio and HTTP connections; Claude Code also supports SSE.',
          'Supported task adapters offer on-demand discovery for stdio and HTTP connections. Grok, Antigravity, and Gemini CLI use an HTTP bridge and need permission for an HTTP client. Direct delivery supports Codex, Claude Code, OpenCode, and Kimi Code; CLI-global tools still use the agent’s own configuration.',
        ],
      },
      {
        id: 'tool-gating',
        question: 'How do I limit the tools supplied to a task?',
        paragraphs: [
          'Select the project connections needed for the work and review task overrides under Customize task. On-demand discovery exposes eligible connections through the task’s authenticated bridge.',
          'Task selection does not remove tools configured globally in a CLI. Effort levels do not grant or revoke tool access, and there is no universal per-tool Allowed / Ask / Blocked policy.',
        ],
      },
      {
        id: 'browser-engine',
        question: 'What can the built-in browser do?',
        paragraphs: [
          'Jackalope bundles agent-browser and launches installed Edge or Chrome with a fresh task profile. No separate agent-browser installation or cloud browser subscription is required.',
          'Agents can navigate, inspect accessibility snapshots, fill forms, press keys, manage tabs, change viewport and appearance, inspect console errors, run accessibility audits, and save screenshot evidence. Sessions close on stop, completion, or app shutdown.',
          'The seven tools are browser_navigate, browser_snapshot, browser_interact, browser_configure, browser_inspect, browser_tabs, and browser_screenshot. Arbitrary JavaScript evaluation, persistent browser sign-ins, and uploads are not exposed. Automated audits supplement manual accessibility checks.',
        ],
      },
      {
        id: 'browser-check-example',
        question: 'Try it: verify a local page with browser evidence',
        paragraphs: [
          'Start the project’s development server and include its exact local URL in the task. A fresh browser profile will not carry over sign-ins from your personal browser. Use a page and test data the task can access.',
          'Review which URL and state each screenshot represents. A picture of a success message proves the rendered state; verifying delivery, persistence, or a backend side effect requires separate evidence. If the server is unreachable, fix the preview before treating the page as tested.',
        ],
        codeBox: {
          title: 'Example browser-check brief',
          code: 'Open the local preview URL I provide. Check the sign-up form at desktop and narrow widths.\nUse test data to trigger required-field and invalid-email errors.\nCheck labels, keyboard navigation, visible focus, and console errors.\nSave screenshots of the observed states and report what passed, failed, or could not be checked.\nDo not submit a real registration.',
        },
        links: [
          {
            label: 'Add a project MCP connection',
            href: '/knowledge/connecting-custom-mcp-servers/',
          },
          {
            label: 'Use a native Windows window instead',
            href: '/knowledge/windows-desktop-control/',
          },
        ],
      },
      {
        id: 'question-bridge',
        question: 'How can agents ask for input?',
        paragraphs: [
          'Supported task tools let an agent submit a question and read the saved answer. Jackalope displays the question in the task so you can respond with a choice or text.',
          'Delivery differs by adapter. This does not suspend every agent process or answer arbitrary CLI permission dialogs; agents must use a supported question flow.',
        ],
      },
      {
        id: 'debugging-mcp',
        question: 'Where do I configure and diagnose connections?',
        paragraphs: [
          'Open MCP → Connections. Check the command and arguments for stdio, or the endpoint and transport for a remote server. Verify that the selected agent supports that transport.',
          'Use the connection probe for configured header or environment authentication. CLI-owned OAuth sessions must be checked in that CLI and account profile. A successful probe does not establish that every task can use the tool.',
        ],
      },
    ],
  },
  {
    slug: 'windows-desktop-control',
    category: 'desktop-control',
    title: 'Let an agent work in a Windows app',
    shortTitle: 'Windows desktop control',
    description:
      'Select a window for a task, understand its control status, and pause or cancel when you need your computer.',
    readingTime: '2 min read',
    sections: [
      {
        id: 'window-grants',
        question: 'How do window grants work?',
        paragraphs: [
          'On Windows, explicitly select an application window for the current task attempt. Jackalope’s desktop tools check that grant before accessibility reads, captures, and native input.',
          'These grants control Jackalope’s desktop tools, not the agent’s other local capabilities. Desktop control operates the live user session and does not create an OS sandbox. This guide covers Windows. macOS, Linux X11 and GNOME 46 Wayland backends require platform acceptance before release; GNOME Wayland also requires the Jackalope Window Control extension. Other Wayland and headless Linux sessions are unsupported.',
        ],
      },
      {
        id: 'visual-indicators',
        question: 'What visual indicators show that Jackalope is interacting with a window?',
        paragraphs: [
          'Whenever an agent is actively controlling a granted window, Jackalope renders a high-visibility, top-centered status bar above your display, accompanied by a broad theme-colored perimeter glow around the active window.',
          'The status bar explicitly announces "Jackalope is using your computer" and provides prominent, one-click Pause and Cancel buttons. You are never left wondering if an agent is currently controlling the machine.',
        ],
      },
      {
        id: 'physical-interruption',
        question:
          'How do physical interruptions (mouse movement, focus loss, Escape) pause control?',
        paragraphs: [
          'Human safety overrides agent automation at all times. Jackalope installs native low-level hardware hooks that monitor physical input devices.',
          'If you move your physical mouse, touch the keyboard, switch active window focus, or press the physical Escape key, Jackalope instantly revokes the agent’s input lease and halts interaction.',
        ],
        bullets: [
          'Physical mouse movement immediately transitions automation into the Paused state.',
          'Pressing the Escape key immediately cancels the active desktop control lease.',
          'Window focus loss or minimize events pause execution until you explicitly review and click Resume.',
          'Resuming requires taking a fresh visual snapshot to prevent stale-state misclicks.',
        ],
      },
      {
        id: 'input-leasing',
        question: 'Can two tasks control the desktop at once?',
        paragraphs: [
          'Only one task can hold Jackalope’s desktop input lease at a time. A conflicting request cannot take over the active lease. Stop or cancel the current grant before granting another task control.',
        ],
      },
      {
        id: 'first-window-task',
        question: 'How do I start and check a window task?',
        paragraphs: [
          'Begin with an inspection task, such as reading the labels in a sample app. Browser pages usually fit the built-in browser tools; native desktop control is for an explicitly selected Windows application window.',
        ],
        steps: [
          'Open the application in your Windows session and select its window for the current task attempt. State the intended action and anything that requires your review.',
          'Keep the target visible and watch the control status. If you need the computer, pause or cancel through the status bar.',
          'After an interruption, review the current window before resuming. The agent needs a fresh snapshot because the UI may have changed.',
          'Read the task result and inspect the application itself. A completed input action is not proof that an external service accepted or saved it.',
        ],
        links: [
          {
            label: 'Run a browser-only check',
            href: '/knowledge/mcp-and-browser-automation/',
          },
        ],
      },
    ],
  },
  {
    slug: 'troubleshooting-and-diagnostics',
    category: 'troubleshooting',
    title: 'Find the cause of a stopped or failed task',
    shortTitle: 'Troubleshooting & diagnostics',
    description:
      'Narrow a failure to setup, routing, execution, or recovery, then collect the right evidence for support.',
    readingTime: '2 min read',
    sections: [
      {
        id: 'missing-cli-path',
        question: 'Did the task fail before the agent started?',
        paragraphs: [
          'Read the first launch error. “Executable not found” points to installation or discovery; an authentication error points to the selected account; a capacity or eligibility message points to routing. Repeated retries will not fix a missing executable or an expired sign-in.',
        ],
        links: [
          {
            label: 'Follow the Windows CLI discovery steps',
            href: '/knowledge/fixing-cli-path-on-windows/',
          },
          {
            label: 'Check account sign-in',
            href: '/knowledge/multi-account-and-agents/',
          },
          {
            label: 'Inspect routing and capacity',
            href: '/knowledge/task-routing-and-quotas/',
          },
        ],
      },
      {
        id: 'stale-git-locks',
        question: 'Did workspace preparation fail?',
        paragraphs: [
          'Check the task’s target checkout and the exact Git error. A lock, a dirty target, and a branch mismatch require different fixes. Preserve changes and inspect worktree ownership before attempting cleanup.',
        ],
        links: [
          {
            label: 'Locate and diagnose a Git lock',
            href: '/knowledge/resolving-git-worktree-locks/',
          },
          {
            label: 'Understand integration and cleanup checks',
            href: '/knowledge/git-worktrees/',
          },
        ],
      },
      {
        id: 'execution-failure',
        question: 'The agent ran, but the task failed. What evidence helps?',
        paragraphs: [
          'Find the earliest substantive error in the result or command output. Later failures may only be consequences: for example, a test command cannot assess the code if dependencies never installed.',
        ],
        bullets: [
          'Record the failing command, its working directory, exit status, and relevant error. Distinguish “could not run” from a test assertion failure.',
          'Check which files changed before retrying. An unsuccessful task may still have useful work or an unfinished edit.',
          'For browser or MCP failures, record the connection, requested action, and observed error. Remove tokens, private URLs, and personal data from anything you share.',
          'For support, explain the expected result, what actually happened, and the smallest steps that reproduce it. Include the app version from the support report.',
        ],
      },
      {
        id: 'history-recovery',
        question: 'What happens to task history after an unexpected shutdown?',
        paragraphs: [
          'Jackalope saves task records in local versioned JSON journals with atomic replacement. On restart, unfinished attempts are marked interrupted and their saved history remains available. Unreadable files are preserved for recovery.',
          'Interrupted attempts are not automatically replayed or resumed because process ownership may be uncertain. Inspect the task and worktree before retrying. Settings → Data & reset can restore archived history or import a task recovery export.',
        ],
      },
      {
        id: 'app-updates',
        question: 'How does Jackalope update itself?',
        paragraphs: [
          'Installed Jackalope checks for updates shortly after it opens and every few hours while its window is in use. When a newer version is ready, the companion shows a notice; choose Review update, then install and restart when your work is saved. Nothing installs without your choice.',
          'In Settings → Updates & support you can check now, turn automatic checks off and, when offered, choose the Stable or Beta update channel. If a check fails, the notice shows the reason.',
        ],
      },
      {
        id: 'diagnostic-bundles',
        question: 'How do I prepare a support report?',
        paragraphs: [
          'In Settings → Updates & support, choose Preview support report. It shows app version, OS, and task outcome counts, excluding account names, credentials, project paths, prompts, code, and command output.',
          'Add reproduction details, then choose Copy report and feedback. Review your own text for sensitive information before sharing. Copying the report does not send it.',
        ],
      },
      {
        id: 'verification-checklist',
        question: 'What should I check before requesting support?',
        paragraphs: [
          'Check that the CLI works in a terminal, inspect git status and git worktree list, and review the selected profile in Agents → Configuration. Check Settings → Updates & support for update information. Include the actual error and reproduction steps in your report.',
        ],
      },
    ],
  },
  {
    slug: 'fixing-cli-path-on-windows',
    category: 'troubleshooting',
    title: 'Fix “CLI not found” on Windows',
    shortTitle: 'Fix CLI discovery',
    description:
      'Fix Windows CLI detection for Codex, Claude Code, Grok, OpenCode, Kimi Code, and Antigravity with PATH checks and restart steps.',
    readingTime: '2 min read',
    sections: [
      {
        id: 'root-cause',
        question: 'Why does a CLI work in my terminal but fail inside the desktop app?',
        paragraphs: [
          'A running app keeps the environment it inherited when it started. Installing a CLI or changing PATH does not update every already-running process. A terminal may also define a shell alias or profile command that is unavailable to Jackalope’s process runner.',
          'First check from a newly opened, non-administrator PowerShell window under the same Windows account. Locate the real executable or command shim, not just an alias. If the command fails there too, repair the CLI installation before troubleshooting Jackalope.',
        ],
        codeBox: {
          title: 'Find the command in a fresh PowerShell window',
          code: 'Get-Command codex -All | Select-Object CommandType, Source\nwhere.exe codex\n# Replace codex with the CLI you installed.',
        },
      },
      {
        id: 'npm-global-path',
        question: 'How do I check the installed command directory?',
        paragraphs: [
          'Use the installation method you actually chose. For npm, inspect its configured global prefix; for another installer, locate its executable directory. Do not add every common package-manager directory just in case.',
          'Open Windows “Edit environment variables for your account”, edit the User Path, and add the verified directory if it is missing. Keep existing entries. The commands below inspect values; they do not change PATH.',
        ],
        codeBox: {
          title: 'Inspect npm and User PATH',
          code: 'npm config get prefix\n[Environment]::GetEnvironmentVariable("Path", "User") -split ";"',
        },
      },
      {
        id: 'desktop-refresh',
        question: 'How do I verify the repair?',
        paragraphs: [
          'Save work before restarting the app. Closing a terminal alone does not refresh Jackalope’s inherited environment.',
        ],
        steps: [
          'Fully quit Jackalope, including its tray instance, and reopen it after saving the persistent PATH change.',
          'Check discovery in Agents → Configuration. If the app still inherits an old environment, save your other work and sign out of Windows, then sign back in.',
          'Select the intended account and run a small task. If discovery succeeds but the provider rejects the request, continue with account setup rather than changing PATH again.',
        ],
        links: [
          {
            label: 'Validate the account after discovery',
            href: '/knowledge/multi-account-and-agents/',
          },
        ],
      },
    ],
  },
  {
    slug: 'resolving-git-worktree-locks',
    category: 'troubleshooting',
    title: 'Resolve a Git lock without losing work',
    shortTitle: 'Resolve Git locks',
    description:
      'How to safely diagnose, remove, and prevent stale Git index locks and orphaned worktrees left by abnormal system termination.',
    readingTime: '2 min read',
    sections: [
      {
        id: 'what-are-git-locks',
        question: 'What causes "Unable to create .git/index.lock: File exists" errors?',
        paragraphs: [
          'Git uses lockfiles while updating repository data. A lock may mean an operation is still active; after an interrupted write, a stale file may remain. The exact error identifies which operation and path were blocked.',
          'An index.lock and a locked worktree registration are different. A registration can be deliberately locked to protect a checkout on a temporarily unavailable drive. The existence or age of a lock alone does not establish that it is safe to remove.',
        ],
      },
      {
        id: 'step-by-step-unlock',
        question: 'How do I diagnose a Git lock safely?',
        paragraphs: [
          'Inspect the affected checkout with git status and git worktree list. Confirm that no task, editor, or Git process is still using it before changing lock files. A linked worktree’s .git may be a file, not a directory.',
          'Use git rev-parse --git-path index.lock from that checkout to locate its index lock. Remove only a lock you have confirmed is stale. Worktree locks can be intentional; do not bulk-delete locks or force-remove a checkout to clear an error.',
        ],
        codeBox: {
          title: 'Locate the affected lock',
          code: 'git status --short\ngit worktree list\ngit rev-parse --git-path index.lock',
        },
      },
      {
        id: 'preventing-locks',
        question: 'How can I reduce file contention?',
        paragraphs: [
          'Avoid overlapping Git operations in the same checkout. Close tools holding the affected files after saving work, then retry. Keep independent tasks in separate worktrees and investigate recurring errors before changing system settings.',
        ],
      },
      {
        id: 'after-unlock',
        question: 'What should I check after resolving the lock?',
        paragraphs: [
          'Only remove the exact lock after confirming its owning operation has ended. Do not use a recursive “delete all lockfiles” command. If ownership is uncertain, leave it in place while you investigate.',
        ],
        steps: [
          'Run git status in the affected checkout and inspect remaining changes. Retry the single operation that was blocked.',
          'If the lock returns, identify what is writing to that checkout: an agent, editor, Git command, or another tool. Repeated deletion hides the underlying conflict.',
          'If the problem is a missing worktree folder, inspect git worktree list --porcelain and the registration’s lock reason. Use Project → Worktrees to review eligible cleanup; pruning is not a remedy for an active index lock.',
        ],
        links: [
          {
            label: 'Review worktree cleanup safeguards',
            href: '/knowledge/git-worktrees/',
          },
          {
            label: 'Prepare a support report if the error persists',
            href: '/knowledge/troubleshooting-and-diagnostics/',
          },
        ],
      },
    ],
  },
  {
    slug: 'connecting-custom-mcp-servers',
    category: 'mcp',
    title: 'Find and connect MCP tools',
    shortTitle: 'Connect MCP tools',
    description:
      'Add local commands or remote HTTP endpoints, choose the project and agent, and verify a real tool request.',
    readingTime: '2 min read',
    sections: [
      {
        id: 'mcp-overview',
        question: 'How do I connect project tools?',
        paragraphs: [
          'Open MCP → Marketplace for a curated collection of publisher-maintained tools. Review what a service does and its setup guide, then choose Configure. Search or choose All servers to browse the wider AllMCPs directory. Use Custom connection for your own endpoint or local command.',
        ],
      },
      {
        id: 'stdio-setup',
        question: 'How do I add a local stdio server?',
        paragraphs: [
          'Choose Local command in the connection form. Use the executable and arguments from the server’s own documentation; installing a package does not tell Jackalope which resources it should expose.',
        ],
        steps: [
          'Give the connection a recognizable Name. Choose this project or all projects and the eligible agents. A unique identifier is generated; you can change it in Advanced settings.',
          'Put only the executable in Command. Add each command-line argument separately under Arguments; do not paste a whole shell command into Command.',
          'Configure required environment values under Advanced settings. Check that the executable is discoverable under the same user account as Jackalope.',
          'Choose Save and check. This starts the local process and may download its package. A failed check keeps your settings so you can edit or retry. Then try a small task that requests a specific, read-only action.',
        ],
        callout: {
          kind: 'note',
          text: 'A server process can start successfully without exposing the tool you need. Confirm the requested tool returns the expected data before giving it a larger task.',
        },
      },
      {
        id: 'sse-setup',
        question: 'How do I add a remote connection?',
        paragraphs: [
          'Choose Remote URL and use the server’s documented HTTP MCP endpoint. A product homepage, dashboard URL, or ordinary REST endpoint is not necessarily an MCP endpoint. Configure the authentication and client options the server documents.',
          'Codex direct delivery supports HTTP; Claude Code supports HTTP and legacy SSE. On-demand discovery supports HTTP and stdio, not SSE. The form retains Legacy SSE for existing SSE connections; new connections use Local command or Remote URL.',
          'For a token, choose Bearer token / API key and use the masked field. Other headers and client options are under Advanced settings. Save and check tests configured credentials. OAuth services instead offer Sign in through Codex or Claude: save, then finish sign-in in each selected agent account. Saving does not verify sign-in, and the connection check cannot verify an agent-owned OAuth session.',
        ],
      },
      {
        id: 'enforcing-tool-gating',
        question: 'How do I choose tools for a task?',
        paragraphs: [
          'Review project and all-project connections under Customize task → Tools. Project overrides take precedence over all-project connections with the same identifier. Existing saved task restrictions still apply to project connections. Check CLI-global configuration separately. A connection selection is not a guarantee that the agent has no other tools or local permissions.',
        ],
      },
      {
        id: 'verify-connection',
        question: 'How do I tell whether the task can use the connection?',
        paragraphs: [
          'Ask for one known record or a read-only list from the connected service. Specify the connection name and expected kind of result, then inspect the task’s tool result. An agent saying it has access is not a connection test.',
        ],
        bullets: [
          '“Command not found”: verify the local executable and its arguments.',
          'Authentication failure: check the server credential or the bound CLI account, including its permissions.',
          'Connection probes successfully but no tool appears: review project scope, task selection, agent eligibility, and transport support.',
          'Tool returns the wrong data: check the server’s account, workspace, resource scope, and request arguments.',
        ],
        links: [
          {
            label: 'Check agent transport support',
            href: '/knowledge/mcp-and-browser-automation/',
          },
          {
            label: 'Repair local command discovery',
            href: '/knowledge/fixing-cli-path-on-windows/',
          },
        ],
      },
    ],
  },
  {
    slug: 'recurring-schedules-and-automation',
    category: 'workflows',
    title: 'Set up a recurring task',
    shortTitle: 'Recurring tasks',
    description:
      'Create a repeatable check, choose a timezone and missed-run policy, and inspect each scheduled result.',
    readingTime: '3 min read',
    sections: [
      {
        id: 'why-schedules',
        question: 'Why run coding agent tasks on recurring schedules?',
        paragraphs: [
          'Certain engineering tasks should happen proactively rather than waiting for user requests: daily dependency vulnerability checks, nightly test suite refactors, documentation drift scans, or automated codebase health reports.',
          'Jackalope keeps recurring work with its project, instructions, account, and execution target. Each agent run has its own result and review history. Choose the checks in your instructions and inspect their evidence when the task returns.',
        ],
      },
      {
        id: 'first-schedule',
        question: 'Try it: a weekday documentation check',
        paragraphs: [
          'Start with a report-only task so you can inspect its output before giving recurring work permission to edit. In Tasks → Recurring, create a schedule for the intended project.',
        ],
        steps: [
          'Choose the agent/account and execution target. Write a narrow brief that identifies the files to inspect and the expected report.',
          'Select Weekdays, a local time, and the schedule timezone. Check the missed-run policy and choose skip or a single catch-up deliberately.',
          'Save the schedule paused and review its configuration. Enable automatic runs when you are ready, with Jackalope open and the computer awake.',
          'After a run, inspect its outcome and evidence. Pause the schedule before changing a brief that repeatedly fails or produces noise.',
        ],
        codeBox: {
          title: 'Example recurring brief',
          code: 'Compare README setup instructions with package scripts and the documented development workflow.\nReport outdated commands with file references and a suggested correction.\nDo not edit, commit, push, install dependencies, or contact external services.\nIf nothing changed, say which files and scripts you checked.',
        },
      },
      {
        id: 'cadence-options',
        question: 'Which schedule timings are available?',
        paragraphs: [
          'Choose Every day, Weekdays, Every week, Every few hours, or Custom cron. Hourly presets support 1, 2, 3, 4, 6, 8, and 12 hours at a selected minute. They align to clock hours in the schedule timezone rather than counting from the last run.',
          'Custom cron uses five fields: minute, hour, day, month, weekday. For example, 0 */6 * * * checks at 00:00, 06:00, 12:00, and 18:00 in the selected timezone. Daylight-saving changes follow the scheduler’s timezone behavior.',
        ],
      },
      {
        id: 'safe-execution',
        question: 'When can a schedule run?',
        paragraphs: [
          'Jackalope must be open, including in the tray, and the computer awake. New schedules start paused. Choose whether a missed occurrence is skipped or caught up once; interrupted dispatch is not silently replayed.',
          'Scheduled agent tasks use the existing account, workspace, capacity, and overlap checks. Checks and successful outcomes depend on the task; scheduling alone does not verify the code or merge changes.',
          'For lighter monitoring, choose to notify about committed local branch/path changes or run an agent only after a change. Baseline and unchanged checks make no model calls and do not fetch from remotes.',
        ],
      },
      {
        id: 'missed-run',
        question: 'Why did my scheduled check not produce an agent result?',
        paragraphs: [
          'Check that the schedule is enabled, the app was open, and the computer was awake at the due time in the selected timezone. Then inspect the saved outcome for eligibility, capacity, or overlap failures.',
          'A local change monitor can legitimately produce no agent result when the watched committed branch/path is unchanged. It does not fetch remote branches or treat an uncommitted edit as a new remote change. Choose an always-run agent task when you need an inspection regardless of changes.',
        ],
        links: [
          {
            label: 'Check account capacity and eligibility',
            href: '/knowledge/task-routing-and-quotas/',
          },
          {
            label: 'Investigate a failed run',
            href: '/knowledge/troubleshooting-and-diagnostics/',
          },
        ],
      },
    ],
  },
  {
    slug: 'task-composer-and-effort-levels',
    category: 'workflows',
    title: 'Write, run, and review your first task',
    shortTitle: 'Your first task',
    description:
      'Describe outcomes, match project guidance, choose effort, and review changes with their saved evidence.',
    readingTime: '2 min read',
    sections: [
      {
        id: 'first-task',
        question: 'Try it: improve one empty state',
        paragraphs: [
          'Tasks opens Chat. Send a message to start a conversation, or open Inbox or New task for a structured brief with effort, agent, and tool choices. For a first task, describe the starting state, desired result, constraints, and how the agent should check it. Replace the example page and commands with ones that exist in your project.',
          'Project setup walks through your repository, agents, decisions, Git behavior, appearance, and an optional first task. Preparation, check, and preview commands are detected in the background without replacing your saved choices. Review or edit them in Project Settings before starting work; setup does not run commands or enable automatic checks.',
          'Chat offers optional starters for GitHub issues, PR feedback, failing CI and dependency updates. GitHub evidence is read through your installed, signed-in CLI. The prepared request stays editable; it does not publish, reply or resolve threads.',
        ],
        codeBox: {
          title: 'Example task brief',
          code: 'On the saved-items page, show a helpful empty state when the list has no items.\nExplain what belongs here and include a link to the existing browse page.\nUse the shared controls and theme tokens. Preserve loading and error states.\nCheck the empty and populated states, keyboard focus, and a narrow layout.\nReport changed files, checks actually run, and any remaining uncertainty.',
        },
        steps: [
          'Choose the project and confirm the target branch or workspace. Choose Work in a copy when other work is in progress.',
          'Pick an effort level and review Customize task for agent, account, context, and tools. Include a reachable preview URL when you expect browser checks.',
          'Start the task and respond if it asks for missing information. Read the result and actual checks, then merge into the target branch and remove the workspace.',
        ],
      },
      {
        id: 'effort-tiers',
        question: 'What do Quick, Balanced, and Thorough change?',
        paragraphs: [
          'Effort adds guidance to the task: Quick requests a focused change and targeted checks; Balanced asks for a brief plan and verification of affected flows; Thorough asks for deeper investigation, broader checks, and a separate review pass.',
          'These are instructions, not hard token budgets, guaranteed response times, or automatic grants of tools and subagents. Provider and task settings still determine model access and execution.',
        ],
      },
      {
        id: 'task-speed',
        question: 'Can I speed up tasks without reducing model effort?',
        paragraphs: [
          'Choose Codex speed under Customize task, or in the options for a new Chat. Provider setting keeps the existing CLI choice. Standard and Fast request an explicit processing tier for Codex workers. Fast can use more credits and requires a supported model and account; it does not change model effort. Other agents keep their own settings.',
          'The choice follows planned assignments, retries and continuations. Task details record the requested tier and offer Execution timing for measured setup, context and check stages. Some stages overlap, and older records may have no measurements. Provider acceptance and actual speed gains require observation.',
          'Jackalope supplies relevant repository context and completed setup facts, reuses matching saved checks and schedules independent work through workspace safeguards. Required verification and review still apply.',
        ],
      },
      {
        id: 'review-feedback',
        question: 'How do I discuss specific changes or start from an issue?',
        paragraphs: [
          'In Review, use the line gutter or Add comment to attach feedback to a file and line. Add the unresolved comments to one follow-up, then review and send it. Earlier-patch comments retain their original location and ask the agent to recheck it. Show conversation keeps the result alongside Review or Preview; smaller windows stack the panes.',
          'Open Start from an issue on Project, or Browse issues and pull requests in task workflows. GitHub uses your signed-in GitHub CLI. Connect Linear or Jira Cloud in Settings → Connected work. Choose an issue to prepare an editable task draft; Linked work opens its source later. Browsing does not update the issue or publish code.',
        ],
      },
      {
        id: 'remote-access',
        question: 'How do I continue from another computer or my phone?',
        paragraphs: [
          'On the machine that runs your work, open Settings → Remote access, enable paired devices, select projects and save. Keep Jackalope running. Selected projects share task content and allow paired devices to start isolated tasks, answer questions and send follow-ups using the host’s saved settings.',
          'For another desktop, open Tasks → Hosts → Connect a host. Use an SSH alias that already signs in with a verified host key, or an HTTPS address. Create a pairing code on the host and paste it on the connecting desktop.',
          'For a phone, set up private HTTPS with Tailscale after signing both devices into Tailscale, or enter your existing HTTPS proxy address under Connection settings. Create a pairing link, open it on the phone and name the device. Links work once and expire after five minutes. Revoke devices from the host settings.',
          'Work continues on the host when you disconnect. Refresh status before retrying an interrupted action. Reconnecting reuses saved send identifiers to avoid duplicate messages. Host restart retains normal paused/recovery behavior. Phone and multi-device installed acceptance remain in progress; native mobile applications and managed hosting are not included.',
        ],
      },
      {
        id: 'try-result',
        question: 'How do I see the result and request a correction?',
        paragraphs: [
          'Open Preview after work stops. Jackalope detects a supported local preview command when none is saved. Review the command and choose Start preview. Jackalope remembers the command and can choose an available port. A responding server means the preview is reachable; inspect the behavior and project checks before accepting the work.',
          'Use Select in preview to open the task-owned preview browser. Interact or sign in there, select an element, describe the change and add your selections to a follow-up. It captures that browser’s current state, with a cropped screenshot and HTML/style context. Selection notes survive view changes. The embedded page has separate browser state. A fresh page snapshot remains available in a disclosure.',
          'A preview holds its workspace while running. Stop preview and continue saves its logs and resumes work with your follow-up. Running tasks offer Queue follow-up and Stop & send. Queued instructions stay in order, continue in the same workspace and account, and pause after failures or restart. Run or cancel queued follow-ups before merging. Chat also lets you queue messages or explicitly stop current work and send.',
          'On Chat’s start page, pick up work waiting across your projects. Session limits can pause later batches after a batch count or an estimated dollar threshold. A running batch can exceed the threshold, and missing cost reports pause further work when a cost limit is set. This is not a provider billing cap.',
        ],
        links: [
          { label: 'Queue messages and recover a chat', href: '/knowledge/chat-and-follow-ups/' },
        ],
      },
      {
        id: 'delivery-state',
        question: 'Are my changes published after a local merge?',
        paragraphs: [
          'A local merge integrates changes into your target branch. It does not push, publish or deploy them. Delivery can inspect the local branch and, through your installed and signed-in GitHub CLI, read the PR and its checks. A PR with a different head does not verify your current local result.',
          'Prepare a PR, CI verification or deployment to create an editable handoff with the result and recorded checks. Review the draft before starting it. The handoff asks for concrete destinations and effects before any publishing action. Deployment stays unverified until behavior is checked in the intended environment.',
        ],
      },
      {
        id: 'prompt-refinement',
        question: 'How do I give a task the right instructions?',
        paragraphs: [
          'Choose the project, describe the outcome, and open Customize task when you need more control. New tasks match guidelines to the prompt and inherit project defaults. Review or override the selection; saved manual choices stay explicit until reset.',
          'Keep expected outcomes specific. Project lessons, reusable workflows, and selected tools can supplement the brief, and task history records the context supplied at launch.',
        ],
      },
      {
        id: 'pierre-diffs',
        question: 'What should I inspect before integrating a result?',
        paragraphs: [
          'Open the result and review changes file by file in the unified or side-by-side diff. Compare the patch with your requested outcome, including accidental changes outside the scope.',
          'Read the saved command output and checks. Confirm they ran in the intended checkout and exercised the changed behavior. A successful build does not establish that a browser flow or native application worked.',
          'Review separates Changes, Checks, and Merge. Track files with optional review markers, then use Approve work to accept the outcome for the displayed snapshot. Preparing and applying the merge remains a separate step; inspect the combined result and required checks first.',
          'Chat uses the same guarded merge path for its latest batch. Pause dispatch and run or cancel queued messages before preparing the merge. After integration, continue in a new chat to work from the updated target branch.',
          'Changes since my last review compares the current files with a review position you explicitly saved. Marking them seen does not accept changes or replace checks. You can optionally rate usefulness and report review minutes; Usage summarizes these locally and offers an aggregate report to copy.',
        ],
        links: [
          {
            label: 'Review, approval, and blocked-merge recovery',
            href: '/knowledge/review-and-merge/',
          },
          {
            label: 'Understand Review & merge',
            href: '/knowledge/git-worktrees/',
          },
        ],
      },
    ],
  },
  {
    slug: 'theme-editor-and-atmosphere',
    category: 'themes',
    title: 'Make Jackalope feel like your workspace',
    shortTitle: 'Appearance & themes',
    description:
      'Preview colors, appearance, and atmosphere, keep a comfortable theme, and understand companion activity.',
    readingTime: '2 min read',
    sections: [
      {
        id: 'try-a-theme',
        question: 'Try it: build a comfortable reading theme',
        paragraphs: [
          'Open the appearance picker and start with the mode you use most often. Make one change at a time so you can judge its effect on real content.',
        ],
        steps: [
          'Choose light, dark, or automatic appearance and an accent you can recognize in links and selected controls.',
          'Start with Single harmony and low atmosphere. Preview Duo or Trio if you want more color, then check a dense task list and a code diff.',
          'Adjust atmosphere while checking text, borders, selected states, and keyboard focus. Keep theme saves the preview; cancel restores the previous choice.',
          'If motion distracts you, use the companion animation preference and your operating system’s reduced-motion setting. Activity and notices remain available.',
        ],
        callout: {
          kind: 'tip',
          text: 'You can ask the helper to propose a theme in plain language. Review its preview in the same way before keeping it.',
        },
        links: [
          {
            label: 'Ask the helper for an appearance change',
            href: '/knowledge/ask-jackalope/#try-a-question',
          },
        ],
      },
      {
        id: 'harmonies',
        question: 'What are Single, Duo, and Trio color harmonies?',
        paragraphs: [
          'Single uses one accent hue, Duo adds its complementary hue, and Trio uses hues 120 degrees apart. Shared theme tokens derive readable surfaces, text, and control colors from the palette.',
          'Preview colors and light, dark, or automatic appearance before keeping the theme. Cancel restores the saved choice. Reduced-motion preferences keep the interface usable without animation.',
        ],
      },
      {
        id: 'atmosphere-slider',
        question: 'What does the Atmosphere slider change?',
        paragraphs: [
          'Atmosphere controls the color saturation and visual depth of background surfaces, sidebars, and elevation layers. At low atmosphere (8–12), the interface is whisper-quiet and neutral. At higher atmosphere (up to 64), your chosen accent tint gently permeates cards, elevated surfaces, and window glass.',
        ],
      },
      {
        id: 'mascot-moods',
        question: 'What do the companion’s moods mean?',
        paragraphs: [
          'The companion has idle, thinking, working, success, and sleeping moods. Reactions follow activity and interactions; a celebration is not proof that checks passed or code was merged.',
          'Read task results and saved evidence for the actual outcome. Reduced motion keeps a static expression, and notices remain available when work needs attention.',
        ],
      },
    ],
  },
];
