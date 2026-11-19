//! Windows the person attaches to a conversation, by dragging its agent onto a window
//! or by picking one from a list. Attaching never grants access by itself: it stages one
//! window, and the conversation's next window-scope `request_access` takes it in place of
//! the access question. The grant then starts like any other, with the indicator, pause on
//! physical input and Escape to cancel. A window attached for reading allows observe
//! actions only.

use super::{grant, Window};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// How long an attached window waits for the agent to ask for it.
const STAGE_TTL: Duration = Duration::from_secs(30 * 60);
/// The overlay that follows the pointer while dragging.
pub const OVERLAY: &str = "desktop-glob";
/// Logical size of the overlay; the blob sits in its top-left corner.
const OVERLAY_SIZE: (f64, f64) = (240.0, 132.0);
/// The overlay sits below and right of the pointer, so the pointer is never over it
/// and the window under the pointer is the one being targeted.
const POINTER_OFFSET: f64 = 14.0;
const FRAME: Duration = Duration::from_millis(16);
/// Hit-testing asks the helper; every few frames is enough to follow the pointer.
const HIT_EVERY: u32 = 7;

/// Apps that draw the desktop, taskbars and system chrome; never targets.
const SYSTEM: &[&str] = &[
    "progman",
    "workerw",
    "shell_traywnd",
    "shell_secondarytraywnd",
    "com.apple.dock",
    "com.apple.windowmanager",
    "com.apple.controlcenter",
    "com.apple.notificationcenterui",
    "com.apple.systemuiserver",
    "com.apple.loginwindow",
];

#[derive(Clone, Debug)]
pub struct Staged {
    pub window: Window,
    /// Whether the person allowed control, or reading only.
    pub control: bool,
    at: Instant,
}

/// A window as the attach UI shows it. The handle identifies it on confirm; identity
/// is checked again natively before anything is staged.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttachTarget {
    pub handle: String,
    pub title: String,
    pub app: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachedWindow {
    pub title: String,
    pub app: String,
    pub control: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachSupport {
    /// Dragging the agent onto a window is available on this desktop.
    pub drag: bool,
    /// Picking from a list of windows is available.
    pub pick: bool,
}

fn summary(window: &Window) -> AttachTarget {
    AttachTarget {
        handle: window.handle.clone(),
        title: window.title.chars().take(120).collect(),
        app: grant::app_label(window),
    }
}

/// Whether a window can be attached: not Jackalope's own, titled, and not system chrome.
pub fn eligible(window: &Window, denied: &[u32]) -> bool {
    !denied.contains(&window.pid)
        && !window.title.trim().is_empty()
        && !window.handle.is_empty()
        && !SYSTEM.contains(&grant::app_key(window).as_str())
        && !SYSTEM.contains(&window.class.to_lowercase().as_str())
}

fn same(a: &Window, b: &Window) -> bool {
    a.handle == b.handle && a.pid == b.pid && a.started == b.started
}

fn staged_map() -> &'static Mutex<HashMap<String, Staged>> {
    static STAGED: OnceLock<Mutex<HashMap<String, Staged>>> = OnceLock::new();
    STAGED.get_or_init(Mutex::default)
}

pub fn stage(conversation: &str, window: Window, control: bool) {
    if let Ok(mut map) = staged_map().lock() {
        map.retain(|_, staged| staged.at.elapsed() < STAGE_TTL);
        map.insert(
            conversation.into(),
            Staged {
                window,
                control,
                at: Instant::now(),
            },
        );
    }
}

pub fn staged(conversation: &str) -> Option<Staged> {
    let mut map = staged_map().lock().ok()?;
    map.retain(|_, staged| staged.at.elapsed() < STAGE_TTL);
    map.get(conversation).cloned()
}

pub fn clear(conversation: &str) {
    if let Ok(mut map) = staged_map().lock() {
        map.remove(conversation);
    }
}

/// Takes the conversation's attached window when it is still open: the same handle,
/// process and process start time among `windows`. A closed or replaced window is
/// dropped, so the agent falls back to the usual access question.
pub fn take_for(conversation: &str, windows: &[Window], denied: &[u32]) -> Option<Staged> {
    let mut map = staged_map().lock().ok()?;
    let staged = map.remove(conversation)?;
    if staged.at.elapsed() >= STAGE_TTL || !eligible(&staged.window, denied) {
        return None;
    }
    let window = windows.iter().find(|window| same(window, &staged.window))?;
    Some(Staged {
        window: window.clone(),
        ..staged
    })
}

