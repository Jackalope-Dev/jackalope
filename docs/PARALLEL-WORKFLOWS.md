# Parallel local work

This document describes the local operator: installed agents, usage/capacity,
isolated parallel work, coordination and review before integration.

## Use it

### Live sessions

Open **Live** and send a message to start a session. The first message names it;
history groups sessions by attention, activity and completion, with recent work first.
Capture stays available while a batch runs. Messages arriving together are grouped
in order; subsequent batches continue in the same isolated worktree and retain the
selected agent account.
Use **Pop out** for a separate window; its pin controls always-on-top. Closing the
window leaves execution running. **Pause queue** holds later messages, while
**Stop work** also stops the active attempt through the existing runtime.

Sessions save messages before claiming a batch, preserve draft revisions across
windows, and pause after failures or restart. Pending launch retries reuse the saved
attempt identifier. An interrupted launch requires an explicit retry. Session attempts
stay in loaded history; a missing completed attempt blocks continuation until restored.
Interrupted process ownership keeps the normal runtime safeguards.
Never edit the session journal while its profile is running. Reload saved sessions
after resolving a storage error; failed loads preserve the original file.

Review and preview pause dispatch. A running preview holds further writes to its
workspace. **Changes** exports a cumulative binary-capable patch from the original
base without committing or changing the index. A check applies only to the exact
exported tree. The workspace and saved patch remain available for review and manual
integration. Live sessions currently serialize batches; independent native task
planning and automatic integration are not part of this flow.

### Parallel task queues

Ordinary tasks ask their lead agent to delegate useful independent work through
available provider subagent tools. Users do not choose a split mode. This stays
within the provider session and does not create native queue entries; see
[agent quality](AGENT-QUALITY.md) for limits. Explicit feature plans remain available
for reviewing a queue before dispatch. Unfinished drafts from the former split
dialog reopen in feature planning after any unfinished regular plan is imported;
their saved run, steps and storage remain intact.

1. Open the native desktop app and choose a Git project with a committed local target branch.
2. In Tasks, choose **Plan parallel work**. Add focused tasks, or **Import a plan**
   from JSON. Review titles, instructions, assigned agents, owned paths and dependencies.
3. Choose the concurrency limit and **Run ready tasks**. The limit counts currently
   active application attempts across projects. Explicit single-task launches remain
   available separately. Pausing dispatch leaves current attempts running; each has Stop.
4. Follow work or read structured progress/blocker/handoff messages. Each task gets
   a separate worktree from the resolved target commit. Shared scopes wait for integration;
   dependencies wait for their actual integrated changes, not a successful process exit.
5. In **Review & merge**, select finished tasks and prepare the combined patch. Inspect
   individual results and verification, then choose **Merge tasks into <target branch>**.
   Jackalope proposes a result-derived message and creates one commit using the
   project attribution settings. The approval can also remove completed source
   worktrees and their local branches.
6. Dependencies become eligible after integration. Dispatch always starts paused after
   an application restart. Failed/stopped work can be retried in a fresh worktree or
   abandoned to release its scope. Attempt history and integration receipts remain
   available after successful cleanup.

The [example plan](./examples/parallel-plan.json) demonstrates the import schema.
It is not an automatic launch. Edit agents, scopes and prompts for your project
and review every task before dispatch. Native schedules use the same guarded
runtime; proactive proposals and remote execution remain roadmap work.

Optional feature staging consumes verified immutable predecessor snapshots before final
integration. Queue admission favors critical paths and fair project access; finishing
attempts keep workspace ownership while verification uses separate capacity. See
[execution quality and evaluation](EXECUTION-EVALUATION.md) for opt-in staging,
reservations, structured reports and measurements. Legacy plans retain merge dependencies.

## Coordination contract

The native `Coordinator` owns a durable queue. It validates a complete imported plan,
rejects missing dependencies/cycles/invalid scopes, and saves it atomically before
dispatch. A mutex and the runtime’s shared integration exclusion serialize eligibility
checks, reservation and launch. A persisted run ID is the claim; a missing or failed
attempt is not silently reclaimed after restart. History and queue ownership locks
prevent two app instances from using the same journals concurrently.

The bridge uses Axum on an ephemeral **127.0.0.1** port, with REST operations
and an official Rust SDK MCP transport. It also brokers opt-in project tool discovery; see [MCP-DISCOVERY.md](MCP-DISCOVERY.md). Only running assigned tasks receive a random
bearer credential through their child-process environment. No token is put into task
records, browser storage or global agent configuration. Continuations renew task-scoped
access. Tokens stop authorizing calls once their attempt is no longer active.

