# Agent quality and usage evaluation

Jackalope supplements installed agent harnesses. Success means a correct, reviewable
result with fewer retries and reasonable total usage. Prompt size alone is not a
quality score, and passing synthetic tasks does not establish superiority over a
provider's own GUI.

Run `node scripts/verification/verify-opencode-denials.mjs <absolute-native-test-binary>`
with the supported OpenCode executable on `PATH` to exercise permission continuation
against the real CLI and a local scripted provider. It checks independent work after
denial, repeated requests, access through another native tool and saved permission
rules. Disposable profiles and repositories keep the protocol fixture separate from
user settings. The fixture records no real inference or task performance measurements;
live outcome comparisons still need the paired evaluation protocol below.

Quality receipts include native decision records for every attempt. Aggregation
adds nonduplicated helper usage to agent usage, excludes routing records already
accounted elsewhere and preserves unknown reports. Agent and helper token totals
stay separate for pricing: Jev tokens must not be priced at the worker model's rate.
Older receipts without helper accounting are marked incomplete. Cached assessments
charge only their original evaluation. Native request elapsed time is recorded
separately from complete task duration; do not add overlapping timings together.

`--after-jev-questions=on` enables agent questions only in that disposable benchmark
profile. It requires `JACKALOPE_JEV_TEST_KEY` in the parent process environment;
the worker does not inherit this variable. The test key uses protected native
storage and is removed on ordinary trial cleanup. Never put a key in suite JSON,
commands saved to source, or published receipts. The ignored native
`installed_agent_questions_trial` accepts `JACKALOPE_JEV_QUESTIONS_SPEC` for bounded
tool-only measurements; these omit worker execution and cannot establish task savings.

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
- Ordinary tasks use final-phase guidance and a concise preamble; managed
  assignments retain full ownership instructions. Native continuations receive
  current workflow, task, contract and workspace instructions.
- Automatic guidelines distinguish design tokens from authentication tokens, skip
  negated requests and fenced examples, and avoid a debugging workflow for spelling
  fixes. Explicitly selected guidelines and project defaults remain available.
- Generated instructions identify the worktree Jackalope already assigned. Saved
  generated drafts are recognized against the current guidelines; edited instructions
  remain verbatim.
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
- Shared launch context recommends serial ad hoc checks when the native host's
  available-parallelism estimate is one. Unknown or larger estimates add no
  guidance. Saved commands and explicit user/repository instructions take
  precedence; containers and remote execution need their own resource checks.
  This advisory uses Rust's [portable parallelism estimate](https://doc.rust-lang.org/std/thread/fn.available_parallelism.html),
  which can miss quotas or affinity restrictions. It does not change tool arguments,
  environment variables, test selection or verification results.
- Repository maps rank file paths and bounded Tree-sitter declarations, include
  related test names and task-referenced file locations, and remain limited to
  6 KB.
  Cached lines are advisory and must be verified before edits. Scans share
  a lock per repository/commit, allowing unrelated repositories to scan independently.
  Account capacity reads share in-flight refreshes and use at most four concurrent
  reads, preserving candidate order and final policy/quota reservation checks.
- `computer_verify` omits recognized passing-test lines only from long successful
  responses, preserving diagnostics and stderr. It recognizes complete pytest and
  Node TAP summaries before omitting supported progress or passing-test records.
  Parsed pytest, Cargo and Node TAP counts describe reported output, not independent
  correctness. Failed, timed-out and truncated captures remain intact within the
  capture limit, including output reporting failed tests despite a zero process exit.
  Unknown formats retain their original output. `--after-verification-output=legacy`
  reproduces the earlier passing-line filter for evaluation.
  `verification_output` (HTTP `/v1/computer/output`)
  accepts `{}` to recover the latest saved result and check ID after a lost or
  timed-out response. Further output pages require that ID to prevent mixing checks.
  Stored results and the review UI retain captured output. Neither operation permits
  a new command. Agent verification reuses a passing result only when the saved
  command and Git workspace snapshot still match; changed, failed or unbound checks
  execute again. Reading output alone does not verify subsequent edits.
  The ignored native `replay_captured_verification` test accepts a JSON array of saved
  `Verification` records through `JACKALOPE_VERIFICATION_REPLAY`, writes sibling
  `.projected.json` responses and checks exact paginated stdout recovery without
  executing their commands. Keep captures private. These replays measure tool-output
  delivery, not model tokens, task speed or quality.
