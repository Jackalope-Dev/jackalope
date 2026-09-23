# Core task workflow

The core loop is intent → work → decision → result → iteration or delivery.
This implementation remains local and uses the existing native task, coordinator,
verification, integration and schedule services.

## Capture and context

New work and the configurable Ctrl/Cmd+Shift+N shortcut open the conversation composer. Saved-draft and issue-intake actions retain the task capture dialog. Guided
setup also offers capture before project setup. Ideas can have an empty project
identifier; they do not create fictitious projects or authorize execution.
A draft's suggested project is frozen when captured, editable, and preserved
across navigation/reload. Existing project drafts and saved planning records remain
accessible. A missing or restricted agent blocks launch without losing the idea.

Project instructions are included; optional guidelines and tool selection remain
inspectable. Project connection loading must finish before dispatch. An explicitly
empty connection list stays empty through save/restore. Task setup opens existing
agent, project and connection controls without discarding the draft.

Connected work browses GitHub issues and pull requests, Linear issues and Jira Cloud
issues. Selecting one prepares an editable draft with its source link; it does not
start work or update the issue. GitHub uses the existing CLI sign-in. Linear and Jira
connections are tested before their tokens are saved in protected native storage.

## Work and results

Work combines conversations, tasks and plans, defaults to the selected project and offers an explicit All work scope.
The work list and recent-work sidebar share discovery without duplicate attempts. Needs-input/recovery
and failed-check work precede results ready for review, active work, saved ideas and
finished work. Integration state comes from native verified receipts. Filters, search
and list/board choices persist per scope and mode. Work rows show the assigned agent character,
live or next-action status and the next useful action. Active and waiting work also
appear in a compact in-progress strip. Arrow keys, Home and End move between visible
work rows; command search also finds projects, tasks, sessions and current-task actions.
Parallel planning remains inside Work with the existing ownership and dependency
contracts; plans stay editable before dispatch.

Focus leads with a message composer and one task to resume, using a compact navigation
rail. All work opens the searchable list. Build keeps recent work in the sidebar,
offers project tools and opens task review beside the conversation. Other tool tabs
can retain the conversation, including terminals and activity. Oversee uses full-width
navigation, counts from current work, prioritized decisions and a board; New work
opens its composer explicitly. Questions and Stop remain available in every mode.
The composer options menu holds session limits, workflow starters and saved project
context. Modes save per project, preserve unsent drafts and reset conversation-layout
overrides when selected. The last task or
session section persists across navigation. Project setup covers project, agents,
decisions, behavior, appearance and an optional first task.
Workspace inspection can suggest preparation, checks and preview commands without
executing them. Failed or pending inspection never establishes a clean checkout.

Task detail keeps the assigned agent, recorded progress and next action together.
Task titles extract a short objective locally without changing the original request;
deliberately named tasks retain their titles. Existing work takes priority in the list;
New work opens the composer, and secondary actions live in the work actions menu.
Result contains earlier exchanges, agent response and the latest screenshot. Review
opens directly to changed files, with project checks, requirements and agent evidence
alongside. Optional review tools are disclosed, and merge preparation opens explicitly.
Activity keeps
searchable agent messages. Details contains account, model, workspace, instructions,
usage, the original request and connection choices. Attempt history stays beside the page navigation.
Changes load automatically for finished work; diff rendering waits until Review is visible.
Line comments persist locally, retain their patch revision and can be batched into a
follow-up. Comments from an earlier patch remain visible with stale-location context;
resolving a comment does not approve the work. Show conversation keeps the exchange
beside Review or Preview, stacking the panels in narrow layouts.
Long errors keep a concise summary with expandable full details. Copy output and
Make recurring share the task actions menu. Questions and save recovery remain
visible above the task sections. Follow-up stays visible while the content scrolls.
Preview and Delivery are separate task sections. Their setup, ownership, evidence and
publication boundaries are described in [parallel workflows](PARALLEL-WORKFLOWS.md).

HTTP(S) result links open through the OS browser in desktop. Other schemes are
not executed. Copy result reports clipboard failures. Screenshots still use the
native bounded evidence reader and cannot claim current visual acceptance.

## Preparation and verification

A project's optional preparation command authorizes a bounded, cancellable command
in each new task workspace before its agent starts. Continuations skip preparation.
Preparation failure retains workspace/history and its recorded command output.

