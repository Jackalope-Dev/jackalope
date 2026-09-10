#!/usr/bin/env python3
"""Owned GNOME Wayland fixtures; launch only through linux-wayland-control.sh."""

import importlib.util, json, os, pathlib, signal, struct, subprocess, sys, tempfile, time
import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi, Gio, GLib

Atspi.set_timeout(200, 200)
spec = importlib.util.spec_from_file_location(
    "x11fixture", str(pathlib.Path(__file__).with_name("linux-desktop-control.py"))
)
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)

if len(sys.argv) > 1 and sys.argv[1] == "--fixture":
    common.fixture(pathlib.Path(sys.argv[2]), "Jackalope Wayland fixture")
    sys.exit()


def wait(check, description, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            result = check()
            if result:
                return result
        except (FileNotFoundError, IndexError, json.JSONDecodeError):
            pass
        time.sleep(0.08)
    raise AssertionError("Timed out: " + description)


helper = sys.argv[1]
assert (
    os.environ.get("JACKALOPE_WAYLAND_FIXTURE") == "private-headless-session"
), "Use the isolated fixture launcher"
signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)


def bus(path, iface, method, args=None):
    return connection.call_sync(
        "org.gnome.Mutter.RemoteDesktop",
        path,
        iface,
        method,
        args,
        None,
        Gio.DBusCallFlags.NO_AUTO_START,
        5000,
        None,
    )


remote = bus(
    "/org/gnome/Mutter/RemoteDesktop", "org.gnome.Mutter.RemoteDesktop", "CreateSession"
).unpack()[0]
remote_iface = "org.gnome.Mutter.RemoteDesktop.Session"
bus(remote, remote_iface, "Start")


def human_key(key, down):
    bus(remote, remote_iface, "NotifyKeyboardKeysym", GLib.Variant("(ub)", (key, down)))


human_key(0xFF1B, True)
human_key(0xFF1B, False)
time.sleep(0.4)


