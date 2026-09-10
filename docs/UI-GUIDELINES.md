# UI guidelines

Use this guide for Jackalope interface changes, [ARCHITECTURE.md](ARCHITECTURE.md)
for code ownership and the [roadmap](ROADMAP.md) for future direction.

## Product experience

Keep the task's intent, project, account, workspace, context, evidence and
follow-ups together. Lead with the result and the next useful action. Keep
changes, checks and activity accessible; disclose implementation details when
they help someone make a decision.

Preserve expert controls without making basic capture a technical form.
Suggestions must explain their basis and remain editable or dismissible.
Model and account choices come from detected capabilities. Missing quota,
credentials or execution support must stay visibly unavailable.

Use real progress, errors and recorded outcomes. Worktrees isolate changes,
not process privileges. Tool connections and browser previews do not prove
task execution. Preserve the contracts in [CORE-WORKFLOW.md](CORE-WORKFLOW.md)
and [task outcomes](TASK-OUTCOMES.md).

## Navigation and copy

Peer workspace views share WorkspaceSubnavigation and WorkspaceHeading.
Give each page a clear purpose and one primary action. Keep filters and details
near their content. Error and empty states should offer an actionable recovery path.

Use concise headings, familiar action labels and concrete explanations.
Remove repeated instructions, slogans, decorative status labels and normal-state
footnotes. Preserve accessible names, dialog descriptions and consequential
information about cost, permissions, data loss, consent and recovery.

Marketing can be expressive while showing actual product workflows. Keep
availability and limitations beside the claims they qualify. Avoid invented
activity, unsupported capability claims and implementation jargon in product copy.

## Shared appearance

Derive colors, typography, surfaces and motion from packages/brand and shared
controls. Use the local font stacks and established size tokens. Favor clear
hierarchy, generous space and restrained surfaces over repeated metric cards.

Use semantic action and accent tokens with their matching text colors. Keep
normal text contrast at least 4.5:1. Selection and status need non-color cues,
and focus must remain visible in every theme. Use shared Select, input and button
primitives so opened menus, disabled states and keyboard behavior stay consistent.

App and project appearance share the theme controls. Preserve inheritance,
saved overrides and automatic light/dark switching. Preview is temporary;
confirming persists it, while cancellation or leaving an unconfirmed preview
restores the saved appearance. Invalid color input must not change global styles.

Interactive content targets are at least 44 by 44 CSS pixels. Native window
chrome can follow platform sizing. Dialogs retain viewport space and scroll on
small windows. Respect reduced motion, including preference changes while open.

## Setup, settings and accounts

Keep setup provisional until workspace entry. Preserve project choice, task
drafts and explicit preferences across Back, retry and reload. Cancel must not
add a project or change its active selection. Give slow or failed checks a
clear retry or background-continuation path.

App appearance/privacy and account access precede the project setup steps.
Preserve settings-sync disclosure, pre-connection opt-out and deletion choices.
Waitlist membership does not imply approved desktop access.

Provider-reported account identity is separate from custom labels. Keep account
names and credentials local. A different default applies to future tasks;
continuations retain their original binding. Retain saved model IDs when
discovery fails and offer recovery without claiming those IDs were verified.

## Tools and review

Keep task project, agent, model, account, workspace, context and tool choices
inspectable. Preserve manual selections when applying inferred defaults.
Scope and permissions belong beside the action they authorize.

Review shows the patch, checks, attribution and editable commit message before
integration. Make worktree removal explicit. Cleanup failure must retain its
receipt and recovery path without implying that a successful merge failed.
Never infer success from a fixture or agent-reported status alone.

## Branding and motion

Shared vector geometry in packages/brand/src/character.ts owns the mark and
mascot. Keep the compact mark legible. After geometry changes, regenerate
desktop assets with pnpm --filter @jackalope/desktop brand:generate.

The mascot's five moods reflect actual app activity. Keep pointer reactions,
blinks and acknowledgments subtle. Pause idle motion offscreen, when unfocused
and during activity moods. Reduced motion retains a readable static expression.
Do not introduce fabricated activity or persistent decorative status indicators.

Use motion to explain changes, acknowledge input or express the mascot's
personality. Avoid competing animation, ambient pulses and unnecessary delays.
Maintain the existing setup acknowledgment and workspace-entry behavior.

## Components and verification

Reuse WorkspaceHeading, WorkspaceSubnavigation, EmptyState, RunStatus,
useDialogFocus and the shared theme and control primitives. Component ownership
and runtime boundaries are documented in the architecture guide.

The /design-lab.html preview uses fictional fixtures and does not execute tasks.
Verify the actual workspace at 1280 by 840 and 960 by 640, including pointer and
keyboard controls, Escape/focus return, screen-reader labels, both themes,
automatic appearance, preview rollback, persistence and reduced motion.
Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for automated checks and
[SELF-DEVELOPMENT.md](SELF-DEVELOPMENT.md) for isolated native testing.
