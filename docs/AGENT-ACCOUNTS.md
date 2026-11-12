# Agent accounts

Agents → Connect an API provider offers DeepSeek, OpenRouter, OpenAI, Anthropic,
Google Gemini, xAI, Groq and Mistral key entry directly in Jackalope. These accounts
use the installed OpenCode runner for agent execution. Setup stores a protected
key and discovers that provider's models. Optionally select the new account and
model as the default for future OpenCode tasks; existing runs stay pinned.
Canceling unfinished setup removes its pending account. CLI sign-in remains
available for providers and authentication methods outside this key-only catalog.

The Agents page applies enable/disable, default task agent and account choices to
the selected project or, with All projects selected, every project. Its Defaults section
holds the default agent, quota handoff and the project's Work/Personal account groups;
each agent's Configure page offers an allowed account list. New task and plan drafts, chats and terminal
conversations use the project's default; explicit task choices and saved drafts
remain unchanged. Automatic routing and its coordinating agent respect the project's
agent and account restrictions. The Agents page with All projects selected holds app-wide limits
and defaults; a project cannot enable an agent or account disabled there.
Connections, account names, model preferences and executable configuration are shared.

Agents → Configuration puts account setup before technical agent settings. Add a
named Work, Personal or Ungrouped account and complete the provider prompts in the
embedded sign-in panel. Provider authorization may open the browser. New accounts
do not become active automatically; select the account to use for new project tasks.

Account rows offer a status check, provider-reported identity when available,
rename/group editing and removal. Status is an observation from the installed CLI,
not proof that a model request will succeed or that credentials have not expired
since the check. A completed login process is followed by an independent account
check. The panel supports cancellation, bounded timeout and retry.

Project → Settings can apply Work or Personal account choices across agents after
showing a preview. It saves explicit profile IDs. Missing and ambiguous matches
leave those agents' current choices intact; their selectors remain available.
Removed saved accounts are visible as errors. Accounts can be added and signed in
from the project selector without leaving project settings.

## Provider support

| Agent | Sign-in | Status |
| --- | --- | --- |
| Codex | `codex login` in the embedded terminal | `account/read` through an isolated app-server; ChatGPT email when reported; API keys shown as configured |
| Claude Code | `claude auth login` in the embedded terminal | `claude auth status`; identity when reported |
| Grok | `grok login` in the embedded terminal | ACP `_x.ai/auth/info`; identity when reported |
| OpenCode | Provider sign-in in the embedded terminal, or a provider API key | Saved Jackalope keys are configured; provider identity, validity and credit remain unverified |
| Kimi Code | `kimi login` in its managed profile | ACP authentication; membership quota when available |
| Antigravity | Existing subscription sign-in or named Gemini API-key profile | Isolated subscription profiles remain unsupported |

