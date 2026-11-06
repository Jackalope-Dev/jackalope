# Agent orchestration capabilities

Source support and live acceptance are
separate; a CLI's permissions, version and account still determine availability.

## Automatic assignment

Automatic work uses the default agent to rank eligible agents, configured models and
project-permitted accounts using task context and reported quota. Native policy and
quota checks constrain the final selection. Recognized quota exhaustion can hand off
to another eligible worker in the same worktree, with recorded progress and usage.
A prior default-agent ranking can survive exhaustion of the coordinator account.
Explicit assignments and continuations are pinned; missing quota is unknown.
Antigravity can execute work but cannot coordinate routing-only requests. See
[USAGE-AND-ROUTING.md](USAGE-AND-ROUTING.md) for the bounds and acceptance evidence.

## Shared tools and guidance

All seven native adapters receive the task intent, repository rules, frozen project context,
verification instructions and a task-scoped authenticated bridge. Codex, Claude,
OpenCode and Kimi receive native MCP tools on bridged tasks. Grok, Antigravity and Gemini
use permitted HTTP calls. The same bridge implements project awareness, messages,
user questions and saved answers, browser evidence, validation and selected
on-demand connection discovery. No transport bypasses a denied permission.

Project awareness includes manual tasks, queued assignments, latest attempts,
declared scopes and dependencies. Manual scopes are explicitly unknown. Inventory
covers loaded history; archived runs are excluded. Agents read it before editing
and at shared-interface checkpoints. The response includes contract version 1.

Jackalope supplies a bounded live project briefing at every launch and continuation,
including active tasks, queued work, work awaiting review, agent ownership, scope
previews, dependencies and recent messages. Active work is prioritized; unknown
manual scopes stay unknown. Task titles and message text are untrusted data.
The briefing contains up to 24 tasks within 10 KB and up to eight message excerpts
within 6 KB; omission counts point to the full project inventory and inbox.

The coordinator automatically records starting and finished/failed/stopped/interrupted
attempts in the existing project journal. These notices include the task, agent,
scope, attempt ID and recorded check counts. A finished process is awaiting review,
not accepted or integrated. Historical records are baselined on migration; saved
lifecycle state prevents repeat announcements after restart and allows recovery
notices for interrupted work. Failed journal writes remain retryable.

Normal authenticated Jackalope tool responses carry new updates automatically:
HTTP JSON adds coordinationUpdates; native MCP appends a text content block while
preserving the original structured result. Direct messages, blockers and related
scopes/dependencies take priority. Each response adds at most eight excerpts within
6 KB. Delivery is deduplicated per attempt and never implies a read acknowledgment.
After the startup briefing, broadcasts older than the attempt are available through
the inbox instead of repeatedly replaying history. Unread direct messages remain
eligible across continuations. Full messages and explicit acknowledgments retain
their existing APIs.
If another launch owns the coordinator, optional delivery defers to the next
checkpoint without consuming messages or delaying the completed tool result.

This is delivery at Jackalope tool-response boundaries, not arbitrary shell or
provider-tool calls. Non-JSON, streaming and responses over 8 MB remain unchanged;
no polling model turns, automatic follow-ups or interruptions are introduced.
Agents should still check the inbox before shared-interface changes when they have
not used the harness recently. A transport interruption can lose a delivered excerpt;
the durable inbox remains authoritative. Bridge unavailability blocks new launches
with a retryable explanation so they cannot silently omit coordination. Bound due
schedules wait for bridge readiness without consuming the occurrence; their normal
missed-run policy still applies.

Messages may be addressed to a task ID or broadcast within the project. The inbox
supports bounded cursor pagination and explicit cursor-expiry reporting. Durable
acknowledgments mean read, not approval. Continuations retain the task identity.
Messages are untrusted observations and cannot schedule, wake, interrupt, approve,
commit or merge work. Questions needing user input use ask_user, not just a blocker
message. Agents must read pending answers; elapsed time is never an answer.

