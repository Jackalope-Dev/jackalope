# Contributor priorities

Open work for contributors. Check [current capabilities](STATUS.md) and
[agent support](AGENT-SUPPORT.md) before starting a change; discuss larger features
in an issue first. The [roadmap](ROADMAP.md) describes direction without promising
release dates.

## Reliability and accessibility

- [ ] Accept the Work sidebar and bottom status bar in installed WebViews, including
  task/session switching, remote-host identity, stale quota, keyboard focus, zoom,
  themes and minimum window sizes. Validate saved prompts, commands and shortcut conflicts.
- [ ] Validate native sleep prevention and release on idle/quit, macOS traffic lights,
  menus and unread Dock count, microphone permission denial and local dictation
  cancellation on supported systems. Test WSL pairing against a running Linux host,
  restart/disconnect recovery and Linux account/project boundaries.
- [ ] Exercise copied setup files on different source/target ignore rules, linked
  paths and partial write failures. Accept bounded size inspection on large worktrees.
- [ ] Accept task terminals and detached panes in installed Windows, macOS and Linux
  builds: reconnect, Unicode output, shell exit, stale feedback, simultaneous windows,
  process cleanup, workspace removal and agent/check/preview reservation conflicts.
  Validate editor protocol handlers and per-project layout persistence on those systems.
  Include shell selection, both split panes, output search, HTTP links and opt-in
  stopped-output restoration without command replay.
- [ ] Compare Focus, Build and Oversee on representative first-task, correction and
  return-to-work journeys. Check mode changes with open tasks, chats and plans,
  persisted filters, unsent drafts, questions, Stop controls and empty projects.
  Include topic regrouping, stale revisions, draft promotion,
  large histories and local timing exports; report human effort and outcome quality.

- [ ] Validate line comments, stale-patch anchors, batched feedback, split conversation and
  visual selection in installed WebViews. Include keyboard access, storage failures,
  authenticated preview state, cancellation, view changes and large patches.
- [ ] Accept GitHub, Linear and Jira issue intake with live accounts, pagination, revoked
  credentials, Unicode descriptions and retained source links through follow-ups.
- [ ] Accept trusted-host and responsive companion workflows on real devices: SSH host-key
  failure, HTTPS setup, pairing expiry, device revocation, project removal, questions,
  disconnect/retry without duplicate sends and host restart. Cover protected storage and
  Tailscale Serve coexistence on each platform; validate access boundaries independently.

- [ ] Run agent comparisons with installed providers: partial start failures, mixed
  finish times, stopped attempts, keep-one archiving and restore, and later follow-ups on
  the kept task. Check that each provider reads attached image and file paths, including
  absolute paths outside isolated worktrees, and that native file drops, pastes and the
  file picker work on macOS and Linux. Measure command-search file listing on large
  repositories and editor protocol handling for opened files.
  Check unread markers and open-work tabs across restarts, deleted work, several windows
  and remote hosts, and change counts on large worktrees and while agents write files.
- [ ] Validate the unified work list, project scope, command search, persistent follow-up,
  preview readiness/cancellation/evidence capture and PR/CI reads in installed WebViews.
  Test first-result, visual correction, failed-check recovery, project return and delivery
  with entry developers and power users; measure completion, detours and scope mistakes.
  Include parent-task links, unified Needs you counts, shared file browsing, preview
  setup explanations and evidence attachment, and blocked-result review. Include optional
  file markers, outcome approval, and real agent-review requests from the review toolbar.
- [ ] Accept the `jackalope` command in installed macOS, Windows and Linux packages,
  including a folder that is not a Git repository (direct edits, no patch or merge)
  and `--init` (initial commit, starter ignore, refusal of a home directory or drive root):
  PATH linking and the macOS system link, NSIS PATH hooks, the Store execution alias,
  AppImage relaunch, updates and uninstall. Exercise cold start, second-launch window
  promotion, several terminals, app-to-terminal hand-off on each platform's terminals,
  narrow terminals, Unicode, `NO_COLOR` and reconnect after a host restart. Exercise
  `!` commands and their interruption (process groups, `taskkill`), clipboard copy
  (pbcopy, Wayland/X11, WSL, PowerShell, OSC 52 over SSH), Shift+Enter under the
  keyboard protocol, Ctrl+Z suspend, the bell and window title, and `jackalope -p`
  exit codes on each platform.
- [ ] Validate bulk task archiving, undo, restore and restart recovery in installed
  builds, including unsaved history and interrupted attempts.
