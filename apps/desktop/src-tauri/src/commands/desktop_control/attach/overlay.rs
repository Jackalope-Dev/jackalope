//! The transparent window that carries the agent across the desktop while dragging.
//!
//! It is created once, hidden offscreen and click-through, and reused for every drag.
//! Its page reports when its first transparent frame has painted; until then it stays
//! offscreen, so a drag never shows an unpainted (black) window. It is never shown with
//! `show()`, which on macOS makes a window key and would take focus from the app the
//! person is dragging onto; it only moves on and off the screen.
//!
//! Once the pointer leaves Jackalope the webview no longer sees it reliably, so the drag
//! is driven natively: the cursor is polled for position and the left button for the
//! release, which ends the drag as a drop wherever it happens.

use super::{conversation_id, denied, drag_supported, dropped, summary, target_from, AttachTarget};
use crate::commands::desktop_control::{helper, platform, Window};
use serde::Serialize;
use serde_json::json;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const OVERLAY: &str = "desktop-glob";
/// Frames the window under the pointer while dragging, and the attached window just after.
pub const FRAME: &str = "desktop-glob-frame";
/// Tells the frame page how to draw: `target`, `attached` or `off`.
pub const FRAME_EVENT: &str = "desktop-glob-frame";
/// Room around the framed window for the outline's outer glow, in logical pixels.
const FRAME_MARGIN: f64 = 14.0;
/// How long the frame stays around a window that was just attached.
const ATTACHED_GLOW: Duration = Duration::from_millis(4200);
/// Sent when a drag starts, with the agent to draw.
pub const BEGIN_EVENT: &str = "desktop-glob-begin";
/// Sent with the window under the pointer, or null, whenever it changes.
pub const TARGET_EVENT: &str = "desktop-glob-target";
/// Sent to the overlay when the drag ends: a drop splats, anything else springs home.
pub const FINISH_EVENT: &str = "desktop-glob-finish";
/// Sent to the app when the drag ends, with the window dropped on (if any).
pub const DROPPED_EVENT: &str = "desktop-glob-dropped";
/// Logical size of the overlay: the blob plus its label, nothing more.
const SIZE: (f64, f64) = (232.0, 96.0);
/// Where the blob's centre sits inside the overlay, in logical pixels.
pub const BLOB: (f64, f64) = (44.0, 44.0);
/// The overlay's corner sits this far below and right of the pointer, so the pointer is
/// never over it and the window under the pointer is the one being targeted.
pub const LEAD: f64 = 8.0;
/// Far outside every screen; the overlay waits here between drags.
const OFFSCREEN: (f64, f64) = (-32000.0, -32000.0);
const TICK: Duration = Duration::from_millis(16);
/// Hit-testing asks the helper; every few frames is enough to follow the pointer.
const HIT_EVERY: u32 = 6;
/// How long the drop splat and the spring home play before the overlay leaves.
const SPLAT: Duration = Duration::from_millis(560);
const SPRING_HOME: Duration = Duration::from_millis(420);
/// A page that never reports its first paint is shown anyway after this long, so a
/// broken page shows up as a visible problem instead of an invisible drag.
const READY_FALLBACK: Duration = Duration::from_millis(800);
/// The button must read as released for this many frames in a row to end the drag.
const RELEASE_FRAMES: u32 = 2;

static READY: AtomicBool = AtomicBool::new(false);
static GENERATION: AtomicU64 = AtomicU64::new(0);
static FRAME_READY: AtomicBool = AtomicBool::new(false);
/// Bumped whenever the frame moves, so a delayed hide never hides a newer frame.
static FRAME_GENERATION: AtomicU64 = AtomicU64::new(0);

/// A drag trace in the dev app's terminal; silent in release builds.
pub(crate) fn trace(message: std::fmt::Arguments) {
    if cfg!(debug_assertions) {
        eprintln!("glob: {message}");
    }
}

struct Drag {
    conversation: String,
    home: String,
    stop: Arc<AtomicBool>,
    target: Arc<Mutex<Option<Window>>>,
    poll: Option<JoinHandle<()>>,
}

fn drag_slot() -> &'static Mutex<Option<Drag>> {
    static DRAG: OnceLock<Mutex<Option<Drag>>> = OnceLock::new();
    DRAG.get_or_init(Mutex::default)
}

/// Whether the left mouse button is down right now, from the window server.
#[cfg(target_os = "macos")]
fn left_button_down() -> Option<bool> {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
    }
    // kCGEventSourceStateCombinedSessionState, kCGMouseButtonLeft.
    Some(unsafe { CGEventSourceButtonState(0, 0) })
}

