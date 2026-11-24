# Usage, capacity and proactive work

Routing inputs share repeated account metadata without dropping eligible models,
task requirements or acceptance criteria. Ask Jackalope prefills bounded official
documentation excerpts with full-document fallback. These reduce prompt repetition
and offer fewer documentation round trips; paid-token and quality gains still need
matched trials. [Local AI](LOCAL-AI.md) describes model-free retrieval and prompt packing.

Native attempt accounting and overall/project Usage are implemented; see
[CORE-WORKFLOW.md](./CORE-WORKFLOW.md) for coverage and limitations.
Capacity readers connect Codex, Claude Code, Grok and Antigravity through their
installed CLIs, plus managed Kimi Code membership accounts; see [PARALLEL-WORKFLOWS.md](./PARALLEL-WORKFLOWS.md). Claude's usage control API
is experimental. Grok can omit percentages even when it reports an account and
reset period; missing capacity stays unknown. Default-agent routing, quota-aware preflight, local active-task reservations and
bounded quota handoff are implemented.
Monetary budgets, calibrated estimates and proactive execution remain planned.
See [ARCHITECTURE.md](ARCHITECTURE.md) for task ownership and
[ROADMAP.md](ROADMAP.md) for future direction.

## Current routing contract

Agents → Routing selects an app default and optional project overrides. Project
onboarding includes the same choice. Existing installations retain agent-powered
routing. Local rules use project preference, capacity and active workload without
a model call. Agent-powered routing uses the configured default agent. Jev-assisted
routing uses a separately billed TypeSafe API key saved on this device. Explicit
assignments, continuations and a single eligible worker avoid selection calls.

`commands/decisions` owns versioned decision kinds, provider selection, project policy
and receipts; policy storage, contracts and strategy classification have separate
modules. `jev` owns TypeSafe transport, response validation and key management.
Worker eligibility, ranking and launch authorization stay in `tasks/routing`.
New decision consumers must resolve the project policy, define a typed domain input
and validated output, retain the policy revision and actual provider, record usage
even when abstaining, and leave execution authorization to their native owner.
Decision receipts attached to work are explanatory copies; provider attempts and
immutable assessment records own usage accounting.

Jev receives a versioned task context shared with strategy assessment: the complete
request, selected saved context, acceptance requirements, root repository guidance,
a bounded repository map and change scope, verification command and assignment
instructions. Tool delivery evidence contains connection names, not credentials,
endpoints or command arguments. A map or configured connection is not proof of
current file contents, discovered tool schemas or execution permission.

Settings exposes optional sourced model records for exact adapter/model IDs,
including capabilities, restrictions, context limits, effort support and price
references. These records are user-supplied, not independently verified. Records
older than 90 days are marked stale; model names do not establish competence.
Historical outcomes retain account/effort cohorts, sample size, lexical task-match
coverage, recency and missing usage. Lexical similarity is observational evidence,
not a controlled comparison.

Independent Score questions assess reasoning and domain fit; Noul questions assess
tool support and task ambiguity. Code validates every answer and admits each
candidate separately. Probability mass in the suitable Score levels must reach
0.9, as must tool support; ambiguous tasks use 0.95. Uncertainty between two
suitable levels does not reject a worker. Malformed responses still fail validation.
These provisional gates require held-out calibration and are not probabilities of
task success. Strategy Choice remains advisory and cannot create or authorize a plan.

Quality first is the default routing objective. Balanced compares recorded costs
among suitable workers within 0.2 of the highest composite fit; Economical compares
all suitable workers. Cost ranking requires complete recorded worker/routing dollar
costs, matching requested effort/account, at least ten decided tasks, lexical
matches and fresh evidence throughout the cohort, and a 95% Wilson lower success
bound of 0.7. Missing comparable costs retain quality ranking; token prices alone
cannot predict completion costs. The comparison excludes separately recorded
assistance and projectless activity. Subscription quota is never treated as dollars.
Explicit worker/effort selections and continuation identities remain pinned.

