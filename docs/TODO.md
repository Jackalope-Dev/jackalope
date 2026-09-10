# Contributor priorities

Open work for contributors. Check [current capabilities](STATUS.md) and
[agent support](AGENT-SUPPORT.md) before starting a change; discuss larger features
in an issue first. The [roadmap](ROADMAP.md) describes direction without promising
release dates.

## Reliability and accessibility

- [ ] Validate installed onboarding, project changes, saved drafts, inferred
  defaults and explicit overrides, including cancellation and restart.
- [ ] Check keyboard and screen-reader access, narrow layouts, title-bar controls,
  themes, reduced motion and appearance preview rollback. Include the refreshed
  agent characters in installed-app checks; browser fixtures cover both themes
  at 1280×840 and 960×640.
- [ ] Validate helper actions, notifications and external links in installed builds,
  including Ask context defaults, saved opt-outs and its settings navigation.
- [ ] Exercise checkpoints, commit attribution, edited merge messages and cleanup
  recovery with staged changes, locked folders and active tasks.
- [ ] Verify rich results and diffs in installed WebViews. Preserve the Streamdown
  cache regression when upgrading dependencies.
- [ ] Measure native startup, memory, large histories, diffs and responsiveness.

## Agents and task execution

- [ ] Compare repeated single, serial and staged evaluations with matched provider/model
  budgets and independent human review. Validate feature snapshot recovery, shared
  verification reservations, structured reports and bounded inbox waits in installed builds.

- [ ] Validate Kimi Code OAuth account switching and real task execution in the installed app,
  including session approvals, structured questions, direct MCP, usage deltas, quota refresh,
  routing, helper requests and exact-session resume. Protocol tests and isolated local-provider
  probes do not establish authenticated execution acceptance.
- [ ] Complete real account login/switch/resume coverage, including expiry,
  cancellation, saved model defaults and continuation with the bound account.
- [ ] Verify routing, quota handoff, decomposition, outcome/workflow gates and
  coordination with installed agents.
- [ ] Validate hourly schedules, timezones, missed runs and restart recovery.
- [ ] Complete packaged desktop-control checks, including multiple monitors,
  interruption, indicator failure and permission renewal.
- [ ] Implement Gemini CLI, Aider and Goose execution protocols.
- [ ] Validate OpenCode direct MCP, Grok model discovery and Antigravity quota refresh with
  installed profiles; retain explicit CLI/version boundaries from the capability audit.
- [ ] Extend Grok/Antigravity permission protocols and scoped MCP delivery without
  weakening process ownership, usage accounting or saved-session compatibility.
- [ ] Add isolated Antigravity subscription accounts only when its CLI supports
  a verified credential-store override.
- [ ] Extend reconnect/failover with explicit process ownership and recovery.

## Context, usage and integrations

- [ ] Verify automatic lessons across tasks, queues, schedules and restart,
  including evidence, edits, removal and frozen task context. Measure outcomes.
- [ ] Extend codebase semantic coverage, project knowledge and scheduled continuation.
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
- [ ] Verify signup, referrals, passes, feedback and consent through actual
  delivery and installed clients, including retries, suppression and optional
  email enrollment remaining off until selected.
- [ ] Complete reporting, retention/deletion and installed-channel acceptance.
- [ ] Keep builds and automated fixtures reproducible without private credentials;
  document approved account setup for native execution.

## Website

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
  discovery, process/PTY/browser behavior and trial packaging. WSL native tests,
  real Chrome cleanup and isolated GNOME Keyring trials pass; desktop acceptance
  remains open.
- [ ] Implement guarded macOS desktop control and Linux X11/Wayland backends;
  preserve window grants, visible state, physical-input pause and revocation.
- [ ] Validate macOS/Linux notification clicks, permission denial, tray-host loss
  and macOS Dock reopening in installed builds.
- [ ] Prioritize Ubuntu/GNOME Wayland acceptance, retaining X11 coverage. Resolve
  the desktop-control permission and physical-interruption contract for Wayland
  before exposing native input there.
- [ ] Validate signed installation, older-to-newer updates, real execution and
  saved-data recovery on each intended platform before enabling its download.
- [ ] Check approved, pending, revoked and offline-expired accounts in development
  and release builds while preserving access to saved work.
- [ ] Verify downloaded artifacts, publication recovery and the selected channel;
  follow [release acceptance](RELEASE.md) and [platform requirements](CROSS-PLATFORM-RELEASES.md).

Remote identity, pairing, dispatch, reconnect, companion access and collaboration
remain exploratory directions in [BACKEND.md](BACKEND.md) and the roadmap.
