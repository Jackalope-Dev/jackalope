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

## Plan a feature with one assistant

Open Plan a feature from the project menu or Feature work. Ask the selected assistant
for an isolated planning task, or add tasks manually. Review and edit instructions,
scopes, expected outcomes and dependencies before saving. Drafts retain the planning
task link across dialog closure and restart. Saving uses a stable feature identifier,
so retrying the same save does not duplicate work. Imports pause project dispatch;
explicitly start the plan after review. Dependencies wait for integration into the
shared target. Progress counts integrated tasks and calls out failures; completing a
plan still requires checking the combined feature. Plans contain up to 12 tasks.

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

`outcomes.rs` owns contracts, receipt validation and review commands. `readiness.rs`
owns bounded preparation suggestions. `previews.rs` owns preview process trees.
Queue journals retain optional context selections and feature identifiers. Legacy
records default to empty contracts/process templates, absent source HEADs and no
feature identifier. Execution retains coordinator -> execution guard -> runtime lock
order. Current snapshot checks and native integration remain authoritative.

## Verification

Automated regression coverage and isolated native trials are described in
[CONTRIBUTING.md](../CONTRIBUTING.md) and [SELF-DEVELOPMENT.md](SELF-DEVELOPMENT.md).
Record detailed local receipts privately. Fixtures and source builds do not prove
installed-app acceptance.
