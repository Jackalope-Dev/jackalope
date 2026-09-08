export interface KnowledgeItem {
  id: string;
  category: KnowledgeCategory;
  title: string;
  summary: string;
  details: string[];
  bullets?: string[];
  command?: string;
  codeSnippet?: string;
  tags: string[];
  isFaq?: boolean;
}

export type KnowledgeCategory =
  | 'quickstart'
  | 'agents'
  | 'worktrees'
  | 'routing'
  | 'tasks'
  | 'mcp'
  | 'usage'
  | 'troubleshooting'
  | 'security'
  | 'experience';

export interface CategoryMeta {
  id: KnowledgeCategory;
  name: string;
  shortDescription: string;
  iconName: string;
}

export const knowledgeCategories: CategoryMeta[] = [
  {
    id: 'quickstart',
    name: 'Quick Start & Setup',
    shortDescription: 'Project setup, Git prerequisites, and running your first agent task.',
    iconName: 'Sparkles',
  },
  {
    id: 'agents',
    name: 'Agents & Accounts',
    shortDescription:
      'Configuring Codex, Claude Code, Grok, OpenCode, local LLMs, and account profiles.',
    iconName: 'Bot',
  },
  {
    id: 'worktrees',
    name: 'Worktrees & Concurrency',
    shortDescription:
      'How isolated Git worktrees prevent collisions during parallel task execution.',
    iconName: 'GitBranch',
  },
  {
    id: 'routing',
    name: 'Task Routing & Quota Handoff',
    shortDescription: 'Default-agent coordination, quota window tracking, and automatic failovers.',
    iconName: 'Cpu',
  },
  {
    id: 'tasks',
    name: 'Task Workflow & Review',
    shortDescription: 'Effort levels, prompt refinement, question bridge, and guarded integration.',
    iconName: 'Layers3',
  },
  {
    id: 'mcp',
    name: 'MCP Hub & Tool Integration',
    shortDescription: 'Connecting Model Context Protocol servers and the built-in browser engine.',
    iconName: 'Plug',
  },
  {
    id: 'usage',
    name: 'Usage & Rate Limits',
    shortDescription: 'Tracking token headroom, provider capacity windows, and exportable logs.',
    iconName: 'ChartNoAxesColumn',
  },
  {
    id: 'troubleshooting',
    name: 'Troubleshooting Playbook',
    shortDescription: 'Diagnostic recipes, error resolution steps, and CLI verification commands.',
    iconName: 'Wrench',
  },
  {
    id: 'security',
    name: 'FAQ & Local Security Perimeter',
    shortDescription: 'Code privacy, local SQLite persistence, offline behavior, and licensing.',
    iconName: 'ShieldCheck',
  },
  {
    id: 'experience',
    name: 'Atmosphere & Companion',
    shortDescription: 'Theme harmonies, 64-step atmosphere, mascot reactions, and shortcuts.',
    iconName: 'Palette',
  },
];