- [ ] Validate live sessions with installed providers: rapid capture, concurrent window
  drafts, pin/dock/close, paused dispatch, preview, cumulative and incremental review,
  guarded merge/cleanup, post-merge handoff and restart. Check stale review refusal,
  pending-message guards, unavailable cost and batch-limit pauses. Independent native
  task planning remains separate from the shared-workspace batch flow.
- [ ] Validate installed onboarding, project changes, saved drafts, inferred
  defaults and explicit overrides, including cancellation and restart. Cover all six
  project setup steps, appearance rollback and automatic command detection.
- [ ] Validate ordinary-task follow-up queues with installed providers, including
  stop-and-send, restart pauses, failed saves, cancellation and merge guards.
- [ ] Run the [daily-use pilot](AGENT-QUALITY.md#daily-use-pilot) with consenting users
  and real repositories. Measure first useful result, useful completed work, review/correction
  effort, repeat use and recovery; keep self-reported ratings and loaded-history coverage explicit.
- [ ] Check keyboard and screen-reader access, narrow layouts, title-bar controls,
  themes, reduced motion and appearance preview rollback. Include agent characters in installed-app checks.
  Cover live activity, file labels, queued checks and provider tool failures.
  Include direct Usage & quota navigation, filters, export and the quota-handoff setting.
- [ ] Validate helper actions, notifications and external links in installed builds,
  including Ask context defaults, saved opt-outs and its settings navigation.
- [ ] Validate checkpoints, commit attribution, edited merge messages and cleanup
  recovery with staged changes, locked folders and active tasks in installed builds.
- [ ] Verify rich results and diffs in installed WebViews. Preserve the Streamdown
  cache regression when upgrading dependencies.
- [ ] Complete installed startup, CPU/memory and responsiveness measurements using
  the [performance fixtures](PERFORMANCE.md), including sustained streams, repeated
  task switching and large wrapped patches on each supported native platform.

## Agents and task execution

- [ ] Compare task speed on representative repository work with matched models,
  accounts and effort: Codex service tiers, dirty/clean context, command capacity,
  setup/check reuse and dependency scheduling. Include failures, independent review,
  corrections and defects; validate requested tiers in installed provider versions.

- [ ] Measure automatic subtasks on representative requests: planning overhead versus
  single-lead time, how often plans return one assignment, validation failures, and
  combined-result quality. Tune the local-rules size threshold from those results.
- [ ] Validate task assessment, stale-cache invalidation, reviewed planning, scoped
  dispatch, retained usage, pause/stop/restart recovery and explicit final integration
  with installed providers. Compare complete cost and quality on held-out tasks;
  preserve serial live-session batch and cost limits.
- [ ] Calibrate Jev decision thresholds on held-out tasks and compare end-to-end cost,
  latency and outcomes with local rules and agent routing, including bounded tool
  discovery overhead and downstream retrieval failures. Include optional context
  reranking, failure/coverage advice, review priorities, monitor false negatives and
  assignment matching; compare complete costs including assistance calls and corrections.
  Validate evidence freshness, individual suitability gates, cost objectives and cache
  invalidation with real model identifiers. Validate real API usage,
  quota errors, cancellation, optional agent fallback costs, project inheritance and credential replace/remove on
  Windows, macOS Keychain and Linux Secret Service, including locked services.

- [ ] Run the implemented direct-CLI and effort [quality trials](AGENT-QUALITY.md)
  on representative repository-derived suites across providers with independent
  review. Preserve failures and missing usage. Meet separate training/held-out
  gates before enabling automatic effort escalation or learned routing. Validate
  effort overrides and long verification cancellation in installed applications.
  Use the Harbor adapter for pinned external repository tasks, validate upstream
  graders and compare matched native/Jackalope runs before expanding to other harnesses.
  Extend container payload/provider coverage and independently confirm any pilot signal.
  Confirm OpenCode server permissions, paginated continuation, child usage and process
  cleanup in installed Windows/macOS/Linux apps. Evaluate scope guidance, native
  output filtering and provider effort separately and combined;
  retain only supported benefits and use untouched tasks for confirmation.
  Validate native OpenCode output filtering and recovery with managed and installed
  runners across platforms, multiple plugins, fresh profiles and repeated use.
  Retain dependency setup time, failed/incomplete-output fallbacks and every attempt;
  compare incremental improvements separately from a native-agent advantage.
- [ ] Validate [local setup](LOCAL-AI.md) with real models in the packaged app:
  hardware/memory requirements, current installers, download cancellation/resume,
  account selection and continued tasks. Check macOS/Linux and enterprise configuration.
  Include optional title-model memory pressure and quality, warm-helper cancellation,
  idle cleanup, account/configuration changes and matched cold/warm latency.
- [ ] Measure documentation round trips, provider tokens and routing quality on matched
  tasks after context/prompt changes. Keep all eligible models and quality-first selection.
  Include frozen prompt comparisons, resumed sessions, bounded maps and recoverable
  tool-result selection. Require representative independent acceptance before broad
  website claims; retain failures, cache accounting and correction work.
  Compare locally parsed verification output, including format fallback, failure
  diagnostics, tool adoption and native-agent controls.
  Screen available-tool exposure and task-scoped guidance independently; freeze
  promising settings before new held-out confirmation.
  Include OpenCode deferred-tool discovery and client permission preservation;
  require native client compatibility before extending it to other adapters.
  Compare captured-result queries, repeated source ranges and dirty-file syntax reuse
  on workflows that actually exercise those mechanisms.
  Label shadow Jev false negatives independently before enabling new suppression.
  Compare optional agent Jev questions with agent-only judgments, including direct
  evidence reads, request overhead, all helper costs and uncertain-answer fallbacks.
  Confirm ordinary-task core behavior on small and large tasks across static and
  dynamic tool clients, preserving managed ownership and explicit check requirements.
  Evaluate combinations only with a concrete interaction hypothesis; include native
  output offloading, permission parity and every recovery turn. Freeze promising
  configurations before independent held-out confirmation.
  Require independent original-patch acceptance for quality claims. Counterbalanced
  review-time and correction measurements are separate prerequisites for claiming faster review.
  Exercise validated project lessons with identical chronological history available
  to both arms. Use the bounded training/validation/holdout optimizer before changing
  default guidance; measure reflection overhead and optional Jev reranking separately.
  Confirm first-pass acceptance gains on representative tasks before claiming fewer
  corrections; authored learning fixtures only screen mechanisms.

- [ ] Compare repeated single, serial and staged evaluations with matched provider/model
  budgets and independent human review. Validate feature snapshot recovery, shared
  verification reservations, structured reports and bounded inbox waits in installed builds.

- [ ] Validate Kimi Code OAuth account switching and real task execution in the installed app,
  including session approvals, structured questions, direct MCP, usage deltas, quota refresh,
  routing, helper requests and exact-session resume. Protocol tests and isolated local-provider
  probes do not establish authenticated execution acceptance.
- [ ] Complete real account login/switch/resume coverage, including expiry,
  cancellation, saved model defaults and continuation with the bound account.
- [ ] Verify automatic delegation with real providers: independent versus tightly
  coupled work, explicit restrictions, unavailable tools, stop/resume, combined
  verification and reported usage. Compare outcomes before claiming quality gains.
- [ ] Accept managed integration with real providers: overlapping files, shared contracts,
  intermediate combinations, failed-check repairs, exhausted limits, previews, final
  outcome review, stop/restart and changed source/target recovery. Compare focused human
  review, elapsed delivery time, interventions, total usage and escaped defects against
  manual worktree integration; fixtures do not establish those gains.
- [ ] Verify routing, quota handoff, repository planning, outcome/workflow gates and
  coordination with installed agents. Exercise ownership handoffs, rejected interfaces,
  scope review, automatic reconciliation/merge opt-ins and restart recovery in the installed app; measure duplicate work and
  conflict frequency before claiming an improvement.
- [ ] Validate hourly schedules, timezones, missed runs and restart recovery in installed builds.
- [ ] Complete packaged desktop-control checks, including multiple monitors,
  interruption, indicator failure and permission renewal.
- [ ] Validate Gemini CLI task execution with installed profiles: login and account switching,
  headless flags and stream events for the installed version, exact-session resume, reported
  usage, cancellation, the attempt limit, quota and permission failures. Unit tests do not
  establish real execution.
- [ ] Validate OpenCode direct MCP, Grok model discovery and Antigravity quota refresh with
  installed profiles; retain explicit CLI/version boundaries from the capability boundaries.
  Include DeepSeek key import, protected named-account execution and model selection.
  Validate private runner download, cancellation, integrity repair and pinned-version
  upgrades in installed Windows, macOS and GNU Linux builds on x64 and ARM64.
  Cover active-process maintenance, connection completion retry and per-account models.
- [ ] Screen isolated warm API helpers for latency, memory and cancellation; reconcile
  request-level provider accounting with mixed agent-helper and routing costs before
  confirmation. Freeze independent family sampling and statistical power assumptions;
  use the study planner to reject infeasible confirmation sizes.
- [ ] Extend Grok/Antigravity permission protocols and scoped MCP delivery without
  weakening process ownership, usage accounting or saved-session compatibility.
- [ ] Add isolated Antigravity subscription accounts only when its CLI supports
  a verified credential-store override.
- [ ] Validate reconnect and failover with explicit process ownership and recovery in installed profiles.

## Context, usage and integrations

- [ ] Validate an added ACP CLI, a loopback OpenAI-compatible model server, and a schedule
  webhook in installed profiles: sign-in stays with the CLI, the model list comes from the
  server, the webhook token is not stored in clear text, and an overlapping call is skipped.
- [ ] Validate curated MCP presets with installed agents and intended service accounts,
  including account-specific OAuth, revocation, local browser prerequisites and restart.
  Keep publisher endpoints and pinned local packages current; fixtures do not verify
  third-party authorization or service availability.
- [ ] Accept Connected apps with a live Composio project: key validation and replacement,
  hosted sign-in, pending and failed accounts, disconnect with revocation, removed or
  recreated sessions, apps without managed sign-in and agent tool use through the managed
  connection with each adapter. Confirm catalog paging and logos for large catalogs.
- [ ] Validate the Screen view in installed builds: live frames while agents act, busy
  and stopped browsers, revoke during an in-flight command, desktop grant states and
  polling cost on long tasks, at 960 by 640 and in both themes.
- [ ] Validate bots end to end: persona continuity across batches and restarts, model and
  connection scope on launch, deleted projects and legacy routines, and the provider-rail
  picker's keyboard navigation and unavailable reasons. Exercise wake-ups across sleep,
  timezone changes and restart; repository and real connection polling, including
  Composio tools, missing read-only annotations, slow or failing servers and credential
  changes. Run bot-to-bot hand-offs with installed providers, including replies to
  finished, paused or deleted conversations, the hop and hourly limits, card answers and
  suggestion review. Measure polling cost and whether bot-started work stays useful.

- [ ] Verify automatic lessons across tasks, queues, schedules and restart,
  including evidence, edits, removal and frozen task context. Measure outcomes.
- [ ] Extend codebase semantic coverage, project knowledge and scheduled continuation.
- [ ] Verify Usage & quota drilldowns against installed history, including dated
  project-attributed Ask Jackalope turns, archived helper conversations and
  unreadable helper files.
- [ ] Improve provider reporting, model inventory, capacity and monetary budgets.
  Keep reported, estimated, stale and unavailable data distinct.
- [ ] Evaluate protocol and credential-store migrations against real providers
  while preserving existing adapters and encrypted saved data.
- [ ] Validate read-only GitHub issue, unresolved review-thread and CI imports with
  authenticated installed CLIs, including enterprise hosts, pagination and stale heads.
  Validate editable workflow drafts and preserve explicit authorization for remote writes.
  Broader remote publication, review-thread resolution and proactive proposals remain open.
- [ ] Accept Jackalope Swarm with a deployed Worker: fork creation, snapshot pushes from several
  live attempts, conflict accuracy against Git merges, token renewal, restart re-registration,
  fork deletion after integration and archive, and two machines sharing one repository.
- [ ] Validate Cloudflare Artifacts with a live Workers Paid account in installed profiles:
  connection with and without a data location, new-project creation, moving a repository
  with many branches, push rejection and retry, the 1 GB repository and 32 MB file limits,
  review-snapshot expiry, and credential prompts staying suppressed on rejected tokens.
  Include Connect Cloudflare: consent with one and several accounts, declined consent,
  occupied loopback ports, refresh-token rotation across restarts, revocation on
  disconnect, and the packaged Windows Store, macOS and Linux builds.
- [ ] Run the installed swarm trial and `pnpm evaluate:execution --modes=single,auto` on
  each supported provider: how often agents use peers, peer_adopt and propose_subtask,
  duplicate implementations avoided, conflicts caught before completion, and whether
  planner briefings reduce worker discovery. Tune assignment and subtask limits from
  those results.
- [ ] Explore agent-native Artifacts workflows: a fork per task attempt instead of a local
  worktree, provenance notes on integrated commits, push-event review and check triggers,
  and opening an existing Artifacts repository as a project. Keep the coordinator,
  reservation and integration guarantees; a fork does not replace review or merge approval.

## Account access and optional services

- [ ] Validate waitlist desktop pairing, restart, referral progress, sharing, offline
  recovery and transition to approved access with the deployed service and installed app.

- [ ] Validate required account access in development and release builds, including
  reconnect, revocation, offline expiry and saved-work recovery.

- [ ] Deploy migration `0018_beta_requests.sql` and validate Store beta requests:
  join, withdraw and leave from an installed Store build, admin copy/mark-done, and
  the Beta badge after a flight update reaches a member's Store account.

- [ ] Deploy migration `0017_device_machine.sql` and validate per-machine device
  slots: desktop connections send a hashed machine key, and the ten-device limit
  counts distinct machines, so profiles, resets and reinstalls on one computer
  share a slot. Confirm older clients and services still connect, the website
  device list stays usable when one machine has several connections, and macOS,
  Windows and Linux machine identifiers resolve in installed builds.

- [ ] Validate multi-device settings sync, account changes, offline/conflict
  recovery, deletion and saved opt-outs.
  Include profile metadata after migration `0015_desktop_metadata.sql`, same-name
  test profiles, and restart restoration; projects and task history remain local.
- [ ] Verify signup, referrals, passes, feedback and consent through actual
  delivery and installed clients, including retries, suppression and optional
  email enrollment remaining off until selected.
- [ ] Complete reporting, retention/deletion and installed-channel acceptance.
  Verify known operation counts, retry deduplication, restored history and privacy
  changes across the main window and Chat popouts against the deployed dashboard.
- [ ] Keep builds and automated fixtures reproducible without private credentials;
  document approved account setup for native execution.

## Website

- [ ] Check the illustrated feature cards and field-notes masonry in Safari and
  touch browsers, including reading order, keyboard links and expanded details.
- [ ] Check navigation, forms, clipboard recovery and media in Safari and touch
  browsers, including keyboard focus and reduced motion.
- [ ] Verify captions, playback and failure recovery for the product tour and
  feature-page and knowledgebase clips across supported browsers. Keep sample
  footage aligned with the current interface; see [media guidance](KNOWLEDGE-MEDIA.md).
- [ ] Keep public guides, comparison sources and discovery output accurate.
- [ ] Run route, metadata, header and link checks against deployed builds, including
  the footer's Reddit community link. Recheck live destinations with
  `pnpm check:links:website` after a website build, and review source content
  alongside HTTP status when updating public claims.

## Platform releases

- [ ] Validate Store submission/flight delivery and the Mac/Linux Cloud pipeline with real
  Partner Center/Apple credentials,
  authenticated draft read-back, retry recovery and installed beta updates before
  enabling automatic publication. Include Store cancellation, active-task blocking,
  reopened version and saved-work continuity. Keep signing/setup gates and platform acceptance
  distinct; follow [release automation](RELEASE-AUTOMATION.md).

- [ ] Enable each website download only after its release is available; verify the
  acceptance-email confirmation flow and Store handoff against the deployed site.

- [ ] Run native CI and accept macOS/Linux credential storage, GUI-launched CLI
  discovery, process/PTY/browser behavior and trial packaging. Keep WSL/Xvfb fixtures separate from installed desktop acceptance.
- [ ] Run macOS helper compilation/guard CI and native desktop-control acceptance
  on macOS and real X11 desktops. Check ScreenCaptureKit and older-system capture
  paths, physical interruption, permission readiness and held mouse buttons.
- [ ] Validate macOS/Linux notification clicks, permission denial, tray-host loss
  and macOS Dock reopening in installed builds.
- [ ] Accept the GNOME 46 Wayland extension on Ubuntu 24.04 devices: installation,
  physical interruption, IME engines, scaling, multiple monitors and extension
  lifecycle. Retain X11 coverage; other compositors and GNOME versions need their
  own guarded integration before exposing native input.
- [ ] Validate signed installation, older-to-newer updates, real execution and
  saved-data recovery on each intended platform before enabling its download.
- [ ] Check approved, pending, revoked and offline-expired accounts in development
  and release builds while preserving access to saved work.
- [ ] Verify downloaded artifacts, publication recovery and the selected channel;
  follow [release acceptance](RELEASE.md) and [platform requirements](CROSS-PLATFORM-RELEASES.md).

Managed hosting, native mobile applications and collaboration remain exploratory
directions in [BACKEND.md](BACKEND.md) and the roadmap.
