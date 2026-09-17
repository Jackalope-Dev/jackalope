# Agent quality and usage evaluation

Jackalope supplements installed agent harnesses. Success means a correct, reviewable
result with fewer retries and reasonable total usage. Prompt size alone is not a
quality score, and passing synthetic tasks does not establish superiority over a
provider's own GUI.

## Prompt and output contracts

- Fresh worker launches ask the lead to assess delegation after
  inspecting repository context. Small or tightly coupled work stays sequential;
  useful independent work can use the provider's available, permitted subagent
  tools without a separate split decision from the user. Explicit user/repository
  restrictions still apply. The lead assigns bounded ownership, reviews worker
  results, waits for workers and verifies the combined changes. Missing or denied
  subagent tools fall back to sequential work; no extra CLI, account or queue task
  is launched to emulate them. These are agent instructions, not native enforcement
  of a worker count or evidence that a provider actually delegated. Provider
  lifecycle, usage coverage and quality still require installed trials.
- In the opt-in compact-prompt experiment, confirmed Codex, Claude, OpenCode and Grok native-session continuations with the
  same recorded prompt-policy hash reuse prior workflow instructions. Current task,
  contract, workspace, permissions and coordination data remain explicit. Older
  receipts, changed policies and other adapters receive full guidance.
  Normal tasks retain version-two guidance and the full preamble. The quality runner's
  `--compact-prompts` flag selects version-three frontend guidance and sets
  `JACKALOPE_CONTEXT_EXPERIMENT=compact` only for the candidate. Keep it experimental
  until matched task evidence supports enabling it.
- Automatic guidelines distinguish design tokens from authentication tokens, skip
  negated requests and fenced examples, and avoid a debugging workflow for spelling
  fixes. Explicitly selected guidelines and project defaults remain available.
- Generated instructions identify the worktree Jackalope already assigned. Saved
  version-one and version-two ideas reconstruct their original generated text before migration;
  edited instructions remain verbatim.
- Native MCP adapters use their tool descriptions. Grok, Antigravity and Gemini CLI receive a
  short authenticated `GET /v1/help` bootstrap instead of the entire HTTP manual
  on every launch. Coordination ownership, untrusted messages, pending user input
  and permission boundaries remain explicit.
- Routing receives the task, outcome contract and selected knowledge without the
  worker's bridge protocol manual. Different agents/models still use the existing
  validated router; unknown defaults are not assumed equivalent.
- Workers finish a coherent implementation before batching required tests, builds
  and evidence capture in a final verification phase. Explicit test-first or repository
  instructions, and diagnostics necessary to choose an implementation, take precedence.
  Each applicable requirement gets a concise final agent assessment with a status,
  justification and evidence references through one `record_validation_step` call.
  These claims appear beside the review controls and never accept requirements for the user.
- Workers batch independent reads/searches where supported, reuse established
  context and keep progress concise. Repository-required checks remain mandatory;
  changes, failures and unresolved concerns justify additional verification.
- Repository maps rank file paths and bounded Tree-sitter declarations, include
  related test names and task-referenced file locations, and remain limited to
  6 KB. The compact experiment caps this at 3 KB when the request explicitly names one or two indexed files.
  Cached lines are advisory and must be verified before edits. Scans share
  a lock per repository/commit, allowing unrelated repositories to scan independently.
  Account capacity reads share in-flight refreshes and use at most four concurrent
  reads, preserving candidate order and final policy/quota reservation checks.
- `computer_verify` omits recognized passing-test lines only from long successful
  responses, preserving diagnostics and stderr. Failed output remains intact within
  the existing capture limit. `verification_output` (HTTP `/v1/computer/output`)
  accepts `{}` to recover the latest saved result and check ID after a lost or
  timed-out response. Further output pages require that ID to prevent mixing checks.
  Stored results and the review UI retain captured output. Neither operation permits
  a new command. Agent verification reuses a passing result only when the saved
  command and Git workspace snapshot still match; changed, failed or unbound checks
  execute again. Reading output alone does not verify subsequent edits.
