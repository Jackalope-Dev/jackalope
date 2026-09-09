# Agent support and acceptance

Jackalope has native Codex, Claude Code, Grok Build, OpenCode and Antigravity adapters.
The native registry is `tasks/runners.rs`; the desktop selection catalog is
`src/lib/agent-catalog.ts`. New agents need a real CLI protocol adapter, not just
an entry in either list. Manually configured executables must implement their
selected adapter's CLI contract.

Antigravity uses `agy` with streamed events, exact-session continuation and the
existing CLI sign-in. See [Antigravity support](ANTIGRAVITY.md) for permissions,
account limits and verification, and [orchestration capabilities](ORCHESTRATION-CAPABILITIES.md)
for shared tools and notification coverage.

## Adapter capabilities

| CLI | Sign-in discovery | Project-selected MCP |
| --- | --- | --- |
| Codex | `login status` | stdio, HTTP |
| Claude Code | `auth status` | stdio, HTTP, SSE |
| Grok Build | Provider validates at launch | On-demand discovery through HTTP bridge |
| OpenCode | Provider validates at launch | Not injected |
| Antigravity | Provider validates at launch | On-demand discovery through HTTP bridge |

Validate the selected CLI version, account and model with the opt-in lifecycle
test below. It exercises real file output, worktree isolation, usage, continuation,
account binding, process stop and saved history. Ordinary tests cover permission
failures, questions, verification, integration and corrupt history; they do not
establish provider-specific interactive tool or installed-package acceptance.

OpenCode's JSON adapter handles text, tool activity, session IDs, errors and
per-step usage. Duplicate step IDs do not double-count usage. A nonzero exit,
reported error or empty result cannot become a successful review state.
Model IDs use OpenCode's `provider/model` format. Provider configuration and
credential validity remain OpenCode's responsibility; no credentials is not
equivalent to no available model.

## Accounts and boundaries

The account panel offers Add account & sign in and inline Work/Personal/Other
grouping for saved accounts and the existing CLI login. The latter is metadata
only; it does not copy or relocate the CLI's credentials. A completed sign-in can
be selected for new tasks without rebinding existing attempts. Interactive
two-account acceptance remains required before claiming provider login coverage.

Codex uses `CODEX_HOME`, Claude uses `CLAUDE_CONFIG_DIR`, and Grok uses `GROK_HOME`.
OpenCode uses `XDG_DATA_HOME` for credentials and session data. Named OpenCode
profiles additionally redirect XDG config, cache and state directories; the
default profile preserves the user's existing CLI configuration. OpenCode's
actual `debug paths` command confirmed these locations with an empty profile.
The temporary-directory path remains controlled by OpenCode and the OS.

Gemini account setup uses `GEMINI_CLI_HOME` as the parent of `.gemini` and
`GEMINI_FORCE_FILE_STORAGE=true` to isolate credentials from the shared keychain.
The installed Gemini CLI source confirms both overrides. Goose uses `GOOSE_PATH_ROOT`
and `GOOSE_DISABLE_KEYRING=1` for per-profile configuration and secrets; see its
[path implementation](https://github.com/aaif-goose/goose/blob/main/crates/goose/src/config/paths.rs)
and [configuration implementation](https://github.com/aaif-goose/goose/blob/main/crates/goose/src/config/base.rs).
Aider redirects HOME/USERPROFILE, AIDER_CONFIG and AIDER_ENV_FILE and accepts
provider API keys in the account dialog. Antigravity profiles use the documented
[Gemini API-key mode](https://antigravity.google/docs/cli/install/), with separate
API billing. Its existing subscription login remains available but does not
support multiple isolated identities. Managed keys use DPAPI on Windows and
owner-only files on Unix. No migration changes existing account identities.

The desktop never marks Grok or OpenCode authenticated merely because an
executable or saved credential exists. Profiles are account organization,
not a sandbox: inherited provider environment variables, CLI plugins, project
configuration and filesystem permissions still apply. Real account switching
between two authenticated identities, revoked/expired credentials and every
provider/model combination remain release acceptance work.

Direct project-selected MCP delivery fails explicitly for Grok and OpenCode.
Grok can use connections configured for [on-demand discovery](MCP-DISCOVERY.md)
through the HTTP bridge. OpenCode project-selected discovery remains unsupported.
Their own CLI configuration can still supply tools.
The common coordination bridge is available to agents through task instructions;
Claude additionally receives direct bridge MCP tools. Do not claim that every
agent has passed real browser, question or third-party OAuth tool trials.

## Other candidates

Gemini CLI, Aider and Goose now appear in the catalog and support managed account
setup. They still lack native task protocol adapters and lifecycle acceptance.
Their task launch explicitly fails with an explanation instead of falling through
to Grok's flags. Account setup must not be presented as task execution acceptance.
Copilot and other agents without a native adapter cannot execute tasks.

## Run opt-in validation

The test uses the selected installed agent and may consume provider usage.
It retains its disposable repository/history and prints the fixture location.
It creates only fixture commits; it never commits this repository.

```powershell
$env:JACKALOPE_AGENT_TRIAL = 'opencode'
$env:JACKALOPE_AGENT_MODEL = 'opencode/mimo-v2.5-free'
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features installed_agent_lifecycle_trial -- --ignored --nocapture
Remove-Item Env:JACKALOPE_AGENT_TRIAL, Env:JACKALOPE_AGENT_MODEL
```

Use `codex`, `claude` or `grok` without `JACKALOPE_AGENT_MODEL` to use that CLI's
configured model. Free-model availability can change. Install OpenCode from
[its official documentation](https://opencode.ai/docs/); the Windows npm binary
layout and `.opencode/bin` are discovered alongside PATH executables.