| Route | Purpose |
| --- | --- |
| `GET /v1/project` | Assigned task, project task ownership, dependencies, phases and messages |
| `POST /v1/messages` | A progress, blocker or handoff note attributed to the calling task |
| `GET /v1/messages` | Cursor-based inbox of broadcasts, addressed messages and the caller's sent messages |
| `POST /v1/messages/ack` | Durable, idempotent acknowledgment of a visible message |
| `/mcp` | Stateless Streamable HTTP coordination, harness and tool-discovery operations |
| `POST /v1/tools/search`, `/v1/tools/read`, `/v1/tools/execute` | Scoped connection discovery and execution for HTTP-capable adapters |

Requests with a browser Origin are rejected; no CORS policy opens access. JSON bodies
are capped at 16 KiB and message text at 4,000 bytes. Messages are untrusted worker
observations. They never start another task, grant permission, mark a result successful,
or merge work. Codex/Grok use their allowed shell/network tools to call REST. Claude receives
a per-run `--mcp-config` with an environment placeholder and explicit permission
for just `mcp__jackalope__project` and `mcp__jackalope__message`. This uses Claude’s
supported tool interface without weakening its shell policy or writing credentials
to configuration files. MCP validates the current credential for every request;
stateless transport prevents authorization leaking between client sessions. It is not a security boundary against
another process already running as the same OS user.

Every launch and continuation receives a bounded current project briefing. Native
lifecycle changes publish project announcements automatically, and ordinary bridge
tool responses deliver new messages without extra model turns. Delivery is bounded,
prioritized and deduplicated; it does not acknowledge reading, interrupt agents or
change task ownership. See the [automatic coordination contract](ORCHESTRATION-CAPABILITIES.md)
for limits, migration/recovery and provider-independent delivery boundaries.

Manual tasks appear in the project inventory with explicitly unknown scopes.
Directed messages accept recipientTaskId (recipient_task_id in the MCP schema)
from that inventory. Acknowledgments mean read, not agreement or permission.
Codex receives the MCP bridge for all bridged tasks; Grok, OpenCode and Antigravity
receive the same capabilities through permitted HTTP. See the current
[capability contract](ORCHESTRATION-CAPABILITIES.md) for limits and notifications.

