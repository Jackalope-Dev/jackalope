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
    label: 'Workflows & How-To',
    description: 'Task composer, effort tiers, Pierre diffs, and recurring schedules.',
  },
  {
    id: 'architecture',
    label: 'Architecture',
    description: 'Isolated Git worktrees, concurrency locks, and integration safeguards.',
  },
  {
    id: 'routing',
    label: 'Routing & Quotas',
    description: 'Automatic agent selection, reported quota windows, and bounded handoff.',
  },
  {
    id: 'agents',
    label: 'Agents & Accounts',
    description: 'Supported coding agents, account profiles, and credential storage limits.',
  },
  {
    id: 'mcp',
    label: 'MCP & Tools',
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
    label: 'Themes & Atmosphere',
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
      'Windows GUI apps do not inherit PATH modifications made in open terminals without restarting Explorer or the Jackalope desktop app.',
    targetSlug: 'fixing-cli-path-on-windows',
  },
  {
    id: 'git-locked',
    title: 'Git index or worktree is locked',
    symptom: 'Unable to create or checkout worktree with error "fatal: .git/index.lock exists".',
    quickFix:
      'Confirm no background git or agent processes are running, then remove stale lockfiles and run git worktree prune.',
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
      'Verify the local stdio command exists in PATH and check JSON-RPC port availability for SSE servers.',
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

export const likelyArticleSlugs = [
  'fixing-cli-path-on-windows',
  'resolving-git-worktree-locks',
  'git-worktrees',
  'task-routing-and-quotas',
  'multi-account-and-agents',
  'connecting-custom-mcp-servers',
];

export interface KnowledgeGuideSection {
  id: string;
  question: string;
  paragraphs: string[];
  bullets?: string[];
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
    slug: 'ask-jackalope',
    category: 'workflows',
    title: 'Ask Jackalope: help, appearance and local agent tools',
    shortTitle: 'Ask Jackalope',
    description:
      'Use your configured agent to find answers, personalize Jackalope and prepare work. Connect external agents to the same local tools.',
    readingTime: '4 min',
    sections: [
      {
        id: 'open-helper',
        question: 'How do I use the helper?',
        paragraphs: [
          'Open the Jackalope companion at the bottom right and choose Ask. Ask a question, request an appearance change, or prepare a task. Activity retains notifications, feedback and task shortcuts.',
          'The helper uses your default agent, configured model and active account. Codex, Claude Code, Grok and OpenCode have helper adapters; unsupported defaults show a configuration message. Messages and shared context go to that provider and may count toward its usage limits. A question can require several model requests as the helper reads tools and documentation.',
          'The helper works without an open project. It uses an app-owned working directory and does not attach repository files. It retains its own local conversation and reported token usage. Stop ends the active response; interrupted requests are never automatically replayed. New conversation archives the previous record locally.',
        ],
      },
      {
        id: 'context',
        question: 'What can the helper read?',
        paragraphs: [
          'Official knowledgebase guides are bundled with the app, so documentation tools work offline. The selected agent still needs its usual provider connection. Answers should cite the source guide; bundled documentation describes that app build and may differ from newer website content.',
          'App version, current screen and agent availability are shared. Context & connections lets you include appearance and supported preferences, or project names and selected-project task statuses. Files, paths, task prompts, results, logs and credentials are excluded from this context.',
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
          'In Ask → Context & connections, choose Connect an external agent, then Copy MCP connection. The copied JSON contains a Streamable HTTP URL on 127.0.0.1 and a bearer credential. Configure it in a compatible local MCP client; clients have different configuration formats.',
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
  // 1. Git Worktrees (Architecture)
  {
    slug: 'git-worktrees',
    category: 'architecture',
    title: 'Isolated Git Worktrees, Concurrency & Integration Safeguards',
    shortTitle: 'Git Worktrees & Concurrency',
    description:
      'How Jackalope uses native Git worktrees to isolate parallel coding agents, prevent dirty checkout collisions, and enforce guarded fast-forward integration.',
    readingTime: '2 min read',
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
        id: 'concurrency-collisions',
        question: 'How does Jackalope coordinate parallel work?',
        paragraphs: [
          'Parallel plans record task scopes, dependencies, and a concurrency limit. The coordinator reserves work before launching an agent; dependencies wait for the changes they need to be integrated.',
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

  // 2. Task Routing & Quotas (Routing)
  {
    slug: 'task-routing-and-quotas',
    category: 'routing',
    title: 'Automatic Task Routing, Quota Windows & Failover Handoff',
    shortTitle: 'Task Routing & Quotas',
    description:
      'Choose eligible agents using reported capacity, preserve work during quota handoff, and understand pinned tasks and limits.',
    readingTime: '2 min read',
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
          'Automatic tasks ask your configured default agent to choose among eligible agents, configured models, and permitted accounts. Project restrictions, tool compatibility, and reported capacity constrain the options.',
          'Jackalope validates the returned choice and saves its reason. Routing consumes provider usage. Codex, Claude Code, Grok, and OpenCode can coordinate; Antigravity runs as a worker. Explicit assignments remain available.',
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
    ],
  },

  // 3. Agents & Multi-Account (Agents)
  {
    slug: 'multi-account-and-agents',
    category: 'agents',
    title: 'Configuring Agents, Multi-Account Profiles & Credentials',
    shortTitle: 'Set up coding agents & account profiles',
    description:
      'Set up Codex, Claude Code, Grok, OpenCode, and Antigravity, choose project accounts, and understand credential storage limits.',
    readingTime: '2 min read',
    sections: [
      {
        id: 'supported-adapters',
        question: 'Which coding agents can run tasks?',
        paragraphs: [
          'Codex, Claude Code, Grok Build, OpenCode, and Antigravity have native task adapters. Install the corresponding CLI and configure provider access. Model access, permissions, and billing remain with your provider.',
          'Antigravity uses agy and is worker-only. Gemini CLI, Aider, and Goose appear in account setup but do not yet have task execution adapters. Discovery of an executable is not proof of valid authentication.',
        ],
      },
      {
        id: 'work-personal-segregation',
        question: 'How do work and personal account profiles differ?',
        paragraphs: [
          'Named Codex, Claude Code, Grok, and OpenCode profiles use separate supported CLI directories. Choose project defaults in Project → Settings. Continuations retain their bound profile.',
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

  // 4. MCP Hub & Browser Automation (MCP)
  {
    slug: 'mcp-and-browser-automation',
    category: 'mcp',
    title: 'Central Model Context Protocol (MCP) & Built-in Browser Engine',
    shortTitle: 'MCP & Browser Automation',
    description:
      'Centralized Model Context Protocol configuration, tool gating, local headless browser daemon, and interactive human-in-the-loop dialogs.',
    readingTime: '2 min read',
    sections: [
      {
        id: 'central-broker',
        question: 'How are project MCP tools delivered?',
        paragraphs: [
          'Configure connections in MCP → Connections and select the project tools for a task. Codex supports direct stdio and HTTP connections; Claude Code also supports SSE.',
          'Codex, Claude Code, Grok, and Antigravity support on-demand discovery for supported stdio and HTTP connections. OpenCode project-tool delivery is not implemented; use its own CLI configuration.',
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

  // 5. Windows Desktop Control (Desktop Control)
  {
    slug: 'windows-desktop-control',
    category: 'desktop-control',
    title: 'Windows Desktop Control, Window Grants & Input Safeguards',
    shortTitle: 'Windows Desktop Control',
    description:
      'Attempt-scoped window grants, desktop visual indicators, physical mouse interruption, and native input lease safeguards.',
    readingTime: '2 min read',
    sections: [
      {
        id: 'window-grants',
        question: 'How do window grants work?',
        paragraphs: [
          'On Windows, explicitly select an application window for the current task attempt. Jackalope’s desktop tools check that grant before accessibility reads, captures, and native input.',
          'These grants control Jackalope’s desktop tools, not the agent’s other local capabilities. Desktop control operates the live user session and does not create an OS sandbox. macOS and Linux native window control are not implemented.',
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
    ],
  },

  // 6. Troubleshooting Playbook (Troubleshooting)
  {
    slug: 'troubleshooting-and-diagnostics',
    category: 'troubleshooting',
    title: 'Diagnostic Playbook, Worktree Locks & History Recovery',
    shortTitle: 'Troubleshooting & Diagnostics',
    description:
      'Resolving missing CLI PATH on Windows, clearing stale Git index locks, recovering interrupted task history, and generating support reports.',
    readingTime: '3 min read',
    sections: [
      {
        id: 'missing-cli-path',
        question:
          'Why does the desktop app report "CLI not found" and how do I fix Windows PATH inheritance?',
        paragraphs: [
          'A frequent issue on Windows occurs when an agent CLI (like codex, claude, or grok) is installed via npm or cargo in a terminal session, but the desktop application was launched from the Windows Start menu or Taskbar before the system PATH environment variable was broadcast.',
          'Applications launched by Windows Explorer inherit the environment variables that existed when the Explorer shell process started. If you recently modified your PATH in a terminal, restart the Jackalope desktop app so it inherits your updated User and System PATH variables.',
        ],
        codeBox: {
          title: 'Verifying Executables in PowerShell',
          code: `# Verify the CLI executable is discoverable in your PATH
Get-Command codex | Select-Object -ExpandProperty Source
Get-Command claude | Select-Object -ExpandProperty Source

# If installed via npm global, verify your npm prefix is in User PATH
npm config get prefix
# Should output: C:\\Users\\<user>\\AppData\\Roaming\\npm`,
        },
      },
      {
        id: 'stale-git-locks',
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
        id: 'history-recovery',
        question: 'What happens to task history after an unexpected shutdown?',
        paragraphs: [
          'Jackalope saves task records in local versioned JSON journals with atomic replacement. On restart, unfinished attempts are marked interrupted and their saved history remains available. Unreadable files are preserved for recovery.',
          'Interrupted attempts are not automatically replayed or resumed because process ownership may be uncertain. Inspect the task and worktree before retrying. Settings → Data & reset can restore archived history or import a task recovery export.',
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

  // 7. Dedicated How-To: Fixing Windows PATH (Troubleshooting)
  {
    slug: 'fixing-cli-path-on-windows',
    category: 'troubleshooting',
    title: 'How to Fix "CLI Not Found" & Windows Environment PATH Inheritance',
    shortTitle: 'Fix agent CLI not found on Windows',
    description:
      'Step-by-step instructions for ensuring agent executables (Codex, Claude Code, Grok, OpenCode) are properly discovered by Jackalope on Windows.',
    readingTime: '2 min read',
    sections: [
      {
        id: 'root-cause',
        question: 'Why does a CLI work in my terminal but fail inside the desktop app?',
        paragraphs: [
          'When you install a tool using npm install -g or cargo install in an active Windows PowerShell window, that terminal process updates its local environment. However, applications already running - or applications launched by the Windows Explorer shell - do not immediately receive WM_SETTINGCHANGE environment broadcast signals.',
          'As a result, Jackalope’s native process runner searches the older PATH that existed when Windows Explorer started. When Jackalope calls where codex or spawns the agent binary, the operating system returns Error 2: The system cannot find the file specified.',
        ],
      },
      {
        id: 'npm-global-path',
        question: 'How do I add npm and cargo global paths to Windows User PATH?',
        paragraphs: [
          'Ensure your user-specific npm and cargo bin directories are permanently listed in your User PATH variable:',
        ],
        codeBox: {
          title: 'Adding Directories to User PATH (PowerShell)',
          code: `# Check your current npm global prefix
$npmPrefix = npm config get prefix
Write-Host "npm path: $npmPrefix"

# Standard paths that should exist in your User PATH:
# npm:   %APPDATA%\\npm
# cargo: %USERPROFILE%\\.cargo\\bin
# pnpm:  %LOCALAPPDATA%\\pnpm

# Verify they exist in your current user environment
[Environment]::GetEnvironmentVariable("Path", "User") -split ";"`,
        },
      },
      {
        id: 'desktop-refresh',
        question: 'How do I force Jackalope to reload system environment variables?',
        paragraphs: [
          'After modifying environment variables or installing a new CLI adapter:',
          '1. Close the Jackalope desktop app completely (check system tray to ensure background processes are terminated).',
          '2. If you installed the CLI in an elevated terminal, ensure your normal user account has execution permissions on the target directory.',
          '3. Re-launch Jackalope. On startup, the native coordinator scans system PATH directories and refreshes CLI discovery in Agents. Detection alone does not prove valid sign-in.',
        ],
      },
    ],
  },

  // 8. Dedicated How-To: Resolving Git Locks (Troubleshooting)
  {
    slug: 'resolving-git-worktree-locks',
    category: 'troubleshooting',
    title: 'How to Clear Stale .git/index.lock & Worktree Lockfiles',
    shortTitle: 'Resolving Git Worktree Locks',
    description:
      'How to safely diagnose, remove, and prevent stale Git index locks and orphaned worktrees left by abnormal system termination.',
    readingTime: '2 min read',
    sections: [
      {
        id: 'what-are-git-locks',
        question: 'What causes "Unable to create .git/index.lock: File exists" errors?',
        paragraphs: [
          'Git creates atomic lockfiles (such as index.lock, HEAD.lock, or refs/heads/<branch>.lock) to guarantee that only one process writes to the repository index at a time. Under normal conditions, Git deletes this lockfile within milliseconds once the transaction finishes.',
          'However, if an operating system reboots unexpectedly, an agent process is killed forcefully through Task Manager, or an antivirus process holds a file handle open on Windows, Git cannot clean up the lockfile. Any subsequent Git command aborts immediately.',
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
    ],
  },

  // 9. Dedicated How-To: Connecting Custom MCP Servers (MCP)
  {
    slug: 'connecting-custom-mcp-servers',
    category: 'mcp',
    title: 'How to Connect Custom MCP Servers (stdio & SSE) with Tool Gating',
    shortTitle: 'Connect custom MCP servers',
    description:
      'Step-by-step instructions for adding custom Model Context Protocol tools, configuring stdio/SSE transports, and enforcing project tool gating.',
    readingTime: '1 min read',
    sections: [
      {
        id: 'mcp-overview',
        question: 'How do I connect project tools?',
        paragraphs: [
          'MCP connects agents to tools and data sources. Add connections in MCP → Connections, choose project defaults, and review what a task receives. Delivery depends on the selected adapter and transport.',
        ],
      },
      {
        id: 'stdio-setup',
        question: 'How do I add a local stdio server?',
        paragraphs: [
          'In MCP → Connections, add a stdio connection with the executable and arguments documented by the server. Use environment references for credentials where supported; verify the command exists and review what it can access before testing it.',
        ],
      },
      {
        id: 'sse-setup',
        question: 'How do I add a remote MCP server?',
        paragraphs: [
          'Use the server’s documented HTTP or SSE endpoint and configure its authentication. Codex direct delivery supports HTTP; Claude Code supports HTTP and SSE. On-demand discovery supports HTTP and stdio, not SSE.',
        ],
      },
      {
        id: 'enforcing-tool-gating',
        question: 'How do I choose tools for a task?',
        paragraphs: [
          'Review project connections and use Customize task to select those the task needs. Check CLI-global configuration separately. A connection selection is not a guarantee that the agent has no other tools or local permissions.',
        ],
      },
    ],
  },

  // 10. Dedicated Feature Guide: Recurring Schedules (Workflows)
  {
    slug: 'recurring-schedules-and-automation',
    category: 'workflows',
    title: 'Recurring Task Schedules, Cron Intervals & Automation',
    shortTitle: 'Schedule recurring coding-agent tasks',
    description:
      'Configuring scheduled code audits, security scans, dependency updates, and recurring maintenance tasks using cron expressions and time cadences.',
    readingTime: '2 min read',
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
    ],
  },

  // 11. Dedicated Feature Guide: Task Composer & Effort Levels (Workflows)
  {
    slug: 'task-composer-and-effort-levels',
    category: 'workflows',
    title: 'Task Composer, Automatic Guidance & Effort Levels',
    shortTitle: 'Coding-agent tasks & effort levels',
    description:
      'Describe outcomes, match project guidance, choose effort, and review changes with their saved evidence.',
    readingTime: '1 min read',
    sections: [
      {
        id: 'effort-tiers',
        question: 'What do Quick, Balanced, and Thorough change?',
        paragraphs: [
          'Effort adds guidance to the task: Quick requests a focused change and targeted checks; Balanced asks for a brief plan and verification of affected flows; Thorough asks for deeper investigation, broader checks, and a separate review pass.',
          'These are instructions, not hard token budgets, guaranteed response times, or automatic grants of tools and subagents. Provider and task settings still determine model access and execution.',
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
        question: 'How does Pierre Diffs streamline code review in Jackalope?',
        paragraphs: [
          'Reviewing AI-generated code should be comfortable, visual, and fast. Jackalope integrates Pierre Diffs for rich, syntax-highlighted side-by-side and unified diff views.',
          'You can inspect changes file by file, collapse unmodified context lines, inspect terminal test receipts, and verify that no unintended files were modified before clicking Apply.',
        ],
      },
    ],
  },

  // 12. Dedicated Feature Guide: Theme Harmonies & Atmosphere (Themes)
  {
    slug: 'theme-editor-and-atmosphere',
    category: 'themes',
    title: 'Theme Harmonies, Atmosphere Tuning & Mascot Reactions',
    shortTitle: 'Themes & Atmosphere',
    description:
      'Customizing Single, Duo, and Trio color harmonies, adjusting the 64-step atmosphere slider, and understanding the five mascot companion activity moods.',
    readingTime: '1 min read',
    sections: [
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
        question: 'What does the 64-step Atmosphere slider control?',
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
