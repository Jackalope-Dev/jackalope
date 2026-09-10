import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import { Extension, InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { requireValue, sameBounds, validBounds, WindowGrant } from './guard.js';

const IFACE = `<node><interface name="org.jackalope.DesktopControl1">
  <method name="Call"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
</interface></node>`;
const now = () => Math.floor(GLib.get_monotonic_time() / 1000);
const delay = (ms) =>
  new Promise((resolve) =>
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      resolve();
      return GLib.SOURCE_REMOVE;
    }),
  );
const decode = (bytes) => new TextDecoder().decode(bytes);
const KEYS = {
  Tab: Clutter.KEY_Tab,
  Enter: Clutter.KEY_Return,
  Escape: Clutter.KEY_Escape,
  Space: Clutter.KEY_space,
  Backspace: Clutter.KEY_BackSpace,
  Delete: Clutter.KEY_Delete,
  ArrowUp: Clutter.KEY_Up,
  ArrowDown: Clutter.KEY_Down,
  ArrowLeft: Clutter.KEY_Left,
  ArrowRight: Clutter.KEY_Right,
  Home: Clutter.KEY_Home,
  End: Clutter.KEY_End,
  PageUp: Clutter.KEY_Page_Up,
  PageDown: Clutter.KEY_Page_Down,
};

function processStart(pid) {
  requireValue(Number.isSafeInteger(pid) && pid > 0, 'Invalid process identity.');
  const [, bytes] = GLib.file_get_contents(`/proc/${pid}/stat`);
  const text = decode(bytes);
  const started = text
    .slice(text.lastIndexOf(')') + 2)
    .trim()
    .split(/\s+/)[19];
  requireValue(/^\d+$/.test(started), 'Process start time is unavailable.');
  return started;
}

