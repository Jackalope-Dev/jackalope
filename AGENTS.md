# Agent guidance

- Commit your own work on a branch under .worktrees/<task>, as the configured git user,
  with no Co-Authored-By or agent trailers. Stage only the files you changed. Commit
  or push to master directly only with the owner's approval (see "Deploys need the
  owner's go-ahead"); otherwise push the branch and open a PR. Never force-push,
  reset --hard or clean. Releases follow the jackalope-release skill, which does not
  commit.
- Read docs/STATUS.md, docs/TODO.md and docs/UI-GUIDELINES.md before changes. Check git
  status and worktree list; preserve existing work.
- Start isolated concurrent work from current master under .worktrees/<task>.
  Older worktrees are snapshots, not the current baseline.
- Confirm the baseline with pnpm build. Use targeted checks while working
  (pnpm verify:quick: Biome on changed files, typecheck, knip), finish with pnpm verify. Update status/backlog only when capabilities or open scope change. Do not claim
  native or installed-app acceptance from a frontend build.
- Keep comments for non-obvious behavior and contracts, not narration or task history.
- Follow docs/DOCUMENTATION.md for every tracked document. Keep only current behavior,
  engineering guidance and reusable templates. Do not add feature design proposals,
  decision records, experiment reports, dated test results, work summaries or owner
  handoffs. Put detailed evidence in the task/PR response or ignored scratch/output.
  New guides need a distinct contributor purpose and a docs/README.md entry.
- `pnpm knip` lists unused files, exports and dependencies; it runs inside `pnpm verify`.
  Before removing unused files, inspect imports, generated paths, package scripts,
  native registration, packaging and manual test consumers. Preserve compatibility
  data and required notices. Remove orphaned references and prevent regeneration.
- Reserve the public changelog for notable features, meaningful improvements and
  larger milestones. Skip routine copy, spacing, icon and internal maintenance
  changes. Use `pnpm changelog:add`; verification checks structure and ordering.
- When completing a roadmap capability, changing a current priority, or adding,
  deferring or removing planned scope, update `apps/website/src/roadmap-content.ts`
  alongside `docs/STATUS.md`, `docs/TODO.md` and `docs/ROADMAP.md` as relevant.
  Keep Built, In progress, Up next and Further out accurate; implementation does
  not imply release acceptance or public availability. Keep copy concise and
  user-facing, and do not invent dates or promote exploratory work to a promise.
- Follow CONTRIBUTING.md for checks and docs/ARCHITECTURE.md for ownership. Native
  changes preserve coordinator → execution guard → runtime lock order, reservation,
  process ownership, history recovery and Git safeguards.
- Preserve saved-data compatibility. Fixtures never prove real execution. Do not
  remove legacy data paths solely because the UI moved.
- Derive styling from packages/brand tokens and shared controls. Verify keyboard,
  focus, light/dark appearance, reduced motion and narrow layouts for UI changes.
  Keep theme persistence and preview rollback intact. Mascot moods reflect activity;
  do not introduce synthetic or persistent decorative status indicators.
- Keep credentials and live deployment state out of source. Use explicit private
  server configuration and isolated native test profiles. Do not stop another
  user's working app to run a test.

Quick facts that trip people up:

- pnpm only (pinned in package.json); never npm or bun here. Lockfile patches and
  overrides live in pnpm-workspace.yaml.
- src-tauri/build.rs reads node_modules/agent-browser; the desktop bundles that binary.
  A fresh worktree therefore needs `pnpm install --frozen-lockfile --prefer-offline`
  (seconds, from the shared store) before any cargo command. Debug builds create an
  empty apps/desktop/dist when the frontend has not been built. With sccache
  installed, `RUSTC_WRAPPER=sccache` reuses dependency builds across worktrees.
- Check terminal UI changes with the harness in apps/desktop/src-tauri/src/cli/ui/harness.rs
  (see docs/CLI.md); it renders frames as text and never touches a running app.
- apps/server/admin is a separate SPA built by admin:build, not part of the Worker.
- Browser verification scripts import /src/... inside the Vite dev server, so those
  paths only resolve at runtime.
- Pushing to master deploys the production API and the website, and pushing to
  beta deploys the staging API, through Cloudflare Workers Builds; there is no
  GitHub Actions deploy. A push or merge to master therefore needs the owner's
  approval (see "Deploys need the owner's go-ahead").

Read docs/PARALLEL-WORKFLOWS.md for integration rules and docs/SELF-DEVELOPMENT.md for
native testing. Repository skills point to these shared guides.

## Deploys need the owner's go-ahead

Pushing or merging to `master` deploys to production. Direct pushes to `master` are welcome,
but only when the repository owner has approved that specific change in the current
session (for example "push it", "deploy it", "merge that").

- Without that approval: commit on a branch in `.worktrees/<task>`, push the branch,
  open a PR, and ask. Don't merge it yourself.
- An approval covers the change it was given for, not later ones, and never carries over
  to a new session or to another agent.
- The same rule covers deploy commands (`pnpm run deploy`, `wrangler deploy`), production
  database migrations or writes, and secret changes.
- With approval: run every gate first. Never `--no-verify`, force-push, or use admin
  rights to skip required checks.

## Worktrees and keeping master current

- Start a task with `pnpm run worktree <task> [branch]` (`node scripts/worktree.mjs new`).
  It fast-forwards the local `master` to origin, adds `.worktrees/<task>` on a new branch
  from it, and copies the main checkout's small gitignored files (env files, generated
  `cloudflare-env.d.ts` / `next-env.d.ts`, manifests) that a fresh checkout lacks.
- Each worktree gets its own install (the script runs it). This is a workspace
  monorepo: a shared `node_modules` links each workspace package to the main
  checkout's copy, so the worktree would run the main checkout's code, not its own edits.
- Run tools through package scripts or `node scripts/run-bin.mjs <package>`, never
  a hard-coded `node_modules/...` path (missing in a worktree) or `npx` (it can pick up
  an unrelated global install or download a different version: on the dev box `npx
  biome` finds Biome 0.3.3).
- After you push to `master`, or a PR of yours merges, run `pnpm run sync` so the local
  `master` matches origin and the main checkout's `node_modules` match its lockfile. It only
  fast-forwards: it never resets, stashes or overwrites local edits, and says so when it
  leaves `master` alone.
- `pnpm run worktrees` lists worktrees; `--remove-merged` removes clean, merged ones.
