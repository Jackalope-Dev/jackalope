# Agent quality and usage evaluation

Jackalope supplements installed agent harnesses. Success means a correct, reviewable
result with fewer retries and reasonable total usage. Prompt size alone is not a
quality score, and passing synthetic tasks does not establish superiority over a
provider's own GUI.

## Prompt and output contracts

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
- `computer_verify` omits recognized passing-test lines only from long successful
  responses, preserving diagnostics and stderr. Failed output remains intact within
  the existing capture limit. `verification_output` (HTTP `/v1/computer/output`)
  retrieves the latest saved check by ID in Unicode character ranges. Stored results
  and the review UI retain captured output. Neither operation permits a new command.
- Codex receives permission to invoke verification only when the task has a saved
  check. The native guard still rejects missing commands and additional arguments.
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

