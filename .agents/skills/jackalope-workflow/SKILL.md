---
name: jackalope-workflow
description: Develop and verify Jackalope's desktop, website, account service and shared packages. Use for repository changes to select subsystem contracts, native checks and public documentation boundaries.
---

# Jackalope workflow

Read [AGENTS.md](../../../AGENTS.md), current [status](../../../docs/STATUS.md)
and [backlog](../../../docs/TODO.md). Use [CONTRIBUTING.md](../../../CONTRIBUTING.md)
for checks, [ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) for ownership and
[UI-GUIDELINES.md](../../../docs/UI-GUIDELINES.md) before changing a screen.

For dispatch, schedules, coordination, capacity or Git integration, read
[PARALLEL-WORKFLOWS.md](../../../docs/PARALLEL-WORKFLOWS.md). Native ownership and saved
receipts establish execution; UI transitions and successful exits do not prove
integration. Keep coordinator → execution guard → runtime lock order.

For native inspection, use [SELF-DEVELOPMENT.md](../../../docs/SELF-DEVELOPMENT.md)
with an isolated profile. Theme and character changes belong in packages/brand;
regenerate artwork after geometry changes and inspect the development lab.
Preserve preview/save, keyboard controls and the five mascot moods.

For provider or prompt changes, read [AGENT-SUPPORT.md](../../../docs/AGENT-SUPPORT.md),
[AGENT-ACCOUNTS.md](../../../docs/AGENT-ACCOUNTS.md) and the relevant
[evaluation contracts](../../../docs/AGENT-QUALITY.md). Preserve account/session
binding, unknown usage and explicit permissions; do not use model discovery as
execution evidence.

For persistence/recovery, use [HISTORY-RECOVERY.md](../../../docs/HISTORY-RECOVERY.md)
and [PERFORMANCE.md](../../../docs/PERFORMANCE.md). For platform changes, use
[CROSS-PLATFORM-RELEASES.md](../../../docs/CROSS-PLATFORM-RELEASES.md), including
native keyring, process and device checks.

For account services, start with [the server README](../../../apps/server/README.md)
and [settings-sync contracts](../../../docs/SETTINGS-SYNC.md). Keep migration and
renderer/native/server schemas aligned; authorization remains native/server-owned.
For public guides/media, use [KNOWLEDGE-MEDIA.md](../../../docs/KNOWLEDGE-MEDIA.md)
and regenerate the shared knowledge catalog after changing its content source.

Run targeted checks, then pnpm verify. Render UI changes at 1280×840 and 960×640,
checking keyboard/focus, themes, reduced motion and preview rollback; website changes
also need narrow touch layouts. Report actual checks and limitations in the task/PR.
Follow [DOCUMENTATION.md](../../../docs/DOCUMENTATION.md): update guides only for
lasting behavior, never append experiment reports, design proposals, dated results
or work summaries. Leave detailed receipts in ignored scratch/output or approved
private storage. Leave changes uncommitted.
