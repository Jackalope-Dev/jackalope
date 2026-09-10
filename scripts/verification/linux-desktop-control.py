#!/usr/bin/env python3
"""Owned X11 fixtures. Run through linux-desktop-control.sh, never a user's display."""
import json
import ctypes
import os
from pathlib import Path
import signal
import struct
import subprocess
import sys
import tempfile
import time


def fixture(directory):
    import gi
    gi.require_version('Gtk', '3.0')
    from gi.repository import Gtk, GLib
    window = Gtk.Window(title='Jackalope X11 fixture')
    window.set_default_size(600, 420)
    window.move(120, 160)
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
    box.set_border_width(20)
    entry = Gtk.Entry()
    entry.get_accessible().set_name('Fixture text')
    password = Gtk.Entry()
    password.set_visibility(False)
    password.set_text('fixture-password-must-be-redacted')
    password.get_accessible().set_name('Fixture password')
    button = Gtk.Button(label='Fixture click')
    button.connect('clicked', lambda *_: (directory / 'clicked').write_text('yes'))
    scroll = Gtk.ScrolledWindow()
    scroll.set_size_request(400, 150)
    content = Gtk.Label(label='\n'.join(f'Fixture line {n}' for n in range(100)))
    scroll.add(content)
    for item in [entry, password, button, scroll]:
        box.pack_start(item, item is scroll, item is scroll, 0)
    window.add(box)
    other = Gtk.Window(title='Jackalope other fixture')
    other.set_default_size(300, 180)
    other.add(Gtk.Label(label='Other window requires its own grant'))
    window.connect('destroy', Gtk.main_quit)
    window.show_all()
    entry.grab_focus()

    def tick():
        (directory / 'text').write_text(entry.get_text())
        (directory / 'scroll').write_text(str(scroll.get_vadjustment().get_value()))
        command = directory / 'command'
        if command.exists():
            action = command.read_text()
            command.unlink()
            if action == 'other':
                other.show_all()
                other.present()
            elif action == 'text':
                other.hide()
                window.present()
                entry.grab_focus()
            elif action == 'password':
                password.grab_focus()
            elif action == 'move':
                window.move(170, 210)
            elif action == 'hide':
                window.hide()
        return True

    GLib.timeout_add(40, tick)
    (directory / 'ready').write_text('ready')
    Gtk.main()


def wait(check, description, timeout=12):
    from gi.repository import GLib
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        while GLib.MainContext.default().pending():
            GLib.MainContext.default().iteration(False)
        try:
            result = check()
            if result:
                return result
        except (FileNotFoundError, json.JSONDecodeError, IndexError) as error:
            last = error
        time.sleep(.08)
    raise AssertionError(f'Timed out: {description}; {last}')


