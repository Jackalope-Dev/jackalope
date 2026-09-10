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

## Platform contracts

Use this map to locate platform-specific behavior and the checks needed when changing it.

| Feature area | Current implementation and remaining checks |
| --- | --- |
| Commands and detection | GUI startup recovers the login shell's PATH with a three-second timeout, then adds common tool directories. Discovery checks executable permissions. Agents, Git, MCP, checks and previews inherit the same PATH. Test desktop launch with Homebrew, nvm, fnm, Volta, pnpm and native CLI installs, including paths with spaces. Aliases/functions are not executable files. |
| Agents and accounts | Adapter protocols, account bindings, routing and continuation are shared. Validate each supported CLI's real login, account isolation, models, quota reporting and resume. Gemini CLI, Aider and Goose execution remain unimplemented everywhere. |
| Secure storage | Windows retains DPAPI. macOS uses Keychain; Linux uses persistent Secret Service with encrypted D-Bus transport. Files contain opaque references. Locked/unavailable stores fail without plaintext fallback. Valid legacy Unix API-key files migrate after validation; failed migration retains the original. Disconnect, profile deletion and reset remove referenced secrets. Test restart, locked stores, migration, reset and revocation. Copying a profile does not copy its OS keyring. |
| Processes and terminals | Commands, authentication probes, MCP, browsers and generic terminals retain owned process groups. A separate Unix guardian watches a close-on-exec pipe and kills the group if Jackalope exits abruptly; normal cleanup reaps the guardian. PTY parent exit also closes descendant pipes. Test stop, timeout, app exit, grandchildren and shell job control. Groups do not contain descendants that deliberately create new sessions, and the short interval before guardian attachment is not protected. Recovery remains conservative on Unix. |
| Browser automation | Chrome, Edge and Chromium detection includes native installation paths, PATH, and macOS system/user Applications folders. `JACKALOPE_BROWSER_EXECUTABLE` accepts an absolute executable override. Unix sockets use short, private directories. Jackalope launches Unix Chromium in its own guarded process group and connects the bundled helper to that disposable browser over loopback CDP; Cancellation tests inspect browser process groups after Stop. Test all actions and cleanup. Safari/Firefox are unsupported engines; Snap/Flatpak Chromium confinement needs separate validation. Do not disable Chromium's sandbox as a workaround. |
| Desktop control | Windows retains its guarded backend. macOS and Linux X11 now have native helpers, visible Pause/Resume/Cancel controls, process/window identity checks, accessibility snapshots, selected-window capture and guarded input. Devices reports readiness and requests macOS permissions only on an explicit click. The isolated Xvfb fixture exercises physical-device events and Escape. macOS compilation and native acceptance remain open. Wayland requires compositor-specific integration and native readiness; XWayland alone is insufficient. See [native control details](DESKTOP-CONTROL.md). |
| Notifications, window and tray | Task clicks use native callbacks on all three platforms. Unix response listeners expire after 24 hours, retain at most 64 notices and close on shutdown. macOS uses UserNotifications from a signed app bundle and asks for notification permission. Linux uses desktop notification actions; compositor focus policy still applies. Linux close-to-tray requires a registered StatusNotifier host and a hidden window reappears if that host disappears. macOS Dock reopening restores hidden windows. Test permission denial, DND, clicks, tray loss, window controls, focus and dialogs. |
| Jackalope account and settings sync | All platforms use the same approved-account, bounded offline lease and explicit sync-choice contracts, backed by their native credential store. Device names come from the Unix hostname API when no shell environment is present. Verify connection, restart, revocation, offline expiry and conflicts against an isolated service. |
| Files, Git and recovery | Worktree/checkpoint/integration safeguards, locks, atomic replacement, recovery, codebase watching and schedules are shared. Test case-sensitive volumes, symlinks, executable bits, Unicode paths, timezone/DST, restart, sleep/wake and interrupted writes. Scope comparisons remain conservative across case variants. |
| UI and optional services | WebView UI, MCP HTTP, account service, sync, feedback, lessons and helper actions need installed checks. Check WKWebView/WebKitGTK, clipboard, keyboard, dialogs, links, themes, reduced motion and narrow layouts. Command shortcuts accept Meta and their labels use Command on Mac and Control on other desktops. |
| Packages and updates | CI defines Linux x64 and macOS arm64/x64 verification, browser smoke tests and trial packages. macOS 11 is the declared minimum; trial app/helper bundles are ad-hoc signed and archived with executable modes preserved. Developer ID signing/notarization, updater trust, AppImage/RPM, Linux arm64 and clean-machine acceptance remain open. Windows ARM uses the x64 browser helper and needs emulation validation. |

CI packages are review artifacts, not signed public release candidates. Run the
relevant native jobs and device checks before claiming platform acceptance.

### Native checks on your devices

Ubuntu/GNOME Wayland is the first Linux acceptance target; repeat applicable
checks under X11. Standard Wayland RemoteDesktop/ScreenCast portals do not supply
the global physical-input listener used by the Windows grant guard. A Wayland
desktop-control backend must resolve its permission scope, visible stop controls
and interruption behavior before the tool is advertised. XWayland access to a
subset of windows does not establish whole-desktop Wayland support.

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
On Linux, `bash scripts/verification/linux-keyring.sh` exercises the same storage
test using a disposable HOME, private D-Bus session and GNOME Keyring. It starts
the Secret Service component and checks that the fixture login collection is
unlocked before testing. It needs `gnome-keyring`, `dbus-run-session`, `gdbus` and
the normal development tools, and never
uses the everyday login keyring. CI runs this check after the native suite.

macOS notification trials need the `.app` bundle with a valid signature; an
ad-hoc signature is sufficient for local testing. CI signs the bundled browser
helper and app for that purpose. This does not supply Developer ID, notarization
or distribution acceptance. Check notification permission denial, allow/retry,
body clicks, expiry, shutdown and hidden-window recovery from the Dock.

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


### Desktop-control checks

Use [desktop-control verification](DESKTOP-CONTROL.md#macos-and-linux-preparation)
for helper prerequisites, X11 fixtures and macOS guard checks. Hardware acceptance
must cover permission attribution, physical interruption, multi-monitor/DPI,
nonstandard apps and clean-machine dependencies. Unsupported Wayland sessions remain unavailable; do
not enable an XWayland fallback that cannot observe the desktop input required by
the grant contract.