Preparation and verification commands are bounded by silence rather than by total
runtime: a command is stopped when it produces no output for its stall budget, so a
slow command that keeps reporting progress is allowed to finish. Both are still
capped by an overall ceiling. The recorded outcome distinguishes a command that was
stopped for going quiet, one stopped at the ceiling, and one that exited with a
failing status, and the task's error repeats that distinction.

A workspace records the dependency manifests its preparation command completed
against. When a later attempt finds those manifests unchanged, preparation is
skipped and reported as skipped rather than run again. A preparation command that
was stopped mid-progress is retried once automatically; a command that ran and
reported a failing status is not repeated.

Automatic verification is explicitly enabled in Project defaults. Its saved command
and authorization travel with the task, queue item or schedule and survive account
or preference changes. After a successful agent result the task remains active
while native verification reserves its workspace and uses separate check capacity. Navigating away does not
cancel it; Stop does. Matching successful checks are reused only for the same file
snapshot. Missing commands, command failures and unstable file snapshots remain
visible. Historical records default to automatic verification off and no preparation.

While a task is active it reports the step it is on (workspace, project setup,
agent selection, agent start or project checks), the newest line that step produced,
how long it has been running and which automatic attempt it is. Summaries carry the
same step, so the task list reports live progress without the full activity log. The
step is cleared when an attempt reaches a terminal status.

The coordinator → execution guard → runtime ordering, active reservations, owned
process trees, interrupted ownership and history failure guards remain in force.
No historical replay or inferred dependency installation is added.

An attempt that failed, stopped or was interrupted can be retried explicitly. A retry
is a fresh attempt in the same task: it keeps the task's prompt, agent request,
account, project settings, recorded context and agreed outcome, resumes no agent
session, and is refused for an attempt that is already integrated or superseded by a
later attempt. It continues in the previous attempt's worktree only when that worktree
still exists, no other attempt owns it, and the agent left no uncommitted changes;
otherwise a fresh worktree is cut and the earlier one is kept for inspection.

## Iteration and delivery

Follow-ups use the same native session, workspace and saved account. During active
work, Stop and send explicitly stops the attempt, waits for real terminal state,
then continues. A timeout, interrupted ownership or absent session preserves the
follow-up and reports why it was not sent. Earlier attempts cannot start a competing
continuation through the UI. Draft edits survive failures.

Existing tool scope carries forward by default. Users can explicitly select a
different project connection list for the next continuation; connecting a service
alone does not override an explicit scope. The active attempt retains its tools.

Finished isolated work keeps review, merge and workspace cleanup on the Review tab.
The primary action opens that path: inspect the change, merge into the task target
branch, then remove the workspace. The explicit merge still retains source/target
snapshots, check requirements, conflict handling and receipt recovery. Mark reviewed
still only records a review. Merging does not push. Source cleanup follows the merge
choice and defaults on. Integrated work continues through a new task based on the
updated target, with the earlier result attached.

Paused Chat sessions use the same integration controls for their latest batch after
queued messages are run or canceled. Applied receipts block reopening or sending into
the old workspace. Optional review positions show changes since an explicitly marked
tree; they never replace whole-result verification or acceptance. Local usefulness
ratings and optional review minutes feed the Usage report, independently of Git state.

Make recurring opens the existing schedule editor with the task's original intent,
project and agent. Timing presets supplement custom cron input. New schedules start
paused; enabling remains explicit and uses the existing native scheduler.

## Verification

Automated regression coverage and isolated native trials are described in
[CONTRIBUTING.md](../CONTRIBUTING.md) and [SELF-DEVELOPMENT.md](SELF-DEVELOPMENT.md).
Record detailed local receipts privately. Fixtures and source builds do not prove
installed-app acceptance.

With a desktop Vite preview running, use `JACKALOPE_PREVIEW_URL` to select its URL
and run `node scripts/verification/verify-task-detail.mjs`. This browser fixture
checks task states, review sections, keyboard navigation, live step progress,
preparation-failure detail, retry dispatch and continuation guards; it does not
launch agents or establish native execution acceptance.

`node scripts/verification/verify-workflow-velocity.mjs` starts its own Vite fixture
and checks line comments, split review, issue drafts, saved visual notes and companion
retries across reload and new attempts. It uses mocked native and remote requests.
