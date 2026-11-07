# Bot computers

A bot computer is a persistent machine an agent controls instead of the person's own
desktop: a Linux desktop with a window manager, Chromium and the usual command-line
tools. Use this guide to set one up, to run a cloud machine, to run a project's task
agents on a computer, or to change the providers, the image or the in-sandbox agent. [Desktop control](DESKTOP-CONTROL.md) covers the
person's own desktop and [browser automation](BROWSER-AUTOMATION.md) the task browser.

## What owns a computer

Each bot has at most one computer, chosen in its settings under **Computer**: None,
**Local sandbox** (Docker on this device), **Cloud machine** (a machine the person
paired) or **Agent37** (a machine on the person's own Agent37 account). A task gets one
only when its agent calls `computer_request` and the person answers **Allow a sandbox
computer** or **Allow, and share this project read-only**; the computer then belongs to
that task and is reused by its later attempts. A project can have one too, chosen in
Project settings under **Agents run on**; its task agents then run there (see
[agents on a computer](#agents-on-a-computer)). Settings → Computers lists every
computer, paired cloud machine, the Agent37 connection, agent sign-ins for computers and
Docker's readiness.

When a run's agent runs on a computer (see [agents on a computer](#agents-on-a-computer)),
belongs to a bot with a computer, or belongs to a task that was given one, in that order:

- `desktop_control` acts on the computer's whole screen. `request_access` answers
  `active` at once with no question, indicator or desktop lease, because the computer is
  the bot's own machine. Snapshots, snapshot IDs, element refs (resolved to coordinates),
  key validation, the action log and after-action captures work as on the person's
  desktop. `select` is unavailable; `invoke` and element `focus` click the element.
- Browser tools drive the computer's Chromium through its DevTools endpoint when the
  computer is a local sandbox with networking on. Otherwise they keep the task's own
  local browser, except for an agent running on the computer, which uses its runner's
  browser on every computer type or, on an image before runs protocol 4, has none (see
  [agents on a computer](#agents-on-a-computer)).
- Every website the agent reaches in the computer, through either tool, asks the person
  once per task: allow for this task, always allow, decline, or never allow. Saved
  decisions use the bot's key (`bot:<id>`, shared with the bot's browser profile) or the
  task's project, and are listed in the bot's or project's settings.
- `computer_exec` runs one `bash -lc` command inside the computer as its unprivileged
  user, bounded by a 1 to 600 second limit and 64 KB of output per stream.

A stopped computer starts when anything needs it: `computer_request`, `desktop_control`,
`computer_exec`, the browser tools or a viewer. The call waits up to 90 seconds for the
start; past that (a first image build takes minutes) the agent is told the computer is
starting and to call again. Agents are never given the person's sign-ins. Sign-in pages
pause the browser tools and ask the person to sign in through **Watch / take over**.

The bot's settings, the task's Screen view and Settings → Computers show the computer's
state with its idle time and when it stops (`Running · idle 3 min · stops in 7 min`,
`in use`, or `Stopped (idle)`), start and stop it, and offer **Watch** (view only) and
**Take over** (the person's mouse and keyboard reach the computer while the agent may
also act). Watch on a stopped computer starts it first. Deleting a local computer removes
its container, its home volume (files and browser sign-ins) and its saved viewer
password; deleting a cloud computer only forgets the pairing. The terminal's `/computer`
shows the conversation's computer with the same status and `/computer start` or
`/computer stop` changes it.

## Idle stop and quit

Every use records activity: agent requests through the computer's connection, browser
attaches, commands, starts and viewer opens. A computer is held, and never stopped by
Jackalope's idle stop, while an active run routes to it (its bot's conversation or its
task's attempt) or an embedded viewer is open; the viewer renews its hold every 30
seconds and the hold lapses 90 seconds after the viewer closes or the app stops renewing
it. A run's hold counts as use, so idle time starts when the run ends.

One background sweep runs every 30 seconds. It closes the cached connection of any
computer unused for five minutes, and stops a local sandbox that is unheld and idle past
its **Stop when idle** time: 5, 10 (the default), 30 or 60 minutes, or Never, set in the
bot's settings or per computer in Settings → Computers. The setting applies at once and
never recreates the container. Stopping is `docker stop`: the container and its home
volume stay. It first closes the computer's agent connection and any task browser
attached to its Chromium, so their next use reconnects and starts the computer again.
The status then reads **Stopped (idle)** with "Stopped after N minutes idle". A use that
arrives during an idle stop waits for it and starts the computer again.

When Jackalope quits it closes every computer connection and, unless **Keep computers
running when Jackalope quits** is on in Settings → Computers (off by default), runs one
detached `docker stop --time 5` for every local sandbox without waiting for it, so quit
is not delayed. The global setting is stored in `computers/preferences.json`. A sandbox
found running at the next launch, for example after a crash or with the setting on, is
adopted: its idle time starts when Jackalope first sees it.

Jackalope never stops a cloud machine. It only drops idle connections to it; the
machine's own provider schedule (or the person) decides when it runs. Agent37 computers
sleep through Agent37's own auto sleep (see [Agent37](#agent37)). A Jackalope-hosted
provider would stop its machines on the server side.

## Local sandboxes

Local sandboxes need Docker with Linux containers: Docker Desktop on Windows (WSL 2
backend) and macOS, Colima on macOS, or Docker Engine on Linux. Jackalope runs the
`docker` command on PATH with the active context and never installs Docker. Settings →
Computers reports the engine, version and architecture, or what to do: install Docker,
start it, run `colima start`, or switch Docker Desktop from Windows containers.

The first start pulls this version's [published image](#the-image) and tags it
`jackalope-computer:<hash>`; when it cannot (no published image for this version and
definition, no network, or an arm64 host, since only amd64 is published) it builds the
image from `apps/desktop/src-tauri/resources/computer` (bundled with the app) with
`docker build`. The status shows the latest pull or build line. The tag follows the
content of `Dockerfile`, `start.sh` and `agent.py`, so a changed definition builds a new
image. A local build is for the host's architecture, so Apple Silicon gets an arm64
image.

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

## Cloud machines

A cloud machine is any machine the person runs (a VM from any provider, a home server)
that serves the same image's agent over HTTPS. Jackalope never creates, starts, stops or
deletes it. On the machine:

~~~sh
docker run -d --name jackalope-computer --init --restart unless-stopped \
  --cap-drop ALL --security-opt no-new-privileges --shm-size 1g \
  -e JACKALOPE_COMPUTER_TOKEN -e JACKALOPE_VNC_PASSWORD \
  -v jackalope-home:/home/bot \
  -p 127.0.0.1:8765:8765 -p 127.0.0.1:6080:6080 \
  ghcr.io/jackalope-dev/jackalope-computer:<version>-<hash>
~~~

The image is this app version's [published image](#the-image) (amd64 only). On an arm64
machine, or for a build without a published image, build it there with
`docker build -t jackalope-computer path/to/resources/computer` and run
`jackalope-computer` instead.

`JACKALOPE_COMPUTER_TOKEN` is the pairing secret, at least 32 characters (for example
`openssl rand -hex 32`). Put an HTTPS reverse proxy such as Caddy in front of port 8765,
and optionally of 6080 for the viewer; never publish 8765, 6080 or 9223 directly to the
internet. The agent answers only `GET /v1/health` and `POST /v1/call` (one JSON-lines
request per body, at most 1 MB) with `Authorization: Bearer <token>`, compared in
constant time.

In Settings → Computers, or from a bot's Computer settings when nothing is paired yet,
**Pair machine** generates a 64-character secret in the app and shows the `docker run`
command above with it and this version's image filled in (`PairMachineForm` keeps that
command in step with this guide; it falls back to `jackalope-computer` when the app
cannot read its image definition). It takes the HTTPS address (plain HTTP only for a `127.0.0.1` tunnel), a name that
defaults to one the app picks, the secret, which can be replaced, and an optional noVNC
page address. Pairing checks the agent first. The secret is stored in protected storage
(`computers/machines/<id>.bin`), never in `machines.json`. **Test connection** repeats the
check. A paired machine belongs to at most one bot, and cannot be removed while a bot
uses it. Its viewer opens in the person's browser and asks for its VNC password. A
bot's or task's browser tools stay on the task's local browser for cloud machines (an
agent running on the machine uses its runner's); `desktop_control` and
`computer_exec` reach the machine. Anyone holding the secret can run commands there.

## Agents on a computer

Running a project's agents on a computer, Agent37 computers and agent sign-ins for
computers are beta and marked **Beta** wherever the app shows them. A project whose
**Agents run on** names a computer runs its Claude Code and Codex task agents there,
including read-only planning attempts (plan mode's planner and a swarm round's
orchestrator). Other agents run on this device and say so in the attempt's activity,
except for swarm forks of a project whose swarms run only on computers.
Planned and swarm work can also spread to other computers and this device (see
[swarms across hosts](#swarms-across-hosts)). Workspace preparation, checks, the checkpoint, review and integration stay on
this device and are unchanged, so the coordinator, execution guard and runtime lock
order, reservations and Git safeguards apply as for a local attempt:

1. The local workspace is prepared as usual. If an earlier run of the same workspace
   left changes on the computer (contact was lost, or Jackalope restarted), they are
   brought back and applied first; a patch that does not apply is saved as
   `<attempt>.recovered.patch` beside the attempt's history. Changes an attempt left
   after losing contact are applied only by a continuation of that attempt; any other
   attempt of the workspace saves them for the lost attempt instead and removes them
   from the computer before its upload (see
   [changes left on a lost computer](#changes-left-on-a-lost-computer)). The workspace's tracked
   files and untracked files Git does not ignore (or, for a folder that is not a
   repository, the files its ignore files allow) are sent with the project's copied
   setup files such as `.env.local` (regular files of at most 1 MiB each, 8 MB in all)
   and the [Jackalope context](CORE-WORKFLOW.md#jackalope-context) placed in the
   workspace: the project's `.jackalope/cloudflare.json` and the newest pasted images
   under `.jackalope/attachments` (at most 16, 64 MB in all), which the prompt names by
   workspace-relative path. Other ignored files are not sent. They travel one of two
   ways (see [how workspaces travel](#how-workspaces-travel)): as a Git bundle of only
   what the computer lacks when its runner supports it, or as a tar in 512 KB chunks,
   at most 512 MB.
2. The computer starts if needed, waiting up to 20 minutes (a first image build is slow).
   The agent CLI starts in the uploaded copy with the task's prompt on standard input.
3. Its output is read about once a second and fed to the same event parsers as a local
   process; stop, quota handoff and the six-hour limit stop it on the computer. When
   reads fail, the attempt keeps trying for 30 minutes, reconnecting every five failed
   reads and starting the computer again if it stopped, then carries on where it left
   off. A stopped attempt gives up after 30 seconds without contact. Past the window the
   attempt ends as lost contact and its changes stay on the computer until the attempt
   is continued, or until they are recovered once another attempt has replaced it.
4. When it ends, its changes since the upload come back as a binary Git patch, checked
   by SHA-256 (from a bundle, the patch is rebuilt on this device from the result
   bundle), and are applied to the local workspace with `git apply`, which changes
   nothing unless the whole patch applies. Changes to the Jackalope context are left
   out (`--exclude`), so an agent cannot alter it; new files it saved, such as
   screenshots under `.jackalope/artifacts`, come back and stay ignored by Git, like
   the same files from a local agent. A patch that does not apply is saved as
   `<attempt>.remote.patch` (with a bundle's saved output in `<attempt>.remote.artifacts`)
   and the attempt reports where. An agent
   stopped because nobody read it for ten minutes, or by a computer restart, ends the
   attempt unsuccessfully, but its changes still come back. Then the attempt completes
   like a local one.

The command is the local one translated: the program is the CLI on the computer's PATH,
local paths and profile directories are dropped, and the computer is the sandbox, so
Claude Code runs with `--permission-mode bypassPermissions` and Codex with
`sandbox_mode="danger-full-access"`. Persistent Claude Code sessions are not used
remotely. The agent CLI does not need to be installed on this device: for a project with
a computer, launch checks only the agent's adapter and model settings, and this device's
account profiles are neither required nor checked. Automatic routing still chooses among
agents installed here; for a fork that must stay on a computer (see
[swarms across hosts](#swarms-across-hosts)) it offers only Claude Code and Codex. The copy lives at `~/.jackalope-runs/w<hash>/workspace`, named
from the local workspace path, so a continuation reuses the path and the agent's own
session resumes; the run's folder is removed after its changes come back (for a bundle,
with its worktree, branch and refs; the project's repository keeps the commits).

### The runner

Every attempt has a runner, the execution host that owns its workspace: the local runner
(`tasks/runner/local.rs`) for an agent on this device and the remote runner
(`tasks/runner/remote.rs`) for one on the project's computer. The task runtime builds the
agent's command and prompt once, then takes either runner through the same steps
(`TaskRuntime::run_attempt` in `tasks/runner.rs`): prepare the workspace (the local
worktree as it is, or the upload described above), start the agent, follow its events
until it ends (with stop and quota handoffs, and reconnection on a computer), and collect
its result (nothing on this device; the patch or bundle from a computer). The attempt then
completes on this device in both cases.

The local runner reports the `device` capability with every workspace capability, so the
[placement table](#agents-on-a-computer) offers it every tool and adds nothing to its
instructions; a computer's runner cannot claim `device`. A running attempt's placement is
attached while its agent runs, and the bridge leaves the tools it makes unavailable out of
`tools/list` for either runner. What workspace tools did (pages visited, screenshots,
browser interactions and tab changes, accessibility audits and, on a computer, the saved
check's outcome) is recorded by one function (`tasks/runner/record.rs`), which names the
computer in the activity and lists a computer's screenshots once they come back with the
agent's changes.

The command itself still differs where the hosts do: an agent on this device uses its
account profiles, project secrets for this device, directly delivered connections and,
for Claude Code, a persistent session; one on a computer uses the sign-ins and connections
described in this section.

### Swarms across hosts

Planned and swarm work (each assignment of an approved plan or automatic subtasks, its
combined review and a swarm round's work) is placed across a capacity pool: this device
and the computers that support runs (local sandboxes, cloud machines and Agent37
computers). The pool holds the project's own computer, which the project pins, and any
other computers the person adds under **Swarms run on** in Project settings (saved per
project in `computers/pool.json`). **Swarms run on** chooses **Anywhere**, **Computers
only** or **This device only**; a project that never chose runs anywhere, which without
added computers places every fork where it ran before the pool existed: on the project's
computer when it has one, otherwise on this device. The choice is offered once there is
a computer to run on.

Each host has a concurrency limit. This device keeps the queue's limit of one to six;
computers together keep the queue's limit on agents on computers (8 by default); the
project's computer may take up to that limit, and an added computer takes two runs at a
time unless its runner reports `slots` (1 to 32) in `hello` or `run_status`. Health comes
from runs: a computer is last seen when a run's status or output read succeeds, and lost
when it cannot be started or reached or contact is lost. A lost computer gets no new work
for ten minutes unless it is reached again first. When each computer was last reached
and when and why contact was lost are saved, atomically, in `computers/host-health.json`
beside `pool.json` (at most 64 computers; reaching a computer is written at most every
five minutes, losing or regaining contact at once). It is loaded at startup, so a
computer lost less than ten minutes before a restart stays skipped for the rest of that
time; an unreadable file, or an entry whose time cannot be read, counts as never lost.
What runners reported (`browser`, `slots`) is not saved and is learned again from runs.

When the queue reserves a fork, the placer (`computers::pool::place`) decides, the same
way every time for the same hosts, loads and needs:

1. Hard boundaries come first. The project's choice limits the hosts. A fork that can only
   run on this device never goes to a computer: its agent is not Claude Code or Codex, its
   instructions name a [project secret](AGENT-ACCOUNTS.md#project-secrets) available only
   to this device, or a connection selected for its plan cannot reach a computer (see the
   connection rules above). A fork that names a secret available only to computers never
   runs here. A fork with a browser-checked criterion needs the browser tools: this device,
   a computer whose runner reported `browser`, or the project's computer until a run shows
   it lacks them. A fork no host can take stops with the reason, like any dispatch error,
   and pauses the project's queue.
2. Computers out of contact are skipped; if that leaves none, the fork waits.
3. The fork's home host takes it while it has a free slot: the project's computer when it
   pins one, otherwise this device.
4. Otherwise the host with the most free slots takes it (then the fewest running, this
   device, the name and the id). A project that pins a computer keeps forks off this
   device while that computer is in contact, so adding computers is what spreads its work.
5. With no free slot anywhere, the fork waits.

The chosen host and the reason are saved on the attempt (`host`) and its activity says
`Placement: …`. Other queued tasks keep to their project's computer or this device under
the same limits. Plan-mode planners, swarm orchestrators and deciders stay where the
project's agents run, except that **This device only** keeps them here too. A continuation
returns to its earlier attempt's host, where its agent session and anything left behind
are.

Under **Computers only**, a fork placed on a computer (and a continuation of an attempt
that ran on one) never runs on this device. With the `auto` agent, routing offers only
agents that run on a computer (Claude Code and Codex); if none of them has an enabled
account with quota, the attempt fails with that reason instead of choosing another
agent. An attempt whose agent cannot run there fails the same way at launch. Under
**Anywhere** and **This device only**, such an agent still runs on this device and the
placement says why.

A fork whose attempt failed because its host was lost (the computer could not be started
or reached before the agent ran, contact was lost for the whole 30-minute window, or the
computer no longer exists) is retried once while its plan's dispatch runs, as a new
attempt on another host it may use, this device included. The failed attempt's activity
says where the retry went, or why there was none; a retry that loses its host too is not
retried again. The retry starts fresh; it does not bring back changes the lost run left
on that computer. An agent that fails on a host that answered is an agent failure and is
not retried.

The swarm board, its map and a plan's round view name each fork's host and show a line
per host with its running attempts against its limit, or lost contact. Task details show
the host and why it was chosen, and the phone companion shows the host in task details.

#### Changes left on a lost computer

An attempt that loses contact mid-run records that its changes stayed on the computer
(`host.left` on the attempt). The run's folder there, its Git-sync worktree, its
`jackalope/<run>` branch and its `refs/jackalope/incoming/<run>/` and
`refs/jackalope/result/<run>` refs are all keyed by the run name, which follows the local
workspace path; only `refs/jackalope/base/<commit>` is shared by the project's runs.

Once another attempt has replaced the lost one (a host retry, or any retry of it) and
the computer answers again, a background sweep (`tasks/runner/recovery.rs`, every 30
seconds, asking each computer at most once a minute) recovers them. It asks a computer
once the pool no longer skips it (a run has reached it since, or its ten minutes have
passed) and its provider reports it running, and recovers when it answers; a stopped
computer is never started for this. The changes
are collected the way a finished run's are and saved beside the lost attempt's history as
`<attempt>.remote.patch`, with saved output in `<attempt>.remote.artifacts`, as a patch
that does not apply is saved. They are never applied to the workspace, because the retry
may have moved on. The run is then removed from the computer, folder, worktree, branch and
refs together, so no later run of the workspace there can bring them back. The lost
attempt's activity records the recovery, and its task details show **Changes recovered
from** the computer with a button to copy the patch path (and the output path).

Until then, a continuation of the lost attempt still brings its changes back. Any other
attempt of that workspace placed on the computer saves them for the lost attempt first,
with a line in its own activity; if they cannot be fetched then, they are discarded so
they cannot mix into its run. The sweep gives up after three failed fetches and leaves
the changes on the computer, saying so in the activity. Changes on a computer that was
removed are reported as lost.

### How workspaces travel

A computer's runner reports its runs protocol and capabilities in `hello` and
`run_status` (`runs: 4`, `capabilities`). The workspace goes as a Git bundle when the
runner reports both `git-sync` and `artifacts` (bundles travel as artifacts) and the
workspace is a Git repository of its own; otherwise it goes as a tar and comes back as a
patch exactly as described above.

- **Up.** The computer keeps one bare repository per project,
  `~/.jackalope-runs/.repos/p<hash>.git`, named from the local repository's common Git
  directory, so every task worktree of a project shares it. `sync_status` lists the base
  commits it holds (the newest 64). Jackalope records the workspace's tracked files and
  untracked files Git does not ignore as a synthetic snapshot commit whose parent is
  `HEAD`, and bundles it without the listed commits this repository also has, so a
  retry, a continuation or a later attempt after a checkpoint sends only what changed.
  The snapshot is built in a temporary repository that reads the workspace's objects
  through `objects/info/alternates` and writes only its own, with its own index and ref,
  so no commit, object, ref, reflog or index entry is added to the person's repository.
  Git safeguards are untouched: the person's repository is only read.
- **On the computer.** `sync_checkout` verifies the bundle, fetches it into the
  project's repository and checks the run's workspace out as a worktree of it: `HEAD`
  at the task's base commit on the branch `jackalope/<run>`, the person's uncommitted
  changes uncommitted, so the agent sees the project's history and `git status` as on
  this device. Copied setup files and Jackalope context are ignored by Git, so a bundle
  cannot carry them; they go beside it as a small side tar (an artifact, unpacked with
  the same path checks as an uploaded tar) and the repository ignores `.jackalope/`.
- **Back.** `sync_result` commits the working tree as a synthetic result commit on top of
  whatever the agent committed, leaving out the side tar's files, and bundles it with the
  uploaded snapshot against the base. Jackalope rebuilds the patch from snapshot to
  result in a temporary repository and applies it as above, so the agent's commits are
  flattened into the attempt's own checkpoint as for a tar upload. Files under
  `.jackalope/artifacts` come back as artifacts (at most 2,000 files, 256 MB), written
  only after the patch applied and skipped when an identical file is there. Changes the
  agent made to copied setup files stay on the computer.
- **Size.** The first bundle of a project carries its history; when the repository's
  stored history is above 512 MB, or a bundle would be, the workspace goes as a tar
  instead, as it would have. The returned bundle is limited to 256 MB, like the patch.

A workspace that a bundle cannot represent faithfully goes as a tar, and the activity
says why: a folder that is not a repository or sits inside another one, a repository
with no commits, a shallow or partial clone, a SHA-256 repository, or one whose
attributes assign a Git filter such as LFS (a bundle holds the filtered pointers, not
the files). A bundle that fails to send falls back to the tar as well. Git runs on this
device through the same isolated, time-limited Git command as other workspace
operations, with forward-slash paths in the alternates file so Windows and macOS hosts
behave alike.

Artifacts are content-addressed (SHA-256) files sent in 512 KB chunks, so no request
nears the 1 MB body limit whatever their size. `artifact_stat` reports whether the
computer holds one or how much of it arrived: a stored one is not sent again and an
interrupted one resumes at its last byte (up to four tries). Downloads append to a
`.part` file and resume the same way. The computer checks the hash when the last chunk
arrives and this device checks it before using a download; a mismatch discards the
partial file and fails the transfer. The computer keeps artifacts in
`~/.jackalope-runs/.artifacts`, at most 1 GB each, and removes those unused for a day.
They also carry large bridge answers (see the relay below).

Agents on a computer never use this device's account profiles. They use **Agent sign-ins
for computers** in Settings → Computers: a Claude Code token from `claude setup-token`
(`CLAUDE_CODE_OAUTH_TOKEN`), an Anthropic API key (`ANTHROPIC_API_KEY`) or an OpenAI
API key (`CODEX_API_KEY` and `OPENAI_API_KEY`). They are stored in protected storage
(`computers/secrets/agent-credentials.bin`), shown only as saved or not, and passed to
the run's environment only. A missing sign-in fails the attempt with where to add it.

[Project secrets](AGENT-ACCOUNTS.md#project-secrets) whose **Available to** includes agents on computers
are added to the run's environment as well. They replace a variable of the same name
from the translated command and are kept even when the value looks like a local path,
but never replace a sign-in variable or one of Jackalope's own `JACKALOPE_*` variables.
The attempt's activity names the secrets the agent received, never their values.

This device is the control plane of an agent on a computer: it keeps the sign-ins and
credentials, approvals and policy (including autonomy deciders), orchestration, history
and review, and the final Git integration. The computer's agent (`agent.py`) is the
run's runner, which owns the uploaded workspace and the tools that touch it. The run
protocol is versioned (`runs` in `hello` and `run_status`). From protocol 4 the runner
also reports `capabilities`, and `computers/runner.rs` turns them into
`RunnerCapabilities`; each behaviour below that needs one is used only when it is
listed, so a computer on an older image keeps the protocol 3 behaviour exactly:

| Capability | What the runner does |
| --- | --- |
| `local-bridge` | Serves the agent's Jackalope MCP server and bridge routes on the computer's loopback, answering the tools placed with the workspace itself |
| `workspace-tools` | Runs `computer_verify`, `verification_output` and `read_context` in the computer's workspace |
| `browser` | Runs the browser tools through agent-browser on the computer's Chromium; left out when the image has no agent-browser |
| `policy-callbacks` | Asks this device before opening a website, and sends the approval hook's questions to `POST /v1/policy` |
| `artifacts` | Stores and serves content-addressed, resumable transfers, and receives bridge answers above 512 KB from one (see [how workspaces travel](#how-workspaces-travel)) |
| `git-sync` | Keeps a repository per project and takes workspaces as Git bundles, returning results the same way; used only together with `artifacts` |

The bridge reaches the agent through a relay (`computers/relay.rs` and the run's
supervisor in `agent.py`). The supervisor serves the bridge on a free `127.0.0.1` port
inside the computer with a random secret of its own, which replace
`JACKALOPE_BRIDGE_URL`, `JACKALOPE_BRIDGE_TOKEN` and the bridge address in the agent's
MCP configuration; requests without that secret or carrying an `Origin` header are
refused, and the attempt's real bridge credential never leaves this device. When the
runner has `local-bridge`, `run_start` names the tools it serves (`local`, with the
attempt's saved check) and the runner answers their MCP calls and REST routes itself.
Every other request (at most 64 KB, 32 waiting) is queued, handed to Jackalope by the
next output read, which then returns early, and forwarded to the local bridge with the
attempt's credential on its own thread, so a long call such as `ask_user` does not
stall output. Answers go back through `run_answer`, at most 512 KB each, or up to 16 MB
when the runner has `artifacts`: a larger answer is uploaded as an artifact first and
`run_answer` names it. A call unanswered for 40 minutes gets a timeout. A larger MCP
tool call, or an answer above that limit, comes back to the agent as a tool error that says nothing ran (for a request) or
that the call ran and to ask for less (for an answer), not as a timeout or transport
failure. Answers of tools the runner serves do not pass through the relay, so its limits
do not apply to them.

Each bridge tool declares in one table (`computers::runner::TOOLS`) whether it executes
with the workspace or on the control plane; `coordination_mcp`'s tests keep the table
complete. With the runner's capabilities it gives the agent's tool list, what the relay
refuses, the agent's instructions and the attempt's activity line, which names the
runner's protocol and capabilities, the tools that run on the computer and those that
are unavailable there. Unavailable tools are left out of the tool list and refused when
called; a workspace tool that should have run on the computer and reaches this device
is refused rather than run against this device's copy:

| Tool | Placement | Protocol 4 runner with the capability | Older runner |
| --- | --- | --- | --- |
| `computer_verify`, `verification_output`, `read_context` | Workspace (`workspace-tools`) | Writing attempts: on the computer. Read-only attempts: this device's identical copy | Read-only attempts only; otherwise unavailable |
| Browser tools | Workspace (`browser`, with `policy-callbacks`) | On the computer, every computer type | The computer's Chromium from this device on a local sandbox with networking; otherwise unavailable |
| `browser_open_profile`, `peer_adopt`, `permission_prompt` | This device only | Unavailable | Unavailable |
| `desktop_control`, `computer_exec`, `computer_request` | Control | Act on the agent's computer, as for a bot's computer | Same |
| Peers, messages, `ask_user` and `user_response`, `request_human_action`, `propose_subtask`, plan deviations, agreements, validation steps, decisions, Jev questions, bot tools | Control | This device, as for a local agent | Same |
| On-demand connections over HTTP | Control | `search_tools`, `read_tool`, `read_tool_result` and `execute_tool` reach them on this device | Same |
| On-demand stdio connections | Not bridge tools | Writing attempts: run on the computer as the agent's own MCP servers; read-only attempts: on this device through on-demand tools | Same |
| Directly delivered connections | Not bridge tools | Withheld | Withheld |

A read-only attempt (a planner, a swarm orchestrator) keeps the workspace tools on this
device: it changes nothing, so this device's copy is what it reads, and the plan's check
result is recorded where the planning round reads it. `peer_adopt` applies another
attempt's changes to this device's copy while the agent edits the computer's, which
would break the single writer of each workspace and be overwritten or conflict when the
agent's patch comes back; `browser_open_profile` opens profiles holding this device's
sign-ins.

On the computer, `computer_verify` runs the project's saved check, the same command
Project settings saves for the attempt, with `/bin/sh -c` in the workspace without the
bridge variables, under the same limits as a check here (30 minutes, stopped after 10
minutes without output, 128,000 bytes kept per stream). Only `{}` or the exact saved
command is accepted. A passing result is reused while the workspace's Git tree is
unchanged. Its answer has the same shape as on this device, and the stored result,
which `verification_output` pages by character, stays in the run folder outside the
workspace. The attempt's activity records each check's outcome. The saved check still
runs on this device after the changes come back, as for every attempt. `read_context`
reads source blocks with the same path rules, limits and block hashes as here; its
repository search ranks files by plain text matches in the computer's copy rather than
by this device's symbol map. It is offered only when source context reads are enabled.

The browser tools on the computer start agent-browser (installed in the image at the
version this app bundles) on the computer's own Chromium, so a server the agent starts
there is reachable at `localhost`. They take the same requests and give the same answers
as here. Before opening a site, and on the page each command ends on, the runner asks
this device through `POST /v1/policy` with kind `site`; the computer's own pages
(`localhost`, `127.0.0.1`, `::1`) and non-web addresses are not asked about. This device
answers with the computer's per-site questions and saved decisions (allow for this task,
always allow, decline, never allow, saved under the project), and a page with a visible
password field asks the person to sign in through **Watch / take over** instead; while a
question waits the tool returns that it asked and to call again, and page content is
withheld until the site is allowed. `browser_screenshot` saves its capture as
`.jackalope/artifacts/screenshots/<id>.png` in the computer's workspace and returns that
path, so the agent can open the image. Captures come back with the agent's changes
(added even when the project's ignore files cover `.jackalope`) and are then listed with
the attempt and its review, with the name and address the runner reported.
`browser_navigate` records local pages for review, interactions and tab changes are
recorded in the activity, and an accessibility inspection adds its validation step, as
here.

Policy callbacks have explicit kinds. `tool` decides a tool of a stdio connection that
runs on the computer exactly as `POST /v1/tools/approve` does (see below), and `secret`
answers whether a named [project secret](AGENT-ACCOUNTS.md#project-secrets) is
available to agents on computers, never returning its value. The answer is
`{"behavior":"allow"}` or a denial with a message; the runner treats anything else, an
unknown kind, an error, a device that cannot be reached or no answer within 1,900
seconds, as a denial. What the runner's tools did reaches this device as
`POST /v1/runner/event`, which only adds to the attempt's activity, screenshots and
validation steps.

Connections selected for the task, project and managed all-project ones such as
Composio alike, reach an agent on a computer only when they are on-demand. Before
launch, `mcp::remote_delivery` decides for each:

- every directly delivered connection is withheld: its command, environment references
  and CLI sign-ins exist only on this device. As a second check, the translated command
  keeps only the `jackalope` entry of Claude Code's `--mcp-config` or Codex's
  `mcp_servers` override; a configuration it cannot read stops the launch;
- on-demand HTTP connections, and every on-demand connection of a read-only attempt,
  stay with the broker on this device and reach the agent through the bridge relay, so
  their credentials, OAuth and processes never go to the computer. A read-only attempt
  changes nothing, so this device's copy of the workspace is what its agent reads;
- on-demand stdio connections of a writing attempt run on the computer, in the workspace
  the agent edits, as entries of the agent's own MCP configuration (see below);
- a stdio connection that cannot run there falls back to the broker on this device only
  when it does not use the workspace, and is withheld otherwise.

A stdio connection runs on the computer when its command is a runtime the image has or
installs: `npx`, `node`, `npm`, `python3`, `python` (run as `python3`), `uvx` and `uv`
(installed into `~/.local` on first use), `git`, `sh` or `bash`; a Windows extension such
as `npx.cmd` is dropped. Docker, Podman, Windows shells, paths to programs and other
programs installed on this device cannot run there. Its arguments and environment are
resolved on this device: a value naming the attempt's workspace or the project folder, or
a path inside them, becomes the same path relative to the computer's workspace (the
server's working directory); `${NAME}` is replaced with the project secret of that name
when the secret is available to computers; a value naming another file on this device,
or a `${NAME}` without such a secret, keeps the connection off the computer. A
connection uses the workspace when an argument or value names it or a relative path
(`.`, `./…`, `${workspaceFolder}`, `$PWD`), or when its command or arguments contain a
word such as `filesystem`, `file`, `git`, `repo`, `workspace`, `lsp`, `serena` or
`shell`; such a connection is withheld rather than run against this device's stale copy.

The resolved command, arguments and environment are treated like project secrets
available to computers: they go to the computer only in the run's `run_start` request,
never in the agent's command line, its MCP configuration, logs or activity. The
computer's agent writes each connection to a private file in the run folder, outside the
workspace and so outside the patch, and removes the files when the run ends. The agent's
MCP configuration starts each server through `agent.py mcp-launch <file>`, which runs the
command in the workspace with the connection's environment and without the bridge
variables: Claude Code gets the entries in its `--mcp-config`, Codex gets
`mcp_servers.<name>` overrides after the bridge's own table (with a two-minute startup
timeout for first downloads). Entry names are the connection IDs with only letters,
digits, `-` and `_`. A connection whose program is still missing on the computer (an
unknown command, or uv that cannot be downloaded) is left out and named, with its
reason, in the activity and in the agent's input. A computer whose agent predates these
connections (`run_status` without `runs` of 3 or more) runs without them and the activity says to
update its image.

Activity names every connection that runs on the computer, falls back to this device or
is withheld, with its reason and never its values, and the agent's instructions say the
same. An agent that keeps on-demand connections is told the size limits, once the run
knows its computer's runner. With `artifacts`, results arrive whole up to the broker's
1 MB limit, as on this device. Without it, results above about 480 KB are captured on
this device and returned as a 2,000-character
preview with a `resultHandle` for `read_tool_result`, so they fit the relay's answer limit;
a result that cannot be previewed (an error or non-text content) returns a tool error
asking for a smaller result. A `read_tool_result` page above the limit is refused with
the same advice.

Claude Code on a computer runs with `bypassPermissions` and without Jackalope's
permission prompt tool, so for those attempts the bridge asks before `execute_tool`
runs, over MCP or `POST /v1/tools/execute`, exactly as the local prompt would for
`mcp__jackalope__execute_tool`: a project's "always allow" rule approves it, otherwise
auto-approval decides as locally and records `Auto-approved` in the activity, and
anything else becomes the same Allow once / Always allow / Deny question. A denial is
returned as a tool error. `read_tool` and `search_tools` are not asked about, as
locally. Codex keeps its own noninteractive approval policy on a computer, as on this
device.

Tools of stdio connections that run on the computer are not behind the bridge, so for
Claude Code the computer's agent adds a `PreToolUse` hook for them (`--settings`,
matching `mcp__<entry>__.*`). The hook (`agent.py mcp-approve`) sends the tool name and
input through the relay to `POST /v1/tools/approve`, or to `POST /v1/policy` with kind
`tool` when the run has the runner's local bridge, which decides with the same project
rules, auto-approval and question as Claude Code's permission prompt for that tool on
this device and records the outcome in the activity. Anything but an explicit allow,
including a bridge that cannot be reached, denies the call. An input above the relay's
64 KB limit is judged from a 4,000-character preview. Without the bridge relay these
connections do not start for Claude Code. `mcp__jackalope__*` tools and other names are
refused by that route.

A read-only attempt runs with the same read-only CLI settings as locally (Claude Code
without edit tools and without its permission prompt, so tools needing approval are
refused; Codex with `sandbox_mode="read-only"`). It uploads to a run folder of its own
(`~/.jackalope-runs/r<hash>`), so it never shares one with a writing attempt of the same
workspace, and nothing comes back from it: if it changed files on the computer anyway,
the attempt reports how many and they are discarded with its run folder. A read-only
run left behind by lost contact is discarded the same way when planning continues. A computer whose agent predates the relay (a cloud
machine on an old image) runs the agent without the bridge and says so.

Agents on project computers have their own concurrency limit (8 by default, up to 32),
separate from this device's one to six, shared by every computer in the
[capacity pool](#swarms-across-hosts). The project's queue shows it as **On
computers** beside **Concurrent tasks** when the project has a computer, and sets it
through `queue_dispatch`'s `remoteConcurrency`. A run holds its computer against the
idle stop, and the attempt's details show the computer it ran on. On the computer, a run
is owned by a detached supervisor that survives reconnects; if nobody reads it for ten
minutes, for example because Jackalope closed, it is stopped. After a restart the
attempt is interrupted like a local one and is not rerun; continuing it brings back what
its run left on the computer.

## Agent37

Agent37 computers run on the person's own Agent37 account and bill to its balance.
Settings → Computers (or the computer chooser) takes one API key (`sk_live_…`), checked
with Agent37 before it is saved in protected storage (`computers/secrets/agent37.bin`),
and shows this month's spend from `GET /v1/usage`. The key cannot be removed while an
Agent37 computer exists.

The first start creates a template named `jackalope-computer-<hash>` (the local image
tag's hash) in the workspace. It first registers this version's [published
image](#the-image) by registry import (`POST /v1/templates` with its `image_ref`), which
Agent37 copies once and pins by digest. When that import is refused (no published image
for this version and definition, or the package is not public) it falls back to
Agent37's template builds: the build context is uploaded, built on Agent37 and published
to the workspace. A changed image definition makes a new template. Each
computer is one instance from that template, created with its own pairing secret and
viewer password in its environment, and with auto sleep after its idle stop time
(Agent37 accepts 5 minutes to a day; Never turns auto sleep off). The instance id is
kept in `computers/agent37.json` and its secret in `computers/secrets/agent37-<id>.bin`.
Jackalope reaches the agent at `https://<instance>-8765.agent37.app` with
`X-Agent37-Key` for Agent37 and the pairing secret as `Authorization`. Any request
wakes a sleeping instance. **Stop** stops the instance; deleting the computer deletes the
instance and its files. There is no viewer for Agent37 computers yet.

**Jackalope-hosted** is listed as coming soon. Its provider exists so saved records and
settings have a stable name, and every operation reports that it is not available.

## Providers and the in-sandbox agent

`commands/computers.rs` owns the index (`task-runs-v1/computers/computers.json`, written
atomically; an unreadable file is preserved and blocks changes), secrets, background
starts and the bounded wait for them, cached connections, run routing,
`computer_request`, `computer_exec` and the app commands. `computers/usage.rs` owns
activity, run and viewer holds, the idle sweep, the quit stop and the quit preference.
`last_used_at` in the index is rewritten at most every five minutes; idle time itself is
kept in memory. Records from newer builds with unknown providers load and report
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

`computers/docker.rs` (`local-docker`), `computers/remote.rs` (`remote-machine`) and
`computers/agent37.rs` (`agent37`) are the implementations; a VM API provider adds a
module and a branch in `provider`. `computers/runs.rs` is the run protocol client,
command translation and patch handling, `computers/relay.rs` the bridge relay,
`computers/runner.rs` runner capabilities and tool placement, `computers/pool.rs` the
capacity pool, host health and the placer (with `coordination/hosts.rs` refreshing it,
working out each fork's needs and retrying lost hosts), `computers/policy.rs` the
answers to the runner's policy callbacks and events, `computers/sync.rs` the Git bundles
of `git-sync`, `computers/artifacts.rs` the artifact transfers,
`computers/credentials.rs` the agent sign-ins for computers, and
`tasks/runner/remote.rs` the attempt side of an agent on a computer, one of the two
runners behind `tasks/runner.rs` (see [the runner](#the-runner)).
`desktop_control/computer.rs` runs desktop actions on a computer and
`computers/browser.rs` attaches the computer's browser to the task browser through
`browser::set_router`, gated by the same site questions, which also answer a runner's
`site` callbacks.

`agent.py` uses only Debian's Python with Pillow, pyatspi, `xdotool`, `wmctrl`, `xclip`,
`scrot`, and agent-browser for the runner's browser tools. It answers the helper protocol's `hello` (`protocol: 1`) and `list`,
`snapshot` (AT-SPI elements with screen bounds, at most 300, password text protected),
`screenshot` (base64 PNG, optional `thumb` width), `click`, `double_click`, `right_click`,
`drag`, `scroll`, `type`, `set_value`, `press` (`chord` with modifiers and key), `focus`,
`open_app`, `clipboard_read`, `clipboard_write`, `open_url` and `exec`. `hello` and
`run_status` also report `runs: 4` and `capabilities` (the `CAPABILITIES` list, one name per line, without
`browser` when agent-browser is missing) for the run actions, which need no display: `workspace_put` (one
base64 chunk at a byte offset; the final chunk carries the archive's SHA-256, unpacks
it rejecting absolute, `..`, `.git` and outside-pointing link entries, and commits it as
the base), `run_start` (a command with environment and standard input under a detached
`agent.py supervise` process, optionally with the bridge relay and with `mcp`, the
selected stdio connections, at most 16, and with `local`, the tools the runner serves and
the saved check; the specification holding credentials is deleted once read, and the
result lists connections that could not start and the tools the runner serves),
`run_read` (output after byte offsets and up
to eight waiting bridge requests, each handed over once unless `reclaim` asks again,
waiting up to five seconds, with the exit once both streams are read), `run_answer`
(one bridge answer, inline or as a named artifact), `run_status` (whether the run exists,
was uploaded, synced from a bundle and started, and its exit), `run_stop`,
`workspace_diff` and `workspace_get` (the binary patch from
the base, including anything the agent committed) and `run_remove` (for a synced run
also its worktree, branch and refs). With `artifacts`: `artifact_stat`, `artifact_put`
(one chunk at an offset, 0 restarting; the chunk that completes the announced size
checks the SHA-256 the artifact is named by) and `artifact_get` (a chunk from an
offset). With `git-sync`: `sync_status` (the base commits a project's repository holds),
`sync_checkout` (verify and fetch an uploaded bundle, check the snapshot's parent is the
named base, check the worktree out and unpack the side tar) and `sync_result` (the
result bundle with the snapshot, and the `.jackalope/artifacts` manifest). Runs of one
project take a lock on its repository while they change it. The supervisor
holds a lock on the run's `owner` file for its life; a started run whose lock is free and
which has no exit (its computer restarted) is recorded as `interrupted`. An agent from
before these actions reports `runs: 1` and answers `run_status` as unsupported; one from
before stdio connections reports `runs: 2` and no `runs` in `run_status`; one from before
the runner reports `runs: 3` and no capabilities, and keeps the tar and patch. Run
actions keep their state in files under `~/.jackalope-runs` and do not take the HTTP
agent's lock that serializes desktop actions. Snapshots and
screenshots report the active window and, when Chromium is in front, its current page
URL as `site`. `start.sh` starts Xvfb (1280 × 800 by default), a private D-Bus session,
the AT-SPI bus, Openbox, x11vnc with noVNC when a viewer password is set, Chromium with
remote debugging, and the HTTP agent when a pairing secret is set.

## The image

The image is Jackalope's own definition; it uses no Cua code. It installs Debian
packages, including Chromium, Xvfb, Openbox, x11vnc, noVNC and websockify, under their
own licenses, plus Git and Node with the Codex CLI and agent-browser (at the version the
desktop bundles, checked in `build.rs`) from npm for agents on a computer.
Claude Code's license does not allow redistributing it, so it is not in the image: the
first run that needs it installs `@anthropic-ai/claude-code` from npm into the home
volume (`~/.local`, first on `PATH`) within 100 seconds, which needs networking. The
first run with a connection that needs `uvx` or `uv` installs uv the same way, from
uv's latest GitHub release for the computer's processor, checked against its published
SHA-256. The image has no Docker.

`.github/workflows/computer-image.yml` publishes the image for linux/amd64 to
`ghcr.io/jackalope-dev/jackalope-computer` on every push to `beta` or `stable` and on
manual dispatch; it has no pull request trigger and pushes with the workflow's
`GITHUB_TOKEN` (`packages: write`). `scripts/release/computer-image.mjs` reads the
repository from `REPOSITORY` in `commands/computers/image.rs`, the version from the
desktop `Cargo.toml` and the definition hash from the same files as
`docker::image_tag`, and tags the image `<version>-<hash>`, `<version>` and
`sha-<commit>`; the run summary records the pushed digest. The app only uses
`<version>-<hash>`, so it never runs an image whose definition differs from its own.
Before pushing, the workflow checks that the image keeps
`/usr/share/doc/<package>/copyright` for its Debian packages (the slim base keeps them),
`/usr/share/common-licenses/Apache-2.0`, the Codex package, agent-browser's program and
`/usr/share/doc/jackalope-computer/NOTICE`, and does not contain Claude Code. Labels
record the source, revision, version and definition. The package must be public for
anonymous pulls and Agent37 imports; set that once in the package's settings.

## Checks

`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib computers::` covers
records and compatibility, settings bounds, one machine per bot, the hosted refusal,
Docker detection messages, container arguments, loopback ports and viewer URLs, the
image tag, cloud address and secret validation, the idle stop choices and their
exclusion from the container configuration, idle decisions and status text, viewer
holds and the quit preference. `cargo test … --lib computers::runs computers::relay
tasks::runner` covers command translation with and without the bridge relay,
credentials, the workspace archive with copied setup files, chunked upload and patch
checks, line splitting, patch application, the read-only run name, and the relay's
refusals, the computer's browser and read-only access, and
forwarding with the attempt's credential; `tasks::runner::remote` also covers when stdio
connections start with a run and that activity and instructions carry no values;
`tasks::runner` runs one launch through the local runner (a real agent process) and the
remote runner (a stand-in protocol 4 runner) and checks that both record the same result,
deliver the same input apart from the placement instructions and place every tool from
the same table, and `tasks::runner::record` that both record the same tool events;
`mcp::tests` covers the connection policy for computers (where each connection runs,
command and path translation, `${NAME}` secrets, fallback and withheld reasons, values
kept out of `Debug`); `coordination_mcp` covers which tools the approval route accepts
and that every bridge tool has a placement; `computers::runner` covers capability
negotiation, including the protocol 3 fallback, the device runner and attached placements,
and where each tool runs and which reach the
tool list for each capability set; `computers::relay` also covers forwarding only control
tools for a runner with the local bridge; `computers::policy` covers the policy kinds,
secrets answered without values, untrusted event text and finding returned screenshots;
`agent_context` covers the Jackalope context in the archive and its exclusion from
returned patches; `computers::sync` covers the bundle round trip against a stand-in
runner repository, deltas against the commits it holds, the snapshot staying out of the
person's repository, context edits left out, conflicts and bad bundles leaving the
workspace unchanged, the workspaces that go as files, artifact paths, a session that
syncs and brings back saved output, and older runners keeping the tar and patch;
`computers::artifacts` covers chunked uploads, resuming, skipping stored artifacts,
resumed downloads, hash mismatches and large bridge answers; `mcp_broker` covers
lifting the result limit;
`coordination::eligibility` covers the
separate concurrency for computer projects and planned work spread across the pool while
other queued work keeps its host; `computers::pool` covers placement by requirements,
secrets and connection boundaries, the project's choice, load balancing with a pinned
computer, per-host and shared limits, lost hosts and retries, the default matching the
placement from before the pool, saved choices and health, and saved health across a
restart (including unreadable files); `coordination::hosts` covers
which failed forks are retried after a lost host and where the retry goes; `tasks::runner`
also covers recording the chosen host once, continuations returning to their host, a
computer that does not answer becoming a lost host, **Computers only** keeping placed
forks off this device (at launch and in routing), and changes left on a lost computer
being saved, never applied, by the sweep or by a later attempt of the workspace, while a
continuation still brings them back; `computers::agent37` covers keys, instance
creation bodies, states, errors and the template build context.
`computers::image` covers the published reference and the definition hash shared with
`node --test scripts/release/computer-image.test.mjs`; `computers::agent37` also covers
the template import body and its fallback.
`python3 apps/desktop/scripts/computer-agent.test.py` (POSIX, for example in WSL) covers
the on-demand CLI install and the run actions: upload, run, read, stop, the orphan stop, committed changes, unsafe
uploads, the bridge relay's hand-over and answers, a run whose supervisor died, stdio
connections (private launch files, Claude Code and Codex configuration, values absent
from the command line, run files and patch, request validation, uv install and the
`python` stand-in), the approval hook, and the runner: capabilities, `local` validation,
workspace tools answered on the computer while control tools are relayed, the saved check
and its reuse, stall and stored output, source reads, policy callbacks that allow only an
explicit allow (including no answer), site questions skipped for the computer's own pages,
and screenshots saved in the workspace and returned even when ignored; artifact resume,
deduplication and hash checks, the git-sync round trip (checkout, history, context and
setup files kept out of the result, artifacts, deltas, cleanup), refused snapshots and
large answers delivered from an artifact. The
opt-in `local_docker_computer_round_trip -- --ignored --nocapture` builds the image,
starts a computer, takes a screenshot and snapshot, runs a command, checks the home
volume survives a restart, runs a stand-in agent on an uploaded workspace with a copied
setup file and one relayed bridge call, applies its changes, and deletes everything; it
needs Docker and network access. These do not establish installed-app acceptance on each
operating system, Docker variant or cloud provider, real Claude Code or Codex runs on a
computer, bridge tools used by a real agent there, stdio connections and their approval
hook in a real Claude Code or Codex run there, the runner's local bridge and agent-browser
in a built image, lost-contact recovery against a real computer, Git-synced workspaces
and artifact transfers against a built image from Windows and macOS hosts, a swarm spread
across this device and several real computers, or a live Agent37 account.