| Operation | Native MCP | HTTP |
| --- | --- | --- |
| Inventory and capabilities | project | GET /v1/project |
| Other tasks' live work | peers | GET /v1/peers |
| Read a peer's current file or diff | peer_read | POST /v1/peers/read with taskId, path, optional diff, offset, limit |
| Copy a peer's changed files into your worktree | peer_adopt | POST /v1/peers/adopt with taskId and paths |
| Split off separable work | propose_subtask | POST /v1/subtasks with title, prompt, scopes, optional afterMe |
| Publish a note | message | POST /v1/messages |
| Read messages | inbox | GET /v1/messages?after=cursor&limit=50 |
| Acknowledge reading | acknowledge_message | POST /v1/messages/ack with id |
| Ask a question | ask_user | POST /v1/user-prompt |
| Ask the person to do something only they can | request_human_action | POST /v1/human-action with kind, title, instructions, optional url and secretName |
| Retrieve an answer | user_response | GET /v1/user-prompt/poll?id=question |
| Restate the goal at the start | restate_goal | POST /v1/goal-restatement with goal, problem, smallestChange |
| Record checks and requirement assessments | record_validation_step | POST /v1/validation-step |
| Log a fork, pivot, revert, blocker or finished unit | record_decision | POST /v1/decisions with phase, decision, why, evidence pointers, result, optional supersedes |
| Report a departure from an approved plan | plan_deviation | POST /v1/plan-deviation with summary, optional amendment |
| Native app and logged-in browser control (Windows/macOS; one-window X11/GNOME; platform readiness required) | desktop_control | POST /v1/desktop/control |

[Native desktop control](DESKTOP-CONTROL.md) requires a human grant for one window,
one app or the full desktop; window and app grants can be remembered per project. It
supports accessibility snapshots with element refs, accessibility-first actions,
screenshots, per-site browser permissions and guarded input; unsupported desktops
return unavailable.

