# Core task workflow

The core loop is intent → work → decision → result → iteration or delivery.
This implementation remains local and uses the existing native task, coordinator,
verification, integration and schedule services.

## Capture and context

New work and the configurable Ctrl/Cmd+Shift+N shortcut open the conversation composer on
Work. Saved drafts, ideas, repo TODOs, helper drafts and the setup's first task open there
too, with their text and agent filled in; starting the work replaces the idea it came from. Ideas can have an empty project
identifier; they do not create fictitious projects or authorize execution.
A draft's suggested project is frozen when captured, editable, and preserved
across navigation/reload. Existing project drafts and saved planning records remain
accessible. A missing or restricted agent blocks launch without losing the idea.
Sharpen in either composer rewrites the draft into a deeper version of the same task with
one-step undo; it runs one helper call on request and never sends (see
[HELPER.md](HELPER.md#sharpen)).

New work is non-code when it is in General, when a window is attached and the request
names no code, or when a short request only reads or operates something outside the
repository (a web page, a connection, email) and mentions no code or changes. Non-code
work starts one conversation without the planning check, and the agent is told not to
edit files unless a message asks. Options → Treat as code work overrides an inferred
guess; General is always non-code. General is a plain folder in Jackalope's data
directory, offered in the sidebar and the Work project switcher until added, then listed
like any project. Jackalope never makes it a repository and refuses a data directory
inside one. Its composer offers no launchpad starters or Plan with me.

Project instructions (Project settings → Basics) reach every task agent natively at launch,
whatever started the work; a resumed agent session is not given them again, and a prompt
that already contains them (scheduled and remote tasks add them) does not repeat them.
Optional guidelines and tool selection remain inspectable. Project connection loading must
finish before dispatch. An explicitly
empty connection list stays empty through save/restore. Task setup opens existing
agent, project and connection controls without discarding the draft.

Connected work browses GitHub issues and pull requests, Linear issues and Jira Cloud
issues. Selecting one prepares an editable draft with its source link; it does not
start work or update the issue. GitHub uses the existing CLI sign-in. Linear and Jira
connections are tested before their tokens are saved in protected native storage.

### Jackalope context

Files Jackalope keeps for a project under its `.jackalope` folder reach agents without the
person committing, copying or pasting them (`commands/agent_context.rs`). After the
workspace is prepared, every attempt, including a continuation, copies into it the project's
`.jackalope/cloudflare.json` ([cloud resources](ORCHESTRATION-CAPABILITIES.md#cloud-resources))
and the pasted images under `.jackalope/attachments` that its prompt names (at most 16, 64 MB
in all), replacing an older or edited copy and removing a manifest the project no longer has.
The prompt's absolute paths to those images become workspace-relative. The attempt's
activity lists what it received. `/.jackalope/` is in the repository's `info/exclude`, so the
copies never appear in `git status`, task commits, swarm snapshots or integration; a path the
workspace's Git tracks (the person committed it) or does not ignore is left untouched. Work in
the project checkout itself needs no copy.

The launch input adds a Jackalope context section of at most 1,200 bytes naming each cloud
resource and binding, ending with "and N more" when they do not fit, and pointing to the file.
Project instructions, at most 4,000 characters, come before it. Writing to a context file is
a risky action, so automatic approval does not approve it, and the next attempt restores the
file anyway. On a project's computer the context is uploaded with the workspace, and changes
the agent made to it are left out of what comes back (see
[bot computers](BOT-COMPUTERS.md#agents-on-a-computer)). Screenshots and other output
the agent saves under `.jackalope/artifacts` come back and stay out of commits.
`cargo test --lib agent_context` covers placement, refresh, the committed-file case, Git
exclusion, the computer archive, patches from a computer and the launch summary's budget.

## Work and results

Work combines conversations, tasks and plans, defaults to the selected project and offers an explicit All work scope.
The work list and project sidebar share discovery without duplicate attempts. Needs-input/recovery
and failed-check work precede results ready for review, active work, saved ideas and
finished work. Integration state comes from native verified receipts. Filters, search
and list/board choices persist per scope and mode. Work rows show the assigned agent character,
live or next-action status and the next useful action. Active and waiting work also
appear in a compact in-progress strip. Arrow keys, Home and End move between visible
work rows; command search also finds projects, tasks, sessions and current-task actions.
Parallel planning remains inside Work with the existing ownership and dependency
contracts; plans stay editable before dispatch.

After 15 minutes without focus or input in any Jackalope window, the next return opens
Since you left above the work list. It is built locally from recorded attempts, checks,
questions and captures, with no model call, and stays hidden when nothing changed since
the person left. It leads with one line naming what waits on them, then one line per item
that finished or failed meanwhile (screenshot results first, at most six; items opened
since they changed are left out), then every Needs you item as its own card: the decision,
what it changes, recorded evidence and a low, medium, high or unknown risk. A suggested next
step appears only when the record supports it, such as passing checks on a finished
result. Dismissing it lasts until the next absence; the last-present time is shared by
all windows in local storage.

The Work page keeps projects and their work in a collapsible sidebar and opens task review beside
the conversation on wide windows, or at full width on narrower ones. Other tool tabs can retain the conversation, including terminals and
activity. The work list offers list and board views; New work opens its composer
explicitly once a project has work. Questions and Stop remain available with the
sidebar collapsed. The composer options menu holds session limits, workflow starters
and saved project context. The last task or
session section persists across navigation. Project setup covers project, agents and an
optional first task; decisions, behavior and appearance use editable defaults.
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
For an iOS app, Preview builds and runs the app in the task's own Simulator with a live,
tappable screen, and review screenshots come from the Simulator; see
[iOS development](IOS-DEVELOPMENT.md#simulator-previews-and-review-captures).

HTTP(S) result links open through the OS browser in desktop. Other schemes are
not executed. Copy result reports clipboard failures. Screenshots still use the
native bounded evidence reader and cannot claim current visual acceptance.

## Agent and Challenge review

Review offers two optional reviews by another agent. Both suggest an available
reviewer from a model family different from the author's (then an agent of unknown
family, then the same family); you can choose any connected agent. Families come from
the model when it names one, otherwise from the agent (`src/lib/reviewer-choice.ts`).
Both commit the author's current files, uncommitted work included, onto the task base
and start each reviewer in its own worktree at that commit (recorded as `challengeOf`
on the reviewer's attempt, with `kind` `review` or `challenge`), so reviewers never
touch the author's workspace. The author must be idle.

- **Agent review** in Review's toolbar starts one reviewer with
  `task_start_agent_review` on click. It skips the project's preparation command and
  is told to read the change without building, installing or running it. A dialog
  follows its steps and live activity; agent reviews stay out of the work list and
  notify on the reviewed attempt. The reviewer ends with a `jackalope-review` JSON
  block: a summary and findings with severity, file, line, problem and fix plan
  (`src/lib/agent-review.ts`). **Make these changes** continues the task with the
  selected findings, an optional note and, when the project has a verification
  command, a request to run it once at the end. Where the attempt can't continue
  directly, the same text is added to the reply instead. A reply without a readable
  block is shown in full and can be sent as is.
- **Challenge this change** in the actions menu starts one or two reviewers, each
  told to break the change. The intent it must hold to is the original request plus
  the author's result.

A Challenge reviewer reports each finding with `record_validation_step`: status
`failed`, the title as `step`, and a `finding` with the exact command, the output it
printed, the output the intent requires and why that breaks it. It also ends its
reply with the same list in a `jackalope-findings` JSON block, which Review reads for
agents without the tool. Only findings with both a command and its printed output
count; findings missing either are shown as a dropped count per reviewer. Review's
Checks section merges finished reviewers' findings, crediting every reviewer whose
finding shares a root cause (same command failing the same way, or matching
titles), says "No proven findings" when there are none, and shows the reply of a
reviewer that reported in neither form.

**Run again** runs a finding's command only on click, and only a command that
reviewer reported. Jackalope commits the reviewer's files (the reviewed snapshot
plus its repro scripts) to a detached worktree under the integrations directory,
copies the project's setup files, runs the saved setup command, then runs the
command with a check slot, workspace reservation and the project-check stall and
time limits, and removes the worktree. The reviewer must be idle and its workspace
must still exist. **Send to the author** adds the selected findings, with their
commands, output and the reviewer's workspace path, to the follow-up draft; it
never sends.

## Turn advisor

**Turn advisor** in Project settings (off by default, stored as `advisor` in the project's
plan settings) has another agent read every task attempt that ends with a result
(`commands/turn_advisor.rs`). Conversations, planning and decider attempts, agent and
Challenge reviewers, archived attempts, attempts of managed tasks (planners, assignments,
their follow-ups and delivery repairs, which have their own checks and review) and
attempts already loaded from history when Jackalope starts are never advised. Only agents
with a tool-free helper mode can advise: Claude Code, Codex, Grok, Kimi and OpenCode. The
advisor is chosen among those like the Autonomy decider's Automatic choice, preferring
another model family than the working agent and otherwise the same one, and uses the
account that project would bind for it. It runs as a one-shot helper turn with tools
off and shares the three decider slots. Its brief holds the task's first request, this
turn's instruction, the reply, the project check and agent-recorded checks, and the
workspace diff since the task base (bounded), each in a code fence longer than any
backtick run inside it and marked as untrusted data, plus the notes the previous review
sent the agent. Stopping or archiving the task, or quitting Jackalope, ends a review in
progress and its agent process.

The advisor returns up to `maxNotes` (default 3, 1–5) notes graded aside, concern or
blocker. Jackalope flattens each note to one line, drops unknown grades, empty or
content-free notes ("looks good", "no issues") and duplicates, and keeps the most
serious first. Asides are shown only to
the person. Concerns and blockers go to the working agent as a queued follow-up starting
`Advisor notes from <agent>`, which tells it the notes are another agent's opinion and
asks it to explain any it disagrees with. When the task has already moved on, they arrive
as a direct message only if a newer attempt is running to read it. They stay with the
person, with the reason, when the follow-up cannot be queued (for example the task was
merged) and nothing is running, when the task was stopped or archived, after two advisor
follow-ups in a row, or when they repeat notes the previous advisor follow-up already
carried.

A turn is not advised, and the attempt records why, after `maxReviews` (default 10, 1–50)
reviews on that task (a review counts once the advisor replied; one that failed earlier,
such as an agent that could not start, does not), when the attempt hit its account's usage limit, when the
advisor's account has under 15% of any quota window left, when every execution slot is
busy, when no installed agent can advise, or when no decider slot frees within a minute.
The review, its notes, delivery, reason and the advisor turn's own usage are saved on the
attempt as `advisor`; a review interrupted by a restart is marked failed. The task's
Result tab shows the notes under each attempt's reply, separating those sent to the
agent from those only for the person.

## Preparation and verification

A project's optional preparation command authorizes a bounded, cancellable command
in each new task workspace before its agent starts. Continuations skip preparation.
Preparation failure retains workspace/history and its recorded command output.

Non-code work runs in the project folder as it is, on whatever branch is checked out:
no worktree, branch change, setup files, preparation or automatic checks. It does not
reserve the checkout, so in-place work is not held up by it, and a continuation stays
in the folder its conversation started in. Its attempts report no change counts and add
no changed files to Library.

Preparation and verification commands are bounded by silence rather than by total
runtime: a command is stopped when it produces no output for its stall budget, so a
slow command that keeps reporting progress is allowed to finish. Both are still
capped by an overall ceiling. The recorded outcome distinguishes a command that was
stopped for going quiet, one stopped at the ceiling, and one that exited with a
failing status, and the task's error repeats that distinction. The defaults are five
quiet minutes for preparation, ten for checks and 30 minutes in total. Time limits in
Project settings override each one (quiet limits 1–60 minutes, total 5–120 minutes);
they are mirrored to the native project registry, an attempt keeps the values it
started with (`TaskRun.timeLimits`), and combined checks and challenge reruns use the
attempt's values. For a project with an `.xcodeproj` or `.xcworkspace` at its top level
or one folder down, Project settings suggest 15 and 20 quiet minutes and 60 in total
until the person saves their own values; nothing changes until they accept. Bridge
calls wait long enough for the longest allowed check.

A workspace records the dependency manifests its preparation command completed
against. When a later attempt finds those manifests unchanged, preparation is
skipped and reported as skipped rather than run again. A preparation command that
was stopped mid-progress is retried once automatically; a command that ran and
reported a failing status is not repeated.

Before preparing a new isolated worktree, Jackalope clones the installed folders the
project checkout has beside their manifests into the same place, but only when both
checkouts' dependency manifests fingerprint the same for the preparation command:

| Manifest | Folder | Kept only when |
| --- | --- | --- |
| `package.json` | `node_modules` | Tool caches (`.cache`, `.vite`) are dropped |
| `Podfile.lock` | `Pods` | `Pods/Manifest.lock` matches the checkout's `Podfile.lock`, and no generated project, configuration or script file names the checkout's path |
| `Cartfile.resolved` | `Carthage/Build` | The general rules below hold |
| `Package.resolved` beside `Package.swift` | `.build` (resolution only) | Every dependency is remote and each absolute path in SwiftPM's state lies inside the folder |

Clones are copy-on-write (`clonefile` on APFS, `FICLONE` on Btrfs or XFS); a volume or
platform that cannot clone, including Windows, gets no copy and the command installs in
full. Existing folders and linked paths are never used. A clone is removed when a link
inside it points into the project checkout or resolves outside the worktree, or when it
holds a `pyvenv.cfg` or `CMakeCache.txt`. For a Swift package only `checkouts`,
`repositories`, `artifacts`, `prebuilts` and `workspace-state.json` are cloned, never
build products, and the absolute repository paths SwiftPM records (each checkout's Git
alternates and `origin`, prebuilt and artifact paths) are rewritten for the new place.
Python environments and Cargo `target/` are not cloned. The preparation command still
runs, so it brings the clone current (pnpm also rewrites its `.bin` shims for the new path).

The fingerprint also covers `Podfile`, `Package.swift`, `Package.resolved` (including the
ones inside `.xcodeproj` and `.xcworkspace` bundles), `project.yml`, `.xcode-version` and
`DEVELOPER_DIR`, and the walk skips `Pods`, `DerivedData`, `.build`, `SourcePackages` and
`Carthage`. A marker stays valid only while every installed folder it recorded
(`node_modules`, `.venv`, `venv`, `Pods`, `Carthage/Build`, `.build`,
`.jackalope/DerivedData/SourcePackages`) still exists.

Preparation, checks, disposable check worktrees and agents on this device get
`JACKALOPE_DERIVED_DATA` (`<workspace>/.jackalope/DerivedData`) and `JACKALOPE_SPM_CACHE`
(its `SourcePackages` folder); `.jackalope/` is excluded from Git in every task workspace.
Swift package checkouts for Xcode projects are seeded into new worktrees from snapshots
whether or not a preparation command is set; see
[iOS development](IOS-DEVELOPMENT.md#workspaces-and-build-caches).

Automatic verification is on for a project unless Check results automatically is turned
off in Project settings, and does nothing until the project has a check command. Every
launcher and the settings switch read it through `checksAutomatically`. Its saved command
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
otherwise a fresh worktree is cut and the earlier one is kept for inspection. The
exception is an attempt a provider quota stopped: its uncommitted changes carry over
with quota handoff progress context and the person's optional focus line.

An interrupted attempt keeps its workspace until the person resumes it. Resume lists
processes still running in the workspace (on macOS and Linux) so anything the attempt
started outside its own process group, such as a dev server, can be stopped first.
Confirming records the attempt as stopped, then continues its agent session with a
note that Jackalope restarted, or retries it when no session was recorded.

## Conversations from outside Jackalope

Claude Code and Codex keep each conversation in their own session files: Claude Code under
`projects/` of its configuration directory, Codex as rollouts under `sessions/` and
`archived_sessions/` of its home (compressed once idle). Jackalope reads the stores of the
accounts it uses for each CLI (the CLI's own sign-in and any added accounts) and lists a
conversation under a project when it ran in the project folder or a worktree of the same
repository, in a read-only Outside Jackalope group. Its own attempts are left out by the
session IDs they recorded, by its data folder and by the `.worktrees/<name>` folders on
`jackalope/<name>` branches it creates. A background index keyed by file path, modification
time and size reads only new and changed files and skips lines and files it does not
recognize; a file watch and periodic refresh keep it current. Opening one shows its
transcript with tool names; subagent work is not shown. Reading is local and nothing is
uploaded; Settings → Privacy turns it off and deletes the index.

Continue in Jackalope starts a conversation whose first attempt resumes the CLI's own
session (`codex exec resume`, `claude --resume`) under the account directory it was saved
in, directly in the checkout or worktree it ran in, reserving that folder like in-place
work. It is unavailable, with the reason shown, when that directory is not one of
Jackalope's accounts for the CLI, the account or agent is turned off for the project, the
folder is gone, the conversation started in a subfolder, or the project runs agents on a
computer. Its changes stay in that folder: merge review and retry refuse it, and follow-ups
continue in the conversation.

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

A pull request opened from Delivery, or found on the task branch by its GitHub check, is
followed per task in renderer storage (`stores/pullRequestStore.ts`) and re-read through
`task_pull_request_status` on a schedule until it merges or closes. `lib/pull-requests.ts`
reduces GitHub's record to one state, most blocking first: failed checks, requested
changes, conflict, checks running, draft, waiting for review, ready to merge, merged or
closed. That state places finished work in the work list (Needs you, In review, Ready to
merge or Finished) and never moves work that is running, blocked on a question or failed
on its own. A failed read keeps the last state and says so. Fix requests are editable
follow-ups in the task's own composer; pushing an update and merging on GitHub each need
their own confirmation, and no state change sends, pushes or merges by itself.

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