def trial(helper):
    children = []
    with tempfile.TemporaryDirectory(prefix='jackalope-x11-trial-') as temporary:
        directory = Path(temporary)

        def launch(arguments, **kwargs):
            process = subprocess.Popen(arguments, start_new_session=True, **kwargs)
            children.append(process)
            return process

        def call(payload, error=None):
            result = subprocess.run([helper], env={**os.environ, 'JACKALOPE_DESKTOP_REQUEST': json.dumps(payload)},
                                    capture_output=True, text=True, timeout=20)
            if error:
                assert result.returncode != 0 and error in result.stderr, result.stderr
                return result.stderr
            assert result.returncode == 0, result.stderr
            return json.loads(result.stdout)

        try:
            app = launch([sys.executable, __file__, '--fixture', temporary])
            wait(lambda: (directory / 'ready').exists(), 'fixture startup')
            window = wait(lambda: next((item for item in call({'action': 'list'})['windows']
                                       if item['pid'] == app.pid and item['title'] == 'Jackalope X11 fixture'), None), 'window inventory')
            (directory / 'theme').write_text('#6366f1')
            indicator = launch([helper], env={**os.environ, 'JACKALOPE_DESKTOP_REQUEST': json.dumps({
                'action': 'indicator', 'window': window, 'file': str(directory / 'state'), 'theme': str(directory / 'theme')})})

            def state():
                assert indicator.poll() is None, 'indicator exited'
                return (directory / 'state').read_text().split('|')

            wait(lambda: state()[0] == 'paused', 'indicator starts paused')

            def resume():
                windows = call({'action': 'list'})['windows']
                bar = next((item for item in windows if item['pid'] == indicator.pid), None)
                if not bar:
                    return False
                subprocess.run(['xdotool', 'mousemove', '--window', bar['handle'], '410', '25', 'click', '1'], check=True, timeout=5)
                return True

            def activate():
                wait(resume, 'native Resume button')
                try:
                    wait(lambda: state()[0] == 'active', 'native Resume activation')
                except AssertionError:
                    print('Indicator state:', state(), flush=True)
                    raise

            activate()
            guard = {'file': str(directory / 'state'), 'epoch': int(state()[1])}

            def operation(action, **fields):
                return call({'action': action, 'window': window, 'guard': guard, **fields})

            snapshot = operation('snapshot')
            assert any(node.get('password') for node in snapshot['controls']), snapshot
            assert 'fixture-password-must-be-redacted' not in json.dumps(snapshot)
            text = 'literal $(echo) {ENTER} café 🦊'
            operation('type', bounds=snapshot['bounds'], text=text)
            wait(lambda: (directory / 'text').read_text() == text, 'literal Unicode typing')
            snapshot = operation('snapshot')
            assert any(node.get('value') == text for node in snapshot['controls']), snapshot
            operation('press', bounds=snapshot['bounds'], key='Control+a')
            operation('type', bounds=operation('snapshot')['bounds'], text='replacement')
            wait(lambda: (directory / 'text').read_text() == 'replacement', 'replace selected text')
            snapshot = operation('snapshot')
            button = next(node for node in snapshot['controls'] if node.get('name') == 'Fixture click')
            point = button['bounds']
            operation('click', bounds=snapshot['bounds'], x=point['x'] + point['width']//2, y=point['y'] + point['height']//2)
            wait(lambda: (directory / 'clicked').exists(), 'scoped button click')
            snapshot = operation('snapshot')
            operation('scroll', bounds=snapshot['bounds'], x=100, y=snapshot['bounds']['height'] - 60, wheel=-5)
            wait(lambda: float((directory / 'scroll').read_text()) > 0, 'scoped wheel input')
            capture = directory / 'capture.png'
            result = operation('screenshot', path=str(capture))
            png = capture.read_bytes()
            assert png[:8] == b'\x89PNG\r\n\x1a\n'
            assert struct.unpack('>II', png[16:24]) == (result['bounds']['width'], result['bounds']['height'])
            import gi
            gi.require_version('GdkPixbuf', '2.0')
            from gi.repository import GdkPixbuf
            pixels = GdkPixbuf.Pixbuf.new_from_file(str(capture))
            colors = pixels.get_pixels()
            assert len({colors[index:index + 3] for index in range(0, len(colors) - 3, 3)}) > 20, 'Capture is blank'
            call({'action': 'click', 'window': window, 'guard': guard, 'bounds': snapshot['bounds'], 'x': -1, 'y': 0}, error='outside')
            (directory / 'command').write_text('password')
            time.sleep(.2)
            call({'action': 'type', 'window': window, 'guard': guard, 'bounds': snapshot['bounds'], 'text': 'must fail'}, error='password')
            (directory / 'command').write_text('other')
            wait(lambda: state()[0] == 'paused', 'focus loss pauses access')
            call({'action': 'snapshot', 'window': window, 'guard': guard}, error='paused')
            (directory / 'command').write_text('text')
            time.sleep(.2)
            activate()
            call({'action': 'snapshot', 'window': window, 'guard': guard}, error='changed')
            guard['epoch'] = int(state()[1])
            snapshot = operation('snapshot')
            (directory / 'command').write_text('move')
            wait(lambda: state()[0] == 'paused', 'window movement pauses access')
            activate()
            guard['epoch'] = int(state()[1])
            call({'action': 'type', 'window': window, 'guard': guard, 'bounds': snapshot['bounds'], 'text': 'must fail'}, error='moved')
            physical_key(0x61)
            wait(lambda: state()[0] == 'paused' and 'Physical' in state()[5], 'physical-device key pauses access')
            call({'action': 'focus', 'window': window, 'guard': guard}, error='paused')
            activate()
            guard['epoch'] = int(state()[1])
            physical_key(0xff1b)
            indicator.wait(timeout=5)
            call({'action': 'snapshot', 'window': window, 'guard': guard}, error='ended')
            print('PASS: X11 inventory, native Resume, snapshots, password rejection, Unicode typing, replacement, click, scroll, PNG, focus/movement/physical-device pause, Escape, epochs and indicator loss')
        finally:
            for child in reversed(children):
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait(timeout=5)


def physical_key(symbol):
    class Device(ctypes.Structure):
        _fields_ = [('id', ctypes.c_int), ('name', ctypes.c_char_p), ('use', ctypes.c_int),
                    ('attachment', ctypes.c_int), ('enabled', ctypes.c_int), ('classes', ctypes.c_int),
                    ('data', ctypes.c_void_p)]
    x11 = ctypes.CDLL('libX11.so.6')
    xi = ctypes.CDLL('libXi.so.6')
    xtest = ctypes.CDLL('libXtst.so.6')
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XKeysymToKeycode.restype = ctypes.c_ubyte
    x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    xi.XIQueryDevice.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
    xi.XIQueryDevice.restype = ctypes.POINTER(Device)
    xi.XIFreeDeviceInfo.argtypes = [ctypes.POINTER(Device)]
    xi.XOpenDevice.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    xi.XOpenDevice.restype = ctypes.c_void_p
    xi.XCloseDevice.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    xtest.XTestFakeDeviceKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint, ctypes.c_int,
                                             ctypes.c_void_p, ctypes.c_int, ctypes.c_ulong]
    display = x11.XOpenDisplay(None)
    assert display
    device = None
    try:
        count = ctypes.c_int()
        devices = xi.XIQueryDevice(display, 0, ctypes.byref(count))
        candidates = [devices[index].id for index in range(count.value)
                      if devices[index].name == b'Xvfb keyboard']
        xi.XIFreeDeviceInfo(devices)
        assert len(candidates) == 1, 'This trial must run on its own Xvfb desktop'
        device = xi.XOpenDevice(display, candidates[0])
        assert device
        code = x11.XKeysymToKeycode(display, symbol)
        assert xtest.XTestFakeDeviceKeyEvent(display, device, code, 1, None, 0, 0)
        assert xtest.XTestFakeDeviceKeyEvent(display, device, code, 0, None, 0, 0)
        x11.XSync(display, 0)
    finally:
        if device:
            xi.XCloseDevice(display, device)
        x11.XCloseDisplay(display)


if __name__ == '__main__':
    if sys.argv[1] == '--fixture':
        fixture(Path(sys.argv[2]))
    else:
        trial(str(Path(sys.argv[1]).resolve()))
