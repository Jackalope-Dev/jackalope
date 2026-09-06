# Build Jackalope with Jackalope

The local task workflow supports supervised self-development. Agents can edit
the repository in isolated worktrees, run commands, report results and usage,
continue an existing task, and submit changes for explicit review. Automatic
crash recovery, browser interaction and unattended roadmap execution remain
unfinished. Existing CLI sign-ins are used; no additional MCP server is required
for ordinary local code and command-line work.

## First run

1. Install the current Windows package, or open the current release executable.
   Prefer an installed copy when rebuilding the repository's release executable
   so the running app does not hold that output file open.
2. First launch opens guided setup. Browse to `C:\Users\developer\Desktop\jackalope`
   and continue. Existing users can open **Settings > General > Open guided setup**.
3. Choose a discovered agent. Expand manual setup for executable paths and model
   restrictions, then use **Check again**. Resolve missing executables or sign-in
   warnings through that agent's CLI before starting work.
4. Paste the smoke task below in the final step and choose **Review first task**.
   Setup saves a draft; it does not dispatch work. In **Tasks**, keep **New
   worktree**, review the agent and prompt, then choose **Start task**. Review its
   actual command results before assigning code.

Setup remembers completed steps and drafts across restarts. Skipping enters the
workspace and stays dismissed; Settings can reopen it without deleting data.

```text
Validate this Jackalope worktree's build environment. Read AGENTS.md,
docs/STATUS.md and docs/TODO.md. Use the worktree already assigned to this task;
do not create another one. Run pnpm install --frozen-lockfile, pnpm build, and
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib.
On this Windows machine, Cargo is installed at
C:\Users\developer\.cargo\bin\cargo.exe if it is missing from PATH.
Report exact results and any setup blocker. Do not edit source, commit, merge
or push. Do not claim browser interaction was tested.
```

Worktree creation does not install dependencies. Each task that needs to build
must install them in its assigned worktree. Project Settings' verification
command is displayed as a reminder; put required commands in the task prompt.

## Make and review a change

Give a new task one concrete unfinished feature or bug, expected behavior and
required verification. Tell it to follow repository instructions, stay in its
assigned worktree, install dependencies, run the relevant checks, and leave all
changes uncommitted. Inspect the result and workspace changes; use a follow-up
to request corrections in the same task/workspace.

For multiple tasks, use **Tasks > Parallel work**, **Add work**, and
explicit file scopes and dependencies. Start with concurrency one, then enable
**Run ready tasks**. Tasks start from committed local `master`; uncommitted
changes in the main checkout are excluded. Shared scopes and dependent tasks
wait until prerequisite changes are actually integrated.

In **Review & merge**, inspect the prepared combined patch and the verification
evidence before applying it. **Merge tasks into master** creates commits as the
configured Git user and fast-forwards the clean master checkout. The owner must
perform this action; agents must not commit or merge. Alternatively, review and
integrate through ordinary Git tools. Resolve conflicts externally, then prepare
a fresh review. Source worktrees remain available.

The plan in `docs/plans/next-local-features.json` is an older proposal containing
already delivered work. Reconcile it with current source and TODO before import.
Do not start the whole plan unchanged.

## Use the changed app

After reviewing and committing/integrating a change, run from the main checkout:

```powershell
$env:Path = 'C:\Users\developer\.cargo\bin;' + $env:Path
pnpm tauri build
```

Install the resulting NSIS package under
`apps/desktop/src-tauri/target/release/bundle/nsis`, then restart Jackalope when
tasks are finished. Changing source does not update an already running release
app. Closing normally hides to tray; use the tray's Quit action for a full exit.
Do not restart during active tasks: interrupted attempts do not automatically
resume, and queue dispatch starts paused after restart.
