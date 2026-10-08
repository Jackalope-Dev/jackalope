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
when a request or response changes incompatibly. Clients ignore response fields
they do not know, so adding an optional field is compatible.

In the command's source, `main.rs` dispatches what `args.rs` parses; `host.rs`
finds or starts the host and `connection.rs` keeps a reconnecting connection to
it. `subcommands.rs` and `once.rs` hold the commands that print and exit. The
interactive view lives in `ui/`: `mod.rs` holds its state, and `events`,
`refresh`, `keys`, `commands`, `pickers`, `conversation`, `feed`, `selection`
and `editor` each add one concern, with drawing under `ui/render/`.

## Projects and sessions

The command works in the current directory. Inside a Git repository it uses that
repository's root, and each conversation gets an isolated worktree. When the
directory is not a repository yet, an interactive session asks before creating
one. Saying no, or running non-interactively without `--init`, edits files in
that folder directly. There is no worktree, patch or merge for that folder.
`--init` creates the repository without asking. The new repository gets an initial
commit of the current files, and a `.gitignore` for dependency and secret files
when the directory does not already have one, so an isolated worktree contains
the project. The initial commit is unsigned, so setup does not wait on a signing
prompt. Home directories and drive roots are refused. A `.git` entry that is not
a usable repository is left for Git to repair.

The desktop app mirrors its project list to `preferences/projects.json` and merges it
back on load, so a repository gets the same project id in the app and the
terminal. A repository first used from a terminal is registered with default
settings and an open app window adds it immediately; otherwise it appears on the
app's next launch.

Conversations use the project's default task agent, or automatic routing when no
project default is set. An explicit `/agent` choice applies to the next conversation. Several
terminals can show different sessions at once, and one session can be open in a
terminal and the app together. Leaving a terminal does not stop work.

| Command | Behavior |
| --- | --- |
| `jackalope` | Starts a conversation in this directory |
| `jackalope -p "<message>"` | Runs one message and prints the reply; `run` is an alias |
| `jackalope --continue`, `-c` | Rejoins this directory's latest conversation |
| `jackalope --resume [id]`, `-r` | Opens the conversation picker, or rejoins by id |
| `jackalope attach <id>` | Rejoins a conversation; any unambiguous id prefix works |
| `jackalope ls` | Lists open conversations with their project, state and age |
| `jackalope stop <id>` | Stops the work a conversation is running |
| `jackalope status` | Shows the host, its endpoint and profile |

`ls` and `status` accept `--json`. Options take a value as `--agent codex` or
`--agent=codex`; `--` ends options, and an argument containing a space is
always message text. Unknown or misplaced options are refused with exit status 64.

Inside a conversation, typing `/` opens an interactive command menu, and `/help`
lists commands: `/new`, `/bg`, `/init`, `/sessions`, `/projects`, `/agents`, `/settings`,
`/status`, `/agent`, `/model`, `/usage`, `/theme`, `/learn`, `/files`, `/review` (or `/diff`), `/stop`, `/retry`, `/answer`, `/finish`, `/resume`, `/pause`,
`/unpause`, `/copy`, `/history`, `/kill`, `/clear`, `/open` and `/quit`. Pickers
filter as you type. `/new <message>` starts
and shows a conversation; `/bg <message>` starts one and stays on the current one.
`/learn` inspects conversation history since the previous learn command (or session
start) and saves relevant learnings, preferences and check commands to project
knowledge. Messages sent while an agent works queue behind it; `/pause` holds
the queue and `/unpause` sends it. `/clear` starts a fresh conversation like `/new`,
`/resume` opens the conversation picker, and Ctrl+L clears notes and finished `!` output.
`/model` picks from the models configured for the next conversation's agent, or
`/model <name>` sets one directly. `/usage` (or `/cost`) lists account quota
windows and resets. `/theme <colour>` takes orange, red, pink, purple, blue,
teal, green, yellow or any `#rrggbb` and sets the project's accent in every
terminal and the app: a project with its own app theme changes alone, otherwise
the app-wide accent changes. `/init` asks an agent to write or refresh `AGENTS.md`.

A line starting with `!` runs in the user's shell (`cmd` on Windows) in the
conversation's worktree, or the project when it has none. Output streams below the
conversation and never reaches an agent; stdin is closed and pagers are disabled.
`/kill` stops running commands and their children (the process group on Unix,
`taskkill /T` on Windows), and leaving the terminal stops them too. `@` opens fuzzy
completion over the workspace's files that Git does not ignore. Outside a repository
the list is a walk of the directory, skipping dependency and build folders. The list
is read in the background and again after 15 seconds, so new files appear.

