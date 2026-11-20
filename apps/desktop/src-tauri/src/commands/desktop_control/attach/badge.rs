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
pub const COLLAPSED: (f64, f64) = (340.0, 56.0);
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
    /// The thin outline that stays around the attached window.
    edge: String,
    stop: Arc<AtomicBool>,
    ready: Arc<AtomicBool>,
    edge_ready: Arc<AtomicBool>,
    expanded: Arc<AtomicBool>,
}

/// Room around the attached window for its edge and soft glow, in logical pixels.
const EDGE_MARGIN: f64 = 6.0;

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

/// The edge window's corner and size around a window's bounds, in the bounds' units.
pub fn edge_rect(bounds: Rect, scale: f64, logical: bool) -> (f64, f64, f64, f64) {
    let margin = EDGE_MARGIN * if logical { 1.0 } else { scale };
    (
        bounds.x - margin,
        bounds.y - margin,
        bounds.width + margin * 2.0,
        bounds.height + margin * 2.0,
    )
}

fn resize(window: &WebviewWindow, size: (f64, f64)) {
    let _ = if LOGICAL_BOUNDS {
        window.set_size(tauri::LogicalSize::new(size.0, size.1))
    } else {
        window.set_size(tauri::PhysicalSize::new(size.0, size.1))
    };
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
    let number = NEXT.fetch_add(1, Ordering::SeqCst);
    let label = format!("{PREFIX}{number}");
    let edge = format!("{PREFIX}edge-{number}");
    let control = by_id(id).is_some_and(|(_, staged)| staged.control);
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
                edge: edge.clone(),
                stop: Arc::new(AtomicBool::new(false)),
                ready: Arc::new(AtomicBool::new(false)),
                edge_ready: Arc::new(AtomicBool::new(false)),
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
    // A thin outline around the attached window, click-through and out of captures.
    let mut outline = WebviewWindowBuilder::new(
        app,
        &edge,
        WebviewUrl::App(
            format!(
                "index.html?attachEdge={}",
                if control { "control" } else { "see" }
            )
            .into(),
        ),
    )
    .title("Jackalope")
    .inner_size(200.0, 200.0)
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
        outline = outline.data_directory(std::path::PathBuf::from(profile).join("webview"));
    }
    match outline.build() {
        Ok(window) => {
            let _ = window.set_ignore_cursor_events(true);
        }
        Err(error) => super::overlay::trace(format_args!("attached edge failed: {error}")),
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
                badge.edge_ready.clone(),
            ),
            app.clone(),
            id.to_owned(),
        )
    };
    std::thread::spawn(move || follow(app, id, (label, edge), state, launcher));
}

