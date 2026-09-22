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
        title: 'A workspace that fits how you work.',
        summary: 'Focus, Build and Oversee layouts, task terminals and separate windows.',
        detail:
          'Choose a project layout, keep review beside the conversation, or focus on work that needs you. Open a shell in the task workspace, hand its files to an installed editor, or pop out a result, review, preview or terminal. Group chat messages into reversible topics and prepare source-linked task drafts. Saved feedback returns to the task before sending. Incremental session updates and optional local timing exports support performance investigation. Installed acceptance and comparisons of real workflow efficiency remain in progress.',
      },
      {
        title: 'Feedback where the work happens.',
        summary: 'Line comments, visual selections, and issues that become task drafts.',
        detail:
          'Comment on changed lines and collect feedback into one follow-up. Keep the conversation beside Review or Preview. Select an element in a persistent preview browser to capture its current state, screenshot and style context. Browse GitHub, Linear and Jira issues, then review the task draft before starting. These workflows use the existing workspace controls and remain subject to installed acceptance.',
      },
      {
        title: 'Your place before early access.',
        summary: 'Waitlist progress and referral sharing in the desktop app.',
        detail:
          'Verified waitlist members can connect the app, check their position, copy their referral link and share message, and explore the website and app tour. Connections survive restarts and detect approval. The download page shows desktop platform availability and guides accepted members and friends through email confirmation. Running tasks still requires approved access; deployed and installed checks remain in progress.',
      },
      {
        title: 'From request to a result you can inspect.',
        summary: 'Shared work discovery, local previews, and a clear delivery handoff.',
        detail:
          'Tasks opens Chat first. Inbox keeps the shared work list with explicit project scope, remembered views, and command search. Each row shows the assigned agent, live or next-action status, and the next useful step. Isolated results keep review, merge into the target branch, and workspace cleanup together. Project overview helps you resume unfinished work. Short task titles keep full instructions in Details. Results lead with output, and review puts the diff beside checks and evidence. Compact follow-up and visible action buttons keep the next step clear. Queue a follow-up or explicitly stop current work and send; saved queues pause after failures and restart. Local previews remember setup and can capture fresh browser evidence for corrections. Delivery reads local Git and optional GitHub PR/CI state, then prepares editable handoff drafts. Publishing and deployment remain explicit steps. Installed acceptance and usability validation are still in progress.',
      },
      {
        title: 'Keep the ideas coming.',
        summary: 'A running conversation with a compact window you can pin.',
        detail:
          'Open Chat and send a message to start. Sessions keep your messages in one isolated workspace. Pause work, review the changes, run checks, and explicitly merge the latest result into your target branch. Queued messages must run or be canceled first. Saved integration receipts prevent work from restarting in the old workspace; continue in a new chat with the result attached. Pop out and pin conversations, preserve drafts, and pause later batches at optional batch or estimated-cost thresholds. Those thresholds are not billing caps. Installed-provider and window validation remain in progress.',
      },
      {
        title: 'A clearer path through daily work.',
        summary: 'Faster project setup, review checkpoints, and reusable task starters.',
        detail:
          'Project setup walks through your repository, agents, decisions, Git behavior, appearance, and an optional first task. Setup detects project commands automatically and preserves your saved choices. Chat surfaces work waiting across projects, and results remember the section you were reading. Track reviewed files, approve outcomes, and prepare a review request for another agent from the diff toolbar. Compare changes since your last review, inspect why lessons were included, and prepare editable issue, PR-feedback, CI-repair, or dependency-update requests. GitHub imports are read-only. Optional usefulness ratings and review minutes stay local to each task. Installed testing and observed daily-use trials remain open.',
      },
      {
        title: 'Your agents. One workspace.',
        summary: 'Projects, accounts, and context that stay with the task.',
        detail:
          'Codex, Claude Code, Grok Build, OpenCode, Kimi Code, Antigravity, and Gemini CLI adapters are implemented, with provider-specific limits. Kimi supports routing, structured questions, task tokens, and membership quota. Kimi and OpenCode accept direct project tools. Connect DeepSeek, OpenRouter and other supported API providers directly in Jackalope with protected keys and discovered models; Jackalope can prepare a private OpenCode runner on first connection, so a separate OpenCode installation or account is not required. That runner also serves configured helpers and local models. Account model preferences, integrity checks, repair and cleanup of idle runner versions are implemented; platform installation checks remain open. Grok models and Antigravity subscription quota are detected through their CLIs. Antigravity remains a worker. Antigravity named profiles use Gemini API keys with separate billing; its subscription login is shared. Named accounts, project preferences, saved ideas, and persistent task history keep work organized. Archive old tasks individually or in bulk, then undo or restore them while keeping results and workspaces. App-wide usage charts connect task, project, and agent spending to saved outcomes, with routing overhead and missing reports visible. Project decision preferences can use local rules, an agent, or Jev with a securely stored TypeSafe key. Jev fallback uses local rules by default, with an optional agent attempt that uses agent capacity. Optional Jev discovery ranks bounded tool descriptions, and local field selection can keep large tool results concise. A public benchmark methodology separates measured fixture results from unproven general savings. Queries over captured results, reusable source context, agent-callable Jev questions with direct evidence reads, and shadow Jev decisions have separate evaluation controls. End-to-end cost and quality improvements remain to be demonstrated. Installed-agent acceptance is still in progress.',
      },
      {
        title: 'A local way to get started.',
        summary: 'Optional models, clear download choices, and guided setup.',
        detail:
          'Local setup guides you through your computer’s requirements, OpenCode and Ollama installation, and an optional model download. A file edit and session check must pass before connection. Jackalope bundles no model weights. Help retrieves relevant documentation locally, while routing keeps every eligible model in consideration. Real-model quality, token savings, and installed setup still need validation.',
      },
      {
        title: 'One request, a reviewed approach.',
        summary: 'Project decision preferences guide task assessment and planning.',
        detail:
          'Review an approach, then follow Plan, Work, Check and Review in one task. Jackalope combines completed assignments, resolves overlapping changes in isolated workspaces and can repair failed checks within a bounded allowance. Review the complete result, preview and checks before applying changes. Local fast paths and reused assessments avoid extra model calls; usage includes planning and repair work. Codex speed controls, workspace context freshness, dependency scheduling and check capacity help reduce repeated work. Task timings show waits and execution. Installed-provider testing and comparisons including review and corrections remain in progress.',
      },
      {
        title: 'Room to work in parallel.',
        summary: 'Useful delegation, separate worktrees, and shared context.',
        detail:
          'Lead agents decide when available subagent tools can help and remain responsible for the combined result. Repository-aware plans preserve the full request. Parallel queues prioritize dependencies and share capacity across projects. Optional verified snapshots let dependent tasks continue before final review, with structured progress reports and recorded execution timings. Saved ownership handoffs, interface agreements, and changed-file reviews help agents coordinate across worktrees and block unresolved work before integration. Projects can opt into agent conflict resolution and verified local merging, with source worktrees retained. Installed acceptance and repeated quality evaluations remain in progress. Tasks save checkpoints with project-level commit attribution. Review the patch and message, then merge as one commit and clean up finished worktrees and branches. Worktrees separate changes; they do not sandbox an agent’s access to your computer.',
      },
      {
        title: 'Tools that travel with the work.',
        summary: 'In-app help, MCP connections, browser sessions, and recurring tasks.',
        detail:
          'Ask Jackalope connects your default agent to official help and reviewed changes to appearance, preferences, and tasks. External agents can use the same tools through an opt-in local MCP connection. Automatic project lessons learn from explicit preferences, resolved review feedback with matching checks, and repository patterns, with editable sources in Project context. Usage & quota brings account limits, reported tokens, task breakdowns, and export together on one page. The MCP marketplace starts with curated publisher tools, guided setup and connection checks; service sign-in remains account-specific. Codebase maps, task-owned browsers, hourly recurring tasks, and capacity-aware routing keep work connected. Local change-only monitors check committed content without model calls by default. With a connected key, optional Jev assistance can select relevant context, assess result coverage, prioritize review, filter unrelated changes and match Automatic assignments. Repository and model evidence, routing goals and separate assessment usage are implemented; savings and quality need live calibration.',
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
        title: 'Continue from another device.',
        summary: 'Trusted hosts and a responsive phone companion, in validation.',
        detail:
          'Pair a device, choose shared projects, and check tasks, answer questions, send follow-ups or review changes. Desktop hosts connect over SSH or HTTPS; phones use HTTPS with optional private Tailscale setup. Work stays on its host when a client disconnects. Native multi-device and platform acceptance remain in progress; this is not a released hosting service.',
      },
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
          'We’re preparing for macOS, Windows, and Linux, with agent detection, browsers, secure account storage, task notifications, and process cleanup ready for native testing. Account connections and settings sync are enabled across platforms. Window control includes macOS, Linux X11, and Ubuntu’s GNOME 46 Wayland desktop through an optional extension. Other Wayland desktops remain unsupported. Beta and stable release automation uses Microsoft Store for Windows and direct downloads for Mac and Linux. In-app Store update controls are prepared for testing. Device testing, signed installation, and upgrades still need acceptance; public downloads are not open yet.',
      },
      {
        title: 'The small things that earn trust.',
        summary: 'Keyboard access, performance, and feedback from early users.',
        detail:
          'Task updates, history loading, and rich rendering have local performance improvements. Concurrent account checks, focused codebase maps, scoped task guidance and reusable context help avoid repeated work. Ordinary tasks use concise instructions and final automatic saved checks, with local syntax caching. Connected tools can return selected data while keeping complete responses recoverable without repeating the remote call. OpenCode tasks compact recognized passing-test output while keeping diagnostics and full recovery files; fresh-profile setup and broader task benefits remain in validation. Local agents can use a separately checked title model, and local helpers can reuse short-lived servers. Further evaluation covers loading optional OpenCode tools only when requested and reusing source context across longer tasks. Matched tool and continuation comparisons retain correctness, complete-attempt usage, latency and missing measurements. Repository-derived repair fixtures, randomized review sets and an external repository benchmark adapter support testing. Comparisons preserve upstream grading and use the same agent with and without Jackalope. OpenCode tasks can surface permission requests and structured questions through a task-owned server. Provider effort and output filtering retain separate validation; broader savings claims still need independent confirmation. Installed startup, memory, accessibility, saved-data recovery, and external beta trials remain release work. Required account access, optional settings sync, and feedback flows also need installed-app and delivery checks before wider use.',
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
        summary: 'Broader execution support and measured workflow improvements.',
        detail:
          'Aider and Goose execution protocols are on the backlog. Account setup and model discovery do not yet mean those agents can run tasks. We also plan richer questions, permissions, and account controls for supported providers.',
      },
      {
        title: 'Carry reviewed work further.',
        summary: 'Deeper GitHub delivery and opt-in suggestions.',
        detail:
          'Build on read-only issue, review, and CI imports with guarded publication and review actions. Deeper repository understanding and opt-in proactive proposals should help you choose the next useful action, with destinations and authorization kept explicit.',
      },
      {
        title: 'A clearer picture of your limits.',
        summary: 'Richer usage coverage, measured budgets, and routing guidance.',
        detail:
          'Build on current capacity-aware routing, session pause thresholds, Codex/Claude effort requests, and usage attribution with broader provider reporting and enforced monetary budgets. Direct-CLI comparisons and offline routing evaluations are implemented; representative independent review remains open. Reported, estimated, stale, and unavailable usage should remain distinct. Recovery and failover will need clear ownership so unfinished work is never silently replayed.',
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
    next: 'Validate individual remote workflows before extending them to teams.',
    link: { label: 'Explore the local workflow', href: '/tour/' },
    items: [
      {
        title: 'More ways to work together.',
        summary: 'Shared workflows, team spaces, and hosting choices.',
        detail:
          'We intend to explore team collaboration and managed or self-hosted remote services after validating individual remote workflows. Shared remote workspaces are future work. We have not announced pricing or a release date for these plans.',
      },
    ],
  },
] as const;
