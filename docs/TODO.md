# Contributor priorities

Open work for contributors. Check [current capabilities](STATUS.md) and
[agent support](AGENT-SUPPORT.md) before starting a change; discuss larger features
in an issue first. The [roadmap](ROADMAP.md) describes direction without promising
release dates.

## Reliability and accessibility

- [ ] Validate live sessions with installed providers: rapid capture, concurrent window
  drafts, pin/dock/close, paused dispatch, preview, cumulative patch review and restart.
  Extend sessions to independent task planning and guarded integration after validating
  the shared-workspace batch flow.
- [ ] Validate installed onboarding, project changes, saved drafts, inferred
  defaults and explicit overrides, including cancellation and restart.
- [ ] Check keyboard and screen-reader access, narrow layouts, title-bar controls,
  themes, reduced motion and appearance preview rollback. Include agent characters in installed-app checks.
- [ ] Validate helper actions, notifications and external links in installed builds,
  including Ask context defaults, saved opt-outs and its settings navigation.
- [ ] Exercise checkpoints, commit attribution, edited merge messages and cleanup
  recovery with staged changes, locked folders and active tasks.
- [ ] Verify rich results and diffs in installed WebViews. Preserve the Streamdown
  cache regression when upgrading dependencies.
- [ ] Complete installed startup, CPU/memory and responsiveness measurements using
  the [performance fixtures](PERFORMANCE.md), including sustained streams, repeated
  task switching and large wrapped patches on each supported native platform.

## Agents and task execution

- [ ] Run the implemented direct-CLI and effort [quality trials](AGENT-QUALITY.md)
  on representative repository-derived suites across providers with independent
  review. Preserve failures and missing usage. Meet separate training/held-out
  gates before enabling automatic effort escalation or learned routing. Validate
  effort overrides and long verification cancellation in installed applications.
- [ ] Validate [local setup](LOCAL-AI.md) with real models in the packaged app:
  hardware/memory requirements, current installers, download cancellation/resume,
  account selection and continued tasks. Check macOS/Linux and enterprise configuration.
- [ ] Measure documentation round trips, provider tokens and routing quality on matched
  tasks after context/prompt changes. Keep all eligible models and quality-first selection.

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
- [ ] Verify routing, quota handoff, repository planning, outcome/workflow gates and
  coordination with installed agents. Exercise ownership handoffs, rejected interfaces,
  scope review, automatic reconciliation/merge opt-ins and restart recovery in the installed app; measure duplicate work and
  conflict frequency before claiming an improvement.
- [ ] Validate hourly schedules, timezones, missed runs and restart recovery.
- [ ] Complete packaged desktop-control checks, including multiple monitors,
  interruption, indicator failure and permission renewal.
- [ ] Implement Gemini CLI, Aider and Goose execution protocols.
- [ ] Validate OpenCode direct MCP, Grok model discovery and Antigravity quota refresh with
  installed profiles; retain explicit CLI/version boundaries from the capability boundaries.
- [ ] Extend Grok/Antigravity permission protocols and scoped MCP delivery without
  weakening process ownership, usage accounting or saved-session compatibility.
- [ ] Add isolated Antigravity subscription accounts only when its CLI supports
  a verified credential-store override.
- [ ] Extend reconnect/failover with explicit process ownership and recovery.

## Context, usage and integrations

- [ ] Verify automatic lessons across tasks, queues, schedules and restart,
  including evidence, edits, removal and frozen task context. Measure outcomes.
- [ ] Extend codebase semantic coverage, project knowledge and scheduled continuation.
- [ ] Add dated, project-attributed helper accounting and verify usage/outcome
  drilldowns against installed history, including archived and unavailable records.
- [ ] Improve provider reporting, model inventory, capacity and monetary budgets.
  Keep reported, estimated, stale and unavailable data distinct.
- [ ] Evaluate protocol and credential-store migrations against real providers
  while preserving existing adapters and encrypted saved data.
- [ ] Add guarded GitHub issue, pull-request and CI integration.

## Account access and optional services

- [ ] Validate required account access in development and release builds, including
  reconnect, revocation, offline expiry and saved-work recovery.

- [ ] Validate multi-device settings sync, account changes, offline/conflict
  recovery, deletion and saved opt-outs.
  Include profile metadata after migration `0015_desktop_metadata.sql`, same-name
  test profiles, and restart restoration; projects and task history remain local.
- [ ] Verify signup, referrals, passes, feedback and consent through actual
  delivery and installed clients, including retries, suppression and optional
  email enrollment remaining off until selected.
- [ ] Complete reporting, retention/deletion and installed-channel acceptance.
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

Remote identity, pairing, dispatch, reconnect, companion access and collaboration
remain exploratory directions in [BACKEND.md](BACKEND.md) and the roadmap.