/// Keeps the badge on its window until the window stops waiting.
fn follow(
    app: AppHandle,
    id: String,
    (label, edge): (String, String),
    (stop, ready, expanded, edge_ready): (
        Arc<AtomicBool>,
        Arc<AtomicBool>,
        Arc<AtomicBool>,
        Arc<AtomicBool>,
    ),
    launcher: helper::Launcher,
) {
    let mut helper = helper::Helper::new(launcher);
    let mut last: Option<(i64, i64)> = None;
    let mut last_edge: Option<(i64, i64, i64, i64)> = None;
    while !stop.load(Ordering::SeqCst) {
        let Some((_, staged)) = by_id(&id) else {
            break;
        };
        let Some(window) = app.get_webview_window(&label) else {
            break;
        };
        let outline = app.get_webview_window(&edge);
        if ready.load(Ordering::SeqCst) || edge_ready.load(Ordering::SeqCst) {
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
            if ready.load(Ordering::SeqCst) && key != last {
                last = key;
                match at {
                    Some(at) => place(&window, at),
                    None => park(&window),
                }
            }
            if let (Some(outline), true) = (&outline, edge_ready.load(Ordering::SeqCst)) {
                let rect = bounds.map(|bounds| {
                    edge_rect(
                        bounds,
                        outline.scale_factor().unwrap_or(1.0),
                        LOGICAL_BOUNDS,
                    )
                });
                let key = rect.map(|(x, y, w, h)| {
                    (
                        x.round() as i64,
                        y.round() as i64,
                        w.round() as i64,
                        h.round() as i64,
                    )
                });
                if key != last_edge {
                    if last_edge.is_none() {
                        if let Some((x, y, w, h)) = rect {
                            super::overlay::trace(format_args!(
                                "attached edge at x {x:.0} y {y:.0} w {w:.0} h {h:.0}"
                            ));
                        }
                    }
                    last_edge = key;
                    match rect {
                        Some((x, y, width, height)) => {
                            resize(outline, (width, height));
                            place(outline, (x, y));
                        }
                        None => park(outline),
                    }
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
    for label in [&badge.label, &badge.edge] {
        if let Some(window) = APP.get().and_then(|app| app.get_webview_window(label)) {
            let _ = window.close();
        }
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
        if let Some(badge) = map.values().find(|badge| badge.edge == label) {
            badge.edge_ready.store(true, Ordering::SeqCst);
        }
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
    /// Control was paused when the agent's turn ended; Resume picks it back up.
    pub resumable: bool,
    /// The conversation's agent is working right now.
    pub running: bool,
}

/// Whether the conversation behind `key` has an attempt running now.
fn running(runtime: &crate::commands::tasks::TaskRuntime, key: &str) -> bool {
    runtime.integration_runs().is_ok_and(|runs| {
        runs.iter()
            .any(|run| run.live_session_id.as_deref() == Some(key) && run.status.is_active())
    })
}

/// The note sent on the person's behalf when they click Resume on the badge.
pub fn resume_note(title: &str) -> String {
    format!("Resumed desktop control on \u{201c}{title}\u{201d}. Continue.")
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resumed {
    /// A note went into the conversation to wake its agent.
    pub sent: bool,
    pub running: bool,
}

/// The badge's Resume: the next grant on this window starts already resumed, and an idle
/// conversation gets one automatic note so its agent continues. Sent once per resume,
/// never while the agent is working; grants nothing by itself.
#[tauri::command]
pub fn desktop_badge_resume(
    window: WebviewWindow,
    runtime: tauri::State<'_, crate::commands::tasks::TaskRuntime>,
    sessions: tauri::State<'_, crate::commands::live_sessions::LiveSessions>,
) -> Result<Resumed, String> {
    let (id, _, _) = staged_for(&window)?;
    let (key, title, first) =
        super::mark_resumed(&id).ok_or("This window is no longer attached.")?;
    let running = running(runtime.inner(), &key);
    let sent = first && !running && !key.starts_with(DRAFT);
    if sent {
        sessions.post(
            &key,
            &resume_note(&title),
            crate::commands::live_sessions::MessageOrigin {
                kind: "wake".into(),
                label: "Desktop control resumed".into(),
                bot_id: None,
                bot_name: None,
                session_id: None,
            },
        )?;
    }
    super::overlay::trace(format_args!(
        "badge Resume on {title}: {}",
        if sent {
            "woke the conversation"
        } else if running {
            "agent already working"
        } else {
            "already resumed"
        }
    ));
    Ok(Resumed { sent, running })
}

#[tauri::command]
pub fn desktop_badge_state(
    window: WebviewWindow,
    runtime: tauri::State<'_, crate::commands::tasks::TaskRuntime>,
) -> Result<BadgeState, String> {
    let (_, key, staged) = staged_for(&window)?;
    let attached = super::AttachedWindow::of(&staged);
    Ok(BadgeState {
        resumable: staged.resume_offered && !staged.resumed,
        running: running(runtime.inner(), &key),
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
        assert_eq!(position(bounds, COLLAPSED, 2.0, true), (330.0, 56.0));
        assert_eq!(position(bounds, COLLAPSED, 2.0, false), (160.0, 62.0));
    }

    #[test]
    fn the_edge_hugs_the_window_with_a_little_room_for_its_glow() {
        let bounds = Rect {
            x: 100.0,
            y: 50.0,
            width: 800.0,
            height: 600.0,
        };
        assert_eq!(edge_rect(bounds, 2.0, true), (94.0, 44.0, 812.0, 612.0));
        assert_eq!(edge_rect(bounds, 2.0, false), (88.0, 38.0, 824.0, 624.0));
    }

    #[test]
    fn the_resume_note_names_the_window() {
        assert_eq!(
            resume_note("GitHub"),
            "Resumed desktop control on \u{201c}GitHub\u{201d}. Continue."
        );
    }

    #[test]
    fn closing_an_unknown_badge_is_harmless() {
        close("no-such-badge");
        ready("desktop-attach-none");
    }
}