Named ownership claims and interface agreements persist alongside the queue.
Changed-file scope checks block dispatch and integration until reconciled; the app
provides explicit recovery actions. See [decision and scope contracts](ORCHESTRATION-CAPABILITIES.md#ownership-and-interface-decisions).

File scopes are normalized relative paths, used for scheduling and agent instructions.
They are **not filesystem write enforcement**. Independent worktrees contain mistakes;
the user still reviews the actual changed files. Explicit manually launched tasks have
unknown write scope, so they pause new queued work for their project while active.

## Review and Git integration

Preparation accepts the latest finished isolated attempt for each task, rejects active
or interrupted ownership, and snapshots all tracked/staged/untracked nonignored changes
through a separate temporary Git index. Forced additions already in the source index are
preserved. The source index and files are not staged, reset or committed in place.

Git `commit-tree` and `merge-tree` prepare the combined result against captured the target branch.
The app retains a reference and durable review receipt. A conflict produces a blocked
review with the conflicting paths; it does not touch the target branch. Reiterate an affected task,
or resolve with ordinary Git tools and prepare a new review. There is no conflict editor yet.

Apply rechecks the selected sources’ HEAD, content tree and index/worktree state, current
the target branch, checked-out target, ignored-file collisions and dirty/untracked files. It then
performs a fast-forward only, with automatic stash and ignored-file overwrite disabled.
No push or destructive reset is performed. When selected in the approval, cleanup
rechecks each source and removes its worktree and matching local branch. A cleanup
failure does not roll back a successful merge; the receipt records each result
and supports retry. Interrupted apply receipts
can recover an integration that reached the target branch before its final history write. If the target branch
is externally reset away from an applied integration, dependency dispatch pauses instead
of claiming those changes are still present.

The preview is bounded text, not a substitute for running tests or examining binary files.
Build/test results remain agent-reported evidence to inspect; preparation does not itself
prove the combined code builds. Windows native validation and disposable Git tests cover
the implemented path; cross-platform lifecycle checks remain open.

## Commit ownership and cleanup

Project setup and Project settings expose user-only, user with agent co-authors,
and agent attribution. The local repository config stores `jackalope.commitPolicy`;
it does not change global Git identity or sync private commit emails to the service.
User identity starts from Git's configured name/email and can use the account's
private commit email. Agent identities use clearly labeled `.invalid` addresses;
they are attribution labels, not provider-verified accounts. Multiple contributing
agents, including routing handoffs, retain distinct co-author trailers.

By default, a successful task in its original Jackalope branch gets one checkpoint
after process shutdown and automatic verification, if enabled. No-change runs do
not create empty commits. Shared checkouts, failures, cancellations, quota handoffs,
foreign branches, hidden index entries and divergent staged content are not
checkpointed. Checkpoint failure retains files and appears in review. Project
settings can disable automatic checkpoints. Agents receive consistent handoff
instructions and Git identity environment values; the native writer owns checkpoint
and final-merge metadata. This is not a sandbox against a CLI deliberately issuing
its own Git commands. Review squashes the selected snapshots to one target commit,
so intermediate commits do not clutter main/master history. Users may edit the
suggested message before preparing the final review.

Cleanup uses ancestry for clean merged branches and exact no-op Git three-way
merges for the staged and working snapshots when content was copied or squashed.
Equivalent content is separate from commit ancestry. Divergent content, unknown
ignored files, locked worktrees and active/interrupted tasks remain protected.
Only recognized ignored build/dependency folders are discarded, after inspection.
Each bulk removal inspects its selected folder again; one error does not stop other
candidates. A Windows folder lock reports the affected path and a retry action.
If Git removed its registration but left residue, the remaining directory needs
manual inspection rather than an unverified recursive deletion. No remote branches
are deleted. Old applied receipts and saved task data remain readable.

## Usage and capacity

Task token history remains attributable to attempts/projects. Connected capacity adds
the signed-in Codex account’s supported app-server limits, with native windows, shared
pool identity, source time, reset times, unknown values and stale/error states. The
reader initializes a bounded short-lived app-server process and requests
`account/rateLimits/read`; it does not launch a model task or read private auth files.
Refreshes are serialized and throttled to one per minute; snapshots become stale after
five minutes or a passed reset. Other Codex clients consume the same account pools.

Claude Code and Grok have standalone capacity readers. Claude is initialized in
safe, nonpersistent print mode and receives a `get_usage` control request with
`skip_behaviors: true`; this omits the local transcript scan. Its experimental
interface reports subscription percentages (0–100) and ISO reset times, with
separate overall and model-specific windows. API-key/third-party accounts can
report that subscription windows are unavailable. Unsupported CLI versions ask
the user to update instead of falling back to private credential files.

Grok starts an independent `agent --no-leader stdio` connection and reads the ACP
extensions `_x.ai/auth/info` and `_x.ai/billing`, the same billing source as its
own usage UI. It prefers `creditUsagePercent` and `currentPeriod`; older responses
can supply a complete included-credit used/limit pair. Missing percentages remain
unknown, even when the reset date and subscription are known. Purchased balances
and on-demand spending are separate from the included allowance.

All three reads run concurrently within the serialized, one-minute refresh cache.
They send no model prompts and create no task sessions. Process output and runtime
are bounded; readers are stopped after success, failure or timeout. Sign-ins stay
owned by the CLIs. Failed initial reads cannot claim current capacity, and a newly
identified account or unsupported plan replaces the previous account's windows.

Protocol and parser tests cover missing values, explicit zero,
legacy credit units, model pools, output bounds and account changes.

Interface references: Anthropic's published `@anthropic-ai/claude-agent-sdk`
`SDKControlGetUsageRequest` / `SDKControlGetUsageResponse` types (experimental),
and Grok's [billing extension](https://github.com/xai-org/grok-build/blob/72a61251fcffb464bcc687aeb5a998e5a98ec0c9/crates/codegen/xai-grok-shell/src/extensions/billing.rs)
and [account metadata extension](https://github.com/xai-org/grok-build/blob/72a61251fcffb464bcc687aeb5a998e5a98ec0c9/crates/codegen/xai-grok-shell/src/extensions/auth.rs).

Automatic routing, multi-account selection and conservative active-task quota
reservations are implemented in `tasks/routing.rs`; see
[USAGE-AND-ROUTING.md](USAGE-AND-ROUTING.md). Routing subprocesses run after coordinator
reservation, without holding coordinator/execution locks during model calls. Quota
handoff keeps the same attempt and worktree reserved until completion or a bounded
failure, with owned-process shutdown before the next worker starts. Monetary budgets,
live permission dialogs, crash-proof containment and shared cross-project OAuth remain
separate work.

Sources and reuse: [Axum](https://docs.rs/axum/latest/axum/) (MIT),
[UUID](https://docs.rs/uuid/latest/uuid/) (MIT/Apache-2.0),
[official Rust MCP SDK](https://github.com/modelcontextprotocol/rust-sdk) 3.2.0 (Apache-2.0),
[Claude per-run MCP configuration](https://code.claude.com/docs/en/mcp),
[Codex app-server](https://learn.chatgpt.com/docs/app-server),
[Claude status-line telemetry](https://code.claude.com/docs/en/statusline).
The bridge uses the application’s existing Tokio runtime; no sidecar runtime is required.

## Verification

Automated regression coverage and isolated native trials are described in
[CONTRIBUTING.md](../CONTRIBUTING.md) and [SELF-DEVELOPMENT.md](SELF-DEVELOPMENT.md).
Record detailed local receipts privately. Fixtures and source builds do not prove
installed-app acceptance.
