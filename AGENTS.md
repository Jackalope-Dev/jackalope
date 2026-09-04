# 🐇 Jackalope Agent Invariants & Guidelines

This document governs the operational rules and behavioral constraints for any AI agent working within the Jackalope repository.

---

## 1. ✍️ Commit Guidelines: Active Working User Only
- Commits are **permitted**, but must always be authored under the **working / active user** (`git config user.name` / `git config user.email`).
- **NEVER** add `Co-authored-by:` agent tags, bot trailers, or agent-only authorship.
- Write clean, descriptive, conventional commit messages matching the working user's style.
- Ensure `pnpm build` passes before committing.

---

## 2. 🔄 In-Project Continuity Loop
To guarantee seamless context hand-offs between any agent:
1. **On Startup**: Read `docs/STATUS.md` and `docs/TODO.md` to orient to the current active milestone.
2. **Before Changes**: Confirm clean build status with `pnpm build` (`tsc -b && vite build`).
3. **Upon Completion**: Update `docs/STATUS.md` (completed deliverables & next immediate steps) and `docs/TODO.md` (checking off completed tasks).
4. **Clean Verification**: Ensure `pnpm build` finishes with exit code 0 before concluding any turn.

---

## 3. 🎨 UI & Theming Standards
- **Read [`docs/DESIGN.md`](docs/DESIGN.md) first.** The standing mandate: nothing cookie-cutter, nothing generic-SaaS-template, nothing standard-desktop-app. Refined, focused, and 100% driven by the user's actions/goals — not a data dashboard. Check every new or revisited screen against it.
- **Flat Surface Hierarchy**: Use subtle directional gradients (`bg-gradient-to-b from-surface to-surface-sunken`) and soft tinted drop shadows. Avoid harsh skeuomorphic borders.
- **Dynamic Theming (Arc / Zen Style)**: Never hardcode arbitrary hex values in component styling. Always reference CSS variables derived via `theme-engine.ts`:
  - `--color-accent`
  - `--color-accent-hover`
  - `--color-accent-subtle`
  - `--color-surface`
  - `--color-surface-elevated`
  - `--color-border`
- **Jackalope Mascot Pet**: Trigger appropriate mascot moods:
  - `idle`: normal viewing
  - `thinking`: when analyzing user prompts or generating project recommendations
  - `working`: when worktrees or agent tasks are executing
  - `success`: when a build passes or task completes
  - `sleep`: low activity or resting mode

---

## 4. 🌿 Git Worktree Isolation
- Concurrent agent tasks must execute inside `.worktrees/<task-slug>`.
- Never pollute the primary branch with unfinished multi-file drafts.

---

## 5. 🤝 Concurrent Work Coordination

As of 2026-09-04, a dedicated app-experience/UI-UX agent is about to
start (or already is) working directly on this app's frontend — layout,
component structure, and possibly file locations are subject to change
from that work, separate from whatever this document's reader is doing.

- **If you're doing UI/UX work**: check `docs/STATUS.md` for whether
  that agent's work has landed on `master` yet, and check
  `git worktree list` for an in-progress worktree (e.g.
  `.worktrees/art-direction` / branch `art/character-direction` as of
  2026-09-04) before starting — don't duplicate or collide with it.
- **If you're doing backend/infra/non-UI work**: prefer that over UI
  work right now precisely to avoid stepping on the incoming UI/UX
  agent's changes. Good candidates: the Rust `src-tauri` backend (PTY
  streaming, keychain, wiring commands to real behavior), build/tooling
  work, docs, or anything that doesn't touch `apps/desktop/src/components/`
  layout or `apps/desktop/src-tauri/tauri.conf.json`'s window/bundle shape.
- **At a natural stopping point**, prefer switching to backend/infra
  work over starting new UI work, so the codebase is in a low-conflict
  state for whoever picks up the UI/UX thread next.