#[cfg(windows)]
fn left_button_down() -> Option<bool> {
    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(key: i32) -> i16;
    }
    // VK_LBUTTON; the high bit means held now.
    Some(unsafe { GetAsyncKeyState(1) } as u16 & 0x8000 != 0)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn left_button_down() -> Option<bool> {
    None
}

/// Positions are in the units each platform places windows in without rounding through
/// another display's scale: logical points from the main display's top-left on macOS,
/// physical pixels elsewhere.
const LOGICAL: bool = cfg!(target_os = "macos");

/// The pointer in placement units. Tauri reports a physical position that on macOS is
/// the logical point scaled by the main display, while it places a window by dividing by
/// that window's own scale; an overlay parked off every screen can disagree, which put it
/// far from the pointer. Undoing the main display's scale keeps it in points.
fn pointer(app: &AppHandle) -> Option<(f64, f64)> {
    let position = app.cursor_position().ok()?;
    if LOGICAL {
        let scale = app
            .primary_monitor()
            .ok()
            .flatten()
            .map(|monitor| monitor.scale_factor())
            .unwrap_or(1.0);
        Some((position.x / scale, position.y / scale))
    } else {
        Some((position.x, position.y))
    }
}

/// How many placement units one logical pixel is for this window.
fn unit(window: &WebviewWindow) -> f64 {
    if LOGICAL {
        1.0
    } else {
        window.scale_factor().unwrap_or(1.0)
    }
}

/// The overlay's top-left corner for a pointer position.
pub fn origin(pointer: (f64, f64), unit: f64) -> (f64, f64) {
    (pointer.0 + LEAD * unit, pointer.1 + LEAD * unit)
}

/// Where the overlay moves on a drop, so the splat lands exactly on the pointer.
pub fn splat_origin(pointer: (f64, f64), unit: f64) -> (f64, f64) {
    (pointer.0 - BLOB.0 * unit, pointer.1 - BLOB.1 * unit)
}

/// The unit direction from the pointer back toward the app window it left.
pub fn home_direction(pointer: (f64, f64), home: Option<(f64, f64)>) -> (f64, f64) {
    let Some(home) = home else {
        return (0.0, -1.0);
    };
    let (dx, dy) = (home.0 - pointer.0, home.1 - pointer.1);
    let length = dx.hypot(dy);
    if length < 1.0 {
        (0.0, -1.0)
    } else {
        (dx / length, dy / length)
    }
}

/// Whether the drag ends on this frame: the button has read as released for enough
/// frames in a row, after having been seen held.
pub fn released(held_seen: bool, released_frames: u32) -> bool {
    held_seen && released_frames >= RELEASE_FRAMES
}

fn place(window: &WebviewWindow, at: (f64, f64)) {
    let _ = if LOGICAL {
        window.set_position(tauri::LogicalPosition::new(at.0, at.1))
    } else {
        window.set_position(tauri::PhysicalPosition::new(at.0, at.1))
    };
}

fn park(window: &WebviewWindow) {
    let _ = window.set_position(tauri::LogicalPosition::new(OFFSCREEN.0, OFFSCREEN.1));
}

/// Builds the overlay once: transparent, shadowless, click-through, unfocusable, out of
/// screen captures, waiting offscreen.
fn ensure(app: &AppHandle) -> Result<WebviewWindow, String> {
    build(app, OVERLAY, "index.html?glob=1", SIZE, &READY)
}

fn ensure_frame(app: &AppHandle) -> Result<WebviewWindow, String> {
    build(
        app,
        FRAME,
        "index.html?globFrame=1",
        (200.0, 200.0),
        &FRAME_READY,
    )
}

fn build(
    app: &AppHandle,
    label: &str,
    url: &str,
    size: (f64, f64),
    ready: &AtomicBool,
) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(label) {
        return Ok(window);
    }
    ready.store(false, Ordering::SeqCst);
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title("Jackalope")
        .inner_size(size.0, size.1)
        .position(OFFSCREEN.0, OFFSCREEN.1)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .content_protected(true)
        .visible_on_all_workspaces(true);
    if let Some(profile) = std::env::var_os("JACKALOPE_PROFILE_DIR") {
        builder = builder.data_directory(std::path::PathBuf::from(profile).join("webview"));
    }
    let window = builder.build().map_err(|e| {
        trace(format_args!("{label} build failed: {e}"));
        e.to_string()
    })?;
    let _ = window.set_ignore_cursor_events(true);
    trace(format_args!("{label} built, waiting for its first paint"));
    Ok(window)
}

