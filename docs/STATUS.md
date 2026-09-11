# Current capabilities and limits

Jackalope is prerelease software. This page describes source behavior, not a record
of completed trials or deployed environments. See [contributor priorities](TODO.md)
and [release requirements](RELEASE.md) for outstanding acceptance work.

## Desktop workspace

- Projects, saved task drafts, queues, recurring schedules and local change monitors.
- Tasks opens Chat first. Inbox keeps the project-scoped work list that includes chats,
  with remembered filters, compact capture and keyboard row navigation. Work rows show
  each agent's character, live or next-action status and who is working now. Task and
  project command search covers both.
  Project opens an overview with unfinished work, setup and recorded local deliveries.
- Result views prioritize unanswered questions, recovery and failed checks. Isolated
  work keeps review, merge into the target branch and workspace cleanup on the Review
  tab. Conversation, review, preview and delivery share vocabulary and reusable result
  tools; task follow-up remains visible while reading. Failed checks can send their
  output into the follow-up draft. Local previews remember project commands, choose a free
  port, check HTTP readiness and embed a sandboxed loopback page. Fresh isolated browser
  captures attach screenshots, page elements and errors to follow-up drafts; they do not
  reproduce embedded-page sign-in or unsaved interactions.
- Delivery inspects local Git state and optionally reads PR/CI through the GitHub CLI.
  PR, CI and deployment preparation carry evidence into editable drafts. Publishing and
  deployment remain explicit user-approved steps; a local merge does not establish either.
- Live sessions capture short messages while work runs, batch them in order in one
  isolated workspace, and retain drafts, results and cumulative patch exports. Chat
  starts a session from the first message and groups history automatically.
  Sessions can pop out into a compact window with an always-on-top pin. Dispatch pauses after
  failures or restart; installed-provider and native-window acceptance remain open.
- Codex, Claude Code, Grok Build, OpenCode, Kimi Code and Antigravity adapters with
  [provider-specific capabilities](AGENT-SUPPORT.md).
- Agent accounts, model choices, reported usage, capacity-aware routing and bounded
  quota handoff. Explicit assignments and continuation identities remain pinned.
- Isolated Git worktrees, task checkpoints, verification, snapshot-bound outcome
  acceptance, combined patch review and guarded integration with recoverable cleanup.
- Durable ownership handoffs, explicit interface agreements and changed-file scope
  checks gate dependent work and integration. Projects can opt into agent reconciliation
  and verified local merging; source worktrees remain available. See
  [coordination contracts](ORCHESTRATION-CAPABILITIES.md).
- Repository-aware plans, optional verified predecessor snapshots, dependency-aware
  scheduling, structured coordination reports and workspace verification reservations.
- Lead-agent guidance automatically assesses useful delegation through available
  provider subagent tools. Task capture has no split control; unsupported or denied
  delegation stays sequential. See [agent quality](AGENT-QUALITY.md) for boundaries.
- Individual and bulk task archiving with undo and restore, preserving results and workspaces.
  Durable incremental task saves, bounded concurrent history loading, recovery
  exports and [archive management](HISTORY-RECOVERY.md).
- Project guidance, editable lessons, codebase maps and task outcome insights.
- MCP connections, task-owned Chromium sessions and scoped desktop-window grants.
- Codex/Claude effort requests, focused isolated-task coordination, verification
  timeout alignment, usage attribution
  and direct-CLI quality comparisons with separate routing evaluation gates. See
  [agent quality](AGENT-QUALITY.md); automatic escalation and learned routing
  remain dependent on broader independent acceptance.
- Ask Jackalope documentation answers and reviewed local actions, backed by bounded
  model-free documentation retrieval. Optional [OpenCode/Ollama setup](LOCAL-AI.md)
  checks file edits and session continuation before connecting a local account.
- App-wide usage trends, project/agent/task breakdowns, measured routing overhead
  and usage by saved outcome, with missing reports and helper usage kept explicit.
- Shared appearance, guided onboarding, task notifications and optional settings sync.

## Services and distribution

New execution requires approved account access in every desktop build. Previously
verified accounts retain bounded offline access; saved work remains reviewable after
expiry. Feedback, reporting and settings sync have separate controls. See
[account access](DESKTOP-ACCOUNT.md) and [service boundaries](BACKEND.md).

The website provides setup and workflow guides, compatibility tables, sample-workspace
media and account flows. Its content is shared with bundled native help through
`packages/knowledge`. Build and release tooling covers Windows installers, optional
Microsoft Store distribution and unpublished cloud candidates.

The private admin console groups access management, audience preferences, product-note
drafts, service setup, aggregate usage and feedback, with overview links for onboarding
and email follow-ups. Configuration and connection counts do not establish delivery,
installation or completed tasks.

Windows uses DPAPI; macOS uses Keychain; Linux uses Secret Service. Unix discovery,
process guardians, browser ownership, notifications and tray/Dock behavior have
platform-specific implementations. Native CI and device checks are described in
[platform contracts](CROSS-PLATFORM-RELEASES.md#platform-contracts).

## Known limits

Gemini CLI, Aider and Goose account setup does not include native task execution.
Antigravity named accounts use Gemini API keys; isolated subscription accounts are
unsupported. Discovery and fixture responses do not establish real account execution.

Desktop control supports Windows and has macOS/X11 and GNOME 46 Wayland backends
for native validation. GNOME requires the bundled window-control extension and
explicit per-task window grants; other Wayland compositors remain unavailable.
XWayland alone is insufficient. Worktrees separate Git changes; agent processes and
configured tools still run with local OS privileges.

Installed provider, accessibility, recovery, performance, signed installation and
update acceptance remain platform-specific requirements. Real-model quality and
lesson/routing improvements require matched trials and independent review. Automated
checks do not establish service delivery or installed-app acceptance.

Remote execution, monetary budgets and team collaboration remain future work. Use
the [documentation index](README.md), [contribution guide](../CONTRIBUTING.md) and
[licensing guide](LICENSING.md) for development and redistribution.
