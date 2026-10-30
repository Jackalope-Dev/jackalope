# Task outcomes and continuity

Jackalope can guide one assistant from a feature goal through reviewed results and
repeatable project work. All additions are optional for existing tasks and saved data.

## Review a result against its requirements

Add expected outcomes in the task composer or queue editor. The task's Outcomes tab
links each requirement to an inspection note, a passed native check for the current
files, a screenshot, or an agent report. Agent evidence always needs human judgment.
Acceptance is stored in the native journal against a Git workspace snapshot. Changed
files require fresh acceptance; the native review and integration paths enforce this.
Use selected requirements to prepare a correction in the existing follow-up field.
Original instructions, requirements, workspace and account remain attached to the task.

After implementation and required verification, the agent is instructed to submit one
validation report with an assessment for each applicable requirement: met, partially met
or unverified, a short justification, evidence references and an evidence level. The
Outcomes tab shows the latest assessment beside each expectation and explicitly
identifies missing reports. These are agent claims, not human acceptance or proof that
the current files still match the report. Older task history remains readable without
assessments.

### Evidence levels

Each assessment may claim a level, weakest to strongest:

| Level | Shown as | Evidence Jackalope expects |
| --- | --- | --- |
| `stated` | Stated | None; the agent says so |
| `cited` | Cited code | At least one `path:line` (also `path:line:col`, `path:start-end`, `path#Lline`) in `evidence` |
| `reasoned` | Reasoned through | A valid citation plus `reasoning` walking the failure case |
| `ran` | Ran it | `command` and its `output` (up to 4,000 bytes) |
| `reproduced` | Shown in the app | An `evidence` entry naming a screenshot recorded in this attempt (ID, `screenshot:<id>`, name or file path), a desktop-control capture, or a preview page the task browser opened |

When the report arrives, `evidence.rs` checks the claim locally, without model calls,
and records `checkedLevel` (with a `checkNote` when lower) beside the claimed `level`.
The checked level is the highest level at or below the claim whose evidence is
present. A citation whose file is missing from the workspace, lies outside it, or is
shorter than the cited line drops the checked level to `stated`, because the report
then names evidence that does not exist. The check does not read the cited code or
rerun commands: a supported level means the evidence is present, not that it proves
the requirement. Agent-supplied `checkedLevel` values are replaced.

Review shows each assessment's checked level, the claimed level when it was lowered,
and the weakest checked level across requirements, with a count of unrated ones.
Reports saved before levels existed, or sent without one, display as Unrated.

A report may add one optional `safety_fact`: the single fact the change is safe
because of, with its own level and evidence, checked the same way. Review shows the
latest one as "Safe because".

### Goal restatement

Every bridged task launch carries a one-line reporting contract
(`outcomes::RESTATEMENT_CONTRACT`): the agent's first message restates the goal, the
problem and the smallest change it expects to make, records it once with `restate_goal`
(HTTP `POST /v1/goal-restatement` with `goal`, `problem`, `smallestChange`), then
continues without waiting for confirmation. Each field is whitespace-collapsed and
limited to 400 bytes; a later call replaces the earlier one. The task page shows it as
"Understood as" so a misread is visible while work runs. Tasks without a restatement,
including all earlier history, show nothing.

## Repeat a process with approval gates

Project knowledge workflows can define required inputs, ordered steps and final
outcomes. Select a workflow and supply its inputs before starting. Each native attempt
receives the frozen task agreement and current step. Accept that step's current
snapshot, then explicitly choose Continue to step to launch the next attempt.
Correcting a step stays on that step and clears its approval. Advancing preserves
completed-step receipts as historical approvals; current final outcomes must still be
accepted against the latest files. These gates control launches, not an agent's ability
to ignore its instructions within a step. Existing account and execution permissions apply.
After reviewing a result, use Use this process again to save an editable workflow.

## Write the plan myself

Choose **Write the plan myself** in the composer or on Feature work to write tasks
directly: a title, instructions, files or folders, the earlier tasks each starts after,
and the outcomes each must meet. Drafts are kept on this device across dialog closure and
restart. **Review the plan** saves it as a plan-mode draft (up to 8 tasks; outcomes
become acceptance criteria) and opens it on the Plans page for approval, hand-off,
review and tracking like a plan drafted with an agent. See [plan mode](PLAN-MODE.md).

## Return to a project

The project return view surfaces latest attempts needing attention, ready results,
active work, recent local commits and saved decisions. Reviewed but unintegrated
isolated work remains visible. Saved knowledge captures the local Git HEAD when
explicitly saved; a changed HEAD suggests reviewing its relevance, not that it is
necessarily obsolete. Legacy knowledge without a source HEAD stays readable.
Recovery handoffs preserve the original request, workspace, branch, failure, expected
outcomes and prior checks without claiming those checks still describe current files.

## Prepare and preview a workspace

Workspace readiness performs bounded, read-only local Git, manifest and environment
name inspection. It suggests installation, check and development commands; it never
executes detected scripts. Choosing a suggestion saves the existing explicit project
preparation/check preference. Missing configuration reports names, never values, and
presence does not prove a value is valid.

Finished tasks can start a managed preview from an explicit command containing
`{port}`. The app checks the requested local port, owns the spawned process tree,
shows bounded output and stops only that tree. A running process does not prove the
server is ready. Stop a preview before continuation, integration or workspace removal.
Explicit stop retains output in task diagnostics; app exit terminates remaining owned
previews. This does not manage unrelated terminals or guarantee arbitrary scripts
honor the requested port.

## Native ownership and compatibility

`outcomes.rs` owns contracts, the goal restatement, receipt validation and review
commands. `evidence.rs` owns evidence-level checks. `readiness.rs`
owns bounded preparation suggestions. `previews.rs` owns preview process trees.
Queue journals retain optional context selections and feature identifiers. Legacy
records default to empty contracts/process templates, absent source HEADs, no
feature identifier, unrated assessments and no goal restatement. Execution retains coordinator -> execution guard -> runtime lock
order. Current snapshot checks and native integration remain authoritative.

## Verification

Automated regression coverage and isolated native trials are described in
[CONTRIBUTING.md](../CONTRIBUTING.md) and [SELF-DEVELOPMENT.md](SELF-DEVELOPMENT.md).
Record detailed local receipts privately. Fixtures and source builds do not prove
installed-app acceptance.
