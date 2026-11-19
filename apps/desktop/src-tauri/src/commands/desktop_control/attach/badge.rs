//! The badge an attached window wears while it waits for the agent: the agent "globbed"
//! onto the window's top edge, saying whether it may see or control it, with a small
//! box for asking about the window. The badge grants nothing. It follows the window
//! while it waits, using the helper's window bounds, and closes when the person
//! detaches, the wait expires or the agent takes the window, so the grant's own bar and
//! frame are then the only indicator. Like the drag overlay, it is built offscreen and
//! moves onscreen only after its first transparent frame has painted, and it is kept out
//! of screen captures.

use super::{by_id, clear_id, Staged, DRAFT};
use crate::commands::desktop_control::{helper, platform};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const PREFIX: &str = "desktop-attach-";
/// Asks the badge with this label to bounce.
pub const PULSE_EVENT: &str = "desktop-badge-pulse";
/// Logical sizes: the collapsed badge, and the badge with its question box open.
pub const COLLAPSED: (f64, f64) = (264.0, 56.0);
pub const EXPANDED: (f64, f64) = (340.0, 184.0);
/// The badge hangs this far inside the window's top edge.
const INSET: f64 = 6.0;
const POLL: Duration = Duration::from_millis(350);
const OFFSCREEN: (f64, f64) = (-32000.0, -32000.0);
/// Helper bounds are in points from the main display's top-left on macOS, which is what
/// Tauri's logical positions use; Windows helpers are per-monitor DPI aware and report
/// physical pixels.
const LOGICAL_BOUNDS: bool = cfg!(target_os = "macos");

struct Badge {
    label: String,
    stop: Arc<AtomicBool>,
    ready: Arc<AtomicBool>,
    expanded: Arc<AtomicBool>,
}

fn badges() -> &'static Mutex<HashMap<String, Badge>> {
    static BADGES: OnceLock<Mutex<HashMap<String, Badge>>> = OnceLock::new();
    BADGES.get_or_init(Mutex::default)
}

static APP: OnceLock<AppHandle> = OnceLock::new();
static NEXT: AtomicU64 = AtomicU64::new(0);

pub fn supported() -> bool {
    cfg!(any(windows, target_os = "macos")) && platform::supported() && !platform::portal_selected()
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Reads `bounds` from a helper reply: `[x, y, width, height]` on Windows, an object on
/// macOS. A closed, hidden or minimized window has none.
pub fn parse_bounds(value: &Value) -> Option<Rect> {
    let bounds = value.get("bounds")?;
    let rect = if let Some(list) = bounds.as_array() {
        let n = |i: usize| list.get(i).and_then(Value::as_f64);
        Rect {
            x: n(0)?,
            y: n(1)?,
            width: n(2)?,
            height: n(3)?,
        }
    } else {
        let n = |key: &str| bounds.get(key).and_then(Value::as_f64);
        Rect {
            x: n("x")?,
            y: n("y")?,
            width: n("width")?,
            height: n("height")?,
        }
    };
    (rect.width > 0.0 && rect.height > 0.0).then_some(rect)
}

/// Where the badge sits: centred on the window's top edge, just inside it. Returns the
/// position in the same units as the bounds.
pub fn position(bounds: Rect, size: (f64, f64), scale: f64, logical: bool) -> (f64, f64) {
    let unit = if logical { 1.0 } else { scale };
    (
        bounds.x + bounds.width / 2.0 - size.0 * unit / 2.0,
        bounds.y + INSET * unit,
    )
}

fn place(window: &WebviewWindow, at: (f64, f64)) {
    let _ = if LOGICAL_BOUNDS {
        window.set_position(tauri::LogicalPosition::new(at.0, at.1))
    } else {
        window.set_position(tauri::PhysicalPosition::new(at.0, at.1))
    };
}

fn park(window: &WebviewWindow) {
    let _ = window.set_position(tauri::LogicalPosition::new(OFFSCREEN.0, OFFSCREEN.1));
}

/// Opens the badge for a staged window, unless it already has one.
pub fn open(app: &AppHandle, id: &str) {
    let _ = APP.set(app.clone());
    let Some(launcher) = platform::launcher() else {
        return;
    };
    let label = format!("{PREFIX}{}", NEXT.fetch_add(1, Ordering::SeqCst));
    {
        let Ok(mut map) = badges().lock() else {
            return;
        };
        if map.contains_key(id) {
            return;
        }
        map.insert(
            id.into(),
            Badge {
                label: label.clone(),
                stop: Arc::new(AtomicBool::new(false)),
                ready: Arc::new(AtomicBool::new(false)),
                expanded: Arc::new(AtomicBool::new(false)),
            },
        );
    }
    let mut builder = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::App(format!("index.html?attachBadge={label}").into()),
    )
    .title("Jackalope")
    .inner_size(COLLAPSED.0, COLLAPSED.1)
    .position(OFFSCREEN.0, OFFSCREEN.1)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .content_protected(true)
    .visible_on_all_workspaces(true);
    if let Some(profile) = std::env::var_os("JACKALOPE_PROFILE_DIR") {
        builder = builder.data_directory(std::path::PathBuf::from(profile).join("webview"));
    }
    if builder.build().is_err() {
        close(id);
        return;
    }
    let (state, app, id) = {
        let map = badges().lock().ok();
        let Some(badge) = map.as_ref().and_then(|map| map.get(id)) else {
            return;
        };
        (
            (
                badge.stop.clone(),
                badge.ready.clone(),
                badge.expanded.clone(),
            ),
            app.clone(),
            id.to_owned(),
        )
    };
    std::thread::spawn(move || follow(app, id, label, state, launcher));
}