export const knowledgeItems: KnowledgeItem[] = [
  // --- Quick Start & Setup ---
  {
    id: 'qs-first-project',
    category: 'quickstart',
    title: 'How do I add a local repository to Jackalope?',
    summary:
      'Open the project dropdown in the top header chrome, click "Add a project…", and choose any local Git repository directory on your computer.',
    details: [
      'Jackalope connects directly to your local file system. It reads Git metadata through fast, isolated reads (using gix with Git fallback) to detect the current branch, remote origins, and codebase topology without modifying your project files.',
      'Once added, you can configure project-specific instructions, allowed agents, default sign-in profiles, and scoped MCP connections under Project Settings.',
    ],
    bullets: [
      'Your repository and code remain strictly on your local machine.',
      'Existing gitignore rules, submodules, and branch pointers are honored automatically.',
      'Switch between multiple repositories instantly using the project switcher in the header chrome.',
    ],
    tags: ['add project', 'repository', 'first run', 'git setup', 'onboarding'],
  },
  {
    id: 'qs-prerequisites',
    category: 'quickstart',
    title: 'What prerequisites are required before starting tasks?',
    summary:
      'You need Git installed locally on your PATH and at least one supported coding agent CLI (Codex, Claude Code, Grok, or OpenCode) signed into your provider account.',
    details: [
      'Jackalope is the operator, harness, and review environment for your coding agents. It does not package proprietary AI model weights or subscriptions; you bring the agent CLIs you already trust and use.',
      'Jackalope checks for Git availability and scans your system PATH for recognized agent binaries during startup. You can re-scan detected agents at any time in Settings → Agents.',
    ],
    command: 'git --version && codex --version',
    tags: ['prerequisites', 'requirements', 'git', 'cli', 'installation', 'path'],
    isFaq: true,
  },
  {
    id: 'qs-first-task',
    category: 'quickstart',
    title: 'How do I create and run my first parallel task?',
    summary:
      'Press Ctrl+Shift+N (or ⌘ Shift N on macOS) or click "New task" to open the Task Composer, describe what needs to be changed, select an effort level, and click Start.',
    details: [
      'The Task Composer allows you to enter a plain-language prompt or brief. Jackalope helps refine vague prompts into concrete criteria and can suggest decomposing large features into coordinated parallel tasks with explicit dependencies.',
      'When you start a task, Jackalope allocates a dedicated, isolated Git worktree so the agent works in its own clean directory without locking or dirtying your main workspace.',
    ],
    bullets: [
      'Choose Quick for focused fixes, Balanced for features, or Thorough for large refactors.',
      'Assign an agent explicitly or choose Automatic to let the coordinator pick the best available agent.',
      'Follow live terminal output, inspect generated diffs, and review checks before integrating.',
    ],
    tags: ['new task', 'composer', 'effort tier', 'parallel execution', 'start task'],
  },
  {
    id: 'qs-keyboard-shortcuts',
    category: 'quickstart',
    title: 'What keyboard shortcuts are available in the desktop app?',
    summary:
      'Jackalope provides fast keyboard shortcuts for command palette jumping, task creation, settings, and tab switching.',
    details: [
      'Use Ctrl+K (⌘K on macOS) to open the Command Palette and jump directly to any view, theme, or settings category.',
      'Use Ctrl+Shift+N (⌘ Shift N) from anywhere in the app to capture a new task immediately without leaving your current screen.',
      'Use Ctrl+, (⌘,) to access Preferences & Settings, and Escape to dismiss open overlays, modals, and palettes.',
    ],
    command: 'Ctrl + K (Jump) | Ctrl + Shift + N (New task) | Ctrl + , (Settings)',
    tags: ['shortcuts', 'hotkeys', 'keyboard', 'command palette', 'accessibility'],
    isFaq: true,
  },

  // --- Agents & Multi-Account Profiles ---
  {
    id: 'agents-supported',
    category: 'agents',
    title: 'Which coding agents are natively supported?',
    summary:
      'Jackalope includes native streaming adapters for Codex, Claude Code, Grok Build, and OpenCode, with Antigravity supported as a worker.',
    details: [
      'Native adapters communicate directly with each CLI tool through typed process ownership, streaming stdout/stderr events, structured question handling, and execution receipts.',
      'Codex and Claude Code receive project-selected MCP tool connections directly over stdio, HTTP, or SSE. Grok uses on-demand HTTP discovery. OpenCode runs using its own local CLI provider configuration.',
    ],
    bullets: [
      'Codex: Full support for stdio and HTTP tool connections, questions, and usage reports.',
      'Claude Code: Full tool connection support, in-app question bridge, and continuation sessions.',
      'Grok Build: High-speed execution with on-demand discovery through the coordinator bridge.',
      'OpenCode: Multi-model CLI supporting local, free, or self-hosted model configurations.',
      'Antigravity: Supported as an execution worker; automatic coordinator role is reserved for CLI default agent.',
    ],
    tags: ['codex', 'claude code', 'grok', 'opencode', 'antigravity', 'adapters'],
    isFaq: true,
  },
  {
    id: 'agents-multi-account',
    category: 'agents',
    title: 'How do Work and Personal account profiles work?',
    summary:
      'Create named account profiles (e.g., "Work" and "Personal") for supported agents to keep provider sign-ins and configurations strictly segregated.',
    details: [
      'In Settings → Agents (or the Agents view), expand the Accounts section for any supported agent. Click "Add profile", name it, and launch "Sign in". Jackalope launches the agent’s own authentication flow in an isolated configuration directory.',
      'You can assign specific accounts to specific projects in Project Settings → Agents. For instance, your client repository can be locked to your "Work" account, while your open-source side project uses "Personal".',
    ],
    bullets: [
      'Zero password pasting: Jackalope never sees or stores your API secrets or provider credentials.',
      'Task continuations stay pinned to the profile that started them, preventing accidental cross-account billing.',
      'Note: Account profiles separate configuration directories; they are not an OS-level sandbox against local filesystem access.',
    ],
    tags: [
      'accounts',
      'profiles',
      'work personal',
      'authentication',
      'sign in',
      'billing segregation',
    ],
  },
  {
    id: 'agents-local-llms',
    category: 'agents',
    title: 'How does Jackalope discover and connect to local LLMs?',
    summary:
      'Jackalope automatically detects local inference servers including Ollama, LM Studio, and llama.cpp on their standard local ports.',
    details: [
      'When you open the Local Models & Ambient Keys scanner in Settings → Agents, Jackalope tests loopback connectivity on standard local ports (Ollama on 11434, LM Studio on 1234, llama.cpp on 8080).',
      'Detected local models can be registered directly as OpenCode or custom endpoints, enabling 100% private, zero-cost, offline agent workflows.',
    ],
    command: 'ollama list || curl http://127.0.0.1:11434/api/tags',
    tags: ['local llm', 'ollama', 'lm studio', 'llama.cpp', 'offline models', 'private inference'],
    isFaq: true,
  },
  {
    id: 'agents-cross-model-review',
    category: 'agents',
    title: 'What is Cross-Model Peer Review?',
    summary:
      'Cross-Model Review allows a second, distinct AI model (e.g., Claude Code reviewing a patch written by Codex) to provide a neutral critique before code integration.',
    details: [
      'Single-model self-review often suffers from blind spots. Jackalope can submit the generated patch and task brief to an alternative configured model.',
      'The reviewing model evaluates syntax correctness, security implications, edge cases, and documentation fidelity, surfacing categorized findings and an approval verdict directly in the review panel.',
    ],
    tags: ['cross-model review', 'second opinion', 'peer review', 'code quality', 'audit'],
  },
  {
    id: 'agents-custom-flags',
    category: 'agents',
    title: 'Can I specify custom CLI flags or model overrides?',
    summary:
      'Yes. In Settings → Agents, you can configure allowed models, default effort instructions, and custom CLI invocation arguments per agent.',
    details: [
      'You can restrict which models each agent is allowed to use, preventing accidental usage of expensive preview models. During task composition, you can also override the model directly for that specific attempt.',
    ],
    tags: ['model overrides', 'cli flags', 'agent settings', 'custom arguments'],
  },

  // --- Worktrees & Concurrency ---
  {
    id: 'worktrees-why',
    category: 'worktrees',
    title: 'Why does Jackalope use isolated Git worktrees?',
    summary:
      'Git worktrees allow multiple agents to work on independent branches simultaneously without file collision, merge thrashing, or blocking your active checkout.',
    details: [
      'Running multiple coding agents inside a single shared working directory leads to file corruption, overwritten edits, and impossible git diffs. A Git worktree gives each task its own isolated directory and HEAD pointer while sharing the same underlying `.git` object database.',
      'Worktrees are created automatically under `.worktrees/<task-id>` or custom project paths. When a task completes, Jackalope lets you review the changes cleanly, run tests, and perform a guarded fast-forward integration.',
    ],
    tags: ['worktrees', 'parallel', 'isolation', 'concurrency', 'git branches'],
    isFaq: true,
  },
  {
    id: 'worktrees-cleanup',
    category: 'worktrees',
    title: 'How does Jackalope protect against accidental data loss in worktrees?',
    summary:
      'Active tasks lock their worktree. Jackalope inspects git status and unmerged commits before allowing any worktree removal, offering safe "Archive and remove" if uncommitted changes exist.',
    details: [
      'Jackalope will never delete a worktree that contains unintegrated edits without explicit confirmation. If you want to clean up an abandoned task, Jackalope can generate an archive patch bundle so you can restore your experimental work at any time.',
      'You can inspect and manage all active, locked, and merged worktrees from the Worktrees view in the Project tab.',
    ],
    tags: ['cleanup', 'archive', 'data protection', 'unmerged commits', 'locked worktree'],
  },
  {
    id: 'worktrees-branch-management',
    category: 'worktrees',
    title: 'How are branch pointers and target commits managed during parallel runs?',
    summary:
      'Each task resolves against an explicit target commit. Dependent tasks in a parallel plan wait until prerequisite tasks are integrated before dispatching.',
    details: [
      'When tasks are part of a decomposed parallel feature plan, Jackalope coordinates their execution graph. Independent tasks run simultaneously; dependent tasks remain queued.',
      'Before integration, Jackalope validates that the target branch has not moved unexpectedly, ensuring deterministic verification.',
    ],
    tags: ['branches', 'dependencies', 'dag', 'target branch', 'fast-forward'],
  },

  // --- Routing & Quota Handoff ---
  {
    id: 'routing-auto-coordinator',
    category: 'routing',
    title: 'How does automatic task routing work?',
    summary:
      'When a task is set to "Automatic", the default agent evaluates the task prompt, required tools, project preferences, and fresh provider quota headroom to pick the best agent.',
    details: [
      'The coordinator preflights candidate agents against project restrictions, required tool transports (stdio, HTTP, SSE), and remaining capacity. It atomically reserves conservative headroom for the task so that concurrent dispatches do not exceed local quotas.',
      'Tasks that require specific tools are routed only to agents with verified compatible adapters. If a provider is near capacity, the coordinator prioritizes secondary eligible agents.',
    ],
    tags: ['automatic routing', 'coordinator', 'quota check', 'preflight', 'headroom reservation'],
  },
  {
    id: 'routing-quota-handoff',
    category: 'routing',
    title: 'What happens when an agent hits a provider 429 or quota exhaustion?',
    summary:
      'Jackalope immediately stops the owned process tree, preserves all workspace edits and context in the worktree, and seamlessly hands the task off to an eligible alternative agent.',
    details: [
      'Provider rate limits (HTTP 429, daily token cap, or 5-hour rolling window exhaustion) typically cause agent sessions to fail completely. In Jackalope, recognized quota errors trigger automatic task handoff:',
      '1. The runtime cleanly halts the current agent process tree without losing files.',
      '2. The existing task history, question responses, partial diffs, and check receipts are packaged.',
      '3. A pre-ranked fallback agent is launched inside the exact same worktree to continue the task seamlessly.',
      'Jackalope permits up to 3 bounded handoffs per attempt, recording each transition in Usage so token consumption is accurately attributed.',
    ],
    bullets: [
      'All code written by the first agent is preserved on disk.',
      'The fallback agent receives the original task intent and the previous worker summary.',
      'If no alternative is configured or eligible, execution stops with work safely preserved for manual resumption.',
    ],
    tags: ['429 rate limit', 'quota handoff', 'automatic failover', 'fallback', 'resilience'],
    isFaq: true,
  },
  {
    id: 'routing-windows',
    category: 'routing',
    title: 'How does Jackalope track rolling 5-hour quota windows?',
    summary:
      'For providers with short rolling windows (such as Codex), Jackalope monitors reported quota consumption and blocks preflight dispatch if the window is exhausted.',
    details: [
      'Rather than launching a task only to fail thirty seconds later on an exhausted quota, Jackalope’s capacity client reads reported window metrics.',
      'If a provider reports 100% consumption on its rolling window, the coordinator skips it during preflight and routes to an alternate available agent.',
    ],
    tags: ['5-hour window', 'rolling quota', 'preflight blocking', 'rate limit'],
  },

  // --- Task Workflow & Review ---
  {
    id: 'tasks-effort-tiers',
    category: 'tasks',
    title: 'What do Quick, Balanced, and Thorough effort levels do?',
    summary:
      'Effort tiers control the depth of planning, exploration, and verification instructions passed to the agent runtime.',
    details: [
      'Quick: Prioritizes fast, minimal-step changes for typo fixes, minor bugs, or targeted tweaks. Skips deep dependency analysis.',
      'Balanced: The standard workflow for features and bugfixes. Explores project conventions, makes changes, and executes project test commands.',
      'Thorough: Instructs the agent to perform extensive architecture analysis, generate exhaustive test cases, verify edge cases, and run full test suites before returning.',
    ],
    tags: ['effort levels', 'quick', 'balanced', 'thorough', 'planning depth'],
  },
  {
    id: 'tasks-question-bridge',
    category: 'tasks',
    title: 'How does the interactive question bridge work?',
    summary:
      'When an agent needs clarification or human permission, Jackalope suspends the task and surfaces an interactive question directly in the app UI and companion mascot.',
    details: [
      'Agents do not stall silently in background terminal tabs. When an agent issues a prompt or tool permission request, Jackalope generates a prioritized notification, changes the mascot expression to "inquiring", and displays the question in Task Detail.',
      'You can answer or provide extra direction directly from the app; your input is streamed right back to the agent session.',
    ],
    tags: ['questions', 'permissions', 'human in the loop', 'notifications', 'mascot'],
  },
  {
    id: 'tasks-guarded-integration',
    category: 'tasks',
    title: 'What is snapshot-bound code review and guarded integration?',
    summary:
      'Jackalope binds test and lint receipts to exact git commit hashes, requiring verification before permitting fast-forward branch integration.',
    details: [
      'Jackalope avoids "invisible merges". Code review displays rich Pierre Diffs and Streamdown markdown output showing exactly what changed.',
      'Checks (such as `pnpm test` or `cargo test`) are tied to the exact working tree snapshot. If files change after tests pass, checks are marked stale. Integration verifies that the target branch has not diverged before performing an atomic fast-forward.',
    ],
    tags: [
      'code review',
      'pierre diffs',
      'snapshot verification',
      'guarded integration',
      'git merge',
    ],
    isFaq: true,
  },
  {
    id: 'tasks-repo-todos',
    category: 'tasks',
    title: 'How do Repo TODOs work?',
    summary:
      'Jackalope can parse repository TODO comments, markdown task lists, and roadmap items into structured, ready-to-run agent briefs.',
    details: [
      'In the Repo TODOs view (accessible via the Project tab or Ctrl+K), Jackalope discovers uncompleted TODOs while preserving markdown formatting, CRLF line endings, and code fence blocks.',
      'You can click any TODO item to convert it into a pre-populated Task Composer brief with attached context.',
    ],
    tags: ['repo todos', 'todo comments', 'backlog intake', 'markdown tasks'],
  },
  {
    id: 'tasks-windows-desktop-control',
    category: 'tasks',
    title: 'How does native Windows desktop window control work?',
    summary:
      'Active tasks can be granted temporary, explicit control of a specific Windows desktop window for screenshots, clicks, keystrokes, and UI testing.',
    details: [
      'On Windows, Jackalope allows users to explicitly delegate one window to an active task. The agent can capture window snapshots, send literal keyboard input, and perform mouse clicks.',
      'Access is strictly human-granted for that specific attempt and can be revoked instantly with the Stop button or when the task completes.',
    ],
    tags: ['windows control', 'ui testing', 'desktop automation', 'window capture', 'clicks'],
  },

  // --- MCP Hub & Tool Integration ---
  {
    id: 'mcp-overview',
    category: 'mcp',
    title: 'What is Model Context Protocol (MCP) and how does Jackalope use it?',
    summary:
      'MCP allows coding agents to access local tools, databases, APIs, and file systems through a standardized protocol.',
    details: [
      'Jackalope acts as a central MCP hub for all your agents. Instead of configuring SQLite or GitHub MCP servers separately in four different CLI config files, you manage them once in Jackalope’s MCP tab.',
      'You can toggle which MCP servers are delivered to specific projects, preventing agents in sensitive repositories from accessing unrelated external tools.',
    ],
    bullets: [
      'Transports: Stdio (command-line binaries), HTTP, and Server-Sent Events (SSE).',
      'Scoped access: Allow or deny tools at the global or project level.',
      'Live tool inspection: View tool schemas, test invocations, and read logs directly in the app.',
    ],
    tags: ['mcp', 'tools', 'model context protocol', 'stdio', 'sse', 'hub'],
    isFaq: true,
  },
  {
    id: 'mcp-browser-automation',
    category: 'mcp',
    title: 'How does the built-in browser automation engine work?',
    summary:
      'Jackalope includes an internal, isolated headless browser daemon that agents can invoke for web research, testing web apps, and capturing visual screenshots.',
    details: [
      'The browser engine (`browser.rs`) runs locally with a clean, disposable profile for each task. It exposes safe browser tools (navigation, element clicking, text input, screenshot capture) to the agent.',
      'All screenshots taken during task execution are saved as durable evidence artifacts that you can inspect in the Evidence tab during code review.',
    ],
    tags: ['browser automation', 'screenshots', 'web testing', 'evidence', 'headless engine'],
  },
  {
    id: 'mcp-marketplace-privacy',
    category: 'mcp',
    title: 'How does MCP Marketplace privacy and opt-out work?',
    summary:
      'The MCP Marketplace allows discovering pre-vetted MCP servers. You can completely disable marketplace network queries in Settings → Privacy.',
    details: [
      'If you prefer not to fetch external catalog lists or are working in an air-gapped environment, toggle off "Enable MCP Marketplace" in Settings → Privacy.',
      'When disabled, all external searches and detail fetches are blocked, and you retain full ability to add custom local stdio or HTTP MCP tools manually.',
    ],
    tags: ['mcp marketplace', 'privacy opt-out', 'network policy', 'air gap'],
  },

  // --- Usage & Rate Limits ---
  {
    id: 'usage-dashboard',
    category: 'usage',
    title: 'How do I track token usage, quotas, and costs across providers?',
    summary:
      'The Usage tab provides a unified dashboard of reported token consumption, session counts, and remaining quota windows filtered by project, agent, or account.',
    details: [
      'When agents report token usage, Jackalope records prompt tokens, completion tokens, and estimated costs. You can drill down into individual task attempts or export filtered datasets to CSV and JSON.',
      'For providers with rolling quota limits (such as Codex’s 5-hour window), Jackalope shows current consumed percentage so you can plan workloads without hitting sudden lockouts.',
    ],
    tags: ['usage dashboard', 'token tracking', 'quota windows', 'costs', 'csv export'],
    isFaq: true,
  },
  {
    id: 'usage-attribution',
    category: 'usage',
    title: 'Are coordinator routing calls counted separately from worker attempts?',
    summary:
      'Yes. Jackalope separates routing evaluation tokens from task execution tokens so your metrics accurately reflect implementation costs.',
    details: [
      'When an automatic task is analyzed by the default agent for routing, the decision tokens are recorded under a dedicated routing attribution record.',
      'If a task is handed off after an interruption, previous worker tokens and fallback worker tokens are preserved without duplicating the initial decision totals.',
    ],
    tags: ['attribution', 'decision receipts', 'routing tokens', 'audit log'],
  },

  // --- Troubleshooting Playbook ---
  {
    id: 'trouble-cli-not-found',
    category: 'troubleshooting',
    title: 'Agent CLI not detected ("Command not found" or missing in PATH)',
    summary:
      'If Jackalope shows an agent as uninstalled or unavailable, verify that its executable is located in your system environment PATH.',
    details: [
      'When Jackalope launches, it inherits the system environment PATH. On macOS and Linux, CLIs installed via npm, brew, or cargo may be located in `~/.nvm/versions`, `~/.cargo/bin`, or `/opt/homebrew/bin`.',
      'Test CLI availability in your terminal with the command below. After installing or updating PATH, open Settings → Agents in Jackalope and click "Re-scan agents".',
    ],
    command: 'which codex || which claude || which grok || which opencode',
    codeSnippet: `# If installed via npm globally:
npm list -g --depth=0

# Ensure the npm global bin directory is on your PATH:
export PATH="$(npm prefix -g)/bin:$PATH"`,
    tags: ['cli not found', 'path', 'rescan', 'npm install', 'binary missing', 'diagnostics'],
    isFaq: true,
  },
  {
    id: 'trouble-auth-expired',
    category: 'troubleshooting',
    title: 'Agent authentication expired or profile sign-in failed',
    summary:
      'Re-authenticate the agent profile directly inside Jackalope or test credentials from your terminal.',
    details: [
      'Provider OAuth tokens or session cookies periodically expire. When an agent fails with authentication errors, navigate to Settings → Agents → Accounts.',
      'Find the affected profile and click "Sign in". Jackalope will launch the agent’s native login handshake in its isolated profile directory.',
    ],
    command: 'codex login --help',
    tags: ['authentication', 'oauth', 'token expired', 'login failed', 'credentials'],
  },
  {
    id: 'trouble-worktree-locked',
    category: 'troubleshooting',
    title: 'Git worktree locked or cannot remove worktree directory',
    summary:
      'Worktrees locked by active tasks can be unlocked or safely cleaned up once the task finishes or is explicitly stopped.',
    details: [
      'If Jackalope was closed unexpectedly during an active task, a worktree lock file may remain. In the Worktrees tab, inspect the blocked reason. If the task is no longer running, click "Archive & remove" or unlock the worktree.',
      'You can also prune stale Git worktree metadata using standard Git commands in your terminal:',
    ],
    command: 'git worktree prune -v',
    codeSnippet: `# View all registered worktrees and their status:
git worktree list --porcelain

# If a worktree directory was manually deleted from disk:
git worktree prune`,
    tags: ['worktree locked', 'git lock', 'prune', 'cleanup error', 'stale worktree'],
  },
  {
    id: 'trouble-mcp-timeout',
    category: 'troubleshooting',
    title: 'MCP server connection refused or timed out',
    summary:
      'Verify that the MCP command path is valid, executable, and not blocked by local firewalls or missing runtime dependencies.',
    details: [
      'For stdio MCP servers, check that the runtime (such as `npx`, `python`, or `uvx`) is available. For HTTP/SSE servers, verify that the target port is open and listening.',
      'In the MCP tab, click on the failing server and inspect the connection logs. You can trigger a manual "Test connection" to see immediate handshake responses.',
    ],
    command: 'curl -I http://127.0.0.1:3000/sse',
    tags: ['mcp error', 'connection refused', 'timeout', 'port', 'stdio crash'],
  },
  {
    id: 'trouble-git-line-endings',
    category: 'troubleshooting',
    title: 'Windows Git CRLF vs LF line-ending warnings',
    summary:
      'Configure Git core.autocrlf to preserve consistent line endings and prevent unnecessary diff churn across worktrees.',
    details: [
      'On Windows, Git may convert line endings to CRLF, causing cross-platform diff noise or test failures in POSIX-standard tools.',
      'Run the command below to configure Git to checkout Windows-style but commit LF-style, or add a `.gitattributes` file with `* text=auto`.',
    ],
    command: 'git config --global core.autocrlf true',
    codeSnippet: `# .gitattributes recommended rule
* text=auto eol=lf`,
    tags: ['crlf', 'line endings', 'git config', 'windows diff', 'formatting'],
  },
  {
    id: 'trouble-history-recovery',
    category: 'troubleshooting',
    title: 'How do I recover from an interrupted task or unexpected shutdown?',
    summary:
      'Jackalope never drops interrupted work; it preserves partial diffs, output journals, and worktrees with a visible recovery banner.',
    details: [
      'If the app terminates during an active task, Jackalope quarantines unreadable files and displays an "Interrupted Task" notice on next launch.',
      'Click "Inspect recovery" to review what was written. You can choose to continue the task with feedback, archive the worktree patch, or discard the attempt safely.',
    ],
    tags: ['interrupted task', 'crash recovery', 'unsaved changes', 'quarantine', 'continuity'],
  },
  {
    id: 'trouble-diagnostics-report',
    category: 'troubleshooting',
    title: 'How do I generate an unredacted local support report?',
    summary:
      'Open Settings (Ctrl+, or ⌘,) → Updates & support, and click "Preview support report".',
    details: [
      'Jackalope generates a sanitized JSON report containing your app version, operating system, hardware architecture, detected agents, and task outcome counts.',
      'The report strictly excludes account credentials, project paths, code snippets, prompts, and git commit messages. You can inspect the complete JSON in the preview window and copy it to your clipboard for support assistance.',
    ],
    tags: ['support report', 'diagnostics', 'debug logs', 'app version', 'system info'],
  },

  // --- FAQ & Local Security Perimeter ---
  {
    id: 'faq-code-privacy',
    category: 'security',
    title: 'Does Jackalope send my source code or repositories to the cloud?',
    summary:
      'No. Your repositories, code, tasks, and history live 100% locally on your computer. Jackalope does not have a central code ingestion server.',
    details: [
      'All task execution, Git worktrees, and history records remain on your local disk inside `JACKALOPE_PROFILE_DIR`.',
      'When an agent runs, it communicates directly with its own AI provider (OpenAI, Anthropic, xAI, etc.) under your personal account and that provider’s data policies. Jackalope does not proxy, inspect, or intercept model payloads on a remote server.',
    ],
    bullets: [
      'Zero proprietary repository uploads to Jackalope servers.',
      'Local coordinator runs on an isolated local loopback socket.',
      'Optional anonymous telemetry can be toggled off at any time in Settings → Privacy.',
    ],
    tags: ['privacy', 'security', 'cloud', 'local storage', 'data policy', 'telemetry'],
    isFaq: true,
  },
  {
    id: 'faq-subscription',
    category: 'security',
    title: 'Do I need to pay for Jackalope to use my coding agents?',
    summary:
      'Jackalope is a bring-your-own-agent desktop workspace. You use your existing provider subscriptions (e.g., ChatGPT Plus/Pro, Claude Pro/Team, xAI, or local models).',
    details: [
      'Jackalope does not resell API credits or add markups to token usage. Provider subscription fees or API usage costs are billed directly by OpenAI, Anthropic, or xAI through your own accounts.',
    ],
    tags: ['pricing', 'subscription', 'api keys', 'billing', 'cost'],
    isFaq: true,
  },
  {
    id: 'faq-platforms',
    category: 'security',
    title: 'Which operating systems and platforms are supported?',
    summary:
      'Jackalope is built with Tauri and Rust for cross-platform desktop performance on Windows 10/11, macOS (Apple Silicon and Intel), and Linux.',
    details: [
      'The current public preview is available for Windows x64. macOS and Linux builds are undergoing native process and PTY acceptance testing and will be released following the verification schedule.',
    ],
    tags: ['platforms', 'windows', 'macos', 'linux', 'system requirements'],
    isFaq: true,
  },
  {
    id: 'faq-offline',
    category: 'security',
    title: 'Can Jackalope work offline or without internet access?',
    summary:
      'Yes. Project exploration, Git worktrees, task history review, diff inspection, and local CLI agents (like OpenCode with local models) work completely offline.',
    details: [
      'Only cloud-hosted agents (Codex, Claude, Grok) and external MCP servers require internet connectivity to reach their respective provider APIs. All UI and workspace features operate locally.',
    ],
    tags: ['offline', 'local models', 'airplane mode', 'no internet'],
    isFaq: true,
  },
  {
    id: 'faq-data-reset',
    category: 'security',
    title: 'How can I back up or completely reset my local data?',
    summary:
      'Use Settings → Data & reset to export your configuration or perform an atomic factory reset.',
    details: [
      'Click "Export configuration" to copy your non-sensitive project settings, themes, and agent preferences to your clipboard.',
      'If you wish to wipe local databases, task histories, and saved worktrees, the "Reset all local data" option performs an atomic wipe and returns Jackalope to first-time setup.',
    ],
    tags: ['backup', 'export', 'factory reset', 'wipe', 'data management'],
  },

  // --- Atmosphere & Companion ---
  {
    id: 'exp-theme-harmonies',
    category: 'experience',
    title: 'How do Single, Duo, and Trio color harmonies work?',
    summary:
      'Jackalope generates balanced companion hues and live gradients across your workspace from a single primary color.',
    details: [
      'Click the ArcColorPicker in the header chrome to open the Theme Editor. Choose Single for a pure monochrome accent, Duo for a complementary pairing, or Trio for an energetic triadic harmony.',
      'All action buttons maintain high contrast (contrast-safe 4.5:1 ratios) regardless of the chosen hue, ensuring full accessibility across both light and dark modes.',
    ],
    tags: ['theme', 'harmonies', 'single duo trio', 'color picker', 'arc inspired', 'contrast'],
    isFaq: true,
  },
  {
    id: 'exp-atmosphere-slider',
    category: 'experience',
    title: 'What does the Atmosphere slider control?',
    summary:
      'Atmosphere controls surface tint depth across your workspace, reaching up to 64 for rich ambient color.',
    details: [
      'Atmosphere tints cards, sidebars, and title chrome with a wash of your chosen harmony colors.',
      'The slider features a tactile 44px vertical pill handle with fluid drag responsiveness. Status indicators (like git diffs and error badges) automatically adapt their brightness when high atmosphere is active to preserve contrast.',
    ],
    tags: ['atmosphere', 'tint', 'ambient', 'slider', 'surfaces'],
  },
  {
    id: 'exp-mascot-moods',
    category: 'experience',
    title: 'How does the Jackalope companion mascot behave?',
    summary:
      'The bottom-right mascot companion reflects real app activity across five distinct moods and idle gestures.',
    details: [
      'The five activity moods are: idle (grounded resting pose), thinking (analyzing or planning), working (executing task), inquiring (awaiting your answer), and celebrating (task passed checks).',
      'When idle, the companion blinks occasionally and follows pointer movement. When reduced motion is preferred by your operating system, pointer gaze and playful animations pause immediately while keeping status expressions clear.',
    ],
    tags: ['mascot', 'companion', 'moods', 'gestures', 'reduced motion', 'notifications'],
  },
];