Validated Jev assessments can be reused for ten minutes within a running app when
request, repository evidence, model evidence, questions and policy still match.
Capacity is rechecked before launch. Receipts retain the returned model identifier,
rubric revision, input fingerprint, probabilities and routing disposition. If the
provider returns an alias, its concrete version remains unknown. Reuse does not
create another paid usage record. Policy changes or cancellation prevent applying
an in-flight result. Responses and requests remain bounded, with a fixed HTTPS
endpoint, pooled connections, no redirects/retries and an eight-second timeout.
The native request budget remains 64 distinct workers and 256 KiB; oversized inputs
fall back whole. Byte limits are not an exact model-token count.

Jev fallback remains Local by default, or one Agent-powered attempt when selected.
Cancellation cannot launch fallback work. Unknown usage stays unknown, including
interrupted requests. Decision records contain bounded typed outputs and hashes,
not the full task or diff. Existing routing and strategy receipts own their costs;
optional assistance has a separate ledger so those calls are not counted twice.

## Optional Jev assistance

Routing goals and optional assistance in Agents → Routing can inherit app
settings or use project overrides. All additional helpers default off. While enabled
and Jev is connected for that scope, relevant repository guidance, candidate lessons,
diffs, results and check output may be sent to TypeSafe. Each call records usage even
when the response is rejected. Helpers fall back to existing behavior without a
second agent assessment.
Without a usable saved key, optional assistance and discovery skip Jev entirely.
Automatic review lessons enter either local or Jev selection only after a later
reviewed attempt in the same task accepts the same requirement with a matching
successful check of that tree. Unresolved feedback stays available in Project
context; explicitly edited lessons remain under user control. Historical checks
establish the lesson's provenance, not correctness of a new task.

- Agent questions expose `ask_jev` over native MCP and `POST /v1/jev/questions`
  to active task attempts. This experiment requires an enabled project option,
  Jev decision mode and a connected device key; agents never receive that key.
  Launch instructions and the input schema explain Choice, Score and Noul,
  explicit evidence paths and batching independent judgments. The native bridge
  can supply bounded workspace file excerpts or the attempt's captured tool results
  directly to TypeSafe, returning source hashes/ranges without echoing the text.
  Limits are eight requests per attempt, 32 questions, eight sources and 128 KB
  per request. Failed evaluations count toward the request limit. Missing sources
  fail explicitly; partial file ranges identify the next line. Advice never grants
  permissions, removes required checks or guarantees correctness. Exact filtering,
  arithmetic and syntax stay local. End-to-end savings require matched evaluation.

- Context selection reranks a bounded set of saved lessons before new worker starts.
  It skips the API when local selection already contains every eligible candidate.
  Explicit workflows and lesson exclusions remain authoritative. Uncertain existing
  lessons remain included; only strong irrelevance/conflict evidence removes them.
  At app scope, the same option reranks Ask Jackalope documentation passages.
- Failure triage classifies supported code, environment, dependency, permission and
  quota failures after execution. It never retries a task or bypasses a denial.
- Requirement coverage compares saved requirements (or the original request) with
  bounded result, tracked diff and check evidence. Missing evidence stays unknown;
  the advisory cannot accept an outcome or replace verification.
- Review prioritization identifies changed tracked files needing focused review.
  Untracked file contents are not included, and truncated evidence remains explicit.
  Result Review shows the recorded advice; later edits can make it stale.
- Monitor filtering skips only clearly unrelated committed changes. Missing,
  oversized, truncated or uncertain evidence retains the approved monitor behavior.
  Assessment runs outside the scheduler lock; schedule identity and source revision
  are checked before suppressing a change. Quiet local checks make no Jev call.
- Assignment matching evaluates an Automatic planned worker's own responsibility,
  dependencies and handoffs against eligible models. It does not change reviewed
  scopes, explicit workers, accounts, effort or the number of assignments.

