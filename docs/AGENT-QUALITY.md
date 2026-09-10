# Agent quality and usage evaluation

Jackalope supplements installed agent harnesses. Success means a correct, reviewable
result with fewer retries and reasonable total usage. Prompt size alone is not a
quality score, and passing synthetic tasks does not establish superiority over a
provider's own GUI.

## Implemented changes

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
baseline binary **before** changing product behavior. The frozen frontend baseline
comes from `f0b95b3857a9dc862f062d8451654310fd46167b`; the native baseline is that
revision with only the ignored trial and test-only prompt capture added. Build with
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

## Integration decisions and next experiments

The [September 10 comparison receipts](examples/agent-quality-2026-09-10.json)
contain two repetitions of each case using Codex 0.153.4 and `gpt-6-astra`.

| Measurement | Before | Updated prompts and output |
| --- | ---: | ---: |
| Behavioral oracles passed | 2 / 6 | 6 / 6 |
| Reported tokens across completed trials, including failures | 726,572 | 951,476 |
| Tokens per passing behavioral result | 363,286 | 158,579 |
| Launch prompt bytes, by case | 8,441–8,619 | 2,986–4,189 |

The updated runs consumed 31% more raw tokens while producing more correct results;
tokens per passing result were 56% lower. This is **not** evidence of a general 56%
quota saving. Two baseline tasks stopped over an unrelated Git ignore-file access
warning; both baseline scheduler attempts left the implementation broken. The
updated scheduler implementations passed the independent oracle, but their requested
in-agent check was denied by Codex's tool approval wiring. The saved-check permission
repair is a subsequent change and requires its own live tool-acceptance evidence.

One baseline scheduler attempt was interrupted by the host application crash before
usage was reported. Its private journal is retained separately; the table includes
all 12 completed trial receipts, and total experiment consumption remains unknown.
These cases target known defects and are too small for a broad ranking, task-success
guarantee or comparison with another GUI. Human acceptance is unmeasured. Concurrent
local builds also make the recorded wall times unsuitable for a speed claim.

RTK v0.48.0 was tried privately using its checksum-verified Windows release. Its
Apache-2.0 license fits this repository's licensing policy with notices preserved.
Automatic `pipe` detection did not compress the supplied Rust/Node fixtures;
explicit `cargo-test` compressed the successful Rust fixture substantially but
removed its warning. That does not establish a safe universal output filter.
The current integration uses a small conservative native filter, adds no runtime
dependency, and does not install shell hooks. Broader command-specific filters need
real log corpora and diagnostic-retention tests first.

Promptfoo (MIT), GEPA (MIT), RouteLLM (Apache-2.0), and Inspect AI (MIT) remain
evaluation candidates. They are not bundled. Prompt optimization and learned
routing need a representative training set, held-out tasks and total-cost scoring;
the three regression cases are too small and specifically target known defects.
Existing tree-sitter analysis and on-demand MCP discovery should be extended before
adding a duplicate analysis framework.

Next, compare against direct installed CLIs under equivalent permissions, then
collect independent review outcomes on representative repositories and repeat
across supported providers. Evaluate model effort controls per adapter/model before
mapping Quick/Balanced/Thorough to provider flags. Those settings currently specify
the task approach; no new reasoning-level or learned-routing claim is made.

Research basis: [OpenAI prompting guidance](https://developers.openai.com/api/docs/guides/latest-model),
[prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching),
[Anthropic agent evaluations](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents),
[Google's agent-system scaling research](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/),
and [RTK source and release](https://github.com/rtk-ai/rtk/tree/v0.48.0).
