# Security reporting

Email **security@jackalope.dev** to report a suspected vulnerability privately.
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
