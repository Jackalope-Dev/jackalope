# Native desktop control

Windows, macOS and supported Linux desktops expose `desktop_control` through native MCP and authenticated
`POST /v1/desktop/control`. This operates the user's own live applications, including
their logged-in browser. It is separate from the isolated [task browser](BROWSER-AUTOMATION.md),
which has no personal sign-ins, and from a [bot computer](BOT-COMPUTERS.md), where
`desktop_control` acts on the bot's own sandbox or cloud machine without a grant.
macOS, Linux X11, GNOME 46 Wayland and XDG desktop portal backends are implemented
for native validation; macOS compilation and installed-device acceptance remain open.
GNOME Wayland uses the bundled Jackalope Window Control extension when it is enabled;
other Wayland desktops use the [desktop portals](#wayland-desktop-portals) when they
implement remote desktop control. Sessions with neither, and headless Linux, return an
explicit unavailable response and omit the MCP tool. An XWayland connection is not
accepted as permission to control a Wayland desktop. The X11 and GNOME extension
helpers are one-window helpers.

## Grant levels and ownership

An agent calls `request_access` with a `scope`, an optional `app` hint and a
one-sentence `reason`. Jackalope saves a task question; only the human's submitted
answer grants access, and the question has no default. Window titles are not
returned to the agent before selection. Jackalope's own windows and its indicator
are never listed or controllable.

| Scope | Grants | Platforms |
| --- | --- | --- |
| `window` | One window; other windows and popups need another grant. | Windows, macOS, X11, GNOME extension |
| `app` | Every window of one app (image name on Windows, bundle ID on macOS, accessible app name on portal desktops), including new ones. | Windows, macOS, portal desktops |
| `desktop` | Every app and monitor except Jackalope. Asked for every task and never remembered. | Windows, macOS, portal desktops |

App questions offer "Always allow <app> in <project>", and the Screen view offers the
same for an active window or app grant. Remembered grants are stored per project in
`preferences/desktop-grants.json`, listed under Project settings, Desktop control, and
removable there. A remembered grant answers a later request only when the agent names
that app; a window request is answered only when the app has exactly one window, and an
app request only by a remembered app grant. Unknown scopes written by a newer app are
ignored. Full-desktop grants cannot be stored.

The selected handle, process ID, process start time and window class (bundle ID on macOS) are checked
on every operation. Hidden, minimized, closed or replaced windows fail the check.
Grants live in memory for the current attempt. Stop, completion, release, Escape, the
bar's Cancel and the Screen view's Revoke end them at once; restart and continuation
need a new question unless a remembered grant applies. One attempt may reserve desktop
control at a time, including across Jackalope profiles through a per-user file lease.
Calls serialize per attempt. The lease remains held until canceled in-flight work has
returned. Other applications can still interact with the desktop.

### Browsers and websites

App and window grants on a known browser (Chrome, Edge, Firefox, Zen, Brave, Opera,
Vivaldi, Arc, Safari and close relatives) report the current page. Windows reads the
URL from the UI Automation document value, else the address bar; macOS reads `AXURL`
from the web area, else the window document. Snapshots, screenshots and input results
include `site`. The first time a grant reaches a host, Jackalope asks whether to allow
it for this task, always allow it in the project, decline it, or never allow it in the
project. Page content is withheld until the answer. Saved decisions apply to subdomains,
the nearest saved parent wins, and Project settings lists and removes them. Unreadable
addresses and internal pages are not gated. Full-desktop grants are not gated by site.

Querying the document through UI Automation makes Chromium build its full web
accessibility tree; on macOS the helper also sets `AXManualAccessibility` on browser
apps. `snapshot` with `page: true` reads only the web document, with a deeper and larger
bound than a whole-window snapshot.

## Visible control and interruption

On Windows, an opaque black bar sits flush with the top of the granted window's monitor
(the primary monitor for desktop grants), centered above a wide glow in the current
desktop accent color. Desktop grants glow on every monitor; app grants follow the
app's active window. The bar names what is controlled: a window, the app or your
computer. The bar and glow are excluded from Jackalope's own monitor captures. Its rounded lower
corners, shared logo, display-scaled type and real Pause/Resume and Cancel buttons
keep the status and Escape hint readable. The center of the screen stays clear.
The overlay has no taskbar entry, does not activate on arrival and uses no animation.

Physical Escape cancels access. Mouse movement and typing pause control. A window
grant also pauses when that window loses focus, is minimized, moves or resizes; an app
grant pauses when another app comes forward; a desktop grant pauses only on physical
input. Only the human
can Resume from the bar. Agent-generated input is tagged so it does not trigger
its own pause; an agent's Escape remains scoped to the selected application.
Every pause/resume invalidates previous snapshots, so resumed work must inspect
the window again. Paused access also blocks snapshots and captures.

macOS and X11 use a native bar with Pause/Resume and Cancel. Grants start paused;
click Resume to activate the granted window or app and begin. On macOS an accent
frame surrounds the granted window, or the screens for app and desktop grants,
while control is active; the bar and frames are excluded from screen capture. macOS uses a listening
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
saved settings. These controls do not expand the grant beyond its window, app or desktop.

This is an interaction guard, not a security sandbox: agents and local programs
retain their existing OS privileges. A chosen app can change files or send data.
Do not grant a window containing secrets. App content and accessibility names are
untrusted observations, never instructions that expand the user's authorization.

## Actions

| Action | Behavior |
| --- | --- |
| `request_access` | Ask for a window, app or desktop grant, or read the answer. |
| `snapshot` | Accessibility tree with element refs, window-relative bounds, `site` and a snapshot ID. With a desktop grant and no current window it lists windows and monitors. |
| `screenshot` | Capture the current window, or one monitor (`monitor`) with a desktop grant, as a task PNG artifact. |
| `wait_for` | Snapshot repeatedly (up to 15 seconds) until an element's name or value contains `text`. |
| `focus` | Bring the current window forward, or focus an element by ref. |
| `list_windows` | Windows inside the grant, plus monitors for desktop grants. |
| `switch_window` | Make another granted window current (app and desktop grants). |
| `open_app` | Desktop grants open a program by name; app grants open another window of that app. |
| `click`, `double_click`, `right_click` | Target an element ref or `x`, `y`. |
| `invoke`, `select`, `set_value` | Accessibility actions on an element ref; `select` takes an option name in `text`. |
| `type` | Up to 1,000 printable characters typed literally, optionally into an element. |
| `press` | A named key, F1 to F12 or a chord such as `Control+Shift+t` or `Primary+s` (Command on macOS). |
| `scroll` | Up to ten wheel notches at an element or point. |
| `drag` | From an element or point to `to_element` or `to_x`, `to_y`. |
| `clipboard_read`, `clipboard_write` | Read (up to 20,000 characters) or replace clipboard text; both are logged. |
| `release` | Revoke this attempt's desktop grant. |

Snapshot elements carry `ref` (such as `e12`), `role`, `name`, `value`, `bounds`
(`[x, y, width, height]` relative to the captured window), `states` and `actions`.
Resident helpers keep a ref stable while the element exists. Element actions prefer
accessibility (UI Automation Invoke, Toggle, SelectionItem, ExpandCollapse, Value and
Scroll patterns on Windows; `AXPress`, `AXConfirm`, `AXPick`, `AXSelected`, `AXValue`
and `AXFocused` on macOS), which leave the mouse and window focus alone. When an
element offers none, the helper falls back to pointer or keyboard input at the
element's current center. Results report `method` (`accessibility`, `pointer` or
`keyboard`) and `focusChanged`. The X11 and GNOME extension helpers do not run
accessibility actions; there refs resolve to the recorded center and `invoke` becomes
a click. Portal desktops run AT-SPI actions and have no coordinate fallback for refs.