- OpenCode task launches attach a local output hook, including API-key connections
  using that runner. It only projects complete, successful, untruncated pytest or
  Node TAP shell output between 2 KB and 50 KB. Diagnostics, skips and summary counts
  remain visible; the exact original is saved before replacement, with a recovery
  path in the tool response. Commands, arguments, permissions and metadata are unchanged.
  The authenticated local projection endpoint has a one-second deadline; missing
  metadata, unsupported output and storage or endpoint failures retain the original.
  Captures share a 20 MB limit per process, including concurrent pending writes.
  Other agents retain their native shell output and share the `computer_verify` path.
  OpenCode can install configuration dependencies before loading an external plugin.
  Compare fresh profiles and repeat use separately, retain setup time, and do not
  equate fewer output bytes with lower total cost, faster tasks or unchanged quality.
- Codex receives permission to invoke verification only when the task has a saved
  check. `computer_verify {}` runs that attempt's saved command; `project.verification`
  exposes the command and automatic-check setting. Launch guidance names the saved
  check and its native tool so agents can verify without requesting shell approval.
  Explicit command/args remain compatible only when they exactly match the saved
  command. The native guard rejects attempts without a saved check and any additions.
- Permission denials stop the denied action. Independent authorized work may
  continue, with unresolved blockers reported.

## Repeatable comparison

The ignored native test
`commands::coordination::automatic_tests::claude::installed_claude_connects_without_inference`
uses the installed Claude CLI control protocol to check the real bridge's tool catalog
without sending a model prompt. It retains diagnostics in a disposable temporary
profile and does not establish model quality or installed desktop acceptance.

Direct Claude fixtures allow the exact saved check through Bash and, on Windows,
PowerShell, together with the selected fixture reads in one allowlist. Existing
client denials still apply; no wildcard shell permission is granted.
Both comparison arms enforce token limits against the greater of reported aggregate
usage and deduplicated per-message usage, which can arrive before a CLI's final total.
These are overlapping observations, not additive costs. Delayed reporting can still
overshoot a limit, and partial observations do not establish complete billed usage.

OpenCode output totals include separately reported reasoning tokens; CLI cost
estimates are retained separately from independently priced API-equivalent costs.

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


## External container benchmarks

`scripts/evaluation/harbor_agent.py` adapts Harbor 0.23.0 to the existing ignored
native quality runner. Both arms receive the same upstream instruction and prepared
repository. `direct` invokes the native CLI; `jackalope` assembles the production
task guidance and uses the normal coordinator/runtime in the current directory.
The container supplies isolation. This measures focused execution, not UI assessment,
managed plans, worktree integration or installed desktop acceptance.

Use a separate Python environment (`uv pip install harbor==0.23.0`) and Docker or
another Harbor sandbox. The payload builder currently supports Linux x86_64 and a
self-contained OpenCode executable. Other adapter names retain their native quality
contracts but need matching payloads and separate acceptance. The desktop does not
ship Harbor or require Python for normal execution.

Before building the native test executable, freeze its working source:

```sh
python3 scripts/evaluation/harbor-package.py freeze /private/eval/source.json
export JACKALOPE_EVALUATION_SOURCE_SHA256="$(sha256sum /private/eval/source.json | cut -d ' ' -f1)"
cargo test --locked --lib --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run
python3 scripts/evaluation/harbor-package.py --source-manifest /private/eval/source.json \
  --binary /absolute/native-test-executable --node /absolute/node \
  --opencode /absolute/opencode --output /private/eval/package
```

The package records source, binary and payload hashes and checks the source fingerprint
compiled into the test binary. It rejects a missing or mismatched fingerprint,
changed native, product-prompt or packaged runtime source, or an existing output directory.
Select the executable from the current Cargo build output; shared target directories
can retain older executables with different names. Use `--source` with a preserved Git snapshot
when the working checkout has moved on; do not pair an old binary with new product
prompts. Set `PYTHONPATH` to `scripts/evaluation`
and configure Harbor's agent `import_path` as `harbor_agent:JackalopeAgent`, with an
explicit `model_name` and `kwargs`: `payload`, `payload_sha256`, `variant`
(`direct` or `jackalope`), `agent`, `seconds`, `tokens`, and optional
`provider_meter: deepseek`. Agent runtime budgets support 30–1,800 seconds and
1,000–10,000,000 delayed reported tokens. Give Harbor additional setup/shutdown
time. These are screening limits, not hard billing caps or official benchmark budgets.

