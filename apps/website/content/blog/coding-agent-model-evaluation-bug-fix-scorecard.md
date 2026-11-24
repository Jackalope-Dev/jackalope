---
title: "Coding Agent Model Evaluation: A Bug-Fix Scorecard"
description: "Coding agent model evaluation starts with a reproducible bug. Use this scorecard to compare patches, regression tests, and review effort."
author: "caden-sumner"
date: 2026-11-17
slug: "coding-agent-model-evaluation-bug-fix-scorecard"
tags: ["Coding Agents", "Model Selection", "Testing", "Code Review"]
image: "https://app.lopebase.com/api/content/images/2c3afd91-6e23-4b4e-b8df-2bbe0b79b608/cover-ac08974e6a01769c.png"
image_alt: "Coding Agent Model Evaluation: A Bug-Fix Scorecard"
image_kind: "title_card"
faq: [{"q":"Is one historical bug enough to choose a model?","a":"It's enough for a provisional choice on similar work. Use another representative bug before making it a project-wide default."},{"q":"Should both candidates produce the same patch?","a":"No. Compare behavior, compatibility, scope, and review effort. Different implementations can satisfy the same requirements."},{"q":"Can you compare different agents this way?","a":"Yes, but the result compares the whole agent setup. Keep the agent fixed if you want to isolate model selection as closely as practical."},{"q":"What if the model finds the original fix?","a":"Discard that run. Reading the solution removes the diagnosis task you intended to evaluate. Choose another bug or restrict access more carefully before repeating the trial."}]
---

Compare coding agent models on a historical bug fix from your repository. Start each candidate before the fix, give it the original symptoms, and judge the patch against acceptance checks you wrote beforehand.

This trial answers a narrow question: which model should handle similar bug fixes in your project? You'll get a reusable scorecard, commands for isolated trials, and a way to tell model failures apart from gaps in the task setup. For the broader decision about agent support, accounts, and review controls, use the [coding-agent workspace selection guide](https://jackalope.dev/blog/choose-ai-coding-agent-workspace/).

## Use this bug-fix scorecard

Write the acceptance checks before either candidate starts. Keep the original fix private during the trial, and assess behavior rather than similarity to that patch.

| Criterion | Evidence to record | Acceptance rule |
| --- | --- | --- |
| Reproduction | A command or test that demonstrates the reported failure | The failure occurs on the baseline |
| Diagnosis | The explanation connected to the relevant code path | The proposed cause explains the observed behavior |
| Regression test | A test for the reported failure | It fails on the baseline and passes with the patch |
| Correctness | Results from predefined behavior checks | All required cases pass |
| Compatibility | Results for adjacent behavior that must stay unchanged | Existing supported behavior remains intact |
| Scope | Changed files and explanation of unrelated edits | No unexplained changes outside the fix |
| Human intervention | Hints, corrections, and manual edits | Record every intervention before comparing effort |
| Review effort | Time spent checking and correcting the patch | Compare only patches that meet the acceptance rules |

Use pass, fail, or unresolved for each acceptance rule. Don't roll these into a weighted total. A weighted total can let a quick but incorrect patch beat a correct one. Correctness is a gate. Compare effort only after a patch clears it.

## Choose a historical bug with a testable outcome

Pick a resolved bug whose symptoms you can reproduce from a known commit. You need a clear report, a usable environment, and enough surrounding behavior to distinguish a narrow fix from a workaround.

A useful example is a pagination bug where changing a table filter leaves the user on an empty page. The original report might say that filtering from a later page shows no results, even though matching records exist. Your acceptance checks could require the filter to reset the page, preserve the sort order, and retain unrelated query parameters.

Avoid starting with a bug that depends on missing production data or an unavailable service. You'd mostly be measuring how each candidate copes with a broken environment. Also avoid a trivial typo if your actual work involves tracing behavior across files.

The historical patch is a reference, not the only valid answer. A different implementation can be acceptable if it satisfies the same behavior and repository conventions.

Before the trial, verify the baseline yourself. If you can't reproduce the failure, choose another bug or repair the fixture first.

## Give each candidate the same starting state

Keep the agent fixed when comparing models. Also hold project instructions, tool permissions, dependencies, and task context constant. Otherwise, you won't know which difference caused the result.