/// Keeps the badge on its window until the window stops waiting.
fn follow(
    app: AppHandle,
    id: String,
    label: String,
    (stop, ready, expanded): (Arc<AtomicBool>, Arc<AtomicBool>, Arc<AtomicBool>),
    launcher: helper::Launcher,
) {
    let mut helper = helper::Helper::new(launcher);
    let mut last: Option<(i64, i64)> = None;
    while !stop.load(Ordering::SeqCst) {
        let Some((_, staged)) = by_id(&id) else {
            break;
        };
        let Some(window) = app.get_webview_window(&label) else {
            break;
        };
        if ready.load(Ordering::SeqCst) {
            let bounds = helper
                .call(
                    &json!({"action":"bounds","window":staged.window}),
                    Duration::from_secs(2),
                    &stop,
                )
                .ok()
                .and_then(|value| parse_bounds(&value));
            let size = if expanded.load(Ordering::SeqCst) {
                EXPANDED
            } else {
                COLLAPSED
            };
            let at = bounds.map(|bounds| {
                position(
                    bounds,
                    size,
                    window.scale_factor().unwrap_or(1.0),
                    LOGICAL_BOUNDS,
                )
            });
            let key = at.map(|(x, y)| (x.round() as i64, y.round() as i64));
            if key != last {
                last = key;
                match at {
                    Some(at) => place(&window, at),
                    None => park(&window),
                }
            }
        }
        std::thread::sleep(POLL);
    }
    helper.shutdown();
    close(&id);
}

/// Closes a staged window's badge. Safe to call while the staging lock is held: it only
/// takes the badge lock.
pub fn close(id: &str) {
    let badge = badges().lock().ok().and_then(|mut map| map.remove(id));
    let Some(badge) = badge else {
        return;
    };
    badge.stop.store(true, Ordering::SeqCst);
    if let Some(window) = APP
        .get()
        .and_then(|app| app.get_webview_window(&badge.label))
    {
        let _ = window.close();
    }
}

/// Asks a staged window's badge to bounce, so the person can find it.
pub fn pulse(app: &AppHandle, id: &str) {
    let label = badges()
        .lock()
        .ok()
        .and_then(|map| map.get(id).map(|badge| badge.label.clone()));
    if let Some(label) = label {
        let _ = app.emit(PULSE_EVENT, label);
    }
}

pub fn ready(label: &str) {
    if let Ok(map) = badges().lock() {
        if let Some(badge) = map.values().find(|badge| badge.label == label) {
            badge.ready.store(true, Ordering::SeqCst);
        }
    }
}