Optional assessment calls appear with their purpose in Usage and its export,
including monitor checks that launch no worker and app-scoped documentation calls.
The ledger records interrupted calls as unknown until a usable report is retained.
The separate worker/routing totals do not include this assistance ledger.

Jev routing attempts appear in task/project usage with reported input/output tokens,
including usable reports from rejected assessments. Estimated cost uses the
[published rate](https://typesafe.ai/blog/introducing-system-one-models-and-jev) of
$0.042 per million input tokens and free output. This is not an invoice or measured
savings. Connection checks have separate device-wide cumulative usage, with missing
reports explicit. The quota panel links to TypeSafe; remaining balance, limits and
reset times are unavailable through the integration. Installed API acceptance,
real-task cost/latency comparisons and native macOS/Linux credential checks remain open.

`tasks/routing.rs` owns automatic selection and up to three quota handoffs.
`tasks/routing/process.rs` runs a bounded, cancellable routing-only subprocess
outside coordinator/execution locks. The default agent sees the complete request, its
acceptance criteria, recorded outcomes and eligible agent/model/account options with
provider windows; context saved for the worker is left out. It answers without tools at
its lowest effort (Claude on Sonnet rather than its default or Opus, Codex at low
reasoning) and returns a validated option ID, a short reason, an optional quota
estimate and up to three ordered alternatives. A routing agent that does not answer
within eight seconds, or fails without a quota error, leaves the choice to local rules
and the receipt says why, so routing never holds up or blocks the work. Provider identifiers, task text and progress
are untrusted input, not executable routing instructions.

Enabled/configured models, project allowlists and account selections, available
executables and required tool delivery constrain options. Unspecified models retain
the CLI default. No model entitlement is inferred from a model name. Capacity uses
account-bound Codex/Claude/Grok/Kimi/Antigravity readers shared with the Usage panel, cached for up
to 60 seconds; custom executables and unsupported providers have unknown capacity.
Expired/stale windows are not treated as current quota. Estimates leave a 10-point
reserve in the limiting reported window, plus reservations for other active local
attempts sharing the account or an identified quota pool. Reservations are conservative
percentage estimates, not provider-enforced budgets or guarantees against external use.

Quota errors require provider error events, including Claude rejected rate-limit
events; assistant prose and warning-only events do not trigger handoff. A provider
refusal of the content (usage policy, content filter, safety block) is not lost capacity:
it never hands off and is reported as a refusal, unless a quota error code accompanies
it. The exhausted account/pool is excluded (only an explicitly model-scoped error permits
another model in that pool). Handoffs retain the owned workspace, original task and
progress context. They cannot increase project permissions or tools. If the default is
also exhausted, a saved ranking can select the next currently eligible option; without
one, work stops with an actionable error. Explicit tasks and continuing sessions are pinned.
Exclusions belong to the attempt that handed off; new work and retries route from fresh
capacity, so a preferred or default account is chosen again once its reported window
resets. Retrying an attempt the quota stopped continues in its worktree with its
uncommitted changes and the same progress context, led by an optional focus line from
the person. The progress context last sent (quota handoff, lost session or such a retry)
is kept on the attempt under Task details.
Codex, Claude, Grok, OpenCode and Kimi can coordinate; Antigravity and Gemini CLI are worker-only.
Automatic quota handoff can be enabled or disabled in the Defaults section of the Agents page with All projects selected.

### Usage limits on stopped work

`tasks/usage_limit.rs` and `tasks/failure.rs` type a failed attempt's limit as a used-up
allowance (`quota_exhausted`), a short rate window (`rate_limited`) or a billing or credit
limit (`billing`), separately from sign-in failures. The quota record keeps the provider's
own message and, only when the provider states it, the reset (`resetsAt`, Unix seconds):
Claude Code's rejected `rate_limit_event` `resetsAt`, `usage limit reached|<epoch>` and
"resets 3pm (Zone)" wording, Codex's "try again at 4:12 PM" text, `resets_at` and
`resets_in_seconds` error bodies and used-up `rate_limits` snapshots, and Gemini's
"reset after 2h3m" and `retryDelay`. A time without a named zone is read in this
computer's zone, which is where a local CLI prints it. Billing limits never carry a reset.
Jackalope does not retry rate limits itself; the agent CLIs retry transient ones.

A task or conversation stopped this way shows a banner naming the provider and account,
the reset as a local time with a live countdown (or that it was not reported) and the
provider's message under a toggle. **Resume at reset** is offered when a reset was
reported: a task retries its latest attempt (continuing its workspace like any quota
retry) and a conversation resumes its queue, adding a short "continue" message when
nothing is queued. Both start a minute after the reset, are saved with the attempt or
conversation so they survive a restart, can be cancelled, and are dropped by any pause,
resume or finish the person chooses or by a newer attempt. A task resume that cannot
start keeps its reason on the attempt. **Switch account** and **Switch agent** retry a
task's latest attempt on another account or agent the project allows, with the same
progress context as a quota handoff; conversations stay pinned to their agent and
account, so they offer resuming only. Notifications and Inbox read "Usage limit — resets
3:40 PM" instead of a generic failure. Usage & quota lists accounts recent work found
limited until the reported reset; without one, until later work uses the account or
twelve hours pass. That list is local observation, and routing still reads capacity
from the providers' readers. With the desktop Vite server running,
`node scripts/verification/verify-usage-limit.mjs` checks the task banner's countdown,
keyboard scheduling and cancelling, switching, dismissal, themes and a 960 by 640 window
with fake IPC; it does not prove a real provider limit or a native resume.

Routing attempts and failed worker legs retain separate provider usage with
agent/model/account attribution. Decision copies are explanatory and excluded from
usage totals. Missing reports stay unavailable. New continuations do not duplicate
prior routing usage. Native fixtures cover failure, stop and recovery contracts;
installed-agent acceptance remains separate. See [STATUS.md](STATUS.md) for limits.

Kimi worker usage uses before/after totals from the advertised local `/usage` command.
Resumed session totals are subtracted; context occupancy is separate. Missing cache,
cost, interrupted-turn totals and helper usage stay unknown. Managed Kimi membership
windows exclude extra-usage balances and custom providers. Antigravity uses a
version-gated read-only `/usage` response (no model turn), preserving separate
Gemini and Claude/GPT pools. Routing uses only the selected model family's windows;
an unknown/default model has unknown headroom. Gemini API-key profiles have separate billing. Neither
response establishes a stable account identity for cross-profile pool deduplication.

## Current usage dashboard

Agents → Usage & quota opens account limits and recorded usage on one page across
all projects. Project, agent, account and period filters apply
consistently to task totals, daily trends (monthly for all time), project/agent
breakdowns and the task ledger. Select a chart bar to inspect calls dated
in that bucket, or select a project/agent row to narrow the scope. Task links open
the latest saved attempt. Individual calls retain provider, model, input/output
and available cost estimates; task rows combine the selected calls across attempts.
Dates use the viewer's local time: workers use attempt start dates; routing and
quota handoffs use recorded dates. These are not per-token billing timestamps.

Attempt usage stores input as every prompt token the provider read, cache included:
Claude, OpenCode and Antigravity report cache reads and writes beside uncached input,
which Jackalope adds; Codex and Gemini CLI input already contains its cached part.
New context is input minus cache reads and writes, and the cache hit rate shown with
an attempt is cache reads divided by input. A Claude attempt with at least 50,000
input tokens and no cache reads is flagged, since prompt caching may be off.

Agent selection is measured routing overhead, including failed selections.
Quota-interrupted worker legs remain separate from the final worker. Prompt,
coordination, tool and in-task verification tokens remain inside worker usage;
their exact overhead share cannot be inferred. Missing reports make totals partial
and suppress the routing percentage. Cached input and partial child observations
are not counted twice. Charts have accessible numeric labels and keyboard controls.

Outcome counts and usage groups use the latest saved task review across loaded
history. Acceptance requires explicit outcome receipts for the same reviewed
snapshot; process exit does not establish acceptance. The selected period limits
usage, not the date of that latest review. Account/agent filters show their
contribution to those tasks, not exclusive credit for accepted work.

Ask Jackalope appears separately from task totals. New turns record a date and the
account, and, when project sharing is current, the open project. The project, account,
agent and period filters apply to those turns. Turns saved before a date existed
appear only in All time, and turns without a project or account appear only under
the matching All choice. Archived conversations stay in the ledger. Unreadable
helper files are named and left on disk. Deleted helper history cannot be
reconstructed. Connected capacity remains a separate account-wide view
that may include other applications. Opening Usage and reading capacity do not
send model prompts. Unreadable task history hides summaries until reload succeeds.

Where agent time goes shows, for attempts that measured it, the agents' working time
by activity: thinking and writing, reading the code, tests and builds, trying the app
and other work, compared across agents, with the slowest tools by measured time. It
follows the project, account, agent and period filters and says how many attempts
in scope ran before activity was timed.

### Agent working time

Each attempt's `efficiency.activity` splits the agent's working time by kind, from
tool start and finish events as they arrive. `tool_activity::activity_kind` names the
kind from the tool and, for shell commands, the command: `ask` (waiting on the person),
`check` (tests, builds, linters, type checks and saved checks), `app` (browser and
desktop use), `command`, `helper`, `web`, `edit`, `read`, `search`, `plan` and `tool`.
`think` is time with no tool running, when the model reads results, plans and writes.
The clock starts with the execution stage and advances on every event, so the kinds
add up to the time from launch to the agent's last event. A moment with several calls
running goes to one kind, in the order listed above, and a helper agent's own calls
stay inside its parent call. `efficiency.toolTime` keeps each tool's total and
longest measured call, in which overlapping calls each count in full; both maps keep
at most 100 tool names. Codex, Claude Code, Grok, OpenCode, Gemini CLI and Antigravity
are timed. ACP agents and attempts recorded earlier have tool counts at most. Timing
starts again from the next event after Jackalope restarts mid-attempt.

Task assessments have a separate project/period-scoped ledger, including calls that
never launched work and failed calls with unavailable reports. Immutable receipt IDs
deduplicate reused assessments. They are excluded from worker and routing totals and
hidden under agent/account filters because assessment history has no account attribution.
Jev connection checks appear as a compact setup-usage row in the unfiltered view,
with device-wide, all-time totals separate from task and period totals.

JSON export schema 6 preserves the schema 5 attempt, usage-breakdown, filter,
task/outcome, trend, assessment and helper fields, and adds helper turn dates,
projects, account keys, archive markers and unreadable-file names. The export
covers the project/account/agent/period scope, including filtered helper turns, not
the temporary chart bucket inspection. It omits prompts, provider transcripts and
account directories.
Only loaded task history is covered; archived or deleted tasks are not reconstructed.
Ask Jackalope archives are included.

## Task-strategy decisions

Task submission resolves the project's Decisions policy before implementation.
Local rules handle fast paths; other eligible requests use one bounded model
assessment, with at most one additional agent assessment when the Jev fallback is
explicitly Agent-powered. Jev uses Choice to recommend focused work, investigation
or planning. Local is the default fallback. Separate provider attempts retain both
usage reports, including unknown usage, without counting the aggregate receipt again.
The complete request, selected context, repository instructions and bounded
map feed the assessment; oversized context falls back whole. Unchanged requests
can reuse a ten-minute receipt. Request/settings, policy revision, repository source
or selected-context changes invalidate reuse. Cancellation retains any reported cost
but cannot publish a recommendation that starts work.

Create a plan uses the selected development agent, model and account and consumes
its normal capacity. With the Automatic agent, each assignment and subtask routes
separately; an explicitly chosen agent and account stay pinned for every worker.
Native code validates one to four (up to eight) scoped assignments, dependencies
and ownership; multiple assignments receive a final combined review and verification.
Automatic subtasks start the validated plan when the planner finishes; otherwise
users inspect the concrete plan before starting. One parent keeps planning, worker
attempts, follow-ups and usage together in Chat and Inbox. Dispatch is restricted to
that parent and restarts paused. Dependencies use verified predecessor snapshots;
final integration is explicit and project automatic merge excludes managed tasks.
Existing live-session batch and cost limits retain their serial execution path.
See [parallel workflows](PARALLEL-WORKFLOWS.md) for recovery and review behavior.

## Composer effort and context

The composers' effort picker sends a provider level for one send (`reasoningEffort` on
the request, saved on each conversation message and queued follow-up), separate from
the prompt-only task approach. It wins over the approach's level, and a conversation
batch never mixes levels. `task_effort_levels` offers the levels Decisions records for
that adapter and model, otherwise the measured levels in `tasks/effort.rs`, otherwise
low to high, limited to what the CLI flag takes (Claude Code `--effort` up to `max`,
Codex `model_reasoning_effort` up to `xhigh`). Agents without an effort flag get no
picker. Automatic offers low to high and the routed model clamps the level, as it does
for any level a model lacks.

