---
name: jackalope-workflow
description: >-
  Runbooks, verification commands, and architecture conventions for building, testing, and extending the Jackalope desktop shell (Tauri v2, React 19, Tailwind CSS, Arc/Zen theme engine, Git worktrees). Use whenever developing, refactoring, or verifying features in the Jackalope repository.
---

# Jackalope Development & Verification Runbook

## 1. Quick Reference Commands

| Purpose | Command | Notes |
| :--- | :--- | :--- |
| **Install Dependencies** | `pnpm install` | Uses pnpm workspaces |
| **Web Dev Server** | `pnpm dev` | Starts Vite dev server with browser-mock IPC on `http://localhost:5173` |
| **Typecheck & Build** | `pnpm build` | Executes `tsc -b` and `vite build` across the monorepo |
| **Tauri Desktop Mode** | `pnpm tauri dev` | Requires Rust & Cargo installed on system |

---

## 2. Verification Checklist

Before declaring any task or iteration complete:
1. Run `pnpm build` in the repository root.
2. Confirm both `tsc -b` (TypeScript strict mode) and `vite build` complete with **exit code 0**.
3. When committing, author directly as the **working user** (`git config user.name`/`user.email`) without `Co-authored-by:` or agent tags.
4. Update `docs/STATUS.md` and check off items in `docs/TODO.md`.

---

## 3. Theming & Design System Rules (Arc / Zen Style)

- Dynamic tokens live in `apps/desktop/src/lib/theme-engine.ts`.
- All colors must map to CSS custom properties (`--color-accent`, `--color-surface`, `--color-surface-hover`, etc.).
- Preserve the user-selected atmosphere intensity and derive all surfaces through the theme engine.
- Keep the UI flat, with tactile surface gradients and subtle, tinted drop shadows.

---

## 4. Worktree Isolation Conventions

- Always spawn new task worktrees under `.worktrees/<task-slug>`.
- Use the Tauri IPC bridge (`tauri-bridge.ts`) for both native and mock browser development.
- Keep the main working tree clean so the human user can test, review, and commit cleanly.

## 5. Experience decisions

For usage, quotas, model routing or proactive features, read
`docs/USAGE-AND-ROUTING.md`. Keep reported measurements distinct from estimates
and unknowns; route from the same capacity data the user sees. Proactive scans
are budgeted and accounted; proposed work requires approval before dispatch.

Read `docs/DESIGN.md` before changing a screen. The reference implementation is
`ThemeEditor.tsx`: direct manipulation, immediate feedback, keyboard parity,
and a small, deliberate surface. Use `/design-lab.html` in the running Vite app
to inspect shared components, the mascot, and icon sizes.

- Start with the user's next action. Reuse `WorkspaceHeading` when it fits;
  do not force every view into the same heading/card layout. Share behavior and
  visual tokens while designing each surface around its purpose.
- Read `docs/VISION.md` for committed scope and `docs/PRODUCT-AUDIT.md` for the
  prototype's known gaps before extending a feature. Demo timers and fixtures
  do not prove execution; mark work complete only against its user journey.
- Treat Jackalope as the operator across agents and machines. Read
  `docs/OPERATOR.md` when changing dispatch, context selection, connector/MCP
  setup, or project/workspace navigation. Ask which user intent the screen
  serves and which project/host/capabilities it needs. Keep that context visible
  and correctable; do not infer execution from a UI transition.
- Tasks, Worktrees, and Agents are the current primary navigation. Keep labels
  shared through `layout/navigation.ts`; evolve the hierarchy when a validated
  user workflow warrants it, rather than treating the initial shell as immutable.
- Motion must explain a transition, acknowledge an action, or express the
  mascot's personality. Never add a breathing dot or activity badge without a
  real state behind it. A manual task move does not prove an agent started.
- Reuse `ThemeEditor` for appearance selection. Preview through tokens; save
  only on Keep theme in the shell picker. Escape/outside dismissal cancels.
  Preserve exact-color input validation and the atmosphere slider.
- Use Radix for popovers, menus, and dialogs. Verify Escape, focus return,
  keyboard selection, and narrow-window positioning in the rendered UI.
- Character geometry lives in `mascot/character-paths.ts`. The icon uses its
  head silhouette; the companion uses a small theme-derived gradient palette.
  Run `pnpm --filter @jackalope/desktop brand:generate` after shape changes.
- Before handoff, verify 1280×840 and 960×640, theme persistence and preview
  rollback, all five mascot moods, and `pnpm --filter @jackalope/desktop
  test:visual-state`. Finish with `pnpm build`.

## 6. Parallel execution and integration

Read `docs/PARALLEL-MVP.md` before editing queue dispatch, coordination, capacity
or Git integration. The native runtime and coordinator own work; UI state never
claims or completes it. Keep coordinator mutex -> integration exclusion -> runtime
mutex ordering, and use the guarded reservation path for every new attempt.
Dependencies require reachable integrated commits; successful exits are not merges.
Keep source worktrees and staging intact, invalidate stale previews, and never
bypass dirty-master or ignored-file protections. Claude coordination uses the
scoped MCP tools; do not weaken shell permissions to read bridge credentials.
Run native tests against disposable repositories and inspect the 960x640 review
and capacity views. General connectors, budgets and routing remain separate scope.