/// The staged window behind a badge window, by the calling window's label.
fn staged_for(window: &WebviewWindow) -> Result<(String, String, Staged), String> {
    let label = window.label();
    if !label.starts_with(PREFIX) {
        return Err("This isn't an attached window's badge.".into());
    }
    let id = badges()
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .find(|(_, badge)| badge.label == label)
        .map(|(id, _)| id.clone())
        .ok_or("This window is no longer attached.")?;
    let (key, staged) = by_id(&id).ok_or("This window is no longer attached.")?;
    Ok((id, key, staged))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BadgeState {
    /// The conversation it waits for, or a `draft:` key before one exists.
    pub key: String,
    pub draft: bool,
    pub title: String,
    pub app: String,
    pub agent: String,
    pub provider: String,
    pub control: bool,
    pub minutes_left: u64,
}

#[tauri::command]
pub fn desktop_badge_state(window: WebviewWindow) -> Result<BadgeState, String> {
    let (_, key, staged) = staged_for(&window)?;
    let attached = super::AttachedWindow::of(&staged);
    Ok(BadgeState {
        draft: key.starts_with(DRAFT),
        key,
        title: attached.title,
        app: attached.app,
        agent: staged.agent,
        provider: staged.provider,
        control: staged.control,
        minutes_left: attached.minutes_left,
    })
}

/// Opens or closes the badge's question box, growing from the top centre.
#[tauri::command]
pub fn desktop_badge_resize(window: WebviewWindow, expanded: bool) -> Result<(), String> {
    let (id, _, _) = staged_for(&window)?;
    let was = badges()
        .lock()
        .map_err(|e| e.to_string())?
        .get(&id)
        .map(|badge| badge.expanded.swap(expanded, Ordering::SeqCst))
        .unwrap_or(expanded);
    if was == expanded {
        return Ok(());
    }
    let (from, to) = if expanded {
        (COLLAPSED, EXPANDED)
    } else {
        (EXPANDED, COLLAPSED)
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    if let Ok(position) = window.outer_position() {
        let shift = (to.0 - from.0) * scale / 2.0;
        let _ = window.set_position(tauri::PhysicalPosition::new(
            position.x as f64 - shift,
            position.y as f64,
        ));
    }
    window
        .set_size(tauri::LogicalSize::new(to.0, to.1))
        .map_err(|e| e.to_string())
}

/// Detaches the window from its badge.
#[tauri::command]
pub fn desktop_badge_detach(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let (id, _, _) = staged_for(&window)?;
    if let Some(key) = clear_id(&id) {
        super::announce(&app, &key);
    }
    Ok(())
}

/// Brings Jackalope forward on the conversation, or on the draft that will start it.
#[tauri::command]
pub fn desktop_badge_open(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let (_, key, _) = staged_for(&window)?;
    let main = app
        .get_webview_window("main")
        .ok_or("The main window is unavailable")?;
    let _ = main.unminimize();
    main.show().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())?;
    if let Some(project) = key.strip_prefix(DRAFT) {
        main.emit("desktop-attach-open-draft", project)
            .map_err(|e| e.to_string())
    } else {
        main.emit("live-session-open", &key)
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_read_from_either_helper_shape_and_hidden_windows_have_none() {
        let windows = json!({"bounds": [100, 50, 800, 600]});
        let mac = json!({"bounds": {"x": 100.0, "y": 50.0, "width": 800.0, "height": 600.0}});
        let expected = Rect {
            x: 100.0,
            y: 50.0,
            width: 800.0,
            height: 600.0,
        };
        assert_eq!(parse_bounds(&windows), Some(expected));
        assert_eq!(parse_bounds(&mac), Some(expected));
        assert_eq!(parse_bounds(&json!({"bounds": null})), None);
        assert_eq!(parse_bounds(&json!({"bounds": [0, 0, 0, 10]})), None);
        assert_eq!(parse_bounds(&json!({})), None);
    }

    #[test]
    fn the_badge_centres_on_the_top_edge_in_the_helpers_units() {
        let bounds = Rect {
            x: 100.0,
            y: 50.0,
            width: 800.0,
            height: 600.0,
        };
        assert_eq!(position(bounds, COLLAPSED, 2.0, true), (368.0, 56.0));
        assert_eq!(position(bounds, COLLAPSED, 2.0, false), (236.0, 62.0));
    }

    #[test]
    fn closing_an_unknown_badge_is_harmless() {
        close("no-such-badge");
        ready("desktop-attach-none");
    }
}