/// The prompt record for an attached window: already answered, so the attempt's
/// questions show what the person chose and when.
pub fn answered_prompt(run_id: &str, project: &str, staged: &Staged) -> super::PendingUserPrompt {
    let label = format!(
        "{} \u{2014} {}",
        staged.window.title.chars().take(120).collect::<String>(),
        grant::app_label(&staged.window)
    );
    let what = if staged.control {
        "read, capture, focus, click and type into"
    } else {
        "read and capture"
    };
    let mut prompt = super::PendingUserPrompt::choice(
        run_id,
        "Desktop control",
        format!("You attached a window to this conversation in {project}. The agent may {what} that one window."),
        vec!["Do not allow".into(), label.clone()],
    );
    prompt.status = "answered".into();
    prompt.answer = Some(label);
    prompt.answered_at = Some(chrono::Utc::now().to_rfc3339());
    prompt
}

fn conversation_id(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 100 || value.chars().any(char::is_control) {
        return Err("Open a conversation first.".into());
    }
    Ok(value)
}

fn denied() -> Vec<u32> {
    vec![std::process::id()]
}

fn drag_supported() -> bool {
    cfg!(any(windows, target_os = "macos"))
        && super::platform::supported()
        && !super::platform::portal_selected()
}

/// Every attachable window, from the helper's window list.
fn list() -> Result<Vec<Window>, String> {
    if !super::platform::supported() || super::platform::portal_selected() {
        return Err("This desktop chooses windows through its own sharing dialog. Ask the agent to use desktop control and pick the window there.".into());
    }
    let value = super::native(
        json!({"action":"list","deny":denied()}),
        &AtomicBool::new(false),
    )?;
    let windows: Vec<Window> = serde_json::from_value(value["windows"].clone())
        .map_err(|_| "Invalid window inventory.")?;
    let denied = denied();
    Ok(windows
        .into_iter()
        .filter(|window| eligible(window, &denied))
        .collect())
}

/// Reads the window under the pointer from a helper reply.
fn target_from(value: &Value, denied: &[u32]) -> Option<Window> {
    let window: Window = serde_json::from_value(value.get("window")?.clone()).ok()?;
    eligible(&window, denied).then_some(window)
}

struct Drag {
    conversation: String,
    stop: Arc<AtomicBool>,
    target: Arc<Mutex<Option<Window>>>,
}

fn drag_slot() -> &'static Mutex<Option<Drag>> {
    static DRAG: OnceLock<Mutex<Option<Drag>>> = OnceLock::new();
    DRAG.get_or_init(Mutex::default)
}

/// The target a drop chose, kept until the person confirms or cancels.
fn dropped() -> &'static Mutex<HashMap<String, Window>> {
    static DROPPED: OnceLock<Mutex<HashMap<String, Window>>> = OnceLock::new();
    DROPPED.get_or_init(Mutex::default)
}

