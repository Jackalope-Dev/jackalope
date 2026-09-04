# 🤖 Agent Operational Manual (AGENTS.md)

Welcome, Agent. This document defines the protocol, standards, and workflow loop for any AI agent interacting with, extending, or maintaining the **Jackalope** codebase.

---

## ✍️ Commit Guidelines: Active Working User Only
- Commits are **permitted**, but must always be authored under the **working / active user** (`git config user.name` / `git config user.email`).
- **NEVER** add `Co-authored-by:` agent tags, bot trailers, or agent-only authorship.
- Write clean, descriptive, conventional commit messages matching the working user's style.
- Ensure `pnpm build` finishes with exit code 0 before committing.

---

## 🔄 The Agent Continuity Loop

When you begin an agent turn or hand-off in this project, execute the following loop:

```
┌────────────────────────────────────────────────────────┐
│ 1. LOCATE & ORIENT                                     │
│    Read docs/STATUS.md and docs/TODO.md               │
│    Understand current active milestone and priorities  │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ 2. REPRODUCE / VALIDATE BASELINE                       │
│    Run `pnpm typecheck` or `pnpm build`                │
│    Ensure the tree is clean before making changes       │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ 3. EXECUTE TARGET CHANGE                               │
│    Keep changes focused, modular, and type-safe        │
│    Follow design tokens (Arc/Zen themes, Radix, Motion)│
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ 4. VERIFY & TEST                                       │
│    Run verification commands (build, lint, test)       │
│    Validate accessibility (WAI-ARIA, keyboard traps)   │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ 5. UPDATE STATUS & HAND OFF                            │
│    Update docs/STATUS.md and docs/TODO.md with what was│
│    accomplished and exact next steps for next agent    │
└────────────────────────────────────────────────────────┘
```

---

## 🎨 UI & Design Principles

1. **Flat with Subtle Elevation**:
   - Do NOT use heavy, skeuomorphic bevels or harsh solid borders.
   - Use subtle surface gradients (e.g. `bg-gradient-to-b from-surface to-surface-sunken`).
   - Use soft, colored drop shadows that pick up the active theme accent.
2. **Dynamic Theming (Arc / Zen Style)**:
   - All colors must map to CSS custom properties (`--color-accent`, `--color-surface`, `--color-surface-hover`, etc.).
   - Never hardcode arbitrary hex colors in component templates unless they are derived via `theme-engine.ts`.
3. **Mascot Presence**:
   - The Jackalope pet (`JackalopeMascot.tsx`) is a living personality in the app.
   - Trigger appropriate mascot moods:
     - `idle`: normal viewing.
     - `thinking`: when analyzing user prompts or generating project recommendations.
     - `working`: when worktrees or agent tasks are executing.
     - `success`: when a build passes or task completes.
4. **100% Accessible**:
   - Use Radix UI primitives for dialogs, dropdowns, popovers, tabs, and tooltips.
   - Ensure complete keyboard navigability (Tab, Shift+Tab, Arrow keys, Esc).

---

## 🛠️ Monorepo Commands

| Purpose | Command | Notes |
| :--- | :--- | :--- |
| **Install Dependencies** | `pnpm install` | Uses pnpm workspaces |
| **Start Web Dev** | `pnpm dev` | Starts Vite dev server with browser mock IPC |
| **Typecheck** | `pnpm typecheck` | Checks TypeScript without emitting |
| **Build Web Bundle** | `pnpm build` | Bundles React client into `dist` |
| **Start Tauri App** | `pnpm tauri dev` | Requires Rust & Cargo installed |

---

## 📦 File Modification Rules

- **Shared State**: Zustand stores live in `apps/desktop/src/stores/`. Keep actions pure and serialized.
- **Tauri IPC Bridge**: Native Tauri calls are wrapped in `apps/desktop/src/lib/tauri-bridge.ts`. Always maintain a fallback mock implementation so web preview functions seamlessly in browsers when Tauri runtime is absent.
- **Documentation**: Whenever you finish a task, immediately update `docs/STATUS.md` and check off completed items in `docs/TODO.md`.
