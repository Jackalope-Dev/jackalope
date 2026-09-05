# Jackalope

Jackalope is a desktop operator for projects and tasks across user-selected
agents, accounts and machines. It is being built with Tauri/Rust and React,
with a focused workspace, personal color themes and an animated jackalope companion.

**Current stage: early desktop prototype.** The interface and some native
primitives work; the complete agent orchestration journey is still under
development. The [product audit](docs/PRODUCT-AUDIT.md) documents known gaps.
The [vision](docs/VISION.md) and [roadmap](docs/ROADMAP.md) describe intended scope.

## Available today

- Shared vector branding, animated companion, theme color field and atmosphere.
- Live theme preview with cancel/save, keyboard controls and component lab.
- Workspace navigation, task-board/dialog UI and locally persisted records.
- Native Git worktree list/create and basic process/PTY commands.

Agent accounts, prompt refinement, schedules, browser automation, codebase maps
and devices still contain demonstration behavior. In particular, the fleet
input currently writes to a shell, not a configured agent; do not treat it as a
natural-language agent dispatcher. Real authentication, central MCP connections,
task execution/review, scheduling and remote operation remain to be implemented.

## Product direction

The goal is a complete path from intent to reviewed result: real project setup,
multiple agents and existing accounts, useful automatic prompt/context
supplementation, isolated work, central connections and tools, schedules,
project/codebase understanding, and grounded usage guidance. The eventual
remote companion will support multiple devices through self-hosted or managed
infrastructure. These are commitments, not claims about the current prototype.

See [DESIGN.md](docs/DESIGN.md) for the refined, intentional experience standard
and [OPERATOR.md](docs/OPERATOR.md) for ownership of context, tools and continuity.

## Develop locally

Use Node 24 (tested with 24.18.0), the pnpm version pinned in `package.json`,
and Rust/Cargo plus platform build prerequisites for native desktop work.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

The browser preview runs at `http://localhost:5173`; `/design-lab.html` renders
the shared character and theme controls. Browser IPC is mocked. Several current
feature demos also use fixtures in the native app; see [STATUS.md](docs/STATUS.md).

```powershell
pnpm build
pnpm --filter @jackalope/desktop test:visual-state
pnpm lint
pnpm tauri dev
```

A successful frontend build is not native feature verification. See
[the native runbook](.claude/skills/run-jackalope-desktop/SKILL.md) for Windows
launch/inspection guidance and [the workflow skill](.agents/skills/jackalope-workflow/SKILL.md)
for project checks.

## Repository and handoff

- `apps/desktop/src`: UI, stores, theme engine and IPC bridge.
- `apps/desktop/src-tauri`: native Git/process/system/PTY commands.
- [STATUS.md](docs/STATUS.md): verified behavior and immediate priorities.
- [TODO.md](docs/TODO.md): open work and acceptance checks.
- [ARCHITECTURE.md](docs/ARCHITECTURE.md): actual interfaces and proposed boundaries.
- [USAGE-AND-ROUTING.md](docs/USAGE-AND-ROUTING.md): usage, connected capacity,
  best-fit routing and proactive proposal plans.
- [AGENTS.md](AGENTS.md): collaboration and commit rules.

Native startup, memory and responsiveness budgets still need measured baselines.
Dependency reuse, accessibility, commercially permissive licensing and clear
extension contracts are delivery requirements.

Licensed under [Apache-2.0](LICENSE).
