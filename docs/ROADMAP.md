# Roadmap

The roadmap describes direction, not release dates or a guarantee of availability.
[STATUS.md](STATUS.md) summarizes implemented behavior;
[TODO.md](TODO.md) lists contributor priorities.

The website uses apps/website/src/roadmap-content.ts for its interactive roadmap
and discovery output. Keep its Built, In progress, Up next and Further out stages
aligned with this guide when capabilities or priorities change.

## Built: the local workspace

Projects, agent accounts, tasks, queues, Git worktrees, checks and reviewed
integration are implemented. The workspace also includes schedules, local change
monitors, MCP connections, browser sessions, project lessons, codebase maps,
capacity-aware routing and Ask Jackalope. Provider and platform limits apply;
implementation does not establish release acceptance.

## In progress: dependable everyday use

Validate first-run setup, agent sign-in and switching, recovery, accessibility and
large-project performance in installed builds. Complete signing, installation,
updates and secure storage for each intended platform. Optional account services,
settings sync, feedback and delivery need their own acceptance checks.
Cross-platform discovery, browser, process cleanup, credential storage and notification
hardening are implemented for native testing. macOS/Linux desktop-control backends,
notification activation and signed release acceptance remain in progress.

## Up next: broader workflows

Extend agent execution support, GitHub issue/review/CI integration, repository
understanding and usage reporting. Develop measured budgets and inspectable
routing guidance. Proactive proposals require opt-in scope, bounded cost and
explicit approval. Recovery must preserve ownership and never silently replay
unfinished work. See [usage and routing](USAGE-AND-ROUTING.md).

## Further out: work across machines

Explore scoped identity, trusted-host pairing, remote dispatch, steering, review
and reconnect. A companion could support remote task check-ins. Managed and
self-hosted remote services, shared workspaces and team collaboration depend on
validated individual remote workflows. These are exploratory directions;
remote execution is not available today. See [BACKEND.md](BACKEND.md).