- Codex receives permission to invoke verification only when the task has a saved
  check. `computer_verify {}` runs that attempt's saved command; `project.verification`
  exposes the command and automatic-check setting. Launch guidance names the saved
  check and its native tool so agents can verify without requesting shell approval.
  Explicit command/args remain compatible only when they exactly match the saved
  command. The native guard rejects attempts without a saved check and any additions.
- Permission denials stop the denied action. Independent authorized work may
  continue, with unresolved blockers reported.

## Repeatable comparison

`pnpm evaluate:quality` prints the plan without running an agent. The cases cover an
exact spelling edit, design-token substitutions with unchanged geometry, and a
dependency scheduler with ordering, immutability and completed-task requirements.
Independent oracles check behavior and reject unrelated file changes. Oracle
regression tests prove that broken inputs fail and representative solutions pass.

The installed-agent test creates a fresh repository, native profile and isolated
task worktree per trial. It retains native journals, exact prompt bytes, reported
usage, oracle results and failures locally. Logs can contain account labels; do not
publish the raw receipts. No global CLI configuration is changed.

```powershell
pnpm evaluate:quality -- --execute --agent=codex --model=gpt-6-astra --before=C:\trials\before.exe --after=C:\trials\after.exe --repeat=3 --seconds=180 --tokens=250000
```

The executable arguments are native Rust test binaries containing
`commands::coordination::quality_trial::installed_quality_trial`. Preserve the
baseline binary **before** changing product behavior. The frozen prompt fixture under `scripts/evaluation/baselines/` is active input
to the comparison driver and its resume regression tests, not a result receipt.
Pair it with the matching native baseline executable. Build with
`cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features --no-run --message-format=json`
and use the returned `compiler-artifact.executable`. Rebuild and preserve the after
binary separately. The driver records both SHA-256 hashes and the CLI version.

After an interruption, confirm the old benchmark process has stopped, preserve any
unfinished native journal, and pass `--resume` with the same output directory and
configuration. Completed trials, including failures, are retained. The driver checks
CLI/binary identity, budgets and pending fixture text before resuming. Record crash
interruptions separately; missing usage makes total experiment consumption unknown.

Variant order rotates across repetitions. Keep the account, explicit model,
reasoning configuration, fixtures and limits matched. Report usage coverage; missing
usage is unknown. Sum input and output across **all** attempts, including failures,
and divide by oracle successes. Cached input is reported separately and must not be
added to input again. These tokens are not a subscription-quota or dollar estimate.
The elapsed and reported-token limits are cancellation controls, not hard spending
caps. Human acceptance and review time remain unmeasured.

Add `--require-pass` to `evaluate:quality` or `evaluate:execution` for automated
validation. This returns a nonzero exit when any requested trial is missing,
duplicated, incomplete, stopped by a budget, or fails its oracle or process check.
Receipts are retained, including failed resumed trials. Without the flag, completed
experiments may contain failures for comparison; a successful driver exit alone
does not mean the tasks passed. Neither mode establishes human acceptance.

Summaries include elapsed p50/p95, measurement coverage and total milliseconds per
oracle success, retaining failures in the numerator. Native receipts additionally
record workspace preparation, routing, capacity, repository-map and process-spawn
durations, the first useful worker event after process launch, avoided routing
calls, map cache hits and reused helper servers. Timings can overlap (capacity is
inside routing); do not sum them into end-to-end time. Missing phases and older
records remain unknown rather than zero. Small fixture samples do not establish
production tail latency or unchanged quality on real projects.


## Effort, direct harness comparisons and routing evidence

Capture current frontend prompts before edits with `pnpm evaluate:quality --
--effort=balanced --save-prompts=<file> --revision=<source-reference>` and the same
`--cases` selection intended for execution. Preserve the native control executable
separately. `--control-prompts=<file>` uses those frozen prompts with `--control=<exe>`;
the explicit effort must match. Resume checks the prompt snapshot hash as well as
the existing executable and provider configuration evidence.

