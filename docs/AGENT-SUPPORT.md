# Agent support and acceptance

Jackalope has native Codex, Claude Code, Grok Build, OpenCode, Kimi Code and Antigravity adapters.
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
| Grok Build | ACP account identity; access checked at launch | On-demand discovery through HTTP bridge |
| Kimi Code | ACP authentication; access checked at launch | stdio, HTTP, SSE, plus on-demand discovery |
| OpenCode | Provider validates at launch | stdio, HTTP, SSE, plus on-demand discovery |
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

## Kimi Code

Install the current [Kimi Code CLI](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html)
with `npm install -g @moonshot-ai/kimi-code`, then run `kimi login` or use
Add account & sign in. Windows also needs Git for Windows. Legacy Python
kimi-cli installations need the provider's migration flow; named Jackalope
profiles target the current CLI and its `KIMI_CODE_HOME` data root.

Kimi runs as a worker through [ACP](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp).
Tasks stream text and tool activity, retain the provider session ID and load
that exact session on continuation. Replayed history is excluded from the new
result. Selected model aliases are set before prompting; a rejected model or
resume fails without silently starting a new session. Completion requires an
explicit successful turn response and a nonempty result. Jackalope terminates
the owned ACP server after the turn; its process exit code is not the turn result.
Stop terminates the owned process tree. Attempts have a 30-minute limit.

Tool approvals show the CLI's choices, including approval for the session. Declined,
unknown or unanswered responses stop the attempt; waits expire after 10 minutes.
ACP elicitation preserves Kimi's multiple-question and multiple-selection forms.
Unsupported schemas return an explicit protocol error; no answer is invented.
Direct project MCP connections use session parameters, with HTTP/SSE capability
negotiation. The shared Jackalope harness is delivered as native MCP tools.

For current CLI versions, the adapter waits for the deferred command palette before
starting the task. The advertised local `/usage` command supplies before/after session totals. Their
delta is the current attempt's input/output usage, excluding resumed history.
Context occupancy stays separate. Missing cache breakdown, cost, interrupted-turn
totals and helper usage remain unknown. Optional post-turn usage failure does not
erase the completed turn. Usage probes are bounded separately from model execution.
Managed membership quota uses the selected profile's current OAuth access token
against its official Kimi endpoint; custom endpoints and expired tokens fail closed.
The reader does not rotate credentials. Extra-usage balances are separate. Routing
uses membership quota only for aliases configured with the managed Kimi provider.

Kimi can coordinate automatic assignment and power Ask Jackalope. Those processes
use a private temporary agent definition with `tools: []` and `subagents: []`.
The definition is removed when the process finishes, fails or is canceled. It carries
the bounded helper context without putting that context in command arguments.

Models come from the account's ACP session configuration, including grouped
model aliases. Model discovery creates a temporary provider session without a
model prompt. Account checks use ACP authentication and do not infer identity
from saved files. Quota comes from the membership API, not credential presence.
Named profiles isolate config, OAuth data and sessions
using [KIMI_CODE_HOME](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/env-vars.html).
Inherited model credential overrides are cleared for named accounts.

Protocol tests cover permission decisions, malformed output, interrupted turns,
model selection and exact-session resume. A disposable native process fixture
covers approvals, process shutdown, continuation, stop and history recovery.
Provider authentication and installed-app acceptance require separate real-account
trials; a local fixture provider does not establish either.

## Accounts and boundaries

The account panel offers Add account & sign in and inline Work/Personal/Other
grouping for saved accounts and the existing CLI login. The latter is metadata
only; it does not copy or relocate the CLI's credentials. A completed sign-in can
be selected for new tasks without rebinding existing attempts. Interactive
two-account acceptance remains required before claiming provider login coverage.

Codex uses `CODEX_HOME`, Claude uses `CLAUDE_CONFIG_DIR`, and Grok uses `GROK_HOME`.
OpenCode uses `XDG_DATA_HOME` for credentials and session data. Named OpenCode
profiles additionally redirect XDG config, cache and state directories; the
default profile preserves the user's existing CLI configuration. Use OpenCode’s `debug paths` command to inspect the selected profile.
The temporary-directory path remains controlled by OpenCode and the OS.

