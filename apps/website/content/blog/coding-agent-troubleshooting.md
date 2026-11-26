---
title: "Coding Agent Troubleshooting Before You Retry"
description: "Coding agent troubleshooting starts with the first failed step; use these checks to diagnose stalled runs, failed commands, and repeated bad fixes."
author: "caden-sumner"
date: 2026-11-26
slug: "coding-agent-troubleshooting"
tags: ["coding agents", "troubleshooting", "debugging"]
image: "https://app.lopebase.com/api/content/images/50c1294f-a5b0-4060-ae56-43b96187d6af/cover-e76dce17b1869f89.png"
image_alt: "Coding Agent Troubleshooting Before You Retry"
image_kind: "title_card"
faq: [{"q":"Should I Restart a Stuck Coding Agent Immediately?","a":"Capture the last command and its output first. Check whether it is waiting for input or intentionally running continuously. If you restart, inspect the files and any surviving child process before launching another attempt."},{"q":"Why Does a Command Work in My Terminal but Fail for the Agent?","a":"Compare the exact command, working directory, runtime executable, shell, and required setup. Reproduce from the agent's directory first. Don't assume two terminals have the same environment."},{"q":"What Should I Do When the Same Fix Keeps Failing?","a":"Stop edits and require a hypothesis with a disproof check. Rerun the same reproduction after one justified change. If the failure hasn't changed, don't approve a broader patch without new evidence."},{"q":"What Logs Should I Include in a Bug Report?","a":"Include the launch command, agent version, operating system, working directory, first actionable error, and reproduction steps. State whether the same command fails outside the agent, and sanitize the report before sharing."}]
---

Stop retrying when the agent repeats the same failure without new evidence. First identify which step broke, preserve the current files, and reproduce the smallest failing action outside the conversation.

This coding agent troubleshooting workflow helps you separate startup problems, stalled commands, wrong-checkout mistakes, and repair loops. You'll leave each attempt with a specific cause to investigate instead of another broad request to “try again.”

## Find Your Failure in the Triage Table

Start with what you can observe. An agent's explanation is a lead to investigate, not proof of the cause.

| Symptom | First check | Next action |
| --- | --- | --- |
| Agent won't start | Run its help command in a fresh terminal | Separate executable discovery from project-specific failure |
| Agent appears stuck | Find the last command started and whether it finished | Inspect that command before restarting the session |
| Shell command fails | Run the exact command in the same directory | Compare the error, runtime, and project setup |
| Changes are missing or in the wrong files | Confirm the checkout and inspect staged, unstaged, and untracked files | Correct the location before requesting more edits |
| Agent keeps applying unsuccessful fixes | Compare the latest failure with the previous one | Require a new hypothesis and a check before another patch |

Don't change the installation, project dependencies, and task prompt in the same attempt. Pick the smallest change that can test your current explanation. Otherwise, a successful retry won't tell you which change mattered.

## Record the State Before Changing Anything

Stop further edits before collecting the baseline. From the directory where the agent was working, run:

```sh
git rev-parse --show-toplevel
git rev-parse HEAD
git status --short --branch
git diff --stat
git diff --cached --stat
```

Record the repository path and commit with the failing command. Git's [rev-parse documentation](https://git-scm.com/docs/git-rev-parse) explains the root-path and commit queries. Its [status documentation](https://git-scm.com/docs/git-status) explains how status distinguishes staged, unstaged, and untracked files.

Save the first useful error, not just the final “task failed” message. Include the command immediately before it, its working directory, and whether it exited or was interrupted. Keep a local copy of important new files before experimenting.

