# Usage, capacity and proactive work

Routing inputs share repeated account metadata without dropping eligible models,
task requirements or acceptance criteria. Ask Jackalope prefills bounded official
documentation excerpts with full-document fallback. These reduce prompt repetition
and offer fewer documentation round trips; paid-token and quality gains still need
matched trials. [Local AI and evaluation](LOCAL-AI.md) records the MiniLM decision.

Native attempt accounting and overall/project Usage are implemented; see
[TASK-JOURNEY.md](./TASK-JOURNEY.md) for coverage and limitations.
Capacity readers connect Codex, Claude Code, Grok and Antigravity through their
installed CLIs, plus managed Kimi Code membership accounts; see [PARALLEL-MVP.md](./PARALLEL-MVP.md). Claude's usage control API
is experimental. Grok can omit percentages even when it reports an account and
reset period; missing capacity stays unknown. Default-agent routing, quota-aware preflight, local active-task reservations and
bounded quota handoff are implemented.
Monetary budgets, calibrated estimates and proactive execution remain planned.
See [ARCHITECTURE.md](ARCHITECTURE.md) for task ownership and
[ROADMAP.md](ROADMAP.md) for future direction.

## Current routing contract

`tasks/routing.rs` owns automatic selection and up to three quota handoffs.
`tasks/routing/process.rs` runs a bounded, cancellable routing-only subprocess
outside coordinator/execution locks. The default agent sees the task, frozen project
context, outcome contract, coordination instructions and eligible agent/model/account
options with provider windows. It returns a validated option ID, reason, optional
quota estimate and ordered alternatives. Provider identifiers, task text and progress
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
events; assistant prose and warning-only events do not trigger handoff. The exhausted
account/pool is excluded (only an explicitly model-scoped error permits another model
in that pool). Handoffs retain the owned workspace, original task and progress context.
They cannot increase project permissions or tools. If the default is also exhausted,
a saved ranking can select the next currently eligible option; without one, work
stops with an actionable error. Explicit tasks and continuing sessions are pinned.
Codex, Claude, Grok, OpenCode and Kimi can coordinate; Antigravity is worker-only.

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

## A dedicated Usage destination

Users should be able to answer: what did Jackalope use, for which work, what
capacity remains, and what can I change? Give Usage a clear global destination,
a project-scoped entry point and a task-level breakdown. Validate its placement
in navigation; monitoring is a purposeful surface, not a reason to turn the
working home into a wall of metrics.

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

Monetary budgets, calibrated routing estimates, proactive proposals and shared
host accounting are future work in the [roadmap](ROADMAP.md). They must preserve
provider-neutral accounting, local execution without a mandatory hosted gateway,
and explicit project/account permissions. Evaluate changes against representative
tasks, including missing telemetry, shared accounts, cancellation and retries.

Proactive proposals require opt-in scope, bounded scans, visible consumption,
deduplication and approval before creating an ordinary task. Revalidate evidence,
permissions and capacity before dispatch. Existing user-approved schedules and
local change monitors retain their own execution policies.
