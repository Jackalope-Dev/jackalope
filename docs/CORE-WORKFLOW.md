# Core task workflow

The core loop is intent → work → decision → result → iteration or delivery.
This implementation remains local and uses the existing native task, coordinator,
verification, integration and schedule services.

## Capture and context

New task and Ctrl/Cmd+Shift+N open capture from any workspace destination. Guided
setup also offers capture before project setup. Ideas can have an empty project
identifier; they do not create fictitious projects or authorize execution.
A draft's suggested project is frozen when captured, editable, and preserved
across navigation/reload. Existing project drafts and saved planning records remain
accessible. A missing or restricted agent blocks launch without losing the idea.

Project instructions are included; optional guidelines and tool selection remain
inspectable. Project connection loading must finish before dispatch. An explicitly
empty connection list stays empty through save/restore. Task setup opens existing
agent, project and connection controls without discarding the draft.

## Work and results

Tasks defaults to all projects and orders needs-input/recovery work before results
ready for review, active work, saved ideas and finished work. Integration state
comes from native verified receipts. Project filters and the board remain available.
Parallel planning remains inside Tasks with the existing ownership and dependency
contracts; plans stay editable before dispatch.

Task detail keeps the assigned agent, recorded progress and next action together.
Output contains the agent's response and latest screenshot. Review groups outcomes,
workspace changes, project checks, agent evidence and integration; Activity keeps
searchable agent messages. Details contains account, model, workspace, instructions,
usage and connection choices. Attempt history stays beside the page navigation.
Changes load automatically for finished work, including while Review is hidden.
Long errors keep a concise summary with expandable full details. Copy output and
Make recurring share the task actions menu. Questions and save recovery remain
visible above the task sections.

HTTP(S) result links open through the OS browser in desktop. Other schemes are
not executed. Copy result reports clipboard failures. Screenshots still use the
native bounded evidence reader and cannot claim current visual acceptance.

## Preparation and verification

A project's optional preparation command authorizes a bounded, cancellable command
in each new task workspace before its agent starts. Continuations skip preparation.
Preparation failure retains workspace/history and its recorded command output.

Automatic verification is explicitly enabled in Project defaults. Its saved command
and authorization travel with the task, queue item or schedule and survive account
or preference changes. After a successful agent result the task remains active
while native verification reserves its workspace and uses separate check capacity. Navigating away does not
cancel it; Stop does. Matching successful checks are reused only for the same file
snapshot. Missing commands, command failures and unstable file snapshots remain
visible. Historical records default to automatic verification off and no preparation.

The coordinator → execution guard → runtime ordering, active reservations, owned
process trees, interrupted ownership and history failure guards remain in force.
No general retry loop, historical replay or inferred dependency installation is added.

## Iteration and delivery

Follow-ups use the same native session, workspace and saved account. During active
work, Stop and send explicitly stops the attempt, waits for real terminal state,
then continues. A timeout, interrupted ownership or absent session preserves the
follow-up and reports why it was not sent. Earlier attempts cannot start a competing
continuation through the UI. Draft edits survive failures.

Existing tool scope carries forward by default. Users can explicitly select a
different project connection list for the next continuation; connecting a service
alone does not override an explicit scope. The active attempt retains its tools.

Task detail reaches the existing integration preview directly with the task selected.
The explicit merge action retains source/target snapshots, check requirements,
conflict handling and receipt recovery. Mark reviewed still only records a review.
Merging does not push. Source cleanup follows the explicit integration choice. Integrated work continues through a
new task based on the updated target, with the earlier result attached.

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
checks task states, review sections, keyboard navigation and continuation guards;
it does not launch agents or establish native execution acceptance.
