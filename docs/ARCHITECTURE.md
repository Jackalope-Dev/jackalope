# Architecture

Jackalope has three applications and a shared branding package. Desktop execution
is local; the optional Cloudflare service is not required for projects, history or review.

## Repository ownership

| Location | Owns |
| --- | --- |
| `apps/desktop/src` | React views, local UI state and clients for native commands |
| `apps/desktop/src-tauri` | Execution, persistence, process ownership, Git safeguards and native packaging |
| `apps/website` | Marketing, browser account flows, static discovery output and website verification |
| `apps/server` | Optional hosted ingestion, account/access services and database migrations |
| `packages/brand` | Shared theme, tokens, typography and character geometry |
| `packages/knowledge` | Shared public guides, Markdown serialization and generated native help catalog |
| `scripts/release` | Cross-application build, signing, release receipts and publication orchestration |
| `scripts/verification` | Browser regression fixtures and local acceptance helpers |
| `docs` | Public architecture, feature contracts, verification and release guidance |

Application runtime imports share code through `packages/brand` and `packages/knowledge`; applications do
not import each other's runtime modules. Release tooling intentionally spans
applications. The website generates its monochrome SVG and PNG icons directly
from shared character geometry during development and builds.

## Desktop execution

App.tsx owns the execution observer and theme clock independently of navigation.

Codebase views own bounded `notify` subscriptions through `codebase_watch`; events
invalidate the displayed snapshot and never launch tasks or alter branch monitors.
Project readiness uses isolated gix metadata reads with Git fallback. Review rendering
uses Pierre Diffs and task-result rendering uses Streamdown; neither owns integration
approval or native execution. See [dependency integration contracts](DEPENDENCY-INTEGRATIONS.md).
Shell selects Tasks, Project, Agents, MCP or Usage. Zustand stores keep
selection, drafts and preferences; they do not establish that native work ran.

~~~text
Composer / saved idea / queue / native schedule
  → typed client and Tauri command
  → Coordinator reservation and TaskRuntime
  → default-agent routing and quota admission for automatic tasks
  → installed CLI in the selected account and workspace
  → parsed events and durable attempt history
  → task detail, questions, checks and patch review
  → prepared integration receipt → explicit application
~~~

executionStore.start synchronizes agent policy and invokes task_start. Clients in
lib/queue.ts synchronize policy before queue creation/dispatch. Native commands
are registered in src-tauri/src/lib.rs, the authoritative command inventory.
lib/task-runtime.ts, lib/queue.ts, lib/agent-profiles.ts, lib/codebase.ts and
lib/tauri-bridge.ts hold feature contracts/clients. DTOs follow Rust serde field
names; changes must preserve both sides and old saved records.

## Native modules

| Under src-tauri/src/commands | Responsibility |
| --- | --- |
| tasks.rs, tasks/ | DTOs, lifecycle, storage/recovery, discovery, adapter events and IPC |
| tasks/routing.rs, tasks/routing/ | Validated default-agent selection, quota admission, routing subprocess ownership and bounded handoff |
| coordination.rs, coordination/ | Queue contracts, eligibility, storage, guarded dispatch and loopback bridge |
| integration.rs | Captured source snapshots, review receipts and guarded fast-forward application |
| git.rs, git_command.rs, worktree_cleanup.rs | Worktree operations and explicit Git environment policies |
| history.rs, reset.rs | Atomic writes, quarantine, recovery and explicit reset |
| process_control.rs, pty.rs | Owned process trees and separate tested PTY primitives |
| agent_policy.rs, agent_profiles.rs, capacity/ | Allowlists, profile binding/sign-in and capacity |
| mcp.rs, mcp_broker.rs, coordination_mcp.rs, harness.rs | Connection configuration, attempt-owned discovery/execution and task-scoped tools/questions |
| schedules.rs, browser.rs, codebase.rs | Recurring dispatch, browser sessions and repository analysis |
| desktop_control.rs, desktop_control/ | Attempt-scoped Windows window grants, accessibility, capture and guarded native input |
| knowledge.rs, monitors.rs | Project lessons/workflows, immutable task context receipts and local Git change checks |
| outcomes.rs | Frozen task contracts, workflow step gates and snapshot-bound human acceptance |
| readiness.rs, previews.rs | Read-only workspace suggestions and owned local preview process trees |
| verification.rs, artifacts.rs, release.rs | Saved checks, artifacts, diagnostics and signed updater |

Lock order is **coordinator state → execution guard → runtime state**.
TaskRuntime::start_locked requires a caller-held execution guard. Successful
agent exit is not an integrated dependency. Integration rechecks source/target
identity, saved checks and local files before changing a checkout. See
[PARALLEL-MVP.md](PARALLEL-MVP.md) for the full contract.

## Persistence and trust

`browser.rs` owns task browser reservations and cancellation; `browser/engine.rs`
owns the bundled agent-browser daemon, process tree and disposable profile. Native
MCP and HTTP handlers use the same seven tools and existing screenshot artifacts.
The daemon is a pinned local implementation detail, not a hosted service or an
agent-supplied executable. See [BROWSER-AUTOMATION.md](BROWSER-AUTOMATION.md).

`desktop_control.rs` separately owns explicit per-window grants and a single desktop
input lease. Both transports share task authorization, cancellation and snapshot
checks. See [DESKTOP-CONTROL.md](DESKTOP-CONTROL.md) for Windows support and limits.

