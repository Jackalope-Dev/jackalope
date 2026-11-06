#!/usr/bin/env python3
"""Jackalope bot computer agent.

Speaks the desktop helper's JSON-lines protocol: requests are
{"id": n, "action": ...} and responses {"id": n, "ok": bool, "result"|"error"}.

  agent.py serve          one request per stdin line (local sandboxes, via docker exec)
  agent.py http HOST:PORT POST /v1/call with one request per body; requires
                          JACKALOPE_COMPUTER_TOKEN as a bearer secret
  agent.py browser        start Chromium if it is not running
  agent.py supervise DIR  internal: owns one agent run started by run_start
  agent.py mcp-launch FILE  internal: starts one connection's MCP server
  agent.py mcp-approve    internal: Claude Code's hook that asks Jackalope
                          before a connection's tool runs

Coordinates are screen pixels. Element refs are resolved by Jackalope, which
sends coordinates. Screenshots are returned as base64 PNG.

Agent runs (hello reports `runs`) need no display. Jackalope uploads a task workspace in
chunks (workspace_put), starts the agent CLI in it (run_start), reads its output
by byte cursor (run_read), stops it (run_stop), then fetches the changes as a
binary Git patch against the uploaded files (workspace_diff, workspace_get).
Each run lives in its own directory and is owned by a detached supervisor, so
it survives reconnects; a run nobody reads for ORPHAN_SECONDS is stopped.

A run started with `relay` (runs protocol 2) gets the Jackalope bridge on
127.0.0.1 inside the computer. Its supervisor serves it with a secret of its
own, substituted for RELAY_URL and RELAY_TOKEN in the command and environment.
Each request becomes a file that run_read hands to Jackalope, which forwards it
to the bridge on its own device with the run's credential and answers through
run_answer, so the bridge credential never reaches the computer.

A run started with `mcp` (runs protocol 3, reported by run_status) also gets
the selected stdio connections Jackalope resolved on its own device. Each
connection's command, arguments and environment, which can hold credentials,
go to a private file beside the workspace, never into the command line, the
CLI's configuration or the patch; the CLI's entry starts the server through
`mcp-launch`. With `approve`, Claude Code's PreToolUse hook asks Jackalope
through the relay before each of their tools runs. Missing uv is installed
into the bot's home; a connection whose program is still missing is reported
and left out.

Runs protocol 4 adds capabilities, listed in CAPABILITIES and reported by hello
and run_status. With `artifacts`, files of any size travel in both directions
as content-addressed (SHA-256) objects in CHUNK_LIMIT pieces that resume from
the last stored byte (artifact_stat, artifact_put, artifact_get), and a bridge
answer above RELAY_ANSWER_LIMIT is delivered from one. With `git-sync`, each
project has a persistent bare repository here: Jackalope asks which of its
commits it holds (sync_status), uploads a Git bundle of only what is missing
plus a side tar of copied setup files and Jackalope context as artifacts, and
the run's workspace is checked out from them (sync_checkout); at the end the
result comes back as a bundle and a manifest of .jackalope/artifacts output
(sync_result). Runs without either use the tar upload and patch above.
"""

import base64
import contextlib
import fcntl
import hashlib
import hmac
import io
import json
import os
import platform
import re
import secrets
import shlex
import shutil
import signal
import subprocess
import sys
import tarfile
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROTOCOL = 1
# Agent runs, reported by hello and run_status as `runs`.
RUNS_PROTOCOL = 4
# Runner capabilities, one per line, reported by hello and run_status.
CAPABILITIES = [
    "git-sync",
    "artifacts",
]
OUTPUT_LIMIT = 64 * 1024
BODY_LIMIT = 1024 * 1024
DEVTOOLS = "http://127.0.0.1:9222"
HOME = os.path.expanduser("~")
PROFILE = os.path.join(HOME, ".config", "jackalope-chromium")
ELEMENT_LIMIT = 300
VISIT_LIMIT = 4000
RUNS = os.environ.get("JACKALOPE_RUNS") or os.path.join(HOME, ".jackalope-runs")
RUN_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}")
CHUNK_LIMIT = 512 * 1024
UPLOAD_LIMIT = 512 * 1024 * 1024
PATCH_LIMIT = 256 * 1024 * 1024
READ_WAIT_LIMIT = 5.0
ORPHAN_SECONDS = int(os.environ.get("JACKALOPE_RUN_ORPHAN_SECONDS") or 600)
RUN_ACTIONS = {
    "workspace_put", "run_start", "run_read", "run_stop",
    "workspace_diff", "workspace_get", "run_remove", "run_status", "run_answer",
    "artifact_stat", "artifact_put", "artifact_get",
    "sync_status", "sync_checkout", "sync_result",
}
# Content-addressed transfers and the per-project repositories of git-sync.
# Neither name can be a run's, which starts with a letter or digit.
ARTIFACTS = os.path.join(RUNS, ".artifacts")
REPOS = os.path.join(RUNS, ".repos")
SHA256 = re.compile(r"[0-9a-f]{64}")
OBJECT_ID = re.compile(r"[0-9a-f]{40}")
REPO_ID = re.compile(r"[a-z0-9]{1,64}")
ARTIFACT_LIMIT = 1024 * 1024 * 1024
ARTIFACT_KEEP_SECONDS = 24 * 3600
# Bridge answers delivered from an artifact.
RELAY_ARTIFACT_LIMIT = 16 * 1024 * 1024
# Base commits a project's repository reports, newest first.
KNOWN_BASES = 64
RESULT_ARTIFACTS = 2000
RESULT_ARTIFACT_BYTES = 256 * 1024 * 1024
RELAY_URL = "@@JACKALOPE_RELAY_URL@@"
RELAY_TOKEN = "@@JACKALOPE_RELAY_TOKEN@@"
RELAY_BODY_LIMIT = 64 * 1024
RELAY_ANSWER_LIMIT = 512 * 1024
RELAY_TOO_LARGE = ("Jackalope tool calls from a computer are limited to 64 KB, so this call was "
                   "not sent and nothing ran. Send smaller arguments, for example over several calls.")
# Agent CLIs whose licenses do not allow shipping them in a published image are
# installed into the bot's home on first use, from the package registry.
ON_DEMAND = {"claude": "@anthropic-ai/claude-code"}
LOCAL_PREFIX = os.path.join(HOME, ".local")
INSTALL_SECONDS = 100
# Bridge calls handed over per read, and their total size.
RELAY_READ_CALLS = 8
RELAY_READ_LIMIT = 256 * 1024
RELAY_PENDING_LIMIT = 32
# Longer than the bridge's own longest call (a queued saved check).
RELAY_TIMEOUT = int(os.environ.get("JACKALOPE_RELAY_TIMEOUT") or 2400)
RELAY_HEADERS = ("content-type", "accept", "mcp-protocol-version", "mcp-session-id", "last-event-id")
CALL_ID = re.compile(r"[0-9a-f]{16,48}")
# Selected stdio connections of a run.
CONNECTION_LIMIT = 16
CONNECTION_KEY = re.compile(r"[A-Za-z0-9_-]{1,64}")
ENV_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,127}")
PROGRAM = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}")
UV_RELEASE = ("https://github.com/astral-sh/uv/releases/latest/download/"
              "uv-{arch}-unknown-linux-gnu.tar.gz")
UV_LIMIT = 128 * 1024 * 1024
# Longer than Jackalope waits for the person to answer an approval.
APPROVAL_SECONDS = 1900
GIT_IDENTITY = [
    "-c", "user.name=Jackalope", "-c", "user.email=jackalope@agents.jackalope.invalid",
    "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false",
]


class Failure(Exception):
    pass


def run(args, timeout=10, data=None):
    try:
        done = subprocess.run(args, input=data, capture_output=True, timeout=timeout)
    except FileNotFoundError:
        raise Failure(f"{args[0]} is not installed in this computer.")
    except subprocess.TimeoutExpired:
        raise Failure(f"{args[0]} timed out.")
    if done.returncode != 0:
        detail = done.stderr.decode("utf-8", "replace").strip()[:300]
        raise Failure(f"{args[0]} failed: {detail or done.returncode}")
    return done.stdout


def wait_for_display(seconds=15):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if os.path.exists("/tmp/.X11-unix/X1"):
            return
        time.sleep(0.1)
    raise Failure("The computer's display did not start.")


def screen_size():
    out = run(["xdotool", "getdisplaygeometry"]).decode().split()
    return int(out[0]), int(out[1])


def devtools(path, method="GET", timeout=2):
    request = urllib.request.Request(DEVTOOLS + path, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read(BODY_LIMIT) or b"null")