While a conversation is open, the header shows the small mark beside the project and
branch, the conversation's routing, other open conversations (with any that need
you) and agent readiness. While work runs, a band of accent moves along the rule
under the header and the status text shimmers; `JACKALOPE_REDUCED_MOTION=1` keeps
them still. Below the conversation, running work lists its newest steps (tool calls
and narration) as the host records them, and `jackalope -p` prints the same steps
to standard error.

The changes panel lists files the conversation's checkout changed since it left
the project's checked-out commit, committed or not, including untracked files, with
line counts and the selected file's diff. It opens by itself the first time work
changes a file and stays hidden for that conversation once closed. Ctrl+O or
`/files` toggles it and Alt+Up/Down (or Shift) selects a file. It sits beside the
conversation from 100 columns and below it on narrower terminals; with no room the
status line shows the count. A pending question stays pinned above the input;
`/answer` reopens its options. Switches such as this one and
`JACKALOPE_BELL` read `1`, `true`, `yes` or `on` as on and `0`, `false`, `no`
or `off` as off. The status line shows elapsed time,
a warning once running work has reported nothing new for 45 seconds, queued messages, running commands and brief confirmations.

The input soft-wraps and grows to a third of the screen. Shift+Enter (where the
terminal supports the keyboard protocol), Alt+Enter, Ctrl+J or a trailing `\` adds a
line. Up and Down move between rows, then recall input; history persists in
`preferences/cli-history.json` (1000 entries) and Ctrl+R searches it. Esc clears the
draft (Ctrl+Y restores it), returns to the latest output when scrolled back, and
pressed twice stops running work. Readline keys work: Ctrl+A/E, Ctrl+W, Alt or Ctrl
with Backspace, Left and Right, Ctrl+U/K and Ctrl+Y. A line starting with a space
is not saved to history. Page Up and Page Down scroll a screen at a time; while
scrolled back the view stays put as output arrives,
and Ctrl+N and Ctrl+P step through open conversations across projects. Ctrl+Z
suspends to the shell on macOS and Linux. The window title shows the conversation's
state, and the bell rings when work finishes or needs you (`JACKALOPE_BELL=0`
silences it). Dragging selects and copies text through the platform
clipboard tool, or OSC 52 over SSH; Shift or Option while dragging uses the
terminal's own selection. Ctrl+C clears the input, then stops running commands, then
leaves and prints how to rejoin. A rotating tips bar below the composer highlights
commands and shortcuts when terminal height permits.
`--init` creates a Git repository in the current directory when it does not
have one, so the conversation can use a worktree. Without it, a folder that is
not a repository is edited directly. `JACKALOPE_PROFILE_DIR` or `--profile=<dir>`
selects a non-default profile. The terminal follows its project's saved accent,
including theme changes while it is open and the project of an attached conversation.
Colour is adjusted for readability; 256-colour terminals use the nearest palette match.
Success, attention and failure use fixed green, amber and red tones.
`NO_COLOR` disables colour; without `COLORTERM=truecolor` the banner uses one colour.

`jackalope -p "<message>"` (or `jackalope run`) starts a conversation, waits for it
to settle and prints the reply; piped stdin is appended to the message, `--json`
prints a JSON object and `--agent <id>` skips routing. The run settles when its work
finishes, fails, is stopped or interrupted, or the conversation is paused.
`--timeout <seconds>` stops waiting (checked at least every 25 seconds) and leaves
the work running. Progress goes to stderr when it is a terminal. Exit status is 0
when done, 1 on failure or when the work was stopped, 2 when an agent asks a
question, which can be answered after `jackalope attach <id>`, and 3 on timeout.

Agent questions open a picker of their options once; choosing one, or typing a
reply and pressing Enter, answers the oldest open question. The
transcript shows the conversation's messages with each reply; when work was
retried, every attempt's output appears in order under an attempt label. Errors
raised before an agent starts, such as missing account access, update the view
without further input.

The terminal re-reads the conversation in the background when the host reports a
change, so typing never waits on it. Every request times out after 40 seconds. If
the host stops, the status line says contact was lost; when a host is running
again the terminal finds its new endpoint and reconnects. Requests that only read
are retried on the new connection; sending, stopping and other changes are not,
since the first attempt may have landed.

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
   and one window. Quit the host during a conversation, confirm the status line
   reports lost contact, then start it again and confirm the view reconnects.
4. Open the app terminal, move it to the system terminal and confirm the same
   conversation continues.
5. On installed packages for each platform, confirm the command resolves from a
   new terminal, survives an update and is removed or left harmless on uninstall.
6. In an empty temporary directory, confirm the command asks before creating a
   repository, declining edits the folder directly, `--init` creates one with an
   initial commit, and creating one in a home directory or drive root refuses.
