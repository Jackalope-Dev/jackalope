# Cross-platform release requirements

The intended launch targets macOS, Windows and Linux. Enable each platform's
download only after its signing, secure storage, installation, updates and real
agent acceptance pass. Windows rehearsals do not establish acceptance on another OS.

## Distribution tooling

The [cloud tooling](CRABNEBULA-RELEASE.md) implements Windows x64 NSIS preparation,
publisher/updater signing gates and unpublished drafts. The unified multi-platform
publication workflow remains planned. The [Store path](STORE-RELEASE.md) provides
separate MSIX packaging and submission as an optional additional channel.

Accept the exact candidate's clean installation, real execution, account lifecycle,
saved-data recovery and older-to-newer update before distribution. An MSIX build
does not prove certification; an ephemeral updater signature does not prove publisher trust.

## Platform acceptance

- Implement and accept secure native account storage; no plaintext fallback.
- Verify agent discovery, GUI login environment, PTY behavior, process-group ownership,
  descendants, cancellation, timeout, app exit and continuation with real installed CLIs.
- Verify filesystem permissions, Git worktrees, locking and interrupted-history recovery.
- Build on native runners and test supported architectures and package formats.
- Configure platform signing/notarization where applicable, protect signing keys
  and preserve updater trust continuity.
- Test clean installation, browser pairing, offline expiry, approved/revoked
  accounts, saved work, uninstall/reinstall and older-to-newer updates.
- Verify channel/target selection, downloaded artifact bytes and interrupted publication.

Remote execution is a separate effort, not a substitute for native checks.
See [native development](SELF-DEVELOPMENT.md) and [release acceptance](RELEASE.md).
Account enrollment, budgets, live configuration and rollout records are maintained privately.