Input requires `snapshot_id` from the latest snapshot, screenshot or `wait_for`. It
expires after 60 seconds and is consumed even if input fails. Window grants never
change focus; app and desktop grants may bring a granted window forward for pointer
or keyboard input and report it. A moved/resized window or changed current window
requires inspection again. Keyboard modifiers or mouse buttons held by the user block
input. Chords that switch apps or desktops, open system UI or quit apps (Alt+Tab,
Primary+Tab, Control/Alt/Primary+Escape, Alt+F4, Primary+q, Primary+Space,
Control+Alt+Delete) and paste (Primary/Control+v) are rejected. Arbitrary scripts,
process arguments and elevation are not part of this tool.

Every action is recorded in the attempt's activity and in a bounded desktop action log
(the latest 200). Input actions keep a 480-pixel-wide capture of the window afterwards
in the task's screenshot folder. The Screen view shows the grant level, current site,
recent actions with their method and captures, "Always allow" and Revoke.

Native accessibility password fields (including Windows password edit controls) are redacted from snapshots
and reject typing, keypresses and value changes. Custom controls may omit accessibility metadata;
redaction cannot guarantee that a selected window contains no sensitive content.
Screenshots capture what the app renders, including any visible secrets. Some GPU
or protected applications return blank captures. Inspect the artifact before using
its coordinates; no automatic retries occur after uncertain or partial input.

