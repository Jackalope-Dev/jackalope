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
- Ensure that dynamic surface tinting (2% hue-cast of the accent into dark surfaces) remains intact.
- Keep the UI flat, with tactile surface gradients and subtle, tinted drop shadows.

---

## 4. Worktree Isolation Conventions

- Always spawn new task worktrees under `.worktrees/<task-slug>`.
- Use the Tauri IPC bridge (`tauri-bridge.ts`) for both native and mock browser development.
- Keep the main working tree clean so the human user can test, review, and commit cleanly.