export default class JackalopeControl extends Extension {
  enable() {
    requireValue(Config.PACKAGE_VERSION.startsWith('46.'), 'This bridge requires GNOME 46.');
    this._instance = GLib.uuid_string_random();
    this._seat = Clutter.get_default_backend().get_default_seat();
    this._keys = new Map();
    this._buttons = new Map();
    this._touches = new Set();
    this._ownDevices = new Set();
    this._retiredDevices = new Set();
    this._signals = [];
    this._session = null;
    this._resumeTicket = 0;
    this._enabled = true;
    this._idleMonitor = global.backend.get_core_idle_monitor();
    this._injections = new InjectionManager();
    const observe = (event) => this._input(event);
    this._injections.overrideMethod(
      Object.getPrototypeOf(Main.inputMethod),
      'vfunc_filter_key_event',
      (original) =>
        function (event) {
          observe(event);
          return original.call(this, event);
        },
    );
    this._watchInput();
    this._signals.push([
      global.stage,
      global.stage.connect('captured-event', (_stage, event) => this._input(event)),
    ]);
    this._signals.push([
      global.display,
      global.display.connect('notify::focus-window', () => this._verify()),
    ]);
    this._signals.push([
      Main.sessionMode,
      Main.sessionMode.connect('updated', () => this._verify()),
    ]);
    this._signals.push([
      Main.overview,
      Main.overview.connect('showing', () => this._pause('Overview opened')),
    ]);
    this._signals.push([
      this._seat,
      this._seat.connect('device-removed', (_seat, device) => {
        if (this._retiredDevices.delete(device)) return;
        this._cancel('Input device disconnected');
        this._keys.clear();
        this._buttons.clear();
        this._touches.clear();
      }),
    ]);
    const remoteAccess = global.backend.get_remote_access_controller();
    this._signals.push([
      remoteAccess,
      remoteAccess.connect('new-handle', (_controller, handle) => {
        if (GObject.type_name_from_instance(handle) === 'MetaInputCaptureSessionHandle')
          this._cancel('Another application captured desktop input');
      }),
    ]);
    this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
    this._dbus.export(Gio.DBus.session, '/org/jackalope/DesktopControl');
    this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
      this._verify();
      return GLib.SOURCE_CONTINUE;
    });
  }

  disable() {
    this._enabled = false;
    if (this._inputWatch) this._idleMonitor.remove_watch(this._inputWatch);
    this._inputWatch = 0;
    this._injections?.clear();
    this._cancel('GNOME extension disabled');
    this._forget();
    for (const [object, id] of this._signals ?? []) object.disconnect(id);
    if (this._timer) GLib.source_remove(this._timer);
    this._dbus?.unexport();
    this._dbus = null;
  }

  _identity(window) {
    requireValue(
      window && !window.minimized && !window.is_hidden() && window.showing_on_its_workspace(),
      'The selected window is hidden, closed or on another workspace.',
    );
    const actor = window.get_compositor_private();
    requireValue(actor?.visible && actor.mapped, 'Selected window content is unavailable.');
    const pid = window.get_pid();
    const rect = window.get_frame_rect();
    const bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    const surface = window.get_buffer_rect();
    const buffer = { x: surface.x, y: surface.y, width: surface.width, height: surface.height };
    requireValue(validBounds(bounds), 'Window bounds are unavailable or too large.');
    const app =
      window.get_wm_class() || window.get_gtk_application_id() || window.get_sandboxed_app_id();
    requireValue(
      typeof app === 'string' && app.length > 0,
      'Window application identity is unavailable.',
    );
    return {
      handle: `${this._instance}:${window.get_stable_sequence()}`,
      pid,
      started: processStart(pid),
      class: app,
      title: window.get_title() || app,
      bounds,
      buffer,
    };
  }

  _windows() {
    return global
      .get_window_actors()
      .map((actor) => actor.meta_window)
      .filter(
        (window) =>
          window.get_window_type() === Meta.WindowType.NORMAL ||
          window.get_window_type() === Meta.WindowType.DIALOG,
      );
  }

  _selected(identity) {
    const window = this._windows().find(
      (candidate) => `${this._instance}:${candidate.get_stable_sequence()}` === identity?.handle,
    );
    const current = this._identity(window);
    requireValue(
      ['pid', 'started', 'class'].every((key) => current[key] === identity[key]),
      'Selected window identity changed.',
    );
    return [window, current];
  }

  _focused(window) {
    const focus = global.stage.get_key_focus();
    return (
      global.display.focus_window === window &&
      !Main.overview.visible &&
      !Main.sessionMode.isLocked &&
      (Main.sessionMode.currentMode === 'user' || Main.sessionMode.parentMode === 'user') &&
      Main.modalCount === 0 &&
      (!focus || focus === global.stage)
    );
  }

  _held() {
    const [, , mask] = global.get_pointer();
    const modifiers =
      Clutter.ModifierType.SHIFT_MASK |
      Clutter.ModifierType.CONTROL_MASK |
      Clutter.ModifierType.MOD1_MASK |
      Clutter.ModifierType.MOD4_MASK |
      Clutter.ModifierType.MOD5_MASK |
      Clutter.ModifierType.BUTTON1_MASK |
      Clutter.ModifierType.BUTTON2_MASK |
      Clutter.ModifierType.BUTTON3_MASK |
      Clutter.ModifierType.BUTTON4_MASK |
      Clutter.ModifierType.BUTTON5_MASK;
    return (
      this._keys.size > 0 ||
      this._buttons.size > 0 ||
      this._touches.size > 0 ||
      (mask & modifiers) !== 0
    );
  }

  _inputCaptured() {
    const handles = Main.panel.statusArea.screenSharing?._handles;
    requireValue(handles instanceof Set, 'Compositor input capture status is unavailable.');
    return [...handles].some(
      (handle) => GObject.type_name_from_instance(handle) === 'MetaInputCaptureSessionHandle',
    );
  }

  _input(event) {
    if (!this._enabled) return Clutter.EVENT_PROPAGATE;
    // Input-method replays lost their source device; the original passed our filter.
    if (event.get_flags() & Clutter.EventFlags.FLAG_INPUT_METHOD) return Clutter.EVENT_PROPAGATE;
    const device = event.get_source_device();
    if (this._ownDevices.has(device)) return Clutter.EVENT_PROPAGATE;
    const track = (held, code, down) => {
      if (down) {
        if (!held.has(device)) held.set(device, new Set());
        held.get(device).add(code);
      } else {
        held.get(device)?.delete(code);
        if (held.get(device)?.size === 0) held.delete(device);
      }
    };
    const type = event.type();
    if (type === Clutter.EventType.KEY_PRESS) {
      track(this._keys, event.get_key_code(), true);
      if (event.get_key_symbol() === Clutter.KEY_Escape) this._cancel('Escape pressed');
    } else if (type === Clutter.EventType.KEY_RELEASE) {
      track(this._keys, event.get_key_code(), false);
    } else if (type === Clutter.EventType.BUTTON_PRESS) {
      track(this._buttons, event.get_button(), true);
    } else if (type === Clutter.EventType.BUTTON_RELEASE) {
      track(this._buttons, event.get_button(), false);
    } else if (type === Clutter.EventType.TOUCH_BEGIN) {
      this._touches.add(event.get_event_sequence());
    } else if (type === Clutter.EventType.TOUCH_END || type === Clutter.EventType.TOUCH_CANCEL) {
      this._touches.delete(event.get_event_sequence());
    } else if (
      ![
        Clutter.EventType.MOTION,
        Clutter.EventType.SCROLL,
        Clutter.EventType.TOUCH_UPDATE,
        Clutter.EventType.TOUCHPAD_PINCH,
        Clutter.EventType.TOUCHPAD_SWIPE,
        Clutter.EventType.TOUCHPAD_HOLD,
        Clutter.EventType.PROXIMITY_IN,
        Clutter.EventType.PROXIMITY_OUT,
        Clutter.EventType.PAD_BUTTON_PRESS,
        Clutter.EventType.PAD_BUTTON_RELEASE,
        Clutter.EventType.PAD_RING,
        Clutter.EventType.PAD_STRIP,
      ].includes(type)
    ) {
      return Clutter.EVENT_PROPAGATE;
    }
    this._resumeTicket++;
    if (this._session?.status === 'active')
      this._pause('You used the keyboard, pointer or touch input');
    return Clutter.EVENT_PROPAGATE;
  }

  _watchInput() {
    this._inputWatch = this._idleMonitor.add_user_active_watch(() => {
      this._inputWatch = 0;
      if (!this._enabled) return;
      // Mutter 46 invokes this synchronously before forwarding client events.
      const event = Clutter.get_current_event();
      try {
        if (event) this._input(event);
        else this._pause('Input observation unavailable');
      } catch {
        this._cancel('Input observation failed');
      } finally {
        if (this._enabled) this._watchInput();
      }
    });
  }

  _verify() {
    const session = this._session;
    if (!session || session.status === 'canceled') return;
    if (now() - session.lastSeen > 3000) {
      this._cancel('Indicator connection expired');
      return;
    }
    if (this._preparing) return;
    try {
      requireValue(this._inputWatch > 0, 'Input observation unavailable');
      requireValue(!this._inputCaptured(), 'Another application captured desktop input');
      const [window, current] = this._selected(session.window);
      requireValue(
        this._bar?.visible && this._bar.mapped && !Main.sessionMode.isLocked,
        'Control bar unavailable or desktop locked',
      );
      if (session.status === 'active') {
        requireValue(this._focused(window), 'Selected window lost focus');
        requireValue(sameBounds(current.bounds, session.bounds), 'Window moved or resized');
      }
    } catch (error) {
      this._pause(error.message);
    }
  }

  _pause(reason) {
    this._resumeTicket++;
    if (this._session && this._session.status !== 'canceled') {
      if (this._session.status !== 'paused' || this._session.reason !== reason)
        this._session.pause(reason);
      this._render();
    }
  }

  _cancel(reason) {
    this._resumeTicket++;
    this._session?.cancel(reason);
    this._removeBar();
    this._pointer = null;
    this._keyboard = null;
    for (const device of this._ownDevices) this._retiredDevices.add(device);
    this._ownDevices.clear();
  }

  _forget() {
    if (this._ownerWatch) Gio.bus_unwatch_name(this._ownerWatch);
    this._ownerWatch = 0;
    this._session = null;
  }

  _removeBar() {
    if (this._bar) {
      Main.layoutManager.removeChrome(this._bar);
      this._bar.destroy();
      this._bar = null;
      this._toggle = null;
      this._label = null;
    }
  }

  _render() {
    if (!this._bar || !this._session) return;
    const active = this._session.status === 'active';
    const title = this._session.window.title.slice(0, 36);
    this._label.text = active
      ? `${title} · Jackalope control · Esc to cancel`
      : `${title} · Paused · ${this._session.reason}`;
    this._toggle.label = active ? 'Pause' : 'Resume';
  }

  async _resume() {
    const session = this._session;
    if (session?.status !== 'paused') return;
    const ticket = ++this._resumeTicket;
    try {
      requireValue(!this._held(), 'Release keyboard keys, touches and mouse buttons');
      requireValue(!this._inputCaptured(), 'Another application captured desktop input');
      const [window] = this._selected(session.window);
      global.stage.set_key_focus(null);
      window.activate(global.get_current_time());
      await delay(250);
      requireValue(
        this._enabled && session === this._session && ticket === this._resumeTicket,
        'Input interrupted Resume',
      );
      const [currentWindow, current] = this._selected(session.window);
      requireValue(
        this._focused(currentWindow) && !this._held(),
        'Release held input and focus the selected window',
      );
      requireValue(this._ownDevices.size === 2, 'Dedicated input devices are unavailable');
      session.resume(current.bounds, now());
      this._render();
    } catch (error) {
      if (session === this._session) this._pause(error.message);
    }
  }

  async _begin(request, sender) {
    requireValue(!this._session, 'Another window grant is already reserved.');
    requireValue(Meta.is_wayland_compositor(), 'This bridge requires GNOME Wayland.');
    const [window, current] = this._selected(request.window);
    const session = new WindowGrant(
      current,
      GLib.uuid_string_random() + GLib.uuid_string_random(),
      sender,
      now(),
    );
    this._session = session;
    this._preparing = true;
    this._ownerWatch = Gio.bus_watch_name_on_connection(
      Gio.DBus.session,
      sender,
      Gio.BusNameWatcherFlags.NONE,
      null,
      () => {
        if (this._session === session) {
          this._cancel('Indicator disconnected');
          this._forget();
        }
      },
    );
    try {
      const before = new Set(this._seat.list_devices());
      this._pointer = this._seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
      this._keyboard = this._seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
      await delay(150);
      requireValue(
        this._enabled && this._session === session && session.status === 'paused',
        'Window grant ended during setup.',
      );
      const added = this._seat.list_devices().filter((device) => !before.has(device));
      requireValue(
        added.length === 2 &&
          added.every((device) =>
            ['Virtual pointer device for seat', 'Virtual keyboard device for seat'].includes(
              device.get_device_name(),
            ),
          ),
        'This compositor cannot identify dedicated virtual input devices.',
      );
      this._ownDevices = new Set(added);
      this._bar = new St.BoxLayout({
        reactive: true,
        can_focus: true,
        style:
          'background-color: #111111; color: #ffffff; padding: 10px; spacing: 12px; border-radius: 0 0 10px 10px;',
      });
      this._label = new St.Label({ text: '', x_expand: true, y_align: Clutter.ActorAlign.CENTER });
      this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
      this._toggle = new St.Button({
        label: 'Resume',
        reactive: true,
        can_focus: true,
        style: 'padding: 10px; color: #ffffff; background-color: #333333; border-radius: 6px;',
      });
      const cancel = new St.Button({
        label: 'Cancel',
        reactive: true,
        can_focus: true,
        style: 'padding: 10px; color: #ffffff; background-color: #333333; border-radius: 6px;',
      });
      this._toggle.connect('clicked', () => {
        if (this._session?.status === 'active') this._pause('Paused by you');
        else this._resume();
      });
      cancel.connect('clicked', () => this._cancel('Canceled by you'));
      this._bar.add_child(this._label);
      this._bar.add_child(this._toggle);
      this._bar.add_child(cancel);
      this._bar.accessible_name = `Jackalope window control: ${current.title}`;
      Main.layoutManager.addChrome(this._bar, { affectsInputRegion: true, trackFullscreen: false });
      this._bar.show();
      const monitor = Main.layoutManager.monitors[window.get_monitor()];
      requireValue(monitor, 'Selected monitor is unavailable.');
      this._bar.set_position(monitor.x + Math.max(0, (monitor.width - 720) / 2), monitor.y);
      this._bar.set_width(Math.min(720, monitor.width));
      this._render();
      this._preparing = false;
      return { ...session.state(), token: session.token };
    } catch (error) {
      if (this._session === session) {
        this._cancel(error.message);
        this._forget();
        this._preparing = false;
      }
      throw error;
    }
  }

  _check(request) {
    requireValue(this._enabled && this._session, 'The window grant ended.');
    this._verify();
    const [window, current] = this._selected(request.window);
    this._session.check(request, current, this._focused(window), this._held(), now());
    return [window, current];
  }

  _point(request, current, window) {
    requireValue(
      Number.isSafeInteger(request.x) &&
        Number.isSafeInteger(request.y) &&
        request.x >= 0 &&
        request.y >= 0 &&
        request.x < current.bounds.width &&
        request.y < current.bounds.height,
      'Point is outside the selected window.',
    );
    const x = current.bounds.x + request.x;
    const y = current.bounds.y + request.y;
    const picked = global.stage.get_actor_at_pos(Clutter.PickMode.ALL, x, y);
    const actor = window.get_compositor_private();
    requireValue(
      picked && (picked === actor || actor.contains(picked)),
      'Another window or shell surface covers the target point.',
    );
    return [x, y];
  }

  async _capture(request, window, current) {
    const actor = window.get_compositor_private();
    const content = actor.paint_to_content(new Mtk.Rectangle(current.bounds));
    const texture = content?.get_texture();
    requireValue(
      texture &&
        texture.get_width() === current.bounds.width &&
        texture.get_height() === current.bounds.height,
      'Capture dimensions differ from the selected window.',
    );
    const stream = Gio.MemoryOutputStream.new_resizable();
    try {
      await new Promise((resolve, reject) =>
        Shell.Screenshot.composite_to_stream(
          texture,
          0,
          0,
          current.bounds.width,
          current.bounds.height,
          1,
          null,
          0,
          0,
          1,
          stream,
          (_source, result) => {
            try {
              Shell.Screenshot.composite_to_stream_finish(result);
              resolve();
            } catch (error) {
              reject(error);
            }
          },
        ),
      );
      this._check(request);
      stream.close(null);
      const bytes = stream.steal_as_bytes();
      requireValue(bytes.get_size() <= 8 * 1024 * 1024, 'Window capture exceeds the PNG limit.');
      return { bounds: current.bounds, png: GLib.base64_encode(bytes.get_data()) };
    } finally {
      if (!stream.is_closed()) stream.close(null);
    }
  }

  async _press(request) {
    let key = KEYS[request.key];
    let modifier;
    if (request.key === 'Shift+Tab') {
      key = Clutter.KEY_Tab;
      modifier = Clutter.KEY_Shift_L;
    } else if (/^(Primary|Control)\+[aszy]$/.test(request.key)) {
      key = request.key.charCodeAt(request.key.length - 1);
      modifier = Clutter.KEY_Control_L;
    }
    requireValue(key !== undefined, 'Unsupported editing key.');
    const keyboard = this._keyboard;
    try {
      this._check(request);
      if (modifier)
        keyboard.notify_keyval(GLib.get_monotonic_time(), modifier, Clutter.KeyState.PRESSED);
      keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.PRESSED);
      keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.RELEASED);
    } finally {
      if (modifier)
        keyboard.notify_keyval(GLib.get_monotonic_time(), modifier, Clutter.KeyState.RELEASED);
    }
    await delay(40);
    this._check(request);
    return { status: 'sent' };
  }

  async _call(request, sender) {
    requireValue(
      Meta.is_wayland_compositor() && this._enabled,
      'GNOME Wayland control is unavailable.',
    );
    if (request.action === 'permissions')
      return { available: this._inputWatch > 0, session: 'gnome-wayland', protocol: 1 };
    if (request.action === 'list') {
      const windows = [];
      for (const window of this._windows().reverse()) {
        try {
          windows.push(this._identity(window));
        } catch {
          /* Omit unavailable windows. */
        }
        if (windows.length === 20) break;
      }
      return { windows };
    }
    if (request.action === 'begin') return this._begin(request, sender);
    requireValue(
      this._session && request.token === this._session.token,
      'Window grant is unavailable.',
    );
    if (request.action === 'state') {
      this._verify();
      this._session.heartbeat(sender, now());
      if (/^#[0-9a-fA-F]{6}$/.test(request.accent) && this._toggle)
        this._toggle.set_style(
          `padding: 10px; color: #ffffff; background-color: #333333; border: 2px solid ${request.accent}; border-radius: 6px;`,
        );
      return this._session.state();
    }
    const session = this._session;
    requireValue(!session.busy, 'Another desktop operation is still running.');
    session.busy = true;
    try {
      const [window, current] = this._check(request);
      if (request.action === 'check') return current;
      if (request.action === 'focus') return { status: 'focused' };
      if (request.action === 'screenshot') return await this._capture(request, window, current);
      if (request.action === 'press') return await this._press(request);
      requireValue(['click', 'scroll'].includes(request.action), 'Unsupported desktop operation.');
      const [x, y] = this._point(request, current, window);
      const pointer = this._pointer;
      pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
      await delay(30);
      this._check(request);
      this._point(request, current, window);
      if (request.action === 'click') {
        pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED);
        pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
      } else {
        requireValue(
          Number.isSafeInteger(request.wheel) &&
            request.wheel !== 0 &&
            Math.abs(request.wheel) <= 10,
          'Invalid scroll input.',
        );
        for (let i = 0; i < Math.abs(request.wheel); i++) {
          this._check(request);
          pointer.notify_discrete_scroll(
            0,
            request.wheel > 0 ? Clutter.ScrollDirection.UP : Clutter.ScrollDirection.DOWN,
            Clutter.ScrollSource.WHEEL,
          );
          await delay(20);
        }
      }
      await delay(40);
      this._check(request);
      return { status: 'sent' };
    } finally {
      session.busy = false;
    }
  }

  CallAsync([raw], invocation) {
    if (raw.length > 128000) {
      invocation.return_dbus_error(
        'org.jackalope.DesktopControl1.Error',
        'Desktop request is too large.',
      );
      return;
    }
    Promise.resolve()
      .then(() => this._call(JSON.parse(raw), invocation.get_sender()))
      .then((result) => {
        invocation.return_value(new GLib.Variant('(s)', [JSON.stringify(result)]));
      })
      .catch((error) => {
        invocation.return_dbus_error(
          'org.jackalope.DesktopControl1.Error',
          String(error.message).slice(0, 1200),
        );
      });
  }
}
