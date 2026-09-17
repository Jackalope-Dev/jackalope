# Roadmap

The roadmap describes direction, not release dates or a guarantee of availability.
[STATUS.md](STATUS.md) summarizes implemented behavior;
[TODO.md](TODO.md) lists contributor priorities.

The website uses apps/website/src/roadmap-content.ts for its interactive roadmap
and discovery output. Keep its Built, In progress, Up next and Further out stages
aligned with this guide when capabilities or priorities change.

## Built: the local workspace

- Projects, saved tasks, chat sessions and reviewed plans with isolated Git worktrees.
  Follow-ups, previews, recorded checks and guarded integration keep work reviewable.
- Provider accounts, model/effort choices, capacity-aware routing and usage reporting.
  Decisions can use local rules, an agent or optional Jev assistance.
- Scoped parallel coordination, dependency snapshots, bounded verification repairs
  and provider delegation with sequential fallback.
- Recurring schedules, local change monitors, project lessons, codebase maps, MCP
  connections, browser tools and Ask Jackalope.
- Shared appearance, guided setup, history recovery, archiving and optional local
  usefulness ratings. Optional local-model setup checks editing and continuation.
- Account connection, waitlist/referral progress, platform download guidance and
  optional settings sync, feedback and reporting.

These capabilities describe source behavior. Provider, platform, delivery and
installed-app acceptance remain separate. See [current capabilities and limits](STATUS.md)
for the detailed inventory and [contributor priorities](TODO.md) for outstanding checks.

## In progress: dependable everyday use

Focused task guidance and retrievable compact verification output are implemented.
[Quality trials](AGENT-QUALITY.md) compare the changed behavior against a preserved
baseline; broader provider comparisons and independent acceptance remain in progress.

Durable incremental history saves, concurrent loading, changed-record UI updates
and background rich rendering are implemented. Local [performance fixtures](PERFORMANCE.md)
exercise these contracts; installed startup, memory and responsiveness acceptance remains open.

Validate first-run setup, agent sign-in and switching, recovery, accessibility and
large-project performance in installed builds. Complete signing, installation,
updates and secure storage for each intended platform. Required account access
in every build, optional settings sync, feedback and delivery need their own acceptance checks.
Cross-platform discovery, browser, process cleanup, credential storage and notification
hardening are implemented for native testing, including notification activation,
account/settings sync, Unix process guardians and tray/Dock recovery. macOS and X11
window-control helpers and a GNOME 46 Wayland extension are implemented for validation.
Installed acceptance remains in progress. Cross-platform signing and branch-based
release automation use Windows Store and Mac/Linux Cloud candidates. In-app Store
update checks and installation are implemented for validation; live signing, publication and
installed upgrades remain acceptance work,
with Ubuntu 24.04/GNOME 46 the first Wayland acceptance target and X11 compatibility
retained. Other compositors and GNOME versions remain unsupported.

## Up next: broader workflows

Extend agent execution support, explicitly authorized GitHub publication and review
actions, repository understanding and usage reporting. Develop enforced monetary budgets and inspectable
routing guidance. Proactive proposals require opt-in scope, bounded cost and
explicit approval. Recovery must preserve ownership and never silently replay
unfinished work. See [usage and routing](USAGE-AND-ROUTING.md).

## Further out: work across machines

Explore scoped identity, trusted-host pairing, remote dispatch, steering, review
and reconnect. A companion could support remote task check-ins. Managed and
self-hosted remote services, shared workspaces and team collaboration depend on
validated individual remote workflows. These are exploratory directions;
remote execution is not available today. See [BACKEND.md](BACKEND.md).
