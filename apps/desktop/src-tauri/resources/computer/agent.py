#!/usr/bin/env python3
"""Jackalope bot computer agent.

Speaks the desktop helper's JSON-lines protocol: requests are
{"id": n, "action": ...} and responses {"id": n, "ok": bool, "result"|"error"}.

  agent.py serve          one request per stdin line (local sandboxes, via docker exec)
  agent.py http HOST:PORT POST /v1/call with one request per body; requires
                          JACKALOPE_COMPUTER_TOKEN as a bearer secret
  agent.py browser        start Chromium if it is not running

Coordinates are screen pixels. Element refs are resolved by Jackalope, which
sends coordinates. Screenshots are returned as base64 PNG.
"""

import base64
import hmac
import io
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROTOCOL = 1
OUTPUT_LIMIT = 64 * 1024
BODY_LIMIT = 1024 * 1024
DEVTOOLS = "http://127.0.0.1:9222"
HOME = os.path.expanduser("~")
PROFILE = os.path.join(HOME, ".config", "jackalope-chromium")
ELEMENT_LIMIT = 300
VISIT_LIMIT = 4000


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


def handle(request):
    action = request.get("action")
    if action == "hello":
        wait_for_display()
        width, height = screen_size()
        return {"protocol": PROTOCOL, "screen": [width, height], "browser": browser_running()}
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
            with lock:
                self.reply(200, respond(request))

    ThreadingHTTPServer((host or "0.0.0.0", int(port)), Handler).serve_forever()


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if mode == "serve":
        serve()
    elif mode == "http":
        http(sys.argv[2] if len(sys.argv) > 2 else "0.0.0.0:8765")
    elif mode == "browser":
        wait_for_display()
        start_browser()
    else:
        sys.exit("Use serve, http HOST:PORT or browser.")
