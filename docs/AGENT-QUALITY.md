# Agent quality and usage evaluation

Jackalope supplements installed agent harnesses. Success means a correct, reviewable
result with fewer retries and reasonable total usage. Prompt size alone is not a
quality score, and passing synthetic tasks does not establish superiority over a
provider's own GUI.

## Prompt and output contracts

- Every worker launch and continuation asks the lead to assess delegation after
  inspecting repository context. Small or tightly coupled work stays sequential;
  useful independent work can use the provider's available, permitted subagent
  tools without a separate split decision from the user. Explicit user/repository
  restrictions still apply. The lead assigns bounded ownership, reviews worker
  results, waits for workers and verifies the combined changes. Missing or denied
  subagent tools fall back to sequential work; no extra CLI, account or queue task
  is launched to emulate them. These are agent instructions, not native enforcement
  of a worker count or evidence that a provider actually delegated. Provider
  lifecycle, usage coverage and quality still require installed trials.
- Automatic guidelines distinguish design tokens from authentication tokens, skip
  negated requests and fenced examples, and avoid a debugging workflow for spelling
  fixes. Explicitly selected guidelines and project defaults remain available.
- Generated instructions identify the worktree Jackalope already assigned. Saved
  version-one ideas reconstruct their original generated text before migration;
  edited instructions remain verbatim.
- Native MCP adapters use their tool descriptions. Grok and Antigravity receive a
  short authenticated `GET /v1/help` bootstrap instead of the entire HTTP manual
  on every launch. Coordination ownership, untrusted messages, pending user input
  and permission boundaries remain explicit.
- Routing receives the task, outcome contract and selected knowledge without the
  worker's bridge protocol manual. Different agents/models still use the existing
  validated router; unknown defaults are not assumed equivalent.
- Workers batch independent reads/searches where supported, reuse established
  context and keep progress concise. Repository-required checks remain mandatory;
  changes, failures and unresolved concerns justify additional verification.
- Repository maps rank file paths and bounded Tree-sitter declarations, include
  related test names and task-referenced file locations, and remain limited to
  6 KB. Cached lines are advisory and must be verified before edits. Scans share
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

Before/after order alternates across repetitions. Keep the account, explicit model,
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