Native profiles store task journals, queues, schedules, integration receipts and
preferences. Locks prevent concurrent writers. Interrupted attempts are retained,
not automatically replayed. Unreadable files are preserved; unsaved history blocks
operations that would lose continuity. Legacy plan-only schedules and saved ideas
remain compatible.

JACKALOPE_PROFILE_DIR selects an isolated test profile. It does not isolate installed
CLI sign-ins or global MCP configuration. Browser preview exposes unavailable states
or explicit fixtures rather than manufacturing execution results.

The coordinator binds to loopback and gives active tasks scoped credentials.
This is not a security boundary against another process running as the same OS
user. Agent CLIs and configured MCP programs run with local privileges; worktrees
are not a sandbox. Credentials must not enter journals, browser persistence,
source files or public support reports.

## UI and shared code

The helper service owns a separate conversation and loopback MCP surface. It
reuses provider process primitives and exposes reviewed app actions through one
typed dispatcher. See [Ask Jackalope](HELPER.md) for context, persistence and
authorization boundaries.

The shell companion collects global task, update, schedule and history notices.
Sources publish through useCompanionNotices and retain ownership of their dialogs
and actions. companionStore persists read identifiers only; reading a notice does
not change native task, update or recovery state. Keep action-local errors inline.

components/tasks separates collection/composer, detail/result review, queue/add-work
and integration review. Shared controls live in components/ui. System information
belongs to Settings; saved task editing belongs to Tasks.

packages/brand owns theme/geometry exports and fonts. Both apps import that package;
the website renders its own monochrome icon assets. Desktop stores own theme persistence. The lab is available
in development or an explicit lab build, but excluded from normal release output.

## Website and optional service

The website is a separate React/Vite app with explicit marketing fixtures and
configured release URLs. apps/server is a Cloudflare Worker: contracts validate
ingestion, storage owns D1 persistence/retention, and the entrypoint serves ingestion
and R2-backed update objects. Defaults disable ingestion; live resource identifiers
belong in an ignored explicit deployment config. Local development needs no cloud login.

Native commands/community.rs owns saved disclosure/privacy/channel choices and
bounded native HTTP delivery. communityStore and telemetry.ts manage the in-memory
client queue; Settings owns explicit feedback review/Send. Server contracts/storage
own strict validation and aggregation; admin.ts checks Access JWTs, admin-page.ts
renders the private inbox, and feedback-mail.ts leases notification retries.
Native account/feedback.rs owns bounded local feedback milestones and saved pending
preferences; feedbackStore and the task-result touchpoint coordinate its UI. Worker
access/feedback.ts owns authenticated campaign state, shared cooldowns, opt-in email
eligibility and scoped website replies through the existing inbox/outbox. Anonymous
telemetry remains separate. See [feedback invitations](FEEDBACK-INVITATIONS.md).
Shared brand/tokens exports pure theme calculation for browser and Worker rendering.
Native commands/account.rs owns optional early-access account connection; its
credential is protected by account_storage.rs with Windows DPAPI or a macOS Keychain /
Linux Secret Service reference. platform.rs initializes the Unix GUI login PATH before
runtime threads start; children inherit the discovery environment. Worker access/devices.ts
owns approval, hashed credentials and revocation; the website owns explicit browser
approval, device management and email invitation entry. The Worker derives bounded
referral milestones from member/download/device state; the desktop account command
validates and exposes that view without receiving project, prompt or task data. See
[DESKTOP-ACCOUNT.md](DESKTOP-ACCOUNT.md).
Optional account-linked preference sync uses strict renderer/native/server
allowlists and per-device consent. See [settings sync](SETTINGS-SYNC.md) for
versioning, conflict handling, deletion and rollout.
Waitlist access/waitlist.ts owns separate verification sessions and shared ranking;
access/growth-mail.ts turns durable referral/pass events into the existing outbox.
See [WAITLIST-REFERRALS.md](WAITLIST-REFERRALS.md) for the distinct waitlist and pass
contracts, migration and email lifecycle.
See [BETA-MONITORING.md](BETA-MONITORING.md). Remote execution pairing,
teams and distributed execution remain future work. Read
[BACKEND.md](BACKEND.md) and the [service README](../apps/server/README.md).

## Verification

Project knowledge is stored in the native profile, scoped by project and canonical
folder. The launcher freezes bounded matching lessons and selected workflows in
task journals; continuations reuse that original context. Native schedules can
check Git content before dispatch and retain inspectable change receipts without
model calls. See [PROJECT-KNOWLEDGE.md](PROJECT-KNOWLEDGE.md) for usage and limits.

pnpm verify is the local/CI gate. JavaScript tests exercise derived state, contracts
and persistence. Rust tests use disposable repositories/profiles, with opt-in
provider/browser trials separate. Worker tests use local workerd/D1/R2. Rendered
checks and signed installed-upgrade trials supplement the suites; see [TODO.md](TODO.md).

Store preview admission is owned by native `commands/execution_access.rs`: account verification supplies a bounded lease, checked before native launch/coordination/scheduled dispatch and PTY creation. The renderer presents connection/recovery state but cannot grant access. Store builds use Microsoft Store updates; see [STORE-RELEASE.md](STORE-RELEASE.md).