Prepare a baseline commit that contains the bug, necessary test fixtures, and the instructions both candidates should receive. Review the [project instructions guide](https://jackalope.dev/blog/agents-md-claude-md-project-instructions/) if your repository guidance needs cleanup before the comparison.

Create separate working directories from that baseline:

```sh
git worktree add -b model-trial-a ../model-trial-a <baseline-commit>
git worktree add -b model-trial-b ../model-trial-b <baseline-commit>
```

Replace `<baseline-commit>` with the same commit hash in both commands. Use unused branch and directory names. Git documents branch creation and linked working directories in its [worktree reference](https://git-scm.com/docs/git-worktree).

Install dependencies and configure test services consistently in both directories. Separate working directories don't separate databases, shared caches, or occupied ports. Give each trial isolated mutable test state, or reset that state between runs.

Start fresh agent sessions. For example, Claude Code supports model selection at startup:

```sh
# Run in ../model-trial-a
claude --model sonnet

# Run in ../model-trial-b
claude --model opus
```

These are candidates to compare, not recommendations about which will win. Claude Code's [model configuration reference](https://code.claude.com/docs/en/model-config) documents aliases, full model names, and model selection. Record the resolved identifier when available, along with any reasoning setting you control.

For a retrospective trial, keep the candidate from consulting the original solution. Git worktrees share repository history, so separate directories alone don't hide later commits. Tell the agent not to inspect subsequent history or the resolved issue, and inspect its tool activity. Treat a run that reads the solution as invalid. This is a supervised comparison, not a secure benchmark.

## Use a brief that leaves diagnosis to the model

Give both candidates the same symptoms and constraints. Don't include the known root cause, the fixed function name, or hints learned from the first run.

For the pagination example, use a brief like this:

```text
Reported behavior:
After moving to a later results page, applying a filter can
show an empty table even when matching records exist.

Expected behavior:
Applying a filter shows the first page of matching records.
The current sort order and unrelated query parameters remain.

Task:
Reproduce the failure, explain its cause, add a regression test,
and implement a focused fix using existing project conventions.

Constraints:
Do not inspect commits after the starting commit or the resolved
issue. Do not change unrelated table behavior.

Handoff:
List changed files, checks run with results, and remaining doubts.
```

Set the intervention policy before starting. For the first pass, provide no implementation hints. If a candidate gets stuck, record its current result before giving help.

A clarification about how to start the test database is different from a hint that names the faulty state transition. Record both, but classify them separately. The first shows setup friction. The second changes how much of the diagnosis the model actually did on its own.

## Verify the patch before reading its summary

Start with the diff and test results. Read the agent's explanation afterward. A confident summary is easy to believe, and it isn't evidence.

Check the proposed regression test against the unchanged baseline as well as the patched code. Keep the test constant and run it with and without the production change. If it passes both ways, it doesn't catch this bug.

Then run your predefined compatibility checks. For the pagination example, cover filter changes from a later page, sort preservation, and unrelated query parameters. Passing the new test alone doesn't establish those behaviors.

Review the patch with the same [AI-generated code review checklist](https://jackalope.dev/blog/review-ai-generated-code-checklist/) for each candidate. Look for unrelated refactors, weakened assertions, swallowed errors, and changes that bypass the failing path instead of fixing it.

Use a record like this for each run:

```text
Bug and baseline commit:
Agent and model identifier:
Reasoning setting, if applicable:
Reproduction result:
Regression test on baseline:
Regression test with fix:
Compatibility check results:
Unrelated changes:
Setup clarifications supplied:
Implementation hints supplied:
Manual corrections required:
Time through final review:
Decision and remaining uncertainty:
```

Use total time through review as an operational measure. Keep setup interruptions separate so you can see whether a slow result came from the model's work or the environment.

## Turn the result into a narrow routing rule

Choose the candidate that produces an acceptable patch with less combined execution, correction, and review effort. If neither passes, don't declare a winner. Classify the failure and rerun only after you understand what changed.

Keep the conclusion as narrow as the evidence. A pagination fix can support a provisional choice for similar application bugs. It doesn't establish which model is best for security reviews, database migrations, or unfamiliar infrastructure.

Your next step is to try the selected candidate on another comparable bug with a fresh session and the same scorecard. If results are close or reversed, keep your existing default until another trial gives you a clearer reason to change.

Write the routing rule in terms you can apply later, such as "use this candidate for reproducible application bugs with established test coverage." Record a specific escalation trigger, such as failure to explain the reproduction or repeated compatibility regressions after feedback.

## FAQ

### Is one historical bug enough to choose a model?

It's enough for a provisional choice on similar work. Use another representative bug before making it a project-wide default.

### Should both candidates produce the same patch?

No. Compare behavior, compatibility, scope, and review effort. Different implementations can satisfy the same requirements.

### Can you compare different agents this way?

Yes, but the result compares the whole agent setup. Keep the agent fixed if you want to isolate model selection as closely as practical.

### What if the model finds the original fix?

Discard that run. Reading the solution removes the diagnosis task you intended to evaluate. Choose another bug or restrict access more carefully before repeating the trial.