`pnpm evaluate:context comparison.json public-report.json [baseline] [candidate]`
creates a sanitized aggregate for reviewing potential public claims. Defaults compare
`direct` with `after`; use `control` to compare the preserved Jackalope baseline.
It excludes prompts, local paths, account fingerprints and raw receipts, retaining
source/build hashes, task IDs, configurations, counts, missing data and limitations.
All retained failed trials remain in totals. Duplicate trials are rejected.
Pilot signals require matched configurations/cases, complete evidence, passing independent
oracles, at least three cases with three repetitions each, and a positive lower
bound from a deterministic case-cluster bootstrap for a **pilot signal only**.
`eligibleForScopedClaim` remains false in this exporter. These checks do not establish
generalization or human quality equivalence. Report the exact
suite and limitations beside any public number. Tokens are not dollars or quota;
provider cache state is inherited. Do not publish raw task receipts.

### Independent experiments and publication evidence

For adaptive screening, pass `--stop-file=<path>` and create that file to stop
before the next matched case repetition. The current repetition finishes so both
variants remain comparable. The runner checkpoints its plan before dispatch and
records the active trial; resuming an interrupted run retains unknown interruption
usage. Preserve the original plan and all unfavorable or partial results. Early
stopping and configuration selection are exploratory; confirm a promising change
on a separately frozen held-out suite before making a savings claim.

The quality runner accepts per-variant `--after-workflow=final`,
`--after-task-approach=scoped`,
`--after-tool-surface=available`, `--after-named-read=on`,
`--control-result-selection=off`, `--after-repo-map=off` and
`--after-context-reuse=on` and `--after-source-context=on` switches; replace `after`
with `control` as needed.
Defaults retain existing behavior. The final-workflow experiment changes only
version-two debugging guidance. Scoped task-approach guidance limits call-site
investigation to code changes while preserving applicable instructions and checks;
it is opt-in for Balanced tasks. Saved
version-two and compact version-three prompts
remain reproducible. Context reuse independently tests established native sessions
with the same policy hash; missing sessions or changed policies receive full guidance.
Changing model or experiment configuration invalidates resume. `--order-seed=<id>`
randomizes the initial paired order per task and rotates subsequent repetitions.
`--control-model` and `--after-model` permit explicit model comparisons; changing
models is a different experiment from a same-model harness comparison.

Available-tool discovery omits MCP operations without selected on-demand connections
and verification without a saved command. Browser, questions, evidence and coordination
remain available. The named-read experiment resolves an exact, unambiguous read-only
tool through the existing broker, avoiding a separate agent search turn when its
arguments are already known. Incomplete catalogs, duplicate names, changed schemas,
disallowed tools and mutating operations cannot take this shortcut. It preserves
attempt ownership, connection allowlists, cancellation and result recovery.

Source-context preparation is opt-in and runs before the first worker call. It reads
up to four small, explicitly named source files inside the assigned workspace, with
an 8,000-byte serialized file-entry budget. Complete UTF-8 snapshots include paths
and content hashes; oversized files, traversal, hidden paths and unsupported types
are omitted. It does not guess files, summarize code, replace repository instructions
or run Jev. Workers still inspect missing context and refresh snapshots after changes.
Compare total task usage and correctness against both an unprepared Jackalope task
and the native CLI; fewer agent read calls alone are not proof of savings.

`node scripts/evaluation/repository-cases.mjs <suite.json> [revision]` creates
source-attributed seeded defects from committed Jackalope modules. Their provenance
and reference code are evaluation inputs, never worker context. These are small
repository-derived repairs, not historical issue resolutions or multi-repository
acceptance. Related mutations share a source family for uncertainty estimates.