The interfaces follow the [Codex app-server documentation](https://learn.chatgpt.com/docs/app-server),
[Claude CLI reference](https://code.claude.com/docs/en/cli-reference) and
[OpenCode CLI reference](https://opencode.ai/docs/cli/). Grok uses the same ACP
account metadata interface as the existing capacity reader. Older or unsupported
responses produce an unknown state, never an invented identity.

## Ownership and compatibility

`commands/agent_profiles.rs` owns saved profiles, grouping and account binding.
`commands/agent_sign_in.rs` owns the temporary PTY sessions and
`commands/agent_sign_in/status.rs` owns bounded account checks. A shared lease
prevents task launches, profile deletion and duplicate sign-in during login;
starting sign-in also checks for active tasks under the execution guard.

Sign-in launches only the selected installed agent's login command in its managed
account directory. The native service owns the process tree and stops it on close,
app exit, ten-minute timeout or loss of the UI heartbeat. Terminal output is bounded
to 64 KiB in memory and is not written to task history or browser storage. Provider
credentials remain owned by the CLI. Supported HTTPS links open only on user action.

Named Codex, Claude and Grok profiles remove the supported inherited API-key/token
overrides from login, account checks and task execution. OpenCode also isolates
its data/config/cache/state folders; its provider plugins and project/environment
configuration retain their own credential precedence. CLI-owned configuration is
not an OS security boundary.

Legacy profiles with no group remain readable. Grouping and renaming never change
profile IDs or directories. Existing tasks retain their original profile binding
when defaults change. Reconnecting the same profile with a different provider
identity can change the credentials used by its continuations: use a new profile
for a different identity. Deleting an account deliberately blocks later uses of
that saved profile instead of silently falling back to another account.

## Device-owned API keys

For DeepSeek, use **Connect an API provider** in Agents, choose DeepSeek and enter
your key. Jackalope prepares its private OpenCode runner before saving the key and
discovering models. No separate OpenCode installation or account is required.
The OpenCode account's **Provider API key** action supports the same flow.
The provider connection flow saves its selected model on that named account,
including when it is not selected for new tasks. Completion saves the preference,
pending-account state and optional activation together. A later settings-sync
failure leaves the connection saved and permits retry. Explicit task model choices
win, followed by the account preference and then the runner's fallback default;
model restrictions still apply. The active account's preference can be changed in
Models & Executable. Existing sessions retain their requested model.
Existing OpenCode provider sign-ins remain available. The selected runner supplies
model discovery; Jackalope does not pin a DeepSeek model
or treat catalog visibility as proof of access. Follow the provider's
[OpenCode compatibility guidance](https://api-docs.deepseek.com/quick_start/agent_integrations/opencode/).

Preparation has progress, cancellation and retry. A failed or canceled download
does not save the entered key. Each app profile keeps one active pinned runner;
tasks, model discovery, routing helpers and Ask Jackalope share its executable
resolver while retaining their selected account and model. Explicit executable
overrides take precedence. See [runner maintenance](AGENT-SUPPORT.md#private-opencode-runner).

Environment discovery recognizes `DEEPSEEK_API_KEY` and imports it into a separate
OpenCode account only when selected. New OpenCode key imports use protected device
storage. Legacy profile `.env` keys remain readable. Saved keys are injected into
the bound agent process and are not returned to the renderer; a configured account
still requires a successful provider request to establish access and available credit.

Jackalope-owned keys use Windows DPAPI, macOS Keychain or Linux Secret Service.
Missing or locked credential services fail explicitly; there is no plaintext fallback.
Jev keys are entered in a transient password field, passed once through native IPC,
and never returned to the renderer, settings sync, exports or task history. Native
requests send the key only as a sensitive HTTPS Authorization header to TypeSafe.
Connection status is a prior check, not proof of current credit or authorization.
Replacing the key keeps decision preferences; removing it switches Jev defaults and
project overrides to local rules. The connection is shared by projects on this device.

Detected environment-key previews reveal at most the final four characters of long
keys; short keys are fully masked. CLI-owned sign-in/configuration remains under the
provider's storage contract. Jackalope-owned MCP configuration is protected separately;
see [MCP discovery](MCP-DISCOVERY.md).

## Project secrets

Project settings → **Secrets** gives a project's task agents environment variables such
as `HIGGSFIELD_API_KEY`. Names use capital letters, digits and underscores (at most
128 characters, starting with a letter or underscore); names Jackalope, agent sign-ins
or the system own are refused, including `JACKALOPE_*`, `GIT_*`, `LD_*`, `DYLD_*`,
`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY`, the
agents' profile variables, `PATH` and `HOME`. A project holds at most 64 secrets of up
to 16,000 characters each. Each has **Available to**: all agents (the default), agents
on this device, or agents on the project's computer.

`commands/project_secrets.rs` keeps each project's secrets in one protected record
(`project-secrets/<project>.bin` in the task profile, through the same Windows DPAPI,
macOS Keychain or Linux Secret Service storage as other Jackalope-owned keys), never in
project JSON, saved task requests or task history. The renderer receives names,
availability and save times only; a saved value can be replaced or removed but is never
shown again. Removing the last secret removes the record.

Secrets go only into the environment of task agent processes: local attempts, including
persistent Claude Code sessions, and [agents on a computer](BOT-COMPUTERS.md#agents-on-a-computer).
For an agent on a computer, a selected stdio connection that runs there can also use a
secret available to computers as `${NAME}` in its arguments or environment
([details](BOT-COMPUTERS.md#agents-on-a-computer)).
Workspace preparation, checks, previews and deploy commands do not receive them. A
secret replaces an inherited variable of the same name. The attempt's activity names the
secrets the agent received. An unreadable record fails the attempt with the storage error
instead of starting the agent without them. Anything an agent can read it can use or
leak, so prefer keys with spending limits.

`commands/redaction.rs` keeps the values an attempt gives its agent out of that
attempt's record: project secrets and every credential variable Jackalope sets
(names ending in `_KEY`, `_TOKEN`, `_SECRET` or `_PASSWORD`, such as a managed
account's provider key or the bridge token). Values of at least eight characters
are replaced with `[redacted]` as written, JSON-escaped, base64 and URL-encoded in
the result, activity, diagnostics, errors, questions, decisions, checks and
streaming text before they are saved, shown or exported. Identifiers, statuses,
timestamps and the person's own prompt are kept. The values live only in memory for
the attempt. Redaction protects the record, not the value: the agent can still use
or send what it can read, a value it transforms some other way is not recognized,
and the agent CLI's own session files are outside Jackalope's record.

## Verification

Automated regression coverage and isolated native trials are described in
[CONTRIBUTING.md](../CONTRIBUTING.md) and [SELF-DEVELOPMENT.md](SELF-DEVELOPMENT.md).
Record detailed local receipts privately. Fixtures and source builds do not prove
installed-app acceptance.

With the desktop Vite server running, use `scripts/verification/verify-agent-accounts.mjs`
and `scripts/verification/verify-provider-connections.mjs` for isolated browser
fixtures covering keyboard/focus, themes, setup cancellation and model selection.
`node scripts/verification/verify-project-agents.mjs` covers project switching,
agent/account restrictions, defaults and persistence with fake IPC.
`JACKALOPE_PREVIEW_URL` overrides their local preview address. These fixtures use
fake IPC and never establish live credential validity or provider availability.