/// The frame window's corner and size around a window's bounds, in placement units.
pub fn frame_rect(bounds: super::badge::Rect, unit: f64) -> (f64, f64, f64, f64) {
    let margin = FRAME_MARGIN * unit;
    (
        bounds.x - margin,
        bounds.y - margin,
        bounds.width + margin * 2.0,
        bounds.height + margin * 2.0,
    )
}

/// Frames a window: `target` while dragging over it, `attached` just after attaching.
fn show_frame(app: &AppHandle, bounds: super::badge::Rect, mode: &str) -> u64 {
    let generation = FRAME_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let Some(frame) = app.get_webview_window(FRAME) else {
        return generation;
    };
    if !FRAME_READY.load(Ordering::SeqCst) {
        trace(format_args!(
            "frame not painted yet; skipping the {mode} highlight"
        ));
        return generation;
    }
    let (x, y, width, height) = frame_rect(bounds, unit(&frame));
    let _ = app.emit(FRAME_EVENT, json!({ "mode": mode }));
    if LOGICAL {
        let _ = frame.set_size(tauri::LogicalSize::new(width, height));
    } else {
        let _ = frame.set_size(tauri::PhysicalSize::new(width, height));
    }
    place(&frame, (x, y));
    trace(format_args!(
        "{mode} highlight at x {x:.0} y {y:.0} w {width:.0} h {height:.0}"
    ));
    generation
}

fn hide_frame(app: &AppHandle) {
    FRAME_GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(frame) = app.get_webview_window(FRAME) {
        let _ = app.emit(FRAME_EVENT, json!({ "mode": "off" }));
        park(&frame);
    }
}

/// Glows around a window that was just attached, then fades away, so it's clear where
/// the agent went. Used after attaching and when the person asks where it is.
pub fn flash_attached(app: &AppHandle, window: Window) {
    let app = app.clone();
    std::thread::spawn(move || {
        if ensure_frame(&app).is_err() {
            return;
        }
        let bounds = crate::commands::desktop_control::native(
            json!({"action":"bounds","deny":denied(),"window":window}),
            &AtomicBool::new(false),
        )
        .ok()
        .and_then(|value| super::badge::parse_bounds(&value));
        let Some(bounds) = bounds else {
            trace(format_args!("attached window has no bounds; no highlight"));
            return;
        };
        let generation = show_frame(&app, bounds, "attached");
        std::thread::sleep(ATTACHED_GLOW);
        if FRAME_GENERATION.load(Ordering::SeqCst) == generation {
            hide_frame(&app);
        }
    });
}

