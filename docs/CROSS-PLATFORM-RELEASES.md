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

## Source readiness audit (2026-09-10)

These changes prepare device testing; they do not establish macOS or Linux acceptance.

| Feature area | Current implementation and remaining checks |
| --- | --- |
| Commands and detection | GUI startup recovers the login shell's PATH with a three-second timeout, then adds common tool directories. Discovery checks executable permissions. Agents, Git, MCP, checks and previews inherit the same PATH. Test desktop launch with Homebrew, nvm, fnm, Volta, pnpm and native CLI installs, including paths with spaces. Aliases/functions are not executable files. |
| Agents and accounts | Adapter protocols, account bindings, routing and continuation are shared. Validate each supported CLI's real login, account isolation, models, quota reporting and resume. Gemini CLI, Aider and Goose execution remain unimplemented everywhere. |
| Secure storage | Windows retains DPAPI. macOS uses Keychain; Linux uses persistent Secret Service with encrypted D-Bus transport. Files contain opaque references. Locked/unavailable stores fail without plaintext fallback. Valid legacy Unix API-key files migrate after validation; failed migration retains the original. Disconnect, profile deletion and reset remove referenced secrets. Test restart, locked stores, migration, reset and revocation. Copying a profile does not copy its OS keyring. |
| Processes and terminals | Commands, authentication probes, MCP, browsers and generic terminals retain owned process groups. Unix termination uses the native signal API. PTY parent exit also closes descendant pipes. Test stop, timeout, app exit, grandchildren and shell job control. Abrupt app crashes can bypass Unix cleanup; crash-proof containment remains open. Groups do not contain descendants that deliberately create new sessions. |
| Browser automation | Chrome, Edge and Chromium detection includes native installation paths, PATH, and macOS system/user Applications folders. `JACKALOPE_BROWSER_EXECUTABLE` accepts an absolute executable override. Unix sockets use short, private directories. Test all actions and cleanup. Safari/Firefox are unsupported engines; Snap/Flatpak Chromium confinement needs separate validation. Do not disable Chromium's sandbox as a workaround. |
| Desktop control | **Still Windows-only.** Non-Windows MCP discovery omits this tool; direct calls remain unavailable. macOS needs Accessibility/Screen Recording permission flows, selected-window capture/input, physical-input interruption, visible grant state and revocation. Linux needs separate X11 and Wayland backends, including portal/compositor support. These are missing implementations, not device-test-only gaps. |
| Notifications, window and tray | Native notifications are wired on all three platforms; click-to-task routing remains Windows-only. Test system permission denial, DND, tray availability, close-to-tray fallback, window controls, focus and dialogs. |
| Files, Git and recovery | Worktree/checkpoint/integration safeguards, locks, atomic replacement, recovery, codebase watching and schedules are shared. Test case-sensitive volumes, symlinks, executable bits, Unicode paths, timezone/DST, restart, sleep/wake and interrupted writes. Scope comparisons remain conservative across case variants. |
| UI and optional services | WebView UI, MCP HTTP, account service, sync, feedback, lessons and helper actions need installed checks. Check WKWebView/WebKitGTK, clipboard, keyboard, dialogs, links, themes, reduced motion and narrow layouts. Command shortcuts already accept Meta; some labels remain Windows-styled. |
| Packages and updates | CI defines Linux x64 and macOS arm64/x64 verification, browser smoke tests and unsigned trial packages. macOS archives preserve executable modes. Signing/notarization, updater trust, embedded helper signing, AppImage/RPM, Linux arm64 and clean-machine acceptance remain open. Windows ARM uses the x64 browser helper and needs emulation validation. |

The CI jobs must pass on their native runners after these changes are pushed.
Local Windows checks do not execute Unix branches. CI packages are review artifacts,
not public downloads or signed release candidates.
The Linux x64 helper started and answered a Unix-socket RPC under WSL in this audit;
that smoke check did not launch Chromium or the native Linux app.
Windows `RUST_TEST_THREADS=2 pnpm verify` passed: 45 release tests, 107 service tests,
136 desktop JavaScript tests and 243 native tests (14 ignored), plus both production
builds. Three separately selected real-browser tests passed. Secret scanning,
documentation links and `git diff --check` passed. macOS/Linux native compilation,
secure-store integration and installed-device acceptance are not established here.

### Native checks on your devices

Follow [Tauri's native prerequisites](https://v2.tauri.app/start/prerequisites/).
Linux builds additionally need `libdbus-1-dev`; saved credentials require an unlocked
Secret Service such as GNOME Keyring or a Secret Service-enabled KWallet.
Storage uses [keyring 3.6.3](https://docs.rs/keyring/3.6.3/keyring/) with explicit
Apple Keychain / Secret Service features, not its mock default.

```sh
pnpm install --frozen-lockfile
RUST_TEST_THREADS=2 pnpm verify
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features real_agent_browser_ -- --ignored --test-threads=1
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features native_keyring_round_trip_update_and_delete -- --ignored --test-threads=1
```

Browser tests launch disposable sessions. The keyring check writes and deletes a
fixture secret in the active user's native store. Use an isolated OS login/profile;
mock storage tests do not establish native-store acceptance.

For a native app trial, use an absolute disposable profile, not everyday data:

```sh
pnpm build
cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
trial_profile=$(mktemp -d)
JACKALOPE_PROFILE_DIR="$trial_profile" apps/desktop/src-tauri/target/debug/jackalope-desktop
```

Repeat setup, real tasks, account switching, stop, tools, checks, review, integration
and restart from the installed trial package launched through Finder or the desktop
menu. Then check permissions and upgrades. Record OS/architecture, display server,
browser/CLI versions, package and failed step. Terminal launch does not validate
the GUI login environment.
