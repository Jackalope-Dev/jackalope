# Bot computers

A bot computer is a persistent machine an agent controls instead of the person's own
desktop: a Linux desktop with a window manager, Chromium and the usual command-line
tools. Use this guide to set one up, to run a cloud machine, or to change the providers,
the image or the in-sandbox agent. [Desktop control](DESKTOP-CONTROL.md) covers the
person's own desktop and [browser automation](BROWSER-AUTOMATION.md) the task browser.

## What owns a computer

Each bot has at most one computer, chosen in its settings under **Computer**: None,
**Local sandbox** (Docker on this device) or **Cloud machine** (a machine the person
paired). A task gets one only when its agent calls `computer_request` and the person
answers **Allow a sandbox computer** or **Allow, and share this project read-only**; the
computer then belongs to that task and is reused by its later attempts. Settings →
Computers lists every computer, paired cloud machine and Docker's readiness.

When a run belongs to a bot with a computer, or to a task that was given one:

- `desktop_control` acts on the computer's whole screen. `request_access` answers
  `active` at once with no question, indicator or desktop lease, because the computer is
  the bot's own machine. Snapshots, snapshot IDs, element refs (resolved to coordinates),
  key validation, the action log and after-action captures work as on the person's
  desktop. `select` is unavailable; `invoke` and element `focus` click the element.
- Browser tools drive the computer's Chromium through its DevTools endpoint when the
  computer is a local sandbox with networking on. Otherwise they keep the task's own
  local browser.
- Every website the agent reaches in the computer, through either tool, asks the person
  once per task: allow for this task, always allow, decline, or never allow. Saved
  decisions use the bot's key (`bot:<id>`, shared with the bot's browser profile) or the
  task's project, and are listed in the bot's or project's settings.
- `computer_exec` runs one `bash -lc` command inside the computer as its unprivileged
  user, bounded by a 1 to 600 second limit and 64 KB of output per stream.

A stopped computer starts in the background when an agent first needs it; the agent is
told to call again. Agents are never given the person's sign-ins. Sign-in pages pause the
browser tools and ask the person to sign in through **Watch / take over**.

The bot's settings, the task's Screen view and Settings → Computers show the computer's
state, start and stop it, and offer **Watch** (view only) and **Take over** (the person's
mouse and keyboard reach the computer while the agent may also act). Deleting a local
computer removes its container, its home volume (files and browser sign-ins) and its
saved viewer password; deleting a cloud computer only forgets the pairing. The terminal's
`/computer` shows the conversation's computer and `/computer start` or `/computer stop`
changes it.

## Local sandboxes

Local sandboxes need Docker with Linux containers: Docker Desktop on Windows (WSL 2
backend) and macOS, Colima on macOS, or Docker Engine on Linux. Jackalope runs the
`docker` command on PATH with the active context and never installs Docker. Settings →
Computers reports the engine, version and architecture, or what to do: install Docker,
start it, run `colima start`, or switch Docker Desktop from Windows containers.

The first start builds the image from `apps/desktop/src-tauri/resources/computer`
(bundled with the app) with `docker build`; the status shows the latest build line. The
tag `jackalope-computer:<hash>` follows the content of `Dockerfile`, `start.sh` and
`agent.py`, so a changed definition builds a new image. Docker builds for the host's
architecture, so Apple Silicon gets an arm64 image. No image is published.

Each computer is the container `jackalope-computer-<id>` with the named volume
`jackalope-computer-<id>-home` at `/home/bot`, labelled `dev.jackalope.computer`. It is
created with:

| Setting | Value |
| --- | --- |
| User | `bot` (UID 1000); no root process after start |
| Privileges | `--cap-drop ALL`, `no-new-privileges`, `--init` |
| Limits | 2 CPUs and 4 GB memory by default (0.5–16 CPUs, 1–64 GB), no swap beyond memory, 2,048 processes, 1 GB shared memory |
| Host folders | None. A task given its project read-only gets `/workspace/project` (read-only bind mount) |
| Network | On by default. Off uses `--network none` |
| Ports | With networking on, noVNC (6080) and Chromium DevTools (9223) are published to `127.0.0.1` on random host ports only |

Changed resources apply at the next start: a stopped container whose image or settings
differ is recreated over the same home volume. With networking off there are no ports,
so **Watch / take over** and the browser tools are unavailable and the computer is
followed through the agent's screenshots.

Jackalope reaches the agent with `docker exec -i … agent.py serve`, a resident JSON-lines
process owned like the desktop helpers (reused, killed on timeout or cancellation, never
replayed). It needs no port or secret. The viewer password is random, kept in protected
storage (`computers/secrets/<id>.bin` through the account credential store) and passed
to `docker create` through the CLI's environment rather than its arguments. VNC uses
only eight password characters; the loopback binding is the boundary. The viewer URL
carries the password in its fragment and is embedded in the app (`frame-src
http://127.0.0.1:*`).

Chromium runs with `--no-sandbox` because Docker's default seccomp profile withholds the
namespaces its sandbox needs; the container is the isolation boundary. CDP has no
authentication, so any program on this device can reach a running computer's browser
through its loopback port, as with other local agent tooling. Do not give a computer
secrets it should not hold; anything signed in inside it is available to its agents.

