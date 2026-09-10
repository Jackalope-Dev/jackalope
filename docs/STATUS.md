# Current status

Jackalope is prerelease software. Source implementation does not establish
installed-app or release acceptance. See [release requirements](RELEASE.md),
[contributor priorities](TODO.md) and the [roadmap](ROADMAP.md).

## Implemented

- Optional [local-agent setup](LOCAL-AI.md) with hardware guidance, explicit downloads,
  file/session checks and isolated OpenCode/Ollama accounts. Real-model and installed
  acceptance remain open. Model-free documentation retrieval and lossless routing
  prompt packing are implemented; MiniLM bundling was evaluated and skipped.

- Local projects, tasks, saved ideas, persistent history and recovery.
- Durable incremental output saves, concurrent history loading, changed-record UI
  updates and background rich rendering. Local fixtures show improvements;
  [installed performance acceptance](PERFORMANCE.md) remains open.
- Codex, Claude Code, Grok Build, OpenCode, Kimi Code and Antigravity adapters, with
  [provider-specific limits](AGENT-SUPPORT.md).
- Agent accounts, model selection, reported usage, capacity-aware routing and
  bounded quota handoff. Explicit assignments and continuation identities stay pinned.
- Parallel queues, isolated worktrees, task checkpoints, checks, patch review and
  guarded integration with recoverable cleanup.
- Repository-aware feature planning with complete request preservation, optional verified
  predecessor snapshots, critical-path scheduling, structured coordination reports and
  workspace-scoped verification. Execution timings and repeatable evaluation trials are
  implemented; measured quality improvements and installed acceptance remain open. See
  [execution evaluation](EXECUTION-EVALUATION.md).
- Project guidance, editable lessons, codebase maps and task outcome insights.
- More selective automatic guidelines, compact tool guidance and retrievable
  verification output, with independent before/after [quality trials](AGENT-QUALITY.md).
  These checks do not establish broad provider or GUI superiority.
  The first repeated comparison passed 2/6 versus 6/6 behavioral oracles; raw usage
  increased while tokens per passing result decreased. See the trial limits and
  separate verification-permission follow-up in the quality report.
- Recurring schedules and local monitors that act on committed content changes.
- MCP connections, task-owned browser sessions and guarded desktop-control grants.
- Ask Jackalope documentation answers and reviewed local actions, with a focused
  chat panel and shared context/notification controls in its header settings.
- Shared appearance controls, onboarding and optional portable settings sync.
  Account device details distinguish default and isolated profiles and show app
  versions, account checks and settings checks; deployment and installed acceptance
  of the additional metadata remain open.
  Agent characters share the brand's layered silhouettes and theme colors, with
  distinct working/input poses and reduced-motion support.
- Required account access in every desktop build, with optional feedback,
  reporting and update services, plus a
  product website with agent-specific setup (including Kimi Code), compatibility
  tables separating execution from usage limits, worked workflow guides, sourced
  comparisons, sample-workspace media and a Reddit community link. The knowledgebase
  has practical steps, related help, searchable guides, captioned short demos and
  contextual screenshots.
- Homepage features use illustrated cards with expandable details. Field notes use
  a responsive illustrated masonry index, with new articles on parallel handoffs,
  focused guidance and task-history performance. Chromium checks cover 1280×840,
  960×640 and 375px layouts, both themes, reduced motion, keyboard details/links
  and article navigation. Card text contrast passes in both themes; Safari and
  touch-device checks remain open.
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
- macOS and X11 desktop-control helpers, permission readiness UI and portable
  keyboard labels are ready for native validation. Linux recorded 277 passing
  library tests; the final X11 control fixture and XWayland rejection check pass.
  macOS compilation and device acceptance remain open; Wayland control is unimplemented.

Platform-preparation verification (2026-09-10): the resumed Windows `pnpm verify`
passed with 287 native tests (17 ignored), 145 desktop tests, 108 service tests,
45 release tests and both production builds. Native macOS CI and device acceptance
remain required; the [platform audit](CROSS-PLATFORM-RELEASES.md) records Linux evidence.

The [documentation index](README.md), [contribution guide](../CONTRIBUTING.md) and
[licensing guide](LICENSING.md) cover source development and redistribution.

Ask panel browser fixtures cover context persistence, keyboard focus, theme-preview
rollback and light/dark layouts at 1280×840 and 960×640. Installed helper checks
remain open.

Account device fixtures cover same-name profiles, metadata, legacy records and scoped
revocation at 1280×840, 960×640 and 375px in both themes. Settings-sync browser checks
cover restore/conflict, in-flight opt-out, deletion and theme rollback. These fixtures
do not establish installed restoration or deployed metadata acceptance.

Migration check (2026-09-10): local applied `0014_sequenzy_audience.sql` and
`0015_desktop_metadata.sql`; staging and production applied `0015_desktop_metadata.sql`,
with all earlier migrations already present. Before/after checks used each configured
database. All three now record 15 applied migrations, all six device metadata columns
and no pending migrations. This confirms schema readiness, not application deployment.

## Known limits

Kimi supports task tokens, membership quota, direct MCP, structured questions, routing
and Ask Jackalope. OpenCode has direct MCP delivery; Grok has model discovery;
Antigravity has read-only subscription quota reporting. Authenticated installed-app
acceptance remains open. See the [capability audit](AGENT-SUPPORT.md#capability-audit).
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
Native desktop-control helpers for macOS and Linux X11 are implemented for validation.
Isolated X11 control trials pass; macOS compilation and device checks remain open.
Wayland desktop control still needs a compositor-specific implementation. Notification activation,
tray behavior and Dock reopening need installed desktop acceptance. See the
[feature-by-feature platform audit](CROSS-PLATFORM-RELEASES.md#source-readiness-audit-2026-09-10).

Remote execution, monetary budgets and team collaboration are future work.
Automated checks and browser fixtures do not establish installed execution,
message delivery or service acceptance. Follow [CONTRIBUTING.md](../CONTRIBUTING.md)
for local verification and [cross-platform requirements](CROSS-PLATFORM-RELEASES.md)
for native release checks.
