---
name: jackalope-workflow
description: Develop and verify Jackalope's Tauri/React desktop, website and shared packages. Use for repository changes; directs work to the canonical architecture, design and native runbooks.
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

Run targeted checks, then pnpm verify. Render UI changes at 1280×840 and 960×640,
checking keyboard/focus, themes, reduced motion and preview rollback. Record actual
evidence and remaining limits in the current status/backlog. Leave changes uncommitted.
