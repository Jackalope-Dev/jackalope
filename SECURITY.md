# Security reporting

Use [GitHub's private vulnerability reporting](https://github.com/Jackalope-Dev/jackalope/security/advisories/new)
or email **security@jackalope.dev** to report a suspected vulnerability privately.
Please do not put vulnerability details, credentials or private data in a public
issue or pull request before the maintainers have reviewed the report.

Include the affected version or commit, OS, relevant agent/connection setup,
reproduction steps and expected impact. Use a minimal example and redact real
credentials and private repository content. Let us know whether the issue has
already been disclosed elsewhere.

Jackalope is currently prerelease. Security fixes target the current development
branch; older trial builds do not have a separate maintenance guarantee.

Agent CLIs and configured tools run with the user's local privileges. Worktrees
separate changes but are not a sandbox. The local coordination bridge must remain
bound to loopback. See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for boundaries and
[RELEASE.md](docs/RELEASE.md) for signing and update verification.

Only enable trusted agent CLIs and MCP servers. Tool descriptions and generated
content are untrusted input; approval and task scope still apply. Remote MCP
connections require HTTPS, and result images require an explicit opening action.

The desktop account check controls the supported application's access flow.
Someone who builds modified source can change that local check. Hosted services
must independently authenticate and authorize every protected operation; they
must never trust a client build or local account flag as proof of access.

Run `pnpm check:secrets` and `pnpm check:dependencies` when reviewing dependency
or security changes. See [dependency contracts](docs/DEPENDENCY-INTEGRATIONS.md)
for the maintained patch and explicit upstream maintenance warnings.

## Repository and release access

Public read access permits forks and pull requests, not official publication.
Protected branches require maintainer-controlled integration, code-owner review and
trusted CI checks; release credentials are scoped to branch-restricted environments.
Production publication requires explicit approval. The configured maintainer retains
administrator branch bypass for development, while no-bypass rulesets protect branch
history and release tags. See [release automation](docs/RELEASE-AUTOMATION.md#github-configuration)
for the repeatable permissions audit and setup command.

Review external PRs before approving their CI runs and before merging executable
code, dependencies or workflows into a trusted branch. Keep PR checks on GitHub-hosted
runners without deployment secrets. New actions need explicit allowlisting and full
commit pins. Adding a collaborator or GitHub App is a separate access decision;
review its repository selection and write/admin permissions. Organization owners and
apps with administration access remain trusted to change repository protections.
