# Antigravity

Jackalope runs the installed Antigravity CLI (`agy`), using its existing sign-in,
model selection and permission settings. The adapter targets the streaming CLI
contract verified with 1.1.26. The GUI application alone is not sufficient.

## Setup and use

1. Install the CLI from [Google's installation guide](https://antigravity.google/docs/cli/install/).
2. Run `agy` in a terminal and complete sign-in. Return to Jackalope and choose
   Agents → Check agents. Windows discovery checks PATH and `%LOCALAPPDATA%/agy/bin`;
   other systems also check `~/.local/bin`.
3. Choose Antigravity for a task, queued work or recurring work. Configuration
   accepts an absolute CLI executable and an optional model slug from `agy models`.
4. Review the result and changes. Continue reuses the exact conversation and
   workspace; Stop terminates the owned process tree.

An installed executable does not prove authentication. Access is validated when
the agent starts. No credential files are read to invent a connected state.
The existing CLI subscription login uses the OS credential store. Its identity
is not pinned; changing that login can affect existing continuations. Multiple
subscription logins do not yet have a verified isolation override.

Named Jackalope accounts use Google's documented Gemini API-key mode instead.
Each profile has a separate HOME/USERPROFILE and `.gemini/antigravity-cli/settings.json`
with `modelProvider: "gemini"`. Jackalope requires an account-specific GEMINI_API_KEY
and rejects a changed provider setting or missing key before launch. Keys are
protected with Windows DPAPI, or stored in owner-only files on Unix. Gemini API
billing is separate from a Google subscription. Real two-account API-key execution
and continuation acceptance remain pending; the earlier CLI-login trial does not
establish acceptance of this new mode.

## Execution and permissions

Prompts are encoded as a single JSON message on stdin. No shell interpolation or
CLI slash-command execution is used. Each attempt gets one CLI process and one
turn, with an explicit workspace directory in both launch arguments and context.
This matters because a resumed headless conversation may otherwise look for a
different checkout. The normal Jackalope worktree and review safeguards apply;
workspace instructions are not a filesystem sandbox.

The adapter preserves the CLI's permission settings and never adds
`--dangerously-skip-permissions`. A tool permission denial can coexist with a
successful CLI exit; Jackalope records it as a failed attempt needing attention.
Grant only the intended operation through the CLI's permission configuration and
continue. Native terminal questions cannot be answered through Jackalope; agents
should use the supplied Jackalope question bridge instead.

Only a valid final `SUCCESS` event, nonempty result, consistent conversation ID,
successful exit and no recorded adapter error can become ready for review.
Malformed, oversized, missing or contradictory protocol events cannot pass.
The adapter bounds output and enforces a 30-minute attempt timeout; partial work
and history remain available. This is a per-attempt limit, not a task deadline.

Usage uses per-step observations, deduplicated by step index. This avoids adding
prior turns from cumulative result counters to a continuation. Fresh runs can
fall back to the final usage envelope; missing resumed usage remains unknown.
The observed CLI reports uncached input and cache reads separately, and includes
thinking in output tokens. Jackalope adds cache reads to input and does not add
thinking twice. Subscription quota/capacity reporting is not implemented.

## Jackalope tools

The local authenticated HTTP bridge supplies project assignments, messages,
questions/answers, browser evidence and recorded validation. Project-selected
MCP connections can use on-demand discovery through that bridge. Direct project
MCP injection fails with an actionable explanation. Antigravity's own configured
MCP servers remain managed by its CLI; Jackalope does not rewrite global or
workspace MCP configuration or place task credentials into source files.

HTTP calls remain subject to the CLI's shell/network policy. Discovery never
authorizes side effects. An unavailable transport is reported, not bypassed.
See [the orchestration audit](ORCHESTRATION-CAPABILITIES.md) for shared coverage.

## Verification

Automated regression coverage and isolated native trials are described in
[CONTRIBUTING.md](../CONTRIBUTING.md) and [SELF-DEVELOPMENT.md](SELF-DEVELOPMENT.md).
Record detailed local receipts privately. Fixtures and source builds do not prove
installed-app acceptance.
