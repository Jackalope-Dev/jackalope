# Documentation policy

Tracked documentation serves engineers, contributors and agents using or maintaining
the project. Describe current behavior, contracts, setup, troubleshooting and repeatable
verification. Keep reusable examples and blank templates with a clear consumer.

## Where information belongs

| Content | Destination |
| --- | --- |
| Implemented behavior, invariants, supported configuration and recovery | The existing guide for that subsystem |
| Code ownership and cross-application boundaries | ARCHITECTURE.md |
| Shared interface conventions | UI-GUIDELINES.md |
| Concise current capability or limitation | STATUS.md |
| Actionable contributor work | TODO.md; align ROADMAP.md and the website roadmap when scope changes |
| User-facing setup and workflow instructions | packages/knowledge/src/content.ts; regenerate its catalog |
| Notable user-visible changes | The public changelog, following CONTRIBUTING.md |
| Test counts, screenshots, logs, benchmark results and per-run receipts | Ignored scratch/ or output/, or approved private storage |
| Plans, design proposals, decision records, research comparisons and work summaries | Task discussion, an appropriate issue/PR, or approved private storage |
| Live deployment state, owner handoffs, account setup and campaign material | Approved private operator storage |

Do not add a feature design document, implementation plan, experiment report,
dated status entry, session handoff or completed checklist to source. Do not narrate
what a maintainer requested or what an agent did. Extract the lasting behavior into
the relevant guide; keep rationale only when needed to preserve a non-obvious contract.
Updating documentation is not required for every task: change it when behavior,
configuration, contributor workflow or a known limitation changes.

## Adding or changing a guide

Prefer updating an existing source of truth. A new guide needs a distinct reader
task and an entry in the [documentation index](README.md). The optional
[behavior guide template](templates/BEHAVIOR-GUIDE.md) provides a starting structure;
omit sections that do not help its reader. Filenames describe the subject, not a
date, branch, author or implementation phase.

Use present-tense behavior and reproducible commands. Distinguish implemented,
unsupported and unverified capabilities. Document compatibility and failure recovery
where they affect callers. A test command belongs here; its most recent pass count,
machine timing and local profile location belong in the task's verification report.
Version numbers, protocol revisions, license provenance and compatibility migrations
remain useful technical facts. Public release notes may have dates.

Before deleting a file, trace source imports, generated paths, package scripts,
native registration, packaging and manual verification consumers. A compatibility
fixture or dynamically selected asset is not dead merely because it has no direct
import. Remove confirmed orphaned references and styles with their owner. Keep
required notices and migration paths. Update generators or ignores so retired
outputs do not return.

## Review and checks

Run `pnpm check:docs`. It checks local links, index registration, dated/internal
document paths and recognizable work-diary sections. The check is intentionally
bounded: reviewers must still read for internal narrative, accuracy, duplicates and
private information. Registering a file in the index does not make its content suitable.

Keep detailed verification in the PR/task response with exact checks and limitations.
Use the [release record template](releases/RELEASE-RECORD-TEMPLATE.md) outside tracked
source for completed release receipts. Do not force-add ignored diagnostics or revive
retired documents from old branches.
