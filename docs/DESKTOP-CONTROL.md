# Native desktop window control

Windows tasks expose `desktop_control` through native MCP and authenticated
`POST /v1/desktop/control`. This operates a user-selected live application window.
It is separate from the isolated [task browser](BROWSER-AUTOMATION.md).
macOS and Linux return an explicit unavailable response.

## Permission and ownership

An agent calls `request_access`. Jackalope lists visible top-level windows in a
saved task question; only the human's submitted choice grants access. The question
has no default grant. Window titles are not returned to the agent before selection.
The selected handle, process ID, process start time and window class are checked
on every operation. Hidden, minimized, closed or replaced windows fail the check.
Release access and request again to choose another window or modal dialog.

Grants live only in memory for the current attempt. Stop, completion and release
revoke them; restart and continuation need a new question. One attempt may reserve
desktop control at a time, including across Jackalope profiles through a per-user
file lease. Calls serialize per attempt. The lease remains held until canceled
in-flight work has returned. Other applications can still interact with the desktop.

This is an interaction guard, not a security sandbox: agents and local programs
retain their existing OS privileges. A chosen app can change files or send data.
Do not grant a window containing secrets. App content and accessibility names are
untrusted observations, never instructions that expand the user's authorization.

## Actions

| Action | Behavior |
| --- | --- |
| `request_access` | Ask for one window, or read the result of that question. |
| `snapshot` | Bounded UI Automation control tree, relative bounds and snapshot ID. |
| `screenshot` | Capture only the selected window as a saved task PNG artifact. |
| `focus` | Request foreground focus; fail if Windows refuses. |
| `click` | Click window-relative `x`, `y` after checking foreground and occlusion. |
| `type` | Send up to 1,000 printable characters literally, without interpreting key syntax. |
| `press` | Send navigation/editing keys or the exposed Control+a/s/z/y shortcuts. |
| `scroll` | Send up to ten wheel notches at a checked point within the window. |
| `release` | Revoke this attempt's desktop grant. |

Input requires `snapshot_id` from the latest snapshot or screenshot. It expires
after 60 seconds and is consumed even if input fails. A moved/resized window or
changed foreground requires inspection again. Keyboard modifiers or mouse buttons
held by the user block input. System-wide shortcuts, clipboard access, arbitrary
scripts, process launch and elevation are not part of this tool.

UIA password fields and native password edit controls are redacted from snapshots
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

Run ordinary guards with `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
--lib --no-default-features desktop_control`. The opt-in
`native_desktop_window_trial -- --ignored --nocapture` opens and controls its own
disposable Windows form, records literal text, verifies a PNG and checks rejected
input. Run it only on an interactive test desktop. It closes only its own fixture.
This trial does not establish installed-agent, installed-package or arbitrary-app
acceptance; those remain separate [native release checks](SELF-DEVELOPMENT.md).
