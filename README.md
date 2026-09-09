# Jackalope

Jackalope brings coding agents, tasks, Git worktrees and review into one cross-platform
workspace. Use your installed agent CLIs and existing sign-ins, keep changes
isolated, and review the result before integrating it.

**Prerelease.** The first launch is planned for macOS, Windows, and Linux. Signed update,
clean-profile and external beta acceptance remain in progress; see the
[current status](docs/STATUS.md) and [release gates](docs/RELEASE.md).

## What works today

- Project setup and saved ideas, with list and board views over the same tasks.
- Codex, Claude Code and Grok execution, account profiles, questions, stop and supported continuation.
- Parallel queues, isolated worktrees, saved checks, patch review and guarded Git integration.
- Recurring tasks with timezones, missed-run policy and pause controls while the app runs.
- Project-scoped MCP connections and per-task selection for supported adapters.
- Task-owned Chromium sessions and a local codebase map with bounded import resolution.
- Reported usage, connected capacity, persistent history and recovery notices.
- Light/dark/automatic appearance, shared theme controls and local fonts.

Automatic agent/model/account routing and bounded quota handoff are implemented;
see [routing behavior and limits](docs/USAGE-AND-ROUTING.md).
Remote execution, monetary budgets and broader recovery remain planned.
Developer builds have no configured reporting endpoint. Official builds can
configure opt-out usage reporting and explicit feedback through the optional
service; see [monitoring and privacy](docs/BETA-MONITORING.md).
Read [feature coverage](docs/FEATURE-COMPLETION.md) for adapter limits.
Worktrees isolate Git changes, not the privileges of an agent or its tools.

## Run from source

Use Node 24.18+ within Node 24 and the pnpm version pinned in package.json.
Native builds additionally need Rust 1.98.1, MSVC C++ build tools and WebView2 on
Windows. Install and sign in to the agent CLI you want to use.

~~~powershell
pnpm install --frozen-lockfile
pnpm tauri dev
~~~

For UI development, pnpm dev starts the desktop browser preview on port 5173;
it cannot execute native tasks. /design-lab.html contains component fixtures.
pnpm dev:website starts the marketing site on port 5180.

The website statically prerenders the product tour plus focused discovery pages for
parallel coding agents, Git worktrees, Codex, Claude Code, Grok, OpenCode, project
context, recurring tasks and agent-code review. Route metadata, structured data,
the sitemap, RSS and LLM-readable indexes are generated from the same content map.

Run pnpm verify for formatting/lint, documentation links, frontend builds,
server checks and native unit tests. See [CONTRIBUTING.md](CONTRIBUTING.md) for
prerequisites, secret checks and rendered/native verification. Builds do not
substitute for installed-app acceptance.

## Repository map

| Location | Responsibility |
| --- | --- |
| apps/desktop/src | React UI, state and typed native clients |
| apps/desktop/src-tauri | Native task runtime, coordination, Git, browser and filesystem access |
| apps/website | Marketing site, screenshots and walkthrough |
| apps/server | Optional Cloudflare ingestion and R2 update service |
| packages/brand | Shared theme tokens, vector geometry and fonts |
| scripts | Verification, notices and release preparation |

Start with [Getting started](docs/GETTING-STARTED.md),
[Architecture](docs/ARCHITECTURE.md), [Design](docs/DESIGN.md) or
[the backlog](docs/TODO.md). Operators can read the
[server setup](apps/server/README.md) and [release guide](docs/RELEASE.md).

## Participate

[Report a bug or request a feature](https://github.com/Jackalope-Dev/jackalope/issues/new/choose),
or read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
Review and redact diagnostics before attaching them. Report vulnerabilities to
**security@jackalope.dev**; see [SECURITY.md](SECURITY.md).

Licensed under [Apache-2.0](LICENSE). See the [dependency inventory](docs/DEPENDENCIES.md)
for third-party packages and bundled font notices.