Computers keep running until stopped, deleted or the Docker engine stops; Jackalope does
not stop them when the app quits.

## Cloud machines

A cloud machine is any machine the person runs (a VM from any provider, a home server)
that serves the same image's agent over HTTPS. Jackalope never creates, starts, stops or
deletes it. On the machine:

~~~sh
docker build -t jackalope-computer path/to/resources/computer
docker run -d --name jackalope-computer --init --restart unless-stopped \
  --cap-drop ALL --security-opt no-new-privileges --shm-size 1g \
  -e JACKALOPE_COMPUTER_TOKEN -e JACKALOPE_VNC_PASSWORD \
  -v jackalope-home:/home/bot \
  -p 127.0.0.1:8765:8765 -p 127.0.0.1:6080:6080 \
  jackalope-computer
~~~

`JACKALOPE_COMPUTER_TOKEN` is the pairing secret, at least 32 characters (for example
`openssl rand -hex 32`). Put an HTTPS reverse proxy such as Caddy in front of port 8765,
and optionally of 6080 for the viewer; never publish 8765, 6080 or 9223 directly to the
internet. The agent answers only `GET /v1/health` and `POST /v1/call` (one JSON-lines
request per body, at most 1 MB) with `Authorization: Bearer <token>`, compared in
constant time.

In Settings → Computers, **Pair machine** takes a name, the HTTPS address (plain HTTP
only for a `127.0.0.1` tunnel), the secret and an optional noVNC page address. Pairing
checks the agent first. The secret is stored in protected storage
(`computers/machines/<id>.bin`), never in `machines.json`. **Test connection** repeats the
check. A paired machine belongs to at most one bot, and cannot be removed while a bot
uses it. Its viewer opens in the person's browser and asks for its VNC password. Browser
tools stay on the task's local browser for cloud machines; `desktop_control` and
`computer_exec` reach the machine. Anyone holding the secret can run commands there.

**Jackalope-hosted** is listed as coming soon. Its provider exists so saved records and
settings have a stable name, and every operation reports that it is not available.

## Providers and the in-sandbox agent

`commands/computers.rs` owns the index (`task-runs-v1/computers/computers.json`, written
atomically; an unreadable file is preserved and blocks changes), secrets, background
starts, cached connections, run routing, `computer_request`, `computer_exec` and the
app commands. Records from newer builds with unknown providers load and report
unavailable. A provider implements the `Provider` trait:

| Method | Contract |
| --- | --- |
| `available` | Whether it can be used now, with the reason when not |
| `state` | Missing, stopped or running |
| `start` | Create the machine and its persistent home when missing, then start it; report progress |
| `stop`, `delete` | Stop it; remove it and everything it stored |
| `transport` | A `Transport` that sends one protocol request and returns its result |
| `viewer` | A noVNC address for watching or taking over, if one is reachable |
| `devtools` | A DevTools endpoint reachable from this device, if any |

`computers/docker.rs` (`local-docker`) and `computers/remote.rs` (`remote-machine`) are
the implementations; a VM API provider adds a module and a branch in `provider`.
`desktop_control/computer.rs` runs desktop actions on a computer and
`computers/browser.rs` attaches the computer's browser to the task browser through
`browser::set_router`, gated by the same site questions.

`agent.py` uses only Debian's Python with Pillow, pyatspi, `xdotool`, `wmctrl`, `xclip`
and `scrot`. It answers the helper protocol's `hello` (`protocol: 1`) and `list`,
`snapshot` (AT-SPI elements with screen bounds, at most 300, password text protected),
`screenshot` (base64 PNG, optional `thumb` width), `click`, `double_click`, `right_click`,
`drag`, `scroll`, `type`, `set_value`, `press` (`chord` with modifiers and key), `focus`,
`open_app`, `clipboard_read`, `clipboard_write`, `open_url` and `exec`. Snapshots and
screenshots report the active window and, when Chromium is in front, its current page
URL as `site`. `start.sh` starts Xvfb (1280 × 800 by default), a private D-Bus session,
the AT-SPI bus, Openbox, x11vnc with noVNC when a viewer password is set, Chromium with
remote debugging, and the HTTP agent when a pairing secret is set.

The image is Jackalope's own definition; it uses no Cua code. It installs Debian
packages, including Chromium, Xvfb, Openbox, x11vnc, noVNC and websockify, at build
time on the machine that builds it, under their own licenses. Publishing a prebuilt
image would need their notices.

## Checks

`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib computers::` covers
records and compatibility, settings bounds, one machine per bot, the hosted refusal,
Docker detection messages, container arguments, loopback ports and viewer URLs, the
image tag and cloud address and secret validation. The opt-in
`local_docker_computer_round_trip -- --ignored --nocapture` builds the image, starts a
computer, takes a screenshot and snapshot, runs a command, checks the home volume
survives a restart and deletes everything; it needs Docker and network access. These
do not establish installed-app acceptance on each operating system, Docker variant or
cloud provider.
