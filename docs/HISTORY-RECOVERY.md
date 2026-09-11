# Task history and recovery

Native journals own execution results; renderer state owns selection and drafts.
See [persistence contracts](PERFORMANCE.md#runtime-contracts) for durable output,
checkpoints and crash recovery. A failed save never establishes successful persistence.

## Archives and imports

Tasks offers individual archive actions, **Select tasks**, and **Archive finished**.
Bulk actions apply only to tasks matching the current project, search and status
filters. **Archived** lists manually archived tasks and saved ideas with restore
actions; Undo restores the last successful archive batch. Results, usage, queue
references and workspaces remain available. Archiving does not accept a result,
remove a worktree or delete history.

Manual archive state is saved on the latest native attempt, or on an unstarted
saved idea. A new attempt brings its task back into the current list. Active,
interrupted, finishing, unsaved and live-session attempts block manual archiving.
Failed saves leave tasks visible; partial batch failures identify the affected tasks.

On startup, reviewed runs beyond the most recent 200 move to `history/archive` in
the native profile. Archived runs remain on disk and searchable. Active, review-ready,
failed, interrupted, unsaved, manually archived and live-session runs remain loaded. Session attempts
stay available because later batches depend on their workspace and account identity.

Tasks → Archived and Settings → Data & reset list retention archives, restore runs and import
`jackalope-task-recovery` exports. An import or restoration cannot overwrite an
existing run. Recovery exports contain private task data; inspect them before sharing.

Unreadable journals are preserved. Restore access or disk space, then retry saving
through the recovery notice. Retain an independent copy before manually repairing
records. Never manufacture a successful attempt or replay interrupted work to clear
an error. A new task can use a reviewed copy of the retained workspace.

## Workspace cleanup

Cleanup refuses active or interrupted ownership, locks, submodules and mismatched
Git registrations. For recoverable local changes, **Archive & remove** saves a Git
bundle, tracked patch, untracked nonignored files and manifest under `.worktrees/.archive`
before removing the worktree and its task branch. **Prune missing worktrees** removes
registrations only for folders already absent.

An integrated commit, equivalent file content and a clean working tree are different
facts. Preserve source work until the integration receipt and cleanup checks agree.
See [parallel workflow safeguards](PARALLEL-WORKFLOWS.md#commit-ownership-and-cleanup).

## Verification

Use disposable repositories and an isolated `JACKALOPE_PROFILE_DIR`. Exercise damaged
journal tails, failed writes/retries, archive search, imports colliding with existing
IDs, locked worktrees and partial cleanup. Confirm the original data survives each
failure. Follow [native testing](SELF-DEVELOPMENT.md); fixture success does not prove
installed recovery or safe handling of a user's actual project.
