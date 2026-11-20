---
title: "Coding Agent Credential Management: A Setup Checklist"
description: "Coding agent credential management starts with verified identities and limited access; use this checklist to check accounts, protect secrets, and revoke keys."
author: "caden-sumner"
date: 2026-11-19
slug: "coding-agent-credential-management-checklist"
tags: ["coding agents", "credential management", "security", "developer workflow"]
image: "https://app.lopebase.com/api/content/images/826b7c19-b9ed-4809-9bd2-bafc64370619/cover-f96a2fda94537cb8.png"
image_alt: "Coding Agent Credential Management: A Setup Checklist"
image_kind: "title_card"
faq: [{"q":"Does a separate Git worktree isolate credentials?","a":"No. Worktrees separate checkouts, and Git shares repository configuration by default. Verify authentication and execution boundaries independently. See Git’s worktree reference."},{"q":"Should I give every task a separate API key?","a":"Use separate credentials where you need independent permissions, ownership, attribution, or revocation. Avoid creating extra keys without a lifecycle owner. For local tasks, aim to provide no application credentials at all."},{"q":"Is adding a secret file to .gitignore enough?","a":"No. Git ignores don’t affect already tracked files. If a credential was exposed, revoke or rotate it before cleanup. See Git’s ignore rules and GitHub’s remediation procedure."}]
---

Give each coding-agent task only the credentials its work requires, and verify the effective identity before it starts. Treat the agent login, repository access, and application secrets as separate decisions.

This coding agent credential management checklist covers those decisions, commands that check authentication without printing tokens, and a recovery procedure for exposed credentials.

## Check These Boundaries Before Starting a Task

Use this checklist when you add a project, change accounts, connect a tool, or start a task with broader access.

- [ ] Confirm the agent’s provider account and organization are approved for this repository.
- [ ] Check inherited authentication variables without displaying their values.
- [ ] Verify repository-tool authentication separately from the agent login.
- [ ] Give tests local or disposable service credentials instead of production access.
- [ ] Review connected tools and their accounts, including MCP connections.
- [ ] Keep credential files out of source control, prompts, screenshots, and handoff reports.
- [ ] Record who owns each credential and where to revoke it.
- [ ] Run a harmless identity check from the task’s actual execution environment.

Make “no application credentials required” your default for tasks such as documentation edits, unit tests with mocks, and static analysis. Grant additional access only when the task has a specific check that needs it.

## Map Credentials to the Access They Grant

Create a small access record for each project. Store references to credentials rather than their values. For example:

```text
Project: billing-service
Agent identity: approved company account
Repository identity: company GitHub account
Application access: disposable test database
Connected tools: staging issue tracker, read-only
Production access: none
Credential owner: platform team
Revocation procedure: internal access runbook
```