`pnpm evaluate:impact comparison.json report.json [options.json]` retains failed
attempts in tokens/time per oracle success, separates cached input, and accepts
explicit sourced pricing and independent reviews. Prices are API-equivalent estimates,
not subscription bills. Its product-claim gate requires held-out confirmation,
independent human reviews, replication and sufficient independent task families;
it never authorizes publication. Run screening first, freeze the configuration and
quality tolerance, then collect new confirmation tasks without selecting favorable
subsets after seeing their outcomes. Missing helper, fallback or correction costs
prevent complete end-to-end cost claims.
Related source mutations and variants of one authored task template share a family.
Exploratory bootstrap intervals resample these families and are omitted below three
families. A narrow interval on a small authored suite does not establish generalization.

Supply prices under model IDs with `source`, `date`, `input`, `cachedInput` and
`output` USD per million tokens. For tiered prices, also supply
`longContextThreshold`, `longInputMultiplier` and `longOutputMultiplier`.
Without individual request sizes, cumulative input above the threshold produces
conservative cost bounds instead of an exact estimate. A nonzero `cacheWrite`
requires an explicit `cacheWriteIncremental` rate above already-counted input.
Missing accounting stays unknown. Set `protocol.includesHelpers` or
`protocol.includesExternalFallbacks` when applicable and record the corresponding
per-trial `helperCostUsd` or `fallbackCostUsd`, including explicit zeros. Use
`protocol.includesExternalCorrections` and `correctionCostUsd` for agent correction
work outside the recorded trial.
Reviews map exact private receipt paths to `accepted` and `notes`, assessing the
original patch before corrections. The claim gate evaluates agent execution time
and cost per independently accepted result. Human `reviewMinutes` and
`correctionMinutes` are optional, separate delivery measurements; they are not
required for execution claims. Do not treat off-page or agent-assisted review as
measured human review time.

`node scripts/evaluation/impact-export.mjs comparison.json public-experiment.json options.json`
exports an allowlisted public artifact. The options add `id`, `title`, `detail`
and variant `labels` to the impact-report options. Review the artifact and append
it to the website dataset's `experiments` array, then regenerate the website
summary. Exports omit receipt paths, account bindings, raw logs and human notes.
Blocked and unfavorable experiments remain visible; exporting does not publish.

`node scripts/evaluation/continuation-cases.mjs <suite.json>` creates authored
two-turn fixtures. Their `followups` run on the previous Jackalope session and
charge every attempt against one shared trial budget. Direct-CLI continuation is
not supported by this runner and is rejected rather than silently approximated.

`pnpm evaluate:review comparison.json <ignored-output-directory> [seed]` prepares
an exploratory review set of up to eight tasks and a separate assignment key. The local page
conceals provider identities and alternates diff-only and recorded-evidence conditions
within a seeded task shuffle. It records visible focused review time, explicit
decisions and notes. Human corrections remain unmeasured. One review set cannot
establish a causal speedup: use counterbalanced reviewers, equivalent task difficulty,
defect-detection checks and a preregistered review protocol before making that claim.
After the human downloads their answers, run
`node scripts/evaluation/review-results.mjs <study-directory> answers.json report.json [metadata.json]`.
It validates assignment IDs and reports approval aggregates. Timing is excluded by
default. Only explicit metadata with `reviewMethod: "manual"` and
`timingUse: "descriptive"` enables descriptive time aggregates. Mixed or agent-assisted
review remains quality feedback. Missing responses and measurements never become zero.