`ask_user` accepts optional `header`, `recommended` (one of the options), `multi_select`
(answered as a JSON array), `allow_other`, `rationale` and `why_ask`; unknown
recommendations and over-long text are dropped. Questions from a [plan mode](PLAN-MODE.md)
planning attempt are limited by the plan's question cap and end when the person chooses
to stop; a closed question returns `status: closed` with a message instead of reaching
the person. A planning question without `why_ask` returns `status: not_asked` and does
not count toward the cap.
`ask_user` also accepts an optional `category` (`routine`, `secret`, `payment`, `sign_in`,
`account`, `publish`, `protected_path`, `direction` or `destructive`). When a project lets
agents decide on approved plans, a routine question from plan work may be answered by a
read-only decider attempt; the asker receives it prefixed `Answered by <agent> on your
owner's behalf:` and the saved prompt carries `answeredBy`. Any other category, or a
question the local classifier flags, reaches the person with an `escalation` reason. See
[agent decisions](PLAN-MODE.md#agent-decisions).
`request_human_action` asks the person to sign in, pay, create an account, add a secret or
take another manual step: `kind` (`secret`, `sign_in`, `payment`, `account` or `other`), a
`title` up to 120 characters, numbered `instructions` up to 2,000, an optional https `url`
and, for a secret, a `secretName` shaped like an environment variable. It is never routed
to an agent. The app and the phone companion show it as a **Needs you** card with the steps,
the link, a hint to add a secret under Project settings → Secrets, an optional note and
**Done** or **I can't do this**; the agent waits like `ask_user` and reads `Done` or
`Declined`, followed by `Note: ...` when the person wrote one. It counts toward the
attempt's 100-question limit.
`record_validation_step` requirement assessments and the optional `safety_fact` carry an
evidence level that Jackalope checks locally; `restate_goal` records the agent's short
restatement once at the start. See [task outcomes](TASK-OUTCOMES.md#evidence-levels).
`plan_deviation` is accepted only from attempts working on an approved plan, records the
departure for the person and pauses that plan's dispatch; agents never edit the plan.

HTTP messages use recipientTaskId; the MCP schema uses recipient_task_id. Omit it
for broadcasts. Agents can see project broadcasts, their received messages and
their own sent messages. The user sees all project messages and acknowledgment
counts. The retained journal is bounded to 2,000 messages; expired cursors require
rereading and deduplicating retained messages. There is no infinite audit archive.

## Live peer work

Each isolated attempt stays the only writer of its worktree. `peers` shows every other
task in the project with unintegrated isolated work, running or awaiting review: its
owned paths, changed files with line counts, whether its snapshot changed since the
caller last looked, and the files Git cannot merge with the caller's current work.
`peer_read` returns one file, or that file's diff against the peer's starting commit,
from the peer's latest snapshot, in bounded character windows. Integrated, canceled,
archived and shared-checkout work is excluded, and a task cannot read itself.

Snapshots are the trees the scope check records about every ten seconds, so peer data
can be that old and a peer without a recorded tree reports that it has none yet.
Conflicts come from `git merge-tree` over synthetic commits of both snapshots on their
own bases; the result is cached by those commits. Reads never write to a worktree,
index or ref. Different lines of the same file can merge cleanly while path-based scope
audits still report the overlap; overlap gates are unchanged.

When a scope check finds a new conflict between two tasks where at least one is
running, each running owner receives one direct blocker message naming the other task
and the files. The same conflict is not repeated; once it resolves it can be announced
again if it returns. Messages arrive at the next harness tool response, like any
coordination update.

`peer_adopt` copies up to 50 named files from a peer's latest snapshot into the
caller's worktree, including deletions. Each file must be changed in the peer's
snapshot and unchanged by the caller, or unchanged since the caller last adopted it.
It runs under the execution guard and refuses while the caller's workspace has a check
or preview running. The adoption is recorded with the source task and tree. Scope
audits leave adopted files out of the caller's changed paths while their content still
matches that tree, so they count as the peer's work rather than an overlap or an
outside-assignment edit. Editing an adopted file makes it the caller's change again.
If the peer changes the file after adoption, the live conflict check reports it and
the caller can adopt again; the final combination still merges both sources.

A planned task with two or more started assignments shows whether their current
work merges cleanly, or which assignments and files conflict, refreshed every ten
seconds while any of them runs. This is a live merge check of unfinished work, not a
build, test or review of the combination.

## Subtasks

`propose_subtask` lets a running isolated task hand separable remaining work to a new
worker. The caller names whole files or folders inside its own paths that it has not
changed; `.` is refused. Those paths join the caller's `excludedScopes`, so later
edits there fail its scope audit, and dispatch no longer treats them as overlapping
the caller. A task can spawn at most three subtasks; a plan holds at most eight
implementation assignments, or its planned limit if larger. Paths overlapping another
unintegrated task are refused.

Spawning needs the user's consent: the task belongs to a plan that started
automatically, or the user chose **Split this task** on the running task. Split this
task records that permission and sends the agent a direct message asking it to split
off independent work; the agent decides what to hand on.

In a planned task, the subtask joins the same parent, uses staged dependencies and
is added to the final combined review, which is created when the plan had a single
assignment. `afterMe` starts it from the caller's checked result instead of the
target branch. Once the combined review has started, no more work can join. A
standalone task's subtasks are ordinary queue tasks with their own review and merge;
they dispatch on the parent's own key while its run continues, and other manual work
in the project still holds them. Every spawn posts a project handoff message.

## Swarm rounds

A plan approved as a swarm (beta) runs in rounds of managed assignments. After a
round's combined result merges, a read-only orchestrator attempt reviews the integrated
tree against the plan's criteria, running the saved check through `computer_verify`,
and either declares the plan done with evidence or names the next round's assignments,
which are validated and scheduled like the first, or wait for the person's approval
when the plan asks first, or for a deciding agent once the merged round passed its check
when the project lets agents approve rounds. Up to 4 orchestrators can review a large plan's areas in
parallel; their verdicts merge into one (done only when every area is done, next
assignments deduplicated and sequenced where scopes overlap). A round runs at least 8 and at most 24
assignments, sized to the slots of the project's capacity pool. Every planned or swarm
fork is placed on one host of that pool (this device or one of the person's computers) by
what it needs, the project's **Swarms run on** choice and which host has room; the reason
is recorded in its activity and a fork whose host is lost is retried once elsewhere (see
[swarms across hosts](BOT-COMPUTERS.md#swarms-across-hosts)). Rounds stop at the
plan's round limit (default 5), pause and stop with the plan, start paused after a
restart, and never assign `.jackalope/**`. A swarm Worker is optional. See
[plan mode](PLAN-MODE.md#swarm-rounds-beta).

## Ownership and interface decisions

`agreement` (HTTP `POST /v1/agreements`) saves structured decisions in the locked,
atomically written queue journal. `claim` reserves a named responsibility, optionally
with additional relative paths. Duplicate names and overlapping claims are rejected;
paths belonging to another unintegrated assignment cannot be claimed. This helps
avoid duplicate implementations when workers choose the same responsibility name;
it is not semantic duplicate detection or a filesystem permission boundary.

`transfer` offers an existing claim to one project task. The original owner retains
it until that recipient explicitly accepts the current revision. Paths with existing
changes cannot be transferred; paths in the original declared scope require revising
the plan with the user. `release` relinquishes a clean claim. The app can also release
an idle owner's claim after checking retained changes and process ownership.

`propose` records an immutable interface description and invited task owners.
Every invited owner must `accept`; a rejection keeps the gate blocked. Pending or
rejected interfaces block integration of involved tasks and dispatch of their
queued descendants. Participants can continue working to negotiate; this does not
interrupt their processes. The user can explicitly cancel an obsolete gate in
**Coordination & handoffs**. Agreement is separate from reading a message, resolving
a conversation, passing checks or accepting code. New proposals require new UUIDs;
responses include the current revision so stale decisions cannot overwrite newer ones.
Claims, responses and gates survive restart. Expired task credentials cannot mutate them.

The coordinator checks changed files against saved task baselines periodically
(about every ten seconds) and before dispatch or integration. Checks include
committed, staged, unstaged and untracked nonignored changes, and preserve the source
index. Declared scopes plus owned path claims define an assignment. Manual isolated
tasks retain unknown declared scopes but participate in overlap detection. Shared
checkouts do not receive an inferred scope. Verified predecessor snapshots remain
subject to their existing freshness checks.

Outside-assignment changes, overlapping edits and unavailable scope evidence block
new queued work for that project. Integration rechecks the selected sources. The app
shows affected paths; the user can accept extra files for one exact, idle content
snapshot. Further edits invalidate that acceptance. Overlaps and unavailable checks
cannot be waived by that action. Restoring the files or explicitly abandoning the
work lets the next check reconcile the gate. This detects conflicts at checkpoints;
it does not prevent an unrestricted CLI from writing files or coordinate external
databases and services.

**Automatic coordination** has two independent, off-by-default project options:
resolve conflicts/interface decisions, and merge verified work automatically.
Both require a saved project check and run only while that project's queue is enabled;
restart still pauses dispatch. Reconciliation uses the default agent, its configured
account and allowance, and existing global concurrency limits.

The native coordinator captures current verified source snapshots and creates a
separate reconciliation worktree, including conflict markers where Git reports them.
Source worktrees and the target stay unchanged while the worker resolves conflicts,
removes duplicate implementation and records its decisions. The worker must publish
a completion report with no remaining work for the current snapshot and pass the
saved project check. Original source identity, verification, target ancestry and
required outcome acceptance remain integration gates. Source edits, changed interface
decisions, remaining conflict markers, failures and missing launch receipts block
completion. Failed jobs require an explicit retry; they are not silently relaunched.

A mediator's recorded resolution is labeled **reconciled**, separate from each
original owner's agreement. Its source snapshots and resolving attempt remain linked.
Without automatic merging, the combined result stays in **Review & merge**. With it,
Jackalope applies the verified combined snapshot as one local target-branch commit.
It does not push or remove source worktrees. A persisted merge receipt recovers a
completed application after interruption. Neither mode establishes semantic correctness
from checks alone; installed acceptance and measured reduction in duplicate work remain open.

A project can limit automatic merging with `.jackalope/autonomy.json`, read from the
target-branch commit the integration starts from, never from a worktree, so a change
cannot loosen the policy it is judged by:

```json
{
  "version": 1,
  "default": "review",
  "rules": [{ "paths": ["docs/**", "apps/website/src/content/**"], "level": "merge" }],
  "protected": ["package.json", "migrations/**"],
  "maxFiles": 25,
  "maxChangedLines": 500,
  "acceptOutcomes": "evidence"
}
```

Levels are `review` and `merge`; later rules win and unmatched paths use `default`
(`review` when omitted). Protected paths, `.jackalope/**` and common CI configuration
always stay in review. File and line limits default to 25 and 500. A combined result
that touches any held path, exceeds a limit, or meets a policy that cannot be read
stays in **Review & merge** with the reason shown under Automatic coordination.
Without the file, automatic merging behaves as described above. Protect the files that
define the saved check (such as package scripts and test configuration) so agent work
cannot weaken the check that verified it.

The same file can limit what agents decide for the person on approved plans. The project's
**Autonomy** settings turn agent decisions on; a `decide` section can only make them
stricter, and without one the project's settings apply unchanged:

```json
{
  "version": 1,
  "decide": {
    "questions": "agent",
    "rounds": "person",
    "deviations": "agent",
    "escalate": ["payment"],
    "maxAgentDecisions": 30,
    "decider": "auto"
  }
}
```

`person` turns that kind of agent decision off; `agent` or leaving it out keeps the
project's setting. `escalate` adds categories to the ones that always reach the person
(none can be removed), a lower `maxAgentDecisions` replaces the project's, and `decider`
(`auto` or an agent ID) replaces the project's choice. Unknown fields or categories make
the policy unreadable, which stops every agent decision. The policy's `protected` paths
also escalate questions that name them. See [agent decisions](PLAN-MODE.md#agent-decisions).

Required outcomes still need a person unless `acceptOutcomes` is `evidence`. Then an
outcome counts as accepted when the agent's latest report marks it met with evidence
Jackalope checked at the ran or reproduced level, and the saved check later passed on
the same files. Jackalope records that acceptance on the outcome, noted as accepted by
the autonomy policy, before preparing the merge, so it remains even if the path check
then holds the result. Workflow checkpoints and outcomes a person did not accept always
need a person.

With a committed policy, a ready planned or swarm result (all assignments plus the
combined review) also merges automatically when the project merges verified work
automatically and its queue is running. A held result is not retried until the target
branch or its attempts change; the task shows why it was not merged. A merged swarm round then
goes to its orchestrator review; human acceptance still applies to every round the
policy holds.

While a project merges verified work automatically, Jackalope also delivers its branch.
Every 20 seconds it reads the branch head; when the head changes it pushes the branch
to the project's linked Artifacts repository without forcing it, using a short-lived
write token. When the policy committed on that head has a `deploy` section for that
branch, Jackalope deploys the head:

```json
{
  "version": 1,
  "deploy": {
    "branch": "main",
    "command": "pnpm install --frozen-lockfile && pnpm wrangler deploy",
    "check": "curl -fsS https://example.com/health",
    "rollback": "pnpm wrangler rollback --yes"
  }
}
```

Each command runs in a clean detached checkout of the deployed commit, with the
person's environment and tools (such as their Wrangler login or Cloudflare API token),
under the same time and stall limits as a project check; the checkout is removed
afterwards. `check` runs up to three times, 15 seconds apart. When it still fails,
`rollback` runs. A failed deploy, failed check or rollback pauses automatic merging for
the project. Merges a person makes still deploy, and a successful deploy resumes
automatic merging. Project → Swarm shows the Artifacts copy of the branch, the latest
deploy and its output, and offers **Deploy again** for the current head. Each head
deploys once, whatever the outcome. Files the deploy needs that are not committed, such
as local secrets, are not copied into the checkout.

Use `JACKALOPE_AGREEMENT_TRIAL_REPO` and `JACKALOPE_AGREEMENT_TRIAL_PROFILE` with the
ignored Rust test `installed_grok_and_claude_negotiate_ownership_and_interfaces` for
an installed-provider trial in a disposable repository and new profile. The retained
`result.json` reports transport/decision/file oracles. This is separate from installed
GUI acceptance and does not measure a speed or quality improvement.
The trial defaults to ten minutes; `JACKALOPE_AGREEMENT_TRIAL_TIMEOUT_SECONDS`
sets a bounded 30–1200 second deadline. On Windows, run a copied test executable
when builds are running to avoid locking Cargo's linker output.

## Cloud resources

**Project settings → Cloud resources** (or **Cloud resources** on Project → Swarm) creates
what a project's Worker binds to in the Cloudflare account connected under Settings →
Cloudflare. Without a connection the card links there instead. The screen offers R2, D1,
KV, Queues, Durable Objects, Workers, Hyperdrive and Turnstile; R2, KV, Queues and Durable
Objects start selected. Choices, the name prefix (the project name in lowercase words) and
Turnstile domains are kept per project across Back, retry and reload until setup succeeds.
The Hyperdrive connection string is not kept with them: setup saves it in protected native
storage for the project and sends it only to Cloudflare.

Resources are named `<prefix>-assets` (R2), `-db` (D1), `-config` (KV), `-jobs` (Queue),
`-postgres` (Hyperdrive) and `-turnstile` (a managed Turnstile widget). Setup runs one step
at a time, emitting `cloudflare-resources-progress` with the project path and step, and one
run per project at a time. Each step looks the resource up by name (`GET
/r2/buckets/{name}`, or the D1, KV, Queues, Hyperdrive and Turnstile list endpoints) and
creates it only when it is missing, so **Retry** reuses everything a failed run created. An
existing Hyperdrive config is reused as it is and needs no connection string. Durable Objects
and Workers are not created by setup; they appear in the bindings and are created when the
Worker deploys.

The result is written to `.jackalope/cloudflare.json`: account ID, prefix, each resource's
kind, name, ID (the bucket name for R2, the site key for Turnstile) and binding, and a
wrangler.jsonc fragment under `wrangler`. It holds no secret and is safe to commit. A
failed run still records what it set up. Jackalope never edits `wrangler.jsonc`; the result
view offers **Copy bindings**, per-resource copy buttons, the Turnstile secret key read from
Cloudflare on demand, and a link to the dashboard. Agents need nothing from the person:
every attempt receives the manifest as [Jackalope context](CORE-WORKFLOW.md#jackalope-context)
in its workspace, worktree or computer alike, and its launch input names each resource and
binding (for example "R2 bucket shop-assets bound as ASSETS") and points to the file. The
manifest stays ignored by Git there, so it never lands in task commits; committing it
yourself is optional, and a committed copy is used as it is.

Creating resources needs these account permissions: Workers R2 Storage, D1, Workers KV
Storage, Queues, Hyperdrive and Turnstile, each Edit. With an API token, a refusal (401, 403
or error 10000) names the permission the step needs and links to API tokens. With Connect
Cloudflare, setup asks for the matching scopes (`workers-r2-storage.write`, `d1.write`,
`workers-kv-storage.write`, `queues.write`, `hyperdrive.write`, `turnstile.write`) once,
through the same reauthorization Swarm uses, and keeps scopes the sign-in already had. When
Cloudflare does not allow those scopes for Jackalope's client, sign-in reports which token
permissions to use instead. An account without R2 turned on (10042) links to the R2 page;
rate limits ask to retry.

**Remove from Jackalope** only takes a resource out of the manifest (and forgets a saved
Hyperdrive connection string). **Delete from Cloudflare** is per resource and needs an
explicit acknowledgment; R2 deletes only empty buckets and Cloudflare's reason is shown.
Resources Cloudflare no longer has count as deleted.

`cargo test --lib cloudflare_resources::` covers each resource against a local server with
Cloudflare's response shapes (reuse, create, refusal, rate limit), bindings, the manifest
and scope gating; `apps/desktop/scripts/cloud-resources.test.mjs` covers the screen's
defaults and validation. Neither reaches Cloudflare.

## Visible support

Agent Configuration shows the selected adapter's support and limitations. Task
options describe tool delivery, and incompatible selected connections show an
explanation before launch. Custom agents inherit their configured adapter.
The shared agent-capabilities.json drives frontend checks and native direct
connection validation.

| Capability | Codex | Claude | Grok | OpenCode | Kimi | Antigravity | Gemini CLI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Shared harness | MCP | MCP | HTTP | MCP | MCP | HTTP | HTTP |
| On-demand stdio / HTTP | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Direct project connections | stdio / HTTP | stdio / HTTP / SSE | No | stdio / HTTP / SSE | stdio / HTTP / SSE | No | No |
| Continuation, stop, history | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Separate managed accounts | Yes | Yes | Yes | Yes | Yes | Gemini API keys | Yes |
| Capacity reader | Yes | Yes | When reported | No universal provider quota | Managed membership | Subscription login | No |
| Default coordinator / helper | Yes | Yes | Yes | Yes | Yes | No verified tool-free interface | No verified tool-free interface |

Unknown capacity stays unknown. Kimi ACP approvals and structured questions are
connected to Jackalope's question UI. Other native terminal prompts need their
adapter's supported protocol. All providers can request input through the shared harness;
permission escalation still requires a supported adapter protocol or continuation.

## User notifications

In-app companion notices remain authoritative for pending answers, failed or
interrupted tasks and review. Native OS notifications run from native task
state while the app is in the background, including close-to-tray operation.
They honor the shared All / Needs attention / Quiet setting and a separate OS
switch. Existing notices are baselined on startup, event identities prevent repeats,
and the foreground window suppresses OS delivery. No prompt, project name, path,
answer or credential appears in a toast. Settings offers a test notification and
reports delivery errors; OS notification policy can suppress banners independently.

Clicking a toast brings the running app forward and opens the exact saved attempt.
Resolved questions open their current task state. Quitting stops native observation;
cold-start activation from an old toast is not implemented. Windows packaged builds
use their registered application identity. Unpackaged release builds require the
installer's registered identifier; debug notices may appear under PowerShell.
macOS uses UserNotifications from a signed app bundle; Linux uses desktop
notification actions. Native permission and focus policies still apply. See
[platform contracts](CROSS-PLATFORM-RELEASES.md#platform-contracts). In-app notices
remain available. Certified installed Store identity, Focus Assist and
real notification click acceptance must be tested separately from source tests.

## Transport dependencies

- The bridge uses the [official Rust MCP SDK](https://github.com/modelcontextprotocol/rust-sdk)
  3.2.0 (Apache-2.0) and Axum for the shared bridge; no second server framework.
- Windows uses [tauri-winrt-notification](https://github.com/tauri-apps/winrt-notification)
  0.8.1 (MIT/Apache-2.0) for Windows toast activation callbacks. The standard
  [Tauri notification plugin](https://v2.tauri.app/plugin/notification/) supports
  desktop delivery but documents its Actions API as mobile-only.
- [Agent Client Protocol](https://agentclientprotocol.com/protocol/v1/initialization)
  drives Kimi lifecycle, capability negotiation, approvals and structured questions.
  Replacing tested CLI adapters requires provider-specific acceptance; ACP is not
  assumed to be available on every installed agent.
- [OpenCode's runtime configuration](https://opencode.ai/docs/config/) supports
  per-process configuration and native MCP. Project connections are merged into
  OPENCODE_CONFIG_CONTENT without replacing unrelated inline settings.

## Remaining improvements

Directed wake/steering needs provider protocol support and explicit scheduling
policy. Structured completion reports, explicit message resolution and bounded inbox
waits are implemented; see [execution evaluation](EXECUTION-EVALUATION.md). Automatic routing needs capacity freshness, budgets and account limits;
additional reconciliation work and verified merging require explicit project opt-in. Expand native transport
coverage only with live permission and continuation trials.