The adapter requires the task's working directory to be its prepared Git root,
creates the same evaluation branch in both arms, and leaves repository contents
unchanged during setup. Task-provided MCP servers and skills are currently rejected
instead of silently omitted. Upstream verifiers run separately after agent execution;
no gold patch, oracle or generated fixture enters the agent request. A matching
`JACKALOPE_EXTERNAL_WORKSPACE` explicitly authorizes the test-only in-place mode.
Only the agent executable is added to the worker's `PATH`. The evaluation launcher
uses its private Node by absolute path so repository commands retain the prepared
image's runtime and native-module compatibility.

Repository scoring requires an enforced agent-phase network allowlist. Permit only
the required inference API endpoints; prepare dependencies during setup. Package
mirrors can expose newer releases containing a solution, so they must also be blocked
during execution. The adapter rejects hosts outside its supported inference APIs
and checks that source hosts and common package mirrors are unreachable before
inference; configure the upstream environment's network policy to enforce this,
not only agent tool permissions. Validate that direct connections cannot bypass a
proxy. A host whose container runtime cannot enforce the policy must use a supported
isolated network implementation or fail setup. Setup and verification policies can
differ from the agent phase. Preserve these overrides with the run's provenance.
Audit traces for answer retrieval; a published-patch fetch invalidates the attempt.
Source probes keep a four-second network deadline inside a thirty-second container
command budget. A transport timeout aborts setup; it never proves that a source
host is blocked. Retain the failure separately from scored model attempts.
With the pinned Harbor environment active, run `python -m unittest discover -s
scripts/evaluation -p harbor_agent_test.py` to check source-access rejection and
request/usage preservation.

OpenCode search and plugin SDK dependencies are initialized during setup in the
same isolated profile used for inference, including for the direct control. The
preflight discovers tools without invoking a model. Record setup time separately;
never open package registries during scored execution to repair missing dependencies.

DeepSeek credentials come from the parent process environment, never job arguments
or saved configuration. Metering gives the worker a temporary proxy token and retains
all provider request usage without request/response content. Optional `jev_questions`
requires a privately supplied test key and functioning protected credential storage;
ordinary runs require no Jev key. Retain native receipts, provider accounting and
Harbor results, including setup failures and timeouts. Keep unknown costs unknown.
Provider receipts are persisted before optional OpenCode session export, so an
incomplete transcript does not discard independent usage. Keep transcript failures
visible when assessing how confidently a result can be explained.

Pin dataset revisions, images, clients, payload and task selection before execution.
Validate unmodified failures and reference-solution passes before scoring a task.
Counterbalance arm order and keep setup, execution and verifier time separate.
Report shorter-budget subsets as pilots; they are not official leaderboard scores.
Keep development and held-out tasks disjoint, including overlapping upstream task
families. Standard graders establish benchmark outcomes, not human acceptance or
the number of review corrections avoided.

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

`apps/desktop/src-tauri/src/commands/experiments.json` is the versioned registry of experiment defaults,
allowed values, environment names and dependencies. The evaluation driver records
its digest, and native continuation fingerprints include all registered native
settings. Invalid combinations are rejected by the driver. Optimization defaults
remain conservative; an implementation is not evidence of a benefit.

Run `pnpm evaluate:plan --families=20 --pass-rate=1` before budgeting confirmation.
The current quality gate subtracts the baseline upper Wilson bound from the
candidate lower Wilson bound using independent source-family outcomes and z=1.96.
Its 2-point tolerance requires at least 189 independent families even when both
arms pass every task. The 50-task/20-family eligibility floor cannot by itself
satisfy that gate. This feasibility calculation is not a power analysis: freeze
sampling, family definitions, quality tolerance, method and power assumptions
before collecting new held-out results. Repeated runs of a family do not increase
its independent sample count.

For adaptive screening, pass `--stop-file=<path>` and create that file to stop
before the next matched case repetition. The current repetition finishes so both
variants remain comparable. The runner checkpoints its plan before dispatch and
records the active trial; resuming an interrupted run retains unknown interruption
usage. Preserve the original plan and all unfavorable or partial results. Early
stopping and configuration selection are exploratory; confirm a promising change
on a separately frozen held-out suite before making a savings claim.