## Implementation and acceptance

`commands/desktop_control.rs` owns sessions, task checks, fresh snapshots, artifacts and
the action log. `desktop_control/grant.rs` owns grant levels, the access and website
questions and the remembered-permission store; `actions.rs` validates requests and key
chords; `elements.rs` normalizes accessibility trees and resolves element refs.

`desktop_control/portal.rs` selects the Linux backend and holds the portal session
sequence, grant state, restore tokens, key symbols and capture geometry;
`portal_linux.rs` is its in-process D-Bus client.

`desktop_control/helper.rs` runs one resident helper process per session and talks to it
in JSON lines (`{"id",...}` requests, `{"id","ok","result"|"error"}` responses). The
helper starts on first use, is reused for every action, stops after three idle minutes
or when the grant ends, and restarts on the next call after a crash. A timed-out,
revoked or crashed call kills the process and reports that input may have occurred;
nothing is replayed. On Windows, `windows.ps1` is a small Windows PowerShell 5.1
bootstrap that compiles `windows.cs` once with Add-Type (UI Automation, PrintWindow,
SendInput, Windows Forms clipboard and screens) and then serves requests; no new
toolchain is needed. On macOS the bundled Swift helper serves the same protocol with
`{"action":"serve"}` and falls back to one process per action if its handshake fails.
Linux helpers still run once per action. Helpers receive an allowlisted environment,
run in owned process trees and time out after 20 seconds per action. They cannot
elevate or bypass Windows foreground/UIPI restrictions. Screenshots retain the existing
8 MiB artifact limit. See Microsoft's [password edit styles](https://learn.microsoft.com/en-us/windows/win32/controls/edit-control-styles)
and [SendInput contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput).

`desktop_control/indicator.rs` owns the indicator process, temporary assets,
heartbeat and theme updates. `indicator.cs` draws the native layered glow and
status bar and handles physical interruption. The renderer's
`lib/desktop-control-theme.ts` forwards the shared accent, including live previews.

