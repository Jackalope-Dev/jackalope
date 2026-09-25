# Terminal command

The `jackalope` command opens a conversation with Jackalope from a terminal. You
describe the work, Jackalope routes it to an agent, and the terminal shows the
exchange, the assigned agent and the step the work is on. It uses the same live
sessions, routing, account access and Git safeguards as the desktop app.

## Host and clients

A profile has one owner: `TaskRuntime` and `Coordinator` take exclusive locks on
`task-runs-v1/runtime.lock` and `coordination/owner.lock`. The command therefore
never opens a profile. It connects to the process that owns it, called the host,
and inherits that host's approved-account lease.

- The desktop binary is the host. `jackalope-desktop --headless` runs the same
  services without a window; on macOS it has no Dock icon until a window opens.
- The host writes `task-runs-v1/preferences/host.json` with its process id,
  protocol version, endpoint and whether a window is showing. Clients confirm the
  host answers before trusting the file.
- Launching the desktop app while a host runs raises that host's window instead
  of starting a second process. A headless host becomes a normal windowed app.
- With no host running, the command asks whether to open the app or run in the
  background, and remembers the answer in `preferences/cli.json`. `--open` and
  `--background` skip the question. A non-interactive invocation starts a
  background host without recording a preference.

The endpoint is a Unix domain socket in a private `0700` directory under `/tmp`
(macOS limits socket paths to about 104 bytes, which profile paths can exceed),
or a named pipe on Windows. Messages are newline-delimited JSON defined in
`apps/desktop/src-tauri/src/cli/protocol.rs`, which both binaries compile. The
`jackalope` binary does not link `jackalope_lib`; bump `VERSION` in that file
when a request or response changes incompatibly.

## Projects and sessions

The command works in the Git repository containing the current directory. The
desktop app mirrors its project list to `preferences/projects.json` and merges it
back on load, so a repository gets the same project id in the app and the
terminal. A repository first used from a terminal is registered and then appears
in the app.

Conversations use the project's default task agent, or automatic routing when no
project default is set. An explicit `/agent` choice applies to the next conversation. Several
terminals can show different sessions at once, and one session can be open in a
terminal and the app together. Leaving a terminal does not stop work.

| Command | Behavior |
| --- | --- |
| `jackalope` | Starts a conversation in this repository |
| `jackalope --continue` | Rejoins this repository's latest conversation |
| `jackalope attach <id>` | Rejoins a conversation; any unambiguous id prefix works |
| `jackalope ls` | Lists open conversations |
| `jackalope status` | Shows the host, its endpoint and profile |

Inside a conversation, typing `/` opens an interactive command menu, and `/help`
lists commands: `/new`, `/sessions`, `/projects`, `/agents`, `/settings`,
`/status`, `/agent`, `/learn`, `/diff`, `/stop`, `/retry`, `/finish`, `/pause`,
`/resume`, `/open` and `/quit`. `/learn` inspects conversation history since the
previous learn command (or session start) and saves relevant learnings, preferences
and check commands to project knowledge. Alt+Enter (or Ctrl+J) adds a line, Up and
Down recall input, and Page Up and Page Down scroll. A rotating tips bar below the
composer periodically highlights commands and shortcuts when terminal height permits.
Ctrl+C leaves and prints how to rejoin. `JACKALOPE_PROFILE_DIR` or `--profile=<dir>`
selects a non-default profile. The terminal follows its project's saved accent,
including theme changes while it is open and the project of an attached conversation.
Colour is adjusted for readability; 256-colour terminals use the nearest palette match.
`NO_COLOR` disables colour; without `COLORTERM=truecolor` the banner uses one colour.

Agent questions appear in the terminal but are answered in the app. The
transcript shows the conversation's messages followed by the latest attempt's
output. Errors raised before an agent starts, such as missing account access,
update the view without further input.

## In the app

The status bar's Terminal action, the Open terminal command and Cmd/Ctrl+J open a
window running the command in the active local project. The action is hidden for
remote hosts. The window uses the shared task-terminal output buffer and polling
commands. Closing it ends that terminal's process; work continues.

Open in Terminal starts the user's terminal attached to the same conversation and
closes the in-app window. The command reports its conversation to the host under
the window's key. macOS opens a self-deleting `.command` file with its default
handler; Linux tries `$TERMINAL`, `x-terminal-emulator` and common emulators;
Windows uses Windows Terminal when available, otherwise a console window.

## Installation

Both binaries ship in each package, and the command finds the app beside itself.

- macOS and Linux: each launch of a release build with the default profile keeps
  `~/.local/bin/jackalope` linked to the bundled command. Only a link is replaced;
  an existing regular file is reported and left alone. An AppImage copies the
  command to `~/.local/share/jackalope/` because its mount point changes, and
  records how to relaunch itself in `preferences/host-launcher`. Development
  builds and isolated profiles skip this step.
- macOS: the default shell PATH does not include `~/.local/bin`. The terminal
  window offers Install command, which links `/usr/local/bin/jackalope` after an
  administrator prompt.
- Windows: the EXE installer adds its folder to the user's PATH and the
  uninstaller removes it; see `apps/desktop/src-tauri/installer/README.md`. The
  Store package declares a console `jackalope.exe` execution alias.
- macOS release builds sign the command with the hardened runtime before bundling.

## Verification

`pnpm verify` runs the command's tests with the native suite. For a native trial,
follow [native development](SELF-DEVELOPMENT.md) with a stable isolated profile,
then:

1. Start a conversation from a terminal and confirm routing names an agent, output
   streams, Stop works and the same session appears live in the app.
2. Run two terminals on different conversations, and one conversation in both the
   app and a terminal; confirm the second command attaches rather than starting a
   host.
3. With no host, confirm both cold-start answers and that the answer is
   remembered. Launch the app while a headless host runs and confirm one process
   and one window.
4. Open the app terminal, move it to the system terminal and confirm the same
   conversation continues.
5. On installed packages for each platform, confirm the command resolves from a
   new terminal, survives an update and is removed or left harmless on uninstall.
