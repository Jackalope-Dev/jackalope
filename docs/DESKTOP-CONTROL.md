# Native desktop window control

Windows, macOS and Linux X11 tasks expose `desktop_control` through native MCP and authenticated
`POST /v1/desktop/control`. This operates a user-selected live application window.
It is separate from the isolated [task browser](BROWSER-AUTOMATION.md).
macOS and Linux X11 backends are implemented for native validation; macOS compilation
and device acceptance remain open. Unsupported Wayland and headless Linux sessions return an
explicit unavailable response and omit the MCP tool. An XWayland connection is not
accepted as permission to control a Wayland desktop.

## Permission and ownership

An agent calls `request_access`. Jackalope lists visible top-level windows in a
saved task question; only the human's submitted choice grants access. The question
has no default grant. Window titles are not returned to the agent before selection.
The selected handle, process ID, process start time and window class (bundle ID on macOS) are checked
on every operation. Hidden, minimized, closed or replaced windows fail the check.
Release access and request again to choose another window or modal dialog.

Grants live only in memory for the current attempt. Stop, completion and release
revoke them; restart and continuation need a new question. One attempt may reserve
desktop control at a time, including across Jackalope profiles through a per-user
file lease. Calls serialize per attempt. The lease remains held until canceled
in-flight work has returned. Other applications can still interact with the desktop.

## Visible control and interruption

On Windows, an opaque black bar sits flush with the top of the selected window's monitor,
centered above a wide glow in the current desktop accent color. Its rounded lower
corners, shared logo, display-scaled type and real Pause/Resume and Cancel buttons
keep the status and Escape hint readable. The center of the screen stays clear.
The overlay has no taskbar entry, does not activate on arrival and uses no animation.

Physical Escape cancels access. Mouse movement, typing, lost foreground focus,
minimizing or moving/resizing the selected window pauses control. Only the human
can Resume from the bar. Agent-generated input is tagged so it does not trigger
its own pause; an agent's Escape remains scoped to the selected application.
Every pause/resume invalidates previous snapshots, so resumed work must inspect
the window again. Paused access also blocks snapshots and captures.

macOS and X11 use a native bar with Pause/Resume and Cancel. Grants start paused;
click Resume to activate the selected window and begin. macOS uses a listening
Core Graphics event tap; X11 listens to XInput2 raw device events and excludes the
XTEST virtual devices used for its own input. Other programs using XTEST share
that exemption; this remains an interaction guard, not an input-security boundary.
Losing the event monitor disables input. Native helpers run in guarded process
groups, and Unix session directories are private. A stable per-user lease under
`/tmp` prevents GUI and terminal launches with different `TMPDIR` values from
controlling two windows at once; symlinks, hardlinks and shared file modes fail.

The Windows indicator resets a named event before saving a pause/cancel state. Native
input checks that event, the current epoch, a recent heartbeat and the indicator
process identity. Closing or losing the indicator disables input and ends the
grant. The theme bridge follows appearance previews and rollback without changing
saved settings. These controls do not expand the grant beyond the selected window.

This is an interaction guard, not a security sandbox: agents and local programs
retain their existing OS privileges. A chosen app can change files or send data.
Do not grant a window containing secrets. App content and accessibility names are
untrusted observations, never instructions that expand the user's authorization.

## Actions

| Action | Behavior |
| --- | --- |
| `request_access` | Ask for one window, or read the result of that question. |
| `snapshot` | Bounded native accessibility tree, relative bounds and snapshot ID. |
| `screenshot` | Capture only the selected window as a saved task PNG artifact. |
| `focus` | Request foreground focus; fail if the OS refuses or the grant is paused. |
| `click` | Click window-relative `x`, `y` after checking foreground and occlusion. |
| `type` | Send up to 1,000 printable characters literally, without interpreting key syntax. |
| `press` | Send navigation/editing keys or the Primary+a/s/z/y shortcuts (Command on macOS, Control elsewhere), or literal Control shortcuts. |
| `scroll` | Send up to ten wheel notches at a checked point within the window. |
| `release` | Revoke this attempt's desktop grant. |

Input requires `snapshot_id` from the latest snapshot or screenshot. It expires
after 60 seconds and is consumed even if input fails. A moved/resized window or
changed foreground requires inspection again. Keyboard modifiers or mouse buttons
held by the user block input. System-wide shortcuts, clipboard access, arbitrary
scripts, process launch and elevation are not part of this tool.

Native accessibility password fields (including Windows password edit controls) are redacted from snapshots
and reject typing/keypresses. Custom controls may omit accessibility metadata;
redaction cannot guarantee that a selected window contains no sensitive content.
Screenshots capture what the app renders, including any visible secrets. Some GPU
or protected applications return blank captures. Inspect the artifact before using
its coordinates; no automatic retries occur after uncertain or partial input.

