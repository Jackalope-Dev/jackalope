# Task history and recovery

Native journals own execution results; renderer state owns selection and drafts.
See [persistence contracts](PERFORMANCE.md#runtime-contracts) for durable output,
checkpoints and crash recovery. A failed save never establishes successful persistence.

## Archives and imports

On startup, reviewed runs beyond the most recent 200 move to `history/archive` in
the native profile. Archived runs remain on disk and searchable. Active, review-ready,
failed, interrupted and unsaved runs remain loaded.

Settings → Data & reset lists archives, restores selected runs and imports
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