The quality runner accepts per-variant `--after-task-approach=scoped`,
`--after-tool-surface=available` and `--after-repo-map=off` switches; replace
`after` with `control` as needed. `--after-result-queries=on` enables queries over
captured MCP responses; `--after-result-preview=on` additionally bounds large
unselected responses while keeping the complete source recoverable. Preview
requires result queries. `--after-initial-tools=small` measures eager delivery of
a complete bounded catalog. Keep these controls explicit in saved comparisons.
Authored multi-source join cases can be generated with
`node scripts/evaluation/pipeline-cases.mjs <suite.json>`. The name identifies the
fixture family, not an available agent tool. Both sizes are screening fixtures.
Scoped task-approach guidance limits call-site investigation to code changes while
preserving applicable instructions and checks; it is the default for Balanced tasks.
Use frozen prompt baselines or source snapshots for historical comparisons.
Changing model or experiment configuration invalidates resume.
New comparisons record runner/fixture Node versions and the OS and reject resume
when a recorded environment changes. Older comparisons keep this metadata unknown.
`--order-seed=<id>`
randomizes the initial paired order per task and rotates subsequent repetitions.
`--control-model` and `--after-model` permit explicit model comparisons; changing
models is a different experiment from a same-model harness comparison.

Available-tool discovery omits MCP operations without selected on-demand connections
and verification without a saved command. Browser, questions, evidence and coordination
remain available. Selected connections execute through discovered handles, retaining
connection allowlists, attempt ownership, cancellation and result recovery.

`--after-tool-surface=deferred` defers browser,
desktop and coordination schemas for ordinary OpenCode tasks. The discovery tool
adds requested groups to the attempt's catalog and emits MCP list-changed notifications.
Calls still use their original named tools and permissions; no generic execution
wrapper is introduced. Other adapters and managed assignments retain their existing
catalogs. This experiment needs a client that refreshes tools during execution.
Run `node scripts/verification/verify-deferred-tools.mjs <absolute-native-test-executable>`
with pinned OpenCode on PATH to check discovery with a fake loopback provider. Repeat
with `--deny-browser` to check that discovery does not override client permissions.

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
not a provider confirmation. OpenCode's server transport requests only enabled
variants advertised by the selected provider/model. Quick/Balanced/Thorough select
low/medium/high when supported; DeepSeek Balanced uses high because its medium
setting maps to high. Unknown variants retain the provider default. Other adapters
retain their configured model effort. Independent provider receipts record outbound
reasoning and thinking fields when available; a variant name alone is not confirmation.
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
- `direct`: installed Codex/Claude/OpenCode/Antigravity CLI, raw task instructions, same explicit model
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

Ordinary tasks use concise instructions and final automatic saved checks; syntax
analysis caching and explicit result selection are core behavior. Managed assignments
retain full ownership guidance. Explicit repository/user check requirements still
apply, and successful saved checks are reused only for an unchanged snapshot.

The registry covers remaining evaluation controls such as available tool schemas,
captured-result queries and conditional source reads. Quality trials pin those values in
retained plans and resume validation. Unknown or retired controls fail explicitly;
reproduce historical runs with their frozen source and executable. Native agents
retain their own tools, permissions and account binding.

The `read_context` tool uses native MCP with
Codex, Claude Code, OpenCode and Kimi. Dynamic discovery is OpenCode-only. The HTTP
bridge adapters retain their existing endpoints. Source queries return at most
twelve ranked files and 16 KB of candidate metadata; source ranges remain bounded
and independently expandable. These controls are process experiments, not a saved
user setting or proof of a faster workflow.