## Implementation and acceptance

`commands/desktop_control.rs` owns grants, task checks, fresh snapshots and artifacts.
Its bundled `desktop_control/windows.ps1` uses Windows PowerShell 5.1, UI Automation,
PrintWindow and SendInput. JSON travels through a dedicated environment value,
never through command interpolation. The helper receives an allowlisted environment,
runs in an owned process tree and times out after 20 seconds. It cannot elevate or
bypass Windows foreground/UIPI restrictions. Screenshots retain the existing 8 MiB
artifact limit. See Microsoft's [password edit styles](https://learn.microsoft.com/en-us/windows/win32/controls/edit-control-styles)
and [SendInput contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput).

`desktop_control/indicator.rs` owns the indicator process, temporary assets,
heartbeat and theme updates. `indicator.cs` draws the native layered glow and
status bar and handles physical interruption. The renderer's
`lib/desktop-control-theme.ts` forwards the shared accent, including live previews.

Run ordinary guards with `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
--lib --no-default-features desktop_control`. The opt-in
`native_desktop_window_trial -- --ignored --nocapture` opens and controls its own
disposable Windows form, records literal text, verifies a PNG and checks rejected
input. Run it only on an interactive test desktop. It closes only its own fixture.
This trial does not establish installed-agent, installed-package or arbitrary-app
acceptance; those remain separate [native release checks](SELF-DEVELOPMENT.md).


## macOS and Linux preparation

Settings → Devices reports native-control readiness. On macOS, **Set up macOS
permissions** explicitly requests Accessibility, Screen Recording and Input
Monitoring. Complete the OS prompts, restart Jackalope and refresh. Permission
checks alone never grant an agent a window. Development launches may attribute
permissions to the launching application or helper; verify attribution again from
the eventual app bundle. No permission bypass or automatic resume is provided.

`macos.swift` is compiled with Xcode command-line tools for the Rust target's
architecture and macOS 11 minimum. A small `libproc` shim checks process start
identity for both GUI apps and the helper and checks all held mouse buttons.
Captures use ScreenCaptureKit
on macOS 14 and later, with selected-window Core Graphics images on older systems.
Both paths use logical window dimensions and revalidate identity, bounds, focus
and the active guard before saving; modern capture has an eight-second deadline.
Accessibility matches must identify a single window. Input rejects unknown focused
windows and password controls; Unicode events preserve surrogate pairs and respect
the platform's event length bound. Both macOS CI architectures compile the helper
and run its noninteractive process/coordinate/guard self-test. These are not TCC,
Retina, multi-monitor, input-monitoring or installed-app acceptance.

`linux.c` is compiled with the target C compiler and pkg-config libraries for GTK3,
AT-SPI2, JSON-GLib, X11, XInput2, XTEST and XComposite. On Ubuntu, development builds
need `libatspi2.0-dev libjson-glib-dev libxi-dev libxtst-dev libxcomposite-dev` in
addition to the normal Tauri dependencies. End users do not need a compiler,
Python or xdotool; those are build/fixture tools. Packaged dependency resolution
still needs clean-machine acceptance.

X11 snapshots identify the selected app through AT-SPI and match its client or
window-manager frame bounds. Returned coordinates and PNGs cover the client area.
Input uses fresh accessibility state and rejects ambiguous or inaccessible focused
controls. Literal text uses AT-SPI editable text without changing the clipboard or
keyboard map; apps lacking that interface reject typing. Capture temporarily
redirects only the selected window with XComposite and never falls back to a root
screen capture. Selected text is replaced explicitly; uncertain or partial input
must be inspected before continuing.

Run `bash scripts/verification/linux-desktop-control.sh` after a native build.
The fixture needs `python3-gi xvfb openbox xcompmgr xdotool` and its own private
D-Bus session; the script creates those desktop/session resources and closes only
its own processes. It exercises native Resume, Unicode typing, text replacement,
click, scroll, nonblank PNG capture, password rejection, focus/movement pause,
epoch invalidation and Escape. Xvfb device events exercise the physical-input
branch; real keyboards, mice, desktop environments and scaling still require
hardware checks. The fixture does not establish a real agent's grant flow or
installed acceptance.

Wayland control requires compositor-specific window identity, capture, input and
physical-interruption support. Generic RemoteDesktop and ScreenCast portals alone
do not supply the passive physical-input guard. Native readiness must verify a
compatible helper before exposing the tool; an XWayland connection is insufficient.
Ubuntu/GNOME is the first acceptance target. Signing, installed grants and real
device interruption require separate release checks.