The context meter shows `TaskRun.context`: the input (with cache) of the latest
top-level model call, and the window only when the provider states it (Claude Code's
`modelUsage.contextWindow`, Kimi's `usage_update`). OpenCode reports usage without a
window, so only the count shows. Codex `exec --json` reports only turn totals, and
Gemini and Antigravity only totals, so they show no meter.

## Usage interface contracts

Users should be able to answer: what did Jackalope use, for which work, what
capacity remains, and what can I change? Give Usage a clear global destination,
a project-scoped entry point and a task-level breakdown. Validate its placement
in navigation, and do not turn the working home into a wall of metrics.

- Start with a readable period selector and All projects/project filter. Offer
  grouping and sorting by project, agent, model and account, with task drilldown.
- Separate **Jackalope activity** from **Connected capacity**. Account-wide
  consumption can include work outside Jackalope and must not be attributed to
  a project or added to Jackalope's usage again.
- Show tokens reported by each agent/model: input/output and supported cache or
  reasoning details. Preserve provider semantics; overlapping categories must
  not be added twice. Show cost only when available, with currency and whether
  reported or estimated. Subscription quota is not interchangeable with API cost.
- Include retries, failed and canceled attempts, subagents, refinement, routing,
  proactive scans and other Jackalope overhead. Identify unattributed activity
  explicitly. A small task should not conceal a large coordination bill.
- Show connected tools in their native units: requests, credits, execution time,
  storage or other exposed limits. Do not manufacture a universal token total
  for non-token tools or combine incompatible quota windows into one percentage.
- Provide useful comparisons and trends with coverage visible, then drill into
  the tasks and reasons behind changes. Let users export filtered records.
  Avoid rankings that imply token count alone measures productivity or quality.
- Explain empty, delayed, disconnected and unsupported states. Display freshness
  and provenance near figures; unavailable is never displayed as zero or unlimited.

Use quiet typography, aligned numbers and progressive disclosure. A compact
chart should answer a question that the adjacent values cannot. No animated
status ornaments or invented live activity. Tables, filters and charts need
keyboard access, accessible labels and text equivalents independent of color.

## Measurement and accounting contract

Capture usage at the execution boundary, independently of mounted views. A
normalized record identifies its source/event ID, time, task, attempt, project
(or projectless/unattributed), host, adapter/agent, account, model and purpose.
Tool calls and child attempts link to their parent without counting the same
provider event twice. Stable account identity matters when multiple adapters
share a provider balance or the same account is connected on several devices.

Keep raw reported units and their definitions alongside normalized values.
Adapters declare whether events are deltas, cumulative snapshots or final
totals; reconcile streaming estimates with final values idempotently. Persist
records across navigation/restarts and deduplicate replay after reconnect.
Estimated values carry the estimation method and revision; exact means a
source-reported measurement, not an inferred count from terminal text. Track
coverage so a total of known records never claims to include missing usage.

Provider billing and local observation can differ. Display that distinction;
do not claim invoice accuracy for estimated cost. Version price references with
effective time and currency. Retention/export controls should cover accounting
metadata without requiring storage of prompts, secrets or full tool payloads.

Acceptance examples:

- A streamed run, retry and child agent reconcile to their source totals after
  restart; parent and child records are not accidentally counted twice.
- Project filters reconcile to overall attributed plus projectless/unattributed
  activity, with missing coverage visible.
- A CLI that does not expose token usage shows that limitation even when the
  task succeeded. A supported provider can show its exact reported counts.
- A proactive scan or model-selection request appears as Jackalope overhead,
  including when no task is recommended.

## Connected capacity in one place

Create adapters for supported provider and tool quota APIs, usage exports or
documented runner telemetry. Record source, owning account/subscription/resource,
unit, limit, used/remaining when exposed, window and reset time, observed time,
freshness and adapter capability. Distinguish token/request rate limits,
subscription allowances, spend budgets and concurrency limits. Some services
expose only a subset; show only what can be supported.

Shared pools have one identity with their dependent models/tools listed beneath
them. Refresh within service limits, honor backoff and expose refresh errors.
Manually entered limits are labeled user-supplied, not live provider balances.
Connect using supported authorization and scopes; do not read private client
state or promise that every signed-in agent exposes remaining subscription quota.

The dashboard and router read the same capacity service. Preserve snapshot
history for explanations. Local reservations prevent concurrent Jackalope work
from each spending the same available budget; they do not reserve external
provider capacity or account for activity outside Jackalope. Reconcile actual
usage and release reservations on completion/cancel/recovery. Unknown or stale
capacity must produce an explicit policy decision, never an implicit unlimited
allowance. An account-wide budget requires coordination across its active hosts.

## Future extensions

Chat sessions support optional batch counts and estimated-dollar pause thresholds.
Admission evaluates settled batch usage, including recorded routing attempts and quota
handoffs. Unknown usage or missing attempt history blocks later dispatch when a cost
threshold is set. A batch already running can exceed the threshold; there is no
account-wide reservation or provider billing cap. Saving new limits never resumes work.

Usage focuses on account limits, tokens, estimated cost and task activity. Review views
save optional useful/needs-work ratings and whole minutes spent reviewing or correcting
locally with each task.

The native `workflow_report` command retains an aggregate for engineering diagnostics;
it is not a Usage page section. Its seven-day window uses loaded local task history and
UTC dates. It counts task starts,
days with starts, follow-up attempts, failures, latest-attempt ratings and useful tasks
with a prior failure. First-useful timing is measured from the first loaded task start
to the earliest retained useful rating, not sign-in or installation. Superseded ratings
are excluded; missing review minutes remain unknown. Aggregate values exclude prompts
and project names. The command neither sends telemetry nor measures retention.

Enforced monetary budgets, calibrated routing estimates, proactive proposals and shared
host accounting are future work in the [roadmap](ROADMAP.md). They must preserve
provider-neutral accounting, local execution without a mandatory hosted gateway,
and explicit project/account permissions. Evaluate changes against representative
tasks, including missing telemetry, shared accounts, cancellation and retries.

Proactive proposals require opt-in scope, bounded scans, visible consumption,
deduplication and approval before creating an ordinary task. Revalidate evidence,
permissions and capacity before dispatch. Existing user-approved schedules and
local change monitors retain their own execution policies.