/// Stops any drag: the polling thread ends on its next frame and the overlay closes.
fn stop_drag(app: &AppHandle) -> Option<Drag> {
    let drag = drag_slot().lock().ok()?.take();
    if let Some(drag) = &drag {
        drag.stop.store(true, Ordering::SeqCst);
    }
    if let Some(overlay) = app.get_webview_window(OVERLAY) {
        let _ = overlay.close();
    }
    drag
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::desktop_control::attach::desktop_attach_support,
            commands::desktop_control::attach::desktop_attach_windows,
            commands::desktop_control::attach::desktop_attach_confirm,
            commands::desktop_control::attach::desktop_attach_get,
            commands::desktop_control::attach::desktop_attach_clear,
            commands::desktop_control::attach::desktop_glob_start,
            commands::desktop_control::attach::desktop_glob_end,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[tauri::command]
pub fn desktop_attach_support() -> AttachSupport {
    AttachSupport {
        drag: drag_supported(),
        pick: super::platform::supported() && !super::platform::portal_selected(),
    }
}

#[tauri::command]
pub async fn desktop_attach_windows() -> Result<Vec<AttachTarget>, String> {
    let windows = tauri::async_runtime::spawn_blocking(list)
        .await
        .map_err(|e| e.to_string())??;
    Ok(windows.iter().map(summary).collect())
}

/// Stages a window the person chose for the conversation. Called only from the
/// confirm dialog; the window is matched again against the live window list.
#[tauri::command]
pub async fn desktop_attach_confirm(
    conversation: String,
    handle: String,
    control: bool,
) -> Result<AttachedWindow, String> {
    let conversation = conversation_id(&conversation)?.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let windows = list()?;
        let dropped = dropped()
            .lock()
            .ok()
            .and_then(|mut map| map.remove(&conversation));
        let window = match dropped.filter(|window| window.handle == handle) {
            Some(target) => windows.into_iter().find(|window| same(window, &target)),
            None => windows.into_iter().find(|window| window.handle == handle),
        }
        .ok_or("That window closed or changed. Choose it again.")?;
        let attached = AttachedWindow {
            title: window.title.chars().take(120).collect(),
            app: grant::app_label(&window),
            control,
        };
        stage(&conversation, window, control);
        Ok(attached)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn desktop_attach_get(conversation: String) -> Option<AttachedWindow> {
    let staged = staged(conversation_id(&conversation).ok()?)?;
    Some(AttachedWindow {
        title: staged.window.title.chars().take(120).collect(),
        app: grant::app_label(&staged.window),
        control: staged.control,
    })
}

#[tauri::command]
pub fn desktop_attach_clear(conversation: String) {
    if let Ok(conversation) = conversation_id(&conversation) {
        clear(conversation);
        if let Ok(mut map) = dropped().lock() {
            map.remove(conversation);
        }
    }
}

/// Starts dragging the agent: an overlay follows the pointer and names the window
/// under it. Polling runs only while dragging and stops on drop or cancel.
#[tauri::command]
pub fn desktop_glob_start(
    app: AppHandle,
    conversation: String,
    provider: String,
) -> Result<(), String> {
    let conversation = conversation_id(&conversation)?.to_owned();
    if !drag_supported() {
        return Err("Dragging onto a window isn't available on this desktop. Choose a window from the list instead.".into());
    }
    let launcher = super::platform::launcher().ok_or("Desktop helper is unavailable.")?;
    stop_drag(&app);
    let provider: String = provider
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(40)
        .collect();
    let mut builder = WebviewWindowBuilder::new(
        &app,
        OVERLAY,
        WebviewUrl::App(format!("index.html?glob={provider}").into()),
    )
    .title("Jackalope")
    .inner_size(OVERLAY_SIZE.0, OVERLAY_SIZE.1)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .focusable(false)
    .visible_on_all_workspaces(true);
    if let Ok(position) = app.cursor_position() {
        builder = builder.position(position.x, position.y);
    }
    if let Some(profile) = std::env::var_os("JACKALOPE_PROFILE_DIR") {
        builder = builder.data_directory(std::path::PathBuf::from(profile).join("webview"));
    }
    let overlay = builder.build().map_err(|e| e.to_string())?;
    let _ = overlay.set_ignore_cursor_events(true);
    let stop = Arc::new(AtomicBool::new(false));
    let target = Arc::new(Mutex::new(None));
    *drag_slot().lock().map_err(|e| e.to_string())? = Some(Drag {
        conversation,
        stop: stop.clone(),
        target: target.clone(),
    });
    std::thread::spawn(move || {
        let mut helper = super::helper::Helper::new(launcher);
        let denied = denied();
        let mut last: Option<String> = None;
        let mut frame = 0u32;
        while !stop.load(Ordering::SeqCst) {
            if let (Ok(position), Some(overlay)) =
                (app.cursor_position(), app.get_webview_window(OVERLAY))
            {
                let scale = overlay.scale_factor().unwrap_or(1.0);
                let offset = POINTER_OFFSET * scale;
                let _ = overlay.set_position(tauri::PhysicalPosition::new(
                    position.x + offset,
                    position.y + offset,
                ));
            }
            if frame.is_multiple_of(HIT_EVERY) {
                let hit = helper
                    .call(
                        &json!({"action":"at","deny":denied}),
                        Duration::from_secs(2),
                        &stop,
                    )
                    .ok()
                    .and_then(|value| target_from(&value, &denied));
                let key = hit.as_ref().map(|window| window.handle.clone());
                if key != last {
                    last = key;
                    let shown = hit.as_ref().map(summary);
                    if let Ok(mut slot) = target.lock() {
                        *slot = hit;
                    }
                    let _ = app.emit("desktop-glob-target", &shown);
                }
            }
            frame = frame.wrapping_add(1);
            std::thread::sleep(FRAME);
        }
        helper.shutdown();
    });
    Ok(())
}

/// Ends the drag. A drop returns the window under the pointer for the confirm dialog;
/// nothing is attached until the person confirms.
#[tauri::command]
pub fn desktop_glob_end(app: AppHandle, drop: bool) -> Option<AttachTarget> {
    let drag = stop_drag(&app)?;
    if !drop {
        return None;
    }
    let window = drag.target.lock().ok()?.take()?;
    let shown = summary(&window);
    dropped().lock().ok()?.insert(drag.conversation, window);
    Some(shown)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(handle: &str, pid: u32, title: &str, app: &str) -> Window {
        Window {
            handle: handle.into(),
            pid,
            started: "1".into(),
            title: title.into(),
            class: app.into(),
            app: app.into(),
            app_name: app.into(),
        }
    }

    #[test]
    fn own_untitled_and_system_windows_are_never_targets() {
        let own = std::process::id();
        let denied = vec![own];
        assert!(eligible(
            &window("1", 42, "Notes", "com.apple.notes"),
            &denied
        ));
        assert!(!eligible(
            &window("2", own, "Jackalope", "jackalope"),
            &denied
        ));
        assert!(!eligible(
            &window("3", 42, "  ", "com.apple.notes"),
            &denied
        ));
        assert!(!eligible(
            &window("4", 42, "Dock", "com.apple.dock"),
            &denied
        ));
        assert!(!eligible(
            &window("5", 42, "Program Manager", "progman"),
            &denied
        ));
        assert!(!eligible(
            &window("", 42, "Notes", "com.apple.notes"),
            &denied
        ));
        let reply = json!({"window": window("6", own, "Jackalope", "jackalope")});
        assert_eq!(target_from(&reply, &denied), None);
        assert_eq!(target_from(&json!({"window": null}), &denied), None);
        assert_eq!(target_from(&json!({}), &denied), None);
        let reply = json!({"window": window("7", 42, "Report", "excel")});
        assert_eq!(
            target_from(&reply, &denied).map(|w| w.handle),
            Some("7".into())
        );
    }

    #[test]
    fn a_staged_window_is_taken_once_and_only_while_the_same_window_is_open() {
        let notes = window("10", 42, "Notes", "com.apple.notes");
        stage("conversation-a", notes.clone(), false);
        assert!(staged("conversation-a").is_some_and(|s| !s.control));
        let mut reopened = notes.clone();
        reopened.started = "2".into();
        assert!(take_for("conversation-a", &[reopened], &[]).is_none());
        assert!(
            staged("conversation-a").is_none(),
            "a replaced window is dropped"
        );

        stage("conversation-a", notes.clone(), true);
        assert!(take_for("conversation-b", &[notes.clone()], &[]).is_none());
        let taken = take_for("conversation-a", &[notes.clone()], &[]).unwrap();
        assert!(taken.control);
        assert_eq!(taken.window, notes);
        assert!(
            take_for("conversation-a", &[notes], &[]).is_none(),
            "taken once"
        );
    }

    #[test]
    fn clearing_drops_the_attached_window() {
        stage("conversation-c", window("20", 42, "Mail", "mail"), true);
        clear("conversation-c");
        assert!(staged("conversation-c").is_none());
        assert!(conversation_id("").is_err());
        assert!(conversation_id("a\nb").is_err());
    }

    #[test]
    fn the_answered_record_names_the_window_and_what_was_allowed() {
        let staged = Staged {
            window: window("30", 42, "Budget", "excel"),
            control: false,
            at: Instant::now(),
        };
        let prompt = answered_prompt("run-1", "Trail", &staged);
        assert_eq!(prompt.status, "answered");
        assert_eq!(prompt.run_id, "run-1");
        assert!(prompt.question.contains("read and capture"));
        assert!(!prompt.question.contains("click"));
        assert_eq!(prompt.answer.as_deref(), Some("Budget \u{2014} excel"));
    }
}
