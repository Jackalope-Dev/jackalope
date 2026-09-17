# Current capabilities and limits

Jackalope is prerelease software. This page describes source behavior, not a record
of completed trials or deployed environments. See [contributor priorities](TODO.md)
and [release requirements](RELEASE.md) for outstanding acceptance work.

## Desktop workspace

- Projects, saved task drafts, queues, recurring schedules and local change monitors.
- Project setup includes agents, decisions, Git behavior, appearance and an optional
  first task. Background command detection fills unset preferences without running
  commands or replacing explicit choices; inspection failure does not block setup.
- Tasks opens Chat first. Inbox keeps the project-scoped work list that includes chats,
  with remembered filters, compact capture and keyboard row navigation. Work rows show
  each agent's character, live or next-action status and who is working now. Task and
  project command search covers both.
  Active task, plan and chat views show recent tool activity, workspace file labels and
  native check output from existing events, without extra model calls.
  Project opens an overview with unfinished work, setup and recorded local deliveries.
- Chat's start page groups review and blocked work under Needs you, alongside active work across projects. Task
  and session sections remember where the user was reading. Project readiness distinguishes
  unavailable inspection from a clean checkout.
- Result views prioritize unanswered questions, recovery and failed checks. Isolated
  work keeps review, merge into the target branch and workspace cleanup on the Review
  tab. Task, managed-task and chat reviews share a searchable changed-file browser,
  checks and evidence; a blocked merge does not hide the workspace diff. Worker links
  reopen the parent task. Review separates full-width changes, checks and merge/delivery,
  with optional tools in a toolbar above the diff. File review markers persist locally
  for the displayed patch and reset when it changes. Approve work records outcome
  acceptance before a separate merge action. Agent review opens an editable request
  through the task composer and runs only after submission. Planned tasks use one
  navigation row for overview, review,
  preview, activity and details, with the agent beside the task heading.
  Preview explains setup requirements
  and attaches captured evidence to the single follow-up composer.
  The work list prioritizes existing tasks, with new capture opened explicitly.
  Running tasks offer saved
  queued follow-ups or explicit stop-and-send; queues pause after failures and restart.
  Failed checks can send their
  output into the follow-up draft. Local previews remember project commands, choose a free
  port, check HTTP readiness and embed a sandboxed loopback page. Fresh isolated browser
  captures attach screenshots, page elements and errors to follow-up drafts; they do not
  reproduce embedded-page sign-in or unsaved interactions.
- Delivery inspects local Git state and optionally reads PR/CI through the GitHub CLI.
  PR, CI and deployment preparation carry evidence into editable drafts. Publishing and
  deployment remain explicit user-approved steps; a local merge does not establish either.
- Live sessions capture short messages while work runs, batch them in order in one
  isolated workspace, and retain drafts, results and cumulative patch exports. Chat
  starts a session from the first message and groups history automatically.
  Sessions can pop out into a compact window with an always-on-top pin. Dispatch pauses after
  failures or restart; installed-provider and native-window acceptance remain open.
- Paused sessions can review, check and explicitly merge their latest batch through
  the existing guarded integration path. Queued messages must run or be canceled first.
  Applied receipts close execution in the old session, including after restart; a new
  chat can carry the delivery handoff forward. Review positions compare subsequent file
  snapshots without accepting changes. Source/target drift still requires a fresh merge review.
- Chat offers editable issue, PR-review, CI-repair and dependency-update starters.
  GitHub evidence uses the installed authenticated CLI and remains read-only; excerpts
  are labeled. Optional batch and estimated-cost limits pause subsequent batches, with
  unknown cost blocking further dispatch when a cost threshold is set. These are not billing caps.
- Codex, Claude Code, Grok Build, OpenCode, Kimi Code, Antigravity and Gemini CLI adapters with
  [provider-specific capabilities](AGENT-SUPPORT.md).
- Agent accounts, model choices, reported usage, capacity-aware routing and bounded
  quota handoff. Explicit assignments and continuation identities remain pinned.
  Capacity discovery shares bounded concurrent refreshes. Equivalent explicit
  agent/model choices select an account without an extra model call.
  Jackalope Decisions offers local rules, agent-powered or optional Jev-assisted
  routing, with project overrides and protected device keys. Jev fallback defaults to
  local rules, with an optional agent attempt; both providers retain usage reports.
  Jev selection uses shared repository context, sourced model evidence, individual
  suitability gates and optional cost-aware objectives. Opt-in context selection,
  failure triage, requirement coverage, review priorities, monitor filtering and
  Automatic assignment matching retain typed receipts and separate usage.
  Live provider calibration and native cross-platform acceptance remain open.
- Isolated Git worktrees, task checkpoints, verification, snapshot-bound outcome
  acceptance, combined patch review and guarded integration with recoverable cleanup.
- Durable ownership handoffs, explicit interface agreements and changed-file scope
  checks gate dependent work and integration. Projects can opt into agent reconciliation
  and verified local merging; source worktrees remain available. See
  [coordination contracts](ORCHESTRATION-CAPABILITIES.md).
- Repository-aware plans, optional verified predecessor snapshots, dependency-aware
  scheduling, structured coordination reports and workspace verification reservations.
- New tasks can assess focused work, investigation or a reviewed plan through the
  project's Decisions preference. Local fast paths and reused assessments avoid model
  calls. Plans retain one parent, scoped assignments, attempts and usage; multiple
  assignments receive progressive integration checks and a final combined result.
  New plans retain conflict resolution and bounded verification repairs within the task.
  Plan, Work, Check and Review lead to one result, preview, combined diff and outcome
  review before explicit application. Focused review and elapsed integration time remain
  distinct local measurements. Installed-provider and cost/quality acceptance remain open.
