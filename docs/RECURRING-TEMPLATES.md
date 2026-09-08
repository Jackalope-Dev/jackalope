# Recurring task templates

In **Tasks → Task tools → Recurring**, choose **Use template** to open a prefilled
schedule. The library includes 16 original, provider-neutral prompts. Search by
topic or filter by category; the first three suggestions cover security, backlog
progress, and UX/UI review. Existing schedules stay above the library.

The editor leads with name, project, agent, repeat timing, and optional project
context. **Review and edit instructions** exposes the complete prompt.
**Advanced settings** contains custom timing, timezone, missed-run behavior,
change monitoring, and saved project knowledge. Selecting custom timing opens
that disclosure. The selected project supplies its target branch, agent account,
preparation, verification, and custom instructions when saved.

Templates select the current project (or the only project) and its available,
allowed preferred runner; with only one eligible runner, that runner is selected.
Otherwise choose explicitly. New agent schedules need a project and agent before
saving; unavailable/disallowed runners are not preselected. Changing projects
clears the previous workflow and lesson exclusions while preserving the choice
to turn off matching lessons.

New templates start paused and skip missed occurrences. Save paused or explicitly
enable automatic runs. Weekly means Monday at 09:00; weekdays means Monday through
Friday at 09:00, in the displayed local timezone. Every template defaults to running
at each occurrence: this also lets dependency and release reviews find changes
outside Git. Optional code-change monitoring retains its existing baseline-first,
committed-local-content behavior.

| Template | Default | Result |
| --- | --- | --- |
| Security audit | Weekly | Prioritized, evidence-backed security findings |
| Complete one TODO | Weekdays | One bounded implementation and accurate backlog update |
| Find UX and UI improvements | Weekly | Concrete improvements to one user journey |
| Dependency risk review | Weekly | Verified advisories and a remediation plan |
| Accessibility review | Weekly | Reproducible barriers and verification procedures |
| Close a regression test gap | Weekdays | Meaningful coverage of one fragile behavior |
| Find a performance bottleneck | Weekly | Measurements and a focused optimization proposal |
| Repair documentation drift | Weekly | A verified documentation patch |
| Review recent changes for bugs | Weekdays | Actionable correctness and compatibility findings |
| Remove proven dead code | Weekly | A small cleanup with consumer/compatibility evidence |
| Investigate CI and flaky tests | Weekdays | Root-cause evidence and a repair plan |
| Check release readiness | Weekly | Qualified readiness assessment and owner actions |
| Weekly project digest | Weekly | Outcomes, blockers, and useful next actions |
| Audit error handling and recovery | Weekly | Failure scenarios and recovery contracts |
| Check API and data compatibility | Weekly | Confirmed mismatches and rollout/test guidance |
| Review first-use experience | Weekly | First-use blockers and acceptance steps |

Each prompt includes repository/context discovery, a bounded procedure, action
boundaries, repeat-run guidance, expected evidence, and stop conditions. Reporting
templates ask for findings without source edits. Change templates leave a local
diff for review without committing, pushing, merging, or deploying. These are
instructions, not a filesystem sandbox or a replacement for agent permissions.
No template requires a particular connector, framework, or external account.
Unavailable tools, history, or access must be reported as coverage gaps.

Project context is appended to the editable instructions when saved. Reopening a
schedule shows the complete saved prompt; future library changes do not rewrite
existing schedules. Save failures retain the draft and reuse its destination ID.
Template selection and saving do not start a task. Execution still requires an
enabled native schedule, an awake computer, and Jackalope running, including in
the tray. Existing overlap, account, capacity, and integration guards apply.

Every occurrence starts from the configured project branch. Review and integrate
accepted patches to make them available to subsequent runs. Prompts check previous
results and pending work when available; this library does not add durable agent
memory, guaranteed finding deduplication, or automatic integration.

## Maintenance and verification

The catalog and prompt/draft builders live in
`apps/desktop/src/lib/schedule-templates.ts`. Keep new entries useful without
placeholder replacement, provider-specific commands, or invented project paths.
Use the existing scheduler contract instead of introducing template-only saved data.

Desktop tests check independent paused drafts, complete prompt assembly, distinct
action boundaries, and search/category behavior. Browser fixtures cover selection,
save/retry, customization round-trip, restricted projects, keyboard/focus, timing
and monitor controls, themes, reduced motion, and both supported window sizes.
These checks do not establish real scheduled provider execution or installed-app
acceptance; those remain in [TODO.md](TODO.md).