Prompt and context guidance follows [OpenAI's model guidance](https://developers.openai.com/api/docs/guides/latest-model),
[provider cache boundaries](https://developers.openai.com/api/docs/guides/prompt-caching),
[targeted tool results](https://www.anthropic.com/engineering/writing-tools-for-agents)
and [Aider's bounded repository maps](https://aider.chat/docs/repomap.html).
These sources motivate local comparisons, not Jackalope savings claims.

For an isolated large-response comparison, generate an authored suite with
`node scripts/evaluation/tool-result-cases.mjs <suite.json>` and pass it to the
quality runner with `--suite=<suite.json> --variants=direct,after`. Use a current
native test binary for both variants. The fixture owns a local read-only MCP
server outside the agent workspace; direct runs receive it through their native
MCP configuration and Jackalope runs through on-demand discovery. Both receive
the same extraction request and source payload. A unique temporary project
connection is removed after each Jackalope trial; global CLI configuration is
unchanged. Calls, returned bytes, output correctness and unrelated edits are
recorded or checked independently. These synthetic large payloads test a specific
tool-response workflow and do not represent ordinary coding-task savings.

New captured tasks send Quick/Balanced/Thorough as low/medium/high model effort
requests to Codex and Claude, in addition to the task approach instructions.
The flags apply only to the launched process. Providers can reject unsupported
models or constrain effort; the saved receipt records what Jackalope requested,
not a provider confirmation. Other adapters retain their configured model effort.
Legacy requests without an effort retain the CLI default. Continuations inherit
the saved effort unless a caller explicitly supplies another level. Quality-based
automatic model switching and effort escalation are not enabled.

The Codex, Claude and OpenCode bridge timeouts cover the saved check's queue, execution and bookkeeping
budgets. A check can wait 300 seconds for a slot and execute for up to 1,800 seconds,
with a separate 600-second no-output stall limit.
The queue and command keep their separate cancellation controls. Extending the
client timeout does not extend the command's execution limit or authorize another
command. Stored verification remains available through verification_output.
Claude and OpenCode receive a per-server timeout only for the Jackalope bridge;
unrelated connections keep their own limits. Claude uses its documented
[per-server timeout](https://code.claude.com/docs/en/mcp). Kimi's ACP transport and
HTTP-only adapters retain their provider-owned tool-request limits.

Active task summaries carry only the last three activity lines, bounded to 240 characters
each. The UI uses those events and native check output for live progress without model
narration or repeated diff scans. File-tool labels retain workspace-relative paths only;
tool arguments and edited content are not added to the activity previews. Full selected
attempt logs retain their existing capture policy. Tool starts are observations, not proof
that a file changed or that checks passed.

Isolated manual tasks whose launch snapshot has no peers or pending messages skip
routine coordination polling and completion messages. The exception does not apply
to current-checkout or assigned queue work. Shared-interface edits, scope expansion
and new coordination needs still require a refresh; tool-delivered updates remain
untrusted observations that the worker must assess.

Task history and usage exports record requested effort, launch prompt bytes,
verification stdout before/after filtering, and bounded unique tool-call counts
for Codex/Claude/Grok. Counts omit arguments and content; unavailable observations
are not evidence of zero activity. Routing, execution and quota-handoff usage stay
separate. Execution includes in-agent checking and internal retries: CLI reports
cannot reliably assign model tokens to each tool or verification stage. Cache-read
input is already included in input, and bytes are not tokens, dollars or quota.
Include every continuation attempt when comparing the cost of completing a task.

The evaluation runner supports four variants:

- `before`: preserved native executable plus the original frozen prompts.
- `control`: `--control` executable (defaults to `--after`) and current frontend
  prompts with an explicitly chosen effort.
- `after`: current native executable and prompts with an explicitly chosen effort.
- `direct`: installed Codex/Claude CLI, raw task instructions, same explicit model
  and base permission policy, without Jackalope guidance or its MCP bridge.

Direct uses the same initial fixture in a disposable Git checkout. Jackalope uses
its disposable worktree and automatic saved verification. For the scheduler case,
Direct requests the equivalent shell check instead of the Jackalope-specific tool;
Claude receives permission for that exact saved shell check. This tests the bundle
of harness behavior, not an identical tool inventory, a provider GUI, or human
acceptance. Global provider configuration and installed account state still apply.
Each receipt retains the resolved account binding locally. Do not publish raw logs.

PowerShell requires quoting comma-separated options:

```powershell
pnpm evaluate:quality -- --execute '--variants=control,after,direct' --model=gpt-6-astra --control-effort=thorough --after-effort=quick --direct-effort=quick '--cases=copy-edit,scheduler-fix,csv-cell' --repeat=3 --after=C:\trials\current.exe
```

Six additional authored tasks cover query decoding, stable deduplication, retry
limits, CSV escaping, grouped records and pagination. The first three are marked
`train`, the last three `holdout`; the original cases remain `regression`. These
are contract fixtures, not a representative real-repository benchmark. Their
oracles reject initial defects, accept known correct solutions, and detect scope
expansion. Neither oracle code nor reference solutions are injected into prompts.

Use `--suite=C:\trials\suite.json` to supply real repository-derived fixtures as
`{"cases":[...]}`. Each case has a unique `id`, `category`, `split` (`train` or
`holdout`), `prompt`, optional `directPrompt`, a relative path-to-content `files`
map, saved `check` command and independent CommonJS `oracle`. The oracle receives
the workspace as argv[2] and must check behavior, protected files and allowed scope.
Suite code and commands are trusted executable test code. Use reviewed fixtures
and disposable data. A custom suite cannot use the frozen `before` baseline.

```powershell
pnpm evaluate:routing -- C:\trials\comparison.json --outcome=oraclePassed --output=C:\trials\routing.json
```

The offline routing report selects the lowest measured tokens per success using
training results only. It requires at least three distinct cases and ten decided
trials per category/configuration, complete usage, and a 95% Wilson lower success
bound of 0.7. These are minimum experimental gates, not a production quality SLA.
Held-out results can reject the selection but never choose a replacement. Duplicate
receipts and overlapping training/held-out case IDs are rejected. CLI version,
executable hash and profile fingerprint must be known; configurations remain
separate. The fingerprint identifies the configured profile, not an authenticated
identity after someone signs in again. Direct CLI runs
are comparison data and cannot become a Jackalope worker selection.

Human acceptance is the default outcome; without reviews it stays undecided. Pass
`--reviews=C:\trials\reviews.json` with a map from exact receipt path to
`{"accepted":true,"notes":"Independent review observations"}`. Use oraclePassed
only for explicitly automated experiments. The report never installs a routing
policy. The native router separates historical model/account/effort cohorts,
includes loaded attempts and routing failures in costs, and preserves missing
usage. Insufficient or mixed historical evidence is not a learned specialty.

Provider configuration references: [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference)
and [Claude model effort](https://code.claude.com/docs/en/model-config#adjust-effort-level).

## Task speed and delivery measurements

Task customization and new Chat options offer a separate Codex speed preference:
provider setting, Standard or Fast. Explicit choices apply only to Codex worker
processes, including managed assignments, retries and continuations. Fast sets
the CLI service tier and feature flag without changing model or reasoning effort;
it can consume more credits and depends on provider/model availability. Other
adapters retain their provider configuration. History records the requested tier,
not confirmation that the provider delivered it. Global CLI configuration is not
modified. See [Codex speed](https://learn.chatgpt.com/docs/agent-configuration/speed).

Workers receive recorded workspace/setup facts and their saved verification command.
HTTP adapters receive the corresponding bridge route. These facts help avoid
repeated setup and tool discovery; repository-required checks and permissions remain
in force. Repository maps include nearby guidance and package manifests. Clean
worktrees at the same repository/commit share cached scans; dirty or non-Git
checkouts scan afresh. Maps remain bounded, advisory context to verify before editing.

Execution timing in task details and usage exports separates waiting for setup/check
capacity from running those commands. Reuse counters remain unknown in older records.
Setup reuse fingerprints nested manifests, lockfiles, setup scripts, toolchain files
and relevant environment settings; missing recorded dependency directories invalidate
reuse. This does not replace a project's own dependency and build cache configuration.

Quality trials accept `--codex-speed=standard|fast` or a variant override such as
`--after-codex-speed=fast`. Omission inherits the provider configuration. Resume
requires identical requested speed settings; offline routing keeps requested tiers
in separate cohorts. Compare matched models, effort, accounts, cases and repetitions.

`pnpm evaluate:speed comparison.json [reviews.json] [report.json]` summarizes a
retained quality comparison without launching agents. Optional reviews map exact
receipt paths to `{"accepted":true,"reviewMinutes":2,"correctionMinutes":0}`.
Use independent review and explicit zero for no time. Correction minutes cover
additional elapsed correction work outside the recorded trial; do not count the
same time twice. Delivery time includes the recorded trial, review and correction
time, retaining unsuccessful trials in the total per accepted result. Missing
reviews, durations and crash interruptions prevent a complete acceptance claim.
Matching cases alone does not establish unchanged quality or a speed improvement.

## Jev decision comparisons

### Local optimization controls

The following native process settings are experimental and default off. Quality
trials expose matching variant flags such as `--after-batch-read=on`; retained plans
and resume validation include these settings. Test each change independently before
combining it. Native agents retain their own tools, permissions and account binding.

The new `read_tools`, `read_context`, `plan_delegation` and deferred coordination
discovery tools use native MCP with Codex, Claude Code, OpenCode and Kimi. The HTTP
bridge adapters retain their existing endpoints. Source queries return at most
twelve ranked files and 16 KB of candidate metadata; source ranges remain bounded
and independently expandable. These controls are process experiments, not a saved
user setting or proof of a faster workflow.

| Setting | Behavior |
| --- | --- |
| `JACKALOPE_BATCH_READ=on` | Exposes bounded read-only batches across selected connections, with recoverable local row filtering, projection and counts. |
| `JACKALOPE_EXECUTION_PROFILE=lean` | Shortens ordinary-task native instructions and defers optional coordination schemas. Managed assignments retain full ownership instructions. |
| `JACKALOPE_VERIFICATION_FLOW=final` | Ordinary tasks with automatic checks rely on the existing final snapshot-bound check instead of a mandatory in-agent check call. Explicit repository/user checks still apply; failed checks remain visible and managed repairs retain their existing limits. |
| `JACKALOPE_CONTEXT_READ=on` | Exposes bounded source ranges and ranked symbol locations. Previously read block hashes can omit unchanged text; callers must retain that text in context. Explicitly requested blocks are not reranked away. |
| `JACKALOPE_ANALYSIS_CACHE=on` | Reuses bounded syntax-analysis outputs by source bytes, path and language. Dirty files are reread and changed content invalidates analysis; directory traversal and reference resolution still run. |
| `JACKALOPE_DISPATCH_PLAN=on` | Exposes a local admission aid for two or three workers, disjoint write scopes, bounded context and explicit overhead/token estimates. It does not launch agents, authorize delegation or enforce provider spending. |
| `JACKALOPE_JEV_ASSISTANCE=shadow` | Records configured relevance/review assessments without changing selected context or suppressing monitors. Source candidate ranking is shadow-only. Existing Jev settings and credentials are required. |
| `JACKALOPE_FAILURE_TRIAGE=local` | Uses recorded quota and check-interruption facts before requesting a Jev failure classification. It grants no retry authority. |

`node scripts/evaluation/assistance.mjs receipts.json labels.json report.json`
compares retained decision receipts with independent labels containing `recordId`,
`questionId` and boolean `relevant`. Missing decisions retain evidence; false
negatives and incomplete cost reporting remain explicit. Shadow proposals are never
reported as actual avoided agent launches or downstream savings.

The ignored native tests `local_optimization_trial` and `local_analysis_cache_trial`
emit JSON observations for transport concurrency, exact selection, repeated source
reads and syntax caching without model calls. Their fixtures exclude agent reasoning
and cannot establish end-to-end savings. `optimization-cases.mjs` supplies separate
authored repairs and a multi-service investigation for matched installed-agent pilots.
Multiple `toolFixtures` give both native controls and Jackalope the same independent
service data. Keep these screening cases separate from held-out confirmation.

For the bounded discovery experiment, generate a suite with
`node scripts/evaluation/discovery-cases.mjs <suite.json>`. Set
`JACKALOPE_JEV_SPEC` to its absolute path and `JACKALOPE_JEV_TEST_KEY` in the
trial process environment, then run the native test executable with
`--ignored --exact commands::decisions::discovery::trial::installed_discovery_trial --nocapture`.
This makes billable requests and writes `<suite>.results.json` next to the input.
Keep credentials out of command arguments, source and receipts. Each authored
case repeats three times with an application-cold request; results include failed
requests, model IDs, typed answers, local search time, Jev wall time and reported
usage. Expected tool IDs are withheld from the API payload. The oracle checks
recall at five or an empty result when the capability is absent. This measures
discovery only, not downstream agent savings or real-project quality.

The website's `/benchmarks/` page consumes sanitized measurements in
`apps/website/public/research/benchmarks.json`. Generate comparison reports with
`evaluate:context`, retain individual trial measurements and provenance, and
review public copy against the report's claim blockers. Preserve unfavorable
comparisons and label authored fixtures, inherited caches, missing billing data
and unmeasured human acceptance. Run `pnpm evaluate:website` after updating the
public dataset to generate the smaller page summary; verification checks it for
drift. Raw receipts belong in ignored scratch output.

`pnpm evaluate:jev <trials.json> [report.json]` summarizes independently reviewed
trials without calling a provider or installing a routing policy. Supply an array
with `id`, `caseId`, `configuration`, `category`, `variant` (`local`, `agent`, `jev`),
`split` (`train`, `holdout`) and boolean `accepted`. Jev rows additionally require
`model`, `rubricRevision` and `inputHash` from their retained decision receipts.
Record `totalTokens`, `totalCostUsd`, `elapsedMs`, `correctionMinutes` and optional
`fallback`; unknown measurements use null. Include every attempt, assistance call,
failure and correction in the totals. Avoid mixing configurations or providers
under one configuration identifier.

Duplicate receipts and overlap between training and held-out cases are rejected.
The report retains failures in cost-per-accepted-result numerators and makes
incomplete measurement coverage explicit. Compare matching case sets and repeat
counts across variants; a minimum sample flag does not establish superiority.
Use separate labels to calibrate suitability, relevance and coverage probabilities;
Jev distribution concentration is not a task-success probability. Include missed
requirements, false monitor suppression and unnecessary escalations in independent
review. Broader real-repository and installed-provider acceptance remains required.

## Daily-use pilot

Use a consenting cohort of ten developers spanning first-time and experienced agent
users, on their own representative repositories, for at least one normal work week.
Record the installed build, platform, provider/account configuration and existing
workflow before beginning. Keep private task content and detailed observations outside
tracked source. Recruitment, contact and sharing require the participant's consent.

Observe project setup through the first independently judged useful change, a correction
after failed checks, return to unfinished work, and explicit local integration. Include
an interrupted attempt and recovery using disposable data. Record completion, detours,
scope/account mistakes, lost drafts, duplicate execution and unrecovered failures.
Compare review/correction time and useful finished work with the participant's usual
workflow on comparable tasks; preserve failures and missing usage, not only successes.

Ask participants to rate results and optionally record review minutes. The local Usage
report supplies a limited aggregate they can choose to copy; it omits archived/unloaded
history and does not measure app visits or elapsed setup time. Collect observed first-
useful timing and voluntary repeat-use days separately. Distinguish testing attendance
from choosing to use the app again. Report medians, ranges, cohort denominators and
missing observations alongside user-reported outcomes. Decide acceptance criteria before
the trial and have someone other than the implementing agent review the outcomes.

Installed reliability, usefulness and retention remain separate acceptance decisions.
Browser fixtures, provider exits, local ratings or a small pilot alone cannot establish
production reliability, broad quality gains or platform release acceptance.
