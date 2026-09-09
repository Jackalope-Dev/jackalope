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
    description: 'Default-agent coordination, 5-hour quota windows, and 3-attempt failover.',
  },
  {
    id: 'agents',
    label: 'Agents & Accounts',
    description: 'Codex, Claude Code, Grok, OpenCode, Work vs Personal sign-ins, and OS Keychain.',
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
      'Auto-routed tasks automatically failover to your next eligible provider account. Pinned tasks pause safely until window reset.',
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
    symptom: 'Agent fails to discover or execute tools configured in Settings → MCP Tools.',
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
      'Atomic SQLite write-ahead logging preserves all attempt history and partial patches. Click Resume in the Tasks view.',
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
  // 1. Git Worktrees (Architecture)
  {
    slug: 'git-worktrees',
    category: 'architecture',
    title: 'Isolated Git Worktrees, Concurrency & Integration Safeguards',
    shortTitle: 'Git Worktrees & Concurrency',
    description:
      'How Jackalope uses native Git worktrees to isolate parallel coding agents, prevent dirty checkout collisions, and enforce guarded fast-forward integration.',
    readingTime: '6 min read',
    sections: [
      {
        id: 'why-worktrees',
        question: 'Why does Jackalope isolate tasks in Git worktrees instead of raw branches?',
        paragraphs: [
          'Most developer tools attempt to run coding agents directly in the user’s primary working directory or rely on rapid git checkout switches between branches. In practice, this breaks immediately when multiple agents run concurrently: file watchers re-trigger, uncommitted user edits get clobbered or stashed, build artifacts collide, and language server caches thrash.',
          'Jackalope solves this by provisioning a dedicated, native Git worktree under .worktrees/<task-slug> for every independent task attempt. Each worktree shares the local Git object database (.git/objects) with your primary repository, eliminating repository duplication while maintaining a completely isolated file tree, index, and HEAD pointer.',
        ],
        bullets: [
          'Zero repository disk duplication: worktrees reference the shared object store and packfiles.',
          'Your active editor, working tree, and staged files remain completely untouched while background agents work.',
          'Agents run parallel compilers, test runners, and package managers in isolated directories without file contention.',
        ],
        callout: {
          kind: 'note',
          text: 'Because worktrees share the same Git object store, commit objects created inside a worktree are immediately accessible in your main checkout without any network operations or git fetch calls.',
        },
      },
      {
        id: 'concurrency-collisions',
        question:
          'How does worktree isolation prevent checkout collisions during parallel execution?',
        paragraphs: [
          'Native Git strictly prevents two worktrees from checking out the same local branch at the same time. Jackalope respects this invariant through its native Coordinator and Execution Guard before an agent process is spawned.',
          'When a task begins, Jackalope generates an attempt-specific branch reference (such as jackalope/task-<id>) derived from your target baseline. The coordinator acquires a reservation and execution lock, ensuring that no two concurrent tasks can claim the same branch name or workspace path.',
          'If an attempt terminates abnormally or is cancelled, the branch reservation is retained in a quarantined state rather than being silently re-assigned, preventing race conditions during subsequent retries.',
        ],
        codeBox: {
          title: 'Worktree Directory Layout',
          code: `# Primary repository root
/my-project/
  ├── .git/                      # Authoritative Git database
  ├── src/                       # Your primary uncommitted working tree
  └── .worktrees/                # Managed agent workspaces
      ├── task-auth-flow/        # Isolated worktree for Task 1 (Claude Code)
      └── task-sqlite-schema/    # Isolated worktree for Task 2 (Codex)`,
        },
      },
      {
        id: 'guarded-integration',
        question: 'What is the guarded fast-forward integration workflow?',
        paragraphs: [
          'Completing a task attempt does not automatically merge changes into your working branch. In Jackalope, an agent’s successful process exit is merely a candidate result, not an integrated change.',
          'Integration is protected by a strict three-tier verification sequence: Coordinator State → Execution Guard → Runtime Lock. Before applying changes, Jackalope computes a source and target snapshot hash, verifies all test receipts, checks that no uncommitted modifications conflict in the destination branch, and enforces a clean fast-forward application.',
          'You review the candidate changes in the desktop app using Pierre Diffs, inspect all terminal evidence and check output, and click Apply only when you are satisfied with the diff.',
        ],
        bullets: [
          'Pre-integration snapshot validation ensures the base branch has not drifted since the task began.',
          'Saved test receipts and check outputs are cryptographically bound to specific file hashes.',
          'Fast-forward merges avoid unexpected merge commits or automatic conflict resolution.',
        ],
      },
      {
        id: 'worktree-cleanup',
        question: 'How does Jackalope clean up and prune completed or cancelled worktrees?',
        paragraphs: [
          'When you integrate a candidate patch or archive a task, Jackalope automatically unlinks and prunes the worktree directory using git worktree remove. If uncommitted files or ignored artifacts exist inside the worktree, Jackalope flags them to prevent accidental data loss.',
          'If a workspace cannot be unlinked cleanly (for instance, because an external editor or terminal process has locked a file handle on Windows), Jackalope marks the worktree as quarantined and releases the branch reservation so subsequent work can proceed unhindered.',
        ],
        callout: {
          kind: 'tip',
          text: 'The background maintenance runner automatically runs git worktree prune on app startup to cleanly remove stale worktree metadata left by abruptly terminated processes.',
        },
      },
      {
        id: 'manual-worktree-commands',
        question: 'What manual Git commands can I use to inspect or recover worktree state?',
        paragraphs: [
          'While Jackalope manages worktree lifecycles automatically, you have full native Git access at any time from your favorite terminal. Because all operations follow standard Git conventions, standard Git CLI commands work without proprietary wrappers.',
        ],
        codeBox: {
          title: 'Useful Git Worktree Commands',
          code: `# List all registered worktrees and their current checkout branches
git worktree list

# Manually remove a stale worktree directory
git worktree remove .worktrees/task-auth-flow --force

# Prune administrative records for removed worktrees
git worktree prune -v

# Inspect locked worktrees
git worktree unlock .worktrees/task-auth-flow`,
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
      'Understanding the Coordinator lock hierarchy, preflight quota headroom admission, 5-hour rolling windows, and 3-attempt failover handoffs.',
    readingTime: '7 min read',
    sections: [
      {
        id: 'lock-hierarchy',
        question: 'What is the lock hierarchy and how does the coordinator protect runtime state?',
        paragraphs: [
          'Jackalope coordinates multiple background agent processes and desktop commands through a deterministic lock hierarchy: Coordinator State → Execution Guard → Runtime Lock. This strict acquisition order guarantees that dispatch loops, quota inspections, and user cancellations never enter deadlocks.',
          'When a new task is submitted, the Coordinator first validates project boundaries and reserves candidate agent slots. An Execution Guard is then acquired before any native OS process tree is spawned. If any step fails or is interrupted by the user, the runtime releases locks in reverse order, ensuring state consistency across the local SQLite store.',
        ],
      },
      {
        id: 'routing-subprocess',
        question: 'How does the default-agent routing subprocess work outside coordinator locks?',
        paragraphs: [
          'When a task is set to Auto-Route, Jackalope consults the configured default agent to analyze the task prompt, project context, outcome expectations, and eligible models. To prevent long model inference calls from blocking interactive desktop operations, the routing evaluation runs in a bounded, cancellable subprocess outside core runtime locks.',
          'The routing subprocess returns a validated option ID, an explanatory rationale, an estimated token complexity, and an ordered sequence of fallback choices. If the user cancels the task or closes the project while routing is in flight, the subprocess tree is immediately terminated via native OS job objects.',
        ],
        callout: {
          kind: 'important',
          text: 'Provider identifiers, raw prompt text, and progress streams are treated as untrusted data. They can never alter system permissions, expand tool allowlists, or bypass coordinator boundaries.',
        },
      },
      {
        id: 'quota-headroom-admission',
        question: 'How does quota headroom admission calculate 5-hour rolling windows?',
        paragraphs: [
          'Major agent providers enforce rolling rate limits - most notably Claude Code’s 5-hour rolling utilization window. Launching a high-effort task against an agent with 3% remaining quota almost guarantees an in-flight rate limit failure, wasting time and partially generated code.',
          'Jackalope features preflight quota headroom admission. Account-bound capacity readers query the active CLI session (cached for up to 60 seconds) and enforce a mandatory 10-point reserve buffer in the limiting window. Furthermore, Jackalope accounts for all other active local tasks sharing that quota pool.',
          'If an agent lacks sufficient headroom for the selected effort tier (Quick, Balanced, Thorough), the coordinator refuses admission before spawning and automatically routes to the next eligible provider with available headroom.',
        ],
        bullets: [
          'Rolling 5-hour windows and weekly resets are tracked independently per account profile.',
          'A mandatory 10-point reserve prevents in-flight rate-limit aborts during complex refactors.',
          'Active local reservations prevent parallel agents from exhausting the same subscription simultaneously.',
        ],
      },
      {
        id: 'three-attempt-failover',
        question: 'How does the 3-attempt failover handoff work when an agent hits a rate limit?',
        paragraphs: [
          'Even with preflight estimation, external team usage or sudden provider throttling can trigger a rate-limit error (HTTP 429 or provider rejection event). When this happens, Jackalope’s automatic handoff engine intervenes.',
          'First, Jackalope verifies that the failure is an authentic provider quota error - not a syntax error, test failure, or transient socket disconnect. Assistant prose and warning-only lines never trigger an automated handoff.',
          'Second, the exhausted provider account is marked as cooling down and excluded from candidate selection. Jackalope preserves the existing worktree, task prompt, and file changes generated so far.',
          'Third, Jackalope spawns the next eligible agent in the same worktree, passing the accumulated progress context. Up to three handoffs are permitted per task before execution pauses to ask for human guidance.',
        ],
        codeBox: {
          title: 'Failover Progression Flow',
          code: `# 1. Task dispatched to Claude Code (Primary)
Attempt 1: Running in .worktrees/task-billing-refactor
Claude Code encounters HTTP 429 (5-hour window exhausted)

# 2. Jackalope halts process, retains worktree files, and captures context
Quota error verified -> Claude Account marked cooling down (reset at 19:42)

# 3. Automatic Handoff to Codex (Fallback 1)
Attempt 2: Resuming in .worktrees/task-billing-refactor with existing patch
Codex reads prior attempt diff, completes remaining tests, and exits 0`,
        },
      },
      {
        id: 'task-pinning',
        question: 'When are tasks pinned to a specific agent versus automatically delegated?',
        paragraphs: [
          'If you manually specify an agent (such as selecting Codex or Claude Code explicitly in the task composer), Jackalope pins that task. Pinned tasks will never auto-handoff to a different agent on quota exhaustion; instead, they pause cleanly and notify you, allowing you to either wait for quota reset or explicitly switch providers.',
          'Continuing an existing task session is also strictly pinned to the agent that originated the session to preserve local session context and reasoning memory.',
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
      'Setting up Codex, Claude Code, Grok Build, OpenCode, isolating Work vs Personal subscriptions, and securing tokens in the OS keychain.',
    readingTime: '6 min read',
    sections: [
      {
        id: 'supported-adapters',
        question: 'Which coding agent CLIs are supported and how are they authenticated?',
        paragraphs: [
          'Jackalope integrates with your locally installed coding agent CLIs via native subprocess adapters. Rather than executing models through a closed cloud proxy, Jackalope drives the authentic developer CLIs on your machine, honoring your existing subscription tiers, model permissions, and configuration files.',
          'Currently supported adapters include Codex CLI, Claude Code, Grok Build, and OpenCode. Antigravity is supported in dedicated worker execution mode. Gemini CLI integration is actively undergoing evaluation.',
        ],
        bullets: [
          'Codex: Authenticated via standard CLI sign-in or custom OpenAI API tokens.',
          'Claude Code: Authenticated through Claude CLI OAuth subscription or Anthropic setup.',
          'Grok Build: Authenticated via xAI developer access with HTTP bridge discovery.',
          'OpenCode: Supported via local CLI adapter with on-demand tool discovery.',
        ],
      },
      {
        id: 'work-personal-segregation',
        question: 'How does Jackalope separate Work and Personal account profiles?',
        paragraphs: [
          'Many developers maintain both a personal AI subscription and a corporate enterprise account. Running agents directly from a shell often leads to accidental token clobbering when environment variables like ANTHROPIC_API_KEY or OPENAI_API_KEY collide.',
          'Jackalope introduces Multi-Account Profiles. You can register separate Work and Personal account profiles for any provider. Each profile maintains its own isolated configuration path, OAuth credentials, and capacity telemetry.',
          'You can assign accounts globally or bind specific profiles to individual repositories. For example, your open-source side projects can default to your Personal Claude account, while client repositories automatically use your Work Codex profile.',
        ],
      },
      {
        id: 'keychain-storage',
        question: 'Where and how are agent credentials stored on the local machine?',
        paragraphs: [
          'Jackalope never writes raw secret tokens, private keys, or OAuth refresh tokens to plaintext JSON or YAML files on disk. Credential persistence is managed through native OS security perimeters via the Windows Credential Manager (DPAPI), macOS Keychain, or Linux Secret Service.',
          'The application profile directory (JACKALOPE_PROFILE_DIR) stores only metadata: account names, profile identifiers, and provider mappings. Sensitive keys are retrieved into memory on demand only for the duration of a task attempt and are scrubbed upon process termination.',
        ],
        callout: {
          kind: 'important',
          text: 'Credentials never leave your machine. Jackalope does not maintain a cloud proxy or central database of user API keys. All agent network communication originates directly from the local CLI processes on your host.',
        },
      },
      {
        id: 'credential-drift',
        question: 'How do I diagnose and fix expired auth tokens or CLI credential drift?',
        paragraphs: [
          'If a provider token expires or the CLI is logged out outside of Jackalope, tasks dispatched to that agent may fail with an authentication error. Jackalope detects these errors during the preflight sanity check and displays an actionable notice.',
        ],
        codeBox: {
          title: 'Re-authenticating Agent CLIs',
          code: `# Re-authenticate Codex CLI
codex login

# Re-authenticate Claude Code CLI
claude login

# Verify CLI detection in terminal
which codex || where codex
which claude || where claude`,
        },
      },
      {
        id: 'execution-boundaries',
        question: 'How are project-level tool allowlists and execution boundaries enforced?',
        paragraphs: [
          'Each project configured in Jackalope can define strict execution boundaries. You can specify which agents are permitted to run, restrict which models can be invoked, and define tool allowlists.',
          'For instance, you can grant an agent read-only repository access and test-runner execution permissions while forbidding filesystem modifications outside the assigned worktree or blocking external network requests.',
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
    readingTime: '6 min read',
    sections: [
      {
        id: 'central-broker',
        question: 'What is the centralized MCP broker and how does it deliver tools across agents?',
        paragraphs: [
          'Configuring Model Context Protocol (MCP) servers individually for every agent CLI (editing separate config files for Claude, Codex, Grok, etc.) is tedious, error-prone, and leads to port collisions.',
          'Jackalope features a centralized MCP Broker. You configure your database servers, API bridges, documentation searchers, and custom tools once in Jackalope. The broker delivers those capabilities dynamically to whichever agent is currently executing the task.',
          'Codex and Claude Code receive tools through standard project connections; Grok connects via an on-demand loopback HTTP bridge; OpenCode receives dynamic discovery payloads.',
        ],
      },
      {
        id: 'tool-gating',
        question: 'How does project tool gating prevent unauthorized actions or mutations?',
        paragraphs: [
          'Not every agent task needs access to write-heavy tools like database migrations or live deployment APIs. Jackalope implements granular Tool Gating.',
          'You can restrict tool visibility by repository, task effort tier, or individual task intent. A simple frontend UI polish task can be given access to browser screenshot tools while access to cloud infrastructure tools is completely masked from the agent’s schema.',
        ],
      },
      {
        id: 'browser-engine',
        question: 'How does the built-in headless browser daemon operate safely?',
        paragraphs: [
          'Jackalope bundles a pinned, local headless browser daemon (owned and supervised by src-tauri/src/commands/browser.rs). Agents can take screenshots of running web apps, inspect rendered DOM nodes, and evaluate visual layout without needing third-party cloud browser services.',
          'Every browser session uses a disposable local profile that is automatically destroyed when the task finishes. Cookies, local storage, and history are wiped, preventing cross-task data contamination.',
        ],
        bullets: [
          'Seven standardized tools: navigate, click, type, screenshot, get_dom, evaluate, and scroll.',
          'Disposable browser profiles prevent session pollution across unrelated projects.',
          'Screenshots are saved directly to attempt-bound artifact directories for your inspection.',
        ],
      },
      {
        id: 'question-bridge',
        question: 'How does the human-in-the-loop question bridge work when agents need input?',
        paragraphs: [
          'When an agent encounters ambiguous requirements, missing environment variables, or critical architectural forks, it shouldn’t guess or silently crash. Jackalope provides a native interactive Question Bridge.',
          'When an agent calls the question tool, Jackalope suspends the agent process, surfaces a focused prompt in the desktop UI, and emits a discreet notification. Once you provide your choice or type an answer, execution seamlessly resumes with your guidance injected into context.',
        ],
      },
      {
        id: 'debugging-mcp',
        question: 'How do I configure and debug custom stdio or SSE MCP servers?',
        paragraphs: [
          'You can configure custom MCP servers in Jackalope under Settings → MCP Tools. Jackalope supports both local stdio processes and remote SSE / HTTP endpoints.',
        ],
        codeBox: {
          title: 'Example MCP Configuration (jackalope-mcp.json)',
          code: `{
  "servers": {
    "sqlite-docs": {
      "command": "uvx",
      "args": ["mcp-server-sqlite", "--db-path", "./data/docs.db"],
      "transport": "stdio"
    },
    "staging-api": {
      "url": "http://127.0.0.1:8080/sse",
      "transport": "sse"
    }
  }
}`,
        },
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
    readingTime: '5 min read',
    sections: [
      {
        id: 'window-grants',
        question: 'What is the local security perimeter and how do window grants work?',
        paragraphs: [
          'Unlike reckless automation tools that take over your entire desktop and click arbitrary coordinates on your monitors, Jackalope implements an explicit Window Grant security architecture.',
          'An agent is never granted global desktop access. Instead, grants are attempt-scoped to specific, user-selected application windows. The agent can only read pixels, inspect accessibility trees, and synthesize input within the bounded rectangular coordinates of that granted window.',
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
        question: 'How does single-lease input ownership prevent conflicting native clicks?',
        paragraphs: [
          'Native input synthesis requires a single, exclusive lease. Only one task attempt can hold an input lease at any given instant. If a second task attempts to request desktop control while a lease is active, the request is safely queued or rejected.',
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
    readingTime: '6 min read',
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
        question: 'How do I clear stale Git index locks (.git/index.lock or worktree locks)?',
        paragraphs: [
          'If an agent process is forcefully terminated (e.g. power loss, machine reboot, or killing a task via Task Manager), Git may leave behind stale lockfiles such as .git/index.lock or .git/worktrees/<name>/locked.',
          'These lockfiles prevent subsequent Git operations with errors like Fatal: Unable to create .git/index.lock: File exists. Once you have confirmed that no active Git or agent processes are running, you can safely remove stale lockfiles.',
        ],
        codeBox: {
          title: 'Clearing Stale Git Lockfiles',
          code: `# 1. Ensure no git or agent processes are running
# 2. Check for and remove the index lockfile in root
rm -Force .git/index.lock

# 3. Check for and remove worktree-specific index locks
rm -Force .git/worktrees/*/index.lock

# 4. Prune orphaned worktree registrations
git worktree prune -v`,
        },
      },
      {
        id: 'history-recovery',
        question: 'How does atomic SQLite history recovery restore interrupted tasks?',
        paragraphs: [
          'Jackalope stores task metadata, attempt logs, check outputs, and user decisions in a local SQLite database located in your application profile directory. Write operations use write-ahead logging (WAL) and atomic transactions.',
          'If an unexpected shutdown occurs while a task is executing, Jackalope detects unclosed attempt records on the next launch. It marks the interrupted attempt with an Interrupted status, preserves all written logs and partial patches, and gives you a one-click Resume or Discard action in the Tasks view.',
        ],
      },
      {
        id: 'diagnostic-bundles',
        question: 'How do I generate and inspect a diagnostic support bundle?',
        paragraphs: [
          'If you encounter an unexpected issue or need assistance from the Jackalope team, you can generate an anonymized diagnostic bundle directly within the app under Settings → Updates & support.',
          'The diagnostic bundle inspects installed CLI versions, worktree health, SQLite schema integrity, recent error traces, and system display metrics. It strictly scrubs all repository paths, code content, prompts, and personal tokens before export.',
        ],
        bullets: [
          'Available at Settings → Updates & support → Export Diagnostics.',
          'Generates a local, human-readable JSON report.',
          'Includes CLI version detection, native OS build, and worktree status.',
          'All private file paths, prompts, and credentials are redacted.',
        ],
      },
      {
        id: 'verification-checklist',
        question: 'What is the pre-support verification checklist?',
        paragraphs: [
          'Before opening a support ticket or reporting a bug, running these four quick checks resolves over 90% of local environment issues:',
        ],
        bullets: [
          '1. Verify your agent CLI runs standalone in terminal (e.g. claude --version or codex --version).',
          '2. Verify your Git status is clean and git worktree list returns valid paths.',
          '3. Check Settings → Agents to confirm your chosen default agent is detected with a green checkmark.',
          '4. Check Settings → Updates & support to confirm you are running the latest Jackalope release.',
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
    readingTime: '4 min read',
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
          '3. Re-launch Jackalope. On startup, the native coordinator scans system PATH directories and updates Settings → Agents with a verified green status checkmark.',
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
    readingTime: '4 min read',
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
        question: 'What is the safe step-by-step procedure to remove stale locks?',
        paragraphs: [
          'Before deleting any lockfile, always verify that no background Git process is actively writing to disk:',
        ],
        codeBox: {
          title: 'Safe Lock Removal Recipe (PowerShell)',
          code: `# 1. Verify no active git processes are running
Get-Process -Name git, git-remote-https -ErrorAction SilentlyContinue

# 2. Check if primary index.lock exists and remove it
if (Test-Path .git/index.lock) {
    Remove-Item -Force .git/index.lock
    Write-Host "Removed root index.lock"
}

# 3. Check for worktree-specific index locks
Get-ChildItem -Path .git/worktrees -Filter "index.lock" -Recurse | Remove-Item -Force

# 4. Prune administrative records for deleted worktrees
git worktree prune -v`,
        },
      },
      {
        id: 'preventing-locks',
        question: 'How do I prevent file lock contention on Windows?',
        paragraphs: [
          'On Windows, third-party antivirus scanners and search indexers frequently lock newly written files inside .git/ and .worktrees/. Adding your development repository directory to Windows Defender’s exclusion list eliminates up to 95% of unexpected file-locking delays and index collisions during parallel agent runs.',
        ],
        callout: {
          kind: 'tip',
          text: 'In Windows Security, navigate to Virus & threat protection settings → Exclusions → Add an exclusion → Folder, and add your development root.',
        },
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
    readingTime: '5 min read',
    sections: [
      {
        id: 'mcp-overview',
        question: 'What is the Model Context Protocol (MCP) and how does Jackalope use it?',
        paragraphs: [
          'The Model Context Protocol (MCP) is an open standard that allows AI agents to interact with external tools, databases, documentation engines, and APIs through a standardized JSON-RPC interface.',
          'Instead of configuring MCP connections inside individual agent dotfiles, Jackalope acts as a central broker. You add your servers once in the desktop app, and Jackalope manages process lifecycles, health checks, and tool delivery to all connected agents.',
        ],
      },
      {
        id: 'stdio-setup',
        question: 'How do I connect a local stdio MCP server (e.g. SQLite or Filesystem)?',
        paragraphs: [
          'Local stdio servers run as child processes supervised by Jackalope. You specify the executable binary and command-line arguments:',
        ],
        codeBox: {
          title: 'Configuring stdio MCP Server in Settings',
          code: `# Example 1: Local SQLite database documentation server
Command: uvx
Args:    ["mcp-server-sqlite", "--db-path", "./data/warehouse.db"]

# Example 2: Local GitHub repository context server
Command: npx
Args:    ["-y", "@modelcontextprotocol/server-github"]
Env:     {"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."}`,
        },
      },
      {
        id: 'sse-setup',
        question: 'How do I connect a remote or containerized SSE / HTTP MCP server?',
        paragraphs: [
          'For servers running inside Docker containers or on your local network, use the Server-Sent Events (SSE) transport. Jackalope establishes a persistent HTTP connection to the server’s SSE stream and routes JSON-RPC messages seamlessly.',
        ],
        codeBox: {
          title: 'Configuring SSE MCP Server',
          code: `# Example: Remote documentation search server
URL:       http://127.0.0.1:8080/sse
Transport: Server-Sent Events (SSE)`,
        },
      },
      {
        id: 'enforcing-tool-gating',
        question: 'How do I restrict tool access to prevent accidental database or cloud writes?',
        paragraphs: [
          'Under Project Context → Tools, you can toggle tool permissions on a per-project basis. Tools can be set to Allowed, Ask for Confirmation (which triggers the interactive Question Bridge before execution), or Blocked.',
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
    readingTime: '5 min read',
    sections: [
      {
        id: 'why-schedules',
        question: 'Why run coding agent tasks on recurring schedules?',
        paragraphs: [
          'Certain engineering tasks should happen proactively rather than waiting for user requests: daily dependency vulnerability checks, nightly test suite refactors, documentation drift scans, or automated codebase health reports.',
          'Jackalope includes a native recurring task scheduler. Tasks execute in isolated Git worktrees during scheduled intervals, run test checks, generate verification receipts, and prepare candidate patches for your morning review.',
        ],
      },
      {
        id: 'cadence-options',
        question: 'What schedule cadences and cron formats are supported?',
        paragraphs: [
          'Jackalope provides pre-built common cadences (Daily at specified time, Weekly on chosen days, or Every N Hours) as well as full standard 5-field cron syntax for advanced timing.',
        ],
        codeBox: {
          title: 'Supported Schedule Expressions',
          code: `# Common Cadences
Daily at 08:00 AM      -> 0 8 * * *
Weekly every Monday    -> 0 9 * * 1
Every 6 hours          -> 0 */6 * * *

# Advanced Cadence
Weekdays at midnight   -> 0 0 * * 1-5`,
        },
      },
      {
        id: 'safe-execution',
        question: 'How do scheduled tasks prevent interference with active development?',
        paragraphs: [
          'Scheduled tasks follow all standard Jackalope concurrency rules: they acquire coordinator reservations, isolate work in .worktrees/schedule-<id>, run outside user working directories, and never automatically merge code without human review.',
          'If your machine is asleep or offline during a scheduled trigger, Jackalope safely skips the missed execution or alerts you on wake-up without executing duplicate backlog storms.',
        ],
      },
    ],
  },

  // 11. Dedicated Feature Guide: Task Composer & Effort Levels (Workflows)
  {
    slug: 'task-composer-and-effort-levels',
    category: 'workflows',
    title: 'Task Composer, Quick/Balanced/Thorough Effort & Pierre Diffs',
    shortTitle: 'Coding-agent tasks & effort levels',
    description:
      'Formulating task intents, choosing between Quick, Balanced, and Thorough effort tiers, prompt refinement, and reviewing patches with Pierre Diffs.',
    readingTime: '6 min read',
    sections: [
      {
        id: 'effort-tiers',
        question: 'What is the difference between Quick, Balanced, and Thorough effort levels?',
        paragraphs: [
          'Different tasks require different levels of rigor and computational depth. Jackalope structures agent runs into three distinct effort tiers:',
        ],
        bullets: [
          'Quick (Fast feedback): Optimized for one-file bugfixes, typos, documentation updates, and small UI tweaks. Bounded token limits and rapid execution.',
          'Balanced (Default): Ideal for typical feature work, multi-file edits, writing unit tests, and refactoring related modules. Balanced reasoning and validation depth.',
          'Thorough (Maximum rigor): Designed for complex architectural migrations, deep security audits, and difficult debugging tasks. Allows broad codebase search, multi-step subagents, and extensive test runs.',
        ],
      },
      {
        id: 'prompt-refinement',
        question: 'How does prompt refinement clarify underspecified requirements?',
        paragraphs: [
          'Before launching a heavy background task, you can click Refine in the task composer. Jackalope analyzes your intent against the project codebase map, identifying ambiguities, missing edge cases, and relevant test targets.',
          'Refinement produces a structured, actionable outcome contract that keeps the agent focused and minimizes wasted inference cycles.',
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
    readingTime: '5 min read',
    sections: [
      {
        id: 'harmonies',
        question: 'What are Single, Duo, and Trio theme harmonies?',
        paragraphs: [
          'Jackalope’s visual design system is built around color harmonies calculated mathematically in HSL space to guarantee WCAG AA contrast (minimum 4.5:1 for body text, 7:1 for accents).',
        ],
        bullets: [
          'Single (Monochrome harmony): One focused accent hue applied across borders, active selections, and indicators.',
          'Duo (Complementary harmony): Two balanced hues separated by 180° for vibrant secondary accents.',
          'Trio (Triadic harmony): Three balanced hues separated by 120° producing rich, dynamic shell gradients.',
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
        question: 'What do the five mascot companion moods signify?',
        paragraphs: [
          'The bottom-right Jackalope mascot is an authentic status and activity indicator, not a synthetic decoration. Its expressions reflect real system states:',
        ],
        bullets: [
          'Idle: Grounded pose with gentle breathing, occasional blinks, and subtle mouse gaze.',
          'Thinking: Ears perked and attentive when agents are performing model reasoning or task routing.',
          'Working: Energetic posture when background processes are editing files, running compilers, or executing tests.',
          'Question: Curious posture when the Question Bridge is waiting for human input.',
          'Celebration: Joyful reaction when a task finishes with all test receipts passing.',
        ],
      },
    ],
  },
];
