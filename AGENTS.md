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