def resume():
    desktop = Atspi.get_desktop(0)
    queue = [(desktop, 0)]
    deadline = time.monotonic() + 4
    while queue and time.monotonic() < deadline:
        item, depth = queue.pop(0)
        if depth > 10:
            continue
        if item.get_name() == "Resume":
            rect = item.get_component_iface().get_extents(Atspi.CoordType.SCREEN)
            bus(
                remote,
                remote_iface,
                "NotifyPointerMotionRelative",
                GLib.Variant("(dd)", (-20000.0, -20000.0)),
            )
            time.sleep(0.05)
            bus(
                remote,
                remote_iface,
                "NotifyPointerMotionRelative",
                GLib.Variant(
                    "(dd)",
                    (float(rect.x + rect.width // 2), float(rect.y + rect.height // 2)),
                ),
            )
            time.sleep(0.05)
            bus(
                remote,
                remote_iface,
                "NotifyPointerButton",
                GLib.Variant("(ib)", (272, True)),
            )
            bus(
                remote,
                remote_iface,
                "NotifyPointerButton",
                GLib.Variant("(ib)", (272, False)),
            )
            return True
        for i in range(min(item.get_child_count(), 200)):
            child = item.get_child_at_index(i)
            if child:
                queue.append((child, depth + 1))
    return False


with tempfile.TemporaryDirectory(prefix="jackalope-wayland-control-") as temporary:
    d = pathlib.Path(temporary)
    children = []

    def launch(args, **kw):
        child = subprocess.Popen(args, start_new_session=True, **kw)
        children.append(child)
        return child

    def call(payload, error=None):
        result = subprocess.run(
            [helper],
            env={**os.environ, "JACKALOPE_DESKTOP_REQUEST": json.dumps(payload)},
            capture_output=True,
            text=True,
            timeout=20,
        )
        if error:
            assert result.returncode and error in result.stderr, result.stderr
            return
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout)

    try:
        app = launch([sys.executable, __file__, "--fixture", temporary])
        wait(lambda: (d / "ready").exists(), "app ready")
        time.sleep(0.5)
        window = wait(
            lambda: next(
                (w for w in call({"action": "list"})["windows"] if w["pid"] == app.pid),
                None,
            ),
            "window",
        )
        (d / "theme").write_text("#6366f1")
        indicator = launch(
            [helper],
            env={
                **os.environ,
                "JACKALOPE_DESKTOP_REQUEST": json.dumps(
                    {
                        "action": "indicator",
                        "window": window,
                        "file": str(d / "state"),
                        "theme": str(d / "theme"),
                    }
                ),
            },
        )

        def state():
            assert indicator.poll() is None, "indicator exited"
            return (d / "state").read_text().split("|")

        wait(lambda: state()[0] == "paused", "initial pause")
        wait(resume, "native Resume")
        try:
            wait(lambda: state()[0] == "active", "active")
        except:
            print("Failed state:", state(), flush=True)
            raise
        guard = {"file": str(d / "state"), "epoch": int(state()[1])}

        def operation(action, **fields):
            return call({"action": action, "window": window, "guard": guard, **fields})

        if os.environ.get("JACKALOPE_WAYLAND_CAPTURE"):
            connection.call_sync(
                "org.freedesktop.DBus",
                "/org/freedesktop/DBus",
                "org.freedesktop.DBus",
                "RequestName",
                GLib.Variant("(su)", ("org.gnome.Screenshot", 0)),
                None,
                Gio.DBusCallFlags.NONE,
                5000,
                None,
            )
            capture = connection.call_sync(
                "org.gnome.Shell",
                "/org/gnome/Shell/Screenshot",
                "org.gnome.Shell.Screenshot",
                "Screenshot",
                GLib.Variant(
                    "(bbs)", (False, False, os.environ["JACKALOPE_WAYLAND_CAPTURE"])
                ),
                None,
                Gio.DBusCallFlags.NONE,
                5000,
                None,
            ).unpack()
            assert capture[0], "Native control bar capture failed"
        snapshot = operation("snapshot")
        assert any(n.get("password") for n in snapshot["controls"])
        assert "fixture-password-must-be-redacted" not in json.dumps(snapshot)
        text = "literal $(echo) {ENTER} café 🦊"
        operation("type", bounds=snapshot["bounds"], text=text)
        wait(lambda: (d / "text").read_text() == text, "Unicode typing")
        operation("press", bounds=snapshot["bounds"], key="Control+a")
        operation("type", bounds=operation("snapshot")["bounds"], text="replacement")
        wait(lambda: (d / "text").read_text() == "replacement", "replacement")
        (d / "command").write_text("password")
        time.sleep(0.2)
        call(
            {
                "action": "type",
                "window": window,
                "guard": guard,
                "bounds": snapshot["bounds"],
                "text": "forbidden",
            },
            error="password",
        )
        (d / "command").write_text("text")
        time.sleep(0.2)
        snapshot = operation("snapshot")
        button = next(
            n for n in snapshot["controls"] if n.get("name") == "Fixture click"
        )["bounds"]
        operation(
            "click",
            bounds=snapshot["bounds"],
            x=button["x"] + button["width"] // 2,
            y=button["y"] + button["height"] // 2,
        )
        wait(lambda: (d / "clicked").exists(), "click")
        operation(
            "scroll",
            bounds=snapshot["bounds"],
            x=100,
            y=snapshot["bounds"]["height"] - 60,
            wheel=-5,
        )
        wait(lambda: float((d / "scroll").read_text()) > 0, "scroll")
        capture = d / "capture.png"
        result = operation("screenshot", path=str(capture))
        png = capture.read_bytes()
        assert png[:8] == b"\x89PNG\r\n\x1a\n"
        assert struct.unpack(">II", png[16:24]) == (
            result["bounds"]["width"],
            result["bounds"]["height"],
        )
        human_key(ord("a"), True)
        human_key(ord("a"), False)
        wait(lambda: state()[0] == "paused", "foreign input pauses")
        call({"action": "snapshot", "window": window, "guard": guard}, error="paused")
        wait(resume, "Resume after interruption")
        wait(lambda: state()[0] == "active", "active again")
        call({"action": "snapshot", "window": window, "guard": guard}, error="changed")
        guard["epoch"] = int(state()[1])
        bus(
            remote,
            remote_iface,
            "NotifyPointerMotionRelative",
            GLib.Variant("(dd)", (5.0, 5.0)),
        )
        wait(lambda: state()[0] == "paused", "foreign pointer pauses")
        wait(resume, "Resume after pointer")
        wait(lambda: state()[0] == "active", "active after pointer")
        human_key(0xFFE3, True)
        wait(lambda: state()[0] == "paused", "held Control pauses")
        wait(resume, "Resume while Control held")
        time.sleep(0.4)
        assert state()[0] == "paused", "Held modifier allowed Resume"
        human_key(0xFFE3, False)
        wait(resume, "Resume after releasing Control")
        wait(lambda: state()[0] == "active", "active after held modifier")
        guard["epoch"] = int(state()[1])
        (d / "command").write_text("other")
        wait(lambda: state()[0] == "paused", "focus loss pauses")
        (d / "command").write_text("text")
        time.sleep(0.2)
        wait(resume, "Resume after focus loss")
        wait(lambda: state()[0] == "active", "active after focus loss")
        guard["epoch"] = int(state()[1])
        human_key(0xFF1B, True)
        human_key(0xFF1B, False)
        wait(lambda: indicator.poll() is not None, "Escape closes grant")
        assert call({"action": "permissions"})["available"] is True
        time.sleep(0.3)
        (d / "state").unlink()
        indicator = launch(
            [helper],
            env={
                **os.environ,
                "JACKALOPE_DESKTOP_REQUEST": json.dumps(
                    {
                        "action": "indicator",
                        "window": window,
                        "file": str(d / "state"),
                        "theme": str(d / "theme"),
                    }
                ),
            },
        )
        wait(lambda: state()[0] == "paused", "second grant starts paused")
        wait(resume, "Resume second grant")
        wait(lambda: state()[0] == "active", "second grant active")
        guard["epoch"] = int(state()[1])
        os.kill(indicator.pid, signal.SIGSTOP)
        time.sleep(3.5)
        os.kill(indicator.pid, signal.SIGCONT)
        wait(lambda: indicator.poll() is not None, "expired heartbeat ends grant")
        call({"action": "snapshot", "window": window, "guard": guard}, error="ended")
        subprocess.run(
            ["gnome-extensions", "disable", "desktop-control@jackalope.dev"],
            check=True,
            timeout=10,
        )
        readiness = call({"action": "permissions"})
        assert readiness["available"] is False and readiness["canInstall"] is True
        call({"action": "list"}, error="GNOME window control failed")
        print(
            "PASS: native Wayland inventory, Resume, accessibility, password protection, literal typing, keys, click, scroll, selected capture, keyboard/pointer interruption, focus loss, held modifiers, epochs, Escape, heartbeat expiry and extension readiness",
            flush=True,
        )
    finally:
        for child in reversed(children):
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
            child.wait(timeout=5)
        bus(remote, remote_iface, "Stop")
