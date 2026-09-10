# Agent guidance

- Do not commit code. Leave changes for the maintainer to review and commit.
- Read docs/STATUS.md, docs/TODO.md and docs/UI-GUIDELINES.md before changes. Check git
  status and worktree list; preserve existing work.
- Start isolated concurrent work from current master under .worktrees/<task>.
  Older worktrees are snapshots, not the current baseline.
- Confirm the baseline with pnpm build. Use targeted checks while working, finish
  with pnpm verify. Update status/backlog only when capabilities or open scope change. Do not claim
  native or installed-app acceptance from a frontend build.
- Keep comments for non-obvious behavior and contracts, not narration or task history.
- Follow docs/DOCUMENTATION.md for every tracked document. Keep only current behavior,
  engineering guidance and reusable templates. Do not add feature design proposals,
  decision records, experiment reports, dated test results, work summaries or owner
  handoffs. Put detailed evidence in the task/PR response or ignored scratch/output.
  New guides need a distinct contributor purpose and a docs/README.md entry.
- Before removing unused files, inspect imports, generated paths, package scripts,
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

Read docs/PARALLEL-WORKFLOWS.md for integration rules and docs/SELF-DEVELOPMENT.md for
native testing. Repository skills point to these shared guides.
