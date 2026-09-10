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
from saved user feedback and repository evidence; it does not rewrite repository
instructions or make background model calls.

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

## Automatic lessons and findings

Project context and Performance & insights refresh automatic lessons when opened.
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

Performance & insights shows actual saved review corrections, unsuccessful checks,
quota handoffs, lesson sources and task links. Acceptance counts explicit final
outcome decisions on the latest loaded attempt of each task. A finished process or
marking a task reviewed without outcomes never implies acceptance. Accepted final
requirements must refer to one saved file snapshot. Records may be stale relative
to current files. The page states loaded-history coverage and decision denominators.

With at least three decided tasks in each group, the page compares recorded
acceptance with and without saved context. These are observational counts for
different tasks, not evidence of causal quality improvement. Duration excludes
active and mixed-agent handoff attempts. The page does not invent time or token
savings, monetary estimates, agent specialties, or generalized recommendations.

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
Saved ideas preserve the workflow selection and skipped-lesson settings.

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

`commands/monitors.rs` owns bounded, read-only Git observations and diffs.
`commands/schedules.rs` owns timing, persisted observations/notices and guarded
dispatch. There is no arbitrary background shell runner or new model provider.
Existing data remains readable through optional/defaulted fields. These features
remain local; remote workers, semantic retrieval and automatic skill generation
are separate possible extensions.