Run ordinary guards with `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
--lib desktop_control`. They cover grant scoping, remembered grants, site decisions,
element refs, validation, saved-data compatibility and the resident helper lifecycle
against a headless JSON-lines fixture, plus backend selection, the portal session
sequence, portal grant state and restore-token storage on every OS. The opt-in
`native_desktop_window_trial -- --ignored --nocapture` opens its own disposable Windows
form, starts a real indicator and drives the resident helper through snapshots, stable
refs, accessibility value and invoke actions, typing, chords, captures, thumbnails and
rejected input, printing per-action latency. The fixture closes itself after two
minutes and is contained in a job object. Run it only on an interactive test desktop.
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
on macOS 14 and later, with Core Graphics images on older systems; monitor captures
exclude the indicator's windows.
Both paths use logical window dimensions and revalidate identity, bounds, focus
and the active guard before saving; modern capture has an eight-second deadline.
Accessibility matches must identify a single window. Input rejects unknown focused
windows and password controls; Unicode events preserve surrogate pairs and respect
the platform's event length bound. Both macOS CI architectures compile the helper
and run its noninteractive process/coordinate/guard/ref/key self-test. These are not TCC,
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
The fixture needs `python3-gi gir1.2-atspi-2.0 at-spi2-core xvfb openbox xcompmgr xdotool`
and its own private D-Bus session. `at-spi2-core` supplies the accessibility bus
service; the development library alone is insufficient. The script creates those
desktop/session resources and closes only
its own processes. It exercises native Resume, Unicode typing, text replacement,
click, scroll, nonblank PNG capture, password rejection, focus/movement pause,
epoch invalidation and Escape. Xvfb device events exercise the physical-input
branch; real keyboards, mice, desktop environments and scaling still require
hardware checks. The fixture does not establish a real agent's grant flow or
installed acceptance.

### GNOME Wayland

Ubuntu 24.04 with GNOME 46 is the first supported Wayland integration. In Devices,
choose **Install GNOME window control**. This installs the bundled extension in
the current user's GNOME extensions directory and attempts to enable it. If GNOME
has not discovered it yet, sign out and back in, enable **Jackalope Window Control**
in Extensions, then refresh Devices. Installation does not grant a task access;
each task still requires a selected window and native Resume. Other GNOME versions
and other compositors remain unavailable rather than falling back to XWayland.

The extension owns compositor window identity, selected-window capture, dedicated
virtual input devices and the visible Pause/Resume/Cancel bar. The native helper
uses AT-SPI for accessibility and literal editable-text insertion. Window-relative
AT-SPI coordinates are mapped only when the root matches the compositor frame or
buffer dimensions; uncertain coordinates are omitted. Password controls remain
redacted and reject typing. Unsupported accessibility interfaces fail explicitly.

GNOME 46's synchronous activity callback observes input before ordinary client
delivery. An input-method filter observes keys that IME processing consumes earlier.
Only this grant's dedicated virtual devices are exempt. The ordinary Shell event
handler alone is insufficient because it misses client input. Physical input pauses,
Escape cancels, and focus/bounds changes invalidate the epoch. Another application's
compositor input capture also cancels access and blocks Resume while capture is active.
The private indicator
connection renews a three-second heartbeat; disconnect, expiry or extension disable
ends access. Only the native bar resumes it. This remains an interaction guard,
not an isolation boundary against other code running as the same user.

Run `bash scripts/verification/linux-wayland-control.sh` after a native build on
Ubuntu 24.04 with `gnome-shell gnome-session-bin gjs python3-gi gir1.2-atspi-2.0`.
The fixture creates its own headless GNOME compositor, private home and D-Bus
session, with XWayland disabled. A separate virtual device exercises interruption,
Escape and held modifiers; tests also cover native Resume, accessibility, password
protection, typing, keys, clicks, scrolling, capture, focus, epochs, heartbeat expiry,
external input capture and extension readiness. CI retains X11 coverage and adds this GNOME 46 fixture.
These tests do not establish real hardware, IME engine, fractional scaling,
multi-monitor, installed grants or distribution acceptance.

### Wayland desktop portals

Wayland sessions without the enabled GNOME extension use the XDG desktop portals
through `xdg-desktop-portal` and the desktop's own portal backend. Selection checks,
in order: an X11 session uses the X11 helper; GNOME with the extension uses it;
otherwise the portal backend is used when the session portal implements
`org.freedesktop.portal.RemoteDesktop`. Readiness names the grants the portal allows
and explains what is missing otherwise. On GNOME 46 without the extension, Devices
still offers **Install GNOME window control**.

