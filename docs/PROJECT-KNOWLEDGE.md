# Project knowledge and local monitors

Jackalope keeps reviewed lessons, reusable procedures and local change observations
with the project, independently of the selected agent. Saving, searching, matching,
checking Git content and inspecting a monitor diff make no model calls. Selected
context consumes ordinary agent input tokens when a task starts; the app reports
its byte size rather than inventing token savings.

## Project setup defaults

Repository context gathering fills unset preparation, verification and target-branch
preferences. Common setup/check commands come from bounded reads of project docs
and manifests. The target prefers a locally available origin default branch, then
main/master/trunk/develop, then the current branch. Detached repositories without a
suitable local branch stay unset. Detection does not run commands or enable
automatic verification. Saved edits, including empty fields, take precedence on
rescans. Pending setup applies discoveries when the project is registered;
cancelling setup does not register a project.

## Lessons

Open **Project → Context → Add lesson**, or choose **Save lesson** on a reviewed
task. Write one concise fact or decision and the words or phrases that should
match future task instructions. Task-derived entries retain a link to the source
attempt. Manual entries stay under your control. Jackalope also derives bounded local lessons
from saved user feedback and repository evidence, and keeps
[learned lessons](#learned-lessons) from conversations and finished work. It does not
rewrite repository instructions or make background model calls unless you turn on
[lesson export or agent reflection](#optional-extensions) for a project.

The composer previews matching lessons under **Saved project context**. Skip an
individual lesson or disable matching for that task. The native launcher applies
the same selection for supported agents, manual tasks, queues and schedules.
Matching ignores case and punctuation, prioritizes the number of matching phrases,
and uses stable identifiers to break ties. At most three lessons of 800 bytes each
are included. Duplicate or already-supplied lesson content is omitted.

Use Project → Context to edit, pause or remove entries. Changes affect future
tasks. Each attempt retains the exact entry revisions and text originally supplied;
continuations reuse their original agent session without reappending this context.
The library reports how many distinct tasks used an entry. These are usage counts,
not an assertion that the lesson caused a successful outcome.

**Find a decision in past tasks** searches this project's saved instructions and
results locally. It returns up to ten recent matches and opens their source tasks.
It does not search private CLI histories or infer unsaved preferences.

## Automatic lessons

Project context refreshes automatic lessons when opened.
Review decisions refresh them immediately, and new tasks refresh them before
selecting context, including native queues and schedules. Composer previews reuse
a scan for up to 30 seconds. Continuations keep their original frozen context.
Task-level **Use matching project lessons** still disables all lesson injection.

The local extractor records:

- Standalone user statements beginning with **Always**, **Never** or **Prefer**,
  including text answers. It excludes agent results, assembled guideline sections,
  fenced code, transient instructions and common credential-bearing text. These
  are quoted historical preferences, not inferred permissions or universal rules.
- Concise freeform adjustments from reviewed follow-up attempts whose objective
  differs from the loaded original task, quoted as historical task-specific requests. These require at least two matching words
  before reuse and are never relabeled as standing user preferences.
- Requested corrections from explicit outcome reviews, tied to the requirement,
  source attempt and review time. A correction is historical feedback, not proof
  that a defect remains in current files.
- Verification commands with successful saved snapshots in at least two distinct
  reviewed tasks. Repeated attempts of one task do not establish a pattern.
- Declared package manager and check scripts in package.json, supported tooling
  files, and test filename conventions observed in at least three files. Discovery
  never runs these commands or claims their checks passed.

Every automatic lesson shows source evidence, matching words and whether it is
available, paused or edited by you. Changed repository declarations refresh their
lesson revision; disappearing declarations pause the old lesson. User edits are
never overwritten. Removing an automatic lesson clears its text and retains a
suppression identifier so the next scan cannot recreate it. Existing task receipts
retain the original supplied context, as they do for manual lessons.

Extraction inspects up to 200 recent matching attempts, including up to 100 recent
archived attempts. Test-pattern discovery examines at most 2,000 directory entries,
up to eight levels deep, respecting ignore files and excluding dependency/build
folders. It does not follow directory symlinks. Manifest reads are capped at
256 KB and must resolve inside the project. The ordinary 100-per-project and
500-per-profile knowledge limits also bound automatic entries and suppression
records. Older observations remain historical; these bounds are not a complete
semantic analysis of every repository or every user action.

## Learned lessons

With **Learn automatically** on (the default, per project in Project settings or
the terminal's `/settings`), Jackalope reflects on work in the background: each time
a running task reports another 50 tool calls (25, 50, 100 or 200 in Project
settings) and when a task or conversation turn ends. `/learn` runs the same
reflection on demand over a conversation since its previous `/learn`, whether or not
the setting is on. Reflection is local and deterministic; it adds no model calls and
never blocks, slows or fails the task. Failures are logged and skipped. The optional
[agent reflection](#optional-extensions) is the only learning step that calls a model.

Reflection reads only what the person wrote (a task's objective, or the messages sent
in that conversation turn), their typed answers to agent questions, and check
commands that passed. It never reads agent output or messages from bots and
wake-ups. From these it proposes:

- **Add**: a new preference (**Always**, **Never**, **Prefer**, **Use**, **Avoid**,
  **Make sure** and similar), correction (**instead of**, **Correction:**),
  clarification or verified check command.
- **Merge**: the same lesson seen again; the new source is recorded as evidence.
- **Patch**: a newer instruction about the same subject with the opposite intent
  (for example **Never** after **Always**) rewrites the older lesson instead of
  adding a rival.
- **Retire**: **No longer…**, **Stop using…** or **…anymore** archives the matching
  lesson.

A single promotion gate applies proposals. It refuses statements that look like they
contain a credential, token, key, private key or email address (rather than saving
them redacted), lessons outside 15–500 characters or without a matching phrase,
duplicates of existing content, and additions that contradict a hand-written lesson.
It adds at most five lessons per reflection. Merge, patch, retire and automatic
archiving only ever change lessons Jackalope learned and nobody has edited; manual
lessons, edited lessons, older automatic lessons and `AGENTS.md` are never changed.
Editing a learned lesson makes it yours. Removing one keeps a suppression record so
it is not learned again.

New lessons are on probation (shown as **New**) until they are supplied to two
distinct tasks, then become **Active**. Each new task that selects saved context is an
opportunity for every available learned lesson in the project. A lesson on probation
never supplied in 30 opportunities, or any lesson not supplied in the last 100, is
archived. A project keeps at
most 40 available learned lessons; adding another archives the least used first.
Archiving never deletes: **Restore** in Project → Context or `/learnings` returns a
lesson to probation with fresh counts, and turning an archived lesson back on in its
editor does the same. With automatic learning off, deliveries are still counted but
nothing is archived for lack of use. Use counts record that a lesson was supplied,
not that it caused a better result.

Every change is appended to a per-project history: learned, seen again, updated,
retired, now active, archived, restored, folded, edited or removed, with the reason and a
redacted excerpt of the source (emails, tokens, keys, credential URLs and the home
folder are replaced). Open **History** on a learned lesson in Project → Context, or
choose it in `/learnings`.

### Curator

While automatic learning is on, the background thread also curates each project it
has reflected on: once after the app starts learning there, again after 10 lesson
changes, and at least daily while the project is active. A pass compares the
statements of available lessons Jackalope wrote and nobody edited, of the same kind
and with the same intent (an **Always** never folds into a **Never**). Two lessons
whose meaningful words overlap by at least 75% become one: the most used (then the
oldest) keeps the other's matching phrases and evidence references, and the other is
archived as folded into a similar lesson. Each pass folds at most five lessons, makes
no model calls and records both sides in the history. **Restore** undoes a fold, and a
restored lesson is never folded again. Check commands are never folded.

### Thresholds and activity

Every tunable lives in `Thresholds` (`THRESHOLDS`) in
`commands/knowledge/learning.rs`; there are no per-project overrides.

| Threshold | Default |
| --- | --- |
| Deliveries that end probation | 2 |
| Opportunities before an unused lesson on probation is archived | 30 |
| Opportunities since the last delivery before a lesson is archived | 100 |
| Available learned lessons per project | 40 |
| Lessons added per reflection | 5 |
| Folds per curator pass | 5 |
| Lesson changes that make a curator pass due | 10 |
| Longest gap between passes of an active project | 24 hours |
| Word overlap at which lessons fold | 75% |
| Agent reflections per hour and per day, all projects | 4 and 20 |
| Agent reflection time limit | 45 seconds |
| Redacted words one agent reflection reads | 6,000 bytes |

The reflection cadence stays a per-project setting. **Learning activity** in Project →
Context shows this computer's counts for the project: lessons that are new, active and
archived, how often current lessons were supplied, and, from the retained history, how
many were learned, suggested by an agent, became active, archived, folded, retired and
restored. History rotation bounds the counts; the date shows the oldest record. Use
them to tell whether lessons are learned too eagerly or archived too soon before
changing a default.

### Optional extensions

These are per-project settings in Project settings and the terminal's `/settings`.
All are off by default except sync inclusion, which only applies once lesson sync is
on for the desktop.

**Reflect with an agent** also shows finished work to the project's default agent
(the routing agent and account configured in Agents) once the task or conversation
turn ends. The agent receives the person's redacted words from that work, up to
6,000 bytes, and the statements of the project's learned lessons, runs without tools,
and may propose the same add, merge, patch and retire changes. Its proposals pass the
same promotion gate and are recorded with the origin `agent`; it can only target
lessons Jackalope wrote. Each call is a short request on that agent account's quota,
limited to four an hour and twenty a day across projects and stopped after 45
seconds. Unavailable agents, quota errors, timeouts and malformed answers are logged
and skipped; they never affect the task.

**Write lessons to AGENTS.md** mirrors the project's active learned lessons, one line
each, into a section of the project folder's `AGENTS.md` between
`<!-- jackalope:lessons:start -->` and `<!-- jackalope:lessons:end -->`, and into
`.claude/skills/jackalope-lessons/SKILL.md` for Claude Code. Text outside the markers
is never changed; the file is created when missing and keeps its line endings.
Jackalope refuses to write when the markers are unmatched, out of order or repeated, or
when the skill file exists without its managed marker. Writes are atomic and happen
in the background shortly after lessons or settings change. Lessons on probation or
archived, and lessons whose text looks sensitive, are left out. Turning the setting
off, or having no active lessons, removes the section (and an `AGENTS.md` that held
nothing else) and the skill. Jackalope never stages or commits these files. They are
written to the registered project folder only; isolated worktrees created from a
commit see them only after you commit them, and running agents read them as their own
CLI does.

**Sync learned lessons** includes the project in [account lesson sync](SETTINGS-SYNC.md#learned-lessons)
when it is turned on for this desktop; turn it off to keep a project's lessons here.

## Workflows

Choose **Save workflow** on a reviewed task to start an editable draft from its
instructions and saved verification command. Remove details specific to the old
task and describe the repeatable procedure, required tools and checks. Add a
workflow directly in Project → Context, or import a concise Markdown file. Copy
Markdown to reuse its text elsewhere. Import reviews the text before saving;
it does not install scripts, resolve external references or grant tool access.

Select one workflow in the task composer or schedule editor. The task's own
instruction remains the objective; the workflow supplements it. A workflow is
limited to 6,000 bytes and never selected automatically. Missing or paused selected
workflows block launch with an actionable error. Agent, account, connections and
verification permissions remain controlled by the existing project/task settings.
Saved drafts preserve the workflow selection and skipped-lesson settings.

## Local change monitors

In **Tasks → Recurring → New schedule**, choose a run policy:

- **Run an agent every time** preserves ordinary scheduled execution.
- **Run an agent only after code changes** checks locally first and launches the
  saved agent task only when the watched committed content changes.
- **Notify about code changes** records and reports changes without an agent.

Watch the whole saved local target branch, or a tracked file/directory relative to
the project. These checks use Git content objects; they exclude uncommitted edits
and do not fetch from remotes. The first check records a baseline without launching
an agent. Later deletion/recreation of the watched path is a content change;
a missing branch or failed read is an error, never a healthy unchanged check.

The row shows local check counts and quiet (baseline or unchanged) checks. Change/failure
notices remain available after later quiet checks. **Inspect change** reads the
recorded content revisions locally, with a bounded diff preview. Agent tasks also
retain the trigger and receive its before/after revisions. They still start from
the current target branch, which may have advanced since the observation.

Enabling a schedule authorizes its saved policy. New definitions start paused.
Existing overlap, capacity, account binding, missed-run policy, review and process
ownership rules apply to agent starts. A failed or interrupted dispatch is not
retried merely because the content is unchanged. Pausing stops future checks and
starts; use ordinary task Stop for an already running agent. Jackalope must remain
open (the tray is sufficient), and the computer must be awake.

Changing a monitor's project, target, path or action resets its baseline and check
counters. Existing occurrence history is retained, bounded to 200 records plus
the latest notice. Every consumed change/reservation is saved before launch.

## Ownership and limits

`commands/knowledge.rs` owns bounded atomic storage in the native profile's
`task-runs-v1/knowledge/entries.json`. Entries are scoped by project ID and canonical
folder, with optimistic revisions for edits and deletion. Corrupt files are
preserved and surfaced; mutations never silently replace unreadable knowledge.
The store allows 100 entries per project and 500 per profile. Task journals own
the context receipts; summary polling omits their content bodies.

`commands/knowledge/learning.rs` owns reflection, the promotion gate, the thresholds
and the lessons' lifecycle; `learning/curate.rs`, `learning/agent.rs`,
`learning/export.rs` and `learning/sync.rs` own the curator, agent reflection, export
and the sync data model. Learned lessons keep their status and use counts under the
entry's `automatic.lifecycle`; entries saved before it existed load unchanged. Learned
ids derive from the project ID and the lesson, not the folder; project IDs belong to
one installation, so sync matches projects by repository instead. History is
append-only JSON Lines in `task-runs-v1/knowledge/ledger/`, one file per project; past
1 MB the file is moved aside, replacing the previous one, so two files are kept.
Evidence excerpts live only there, apart from the entry, and never sync. Lessons stay
in the local profile unless lesson sync is turned on.

`commands/monitors.rs` owns bounded, read-only Git observations and diffs.
`commands/schedules.rs` owns timing, persisted observations/notices and guarded
dispatch. There is no arbitrary background shell runner or new model provider.
Existing data remains readable through optional/defaulted fields. Apart from opt-in
lesson sync, agent reflection and export, these features remain local; remote workers
and semantic retrieval are separate possible extensions.
