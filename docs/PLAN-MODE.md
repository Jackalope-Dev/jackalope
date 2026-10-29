# Plan mode

Plan mode is an explicit way to start work: a read-only planning interview produces one
self-contained plan, the person approves an exact revision, and Jackalope runs it as one
agent, planned subtasks or a swarm. It never replaces the default task flow. This guide
covers the plan document, storage, the interview limits, approval and hand-off contracts.
Agent coordination contracts are in [orchestration](ORCHESTRATION-CAPABILITIES.md); the
terminal commands are in [terminal command](CLI.md#plan-mode).

## Starting a plan

- App: **Plan first** beside **Start task** in the composer, or **Plan with me** when a
  task assessment suggests a plan or investigation (the existing choices stay).
- Terminal: `/plan <goal>` in a conversation, or `jackalope plan "<goal>"`.

Planning runs with the task's agent, or the project's planning agent when one is set. The
attempt runs in its own worktree and is told it is read-only. Codex runs with a read-only
sandbox; Claude Code runs without its edit tools. Other agents are constrained by the
prompt and the throwaway worktree; anything they change there is never integrated.

## The interview

The planner reads the repository and project lessons first, scores eight coverage areas
(scope, behaviour and UX, data and contracts, integrations, edge and failure cases,
non-functional, constraints and out of scope, done signals) as Clear, Partial or Missing,
and asks only what the code cannot answer: one question at a time through `ask_user`,
recommended option first. Questions can carry an optional header, recommended option,
multi-select flag, allow-other flag and rationale; prompts saved without them load
unchanged.

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

Validation: a title up to 160 characters, a Goal, 1–8 tasks with unique keys (letters,
digits, `-`, `_`) and at least one scope, 1–12 criteria with unique IDs and 1–480
characters, and every `dependsOn` and `covers` reference resolving. Verify tags are
`command` or `test` (optionally `: <exact command>`), `browser` or `manual`; an untagged
criterion is manual. Bullet sections render `- None` when empty.

The revision hash is the SHA-256 of the rendered document without front matter, so
recording an approval or status does not change what was approved. Section changes
between any two revisions are reported section by section (added, removed, changed).

## Storage and export

Plans live in app storage under `task-runs-v1/plans/<plan id>.json`, one record per plan
with every revision, its author (`planner`, `you` or `amendment`), approval, execution
link and deviations. Records are written atomically; an unreadable record is quarantined
as `<id>.json.corrupt` and reported in the plan list rather than overwritten. Per-project
settings are in `plans/settings.json`: `questionCap`, `plannerAgent`, `plannerModel` and
`exportPath` (default `docs/plans/{slug}.md`). Missing fields take their defaults.

**Save to repo** writes the current revision to the export path inside the project. The
path must be relative, end in `.md` and stay inside the project; symbolic links are
refused. Nothing is staged or committed.

## Approval and hand-off

Approval is one explicit call naming the revision number and hash the person reviewed;
a changed plan, a running planner, a done plan, a project without a saved check, or swarm
without a connected swarm Worker is refused. The app approves with the project's current check, prepare command and setup
files; the terminal reuses those of the newest task in the project that ran with a saved
check. Approval records the hash, the target branch head and the approver. Editing
the plan or asking the planner for changes creates a new draft revision that needs its
own approval.

Every shape becomes a managed task linked to the plan revision (`plan` on the task). The
task's request is the self-contained plan, so each worker starts from a fresh context:

| Shape | Assignments |
| --- | --- |
| single | One assignment covering every remaining task and all criteria |
| subtasks | One assignment per remaining task, with its scopes, dependencies, covered criteria as requirements and its briefing |
| swarm | The subtasks assignments, with the connected swarm Worker mirroring each attempt |

Assignments pass the same validation as planner-produced plans: limits, scopes inside the
repository, no overlapping independent ownership and no cycles. Each criterion becomes a
task requirement titled `AC-n: <text>`. Workers are told to run command and test criteria
and record them with `record_validation_step` using the criterion ID as the step name.

A plan always ends with an independent review, even for one assignment. The reviewer is
the planning agent when it differs from the implementing agent, otherwise the same agent.
It checks the combined change against each criterion, classifies gaps as Critical, Major
or Minor, fixes Critical and Major gaps, and records a `Plan review` validation step:
failed while Critical or Major gaps remain. A failed plan review is repaired like a failed
check within the task's existing repair limit, and the combined result is not ready until
the review passes. Human acceptance of requirements stays in result review.

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

Re-planning continues the planning conversation with the current revision and the finished
tasks. Finished tasks are kept with `status: done` and are not assigned again; the new
revision needs approval, and approving it is refused while earlier assignments still run.

When the plan's work is merged its status becomes `done`, and accepted deviations and
criteria whose checks failed are sent once as reflection observations through the
learned-lesson promotion gate.

## Verification

```sh
cd apps/desktop/src-tauri
cargo test --lib planning          # document, interview, store, hand-off and a fixture planner
cargo test --lib coordination::managed
cargo test --bin jackalope plan    # terminal commands, panel and protocol
cd .. && node --test scripts/plan-mode.test.mjs
```

The fixture planner proves the session plumbing, read-only flags and storage, not real
planning quality. Installed-provider interviews, approval to merge with real agents, and
the swarm shape remain to be accepted in an installed app.
