---
title: "Undo AI Code Changes: A Checklist"
description: "Undo AI code changes safely with a Git checklist for mixed edits, unwanted files, committed work, and changes that Git cannot reverse."
author: "caden-sumner"
date: 2026-11-06
slug: "undo-ai-code-changes-checklist"
tags: ["coding agents", "Git", "code review", "developer workflow"]
faq: [{"q":"Can I undo AI code changes without losing my edits?","a":"Yes, if you inspect and separate them. Use interactive restore or manual editing for mixed files. Git cannot automatically distinguish your uncommitted edits from the agent's."},{"q":"Does git restore remove files the agent created?","a":"Not generally. New untracked files need separate handling. Preview specific paths with git clean -n before deleting them."},{"q":"Should I reset or revert an agent commit?","a":"Prefer revert for shared history. Reset moves the branch pointer and, with destructive options, can discard local work. It isn't the safest default for undoing an agent task."},{"q":"Can an agent's undo button reverse every action?","a":"Don't assume so. Check the tool's documented scope. File recovery doesn't necessarily reverse database changes, deployments, credential exposure, or external requests."}]
---

Stop the agent before you undo AI code changes. Otherwise, it can keep writing while you restore files, leaving you with another mixed state to untangle.

The right rollback depends on where the changes live: uncommitted edits, new files, or commits. This checklist helps you remove the unwanted work without discarding your own edits or rewriting shared history.

## Pick the smallest rollback that works

Run these commands from the affected repository or task worktree, not another checkout of the same project.

| What you need to undo | Use | Main caution |
| --- | --- | --- |
| Some edits in a file that also contains work you want | Interactive `git restore -p` | Inspect each hunk; Git doesn't know who wrote it |
| All uncommitted edits in selected tracked files | Path-scoped `git restore` | Both staged and unstaged edits can be discarded |
| An unwanted commit, especially on a shared branch | `git revert` | Later changes can cause conflicts |
| New, untracked files created by the agent | Preview with `git clean -n`, then remove selected paths | Untracked files may have no recoverable Git copy |

Before choosing a row:

1. Stop active agents and any process that generates or formats files.
2. Confirm your location with `git status --short --branch`.
3. Inspect staged and unstaged changes separately.
4. Save anything you might need before running a destructive command.

Don't start with `git reset --hard` or a repository-wide `git clean`. Those commands aren't aware of task ownership.

## Capture the current state before deleting anything

Start with an inventory:

```sh
git status --short --branch
git diff --stat
git diff
git diff --cached
git ls-files --others --exclude-standard
```

The last command lists untracked, non-ignored files. A new test can be important even though it doesn't appear in `git diff`. See the official documentation for [Git status](https://git-scm.com/docs/git-status), [diff](https://git-scm.com/docs/git-diff), and [ls-files](https://git-scm.com/docs/git-ls-files).

For a lightweight record of tracked changes, save both diffs outside the repository:

```sh
backup_dir=$(mktemp -d)
git diff --binary > "$backup_dir/unstaged.patch"
git diff --cached --binary > "$backup_dir/staged.patch"
printf 'Saved tracked-change patches to %s\n' "$backup_dir"
```

These patches are not a complete backup. They don't include untracked or ignored files, and restoring them later may require resolving conflicts. Copy important new files separately. If the work is valuable or the state is confusing, make a filesystem copy of the task directory, including hidden files, before proceeding. Store that copy somewhere appropriate for the repository's secrets.

A backup branch alone isn't enough: it points to a commit, not your uncommitted file contents.

## Undo only the changes you mean to remove

Use the same paths you inspected above. Replace the example filenames and commit hash with your own.

### Remove selected edits from a mixed file

Interactive restore lets you discard selected diff hunks rather than an entire file. It fits when the agent changed a file that also contains your work.

**Best for:** Keeping useful edits while removing a separate, unwanted change.

If the file has staged changes, first unstage it without changing its working-tree contents. Then review its differences from `HEAD` interactively:

```sh
git restore --staged -- src/parser.ts
git restore -p --source=HEAD --worktree -- src/parser.ts
```

The first command removes the file's staging selections, so you'll need to stage the retained work again afterward. In the interactive prompt, accepting a hunk restores that portion from `HEAD`; declining keeps the current edit. Read the prompt carefully.

