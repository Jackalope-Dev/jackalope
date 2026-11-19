//! The transparent window that carries the agent across the desktop while dragging.
//!
//! It is created once, hidden offscreen and click-through, and reused for every drag.
//! Its page reports when its first transparent frame has painted; until then it stays
//! offscreen, so a drag never shows an unpainted (black) window. It is never shown with
//! `show()`, which on macOS makes a window key and would take focus from the app the
//! person is dragging onto; it only moves on and off the screen.

use super::{conversation_id, denied, drag_supported, dropped, summary, target_from, AttachTarget};
use crate::commands::desktop_control::{helper, platform, Window};
use serde_json::json;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread::JoinHandle,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const OVERLAY: &str = "desktop-glob";
/// Sent when a drag starts, with the agent to draw.
pub const BEGIN_EVENT: &str = "desktop-glob-begin";
/// Sent with the window under the pointer, or null, whenever it changes.
pub const TARGET_EVENT: &str = "desktop-glob-target";
/// Sent when the drag ends: a drop splats onto the window, anything else springs home.
pub const FINISH_EVENT: &str = "desktop-glob-finish";
/// Logical size of the overlay: the blob plus its label, nothing more.
const SIZE: (f64, f64) = (232.0, 96.0);
/// Where the blob's centre sits inside the overlay, in logical pixels.
pub const BLOB: (f64, f64) = (44.0, 44.0);
/// The overlay's corner sits this far below and right of the pointer, so the pointer is
/// never over it and the window under the pointer is the one being targeted.
pub const LEAD: f64 = 8.0;
/// Far outside every screen; the overlay waits here between drags.
const OFFSCREEN: (f64, f64) = (-32000.0, -32000.0);
const FRAME: Duration = Duration::from_millis(16);
/// Hit-testing asks the helper; every few frames is enough to follow the pointer.
const HIT_EVERY: u32 = 6;
/// How long the drop splat and the spring home play before the overlay leaves.
const SPLAT: Duration = Duration::from_millis(560);
const SPRING_HOME: Duration = Duration::from_millis(420);

static READY: AtomicBool = AtomicBool::new(false);
static GENERATION: AtomicU64 = AtomicU64::new(0);

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

/// The overlay's physical top-left corner for a pointer position.
pub fn origin(pointer: (f64, f64), scale: f64) -> (f64, f64) {
    (pointer.0 + LEAD * scale, pointer.1 + LEAD * scale)
}

/// Where the overlay moves on a drop, so the splat lands exactly on the pointer.
pub fn splat_origin(pointer: (f64, f64), scale: f64) -> (f64, f64) {
    (pointer.0 - BLOB.0 * scale, pointer.1 - BLOB.1 * scale)
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

fn place(window: &WebviewWindow, at: (f64, f64)) {
    let _ = window.set_position(tauri::PhysicalPosition::new(at.0, at.1));
}

fn park(window: &WebviewWindow) {
    let _ = window.set_position(tauri::LogicalPosition::new(OFFSCREEN.0, OFFSCREEN.1));
}

/// Builds the overlay once: transparent, shadowless, click-through, unfocusable, out of
/// screen captures, waiting offscreen.
fn ensure(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(OVERLAY) {
        return Ok(window);
    }
    READY.store(false, Ordering::SeqCst);
    let mut builder =
        WebviewWindowBuilder::new(app, OVERLAY, WebviewUrl::App("index.html?glob=1".into()))
            .title("Jackalope")
            .inner_size(SIZE.0, SIZE.1)
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
    let window = builder.build().map_err(|e| e.to_string())?;
    let _ = window.set_ignore_cursor_events(true);
    Ok(window)
}

fn home_center(app: &AppHandle, label: &str) -> Option<(f64, f64)> {
    let window = app.get_webview_window(label)?;
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some((
        position.x as f64 + size.width as f64 / 2.0,
        position.y as f64 + size.height as f64 / 2.0,
    ))
}

/// Builds the overlay ahead of a drag, when the person points at the agent, so its first
/// frame has painted by the time it is needed.
#[tauri::command]
pub async fn desktop_glob_prepare(app: AppHandle) -> Result<(), String> {
    if drag_supported() {
        ensure(&app)?;
    }
    Ok(())
}

/// The overlay's or a badge's page painted its first transparent frame.
#[tauri::command]
pub fn desktop_overlay_ready(window: WebviewWindow) {
    if window.label() == OVERLAY {
        READY.store(true, Ordering::SeqCst);
    } else {
        super::badge::ready(window.label());
    }
}

/// Starts dragging the agent: the overlay follows the pointer and names the window
/// under it. Polling runs only while dragging and stops on drop or cancel.
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
    ensure(&app)?;
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let provider: String = provider
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(40)
        .collect();
    let _ = app.emit(BEGIN_EVENT, json!({ "provider": provider }));
    let stop = Arc::new(AtomicBool::new(false));
    let target = Arc::new(Mutex::new(None));
    let (poll_stop, poll_target, poll_app) = (stop.clone(), target.clone(), app.clone());
    let poll = std::thread::spawn(move || {
        let mut helper = helper::Helper::new(launcher);
        let denied = denied();
        let mut last: Option<String> = None;
        let mut frame = 0u32;
        while !poll_stop.load(Ordering::SeqCst) && GENERATION.load(Ordering::SeqCst) == generation {
            if let (Ok(pointer), Some(overlay)) = (
                poll_app.cursor_position(),
                poll_app.get_webview_window(OVERLAY),
            ) {
                if READY.load(Ordering::SeqCst) {
                    let scale = overlay.scale_factor().unwrap_or(1.0);
                    place(&overlay, origin((pointer.x, pointer.y), scale));
                }
            }
            if frame.is_multiple_of(HIT_EVERY) {
                let hit = helper
                    .call(
                        &json!({"action":"at","deny":denied}),
                        Duration::from_secs(2),
                        &poll_stop,
                    )
                    .ok()
                    .and_then(|value| target_from(&value, &denied));
                let key = hit.as_ref().map(|window| window.handle.clone());
                if key != last {
                    last = key;
                    let shown = hit.as_ref().map(summary);
                    if let Ok(mut slot) = poll_target.lock() {
                        *slot = hit;
                    }
                    let _ = poll_app.emit(TARGET_EVENT, &shown);
                }
            }
            frame = frame.wrapping_add(1);
            std::thread::sleep(FRAME);
        }
        helper.shutdown();
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

/// Ends the drag. A drop returns the window under the pointer for the confirm dialog;
/// nothing is attached until the person confirms. The overlay plays its splat or its
/// spring home, then waits offscreen for the next drag.
#[tauri::command]
pub fn desktop_glob_end(app: AppHandle, drop: bool) -> Option<AttachTarget> {
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
    let splat = shown.is_some();
    let generation = GENERATION.load(Ordering::SeqCst);
    let poll = drag.poll.take();
    std::thread::spawn(move || {
        if let Some(poll) = poll {
            let _ = poll.join();
        }
        let Some(overlay) = app.get_webview_window(OVERLAY) else {
            return;
        };
        let pointer = app
            .cursor_position()
            .map(|p| (p.x, p.y))
            .unwrap_or_default();
        let scale = overlay.scale_factor().unwrap_or(1.0);
        if splat {
            place(&overlay, splat_origin(pointer, scale));
            let _ = app.emit(FINISH_EVENT, json!({ "kind": "drop" }));
        } else {
            let (dx, dy) = home_direction(pointer, home_center(&app, &drag.home));
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
}
