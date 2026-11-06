# Plan mode

Plan mode is an explicit way to start work: a read-only planning interview, or a plan the
person writes, produces one self-contained plan, the person approves an exact revision,
and Jackalope runs it as one agent, planned subtasks or a swarm. It never replaces the
default task flow. This guide covers the plan document, storage, the interview limits,
approval and hand-off contracts.
Agent coordination contracts are in [orchestration](ORCHESTRATION-CAPABILITIES.md); the
terminal commands are in [terminal command](CLI.md#plan-mode).

## Starting a plan

- App: **Plan with me** in the Work composer's Options menu, and beside the choices
  when a task assessment suggests a plan or investigation, starts the interview.
  **Write the plan myself** on Feature work opens a form instead.
- Terminal: `/plan <goal>` in a conversation, or `jackalope plan "<goal>"`.

A written plan skips the interview. Its tasks (title, instructions, files or folders and
the earlier tasks each starts after) become the plan's tasks, keyed `task-1`, `task-2`
and so on, and each task's outcomes become manual acceptance criteria that task covers.
A plan without outcomes gets one criterion from its goal, covered by every task. It is
saved as revision 1 by `you`, as a draft, and opens on the Plans page for the same
review, editing, approval, hand-off and tracking as a drafted plan. Unfinished drafts of
the earlier feature planner open in this form.

Planning runs with the task's agent, or the project's planning agent when one is set. The
attempt runs in its own worktree and is told it is read-only. Codex runs with a read-only
sandbox; Claude Code runs without its edit tools. Other agents are constrained by the
prompt and the throwaway worktree; anything they change there is never integrated.

## The interview

The planner reads the repository and project lessons first, scores eight coverage areas
(scope, behaviour and UX, data and contracts, integrations, edge and failure cases,
non-functional, constraints and out of scope, done signals) as Clear, Partial or Missing,
then sorts each open point before asking anything:

- A **fact question** has an answer it can observe: what the code does, where something
  lives, its output, timing or layout, whether a test or setting exists. The planner
  answers it by reading files or running a read-only command in its discarded workspace,
  and records it as a checked assumption with its evidence (see the plan document).
- A **preference question** is a product, scope or taste decision only the person can
  make. Only these are asked: one at a time through `ask_user`, recommended option first.

Questions can carry an optional header, recommended option, multi-select flag,
allow-other flag, rationale and `why_ask`; prompts saved without them load unchanged.
A planning question must give `why_ask`, one short sentence on why checking cannot settle
it, which the app and terminal show under the question. A planning question without it
returns `{"status":"not_asked","message":...}` telling the planner to check the fact itself
or ask again with a reason; it does not reach the person or count toward the cap.

Jackalope enforces the limits at the bridge. A planning attempt may forward at most the
project's question cap (default 5, 0–12) across all of a plan's attempts. Choice questions
gain **Use your recommendations for the rest** and **Done, draft the plan**; choosing
either, or typing `done`, closes the interview. A closed or capped question returns
`{"status":"closed","message":...}` instead of reaching the person, telling the planner to
record its recommended choices as assumptions. Unanswered questions and elapsed time never
answer, close or approve anything. Earlier running or finished plans in the project
(title, assumptions and surprises, at most three, within 3,000 characters) are supplied as
untrusted notes.

## The plan document

One Markdown document with front matter and fixed sections. The planner returns it as
its final message; a preamble or a `markdown` fence around it is ignored.

```markdown
---
id: <plan id>
project: <project id>
revision: 3
status: draft | approved | running | done
sourceHead: <commit>
approvedBy: <git user.name (app|terminal)>
approvedAt: <RFC 3339>
shape: single | subtasks | swarm
recommendedShape: subtasks
shapeReason: Two independent files
workers: 2
---

# Short objective title

## Goal
## Context
## Clarifications
Coverage: Scope Clear · Done signals Partial
- Q: Which delimiter?
  A: Comma
## Assumptions
- Checked: Reports render in src/report.ts — evidence: src/report.ts:12
- Exports stay under 10,000 rows
## Out of scope
## Approach & Interfaces
## Tasks
### csv · Serialize reports
- scopes: src/csv.ts
- dependsOn: none
- parallel: yes
- covers: AC-1
- status: done            (only when a re-plan keeps a finished task)

Briefing for the implementer.
## Acceptance criteria
- AC-1 [test: pnpm test csv] WHEN a cell has quotes THEN they are escaped
- AC-2 [manual] The button downloads a file
## Risks
## Decision log
## Surprises
```

Validation: a title up to 160 characters, a Goal, 1–24 tasks with unique keys (letters,
digits, `-`, `_`) and at least one scope, 1–12 criteria with unique IDs and 1–480
characters, and every `dependsOn` and `covers` reference resolving. Planned subtasks
run at most 8 tasks; a larger plan defaults to, and runs as, a swarm. Verify tags are
`command` or `test` (optionally `: <exact command>`), `browser` or `manual`; an untagged
criterion is manual. Bullet sections render `- None` when empty.

An assumption that starts with `Checked:` is a fact the planner confirmed, followed by
`evidence:` and the file and line, or the command and what it printed. Every other
assumption is a choice the planner made without an answer. The marker is part of the
bullet text, so a person edits, adds or removes checked assumptions like any other line,
and plans saved before it existed parse, render and hash unchanged. The plan view lists
checked assumptions as **Checked** with their evidence and the rest as **Assumed**; the
approval gate asks the person to review only the assumed ones. The terminal marks
checked assumptions with ✓ and assumed ones with !.

The revision hash is the SHA-256 of the rendered document without front matter, so
recording an approval or status does not change what was approved. Section changes
between any two revisions are reported section by section (added, removed, changed).

## Storage and export

Plans live in app storage under `task-runs-v1/plans/<plan id>.json`, one record per plan
with every revision, its author (`planner`, `you` or `amendment`), approval, execution
link and deviations. Records are written atomically; an unreadable record is quarantined
as `<id>.json.corrupt` and reported in the plan list rather than overwritten. Per-project
settings are in `plans/settings.json`: `questionCap`, `plannerAgent`, `plannerModel`,
`exportPath` (default `docs/plans/{slug}.md`), `maxRounds` (swarm rounds, default 5,
1–20), `askBeforeRounds` (default false), `orchestrators` (1–4, default 1) and `decide`
(see [agent decisions](#agent-decisions)). Missing fields take their defaults. They
are edited under **Planning** and **Autonomy** in Project settings (the Plans page links
there); the terminal's `/settings` changes the question limit and planning agent.

**Save to repo** writes the current revision to the export path inside the project. The
path must be relative, end in `.md` and stay inside the project; symbolic links are
refused. Nothing is staged or committed.

## Approval and hand-off

A project whose repository has no commits gets its first one when a plan starts or is
approved, and a project folder that is in no repository becomes one, so worktrees have a
commit to branch from. The commit uses the person's Git identity and the message
"Initial commit", honors `.gitignore` and always leaves out `.env` files, `*.pem`, `*.key`
and SSH keys. Without a Git identity nothing is changed and approval reports how to set
one. An isolated task started in a repository without commits gets the same first commit;
a plain folder stays a plain folder for ordinary tasks. The next attempt started in the
project records the commit in its activity; the explicit **Create first commit** in
project settings still works.

Approval is one explicit call naming the revision number and hash the person reviewed;
a changed plan, a running planner, a done plan, planned subtasks with more than 8 open
tasks, or a swarm with more open tasks than one round may run is refused. The app approves with the project's current check, prepare command and setup
files; the terminal uses the copy the app mirrors into the native project registry
(`preferences/projects.json`: `verifyCommand`, `autoVerify`, `prepareCommand`,
`setupFiles`). The work is verified with the first of:

| Verification | When | Effect |
| --- | --- | --- |
| `project` | The project has a saved check | Each task and the combined result run it |
| `criteria` | No saved check, but `command` or `test` criteria name exact commands | Those commands, joined with `&&` (deduplicated, at most 4,000 characters), are the check |
| `review` | Neither | No check gate: results are reviewed but not test-verified |

The approval gate says which applies. Without any check the app shows "No automatic
check: results are reviewed but not test-verified" with a field that saves a check
command to Project settings, and the terminal shows the same note with a hint. Approval
records the hash, the target branch head, the approver and the verification. Editing
the plan or asking the planner for changes creates a new draft revision that needs its
own approval.

Every shape becomes a managed task linked to the plan revision (`plan` on the task). The
task's request is the self-contained plan, so each worker starts from a fresh context:

| Shape | Assignments |
| --- | --- |
| single | One assignment covering every remaining task and all criteria |
| subtasks | One assignment per remaining task, with its scopes, dependencies, covered criteria as requirements and its briefing |
| swarm (beta) | The subtasks assignments as round 1, then further rounds (below) until an orchestrator finds every criterion met |

Assignments pass the same validation as planner-produced plans: limits, scopes inside the
repository, no overlapping independent ownership and no cycles. Each criterion becomes a
task requirement titled `AC-n: <text>`. Workers are told to run command and test criteria
and record them with `record_validation_step` using the criterion ID as the step name.

A plan always ends with an independent review, even for one assignment. Approving in the
app picks an available agent from another model family than the implementer, preferring
the planning agent among equals; the terminal uses the planning agent when it differs
from the implementing agent. Otherwise the implementer reviews its own work.
It checks the combined change against each criterion, classifies gaps as Critical, Major
or Minor, fixes Critical and Major gaps, and records a `Plan review` validation step after
its last edit: failed while Critical or Major gaps remain, with a `Fixed AC-n:` line for
each gap it fixed itself so result review shows which code only its author has seen. A
failed plan review is repaired like a failed check within the task's existing repair
limit. With a check, the combined result is not ready while Critical or Major gaps are
open; without one, it needs a passing review (below). Human acceptance of requirements
stays in result review.

A review-only plan (no check) is handled explicitly in managed delivery. Only an approved
plan may queue staged dependencies without a check. Dependent tasks start from a
predecessor that finished cleanly (no error), still pinned to that predecessor's exact
snapshot; repairs are started for open review gaps and unresolved interfaces rather than
failed checks; and the combined result is ready only after a `Plan review` step passed,
not merely when no gaps are open. Attempts that have a check keep every check gate.

## Swarm rounds (beta)

A swarm runs in rounds. Each round is a managed task with the same checks, agent and
independent review as planned subtasks. A round may run as many assignments as the
slots where the project's agents run (local concurrency, or the computer's concurrency
when the project's agents run on a computer), at least 8 and at most 24; other shapes
keep their limits. A connected swarm Worker still mirrors attempts but is not required.

When a round's combined result is merged, by the person in result review or by the
autonomy policy, Jackalope starts a read-only orchestrator attempt on the target branch
with the planning agent and no questions. It reviews the integrated tree against every
criterion, runs the project's check through `computer_verify` when the plan has one, and
returns one JSON verdict:

```json
{"verdict": "next", "summary": "…", "evidence": ["AC-1: …"],
 "assignments": [{"key": "…", "title": "…", "prompt": "…", "scopes": ["…"],
   "dependsOn": [], "covers": ["AC-2"], "briefing": "…"}]}
```

- `done` needs evidence and, with a check, a passing run of that check in the
  orchestrator's own attempt. The plan becomes `done`.
- `next` names the next round's assignments; their `covers` become requirements. They
  pass the usual assignment validation and may not own anything under `.jackalope`.
  The next round starts at once and is scheduled like the first, unless the plan asks
  first (below).
- A verdict that does not parse, a `done` without a passing check, or assignments that
  fail validation start one more orchestrator attempt told why; a second failure holds
  the round until the person resumes it.
- At the round limit (`maxRounds`), a `next` verdict is recorded with its assignments but
  not started, and the plan asks for a re-plan.

### Approving the next round

**Next swarm round** under Planning in Project settings chooses **Start automatically**
(the default) or **Ask me first** for new swarms; the Rounds section's **Next rounds**
choice changes it for one plan and applies from the next verdict. When a plan asks
first, a `next` verdict is saved as a proposal and nothing dispatches: the Rounds
section lists the proposed assignments with **Approve**, **Edit** and **Stop**, the
plan reads as needing you (`needsYou`) and raises the same "A plan needs your
decision" notification as a deviation. **Edit** changes each assignment's title,
instructions and scopes or removes it (dependencies on a removed assignment are
dropped); approved edits pass the same validation as the orchestrator's assignments.
**Stop** declines the proposal and holds the round; **Resume rounds** reviews it again.
A proposal is saved on the round, so it survives a restart and still waits for
approval; approving starts the round without a separate resume. The terminal approves
with `/rounds approve` or `jackalope plan rounds <id> approve`; editing happens in the
app. The phone companion does not show proposals.

With **Let agents approve swarm rounds** on, a proposal goes to a deciding agent instead
(see [agent decisions](#agent-decisions)) once the round passed a validator: the plan has
a check, the round's combined result is ready and merged, no assignment has an error, no
recorded check failed and the combined review's check passed. The proposal is saved and
the Rounds section says an agent is checking it; the person can still approve, edit or
stop it. An approval starts the round as the person's would. A failed validator, a
proposal that names protected paths or other escalated subjects, an unsure decider or the
decision limit leaves the proposal waiting with the usual notification and the reason.

### Several orchestrators

**Swarm orchestrators** (1 to 4, default 1) lets a round's review split into areas.
When the setting is above 1, the first review of each round partitions the plan's task
scopes into at most that many areas, grouped under the shallowest path prefix that
separates at least two of them and balanced by scope count; a plan whose scopes do not
separate is reviewed by one orchestrator as before. Each area gets its own read-only
orchestrator attempt, started together, told its area and scopes; each returns the same
JSON verdict, and a `done` still needs a passing run of the plan's check in that
attempt. An area whose verdict fails is retried once on its own and then holds the
round. When every area has a verdict, they combine without another agent:

- The round is `done` only when every area is `done`; evidence lines are prefixed with
  their area.
- Otherwise the areas' next assignments are merged in area order. Work two areas both
  named (same key or title with the same scopes) runs once, colliding keys get an area
  suffix with dependencies following the rename, and an assignment whose scopes overlap
  an earlier area's assignment depends on it. The merged list then follows the usual
  validation, approval and round limit; a merge that fails validation reviews every
  area again once before holding.

Each area's name, scopes, verdict and named work are saved on the round and shown under
it on the Progress tab and in the terminal's round line.

### Saved state and controls

Each round's verdict, summary, evidence, check result and next assignments are saved on
the plan's execution and shown on its Progress tab and in `jackalope plan show`. Pause,
Resume and Stop on the Rounds section act on the rounds and the current round's work;
Stop also stops every running orchestrator attempt of the round.
Dispatch starts paused after a restart: a round whose work was still running resumes
with its work, and a merged round waits for **Resume rounds**, which also restarts an
interrupted orchestrator attempt. Executions saved before rounds existed finish when
their result merges, as before; executions saved before approval and areas existed start
next rounds automatically with one orchestrator.

## Progress, deviations and re-planning

The plan view shows each task as waiting, running, checked, needs attention or merged,
and each criterion as unassessed, agent-claimed, check-passed, check-failed or
human-accepted. Human acceptance outranks a passing check, which outranks an agent claim.

A deviation is one of: an agent calling `plan_deviation`, changed files outside a task's
scope reported by the scope audit, or the combined result still failing after the allowed
repairs. A declared deviation pauses the plan's dispatch; running assignments continue.
The person chooses **Accept and amend** (the summary and amendment are appended to the
Decision log and Surprises as an amended revision, the approval moves to it and dispatch
resumes), **Redo** (the attempt is continued with the plan as written) or **Re-plan**.

With **Let agents handle plan deviations within scope** on, a deviation an agent declares
goes to a deciding agent first when every path its summary and amendment name lies inside
a task scope of the plan and the text is not about an escalated subject. Dispatch stays
paused while it decides. Acceptance amends the plan exactly like **Accept and amend**, with
the approval recorded as decided by that agent; otherwise the deviation waits for the
person with the reason. Deviations Jackalope detects itself (files outside a scope, a
result still failing after its repairs) always go to the person.

A pending deviation needs the person wherever they are. The app raises "A plan needs your
decision" as a desktop notification (when notifications are on and the window is not
focused) and as a companion notice; both open the plan. The plan list marks the plan
**Needs you** and the plan page shows a **Needs you** card with the three choices. In the
terminal the open plan turns the conversation amber: its tab dot, the window title and a
banner above the input that states the deviation and its proposed amendment. Enter on an
empty input, or `/deviation`, opens a picker with the three choices.

Re-planning continues the planning conversation with the current revision and the finished
tasks. Finished tasks are kept with `status: done` and are not assigned again; the new
revision needs approval, and approving it is refused while earlier assignments still run.

When the plan's work is merged (for a swarm, when the orchestrator declares it done) its
status becomes `done`, and accepted deviations and
criteria whose checks failed are sent once as reflection observations through the
learned-lesson promotion gate.

## Agent decisions

**Autonomy** in Project settings lets agents decide for the person on approved plans, so a
long build keeps moving. Each kind is off until turned on and is saved per project in
`plans/settings.json` under `decide`: `questions`, `rounds` and `deviations` (booleans),
`maxAgentDecisions` (default 50, 1–500, per plan execution) and `decider` (`auto` or an
agent ID). Settings saved before Autonomy existed load with everything off.

A committed `decide` section in `.jackalope/autonomy.json`, read from the target branch,
can only make these stricter (see
[orchestration](ORCHESTRATION-CAPABILITIES.md#ownership-and-interface-decisions)): `person` turns a
kind off, a lower `maxAgentDecisions` wins, `escalate` adds categories and `decider` names
the agent. A policy that cannot be read stops every agent decision and the plan view says
why.

Only work on an approved plan is eligible. A routine question from one of its attempts
first passes a local classifier (`question_risk.rs`). The asking agent may give `category`;
anything but `routine` goes to the person. The question, its options, header, rationale,
recommendation and default are checked for secrets, payment, sign-ins, account creation,
publishing and deploys, deleting or rewriting history, protected paths (the policy's,
`.jackalope/**` and CI configuration) and changes to the plan's goal, scope or
architecture; a question shorter than 8 or longer than 4,000 characters is unclear. Any
match goes to the person with its category and reason.

Everything else goes to a read-only decider attempt on the target branch, started like a
swarm orchestrator and registered with no questions. `auto` picks an installed, enabled
agent from another model family than the asking agent (Claude, Codex, Grok, Kimi,
OpenCode, Gemini, Antigravity in that order), else any. It receives the approved plan,
the question, the asking task's brief and decision trail, and earlier decisions on the
plan, and returns one JSON object:

```json
{"decision": "answer", "answer": "Card grid", "rationale": "…", "confidence": 0.82,
 "evidence": ["plan: Approach"]}
```

An answer stands only when `decision` is `answer`, `confidence` is at least 0.7 and the
answer fits the question (one of the options when only options are allowed; a JSON array
of options for several). Otherwise, or when the attempt fails, takes more than 3 minutes
or waits more than 3 minutes for one of the three shared decider slots, the question goes
to the person with the decider's reason. Elapsed time never answers anything.

While the decider works the question is saved as `deciding`: it raises no notification,
the task shows it with "An agent is deciding for you", and an answer the person sends
first wins. The asking agent receives an agent's answer through the same channel as a
person's, as `Answered by <agent> on your owner's behalf: <answer>`. The prompt records
`answeredBy` (agent, answer, rationale, confidence, evidence, deciding attempt) or
`escalation` (category and reason); prompts saved without them load unchanged. An answer
is also added to the asking attempt's decision trail.

Every decision, escalation and hand-off is kept on the plan record (`autonomy`, at most
500, newest shown first). The plan view's **Autonomy** section counts decisions by agents
and items waiting on the person, shows each decision with the deciding agent's mark,
confidence and reason, and says why anything was sent to the person. **Override** on a
question an agent answered, there or in the task's activity, records the person's answer
and sends it to the asking task as a direct message, which arrives at its next tool
response or with a continuation. A restart while an agent decides hands the item to the
person as interrupted.

Agents ask for what only the person can do (signing in, payment, creating an account,
adding a secret) with `request_human_action`; it never goes to a decider. See
[orchestration](ORCHESTRATION-CAPABILITIES.md#shared-tools-and-guidance).

## Verification

```sh
cd apps/desktop/src-tauri
cargo test --lib planning          # document, interview, store, hand-off, rounds and a fixture planner
cargo test --lib agent_decider     # policy, decider replies, limits, round validator, human actions
cargo test --lib question_risk     # question classifier
cargo test --lib coordination::managed
cargo test --bin jackalope plan    # terminal commands, panel and protocol
cd .. && node --test scripts/plan-mode.test.mjs
```

The fixture planner proves the session plumbing, read-only flags and storage, not real
planning quality. Decider tests use a canned launcher, not an agent. Installed-provider
interviews, approval to merge with real agents, the swarm shape and decider runs with
installed agents remain to be accepted in an installed app.