| Desktop | Portal backend | App grants | Desktop grants |
| --- | --- | --- | --- |
| KDE Plasma 5.27 and 6 | xdg-desktop-portal-kde | Yes | Yes |
| GNOME 44 and later | xdg-desktop-portal-gnome | Yes | Yes |
| Sway, Hyprland and other wlroots desktops | xdg-desktop-portal-wlr or -hyprland | No (no RemoteDesktop) | No |
| Others implementing RemoteDesktop | Desktop-specific | With keyboard and accessibility | With keyboard, pointer, monitor ScreenCast and Screenshot |

Single-window grants are not offered: the portal cannot confine input to one window
and compositors keep window positions private. An app grant needs the RemoteDesktop
keyboard device and the AT-SPI accessibility bus. A desktop grant needs keyboard and
pointer devices, monitor ScreenCast sources and the Screenshot portal.

After Jackalope's own access question, the grant waits (reported as paused) until the
user approves the desktop's system dialog: keyboard control for app grants; keyboard,
pointer and monitor sharing for desktop grants. Declining, closing the dialog or
waiting five minutes cancels the grant. The session runs CreateSession,
SelectDevices, SelectSources (desktop grants: monitors, multiple allowed) and Start,
requesting `persist_mode` 2 on RemoteDesktop version 2 and later. The returned restore
token is stored per project and scope in `preferences/desktop-portal-tokens.json`
(mode 0600) and offered on the next grant, so desktops that honor it skip the
dialog. Jackalope still asks its own question for every task, and desktop grants are
still never remembered. Removing the file makes the desktop ask again.

The compositor's sharing indicator and Jackalope's Screen view show control; there is
no Jackalope bar or frame. Stopping the share from the system indicator closes the
portal session and ends the grant, as do Stop, release and Revoke. Physical mouse and
keyboard input cannot be observed through the portals and does not pause control.
Escape is not a cancel shortcut here.

Snapshots read the selected window's AT-SPI tree. Element refs use the AT-SPI Action,
EditableText, Text, Value, Selection and Component interfaces; elements carry no
bounds because window positions are unknown. Typing inserts literal text through
EditableText at the caret, replacing one selection, and falls back to portal keysyms
when the focused control has no editable text. Keyboard input requires the selected
window to be active for app grants, and Jackalope not to be active for desktop
grants; a focused password control blocks it. Jackalope cannot raise windows, so
`focus` without an element reports the window unchanged. Browser snapshots read the
page address from the document's `DocURL` attribute where the browser exposes it.

Screenshots and pointer input at coordinates need a desktop grant. Captures use the
non-interactive Screenshot portal, which captures every monitor into a file the
portal chooses; Jackalope reads and deletes that file, crops the shared monitor and
scales it to the monitor's logical size, so capture pixels equal pointer coordinates.
When the shared monitors do not span the whole screenshot (an unshared monitor
exists), capture fails rather than guessing; share every monitor. The Screenshot
portal may ask once for permission. Pointer input uses `NotifyPointerMotionAbsolute`
on the shared monitor stream, buttons and discrete scroll. Jackalope cannot locate
its own windows, so coordinate input is refused while any Jackalope window is
showing and not minimized. App grants keep accessibility snapshots only, and their
post-input captures are skipped. PipeWire frame capture, clipboard access and
`open_app` are not implemented on this backend.

Apps must expose AT-SPI accessibility. GTK applications usually do; Qt applications
may need `QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1`, and Chromium-based apps may need
accessibility enabled (for example `--force-renderer-accessibility`). Apps without it
appear in no window list. Ordinary guards cover selection, the session sequence, grant
state, tokens, keys and capture geometry; the D-Bus client compiles only on Linux CI.
No automated fixture runs a real portal; installed acceptance on KDE Plasma, GNOME
and a wlroots desktop remains open.