/// The centre of the window the drag started from, in placement units.
fn home_center(app: &AppHandle, label: &str) -> Option<(f64, f64)> {
    let window = app.get_webview_window(label)?;
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    let scale = if LOGICAL {
        window.scale_factor().unwrap_or(1.0)
    } else {
        1.0
    };
    Some((
        (position.x as f64 + size.width as f64 / 2.0) / scale,
        (position.y as f64 + size.height as f64 / 2.0) / scale,
    ))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Dropped {
    target: Option<AttachTarget>,
    canceled: bool,
}

/// Ends the drag once, whoever notices first: the native release, the webview's
/// pointer-up, or Escape. The overlay plays its splat or spring home, then waits
/// offscreen; the app hears what was dropped on.
fn finish(app: &AppHandle, drop: bool, why: &str) -> Option<AttachTarget> {
    let mut drag = drag_slot().lock().ok()?.take()?;
    drag.stop.store(true, Ordering::SeqCst);
    let target = drop
        .then(|| drag.target.lock().ok().and_then(|mut slot| slot.take()))
        .flatten();
    let shown = target.as_ref().map(summary);
    if let Some(window) = target {
        if let Ok(mut map) = dropped().lock() {
            map.insert(drag.conversation.clone(), window);
        }
    }
    trace(format_args!(
        "drag ended by {why}: {}",
        match (&shown, drop) {
            (Some(target), _) => format!("dropped on {} \u{2014} {}", target.app, target.title),
            (None, true) => "dropped on nothing attachable".into(),
            (None, false) => "canceled".into(),
        }
    ));
    let _ = app.emit(
        DROPPED_EVENT,
        Dropped {
            target: shown.clone(),
            canceled: !drop,
        },
    );
    hide_frame(app);
    let splat = shown.is_some();
    let generation = GENERATION.load(Ordering::SeqCst);
    let poll = drag.poll.take();
    let app = app.clone();
    std::thread::spawn(move || {
        if let Some(poll) = poll {
            if poll.thread().id() != std::thread::current().id() {
                let _ = poll.join();
            }
        }
        let Some(overlay) = app.get_webview_window(OVERLAY) else {
            return;
        };
        let at = pointer(&app).unwrap_or_default();
        if splat {
            place(&overlay, splat_origin(at, unit(&overlay)));
            let _ = app.emit(FINISH_EVENT, json!({ "kind": "drop" }));
        } else {
            let (dx, dy) = home_direction(at, home_center(&app, &drag.home));
            let _ = app.emit(
                FINISH_EVENT,
                json!({ "kind": "return", "dx": dx, "dy": dy }),
            );
        }
        std::thread::sleep(if splat { SPLAT } else { SPRING_HOME });
        if GENERATION.load(Ordering::SeqCst) == generation {
            park(&overlay);
        }
    });
    shown
}

/// Builds the overlay ahead of a drag, when the person points at the agent, so its first
/// frame has painted by the time it is needed.
#[tauri::command]
pub async fn desktop_glob_prepare(app: AppHandle) -> Result<(), String> {
    if drag_supported() {
        ensure(&app)?;
        ensure_frame(&app)?;
    }
    Ok(())
}

/// The overlay's or a badge's page painted its first transparent frame.
#[tauri::command]
pub fn desktop_overlay_ready(window: WebviewWindow) {
    trace(format_args!("{} painted its first frame", window.label()));
    if window.label() == OVERLAY {
        READY.store(true, Ordering::SeqCst);
    } else if window.label() == FRAME {
        FRAME_READY.store(true, Ordering::SeqCst);
    } else {
        super::badge::ready(window.label());
    }
}

/// A line for the drag trace from the app or overlay pages; dev builds only.
#[tauri::command]
pub fn desktop_glob_log(window: WebviewWindow, message: String) {
    let message: String = message
        .chars()
        .filter(|c| !c.is_control())
        .take(300)
        .collect();
    trace(format_args!("[{}] {message}", window.label()));
}

/// Starts dragging the agent: the overlay follows the pointer and names the window
/// under it. Polling runs only while dragging and stops on release, drop or cancel.
#[tauri::command]
pub async fn desktop_glob_start(
    app: AppHandle,
    window: WebviewWindow,
    conversation: String,
    provider: String,
) -> Result<(), String> {
    let conversation = conversation_id(&conversation)?.to_owned();
    if !drag_supported() {
        return Err("Dragging onto a window isn't available on this desktop. Choose a window from the list instead.".into());
    }
    let launcher = platform::launcher().ok_or("Desktop helper is unavailable.")?;
    if let Some(previous) = drag_slot().lock().map_err(|e| e.to_string())?.take() {
        previous.stop.store(true, Ordering::SeqCst);
    }
    let overlay = ensure(&app)?;
    let _ = ensure_frame(&app);
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let provider: String = provider
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(40)
        .collect();
    trace(format_args!(
        "drag started from {} at {:?} (main display scale {:?}, overlay scale {:?}, painted {})",
        window.label(),
        pointer(&app),
        app.primary_monitor()
            .ok()
            .flatten()
            .map(|m| m.scale_factor()),
        overlay.scale_factor().ok(),
        READY.load(Ordering::SeqCst),
    ));
    let _ = app.emit(BEGIN_EVENT, json!({ "provider": provider }));
    let stop = Arc::new(AtomicBool::new(false));
    let target = Arc::new(Mutex::new(None));
    let (poll_stop, poll_target, poll_app) = (stop.clone(), target.clone(), app.clone());
    let poll = std::thread::spawn(move || {
        let mut helper = helper::Helper::new(launcher);
        let denied = denied();
        let started = Instant::now();
        let mut last: Option<String> = None;
        let mut frame = 0u32;
        let mut shown = false;
        let (mut held_seen, mut released_frames) = (false, 0u32);
        let mut ended_by_release = false;
        while !poll_stop.load(Ordering::SeqCst) && GENERATION.load(Ordering::SeqCst) == generation {
            match left_button_down() {
                Some(true) => {
                    held_seen = true;
                    released_frames = 0;
                }
                Some(false) => released_frames += 1,
                None => {}
            }
            if released(held_seen, released_frames) {
                ended_by_release = true;
                break;
            }
            let painted = READY.load(Ordering::SeqCst);
            if !painted && !shown && started.elapsed() >= READY_FALLBACK {
                trace(format_args!(
                    "overlay never reported its first paint; showing it anyway"
                ));
                READY.store(true, Ordering::SeqCst);
            }
            if let (Some(at), Some(overlay)) =
                (pointer(&poll_app), poll_app.get_webview_window(OVERLAY))
            {
                if READY.load(Ordering::SeqCst) {
                    let corner = origin(at, unit(&overlay));
                    place(&overlay, corner);
                    if !shown {
                        shown = true;
                        trace(format_args!("overlay on screen at {corner:?}"));
                    }
                }
            }
            if frame.is_multiple_of(HIT_EVERY) {
                let reply = helper.call(
                    &json!({"action":"at","deny":denied}),
                    Duration::from_secs(2),
                    &poll_stop,
                );
                if let Err(error) = &reply {
                    if frame == 0 {
                        trace(format_args!("hit test failed: {}", error.message));
                    }
                }
                let value = reply.ok();
                let hit = value.as_ref().and_then(|value| target_from(value, &denied));
                let key = hit.as_ref().map(|window| window.handle.clone());
                if key != last {
                    last = key;
                    match (&hit, value.as_ref().and_then(super::badge::parse_bounds)) {
                        (Some(_), Some(bounds)) => {
                            show_frame(&poll_app, bounds, "target");
                        }
                        _ => hide_frame(&poll_app),
                    }
                    let shown = hit.as_ref().map(summary);
                    trace(format_args!(
                        "over {}",
                        shown
                            .as_ref()
                            .map(|t| format!("{} \u{2014} {}", t.app, t.title))
                            .unwrap_or_else(|| "no attachable window".into())
                    ));
                    if let Ok(mut slot) = poll_target.lock() {
                        *slot = hit;
                    }
                    let _ = poll_app.emit(TARGET_EVENT, &shown);
                }
            }
            frame = frame.wrapping_add(1);
            std::thread::sleep(TICK);
        }
        helper.shutdown();
        if ended_by_release {
            finish(&poll_app, true, "mouse release");
        }
    });
    *drag_slot().lock().map_err(|e| e.to_string())? = Some(Drag {
        conversation,
        home: window.label().to_owned(),
        stop,
        target,
        poll: Some(poll),
    });
    Ok(())
}

/// Ends the drag from the app: Escape cancels; a pointer-up the webview still saw drops.
/// The app learns the outcome from the dropped event either way.
#[tauri::command]
pub fn desktop_glob_end(app: AppHandle, drop: bool) -> Option<AttachTarget> {
    finish(&app, drop, if drop { "the app" } else { "Escape" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_overlay_trails_the_pointer_and_a_drop_centres_the_splat_on_it() {
        assert_eq!(origin((100.0, 200.0), 2.0), (116.0, 216.0));
        assert_eq!(splat_origin((100.0, 200.0), 1.0), (56.0, 156.0));
        let (x, y) = splat_origin((100.0, 200.0), 2.0);
        assert_eq!((x + BLOB.0 * 2.0, y + BLOB.1 * 2.0), (100.0, 200.0));
    }

    #[test]
    fn the_spring_home_points_back_at_the_app_window() {
        let (dx, dy) = home_direction((0.0, 0.0), Some((30.0, 40.0)));
        assert!((dx - 0.6).abs() < 1e-9 && (dy - 0.8).abs() < 1e-9);
        assert_eq!(home_direction((5.0, 5.0), Some((5.0, 5.0))), (0.0, -1.0));
        assert_eq!(home_direction((5.0, 5.0), None), (0.0, -1.0));
    }

    #[test]
    fn the_frame_surrounds_the_window_with_room_for_its_glow() {
        let bounds = super::super::badge::Rect {
            x: 100.0,
            y: 50.0,
            width: 800.0,
            height: 600.0,
        };
        assert_eq!(frame_rect(bounds, 1.0), (86.0, 36.0, 828.0, 628.0));
        assert_eq!(frame_rect(bounds, 2.0), (72.0, 22.0, 856.0, 656.0));
    }

    #[test]
    fn the_drag_ends_only_on_a_release_after_the_button_was_seen_held() {
        assert!(
            !released(false, 10),
            "a button never seen held does not end it"
        );
        assert!(!released(true, 1), "one released frame may be a glitch");
        assert!(released(true, RELEASE_FRAMES));
    }

    #[test]
    fn finishing_without_a_drag_does_nothing() {
        assert!(drag_slot().lock().unwrap().is_none());
    }
}
