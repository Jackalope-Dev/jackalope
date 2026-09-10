# Current status

Jackalope is prerelease software. Source implementation does not establish
installed-app or release acceptance. See [release requirements](RELEASE.md),
[contributor priorities](TODO.md) and the [roadmap](ROADMAP.md).

## Implemented

- Local projects, tasks, saved ideas, persistent history and recovery.
- Codex, Claude Code, Grok Build, OpenCode and Antigravity adapters, with
  [provider-specific limits](AGENT-SUPPORT.md).
- Agent accounts, model selection, reported usage, capacity-aware routing and
  bounded quota handoff. Explicit assignments and continuation identities stay pinned.
- Parallel queues, isolated worktrees, task checkpoints, checks, patch review and
  guarded integration with recoverable cleanup.
- Project guidance, editable lessons, codebase maps and task outcome insights.
- Recurring schedules and local monitors that act on committed content changes.
- MCP connections, task-owned browser sessions and Windows desktop-control grants.
- Ask Jackalope documentation answers and reviewed local actions, with a focused
  chat panel and shared context/notification controls in its header settings.
- Shared appearance controls, onboarding and optional portable settings sync.
  Agent characters share the brand's layered silhouettes and theme colors, with
  distinct working/input poses and reduced-motion support.
- Required account access in every desktop build, with optional feedback,
  reporting and update services, plus a
  product website with agent-specific setup, worked workflow guides, sourced
  comparisons, sample-workspace media and a Reddit community link. The knowledgebase
  has practical steps, related help, searchable guides, captioned short demos and
  contextual screenshots.
- Feature and workflow pages pair larger interface captures with short captioned
  clips, written walkthroughs and links into the guide. Recurring-task captures
  show paused sample schedules; media illustrates the UI, not native execution.
- Windows installer, Microsoft Store and cloud-release preparation tooling.
- Cross-platform source hardening for CLI detection, browsers, process/PTY cleanup,
  native credential stores and notifications, with macOS/Linux CI trial jobs.
- macOS/Linux account and settings-sync availability, task notification activation,
  Unix process guardians, Linux tray-host detection and macOS Dock reopening.
- Direct ownership of Unix Chromium processes, with Linux browser cancellation
  and isolated GNOME Keyring round-trip trials passing under WSL. Native Linux
  tests and the desktop executable build pass; installed desktop and macOS
  acceptance remain open.

The [documentation index](README.md), [contribution guide](../CONTRIBUTING.md) and
[licensing guide](LICENSING.md) cover source development and redistribution.

Ask panel browser fixtures cover context persistence, keyboard focus, theme-preview
rollback and light/dark layouts at 1280×840 and 960×640. Installed helper checks
remain open.

## Known limits

Gemini CLI, Aider and Goose do not yet support native task execution. Antigravity
named accounts use Gemini API-key mode; isolated subscription sign-ins remain
unsupported. Account or model discovery alone does not establish execution support.

Worktrees isolate Git changes, not process privileges. Contributor and release
builds require approved account access for new execution. Previously verified
accounts retain bounded offline access; saved work remains reviewable after expiry.
See [account access](DESKTOP-ACCOUNT.md) and [monitoring and privacy](BETA-MONITORING.md).

Installed-agent account switching, routing, helper actions, tools, schedules,
checkpoint/integration recovery and automatic lessons need their corresponding
acceptance checks. Outcome comparisons are required before claiming that lessons
improve task quality. macOS/Linux secure storage, process lifecycle, packaging,
signed installation and update acceptance remain open.
Native desktop control still needs macOS/Linux backends. Notification activation,
tray behavior and Dock reopening need installed desktop acceptance. See the
[feature-by-feature platform audit](CROSS-PLATFORM-RELEASES.md#source-readiness-audit-2026-09-10).

Remote execution, monetary budgets and team collaboration are future work.
Automated checks and browser fixtures do not establish installed execution,
message delivery or service acceptance. Follow [CONTRIBUTING.md](../CONTRIBUTING.md)
for local verification and [cross-platform requirements](CROSS-PLATFORM-RELEASES.md)
for native release checks.
