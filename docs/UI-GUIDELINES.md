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

Peer workspace views use WorkspacePage for gutters and scrolling,
WorkspaceHeading for the page title and actions, WorkspaceSectionHeading for
section titles, and WorkspaceSubnavigation for peer tabs. Keep page headers in
loading and empty states. Use the shared workspace spacing classes and tokens;
avoid page-specific padding, title margins and nested page containers. Compact
forms may constrain their fields without moving the page header.
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
controls from `@jackalope/ui`. Its Button, Input, Textarea, Select, FormField,
InlineNotice and Dialog components are browser-safe and include their CSS without
requiring Tailwind. Keep native bridges, API clients and app state out of this package.
Desktop compatibility exports can retain existing import paths. Use the local font stacks and established size tokens. Favor clear
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
drafts and explicit preferences across Back, retry and reload. Project onboarding
has no cancel exit; users reach the final step before entering the workspace.
The first task remains optional on that final step. Give slow or failed checks a
clear retry path.

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

Import portable controls from @jackalope/ui. The library includes Button,
IconButton, Input, Textarea, FormField, Select, Checkbox, Switch, Badge, Tooltip,
DropdownMenu, Popover, Tabs, SegmentedControl, dialogs, CopyButton, InlineNotice,
LoadingState, EmptyState, ErrorState, PageHeader, SectionHeader, Toolbar, Stat,
DefinitionList, Table, SearchField, Disclosure, SettingRow, SettingGroup and Panel.
Reuse desktop compositions such as WorkspaceHeading,
WorkspaceSubnavigation and RunStatus for their app-specific context. Component
ownership and runtime boundaries are documented in the architecture guide.

Standard dialogs compose DialogContent, DialogHeader, DialogCloseButton and
DialogFooter. ConfirmDialog owns pending guards, failure feedback and focus return
for a single confirmation; its children can collect feature-specific acknowledgments.
The feature supplies the actual operation and eligibility. Custom dialogs retain
their own dismissal and focus-return policies. Use contained layout for editors with a scrolling body
and fixed actions. Specialized canvases and command palettes may retain their
own layouts.

Use FormField with Input, Textarea or Select for labelled controls and associated
help or validation text. SettingRow and SettingGroup own preference rows, dividers
and responsive control placement. Use InlineNotice for inline feedback, choosing
the tone from the actual outcome; use its action slot for recovery controls.
WorkspaceToolbar owns filter/action wrapping and spacing. FilterGroup represents
pressed filter choices; WorkspaceSubnavigation represents navigation between views.

SearchField uses a controlled string value and onValueChange, forwards its input
ref and native attributes, and returns focus to the input after clearing. Use
FormField or an accessible label; keep filtering, debouncing and form reset state
with the feature. Its containerClassName adjusts placement, while shared styles
reserve space for the search and clear icons.

Disclosure and DisclosureSummary render native details/summary elements, retaining
open, name, onToggle and nested-section behavior. The shared chevron and focus style
replace local markers. Panel, PanelHeader, PanelBody and PanelFooter provide optional
surface and section layouts; use the plain variant for open page sections.

Set Button loading and loadingLabel for asynchronous actions. Idle and pending
labels share space to avoid width changes, and pending buttons are disabled and
expose aria-busy. The feature still owns duplicate-operation guards, cancellation
and error recovery. Reduced motion disables the shared loading animation.

Use Badge for short status labels and metadata, choosing soft or plain appearance
and an optional Lucide icon. Keep state-to-label and tone mappings in the feature.
Badge labels stay on one line; their containing row may wrap. Shared Icon uses
16, 20 and 24 pixel sizes, with semantic RefreshIcon, FeedbackIcon, MailIcon and
ExternalLinkIcon exports for common actions. Decorative icons are hidden from
assistive technology; standalone meaningful icons need an accessible label.
Keep branded artwork and data visualizations in their owning packages.

Checkbox retains native name/value, required and form-reset behavior. Switch is
an immediate controlled preference, not a serialized form field. Wrap a checkbox
in a label with a comfortable hit area or use FormField. Keep specialized file,
color, range and editor controls local when their interaction requires it.
DropdownMenu and Popover keep Portal explicit so nested overlays can choose their
container. Tabs use arrow-key panel navigation; SegmentedControl uses pressed
buttons for filtering. CopyButton accepts a custom clipboard function, shows
failure beside the action and clears stale feedback when its text changes.

Use the standalone gallery with `pnpm ui:dev` at http://127.0.0.1:5190 to inspect
shared controls without a native bridge or account service. `pnpm ui:build` checks
the package and builds the gallery; `pnpm ui:test` exercises form semantics,
keyboard/focus, async confirmation, copy feedback and responsive appearance.
It uses installed Edge on Windows or Chrome elsewhere; set UI_BROWSER_CHANNEL
to choose another Playwright browser channel. Gallery samples remain local.

The /design-lab.html preview uses fictional fixtures and does not execute tasks.
Verify the actual workspace at 1280 by 840 and 960 by 640, including pointer and
keyboard controls, Escape/focus return, screen-reader labels, both themes,
automatic appearance, preview rollback, persistence and reduced motion.
Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for automated checks and
[SELF-DEVELOPMENT.md](SELF-DEVELOPMENT.md) for isolated native testing.
