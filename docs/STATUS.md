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
- Ask Jackalope documentation answers and reviewed local actions.
- Shared appearance controls, onboarding and optional portable settings sync.
- An optional account/access, feedback, reporting and update service, plus a
  product website with agent-specific setup, worked workflow guides, sourced
  comparisons, sample-workspace media and a Reddit community link. The knowledgebase
  has practical steps, related help, searchable guides, captioned short demos and
  contextual screenshots.
- Windows installer, Microsoft Store and cloud-release preparation tooling.

The [documentation index](README.md), [contribution guide](../CONTRIBUTING.md) and
[licensing guide](LICENSING.md) cover source development and redistribution.

## Known limits

Gemini CLI, Aider and Goose do not yet support native task execution. Antigravity
named accounts use Gemini API-key mode; isolated subscription sign-ins remain
unsupported. Account or model discovery alone does not establish execution support.

Worktrees isolate Git changes, not process privileges. Contributor builds do not
require the hosted account service. Official beta builds can require approved
account access; see [monitoring and privacy](BETA-MONITORING.md).

Installed-agent account switching, routing, helper actions, tools, schedules,
checkpoint/integration recovery and automatic lessons need their corresponding
acceptance checks. Outcome comparisons are required before claiming that lessons
improve task quality. macOS/Linux secure storage, process lifecycle, packaging,
signed installation and update acceptance remain open.

Remote execution, monetary budgets and team collaboration are future work.
Automated checks and browser fixtures do not establish installed execution,
message delivery or service acceptance. Follow [CONTRIBUTING.md](../CONTRIBUTING.md)
for local verification and [cross-platform requirements](CROSS-PLATFORM-RELEASES.md)
for native release checks.
