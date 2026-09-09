# First local task journey

This is the execution path behind Tasks, Agents
and Usage. Historical board records remain under Tools → Planning board and do
not represent these execution attempts.

## Experience

Open a Git repository through the native picker or a validated path. The project
is persisted, with its actual root and branch. Fresh installs have no seeded
project. Existing persisted projects and planning records are preserved.

Tasks starts with the user's intent and compact, editable agent/workspace
controls. Drafts survive navigation and reload. New tasks default to a worktree
from the current local HEAD; uncommitted checkout changes are excluded and this
is stated before launch. Current-checkout execution is an explicit alternative.
Worktrees and branches remain after a run so users can inspect and integrate them.

A task retains its identity across attempts. Results, recent activity, errors,
workspace changes and reported usage are shown together. A follow-up uses the
original agent session and workspace; one task cannot have concurrent attempts.
Mark reviewed records a review decision without committing, merging or cleanup.
Questions or denied tool requests are explained by the agent's result; users
answer with a follow-up. Live permission dialogs and mid-turn steering are not
implemented by these headless adapters.

## Runtime and adapters

- `commands/tasks.rs` owns processes, output readers and a per-attempt JSON
  journal in the native app data directory (`task-runs-v1`). Files are replaced
  through a temporary file after flushing. State does not belong to a view.
- `executionStore.ts` observes snapshots for the application lifetime and
  persists only UI selection/drafts. Provider output and usage are native-owned.
- Codex: `exec --json`, prompt over stdin, workspace-write sandbox, approval
  requests denied in headless mode. Continuation uses the explicit session ID.
- Claude Code: print/stream-json, prompt over stdin, acceptEdits permission mode.
- Grok Build: prompt file/streaming-messages-json, acceptEdits mode; temporary
  prompt files are removed after normal completion. It exposes no separate
  login-status command in the verified installed version, so discovery says
  Installed and leaves authentication verification to launch.
- All three use the CLI's existing account/configuration. No credentials are
  copied. Executable discovery supports PATH and known native install locations.
  Npm shell shims without a directly executable runner are not supported yet.
- Results are parsed from structured records; plain shell stdin is never used
  as an agent instruction. Actual process exit and an agent result are required
  for Ready to review. Stop targets the owned process tree on Windows and the
  owned process group on Unix. Graceful app close requests stop for active work.
- Unexpected close restores unfinished attempts as Interrupted without rerun.
  Automatic continuation of those attempts is blocked: process ownership must
  be checked through the CLI before starting new work. Crash-proof child-process
  containment and reconnect to live orphaned sessions remain follow-up work.

Current implementation keeps recent 150 activity entries (6,000 characters each)
and a 120,000-character result/patch preview. History pagination, retention UI,
event streaming instead of snapshots, corrupt-journal recovery UI and large-output
resource limits need further work. Read errors are surfaced; they are not success.

## Usage

Usage supports overall/project filtering, date periods, sorting by project,
agent, model or tokens, attempt drilldown and JSON export. Each attempt includes
source-reported input/output and supported cache details. Cache is counted once:
Codex input includes cached input; the Messages-format adapters provide separate
uncached/cache-read/cache-write categories. Final totals replace earlier/replayed
reports. Unsupported or interrupted measurements remain unknown.

Claude/Grok reported cost is labeled an estimate. Codex model/cost can be absent
from its event stream and remain unavailable; configuration is not substituted
for measurement. CLI account identity is not yet stable across sign-in changes,
and child-agent attribution is not separately collected. No account-wide quota,
remaining subscription balance, router or proactive mode is claimed implemented.
The broader contracts remain in [USAGE-AND-ROUTING.md](./USAGE-AND-ROUTING.md).

## Validation

Automated regression coverage and isolated native trials are described in
[CONTRIBUTING.md](../CONTRIBUTING.md) and [SELF-DEVELOPMENT.md](SELF-DEVELOPMENT.md).
Record detailed local receipts privately. Fixtures and source builds do not prove
installed-app acceptance.

## Reuse and sources

The native folder picker uses `tauri-plugin-dialog` (MIT/Apache-2.0); result
rendering uses `react-markdown` (MIT), with raw HTML disabled. Existing Radix
controls, theme tokens and mascot behavior are reused. The CLI adapters were
checked against installed `--help` output and official
[Codex non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode),
[Claude programmatic execution](https://code.claude.com/docs/en/headless), and
[Tauri dialog documentation](https://v2.tauri.app/plugin/dialog/).
Grok 1.0.13's actual structured output was verified with a minimal response and
then a file task. Process-group libraries remain an evaluation option, not an
installed dependency or a claim of crash-proof containment.
