# Contributor priorities

Open work for contributors. Check [current capabilities](STATUS.md) and
[agent support](AGENT-SUPPORT.md) before starting a change; discuss larger features
in an issue first. The [roadmap](ROADMAP.md) describes direction without promising
release dates.

## Reliability and accessibility

- [ ] Finish the Android and iOS companion (apps/mobile): push notifications when work needs
  you (host registration of device tokens, a server relay holding the FCM and APNs
  credentials, generic notification text), signed device builds and CI builds for both
  platforms, and on-device checks of the keyboard over the reply bar, camera scanning and
  Tailscale HTTPS pairing before any store listing.
- [ ] Decide how a desktop coordinates work across several hosts: a combined view of every
  paired host's work, and whether new work can be routed to an available host, while each
  host keeps execution ownership.
- [ ] Decide whether browser tools should reach cloud machines through an authenticated
  DevTools proxy.
- [ ] Add AT-SPI accessibility actions and stable refs to the in-sandbox agent.

## Agents and task execution

- [ ] Extend agents on a computer: the browser tools on cloud and Agent37 computers,
  on-demand stdio connections and `computer_verify` and `read_context` against the
  remote copy for writing agents, and automatic routing that does not require the CLI
  here.
- [ ] Accept agents on a computer end to end: real Claude Code and Codex runs on a local
  sandbox and on a live Agent37 account (template build under gVisor, auto sleep and
  wake, spend), bridge tools, on-demand connections, `execute_tool` approvals and project
  secrets through the relay, desktop control and the browser tools on
  the agent's computer, read-only planners and swarm orchestrators there, stop, quota
  handoff, lost contact, reattach and restart recovery.
- [ ] Publish the first computer image from `beta`, make its package public, and accept
  a local pull, a cloud machine started from it and an Agent37 registry import.
- [ ] Give Agent37 computers a viewer through signed port URLs, sizes beyond the default
  shape and idle-time changes after creation.

- [ ] Enforce Keep and combine worktree retention in native cleanup and integration (it is
  enforced only in Project worktrees today).
- [ ] Tighten the merge gate: run the saved check on the combined integration tree in a
  temporary worktree before apply; launch a fresh plan review after the reviewer fixes
  gaps itself instead of continuing the same attempt; with a saved check, require a
  recorded passing plan review (with a relaunch path so plans are not stranded) bound
  to the tree it saw; optionally let a docs-only or identical-patch change keep an
  earlier verdict.
- [ ] Measure automatic subtasks on representative requests: planning overhead versus
  single-lead time, how often plans return one assignment, validation failures, and
  combined-result quality. Tune the local-rules size threshold from those results.
- [ ] Calibrate Jev decision thresholds on held-out tasks and compare end-to-end cost,
  latency and outcomes with local rules and agent routing, including bounded tool
  discovery overhead and downstream retrieval failures. Include optional context
  reranking, failure/coverage advice, review priorities, monitor false negatives and
  assignment matching; compare complete costs including assistance calls and corrections.
- [ ] Run the implemented direct-CLI and effort [quality trials](AGENT-QUALITY.md)
  on representative repository-derived suites across providers with independent
  review. Preserve failures and missing usage. Meet separate training/held-out
  gates before enabling automatic effort escalation or learned routing.
  Use the Harbor adapter for pinned external repository tasks, validate upstream
  graders and compare matched native/Jackalope runs before expanding to other harnesses.
  Evaluate scope guidance, native output filtering and provider effort separately and
  combined; retain only supported benefits and use untouched tasks for confirmation.
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
- [ ] Screen isolated warm API helpers for latency, memory and cancellation; reconcile
  request-level provider accounting with mixed agent-helper and routing costs before
  confirmation. Freeze independent family sampling and statistical power assumptions;
  use the study planner to reject infeasible confirmation sizes.
- [ ] Extend Grok/Antigravity permission protocols and scoped MCP delivery without
  weakening process ownership, usage accounting or saved-session compatibility, so
  their requests pass the same auto-approval risk check.
- [ ] Run matched Claude Code session and hook trials on the continuation suite against
  the defaults (persistent session, hooks, fallback) and the off variants before
  changing isolation or shared prompt caching.

## Context, usage and integrations

- [ ] Use Learning activity to calibrate background learning's cadence, probation,
  archive, miss and curator thresholds against real use, and measure whether learned
  lessons reduce repeated corrections before claiming it.
- [ ] Extend codebase semantic coverage, project knowledge and scheduled continuation.
- [ ] Improve provider reporting, model inventory, capacity and monetary budgets.
  Keep reported, estimated, stale and unavailable data distinct.
- [ ] Evaluate protocol and credential-store migrations against real providers
  while preserving existing adapters and encrypted saved data.
- [ ] Add broader GitHub remote publication, review-thread resolution and proactive
  proposals, preserving explicit authorization for remote writes.
- [ ] Tune swarm assignment and subtask limits from installed swarm trials: how often
  agents use peers, peer_adopt and propose_subtask, duplicate implementations avoided,
  conflicts caught before completion, and whether planner briefings reduce worker discovery.
- [ ] Accept multi-round swarms with installed providers: orchestrator verdict accuracy
  (false done, missed criteria), rounds and cost to completion, round sizes on agents on a
  computer, recovery after a restart mid-review, how often people edit proposed rounds,
  and whether parallel area orchestrators catch more than one. Consider showing
  proposals in the phone companion.
- [ ] Accept agent decisions with installed agents on Windows and macOS: a swarm build
  where a decider from another model family answers routine questions, approves checked
  rounds and accepts in-scope deviations, with escalation rates by category, answers people
  overrode, decider time and cost, restart while deciding, and `request_human_action`
  steps for a sign-in and a secret.
- [ ] Accept automatic delivery end to end in the installed app: a swarm goal on a new
  Artifacts project merges under a committed policy, pushes the branch to Artifacts and
  deploys to a Workers preview, including a failing check that rolls back and pauses merging.
- [ ] Accept one-click Swarm setup against a live Cloudflare account: Connect Cloudflare with
  the Workers scope (and its invalid-scope fallback), an API token with Workers Scripts: Edit, an
  account without a workers.dev subdomain, a first publish, and an in-place update that keeps
  the token working on a second computer.
- [ ] Accept Cloud resources against a live Cloudflare account on Windows and macOS: each
  resource created and then reused on retry, Connect Cloudflare's product scopes (and the
  invalid-scope fallback to an API token), a token missing one permission, an account without
  R2 turned on, a Hyperdrive origin and Turnstile domains, and deleting an empty and a
  non-empty bucket.
- [ ] Explore agent-native Artifacts workflows: a fork per task attempt instead of a local
  worktree, provenance notes on integrated commits, push-event review and check triggers,
  and opening an existing Artifacts repository as a project. Keep the coordinator,
  reservation and integration guarantees; a fork does not replace review or merge approval.

## Platform releases

- [ ] Add a CI fixture that drives a real XDG portal desktop-control session.

Managed hosting and collaboration remain exploratory
directions in [BACKEND.md](BACKEND.md) and the roadmap.