Keep the agent’s provider identity separate from identities used by its tools. For example, GitHub CLI can select credentials from environment variables or stored authentication independently of your coding agent’s login. Its [environment documentation](https://cli.github.com/manual/gh_help_environment) describes that selection.

For a billing-service test fix, your access record might allow a disposable database and repository reads while leaving deployments and package publishing to a human. Write that boundary into the task brief. Use credentials with matching restrictions wherever the service supports them.

## Verify the Identity the Process Actually Uses

Run preflight checks yourself, outside the agent conversation. Inspect their output locally before copying anything into a ticket or handoff.

Start with inherited variables. This shell loop reports names only, never values:

```sh
for name in \
  ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN OPENAI_API_KEY \
  GH_TOKEN GITHUB_TOKEN \
  GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN
do
  if printenv "$name" >/dev/null; then
    printf '%s is set\n' "$name"
  fi
done
```

This is a starter inventory. Add your organization’s gateway variables and application-specific names. Don’t use an unrestricted environment dump as a troubleshooting attachment.

For Claude Code, check `/status` inside the session. Anthropic documents that an inherited `ANTHROPIC_API_KEY` can select API authentication instead of subscription authentication. Follow its [environment-variable guidance](https://support.claude.com/en/articles/12304248-manage-api-key-environment-variables-in-claude-code) and [status guidance](https://support.claude.com/en/articles/14554922-claude-code-user-faq) before starting work.

For Codex, run:

```sh
codex login status
```

The command reports the active authentication method. Verify any reported account details against your access record, and confirm the organization in the provider’s account interface if necessary. See the [Codex authentication documentation](https://developers.openai.com/codex/auth). A successful login alone isn’t your acceptance criterion.

For GitHub CLI, run:

```sh
gh auth status
```

Inspect the host and active account. Don’t add `--show-token`. GitHub CLI documents that `GH_TOKEN` and `GITHUB_TOKEN` take precedence over stored credentials, so switching a stored account won’t resolve an unwanted environment override. See the [authentication status reference](https://cli.github.com/manual/gh_auth_status) and [environment reference](https://cli.github.com/manual/gh_help_environment).

Repeat these checks in the environment that launches the task. Don’t assume a check from an unrelated terminal proves the task’s identity.

## Keep Credentials Outside the Repository and Conversation

Prefer the agent’s supported credential storage over copying authentication files between project directories. Codex supports OS credential-store storage and file-based storage. Its documentation explicitly treats file-based `auth.json` credentials as password-equivalent material. Review the [storage options](https://developers.openai.com/codex/auth) before choosing one for your machine.

For application configuration, commit a placeholder example and keep real local values untracked. Adapt these patterns to your repository rather than replacing an existing ignore file:

```gitignore
.env
.env.*
!.env.example
```

Git’s [ignore documentation](https://git-scm.com/docs/gitignore) makes an important distinction. Ignore rules affect untracked files; they don’t remove an already tracked credential. They also aren’t an access-control mechanism. Use them to prevent accidental commits, and enforce sensitive-file access through the execution environment.

Put configuration names and setup steps in project instructions, with placeholders for secret values. Ask for handoffs that report “staging authentication check passed” rather than full command output containing headers or connection strings. Review screenshots and browser evidence before sharing them.

## Separate Parallel Work Without Assuming Credential Isolation

Git worktrees separate working directories, but repository configuration is shared by default. Creating another worktree doesn’t establish a separate authentication environment. Git explains the shared configuration in its [worktree documentation](https://git-scm.com/docs/git-worktree.html). Use the [worktree setup guide](https://jackalope.dev/blog/git-worktrees-for-ai-coding-agents/) for checkout management, then perform credential checks separately.

For higher-risk tasks, prefer a dedicated OS account or an isolated execution environment with explicit credential injection. Verify which files, network destinations, credential stores, and host integrations that environment exposes. Accept the extra setup when you need a meaningful boundary between company and personal access.

### Keep Project Account Choices Explicit in Jackalope

Jackalope lets you choose which agent and which work or personal account each project uses. That gives you a place to make the project’s provider-account choice explicit when you run agents side by side. See [Work and personal accounts, with room for both](https://jackalope.dev/blog/work-and-personal-accounts/).

Use that project choice alongside the access record. Account selection doesn’t replace checks on repository credentials, application secrets, or connected tools. The account guide also explains that account profiles don’t create separate OS users or complete filesystem isolation.

## Prove the Boundary With a Small Task

Before launching a batch, run one task with deliberately narrow requirements. For example, ask the agent to fix a unit test that uses mocks and requires no external service access.

First, confirm the provider identity and repository identity yourself. Then verify that the test runs without production credentials. Inspect the patch for authentication-file edits, newly added configuration, and copied connection strings. Use the [AI-generated code review checklist](https://jackalope.dev/blog/review-ai-generated-code-checklist/) for the rest of the review.

For connected tools, test a harmless read against the intended staging resource. Confirm restrictions in the service’s access settings rather than attempting a production write to see whether it fails.

Record the result without secrets. A useful acceptance note is “company provider account verified, intended GitHub account active, mocked test passed, production credentials absent from task environment.” If you can’t verify a boundary, leave that access unavailable until you can.

## Revoke Exposed Credentials Before Cleaning Up

If a credential appears in a commit, shared transcript, screenshot, or uploaded log, treat it as exposed and start your organization’s incident procedure.

Revoke or rotate the credential first. GitHub’s [leaked-secret remediation guidance](https://docs.github.com/en/code-security/tutorials/remediate-leaked-secrets/remediating-a-leaked-secret) explains why deleting the file or adding a cleanup commit is insufficient.

Then stop affected tasks, identify where the credential was copied, inspect available provider activity logs, and replace it through the approved secret store. Coordinate repository-history cleanup with maintainers when required. Restart tasks only after verifying the replacement identity and permissions.

Keep the incident record focused on credential identifiers, affected systems, timestamps, and remediation. Don’t reproduce the secret in the report.

## FAQ

### Does a separate Git worktree isolate credentials?

No. Worktrees separate checkouts, and Git shares repository configuration by default. Verify authentication and execution boundaries independently. See [Git’s worktree reference](https://git-scm.com/docs/git-worktree.html).

### Should I give every task a separate API key?

Use separate credentials where you need independent permissions, ownership, attribution, or revocation. Avoid creating extra keys without a lifecycle owner. For local tasks, aim to provide no application credentials at all.

### Is adding a secret file to .gitignore enough?

No. Git ignores don’t affect already tracked files. If a credential was exposed, revoke or rotate it before cleanup. See [Git’s ignore rules](https://git-scm.com/docs/gitignore) and [GitHub’s remediation procedure](https://docs.github.com/en/code-security/tutorials/remediate-leaked-secrets/remediating-a-leaked-secret).
