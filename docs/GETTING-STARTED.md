# Your first useful change

Install Git and a supported agent CLI, then sign in using that agent's normal
flow. Jackalope uses the account already on this computer unless you choose an
isolated account in Agents. Each provider's own subscription and permissions
still apply.

1. Open a Git repository with at least one commit. Choose the agent you want.
   Project setup walks through agents, decisions, Git behavior and appearance
   before an optional first-task draft.
2. Setup detects preparation, check and preview commands automatically without
   running them or replacing saved choices. Review or edit them in Project Settings
   and choose a committed local target branch.
3. In **Tasks → Chat**, describe one concrete result. Chat uses a separate workspace.
   Commit any existing changes the agent needs before starting. Optional workflow
   starters import GitHub evidence into a draft; review it before sending.
4. Watch progress, respond to questions, or stop the attempt. Switching pages
   does not move the task to a different project or account.
5. Inspect the result and changed files. Install dependencies in the task
   worktree if needed, then choose **Run checks**. The command runs with your
   OS permissions in that worktree. Stalled and excessively long commands are stopped
   with their reason recorded.
6. Ask for another iteration if necessary. A continuation keeps its original
   agent profile. To use another account, start a separate task.
7. Open **Review**, run or cancel any queued messages, then choose **Preview merge**
   into your target branch. Inspect the combined
   changes. Configured checks must pass for the exact current file snapshot.
   Merge into the target branch is an explicit action, then the task workspace
   is removed unless you keep it. Commits use your configured attribution policy.
   Continue in a new chat to build on the integrated result.

Your target checkout must be on the selected branch and free of local changes.
Jackalope does not stash or overwrite those changes. If files or the target
branch change after review, prepare a fresh review. Conflicts must be resolved
in the worktree before preparing another integration. Source worktrees are kept.

Use **Changes since my last review** to inspect the next iteration against a saved
review position. Marking files seen does not accept them. Chat's start page shows work
waiting across your projects. Optional usefulness ratings and review time are saved
locally with each task. **Usage & quota** shows account limits and recorded token activity.

**Session limits** can pause after a number of batches or at an estimated dollar
threshold. A running batch can exceed that estimate; these are not provider billing
caps. Missing cost reports pause later batches when a cost threshold is set.

## When something needs attention

- **No agent found:** install its CLI, ensure its executable is discoverable, or
  configure its absolute path in Agents settings. Refresh discovery.
- **Sign-in expired:** use the selected account's sign-in action and try again.
  Removed account selections produce an error instead of switching accounts.
- **Verification failed:** read its output. Check dependencies and configuration,
  fix the failure, then run checks again. A passing agent exit is not a passing test.
- **App closed during work:** inspect the retained workspace and output. New
  Windows task processes are contained; previously uncontained interrupted
  attempts still require manual reconciliation. Work is never replayed silently.
- **History cannot be saved:** keep Jackalope open. Use **Review unsaved task**
  from any page, or open the task, then **Retry saving** after restoring space or
  access. **Save recovery copy…** writes a private task snapshot to another
  location; it does not contain source files or clear the original save error.
  Settings → Data & reset can import recovery copies and restore archived runs;
  existing runs are never overwritten. See [history and recovery](HISTORY-RECOVERY.md).
- **Queue cannot be read:** inspect its preserved location in the history notice.
  New work stays blocked to protect assignments. Back up and repair the queue
  with Jackalope closed, then restart. Existing task results remain readable.
- **History cannot be read:** open the recovery notice. Jackalope preserves the
  affected file and shows its location; it does not invent a replacement result.
- **Need help:** Settings → Updates & support → Preview support report. Review its
  contents, describe what happened, then copy it. Share it only through the
  support channel supplied with your release; the app does not send it for you.

App updates appear in the same Settings category when a trusted release source
is configured. Finish active tasks before installing. Local trial builds may
have no update service configured.

## Keeping Jackalope up to date

Published builds check for updates after startup and every six hours while open.
Open **Settings → Updates & support** to change automatic checking or check now.
When an update is available, use **Review update** to read the release notes.
**Later** dismisses the notice for the current session; the update remains in
Settings. Finish active work and save task history, then choose **Install update
and reopen**. Keep the app open while it downloads. No download or restart begins
without that action. A failed check or download can be retried from the same view.
Local builds without a configured release service cannot receive updates.