- Requests continuing with one lead can delegate through available provider subagent
  tools. Unsupported or denied delegation stays sequential. See
  [agent quality](AGENT-QUALITY.md) for boundaries.
- Individual and bulk task archiving with undo and restore, preserving results and workspaces.
  Durable incremental task saves, bounded concurrent history loading, recovery
  exports and [archive management](HISTORY-RECOVERY.md).
- Project guidance, editable lessons and codebase maps. Context
  previews and saved receipts explain lesson selection with revision/source evidence;
  Chat supports per-request lesson opt-outs.
- MCP connections, task-owned Chromium sessions and scoped desktop-window grants.
- Codex/Claude effort requests, focused isolated-task coordination, verification
  timeout alignment, usage attribution
  and direct-CLI quality comparisons with separate routing evaluation gates. See
  [agent quality](AGENT-QUALITY.md); automatic escalation and learned routing
  remain dependent on broader independent acceptance.
- Ask Jackalope documentation answers and reviewed local actions, backed by bounded
  model-free documentation retrieval. Optional [OpenCode/Ollama setup](LOCAL-AI.md)
  checks file edits and session continuation before connecting a local account.
  Optional installed title models receive a separate check and context limit;
  managed local helpers can reuse authenticated servers with bounded idle lifetimes.
- A single Usage & quota page with account limits, app-wide usage trends,
  project/agent/task breakdowns, measured routing overhead
  and usage by saved outcome, with missing reports and helper usage kept explicit.
  Usage separates context a provider read as new from cached re-reads, and reports
  model calls and average context, because cumulative tokens track turn count rather
  than work done. Per-message usage is recorded for Claude, Grok and OpenCode.
- Task launches carry a bounded repository map from static analysis, seeded by the
  paths recent attempts in the project touched, so a worker starts from the relevant
  files instead of searching for them. Token effect is not yet measured on real work;
  `pnpm evaluate:execution --repo-map=on,off` is the comparison.
  Symbol definitions, related tests and explicit file locations sharpen retrieval;
  per-repository locks allow independent scans. Detailed launch timings and latency
  summaries retain failures and missing measurements in quality comparisons.
- Shared appearance, guided onboarding, task notifications and optional settings sync.
  Project setup includes project, agents, decisions, behavior, appearance and an optional
  first task. Theme editors open directly; existing saved app/project choices remain compatible.
- Review views save optional local usefulness ratings and reported review minutes with
  each task. These self-reported values do not establish product retention or quality gains.

## Services and distribution

The website download page lists Windows, macOS and Linux availability, prioritizes
the visitor's likely desktop platform and explains waitlist approval and friend
passes. Acceptance emails lead through explicit email confirmation on that page.
Unconfigured platforms remain Coming soon; page visits never start a download.

Verified waitlist members can connect the desktop to see their queue position,
referral progress and share link, with website and tour links before approval.
Connections persist across restarts and detect approval; offline progress remains
labeled and cannot authorize execution. Installed and deployed acceptance remain open.

New execution requires approved account access in every desktop build. Previously
verified accounts retain bounded offline access; saved work remains reviewable after
expiry. Feedback, reporting and settings sync have separate controls. See
[account access](DESKTOP-ACCOUNT.md) and [service boundaries](BACKEND.md).

The website provides setup and workflow guides, compatibility tables, sample-workspace
media and account flows. Its content is shared with bundled native help through
`packages/knowledge`. Build and release tooling uses Windows Store MSIX and macOS/Linux Cloud candidates.
Store builds offer in-app update checks and user-initiated installation through
Microsoft Store; Store-managed background delivery remains independent. Branch-based
beta/stable publication is separate from master development and checks complete artifact sets, source checks, signing and
installed-acceptance configuration; live signing and installed upgrades remain
release acceptance work. See [release automation](RELEASE-AUTOMATION.md).

The private admin console groups access management, audience preferences, product-note
drafts, service setup, aggregate usage and feedback, with overview links for onboarding
and email follow-ups. Configuration and connection counts do not establish delivery,
installation or completed tasks.
Optional anonymous reporting separates view visits from native operation outcomes,
observed task states by agent/workflow and fixed diagnostic categories. Release,
channel and OS filters support aggregate triage; it does not establish unique-user
retention, complete task funnels or native crash coverage. See [monitoring](BETA-MONITORING.md).

Windows uses DPAPI; macOS uses Keychain; Linux uses Secret Service. Unix discovery,
process guardians, browser ownership, notifications and tray/Dock behavior have
platform-specific implementations. Native CI and device checks are described in
[platform contracts](CROSS-PLATFORM-RELEASES.md#platform-contracts).

## Known limits

Aider and Goose account setup does not include native task execution. Gemini CLI
tasks run through its headless stream; installed-profile execution is not yet validated.
Antigravity named accounts use Gemini API keys; isolated subscription accounts are
unsupported. Discovery and fixture responses do not establish real account execution.

Desktop control supports Windows and has macOS/X11 and GNOME 46 Wayland backends
for native validation. GNOME requires the bundled window-control extension and
explicit per-task window grants; other Wayland compositors remain unavailable.
XWayland alone is insufficient. Worktrees separate Git changes; agent processes and
configured tools still run with local OS privileges.

Installed provider, accessibility, recovery, performance, signed installation and
update acceptance remain platform-specific requirements. Real-model quality and
lesson/routing improvements require matched trials and independent review. Automated
checks do not establish service delivery or installed-app acceptance.

Remote execution, enforced monetary budgets and team collaboration remain future work. Use
the [documentation index](README.md), [contribution guide](../CONTRIBUTING.md) and
[licensing guide](LICENSING.md) for development and redistribution.