| Setting | Behavior |
| --- | --- |
| `JACKALOPE_OPENCODE_TRANSPORT=cli` | Reproduces the earlier headless JSON transport for evaluation. Ordinary OpenCode tasks use an authenticated task-owned server and explicit permission replies. External unattended comparisons reject requests in both arms; user-mediated recovery is a separate outcome. |
| `JACKALOPE_SCOPE_GUARD=off` | Removes the shared guidance to distinguish required outcomes from suggestions, preserve regression contracts, inspect bounded source first and select relevant plus mandatory checks. The guidance is normally included across adapters. |
| `JACKALOPE_PROVIDER_EFFORT=off` or `low` | Preserves OpenCode provider defaults or requests its advertised low variant independently of task-approach text. Neither is automatic quality-based effort selection. Compare against normal effort with the same model and prompt. |
| `JACKALOPE_NATIVE_TOOLS=off` | Disables the default recoverable OpenCode test-output filter for matched comparisons. `output` enables that default. Native file reads retain their original arguments and permissions. |
| `JACKALOPE_RESULT_QUERIES=on` | Exposes exact queries over captured tool results, complete JSON row pages, bounded path hints and explicit selection guidance. Records row selection, fallback, truncation and expansion counters. |
| `JACKALOPE_RESULT_PREVIEW=on` | With result queries enabled, captures large unselected text/JSON responses locally and returns explicit previews with recoverable originals. Errors and non-text responses remain intact. |
| `JACKALOPE_INITIAL_TOOLS=small` | Attempts discovery for up to three seconds before launch. Supplies a complete catalog only when it has at most four tools and 6 KB of metadata; other catalogs retain on-demand discovery. Initialization time and broker searches remain in the measurements. |
| `JACKALOPE_CONTEXT_READ=on` | Exposes bounded source ranges and ranked symbol locations. Previously read block hashes can omit unchanged text; callers must retain that text in context. Explicitly requested blocks are not reranked away. |
| `JACKALOPE_JEV_ASSISTANCE=shadow` | Records configured relevance/review assessments without changing selected context or suppressing monitors. Source candidate ranking is shadow-only. Existing Jev settings and credentials are required. |

`node scripts/evaluation/assistance.mjs receipts.json labels.json report.json`
compares retained decision receipts with independent labels containing `recordId`,
`questionId` and boolean `relevant`. Missing decisions retain evidence; false
negatives and incomplete cost reporting remain explicit. Shadow proposals are never
reported as actual avoided agent launches or downstream savings.

The ignored native test `local_analysis_cache_trial` compares content-keyed syntax
reuse with fresh parsing, including content hashing and identical-output assertions.
It excludes filesystem traversal, reads and model work, and cannot establish
end-to-end savings. `optimization-cases.mjs` supplies separate
authored repairs and a multi-service investigation for matched installed-agent pilots.
Multiple `toolFixtures` give both native controls and Jackalope the same independent
service data. Keep these screening cases separate from held-out confirmation.

`node scripts/evaluation/retrieval-cases.mjs suite.json pilot` generates screening
cases; `held-out` generates twelve separate cases across four structured retrieval
families. Both arms receive the same seeded opaque IDs, values and service payloads;
independent exact-output oracles remain outside the agent workspace. These authored
fixtures measure structured tool retrieval, not general coding or production task
quality. Freeze configuration before confirmation, retain every attempted run and
report provider, model, source sizes, order, failures and cached usage separately.
Custom suites with `allowedFiles` also receive an independent file-scope check:
protected fixture files must remain exact, and extra files, directories or symbolic
links fail the trial even when the behavioral oracle passes.
Recorded provider quota failures stop the runner immediately, retaining the failed
attempt and any incomplete pair. Resume only after provider capacity is available;
do not count an incomplete comparison as a savings result.
For capability screening, `--stop-on-failure` also stops immediately after any
failed trial and records the unfinished matrix. Keep this option in the frozen plan;
do not mix an early-stopped screen with a completed confirmation study.