def browser_running():
    try:
        devtools("/json/version")
        return True
    except Exception:
        return False


def start_browser(url=None):
    if browser_running():
        return False
    width, height = screen_size()
    executable = shutil.which("chromium") or shutil.which("chromium-browser")
    if not executable:
        raise Failure("Chromium is not installed in this computer.")
    # The container is the isolation boundary; Chromium's own sandbox needs
    # namespaces Docker's default seccomp profile withholds.
    args = [
        executable,
        "--no-sandbox",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-dev-shm-usage",
        "--force-renderer-accessibility",
        "--remote-debugging-port=9222",
        f"--user-data-dir={PROFILE}",
        "--window-position=0,0",
        f"--window-size={width},{height}",
        url or "about:blank",
    ]
    subprocess.Popen(
        args,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    deadline = time.time() + 15
    while time.time() < deadline:
        if browser_running():
            return True
        time.sleep(0.2)
    raise Failure("Chromium did not start.")


def windows():
    try:
        out = run(["wmctrl", "-lpx"]).decode("utf-8", "replace")
    except Failure:
        return []
    items = []
    for line in out.splitlines():
        parts = line.split(None, 5)
        if len(parts) < 5 or parts[1] == "-1":
            continue
        handle, _, pid, klass = parts[0], parts[1], parts[2], parts[3]
        title = parts[5] if len(parts) > 5 else ""
        app = klass.split(".")[-1].lower()
        items.append(
            {
                "handle": handle,
                "pid": int(pid) if pid.isdigit() else 0,
                "started": "",
                "title": title,
                "class": klass,
                "app": app,
                "appName": klass.split(".")[-1],
            }
        )
    return items


def active_window():
    try:
        handle = int(run(["xdotool", "getactivewindow"]).decode().strip())
    except (Failure, ValueError):
        return None
    for window in windows():
        if int(window["handle"], 16) == handle:
            return window
    return None


def site(window):
    if not window or "chrom" not in window["class"].lower():
        return None
    try:
        pages = [t for t in devtools("/json/list") if t.get("type") == "page"]
    except Exception:
        return None
    return {"url": pages[0].get("url", "")} if pages else None


INTERESTING = {
    "push button", "toggle button", "check box", "radio button", "menu item",
    "check menu item", "radio menu item", "link", "entry", "text", "password text",
    "combo box", "list item", "page tab", "spin button", "slider", "heading",
    "label", "tree item", "table cell", "menu", "icon", "document web",
}


def accessibility(width, height):
    try:
        import pyatspi
    except ImportError:
        return []
    started = time.time()
    found = []
    visited = [0]

    def walk(node, depth):
        if (
            visited[0] >= VISIT_LIMIT
            or len(found) >= ELEMENT_LIMIT
            or depth > 40
            or time.time() - started > 6
        ):
            return
        visited[0] += 1
        try:
            states = node.getState()
            if not states.contains(pyatspi.STATE_SHOWING):
                return
            role = node.getRoleName()
            name = (node.name or "").strip()
        except Exception:
            return
        try:
            extents = node.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
            bounds = [extents.x, extents.y, extents.width, extents.height]
        except Exception:
            bounds = None
        visible = (
            bounds
            and bounds[2] > 0
            and bounds[3] > 0
            and bounds[0] < width
            and bounds[1] < height
            and bounds[0] + bounds[2] > 0
            and bounds[1] + bounds[3] > 0
        )
        if visible and (role in INTERESTING or (name and role != "frame")):
            item = {"role": role, "name": name[:200], "bounds": bounds, "states": []}
            if states.contains(pyatspi.STATE_FOCUSED):
                item["states"].append("focused")
            if role == "password text":
                item["protected"] = True
            else:
                try:
                    text = node.queryText()
                    item["value"] = text.getText(0, min(text.characterCount, 200))
                except Exception:
                    pass
            found.append(item)
        try:
            for child in node:
                if child is not None:
                    walk(child, depth + 1)
        except Exception:
            return

    try:
        desktop = pyatspi.Registry.getDesktop(0)
        apps = list(desktop)
    except Exception:
        return []
    # The active app's frames first, so a bounded walk covers what is in front.
    def active(app):
        try:
            return any(f.getState().contains(pyatspi.STATE_ACTIVE) for f in app)
        except Exception:
            return False

    for app in sorted(apps, key=lambda a: 0 if active(a) else 1):
        walk(app, 0)
    return found


def capture(thumb=None):
    image = None
    try:
        from PIL import ImageGrab

        image = ImageGrab.grab(xdisplay=os.environ.get("DISPLAY", ":1"))
    except Exception:
        path = f"/tmp/jackalope-capture-{os.getpid()}.png"
        run(["scrot", "--overwrite", path])
        try:
            from PIL import Image

            image = Image.open(path)
            image.load()
        finally:
            os.unlink(path)
    if thumb and image.width > thumb:
        image = image.resize((thumb, max(1, image.height * thumb // image.width)))
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, "PNG", optimize=False)
    return image.width, image.height, base64.b64encode(buffer.getvalue()).decode()


KEYS = {
    "Enter": "Return", "Escape": "Escape", "Tab": "Tab", "Space": "space",
    "Backspace": "BackSpace", "Delete": "Delete", "Insert": "Insert",
    "ArrowUp": "Up", "ArrowDown": "Down", "ArrowLeft": "Left", "ArrowRight": "Right",
    "Home": "Home", "End": "End", "PageUp": "Prior", "PageDown": "Next",
}
MODIFIERS = {"Control": "ctrl", "Primary": "ctrl", "Shift": "shift", "Alt": "alt"}
PUNCTUATION = {
    "-": "minus", "=": "equal", ",": "comma", ".": "period", "/": "slash",
    ";": "semicolon", "'": "apostrophe", "[": "bracketleft", "]": "bracketright",
    "\\": "backslash", "`": "grave",
}


def keysym(chord):
    key = chord.get("key", "")
    name = KEYS.get(key) or PUNCTUATION.get(key) or key
    if not re.fullmatch(r"[A-Za-z0-9_]+", name):
        raise Failure("Unsupported key.")
    parts = [MODIFIERS[m] for m in chord.get("modifiers", []) if m in MODIFIERS]
    return "+".join(dict.fromkeys(parts + [name]))


def point(request, x="x", y="y"):
    if request.get(x) is None or request.get(y) is None:
        raise Failure("Supply coordinates.")
    return str(int(request[x])), str(int(request[y]))


def click_at(request, button="1", repeat=1):
    x, y = point(request)
    args = ["xdotool", "mousemove", "--sync", x, y, "click"]
    if repeat > 1:
        args += ["--repeat", str(repeat), "--delay", "80"]
    run(args + [button])


def type_text(text):
    if text:
        run(["xdotool", "type", "--delay", "12", "--", text], timeout=60)


def execute(request):
    command = request.get("command")
    if not isinstance(command, str) or not command.strip() or len(command) > 10000:
        raise Failure("Supply a command of at most 10000 characters.")
    timeout = min(max(int(request.get("timeout_ms") or 30000), 1000), 600000) / 1000
    cwd = request.get("cwd") or HOME
    if not os.path.isdir(cwd):
        raise Failure("That working directory does not exist in this computer.")
    process = subprocess.Popen(
        ["bash", "-lc", command],
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(process.pid, signal.SIGKILL)
        stdout, stderr = process.communicate()
    truncated = len(stdout) > OUTPUT_LIMIT or len(stderr) > OUTPUT_LIMIT
    return {
        "exitCode": process.returncode,
        "timedOut": timed_out,
        "truncated": truncated,
        "stdout": stdout[-OUTPUT_LIMIT:].decode("utf-8", "replace"),
        "stderr": stderr[-OUTPUT_LIMIT:].decode("utf-8", "replace"),
    }


def open_url(url):
    if not isinstance(url, str) or not re.match(r"^https?://", url) or len(url) > 8000:
        raise Failure("Open an http or https address.")
    if start_browser(url):
        return {"status": "opened"}
    devtools("/json/new?" + urllib.parse.quote(url, safe=":/?&=#%"), method="PUT")
    return {"status": "opened"}


def observe(request, action):
    width, height = screen_size()
    window = active_window()
    result = {
        "bounds": [0, 0, width, height],
        "window": {"title": window["title"], "app": window["appName"]} if window else None,
    }
    page = site(window)
    if page:
        result["site"] = page
    if action == "snapshot":
        result["elements"] = accessibility(width, height)
    else:
        w, h, png = capture(request.get("thumb"))
        result.update({"png": png, "width": w, "height": h})
    return result


# ---- agent runs ----


def run_directory(request, create=False):
    name = request.get("run")
    if not isinstance(name, str) or not RUN_ID.fullmatch(name):
        raise Failure("Name the run with letters, digits, - or _.")
    path = os.path.join(RUNS, name)
    if create:
        os.makedirs(path, mode=0o700, exist_ok=True)
    elif not os.path.isdir(path):
        raise Failure("That run does not exist in this computer.")
    return path


def git(workspace, *args, env=None, timeout=300):
    merged = dict(os.environ, GIT_TERMINAL_PROMPT="0", **(env or {}))
    done = subprocess.run(
        ["git", *GIT_IDENTITY, *args], cwd=workspace, env=merged,
        capture_output=True, timeout=timeout,
    )
    if done.returncode != 0:
        detail = done.stderr.decode("utf-8", "replace").strip()[:300]
        raise Failure(f"git {args[0]} failed: {detail or done.returncode}")
    return done.stdout


def chunk(request):
    data = request.get("data") or ""
    if not isinstance(data, str):
        raise Failure("Send data as base64 text.")
    raw = base64.b64decode(data, validate=True)
    if len(raw) > CHUNK_LIMIT:
        raise Failure(f"Send at most {CHUNK_LIMIT} bytes per chunk.")
    return raw


def inside(root, target):
    root = os.path.realpath(root)
    target = os.path.realpath(target)
    return target == root or target.startswith(root + os.sep)


def extract(archive, workspace):
    """Extracts regular files, directories and in-tree symbolic links only, and
    returns the files and links it wrote."""
    written = []
    with tarfile.open(archive, "r:") as bundle:
        for member in bundle:
            name = member.name
            parts = name.replace("\\", "/").split("/")
            if name.startswith("/") or ".." in parts or not name or parts[0] == ".git":
                raise Failure(f"The workspace upload has an unsafe path: {name[:200]}")
            destination = os.path.join(workspace, name)
            if not inside(workspace, os.path.dirname(destination) or workspace):
                raise Failure(f"The workspace upload has an unsafe path: {name[:200]}")
            if member.isdir():
                os.makedirs(destination, exist_ok=True)
            elif member.isfile():
                os.makedirs(os.path.dirname(destination), exist_ok=True)
                source = bundle.extractfile(member)
                if os.path.islink(destination):
                    os.unlink(destination)
                with open(destination, "wb") as handle:
                    shutil.copyfileobj(source, handle)
                os.chmod(destination, 0o755 if member.mode & 0o100 else 0o644)
                written.append(name)
            elif member.issym():
                target = os.path.join(os.path.dirname(destination), member.linkname)
                if os.path.isabs(member.linkname) or not inside(workspace, target):
                    raise Failure(f"The workspace upload links outside itself: {name[:200]}")
                os.makedirs(os.path.dirname(destination), exist_ok=True)
                os.symlink(member.linkname, destination)
                written.append(name)
            else:
                raise Failure(f"The workspace upload has an unsupported entry: {name[:200]}")
    return written


def workspace_put(request):
    """Appends one chunk of a tar of the task workspace; the final chunk unpacks it
    and records the uploaded files as the base commit the result is diffed against."""
    directory = run_directory(request, create=True)
    archive = os.path.join(directory, "upload.tar")
    offset = int(request.get("offset") or 0)
    raw = chunk(request)
    current = os.path.getsize(archive) if os.path.exists(archive) else 0
    if offset == 0:
        current = 0
        with open(archive, "wb"):
            pass
    if offset != current:
        raise Failure(f"Upload offset {offset} does not follow {current}.")
    if current + len(raw) > UPLOAD_LIMIT:
        raise Failure("The workspace is larger than 512 MB. Ignore build output in .gitignore.")
    with open(archive, "ab") as handle:
        handle.write(raw)
    if not request.get("final"):
        return {"received": current + len(raw)}
    expected = request.get("sha256")
    with open(archive, "rb") as handle:
        digest = hashlib.sha256(handle.read()).hexdigest()
    if expected and expected != digest:
        raise Failure("The workspace upload was corrupted. Try again.")
    workspace = os.path.join(directory, "workspace")
    for marker in ("synced", "extras.json"):
        with contextlib.suppress(FileNotFoundError):
            os.unlink(os.path.join(directory, marker))
    if os.path.exists(workspace):
        shutil.rmtree(workspace)
    os.makedirs(workspace)
    try:
        extract(archive, workspace)
    finally:
        os.unlink(archive)
    git(workspace, "init", "-q", "-b", "jackalope")
    git(workspace, "add", "-A", "-f")
    git(workspace, "commit", "-q", "--allow-empty", "--no-verify", "-m", "Jackalope task base")
    base = git(workspace, "rev-parse", "HEAD").decode().strip()
    with open(os.path.join(directory, "base"), "w") as handle:
        handle.write(base)
    return {"received": current + len(raw), "base": base, "workspace": workspace}


def local_path():
    """Puts the home's own programs first on PATH, where on-demand installs go."""
    directory = os.path.join(LOCAL_PREFIX, "bin")
    path = os.environ.get("PATH", "")
    if directory not in path.split(os.pathsep):
        os.environ["PATH"] = directory + (os.pathsep + path if path else "")


def ensure_program(name):
    """Installs an on-demand agent CLI into the home volume when it is missing."""
    local_path()
    if shutil.which(name):
        return
    package = ON_DEMAND.get(name)
    if not package or not shutil.which("npm"):
        raise Failure(f"{name} is not installed in this computer.")
    try:
        result = subprocess.run(
            ["npm", "install", "--global", "--prefix", LOCAL_PREFIX,
             "--no-fund", "--no-audit", package],
            cwd=HOME, stdin=subprocess.DEVNULL, capture_output=True, text=True,
            timeout=INSTALL_SECONDS,
        )
    except subprocess.TimeoutExpired:
        raise Failure(f"Installing {name} in this computer took too long. Try again.")
    if result.returncode != 0 or not shutil.which(name):
        detail = (result.stderr or result.stdout or "").strip()[-300:]
        raise Failure(f"{name} could not be installed in this computer: {detail}")


def install_uv():
    """Installs uv and uvx into the home volume from uv's published release."""
    machine = platform.machine().lower()
    arch = {"x86_64": "x86_64", "amd64": "x86_64", "aarch64": "aarch64",
            "arm64": "aarch64"}.get(machine)
    if not arch:
        raise Failure(f"uv has no build for this computer's {machine} processor.")
    url = UV_RELEASE.format(arch=arch)
    try:
        with urllib.request.urlopen(url, timeout=INSTALL_SECONDS) as response:
            data = response.read(UV_LIMIT + 1)
        with urllib.request.urlopen(url + ".sha256", timeout=30) as response:
            expected = response.read(4096).decode("ascii", "replace").split()[0]
    except (OSError, IndexError) as error:
        raise Failure(f"uv could not be downloaded to this computer: {error}"[:300])
    if len(data) > UV_LIMIT or hashlib.sha256(data).hexdigest() != expected.lower():
        raise Failure("The uv download was incomplete or corrupted.")
    directory = os.path.join(LOCAL_PREFIX, "bin")
    os.makedirs(directory, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as bundle:
        for member in bundle.getmembers():
            name = os.path.basename(member.name)
            if member.isfile() and name in ("uv", "uvx"):
                target = os.path.join(directory, name)
                with open(target + ".tmp", "wb") as handle:
                    shutil.copyfileobj(bundle.extractfile(member), handle)
                os.chmod(target + ".tmp", 0o755)
                os.replace(target + ".tmp", target)


def ensure_runtime(command):
    """The program a connection starts with: python3 stands in for python, and
    uv is installed into the home when it is missing."""
    local_path()
    if command == "python" and not shutil.which("python"):
        command = "python3"
    if command in ("uv", "uvx") and not shutil.which(command):
        install_uv()
    program = shutil.which(command)
    if not program:
        raise Failure(f"{command} is not installed in this computer.")
    return program


def connection_specs(request):
    """The run's selected stdio connections, validated, or None."""
    value = request.get("mcp")
    if value is None:
        return None
    servers = value.get("servers") if isinstance(value, dict) else None
    if (
        servers is None
        or value.get("config") not in ("claude", "codex")
        or not isinstance(servers, list)
        or len(servers) > CONNECTION_LIMIT
    ):
        raise Failure("Supply connections as a config and at most 16 servers.")
    keys = set()
    for server in servers:
        valid = (
            isinstance(server, dict)
            and isinstance(server.get("key"), str)
            and CONNECTION_KEY.fullmatch(server["key"])
            and server["key"] != "jackalope"
            and server["key"] not in keys
            and isinstance(server.get("name"), str) and len(server["name"]) <= 200
            and isinstance(server.get("command"), str)
            and PROGRAM.fullmatch(server["command"])
            and isinstance(server.get("args"), list) and len(server["args"]) <= 200
            and all(isinstance(arg, str) and len(arg) <= 100000 for arg in server["args"])
            and isinstance(server.get("env"), dict) and len(server["env"]) <= 200
            and all(isinstance(k, str) and ENV_NAME.fullmatch(k)
                    and isinstance(v, str) and len(v) <= 100000
                    for k, v in server["env"].items())
        )
        if not valid:
            raise Failure("Supply each connection's key, name, command, arguments and environment.")
        keys.add(server["key"])
    return value


def connections(value, directory, workspace, argv, relay):
    """Writes each connection's launch file and adds it to the CLI's MCP
    configuration. Returns the command and the connections that could not
    start, with why."""
    unavailable = []
    started = []
    folder = os.path.join(directory, "mcp")
    for server in value["servers"]:
        if value.get("approve") and not relay:
            unavailable.append({"name": server["name"], "reason":
                                "Its tool approvals need Jackalope's bridge, which this run does not have."})
            continue
        try:
            program = ensure_runtime(server["command"])
        except Failure as error:
            unavailable.append({"name": server["name"], "reason": str(error)})
            continue
        os.makedirs(folder, mode=0o700, exist_ok=True)
        path = os.path.join(folder, server["key"] + ".json")
        # Holds credentials: private to the bot, outside the workspace, and
        # removed when the run ends.
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            json.dump({"command": program, "args": server["args"], "env": server["env"],
                       "cwd": workspace}, handle)
        started.append((server["key"], [os.path.abspath(__file__), "mcp-launch", path]))
    if not started:
        return argv, unavailable
    argv = list(argv)
    if value["config"] == "claude":
        entries = {key: {"type": "stdio", "command": sys.executable, "args": args}
                   for key, args in started}
        if "--mcp-config" in argv[:-1]:
            index = argv.index("--mcp-config") + 1
            try:
                config = json.loads(argv[index])
            except ValueError:
                raise Failure("The agent's MCP configuration could not be read.")
            config.setdefault("mcpServers", {}).update(entries)
            argv[index] = json.dumps(config)
        else:
            argv += ["--mcp-config", json.dumps({"mcpServers": entries})]
        if value.get("approve"):
            hook = {"type": "command", "timeout": APPROVAL_SECONDS,
                    "command": shlex.join([sys.executable, os.path.abspath(__file__), "mcp-approve"])}
            matcher = "mcp__(" + "|".join(key for key, _ in started) + ")__.*"
            argv += ["--settings", json.dumps(
                {"hooks": {"PreToolUse": [{"matcher": matcher, "hooks": [hook]}]}})]
        return argv, unavailable
    # Codex: each value is TOML; JSON strings and arrays of strings are valid
    # TOML. They follow the bridge's own mcp_servers table, which they extend.
    position = next((i + 2 for i in range(len(argv) - 2, -1, -1)
                     if argv[i] == "-c" and argv[i + 1].startswith("mcp_servers")), None)
    if position is None:
        position = argv.index("exec") + 1 if "exec" in argv else 1
    overrides = []
    for key, args in started:
        overrides += [
            "-c", f"mcp_servers.{key}.command={json.dumps(sys.executable)}",
            "-c", f"mcp_servers.{key}.args={json.dumps(args)}",
            "-c", f"mcp_servers.{key}.startup_timeout_sec=120",
        ]
    argv[position:position] = overrides
    return argv, unavailable


def launch_connection(path):
    """Starts one connection's server in the run's workspace with its own
    environment, without the run's bridge secret."""
    with open(path) as handle:
        spec = json.load(handle)
    environment = dict(os.environ)
    for name in ("JACKALOPE_BRIDGE_URL", "JACKALOPE_BRIDGE_TOKEN", "JACKALOPE_COMPUTER_TOKEN"):
        environment.pop(name, None)
    environment.update(spec["env"])
    os.chdir(spec["cwd"])
    os.execve(spec["command"], [spec["command"], *spec["args"]], environment)


def approve_tool():
    """Claude Code's PreToolUse hook for connections that run on this computer.
    Claude Code runs here without its permission prompt, so this asks
    Jackalope through the run's relay, which decides the way Claude Code's
    permission prompt does on the person's device. Anything but an explicit
    allow denies, including any failure to ask."""
    def decide(decision, reason):
        sys.stdout.write(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse", "permissionDecision": decision,
            "permissionDecisionReason": reason}}) + "\n")

    try:
        event = json.load(sys.stdin)
        name = event.get("tool_name")
        body = json.dumps({"tool_name": name, "input": event.get("tool_input")}).encode()
        if len(body) > RELAY_BODY_LIMIT - 1024:
            # The relay carries at most 64 KB, so a large call is judged from a preview.
            preview = json.dumps(event.get("tool_input"))[:4000]
            body = json.dumps({"tool_name": name,
                               "input": {"truncated": True, "preview": preview}}).encode()
        request = urllib.request.Request(
            os.environ["JACKALOPE_BRIDGE_URL"] + "/v1/tools/approve", data=body, method="POST",
            headers={"Authorization": "Bearer " + os.environ["JACKALOPE_BRIDGE_TOKEN"],
                     "Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=APPROVAL_SECONDS) as response:
            answer = json.loads(response.read(RELAY_ANSWER_LIMIT))
        allowed = isinstance(answer, dict) and answer.get("behavior") == "allow"
        message = answer.get("message") if isinstance(answer, dict) else None
    except BaseException as error:  # Never let a failure allow the call.
        return decide("deny", "Jackalope could not approve this tool call "
                              f"({type(error).__name__}), so it did not run. Report what is blocked.")
    if allowed:
        return decide("allow", "Approved in Jackalope.")
    decide("deny", message if isinstance(message, str) and message
           else "The person denied this action in Jackalope. Do not retry it.")


# Started supervisors, polled so finished ones do not linger as zombies.
SUPERVISORS = []


def run_start(request):
    directory = run_directory(request)
    workspace = os.path.join(directory, "workspace")
    if not os.path.isfile(os.path.join(directory, "base")):
        raise Failure("Upload the workspace before starting the run.")
    if os.path.exists(os.path.join(directory, "spec.json")) or os.path.exists(
        os.path.join(directory, "pid")
    ):
        raise Failure("This run has already started.")
    argv = request.get("argv")
    if (
        not isinstance(argv, list)
        or not argv
        or len(argv) > 400
        or not all(isinstance(arg, str) and len(arg) <= 200000 for arg in argv)
    ):
        raise Failure("Supply the command as a list of arguments.")
    ensure_program(argv[0])
    env = request.get("env") or {}
    if not isinstance(env, dict) or not all(
        isinstance(k, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", k)
        and isinstance(v, str) and len(v) <= 100000
        for k, v in env.items()
    ):
        raise Failure("Supply the environment as names and text values.")
    stdin = request.get("stdin") or ""
    relay_requested = bool(request.get("relay"))
    selected = connection_specs(request)
    unavailable = []
    if selected:
        try:
            argv, unavailable = connections(selected, directory, workspace, argv, relay_requested)
        except BaseException:
            shutil.rmtree(os.path.join(directory, "mcp"), ignore_errors=True)
            raise
    if unavailable:
        stdin += ("\nThese selected connections could not start on this computer: "
                  + "; ".join(f"{item['name']} ({item['reason']})" for item in unavailable)
                  + " Do not look for their tools.\n")
    timeout = min(max(int(request.get("timeout_s") or 3600), 10), 6 * 3600)
    spec = {"argv": argv, "env": env, "timeout": timeout, "workspace": workspace,
            "relay": relay_requested}
    # The spec can hold credentials; only the supervisor reads it, then deletes it.
    descriptor = os.open(os.path.join(directory, "spec.json"), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(spec, handle)
    with open(os.path.join(directory, "stdin"), "w", encoding="utf-8") as handle:
        handle.write(stdin)
    touch(directory)
    SUPERVISORS[:] = [process for process in SUPERVISORS if process.poll() is None]
    SUPERVISORS.append(subprocess.Popen(
        [sys.executable, os.path.abspath(__file__), "supervise", directory],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True, cwd=directory,
    ))
    report = {"mcp": {"unavailable": unavailable}} if selected else {}
    deadline = time.time() + 15
    while time.time() < deadline:
        if os.path.exists(os.path.join(directory, "pid")):
            return {"started": True, **report}
        if os.path.exists(os.path.join(directory, "exit.json")):
            return {"started": False, "exit": read_exit(directory), **report}
        time.sleep(0.05)
    raise Failure("The run did not start.")


def touch(directory):
    with open(os.path.join(directory, "heartbeat"), "w") as handle:
        handle.write(str(time.time()))


def read_exit(directory):
    path = os.path.join(directory, "exit.json")
    if not os.path.exists(path):
        return None
    with open(path) as handle:
        return json.load(handle)


def read_from(path, offset, limit):
    if not os.path.exists(path):
        return b"", offset
    with open(path, "rb") as handle:
        handle.seek(offset)
        data = handle.read(limit)
    return data, offset + len(data)


def run_read(request):
    """Output after the given byte offsets, waiting up to wait_ms for more. The
    exit status appears only once both streams have been read to the end."""
    directory = run_directory(request)
    touch(directory)
    out = max(int(request.get("out") or 0), 0)
    err = max(int(request.get("err") or 0), 0)
    wait = min(max(int(request.get("wait_ms") or 0), 0) / 1000, READ_WAIT_LIMIT)
    limit = CHUNK_LIMIT
    deadline = time.time() + wait
    supervisor_gone(directory)
    while True:
        finished = read_exit(directory)
        stdout, next_out = read_from(os.path.join(directory, "stdout"), out, limit)
        stderr, next_err = read_from(os.path.join(directory, "stderr"), err, limit // 4)
        if (stdout or stderr or finished or bridge_waiting(directory)
                or time.time() >= deadline):
            break
        time.sleep(0.1)
    drained = finished and len(stdout) < limit and len(stderr) < limit // 4
    return {
        "stdout": base64.b64encode(stdout).decode(),
        "stderr": base64.b64encode(stderr).decode(),
        "out": next_out,
        "err": next_err,
        "exit": finished if drained else None,
        "bridge": bridge_calls(directory, bool(request.get("reclaim"))),
    }


def run_status(request):
    """Whether a run exists here and how far it got, so Jackalope can recover the
    changes of a run it lost contact with."""
    name = request.get("run")
    if not isinstance(name, str) or not RUN_ID.fullmatch(name):
        raise Failure("Name the run with letters, digits, - or _.")
    directory = os.path.join(RUNS, name)
    if not os.path.isdir(directory):
        return {"exists": False, "runs": RUNS_PROTOCOL, "capabilities": CAPABILITIES}
    supervisor_gone(directory)
    started = any(os.path.exists(os.path.join(directory, f)) for f in ("pid", "exit.json"))
    return {
        "runs": RUNS_PROTOCOL,
        "capabilities": CAPABILITIES,
        "exists": True,
        "uploaded": os.path.isfile(os.path.join(directory, "base")),
        # Checked out from a bundle, so its result comes back with sync_result.
        "synced": os.path.isfile(os.path.join(directory, "synced")),
        "started": started,
        "exit": read_exit(directory),
    }


def supervisor_gone(directory):
    """Records a started run whose supervisor no longer runs, for example after
    the computer restarted, as interrupted. The supervisor holds the run's owner
    lock for its whole life and the system releases it when the process ends."""
    if read_exit(directory) is not None or not os.path.exists(os.path.join(directory, "pid")):
        return False
    try:
        descriptor = os.open(os.path.join(directory, "owner"), os.O_RDWR)
    except FileNotFoundError:
        return False
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        if read_exit(directory) is None:
            shutil.rmtree(os.path.join(directory, "mcp"), ignore_errors=True)
            write_exit(directory, {"code": None, "signal": None, "reason": "interrupted"})
        return True
    finally:
        os.close(descriptor)


def bridge_queue(directory):
    return os.path.join(directory, "bridge")


def bridge_waiting(directory):
    try:
        return any(name.endswith(".req") for name in os.listdir(bridge_queue(directory)))
    except FileNotFoundError:
        return False


def bridge_calls(directory, reclaim=False):
    """Bridge requests not yet handed to Jackalope, oldest first; each is handed
    over once. `reclaim` hands over again those handed over but unanswered, for a
    Jackalope that reconnected without its record of them."""
    queue = bridge_queue(directory)
    try:
        names = sorted(os.listdir(queue))
    except FileNotFoundError:
        return []
    calls = []
    size = 0
    for name in names:
        call, _, kind = name.partition(".")
        if kind != "req" and not (reclaim and kind == "taken"):
            continue
        if os.path.exists(os.path.join(queue, call + ".res")):
            continue
        path = os.path.join(queue, name)
        try:
            with open(path, encoding="utf-8") as handle:
                data = handle.read()
            if calls and size + len(data) > RELAY_READ_LIMIT:
                break
            if kind == "req":
                os.replace(path, os.path.join(queue, call + ".taken"))
        except OSError:
            continue  # The agent gave up on it.
        calls.append(json.loads(data))
        size += len(data)
        if len(calls) >= RELAY_READ_CALLS:
            break
    return calls


def run_answer(request):
    """Answers one bridge request handed over by run_read."""
    directory = run_directory(request)
    touch(directory)
    call = request.get("call")
    if not isinstance(call, str) or not CALL_ID.fullmatch(call):
        raise Failure("Name the bridge call being answered.")
    queue = bridge_queue(directory)
    if not any(os.path.exists(os.path.join(queue, call + kind)) for kind in (".taken", ".req")):
        return {"delivered": False}
    status = int(request.get("status") or 502)
    if not 100 <= status <= 599:
        raise Failure("Answer with an HTTP status.")
    content_type = request.get("contentType") or "application/json"
    if not isinstance(content_type, str) or len(content_type) > 200:
        raise Failure("Answer with a content type.")
    record = {"status": status, "contentType": content_type}
    if request.get("artifact") is not None:
        # A larger answer was uploaded as an artifact first.
        source, _ = artifact_path(request, "artifact")
        if not os.path.isfile(source):
            raise Failure("Upload the answer before sending it.")
        if os.path.getsize(source) > RELAY_ARTIFACT_LIMIT:
            raise Failure("The bridge answer is too large.")
        shutil.copyfile(source, os.path.join(queue, call + ".body"))
        record["file"] = call + ".body"
    else:
        body = request.get("body") or ""
        if not isinstance(body, str) or len(body) > (RELAY_ANSWER_LIMIT * 4) // 3 + 4:
            raise Failure("The bridge answer is too large.")
        base64.b64decode(body, validate=True)
        record["body"] = body
    temporary = os.path.join(queue, call + ".res.tmp")
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(record, handle)
    os.replace(temporary, os.path.join(queue, call + ".res"))
    return {"delivered": True}


def relay(directory):
    """Serves the bridge to the run's agent on a free loopback port. Returns its
    address and the secret the agent must present."""
    queue = bridge_queue(directory)
    os.makedirs(queue, mode=0o700, exist_ok=True)
    secret = secrets.token_hex(32)

    def forget(call):
        for kind in (".req", ".taken", ".res", ".body"):
            try:
                os.unlink(os.path.join(queue, call + kind))
            except FileNotFoundError:
                pass

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass

        def reply(self, status, body, content_type="application/json"):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def failure(self, status, message):
            # The request body may be unread, so the connection cannot be reused.
            self.close_connection = True
            self.reply(status, json.dumps({"error": message}).encode())

        def oversized(self, length):
            # A tool call gets a tool error the agent can act on, not a transport failure.
            request = None
            if length <= BODY_LIMIT:
                try:
                    request = json.loads(self.rfile.read(length))
                except (ValueError, OSError):
                    request = None
            if (isinstance(request, dict) and request.get("jsonrpc") == "2.0"
                    and request.get("id") is not None and request.get("method") == "tools/call"):
                self.close_connection = True
                result = {"content": [{"type": "text", "text": RELAY_TOO_LARGE}], "isError": True}
                return self.reply(200, json.dumps(
                    {"jsonrpc": "2.0", "id": request["id"], "result": result}).encode())
            return self.failure(413, RELAY_TOO_LARGE)

        def forward(self):
            supplied = self.headers.get("Authorization", "")
            if not hmac.compare_digest(supplied.encode(), f"Bearer {secret}".encode()):
                return self.failure(401, "Jackalope bridge credential required.")
            if self.headers.get("Origin"):
                return self.failure(403, "Browser requests are not accepted.")
            if self.headers.get("Transfer-Encoding"):
                return self.failure(411, "Send a Content-Length.")
            length = int(self.headers.get("Content-Length") or 0)
            if length < 0 or length > RELAY_BODY_LIMIT:
                return self.oversized(length)
            body = self.rfile.read(length) if length else b""
            if not self.path.startswith("/") or len(self.path) > 2000:
                return self.failure(400, "Unsupported bridge path.")
            try:
                if len(os.listdir(queue)) >= RELAY_PENDING_LIMIT * 2:
                    return self.failure(503, "Too many bridge calls are waiting. Try again shortly.")
            except FileNotFoundError:
                return self.failure(503, "The run has ended.")
            call = f"{time.time_ns():016x}{secrets.token_hex(8)}"
            headers = {name: self.headers[name] for name in RELAY_HEADERS if self.headers.get(name)}
            temporary = os.path.join(queue, call + ".tmp")
            with open(temporary, "w", encoding="utf-8") as handle:
                json.dump({"id": call, "method": self.command, "path": self.path,
                           "headers": headers, "body": base64.b64encode(body).decode()}, handle)
            os.replace(temporary, os.path.join(queue, call + ".req"))
            answer = os.path.join(queue, call + ".res")
            deadline = time.time() + RELAY_TIMEOUT
            delay = 0.02
            while not os.path.exists(answer):
                if time.time() > deadline:
                    forget(call)
                    return self.failure(504, "Jackalope did not answer this bridge call in time.")
                time.sleep(delay)
                delay = min(delay * 2, 0.25)
            try:
                with open(answer, encoding="utf-8") as handle:
                    result = json.load(handle)
                if result.get("file") == call + ".body":
                    with open(os.path.join(queue, call + ".body"), "rb") as handle:
                        data = handle.read()
                else:
                    data = base64.b64decode(result["body"])
            finally:
                forget(call)
            self.reply(int(result["status"]), data,
                       result.get("contentType") or "application/json")

        do_GET = forward
        do_POST = forward
        do_DELETE = forward

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{server.server_address[1]}", secret


def run_stop(request):
    directory = run_directory(request)
    with open(os.path.join(directory, "stop"), "w") as handle:
        handle.write("stop")
    return {"stopping": read_exit(directory) is None}


def workspace_diff(request):
    """Writes the run's changes since the uploaded base as a binary Git patch,
    including new files and anything the agent committed."""
    directory = run_directory(request)
    if read_exit(directory) is None and os.path.exists(os.path.join(directory, "pid")):
        raise Failure("Wait for the run to finish before collecting its changes.")
    workspace = os.path.join(directory, "workspace")
    with open(os.path.join(directory, "base")) as handle:
        base = handle.read().strip()
    index = os.path.join(directory, "result.index")
    if os.path.exists(index):
        os.unlink(index)
    env = {"GIT_INDEX_FILE": index}
    git(workspace, "read-tree", base, env=env)
    git(workspace, "add", "-A", env=env)
    patch = git(
        workspace, "diff", "--cached", "--binary", "--no-color", "--no-ext-diff",
        "--no-renames", "--full-index", base, env=env, timeout=600,
    )
    names = git(workspace, "diff", "--cached", "--name-only", "-z", base, env=env)
    if len(patch) > PATCH_LIMIT:
        raise Failure("The run changed more than 256 MB of files.")
    with open(os.path.join(directory, "result.patch"), "wb") as handle:
        handle.write(patch)
    files = [name for name in names.decode("utf-8", "replace").split("\0") if name]
    return {
        "size": len(patch),
        "sha256": hashlib.sha256(patch).hexdigest(),
        "files": files[:2000],
        "fileCount": len(files),
    }


def workspace_get(request):
    directory = run_directory(request)
    offset = max(int(request.get("offset") or 0), 0)
    data, after = read_from(os.path.join(directory, "result.patch"), offset, CHUNK_LIMIT)
    size = os.path.getsize(os.path.join(directory, "result.patch"))
    return {"data": base64.b64encode(data).decode(), "offset": after, "size": size}


def run_remove(request):
    directory = run_directory(request)
    if read_exit(directory) is None and os.path.exists(os.path.join(directory, "pid")):
        run_stop(request)
        deadline = time.time() + 15
        while read_exit(directory) is None and time.time() < deadline:
            time.sleep(0.2)
    synced = read_synced(directory)
    if synced:
        # The project's repository keeps the commits; the run's worktree,
        # branch and refs go with it.
        run = os.path.basename(directory)
        with repository_lock(synced) as repo:
            if os.path.isdir(repo):
                discard_worktree(repo, os.path.join(directory, "workspace"))
                with contextlib.suppress(Failure):
                    git(repo, "branch", "-q", "-D", f"jackalope/{run}")
                refs = git(repo, "for-each-ref", "--format=%(refname)",
                           f"refs/jackalope/incoming/{run}/", f"refs/jackalope/result/{run}")
                for ref in refs.decode().split():
                    git(repo, "update-ref", "-d", ref)
    shutil.rmtree(directory, ignore_errors=True)
    return {"removed": True}


# ---- artifacts: content-addressed, chunked and resumable ----


def artifact_path(request, key="sha256"):
    digest = request.get(key)
    if not isinstance(digest, str) or not SHA256.fullmatch(digest):
        raise Failure("Name the artifact by its SHA-256.")
    return os.path.join(ARTIFACTS, digest), digest


def file_digest(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def prune_artifacts():
    """Drops stored and partial artifacts unused for ARTIFACT_KEEP_SECONDS."""
    cutoff = time.time() - ARTIFACT_KEEP_SECONDS
    try:
        names = os.listdir(ARTIFACTS)
    except FileNotFoundError:
        return
    for name in names[:10000]:
        with contextlib.suppress(OSError):
            path = os.path.join(ARTIFACTS, name)
            if os.path.getmtime(path) < cutoff:
                os.unlink(path)


def artifact_stat(request):
    """Whether an artifact is stored here, or how much of it has arrived, so a
    transfer resumes where it stopped and a stored one is not sent again."""
    path, _ = artifact_path(request)
    if os.path.isfile(path):
        os.utime(path)
        size = os.path.getsize(path)
        return {"complete": True, "received": size, "size": size}
    part = path + ".part"
    return {"complete": False, "received": os.path.getsize(part) if os.path.isfile(part) else 0}


def artifact_put(request):
    """Appends one chunk at `offset` (0 restarts the transfer). The chunk that
    completes `size` bytes checks the SHA-256 the artifact is named by."""
    path, digest = artifact_path(request)
    size = request.get("size")
    if not isinstance(size, int) or isinstance(size, bool) or not 0 <= size <= ARTIFACT_LIMIT:
        raise Failure("Artifacts are limited to 1 GB.")
    os.makedirs(ARTIFACTS, mode=0o700, exist_ok=True)
    if os.path.isfile(path):
        os.utime(path)
        return {"received": size, "complete": True}
    offset = int(request.get("offset") or 0)
    raw = chunk(request)
    part = path + ".part"
    if offset == 0:
        prune_artifacts()
        with open(part, "wb"):
            pass
    current = os.path.getsize(part) if os.path.isfile(part) else 0
    if offset != current:
        raise Failure(f"Artifact offset {offset} does not follow {current}.")
    if current + len(raw) > size:
        raise Failure("The artifact is larger than announced.")
    with open(part, "ab") as handle:
        handle.write(raw)
    received = current + len(raw)
    if received < size:
        return {"received": received, "complete": False}
    if file_digest(part) != digest:
        os.unlink(part)
        raise Failure("The artifact was corrupted in transfer (SHA-256 mismatch). Send it again.")
    os.replace(part, path)
    return {"received": received, "complete": True}


def artifact_get(request):
    path, _ = artifact_path(request)
    if not os.path.isfile(path):
        raise Failure("That artifact is not on this computer.")
    offset = max(int(request.get("offset") or 0), 0)
    data, after = read_from(path, offset, CHUNK_LIMIT)
    return {"data": base64.b64encode(data).decode(), "offset": after, "size": os.path.getsize(path)}


def store_artifact(source):
    """Adds a file to the artifact store for Jackalope to fetch. Returns its
    SHA-256 and size."""
    os.makedirs(ARTIFACTS, mode=0o700, exist_ok=True)
    digest = file_digest(source)
    path = os.path.join(ARTIFACTS, digest)
    if os.path.isfile(path):
        os.utime(path)
    else:
        temporary = f"{path}.{secrets.token_hex(4)}.tmp"
        shutil.copyfile(source, temporary)
        os.replace(temporary, path)
    return digest, os.path.getsize(path)


# ---- git-sync: persistent project repositories and bundles ----


@contextlib.contextmanager
def repository_lock(request):
    """Serializes changes to one project's repository; runs of the same project
    may sync at once. Yields the bare repository's path."""
    name = request.get("repo")
    if not isinstance(name, str) or not REPO_ID.fullmatch(name):
        raise Failure("Name the repository with lowercase letters and digits.")
    os.makedirs(REPOS, mode=0o700, exist_ok=True)
    descriptor = os.open(os.path.join(REPOS, name + ".lock"), os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield os.path.join(REPOS, name + ".git")
    finally:
        os.close(descriptor)


def read_synced(directory):
    path = os.path.join(directory, "synced")
    if not os.path.isfile(path):
        return None
    with open(path) as handle:
        return json.load(handle)


def literal(env=None):
    """Paths named after `--` are files, never pathspec patterns."""
    return dict(env or {}, GIT_LITERAL_PATHSPECS="1")


def discard_worktree(repo, workspace):
    if os.path.lexists(workspace):
        with contextlib.suppress(Failure):
            git(repo, "worktree", "remove", "--force", "--force", workspace)
        shutil.rmtree(workspace, ignore_errors=True)
    git(repo, "worktree", "prune")


def sync_status(request):
    """Base commits this computer's repository for the project already holds,
    newest first, so Jackalope bundles only what is missing."""
    with repository_lock(request) as repo:
        if not os.path.isdir(repo):
            return {"have": []}
        listed = git(repo, "for-each-ref", "--sort=-committerdate", f"--count={KNOWN_BASES}",
                     "--format=%(objectname)", "refs/jackalope/base/")
    return {"have": [line for line in listed.decode().split() if OBJECT_ID.fullmatch(line)]}


def sync_checkout(request):
    """Fetches an uploaded bundle into the project's repository and checks out
    the run's workspace from it: HEAD at the task's base commit, the
    workspace's uncommitted state (the bundle's snapshot commit, whose parent is
    the base) as uncommitted changes, then the side tar of copied setup files
    and Jackalope context, which Git ignores, on top."""
    directory = run_directory(request, create=True)
    run = os.path.basename(directory)
    bundle, _ = artifact_path(request, "bundle")
    if not os.path.isfile(bundle):
        raise Failure("Upload the workspace bundle first.")
    base, snapshot = request.get("base"), request.get("snapshot")
    if not all(isinstance(value, str) and OBJECT_ID.fullmatch(value) for value in (base, snapshot)):
        raise Failure("Name the base and snapshot commits.")
    extras = None
    if request.get("extras") is not None:
        extras, _ = artifact_path(request, "extras")
        if not os.path.isfile(extras):
            raise Failure("Upload the setup files first.")
    workspace = os.path.join(directory, "workspace")
    for marker in ("base", "synced", "extras.json"):
        with contextlib.suppress(FileNotFoundError):
            os.unlink(os.path.join(directory, marker))
    with repository_lock(request) as repo:
        if not os.path.isdir(repo):
            git(REPOS, "init", "-q", "--bare", repo)
        exclude = os.path.join(repo, "info", "exclude")
        os.makedirs(os.path.dirname(exclude), exist_ok=True)
        with open(exclude, "w") as handle:
            # Jackalope's own folder: context arrives in the side tar and
            # output returns as artifacts, so neither enters the result.
            handle.write("/.jackalope/\n")
        git(repo, "bundle", "verify", "-q", bundle, timeout=600)
        git(repo, "fetch", "-q", "--no-tags", bundle,
            f"+refs/heads/*:refs/jackalope/incoming/{run}/*", timeout=600)
        parent = git(repo, "rev-parse", "--verify", "-q", f"{snapshot}^1").decode().strip()
        if parent != base:
            raise Failure("The workspace bundle does not hold the named snapshot.")
        git(repo, "update-ref", f"refs/jackalope/base/{base}", base)
        known = git(repo, "for-each-ref", "--sort=-committerdate", "--format=%(refname)",
                    "refs/jackalope/base/").decode().split()
        for ref in known[KNOWN_BASES:]:
            git(repo, "update-ref", "-d", ref)
        discard_worktree(repo, workspace)
        git(repo, "worktree", "add", "-q", "-f", "-B", f"jackalope/{run}", workspace, base,
            timeout=600)
        with contextlib.suppress(Failure):
            git(repo, "gc", "--auto", "--quiet", timeout=600)
    git(workspace, "read-tree", "-u", "--reset", snapshot, timeout=600)
    git(workspace, "reset", "-q", timeout=600)
    names = extract(extras, workspace) if extras else []
    with open(os.path.join(directory, "extras.json"), "w") as handle:
        json.dump(names, handle)
    with open(os.path.join(directory, "synced"), "w") as handle:
        json.dump({"repo": request["repo"], "base": base, "snapshot": snapshot}, handle)
    # workspace_diff compares with the snapshot, as with an uploaded tar.
    with open(os.path.join(directory, "base"), "w") as handle:
        handle.write(snapshot)
    return {"workspace": workspace, "base": snapshot}


def collect_artifacts(workspace):
    """Stores the run's .jackalope/artifacts output and lists it for Jackalope,
    without following links."""
    root = os.path.join(workspace, ".jackalope", "artifacts")
    found, total, truncated = [], 0, False
    if (os.path.islink(os.path.join(workspace, ".jackalope")) or os.path.islink(root)
            or not os.path.isdir(root)):
        return found, truncated
    for folder, directories, files in os.walk(root):
        directories[:] = sorted(d for d in directories
                                if not os.path.islink(os.path.join(folder, d)))
        for name in sorted(files):
            path = os.path.join(folder, name)
            if os.path.islink(path) or not os.path.isfile(path):
                continue
            size = os.path.getsize(path)
            if len(found) >= RESULT_ARTIFACTS or total + size > RESULT_ARTIFACT_BYTES:
                return found, True
            digest, size = store_artifact(path)
            total += size
            relative = os.path.relpath(path, workspace).replace(os.sep, "/")
            found.append({"path": relative, "size": size, "sha256": digest})
    return found, truncated


def sync_result(request):
    """Bundles the run's result for Jackalope: a synthetic commit of the working
    tree on top of whatever the agent committed, against the base Jackalope
    already has. Copied setup files and Jackalope context stay out of it;
    .jackalope/artifacts output is listed as artifacts."""
    directory = run_directory(request)
    if read_exit(directory) is None and os.path.exists(os.path.join(directory, "pid")):
        raise Failure("Wait for the run to finish before collecting its changes.")
    synced = read_synced(directory)
    if not synced:
        raise Failure("This run was not checked out from a bundle.")
    run = os.path.basename(directory)
    workspace = os.path.join(directory, "workspace")
    index = os.path.join(directory, "result.index")
    with contextlib.suppress(FileNotFoundError):
        os.unlink(index)
    env = {"GIT_INDEX_FILE": index}
    git(workspace, "read-tree", "HEAD", env=env)
    git(workspace, "add", "-A", env=env, timeout=600)
    with open(os.path.join(directory, "extras.json")) as handle:
        extras = json.load(handle)
    if extras:
        tracked = git(workspace, "ls-tree", "-r", "-z", "--name-only", "HEAD", "--", *extras,
                      env=literal()).decode("utf-8", "replace").split("\0")
        dropped = [name for name in extras if name not in tracked]
        if dropped:
            git(workspace, "rm", "--cached", "-q", "--ignore-unmatch", "--", *dropped,
                env=literal(env))
    tree = git(workspace, "write-tree", env=env).decode().strip()
    result = git(workspace, "commit-tree", tree, "-p", "HEAD", "-m",
                 "Jackalope run result").decode().strip()
    os.unlink(index)
    bundle = os.path.join(directory, "result.bundle")
    with repository_lock(synced):
        ref = f"refs/jackalope/result/{run}"
        git(workspace, "update-ref", ref, result)
        git(workspace, "bundle", "create", "-q", bundle, ref, "--not", synced["base"],
            timeout=600)
    try:
        if os.path.getsize(bundle) > PATCH_LIMIT:
            raise Failure("The run changed more than 256 MB of files.")
        digest, size = store_artifact(bundle)
    finally:
        os.unlink(bundle)
    artifacts, truncated = collect_artifacts(workspace)
    return {
        "bundle": {"sha256": digest, "size": size},
        "result": result,
        "base": synced["base"],
        "artifacts": artifacts,
        "artifactsTruncated": truncated,
    }


def supervise(directory):
    """Owns one agent process: feeds its input, captures its output, enforces the
    time limit, honours stop requests and stops it when no one reads for
    ORPHAN_SECONDS. Writes exit.json last."""
    owner = os.open(os.path.join(directory, "owner"), os.O_RDWR | os.O_CREAT, 0o600)
    fcntl.flock(owner, fcntl.LOCK_EX)
    spec_path = os.path.join(directory, "spec.json")
    with open(spec_path) as handle:
        spec = json.load(handle)
    os.unlink(spec_path)
    if spec.get("relay"):
        address, secret = relay(directory)

        def swap(value):
            return value.replace(RELAY_URL, address).replace(RELAY_TOKEN, secret)

        spec["argv"] = [swap(arg) for arg in spec["argv"]]
        spec["env"] = {name: swap(value) for name, value in spec["env"].items()}
    environment = dict(os.environ)
    environment.pop("JACKALOPE_COMPUTER_TOKEN", None)
    environment.update(spec["env"])
    stdin_path = os.path.join(directory, "stdin")
    started = time.time()
    reason = None
    try:
        with open(stdin_path, "rb") as stdin, open(
            os.path.join(directory, "stdout"), "wb"
        ) as stdout, open(os.path.join(directory, "stderr"), "wb") as stderr:
            process = subprocess.Popen(
                spec["argv"], cwd=spec["workspace"], env=environment,
                stdin=stdin, stdout=stdout, stderr=stderr, start_new_session=True,
            )
    except OSError as error:
        shutil.rmtree(os.path.join(directory, "mcp"), ignore_errors=True)
        write_exit(directory, {"code": None, "error": str(error)[:500], "reason": "spawn"})
        return
    finally:
        if os.path.exists(stdin_path):
            os.unlink(stdin_path)
    with open(os.path.join(directory, "pid"), "w") as handle:
        handle.write(str(process.pid))
    while process.poll() is None:
        time.sleep(0.2)
        heartbeat = os.path.join(directory, "heartbeat")
        idle = time.time() - (os.path.getmtime(heartbeat) if os.path.exists(heartbeat) else started)
        if os.path.exists(os.path.join(directory, "stop")):
            reason = "stopped"
        elif time.time() - started > spec["timeout"]:
            reason = "timeout"
        elif idle > ORPHAN_SECONDS:
            reason = "orphaned"
        if reason:
            terminate(process)
            break
    code = process.wait()
    # The connections' credentials leave with the run.
    shutil.rmtree(os.path.join(directory, "mcp"), ignore_errors=True)
    write_exit(directory, {"code": code if code >= 0 else None,
                           "signal": -code if code < 0 else None, "reason": reason})


def terminate(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def write_exit(directory, value):
    temporary = os.path.join(directory, "exit.json.tmp")
    with open(temporary, "w") as handle:
        json.dump(value, handle)
    os.replace(temporary, os.path.join(directory, "exit.json"))


def handle_run(request):
    action = request.get("action")
    return {
        "workspace_put": workspace_put,
        "run_start": run_start,
        "run_read": run_read,
        "run_stop": run_stop,
        "workspace_diff": workspace_diff,
        "workspace_get": workspace_get,
        "run_remove": run_remove,
        "run_status": run_status,
        "run_answer": run_answer,
        "artifact_stat": artifact_stat,
        "artifact_put": artifact_put,
        "artifact_get": artifact_get,
        "sync_status": sync_status,
        "sync_checkout": sync_checkout,
        "sync_result": sync_result,
    }[action](request)


def handle(request):
    action = request.get("action")
    if action in RUN_ACTIONS:
        return handle_run(request)
    if action == "hello":
        wait_for_display()
        width, height = screen_size()
        return {"protocol": PROTOCOL, "runs": RUNS_PROTOCOL, "capabilities": CAPABILITIES,
                "screen": [width, height], "browser": browser_running()}
    wait_for_display()
    if action in ("snapshot", "screenshot"):
        return observe(request, action)
    if action == "list":
        width, height = screen_size()
        return {"windows": windows(), "monitors": [{"index": 0, "bounds": [0, 0, width, height]}]}
    if action == "click":
        click_at(request)
    elif action == "double_click":
        click_at(request, repeat=2)
    elif action == "right_click":
        click_at(request, button="3")
    elif action == "drag":
        x, y = point(request)
        tx, ty = point(request, "to_x", "to_y")
        run(["xdotool", "mousemove", "--sync", x, y, "mousedown", "1"])
        time.sleep(0.1)
        run(["xdotool", "mousemove", "--sync", tx, ty])
        time.sleep(0.1)
        run(["xdotool", "mouseup", "1"])
    elif action == "scroll":
        x, y = point(request)
        notches = int(request.get("wheel") or 0)
        if notches:
            run(["xdotool", "mousemove", "--sync", x, y, "click", "--repeat",
                 str(abs(notches)), "4" if notches > 0 else "5"])
    elif action == "type":
        if request.get("x") is not None:
            click_at(request)
        type_text(request.get("text") or "")
    elif action == "set_value":
        click_at(request)
        run(["xdotool", "key", "--clearmodifiers", "ctrl+a"])
        text = request.get("text") or ""
        if text:
            type_text(text)
        else:
            run(["xdotool", "key", "BackSpace"])
    elif action == "press":
        run(["xdotool", "key", "--clearmodifiers", keysym(request.get("chord") or {})])
    elif action == "focus":
        handle_id = (request.get("window") or {}).get("handle")
        if handle_id:
            run(["wmctrl", "-ia", handle_id])
        elif request.get("x") is not None:
            click_at(request)
    elif action == "open_app":
        name = request.get("app") or ""
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", name):
            raise Failure("Name the program only, without paths or arguments.")
        if name in ("chromium", "browser", "chrome"):
            start_browser()
        else:
            program = shutil.which(name)
            if not program:
                raise Failure(f"{name} is not installed in this computer.")
            subprocess.Popen([program], cwd=HOME, stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True)
    elif action == "clipboard_read":
        text = run(["xclip", "-selection", "clipboard", "-o"]).decode("utf-8", "replace")
        return {"text": text[:20000]}
    elif action == "clipboard_write":
        run(["xclip", "-selection", "clipboard", "-i"], data=(request.get("text") or "").encode())
    elif action == "open_url":
        return open_url(request.get("url"))
    elif action == "exec":
        return execute(request)
    else:
        raise Failure("Unsupported action.")
    return {"method": "pointer or keyboard", "focusChanged": False}


def respond(request):
    identifier = request.get("id") if isinstance(request, dict) else None
    try:
        if not isinstance(request, dict):
            raise Failure("Send a JSON object.")
        return {"id": identifier, "ok": True, "result": handle(request)}
    except Failure as error:
        return {"id": identifier, "ok": False, "error": str(error)}
    except Exception as error:  # Report, never crash the serving loop.
        return {"id": identifier, "ok": False, "error": f"{type(error).__name__}: {error}"[:500]}


def serve():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except ValueError:
            continue
        sys.stdout.write(json.dumps(respond(request)) + "\n")
        sys.stdout.flush()


def http(address):
    token = os.environ.get("JACKALOPE_COMPUTER_TOKEN", "")
    if len(token) < 32:
        sys.exit("JACKALOPE_COMPUTER_TOKEN must be at least 32 characters.")
    host, _, port = address.rpartition(":")
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def authorized(self):
            supplied = self.headers.get("Authorization", "")
            return hmac.compare_digest(supplied.encode(), f"Bearer {token}".encode())

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if not self.authorized():
                return self.reply(401, {"error": "Pairing secret required."})
            if self.path != "/v1/health":
                return self.reply(404, {"error": "Not found."})
            with lock:
                self.reply(200, respond({"id": 0, "action": "hello"}))

        def do_POST(self):
            if not self.authorized():
                return self.reply(401, {"error": "Pairing secret required."})
            if self.path != "/v1/call":
                return self.reply(404, {"error": "Not found."})
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > BODY_LIMIT:
                return self.reply(413, {"error": "Request too large."})
            try:
                request = json.loads(self.rfile.read(length))
            except ValueError:
                return self.reply(400, {"error": "Send one JSON request."})
            # Runs keep their state in files and may wait for output, so they
            # do not hold the lock that serializes desktop actions.
            if isinstance(request, dict) and request.get("action") in RUN_ACTIONS:
                return self.reply(200, respond(request))
            with lock:
                self.reply(200, respond(request))

    ThreadingHTTPServer((host or "0.0.0.0", int(port)), Handler).serve_forever()


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if mode == "serve":
        serve()
    elif mode == "http":
        http(sys.argv[2] if len(sys.argv) > 2 else "0.0.0.0:8765")
    elif mode == "supervise" and len(sys.argv) > 2:
        supervise(sys.argv[2])
    elif mode == "mcp-launch" and len(sys.argv) > 2:
        launch_connection(sys.argv[2])
    elif mode == "mcp-approve":
        approve_tool()
    elif mode == "browser":
        wait_for_display()
        start_browser()
    else:
        sys.exit("Use serve, http HOST:PORT or browser.")
