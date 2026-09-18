# Desktop performance

This guide describes persistence and rendering contracts and repeatable checks.
Keep benchmark results and machine-specific receipts outside tracked source.

## Repeatable checks

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

Diff timings separate controls, first readable text, syntax highlighting and view
switches. Production checks require a successful worker highlight, bounded rendered
line counts and keyboard access to the final line; a main-thread fallback cannot
silently satisfy worker acceptance. The isolated preview selects an available port.

Run `node scripts/verification/verify-workbench.mjs` for isolated browser checks of
workspace layouts, terminal focus and reconnect, topic selection in large conversations,
detached-window drafts and feedback recovery. It starts its own Vite server and uses
mock native commands; it does not prove installed shell or window behavior.

## Runtime contracts

- Live-session clients send bounded content revisions. Native snapshots return only
  changed sessions and attempts plus the complete current revision inventory. The
  renderer removes missing records and retains unchanged object identities. Legacy
  full snapshots remain supported. Native loading and hashing still inspect history;
  this does not implement a separate on-disk history index.
  Requests carry at most 20,000 known revisions. Larger inventories stay intact;
  records omitted from the request are transferred again rather than dropped.
- Hidden windows coalesce native notifications until visible, retaining their periodic
  fallback. Session lookups use indexes, and only the latest 20 replies format richly
  by default. Earlier text remains searchable and can be formatted explicitly.
- Usage & quota offers opt-in timing capture for the current window. At most 2,000
  samples stay in memory; exports contain metric names and aggregate timings, never
  command arguments or content. Event Timing covers events at least 16 ms, and long-task
  entries at least 50 ms, where supported. Unsupported metrics remain absent. Compare
  matched journeys, hardware, provider settings, costs and review/correction effort;
  timings alone do not establish superior outcomes or human time saved.

- A single ordered writer owns task persistence. Output changes append sequenced
  field updates to a journal and flush before acknowledgment. Checkpoints atomically
  replace the full legacy-compatible JSON snapshot; journals compact after 1 MB.
  Sequence numbers prevent replaying already checkpointed updates after a crash.
- Output readers release the runtime lock while waiting for disk writes. Admission
  barriers wait for queued writes and reject unsaved history. Questions, lifecycle
  transitions and integration still use synchronous durable checkpoints.
- Streaming saves project only adapter output and verification progress fields;
  they do not clone or serialize immutable task context on each event. A failed
  checkpoint forces the next save to retry the complete record. Size limits,
  ordered acknowledgments and full snapshots at checkpoints remain enforced.
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
  Diff workers are bundled as worker entry points, preserving their message handlers
  despite package side-effect metadata. Original-patch switches retain the worker
  pool and parsed-patch cache identity until the diff view closes or content changes.
  The pinned diff-library patch avoids anchoring an empty file and preserves the
  top scroll position during initial rendering, highlighting and keyboard Home.
  The JavaScript regex engine works under the existing CSP without eval or WASM
  permissions. Original patches remain accessible if rendering fails.

## Task command capacity

Task preparation and saved checks share a bounded native command pool. Its default
capacity is one slot per four available logical CPUs, with a minimum of one and a
maximum of four. `JACKALOPE_CHECK_CONCURRENCY=1..8` overrides that capacity for the
Jackalope process; invalid values use the CPU-based default. Tune against real
command CPU/memory use and queue timings, since commands may start their own workers.
Workspace reservations, cancellation and command timeouts remain enforced.
See [task speed measurements](AGENT-QUALITY.md#task-speed-and-delivery-measurements)
for queue, command, reuse and accepted-delivery measurements.

## Remaining acceptance

Measure cold/warm installed startup, idle and active process-tree CPU/RSS, memory
after repeated task switching, IPC bytes, and p50/p95 input latency under sustained
parallel execution. Repeat on supported native platforms. The Codex disposable
lifecycle trial covers editing, usage, continuation, account binding, cancellation
and restart; it does not replace installed-window or cross-platform acceptance.
