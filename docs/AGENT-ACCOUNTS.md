# Agent accounts

Agents → Configuration puts account setup before technical agent settings. Add a
named Work, Personal or Ungrouped account and complete the provider prompts in the
embedded sign-in panel. Provider authorization may open the browser. New accounts
do not become active automatically; select the account to use for new tasks.

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
| OpenCode | `opencode auth login` in the embedded terminal | Provider identity and credential validity remain unavailable in Jackalope |
| Antigravity | Existing `agy` sign-in | Separate managed accounts remain unsupported |

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

## Verification

Automated regression coverage and isolated native trials are described in
[CONTRIBUTING.md](../CONTRIBUTING.md) and [SELF-DEVELOPMENT.md](SELF-DEVELOPMENT.md).
Record detailed local receipts privately. Fixtures and source builds do not prove
installed-app acceptance.
