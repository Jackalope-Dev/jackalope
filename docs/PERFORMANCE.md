# Desktop performance

Use these measurements to compare local implementation changes. They are not
installed-app startup, memory, battery-use or agent-quality claims.

## Local measurements

On Windows, the initial debug-build fixture used 1,000 saved tasks with 100 KB
results and four simultaneous streams producing 100 updates each. The baseline
was master at `fc23acf`, before the performance pass. Both versions used durable
writes; the new path does not acknowledge output before flushing it to disk.

| Operation | Before | After first pass |
| --- | ---: | ---: |
| Copy task history / construct list summaries, average of 30 reads | 44.81 ms | 2.95 ms |
| Save 400 output updates across four streams | 3,082 ms | 1,372 ms |
| Reload 1,000 saved tasks | 589 ms | 179 ms |
| Desktop frontend assets, uncompressed | 14.06 MB | 12.99 MB |

These are single local runs, with filesystem caching and other processes present.
The original read measurement only cloned records; the replacement also constructs
summaries and sorts them. Total assets include lazy chunks, not just startup code.
Recheck numbers against the current checkout before treating them as a release baseline.

A later rerun during other compilation and native-test work measured 5.56 ms for
summaries, 3,308 ms for the 400 output saves and 394 ms for reload. This was not a
paired comparison under equal machine load. Save throughput varies substantially;
the first-pass result does not establish a consistent gain under CPU or disk contention.

Run the native fixture with:

```powershell
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features performance_baseline -- --ignored --nocapture
```

The fixture uses a disposable directory and no provider calls. It measures current
summary reads, durable output saves and history reload. The ordinary native tests
cover journal recovery, failed-save retry, admission barriers and detail selection.

For rendered browser checks, use the existing desktop development server and set
`JACKALOPE_PREVIEW_URL`, or build and serve the isolated production fixture:

```powershell
node scripts/verification/performance.mjs --production
```

The production fixture applies the desktop CSP, retains all 1,000 searchable task
rows, activates the final row by keyboard, checks list/board views, middle edits in
highlighted code, safe links, light/dark appearance, reduced motion and 1280×840 /
960×640 layouts. It also checks split/wrapped 10,000-line patches and original-patch
access. Receipts and screenshots go under `output/playwright/`. Browser long-task
measurements include fixture actions and remain diagnostic; wrapped large patches
can still incur substantial DOM/layout work.

## Runtime contracts

- A single ordered writer owns task persistence. Output changes append sequenced
  field updates to a journal and flush before acknowledgment. Checkpoints atomically
  replace the full legacy-compatible JSON snapshot; journals compact after 1 MB.
  Sequence numbers prevent replaying already checkpointed updates after a crash.
- Output readers release the runtime lock while waiting for disk writes. Admission
  barriers wait for queued writes and reject unsaved history. Questions, lifecycle
  transitions and integration still use synchronous durable checkpoints.
- Recovery retains complete journal entries before a damaged tail and preserves
  the original damaged file. It never silently replays a task. Legacy snapshots,
  archive retention, recovery exports and failed-save warnings remain supported.
- History reads use at most four readers. Full native records remain available to
  execution and recovery; a separate lazy history index has not been introduced.
- The renderer requests revised records and keeps unchanged object identities.
  Native notifications are coalesced, with periodic/focus reconciliation and the
  previous polling cadence if event subscription fails.
- Ask context changes synchronize promptly. An idle heartbeat preserves the native
  15-second freshness boundary; working or connected helpers retain fast polling.
- Lists retain every row, including keyboard and browser-search access. Offscreen
  layout is deferred and date formatters are reused.
- Highlighting retains all bundled languages and the existing GitHub light/dark
  code colors. Workers have view-owned lifetimes and bounded renderer caches.
  The JavaScript regex engine works under the existing CSP without eval or WASM
  permissions. Original patches remain accessible if rendering fails.

## Remaining acceptance

Measure cold/warm installed startup, idle and active process-tree CPU/RSS, memory
after repeated task switching, IPC bytes, and p50/p95 input latency under sustained
parallel execution. Repeat on supported native platforms. The Codex disposable
lifecycle trial covers editing, usage, continuation, account binding, cancellation
and restart; it does not replace installed-window or cross-platform acceptance.
