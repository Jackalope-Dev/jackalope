#!/usr/bin/env python3
"""Jackalope bot computer agent.

Speaks the desktop helper's JSON-lines protocol: requests are
{"id": n, "action": ...} and responses {"id": n, "ok": bool, "result"|"error"}.

  agent.py serve          one request per stdin line (local sandboxes, via docker exec)
  agent.py http HOST:PORT POST /v1/call with one request per body; requires
                          JACKALOPE_COMPUTER_TOKEN as a bearer secret
  agent.py browser        start Chromium if it is not running
  agent.py supervise DIR  internal: owns one agent run started by run_start

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
"""

import base64
import fcntl
import hashlib
import hmac
import io
import json
import os
import re
import secrets
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
# Agent runs, reported by hello as `runs`.
RUNS_PROTOCOL = 2
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
}
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
    """Extracts regular files, directories and in-tree symbolic links only."""
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
                with open(destination, "wb") as handle:
                    shutil.copyfileobj(source, handle)
                os.chmod(destination, 0o755 if member.mode & 0o100 else 0o644)
            elif member.issym():
                target = os.path.join(os.path.dirname(destination), member.linkname)
                if os.path.isabs(member.linkname) or not inside(workspace, target):
                    raise Failure(f"The workspace upload links outside itself: {name[:200]}")
                os.makedirs(os.path.dirname(destination), exist_ok=True)
                os.symlink(member.linkname, destination)
            else:
                raise Failure(f"The workspace upload has an unsupported entry: {name[:200]}")


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
    timeout = min(max(int(request.get("timeout_s") or 3600), 10), 6 * 3600)
    spec = {"argv": argv, "env": env, "timeout": timeout, "workspace": workspace,
            "relay": bool(request.get("relay"))}
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
    deadline = time.time() + 15
    while time.time() < deadline:
        if os.path.exists(os.path.join(directory, "pid")):
            return {"started": True}
        if os.path.exists(os.path.join(directory, "exit.json")):
            return {"started": False, "exit": read_exit(directory)}
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
        return {"exists": False}
    supervisor_gone(directory)
    started = any(os.path.exists(os.path.join(directory, f)) for f in ("pid", "exit.json"))
    return {
        "exists": True,
        "uploaded": os.path.isfile(os.path.join(directory, "base")),
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
    body = request.get("body") or ""
    if not isinstance(body, str) or len(body) > (RELAY_ANSWER_LIMIT * 4) // 3 + 4:
        raise Failure("The bridge answer is too large.")
    base64.b64decode(body, validate=True)
    temporary = os.path.join(queue, call + ".res.tmp")
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump({"status": status, "contentType": content_type, "body": body}, handle)
    os.replace(temporary, os.path.join(queue, call + ".res"))
    return {"delivered": True}


def relay(directory):
    """Serves the bridge to the run's agent on a free loopback port. Returns its
    address and the secret the agent must present."""
    queue = bridge_queue(directory)
    os.makedirs(queue, mode=0o700, exist_ok=True)
    secret = secrets.token_hex(32)

    def forget(call):
        for kind in (".req", ".taken", ".res"):
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
            finally:
                forget(call)
            self.reply(int(result["status"]), base64.b64decode(result["body"]),
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
    shutil.rmtree(directory, ignore_errors=True)
    return {"removed": True}


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
    }[action](request)


def handle(request):
    action = request.get("action")
    if action in RUN_ACTIONS:
        return handle_run(request)
    if action == "hello":
        wait_for_display()
        width, height = screen_size()
        return {"protocol": PROTOCOL, "runs": RUNS_PROTOCOL, "screen": [width, height],
                "browser": browser_running()}
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
    elif mode == "browser":
        wait_for_display()
        start_browser()
    else:
        sys.exit("Use serve, http HOST:PORT or browser.")