If human and agent edits occupy the same hunk, split it where possible or edit the file manually. Git records content, not authorship of uncommitted lines. The official [git restore documentation](https://git-scm.com/docs/git-restore) explains patch mode and the separate index and working-tree targets.

### Restore whole tracked files

Path-scoped restore replaces selected tracked files with a known committed version. It fits when nothing uncommitted in those files needs to survive.

**Best for:** Discarding an isolated experiment in specific files.

To restore both the staging area and working tree from the current commit:

```sh
git restore --source=HEAD --staged --worktree -- \
  src/parser.ts tests/parser.test.ts
```

This discards all staged and unstaged changes in those paths, including yours. It leaves other paths alone. It doesn't remove unrelated untracked files.

Keep the path list explicit. A command targeting the entire checkout can turn a small rollback into lost work. If you need a version from before an agent commit, use a verified commit as the source, but inspect the intervening changes first.

### Revert an unwanted commit

A revert creates a new commit that reverses an earlier commit's changes. It fits committed work, especially when others may already have fetched the branch.

**Best for:** Undoing a committed task while preserving shared history.

Inspect the commit before reversing it:

```sh
git log --oneline -n 10
git show abc1234
git revert abc1234
```

Start with a clean working tree so unrelated edits don't complicate the operation. If conflicts arise, resolve them and continue, or abandon the in-progress revert:

```sh
git revert --continue
# Or, to abandon the in-progress revert:
git revert --abort
```

See the official [git revert documentation](https://git-scm.com/docs/git-revert). Reverting a commit that mixes useful work with unwanted changes reverses both, so inspect the result carefully. Merge commits require choosing a mainline parent; don't guess at that choice.

### Remove new, untracked files

Git clean deletes files outside Git's tracked contents. It fits agent-created scratch files or unwanted tests, after you've checked their contents.

**Best for:** Removing specific new files that restoring tracked files leaves behind.

Preview the exact path, then remove it only if the preview is correct:

```sh
git clean -n -- tests/parser.generated.test.ts
git clean -f -- tests/parser.generated.test.ts
```

According to the official [git clean documentation](https://git-scm.com/docs/git-clean), `-n` previews removal and `-f` permits it. Avoid adding `-x` casually: that also includes ignored files, which may contain local configuration or other data you need. Don't replace the specific filename with a broad directory until you've reviewed everything it would remove.

## Check what Git cannot undo

Restoring source files doesn't reverse every action an agent took. Check the task transcript and terminal output for commands that changed state outside the repository.

A database migration may need a separate rollback or recovery from a backup. A package installation may have run scripts that wrote outside the checkout. A deployment, published package, or external API call needs its own recovery procedure.

Credential exposure is also separate from code cleanup. Removing a token from a file doesn't invalidate it or erase copies in commits, logs, or external systems. Revoke or rotate exposed credentials through the issuing service, then investigate where they were stored.

Don't ask the agent to broadly “undo everything” and assume that covers these effects. Give it a bounded inspection task, such as identifying commands that modified the database, and review the proposed recovery before execution.

## Make the next task cheaper to discard

Give each task a clean starting point and a separate worktree. Record the base commit before the agent begins:

```sh
git rev-parse HEAD
```

That gives you a reference for reviewing the task's changes, rather than reconstructing which edits predated it. The [Git worktrees setup and cleanup guide](https://jackalope.dev/blog/git-worktrees-for-ai-coding-agents/) covers the mechanics.

Jackalope gives each task its own Git worktree, lets you choose the agent and work or personal account per project, and brings finished work back with checks and evidence for review. That separation helps contain a rejected task's file changes. It doesn't make external actions reversible.

Small checkpoints also reduce coding-agent costs: you can reject one failed approach without paying for a broad rewrite of work you wanted to keep. Set a review boundary before expensive follow-up work, such as checking the parser change before requesting a full test-suite expansion. Apply the same boundary to open source agents and hosted tools. Recovery depends on the changes they make, not their licensing model.

## Verify the rollback before resuming work

Inspect the resulting state:

```sh
git status --short
git diff
git diff --cached
```

If you used `git revert`, also inspect the new commit with `git show HEAD`. Then run the project's documented checks for the affected behavior. A clean working tree proves there are no pending tracked edits, not that the application works.

Use the [AI-generated code review checklist](https://jackalope.dev/blog/review-ai-generated-code-checklist/) to check the retained changes. Resume the agent only after you can state what remains and what it may edit next.

## FAQ

### Can I undo AI code changes without losing my edits?

Yes, if you inspect and separate them. Use interactive restore or manual editing for mixed files. Git cannot automatically distinguish your uncommitted edits from the agent's.

### Does git restore remove files the agent created?

Not generally. New untracked files need separate handling. Preview specific paths with `git clean -n` before deleting them.

### Should I reset or revert an agent commit?

Prefer revert for shared history. Reset moves the branch pointer and, with destructive options, can discard local work. It isn't the safest default for undoing an agent task.

### Can an agent's undo button reverse every action?

Don't assume so. Check the tool's documented scope. File recovery doesn't necessarily reverse database changes, deployments, credential exposure, or external requests.