If recovery requires removing changes, use the separate [undo AI code changes checklist](https://jackalope.dev/blog/undo-ai-code-changes-checklist/). Don't turn a diagnostic retry into an unreviewed cleanup operation.

## Diagnose the Symptom You Actually Have

### Agent Won't Start

A startup check separates a missing executable from a failure that occurs after the agent opens your project. Use it when the session never reaches a usable prompt.

**Best for:** A launch failure before any project work begins.

For Claude Code, try these separately in a fresh terminal:

```sh
claude --help
claude doctor
```

The official [Claude Code troubleshooting documentation](https://code.claude.com/docs/en/troubleshooting) recommends `claude doctor` when the agent won't start.

If the shell cannot find `claude`, investigate the installation and executable path. If it launches in your terminal but fails through another application, compare how each launches it, including the executable path and starting directory. Preserve the diagnostic output before reinstalling anything.

### Agent Appears Stuck

A stall check identifies the last unfinished action. Use it when output stops and you can't tell whether the agent or a child command is waiting.

**Best for:** A session that starts normally but stops showing progress.

For example, inspect the transcript for a command that started a development server instead of a terminating test run. Ask for the exact command and its latest output. Check whether it expects terminal input or is intended to stay running.

Choose a boundary based on the command's normal behavior. If a check normally finishes promptly and now shows no progress, inspect its process and output before interrupting it. Record that you interrupted it; don't report an interrupted command as a completed failure.

After interruption, establish whether its child process is still running before starting another copy.

### A Shell Command Fails

Direct reproduction removes the agent's interpretation from the error report. Use it when a build, test, or setup command exits unsuccessfully.

**Best for:** Finding whether the failure belongs to the command environment or the agent's execution of it.

For an npm project, first inspect the available scripts:

```sh
npm run
```

The official [npm run-script documentation](https://docs.npmjs.com/cli/v8/commands/npm-run-script/) confirms that running it without a script name lists available scripts. Select the project's documented check rather than accepting a guessed script name.

Run the failed command unchanged from the agent's directory. If both attempts fail identically, investigate that shared failure first. If only the agent's attempt fails, compare the runtime executable, shell, non-secret configuration, and setup steps. Don't paste a complete environment dump into a support ticket.

### Changes Are Missing or in the Wrong Files

A checkout check establishes which files the agent actually changed. Use it when the completion message describes work you can't find.

**Best for:** Distinguishing a location mistake from an incomplete edit.

Compare the agent's reported directory with your recorded repository path. Then inspect:

```sh
git status --short
git diff
git diff --cached
```

According to the official [Git diff documentation](https://git-scm.com/docs/git-diff), plain `git diff` shows unstaged tracked changes, while `--cached` shows staged changes. Neither is an inventory of new untracked file contents.

For example, if the agent says it added a regression test, find that exact file through status and read it. If it committed its work, inspect the reported commit rather than expecting an uncommitted diff. Correct the location before asking it to recreate anything.

### The Agent Keeps Applying Unsuccessful Fixes

A hypothesis reset requires the next attempt to explain an observed failure. Use it when edits accumulate while the same check keeps failing.

**Best for:** Stopping speculative patch loops.

Give the agent a bounded diagnostic request:

```text
Stop editing files.
Report the exact failing command and first actionable error.
Explain one hypothesis using specific code or output.
Propose the smallest check that would disprove it.
Wait before applying another fix.
```

For example, if the agent blames date parsing, require an input that reproduces the parsing failure before accepting another parser rewrite. If the check disproves its explanation, discard the explanation. Don't let it preserve the same theory by expanding the patch into unrelated files.

## Keep Each Attempt Attached to Its Evidence

Write a short attempt record before resuming work. Include the symptom, hypothesis, action taken, and observed result. Keep “not run,” “interrupted,” and “failed” distinct. Each calls for a different next step.

Jackalope helps when troubleshooting several tasks because each task gets its own Git worktree, and finished work comes back with checks and evidence for review. Use that separation to identify the affected task's files and compare its reported checks with what you reproduce. It doesn't replace diagnosis of the failing command. For application-specific problems, use the [troubleshooting and diagnostics guide](https://jackalope.dev/knowledge/troubleshooting-and-diagnostics/).

Avoid copying every session into a single undifferentiated log. Keep enough surrounding output to explain each failure, then label the attempt so you can compare it with the next one.

## Verify One Recovery Before Resuming the Task

Make the next attempt a controlled test. Apply one justified change, rerun the original reproduction, and record whether the symptom changed. Only then rerun the project's broader relevant checks.

For a code defect, require the original failing input to work without weakening its expected result. For a launch defect, require the same launch path that failed to succeed. A successful terminal launch doesn't establish that another application's launch path is fixed.

If you need to escalate, send a compact reproduction:

```text
Agent and installed version:
Operating system and shell:
Repository path, sanitized:
Commit and pre-existing changes:
Exact launch or failing command:
Expected behavior:
Actual behavior and first error:
Does it reproduce outside the agent?
Last known working state:
One change tried and its result:
```

Remove secrets, private source, and sensitive paths before sharing. If the patch now passes its reproduction, continue with the [AI-generated code review checklist](https://jackalope.dev/blog/review-ai-generated-code-checklist/) before accepting it.

## FAQ

### Should I Restart a Stuck Coding Agent Immediately?

Capture the last command and its output first. Check whether it is waiting for input or intentionally running continuously. If you restart, inspect the files and any surviving child process before launching another attempt.

### Why Does a Command Work in My Terminal but Fail for the Agent?

Compare the exact command, working directory, runtime executable, shell, and required setup. Reproduce from the agent's directory first. Don't assume two terminals have the same environment.

### What Should I Do When the Same Fix Keeps Failing?

Stop edits and require a hypothesis with a disproof check. Rerun the same reproduction after one justified change. If the failure hasn't changed, don't approve a broader patch without new evidence.

### What Logs Should I Include in a Bug Report?

Include the launch command, agent version, operating system, working directory, first actionable error, and reproduction steps. State whether the same command fails outside the agent, and sanitize the report before sharing.