Gemini account setup uses `GEMINI_CLI_HOME` as the parent of `.gemini` and
`GEMINI_FORCE_FILE_STORAGE=true` to isolate credentials from the shared keychain.
Goose uses `GOOSE_PATH_ROOT`
and `GOOSE_DISABLE_KEYRING=1` for per-profile configuration and secrets; see its
[path implementation](https://github.com/aaif-goose/goose/blob/main/crates/goose/src/config/paths.rs)
and [configuration implementation](https://github.com/aaif-goose/goose/blob/main/crates/goose/src/config/base.rs).
Aider redirects HOME/USERPROFILE, AIDER_CONFIG and AIDER_ENV_FILE and accepts
provider API keys in the account dialog. Antigravity profiles use the documented
[Gemini API-key mode](https://antigravity.google/docs/cli/install/), with separate
API billing. Its existing subscription login remains available but does not
support multiple isolated identities. Managed keys use DPAPI on Windows and
native Keychain/Secret Service storage on Unix. Existing account identities remain stable.

The desktop never marks Grok or OpenCode authenticated merely because an
executable or saved credential exists. Profiles are account organization,
not a sandbox: inherited provider environment variables, CLI plugins, project
configuration and filesystem permissions still apply. Real account switching
between two authenticated identities, revoked/expired credentials and every
provider/model combination remain release acceptance work.

Direct project-selected MCP delivery fails explicitly for Grok and Antigravity.
All six native adapters can use connections configured for
[on-demand discovery](MCP-DISCOVERY.md) through the HTTP bridge.
Their own CLI configuration can still supply tools.
The common coordination bridge is available to agents through task instructions;
Codex, Claude, OpenCode and Kimi additionally receive direct bridge MCP tools. Do not claim that every
agent has passed real browser, question or third-party OAuth tool trials.

## Capability boundaries

This table describes Jackalope’s adapter interfaces. Missing integration does not
imply that the provider lacks the underlying capability.

| Area | Finding and current behavior |
| --- | --- |
| Kimi tools, questions, usage and helpers | Implemented through ACP, local session totals, the membership API and explicit tool-free agent definitions. Cache/cost and helper token totals are absent from these output interfaces; unknown values are preserved. |
| OpenCode project tools | Implemented with per-process `OPENCODE_CONFIG_CONTENT`, merging unrelated inline settings and resolving connection credentials only for the task process. stdio and remote HTTP/SSE are supported. |
| Grok account and models | Account checks use `_x.ai/auth/info`; model discovery reads the ACP session model catalog without a model turn. |
| Antigravity quota and model | Implemented with version-gated read-only `/usage` and `/model` commands. `/usage` returns subscription groups; `/model` reports one selected model, not a full catalog. |
| OpenCode account quota | OpenCode routes to independent providers, API keys and local models. Its task usage events do not supply a universal remaining-account allowance. No arbitrary provider balance is assigned to an OpenCode profile. |
| Grok / Antigravity direct MCP | The retained headless interfaces lack a verified per-process MCP override. Project tools work through on-demand discovery. Grok ACP advertises MCP; moving execution to it needs usage, permission and resume parity with the existing adapter, rather than silently changing an established session protocol. |
| Antigravity coordinator, native prompts and subscription profiles | Headless stdin accepts user messages, not permission replies; no verified tool-free invocation or isolated subscription-keychain override is connected. Worker tools and questions use the shared harness; named profiles use separate Gemini API keys. Plan mode alone is not a no-tools guarantee. |
| Codex legacy SSE | Its direct MCP interface uses stdio or streamable HTTP. Use a supported transport; legacy SSE must not be silently relabeled HTTP. Claude, Kimi and OpenCode support direct SSE. |

Sources: [Kimi ACP](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp),
[Kimi custom agents](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents.html),
[Kimi account API](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/server-api.html),
[OpenCode configuration](https://opencode.ai/docs/config/),
[OpenCode MCP](https://opencode.ai/docs/mcp-servers/),
[Grok headless and ACP](https://docs.x.ai/build/cli/headless-scripting),
[Antigravity headless](https://antigravity.google/docs/cli/headless/), and
[Antigravity command changes](https://antigravity.google/changelog?tab=engine).

## Other candidates

Gemini CLI, Aider and Goose appear in the catalog and support managed account
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
