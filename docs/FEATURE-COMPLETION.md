# Workspace feature completion

Current implementation coverage. Release acceptance remains separate.

## Navigation

Tasks owns Work, Repo TODOs, Evidence and Recurring. Project owns Codebase, Worktrees and Context.
Agents owns Runners and Configuration. Connections and Usage remain separate.
System and Diagnostics are Settings categories; command search still reaches every view.
Settings links to project/agent configuration instead of maintaining duplicate editors.

## Execution and inspection

Recurring definitions live in the native profile, with IANA timezones, skip/catch-up-once,
paused-by-default creation, isolated worktrees, explicit account/target binding, a bounded
occurrence ledger and the existing guarded task launcher. The scheduler stays active in
the tray; it cannot wake a closed app or a sleeping computer. Occurrences over one minute
late use the selected missed-run policy. Up to three active/interrupted tasks across the
profile block additional scheduled starts. A schedule skips an active/interrupted previous
run. Reservations persist before launch; interrupted dispatch is never automatically replayed.
Pause stops future launches; ordinary task Stop cancels an existing run. Notifications link
failures and review-ready runs to Recurring. Legacy plan-only data remains available and is
never silently enabled. Task history remains the durable source of execution results.

On startup, reviewed runs beyond the most recent 200 move to a `history/archive` folder:
still on disk and included in history search, but out of the loaded set that each poll
serialises. Active, review-ready, failed, interrupted and unsaved runs are never archived.
Settings → Data & reset lists archived runs, restores any of them to the loaded history, and
imports a `jackalope-task-recovery` export; an import or restore never shadows a run that is
still present.

Agent launch retries a transient spawn failure (an antivirus or indexer lock on the
executable, `ETXTBSY`) up to three times before failing; a missing executable is not retried.
Resuming an interrupted attempt remains refused because process ownership after an unclean
exit is unknown.

Worktree cleanup still refuses anything blocked by an active or interrupted task, a lock, a
submodule, or a mismatched Git registration. A worktree blocked only by recoverable content
(uncommitted changes, untracked files, or unmerged commits) offers "Archive & remove": its
commit history (git bundle), uncommitted tracked changes (patch), untracked non-ignored files
and a manifest are written under `.worktrees/.archive` before the folder is force-removed and
its `jackalope/` branch deleted. "Prune missing worktrees" drops Git registrations whose
folder is already gone.

Project MCP configurations are stored under the user's .jackalope/projects directory and
passed at launch to Codex, Claude, OpenCode or Kimi. The composer can select a subset of project tools;
existing CLI-global tools are unchanged. Continuations retain their selection. Unsupported
Grok/Antigravity direct project delivery and Codex SSE fail explicitly. Project connections can
opt into on-demand discovery through native MCP for Codex, Claude, OpenCode and Kimi,
or the HTTP bridge for Grok and Antigravity; see [MCP-DISCOVERY.md](MCP-DISCOVERY.md). Bearer credentials can use environment
variable references. Interactive OAuth is delegated to the installed CLI and its selected
profile; Jackalope does not implement a second token store. The generic JSON-RPC probe uses
configured header/environment authentication; CLI-owned OAuth sessions must be checked in
that CLI. Provider consent is a user action, not part of automated tests.

[Browser verification](BROWSER-AUTOMATION.md) bundles agent-browser 0.37.1 (Apache-2.0)
and uses installed Edge/Chrome, a fresh profile per task and at most four task sessions.
Accessibility snapshots supply element references; form/keyboard/wait actions,
viewport/theme controls, tabs, diagnostics and screenshots share task state.
Stop, completion and shutdown terminate the owned browser process tree.
No general-purpose JavaScript execution tool is exposed. Page results are bounded.

Usage filters/sorts by agent account profile. Claude assistant message observations are
idempotently replaced by message ID and identify child tool calls. They never increase
provider-reported attempt totals; missing child events remain partial coverage. Default CLI
profile labels are not a verified human/account identity. Other adapters without exposed
child telemetry remain unknown. Existing native attempt journals retain observations.

The codebase resolver adds oxc_resolver (MIT) for tsconfig aliases and installed package
resolution. Its filesystem adapter confines reads to the repository, bounds config reads,
and labels limit exhaustion. Only scanned source files become graph nodes. Rust crate/self/
super use paths are related to declared external file modules; inline modules, macros and
symbol-level reexports remain incomplete. Impact in task review walks reverse resolved
references from changed files; it is guidance for verification, not a claim that tests passed.

## Beta, privacy and feedback

Settings supports persisted stable/beta feeds in configured releases, separate
from installed-channel attribution. A dedicated privacy step precedes reporting;
usage/error controls and a bounded native transport exclude content and identifiers.
Support provides explicit review/Send with optional counters. The Worker aggregates
fixed events, verifies the sole admin identity and retries feedback email independently.
These are implemented locally; deployment, sender/Access setup and installed beta
acceptance remain gates in [BETA-MONITORING.md](BETA-MONITORING.md).

## Verification

Project lessons, explicitly selected Markdown workflows and local task-history
search are available in Project → Context and the task composer/review. Native
launches retain bounded context receipts across agents. Recurring work can monitor
committed branch/path content without model calls and notify or dispatch only on
change, with persistent notices and local diff inspection. See
[project knowledge](PROJECT-KNOWLEDGE.md) for cost, scope and lifecycle limits.

Use pnpm verify for automated checks and RELEASE.md for installed/native acceptance.
Browser fixtures do not establish provider authorization or signed-upgrade behavior.
The shared service requires separate staging/production acceptance.

## Public-library references

- https://docs.rs/cron/latest/cron/struct.Schedule.html (MIT/Apache-2.0)
- https://docs.rs/chrono-tz/latest/chrono_tz/ (MIT/Apache-2.0)
- https://github.com/vercel-labs/agent-browser/tree/v0.37.1 (Apache-2.0)
- https://docs.rs/oxc_resolver/latest/oxc_resolver/ (MIT)
- https://code.claude.com/docs/en/agent-sdk/cost-tracking
- https://code.claude.com/docs/en/mcp
