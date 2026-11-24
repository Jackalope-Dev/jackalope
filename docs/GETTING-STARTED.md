# Your first useful change

Install Git and a supported agent CLI, then sign in using that agent's normal
flow. Onboarding can install an agent for you: **Install** shows the exact npm
command, runs it with its output visible and finds the agent when it finishes
(npm agents need Node.js; OpenCode uses Jackalope's private runner where
supported). Jackalope uses the account already on this computer unless you choose an
isolated account in Agents. Each provider's own subscription and permissions
still apply.

Running tasks also needs a free Jackalope account. The welcome screen opens the
website in your browser to sign up or sign in, then you confirm the code shown in
the app to connect this desktop. See [desktop account connection](DESKTOP-ACCOUNT.md).

First-run setup starts by looking for repositories on this computer: the folders your
Claude Code and Codex conversations ran in, Git repositories one or two levels inside common
code folders in your home (such as `~/Code`, `~/Developer`, `~/Projects`, `~/src` and
`~/source/repos`), and folders VS Code, Cursor and Windsurf list as open or recently open
in their `storage.json`. Worktrees count as their main checkout, and repositories that are
already projects are left out. It reads only directory entries and Git metadata (current
commit time and the default remote's host), never file contents, and it never opens
Desktop, Documents, Downloads, the media folders, `~/Library` (including iCloud Drive) or
mounted volumes, so macOS does not ask for permission. The scan stops after a few seconds
with what it found. The few with recent agent conversations or commits start chosen; **Add
another folder…** adds one you pick, and **Skip** goes to choosing a folder instead. Each
chosen repository is added with its commands detected, and the first continues through
setup. Command search's **Find projects on this computer** runs the same scan later.

1. Open a Git repository with at least one commit (Project settings → Integrations →
   Cloudflare Artifacts can make the first one). Choose the agent you want.
   Project setup asks for the project, its agents and an optional first-task
   draft. Decisions, Git behavior and appearance start from defaults that you can
   change in Project settings.
2. Setup detects preparation, check and preview commands automatically without
   running them or replacing saved choices. Review or edit them in Project settings
   and choose a committed local target branch.
3. Choose **New work** in the sidebar and describe one concrete result. The work runs
   in a separate workspace, so commit any existing changes the agent needs first. Optional workflow
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
review position. Marking files seen does not accept them. **Inbox**, at the top of
the sidebar, shows work waiting on you across your projects. Optional usefulness ratings and review time are saved
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
- **Need help:** Settings → Help & community → Preview support report. Review its
  contents, describe what happened, then copy it. Share it only through the
  support channel supplied with your release; the app does not send it for you.

App updates appear in Settings → Updates when a trusted release source
is configured. Finish active tasks before installing. Local trial builds may
have no update service configured.

## Keeping Jackalope up to date

Published builds check for updates after startup and every hour while open, and
download a found update in the background. Open **Settings → Updates** to
turn off automatic checking or background downloads, or to check now. The update
notice offers **Download and install**, or **Restart to update** once the download
is ready; open the details to read the release notes first. Dismissing the notice
hides it for that version; the update stays available in Settings. Installing waits until
running tasks finish or are stopped, and the details list the tasks in the way.
Nothing installs or restarts without your action. A failed check or download can be
retried from the same view. Microsoft Store builds install through the Store, and
background delivery follows your Store settings. Local builds without a configured
release service cannot receive updates.