Direct controls support Codex, Claude Code, OpenCode and Antigravity (`agy`).
OpenCode step receipts include worker reasoning tokens but do not capture every
auxiliary request, such as native session-title generation. Treat its CLI-reported
cost as a worker estimate, not a billing total. Keep
`nativeAuxiliaryAccountingComplete` false until all provider requests have been
measured; missing fields in older OpenCode comparisons also block total-cost claims.
For an isolated DeepSeek/OpenCode screening run, `--provider-meter=deepseek` starts
an authenticated loopback meter, confines the provider and model, redirects its
endpoint, disables project configuration and uses separate XDG directories per attempt. It reads
`DEEPSEEK_API_KEY` or the existing OpenCode DeepSeek credential; the child receives
only a per-run proxy token. Both arms use the same isolation. Reports retain request
counts, status, usage, cache counts and duration without prompts, responses or keys.
`profileStateBeforeSetup` records whether configuration, a model catalog and a plugin
dependency manifest already existed. File presence is not proof of a working cache.
Fresh and prepared-profile studies need separate protocols; apply the same non-model
setup to every arm and retain its duration alongside task time. Direct receipts include
launch timestamps for comparison with the meter's first request. Do not subtract
provider durations from wall time as though auxiliary requests cannot overlap.
Auxiliary calls and retries are included. Missing usage or any incomplete/failed
request leaves totals unknown. The cost gate uses complete meter totals only for
runs without routing or agent-helper receipts. Separate, reported Jev-only helper
attempts can be added once to complete provider usage, while their monetary costs
remain priced separately. Missing receipts, unknown usage, mixed-provider fallbacks
and helpers accounted elsewhere block that reconciliation. Warm API helper timing
is a separate opt-in experiment, not a task-quality result.
Jackalope supplies a deterministic title for new OpenCode tasks to avoid redundant
title generation; resumed sessions retain their existing titles. Direct controls
retain the native default behavior.
Antigravity shares the production stream parser and inherits its CLI permissions;
permission denials, missing terminal results and absent usage remain failures or
unknown measurements. Antigravity tool fixtures use a temporary workspace-local
MCP config containing only the disposable fixture definitions. Existing configs
are never overwritten; changed generated configs fail and remain for inspection.
This test setup does not enable direct project MCP delivery in the product.
Pin a model returned by `agy models`; record the CLI version and actual
reasoning-effort field rather than assuming a requested effort was applied.

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

## Bounded project-learning evaluations

`scripts/evaluation/learning-cases.mjs` supplies authored screening fixtures, not
real user history or held-out evidence. Learning suites carry `learningHistory`
and a `taskAt` cutoff. Every arm receives the same history in
`PROJECT-HISTORY.json`, named in the identical user prompt. Native test profiles
also import those historical receipts for Jackalope's normal lesson selection.
All attempts, checks and reviews must predate the scored task. Use
`--after-learning=local` to exercise local selection and `--after-learning=jev`
for optional Jev reranking with `JACKALOPE_JEV_TEST_KEY` supplied privately.
The `learning` switch is an evaluation control; production project learning
remains enabled by default. Missing production keys skip optional Jev assistance.

The offline optimizer uses existing native agent adapters, without a Python or
Bedrock dependency. Partition source families into `train`, `validation` and
`holdout` before execution; related tasks cannot cross those boundaries.

1. Run training cases with `evaluate:quality`, retaining every trial. Then run
   `pnpm evaluate:learning prepare <suite.json> <training-comparison.json> <output>`.
   This creates a reflection suite containing only training prompts, measurements
   and bounded diagnostics. It refuses reflection when training has no observed
   behavior or scope failure; infrastructure failures and passing tasks alone do
   not justify extra quality guidance. Run that suite through `evaluate:quality`; retain its
   usage and latency as offline optimization overhead.
2. Read the generated `candidate.json`. Run
   `pnpm evaluate:learning freeze <suite.json> <training-comparison.json> <candidate.json> <output>`.
   Guidance is limited to 1,200 UTF-8 bytes and must cite observed training tasks.
   The resulting validation suite adds it only to the `after` arm, subordinate to
   current user and repository instructions. It does not install a production policy.
3. Run the frozen validation suite with `--variants=control,after`, identical
   explicit model, effort and experiment settings. Use at least four distinct
   validation tasks. Run `pnpm evaluate:learning assess <frozen.json> <suite.json>
   <validation-comparison.json> <output>` to check complete matched coverage,
   first-pass gains, no previously passing task regression, and at most 10% total
   token/time overhead. Only an eligible candidate produces a held-out suite.
   Validation attempts must postdate freezing; existing outputs are never overwritten.

Freeze the final confirmation protocol before examining held-out results. Count
failed candidates and reflection work in development overhead. The impact report's
separate `qualityPublication` gate requires a predeclared `first-pass-acceptance`
primary outcome, one attempt per original task, independent acceptance, at least
50 tasks and 20 source families, replication, complete costs, and a source-family
cluster bootstrap lower bound of five percentage points for the task acceptance gain.
The separate conservative family-success noninferiority check still applies. Total measured
execution time and conservative cost must remain within 10% of the baseline.
Record offline optimization cost/time separately when `includesOptimization` is
true. The existing efficiency gate still requires its own confidence bounds.
First-pass acceptance does not establish the number of corrections avoided;
correction rounds remain unknown until actually observed.

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
