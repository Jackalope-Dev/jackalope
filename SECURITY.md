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
