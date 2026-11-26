//! Windows the person attaches to a conversation, by dragging its agent onto a window
//! or by picking one from a list. Attaching never grants access by itself: it stages one
//! window, and the conversation's next window-scope `request_access` takes it in place of
//! the access question. The grant then starts like any other, with the indicator, pause on
//! physical input and Escape to cancel. A window attached for reading allows observe
//! actions only.
//!
//! The new-work composer has no conversation yet, so it stages under a `draft:` key and
//! hands the window to the conversation's id when Send creates it. Draft keys never match
//! a run, so a draft window reaches an agent only through that hand-off.
//!
//! While a window waits, a badge rides on its top edge ([`badge`]); it closes when the
//! agent takes the window, so it never stacks on the grant's own bar and frame.

pub mod badge;
pub mod overlay;

use super::{grant, Window};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{atomic::AtomicBool, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

/// How long an attached window waits for the agent to ask for it.
pub(crate) const STAGE_TTL: Duration = Duration::from_secs(30 * 60);
/// Keys for windows attached in the new-work composer before a conversation exists.
pub const DRAFT: &str = "draft:";
/// Tells app windows an attachment changed outside them (detached from its badge).
pub const CHANGED_EVENT: &str = "desktop-attach-changed";

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
    /// Stays the same across the draft hand-off, so the window's badge follows it.
    pub id: String,
    pub window: Window,
    /// Whether the person allowed control, or reading only.
    pub control: bool,
    /// The agent's display name and character, for the badge.
    pub agent: String,
    pub provider: String,
    /// Left behind by an attempt that ended while its grant waited for Resume; the badge
    /// offers Resume, which wakes the conversation.
    pub resume_offered: bool,
    /// The person clicked Resume on the badge, so the next grant starts already resumed.
    pub resumed: bool,
    /// Already used by a turn of its conversation: it stays attached for later turns until
    /// the person detaches it or the window closes, instead of expiring.
    pub kept: bool,
    /// The site the attach dialog named for a browser window.
    pub site: AttachSite,
    at: Instant,
}

/// The website the person allowed by attaching a browser window. Attaching was their
/// answer to the site question for it, for each turn the window stays attached.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum AttachSite {
    /// Not a browser, or a window staged without the attach dialog.
    #[default]
    None,
    Host(String),
    /// A browser whose address could not be read; the first site the grant sees in the
    /// same window counts as the one the person attached.
    Unread,
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
    /// Minutes left before the window stops waiting for the agent.
    pub minutes_left: u64,
    /// Attached for the rest of the conversation, so it never stops waiting.
    pub kept: bool,
}

impl AttachedWindow {
    fn of(staged: &Staged) -> Self {
        Self {
            title: staged.window.title.chars().take(120).collect(),
            app: grant::app_label(&staged.window),
            control: staged.control,
            minutes_left: STAGE_TTL
                .saturating_sub(staged.at.elapsed())
                .as_secs()
                .div_ceil(60),
            kept: staged.kept,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachSupport {
    /// Dragging the agent onto a window is available on this desktop.
    pub drag: bool,
    /// Picking from a list of windows is available.
    pub pick: bool,
    /// A badge can ride on the attached window.
    pub badge: bool,
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

/// Drops expired entries and closes their badges.
fn expire(map: &mut HashMap<String, Staged>) {
    map.retain(|_, staged| {
        let live = staged.kept || staged.at.elapsed() < STAGE_TTL;
        if !live {
            badge::close(&staged.id);
        }
        live
    });
}

/// Stages a window and returns its id. Replaces any window the key had.
pub fn stage(conversation: &str, window: Window, control: bool, agent: &str) -> String {
    insert(conversation, window, control, agent, Instant::now())
}

/// Sets the character the badge draws for a staged window.
fn set_provider(conversation: &str, provider: &str) {
    if let Ok(mut map) = staged_map().lock() {
        if let Some(staged) = map.get_mut(conversation) {
            staged.provider = provider
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
                .take(40)
                .collect();
        }
    }
}

fn set_site(conversation: &str, site: AttachSite) {
    if let Ok(mut map) = staged_map().lock() {
        if let Some(staged) = map.get_mut(conversation) {
            staged.site = site;
        }
    }
}

/// The host open in a browser window, read from its address only. `None` for other apps
/// and when the address can't be read.
fn read_site(window: &Window) -> Option<String> {
    if !grant::is_browser(&grant::app_key(window)) {
        return None;
    }
    let value = super::native(
        json!({"action":"site","window":window,"deny":denied()}),
        &AtomicBool::new(false),
    )
    .ok()?;
    value["site"]["url"].as_str().and_then(grant::site_host)
}

/// What attaching `window` allows: the host the dialog showed, else the one open now.
fn attach_site(window: &Window, shown: Option<&str>) -> AttachSite {
    if !grant::is_browser(&grant::app_key(window)) {
        return AttachSite::None;
    }
    match shown.and_then(grant::site_host) {
        Some(host) => AttachSite::Host(host),
        None => read_site(window).map_or(AttachSite::Unread, AttachSite::Host),
    }
}

/// The dropped or listed window with this handle, matched against the live window list.
fn chosen(conversation: &str, handle: &str, take: bool) -> Result<Window, String> {
    let windows = list()?;
    let dropped = dropped().lock().ok().and_then(|mut map| {
        if take {
            map.remove(conversation)
        } else {
            map.get(conversation).cloned()
        }
    });
    match dropped.filter(|window| window.handle == handle) {
        Some(target) => windows.into_iter().find(|window| same(window, &target)),
        None => windows.into_iter().find(|window| window.handle == handle),
    }
    .ok_or_else(|| "That window closed or changed. Choose it again.".into())
}

fn insert(conversation: &str, window: Window, control: bool, agent: &str, at: Instant) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    if let Ok(mut map) = staged_map().lock() {
        expire(&mut map);
        let previous = map.insert(
            conversation.into(),
            Staged {
                id: id.clone(),
                window,
                control,
                agent: agent.chars().take(40).collect(),
                provider: "auto".into(),
                resume_offered: false,
                resumed: false,
                kept: false,
                site: AttachSite::None,
                at,
            },
        );
        if let Some(previous) = previous {
            badge::close(&previous.id);
        }
    }
    id
}

/// Hands an attached window back to its conversation when the turn that used it ends, so
/// the next turn takes it without asking. It keeps what the person allowed (control and
/// site) and stays until detached. A grant still paused offers Resume on the badge.
/// Returns the staged id.
pub fn keep(conversation: &str, attached: Staged, provider: &str, paused: bool) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let provider = provider
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(40)
        .collect();
    if let Ok(mut map) = staged_map().lock() {
        let previous = map.insert(
            conversation.into(),
            Staged {
                id: id.clone(),
                provider,
                resume_offered: paused,
                resumed: false,
                kept: true,
                at: Instant::now(),
                ..attached
            },
        );
        if let Some(previous) = previous {
            badge::close(&previous.id);
        }
    }
    id
}

/// Stages the window of a grant that was still waiting for Resume when its attempt
/// ended, so its badge can offer Resume. Returns the staged id.
pub fn offer_resume(conversation: &str, window: Window, control: bool, provider: &str) -> String {
    let id = stage(conversation, window, control, "Jackalope");
    set_provider(conversation, provider);
    if let Ok(mut map) = staged_map().lock() {
        if let Some(staged) = map.get_mut(conversation) {
            staged.resume_offered = true;
        }
    }
    id
}

/// Records the badge's Resume click. Returns the key it waits under, the window title,
/// and whether this was the first click, so the wake note is sent once per resume.
pub fn mark_resumed(id: &str) -> Option<(String, String, bool)> {
    let mut map = staged_map().lock().ok()?;
    expire(&mut map);
    let (key, staged) = map.iter_mut().find(|(_, staged)| staged.id == id)?;
    let first = !staged.resumed;
    staged.resumed = true;
    Some((
        key.clone(),
        staged.window.title.chars().take(80).collect(),
        first,
    ))
}

/// The key a run's attached window is staged under: its conversation, or its task for
/// work started outside a conversation. Never a draft key.
pub fn owner(run: &super::TaskRun) -> Option<&str> {
    run.live_session_id
        .as_deref()
        .or(Some(run.task_id.as_str()))
        .filter(|key| !key.is_empty() && !key.starts_with(DRAFT))
}

/// Moves an attached window between a draft and the conversation Send created, or back
/// when creating it failed. Exactly one side must be a draft; the attach time and id are
/// kept, so the hand-off never extends how long the window waits.
pub fn hand_off(from: &str, to: &str) -> Result<bool, String> {
    if from.starts_with(DRAFT) == to.starts_with(DRAFT) {
        return Err("A window moves only between a draft and a conversation.".into());
    }
    let mut map = staged_map().lock().map_err(|e| e.to_string())?;
    expire(&mut map);
    let Some(staged) = map.remove(from) else {
        return Ok(false);
    };
    if let Some(previous) = map.insert(to.into(), staged) {
        badge::close(&previous.id);
    }
    Ok(true)
}

/// Detaches every draft window except `keep`, so a window attached for one project's
/// draft never follows the person to another project.
pub fn clear_drafts(keep: Option<&str>) {
    if let Ok(mut map) = staged_map().lock() {
        map.retain(|key, staged| {
            let kept = !key.starts_with(DRAFT) || Some(key.as_str()) == keep;
            if !kept {
                badge::close(&staged.id);
            }
            kept
        });
    }
    if let Ok(mut map) = dropped().lock() {
        map.retain(|key, _| !key.starts_with(DRAFT) || Some(key.as_str()) == keep);
    }
}

pub fn staged(conversation: &str) -> Option<Staged> {
    let mut map = staged_map().lock().ok()?;
    expire(&mut map);
    map.get(conversation).cloned()
}

/// The staged window with this id and the key it currently waits under.
pub fn by_id(id: &str) -> Option<(String, Staged)> {
    let mut map = staged_map().lock().ok()?;
    expire(&mut map);
    map.iter()
        .find(|(_, staged)| staged.id == id)
        .map(|(key, staged)| (key.clone(), staged.clone()))
}

pub fn clear(conversation: &str) {
    if let Ok(mut map) = staged_map().lock() {
        if let Some(staged) = map.remove(conversation) {
            badge::close(&staged.id);
        }
    }
}

/// Detaches by id, from the window's badge; returns the key it waited under.
pub fn clear_id(id: &str) -> Option<String> {
    let mut map = staged_map().lock().ok()?;
    let key = map
        .iter()
        .find(|(_, staged)| staged.id == id)
        .map(|(key, _)| key.clone())?;
    map.remove(&key);
    badge::close(id);
    Some(key)
}

/// Takes the conversation's attached window when it is still open: the same handle,
/// process and process start time among `windows`. A closed or replaced window is
/// dropped, so the agent falls back to the usual access question. Taking it closes its
/// badge, so the grant's bar and frame are the only indicator from then on.
pub fn take_for(conversation: &str, windows: &[Window], denied: &[u32]) -> Option<Staged> {
    let mut map = staged_map().lock().ok()?;
    let staged = map.remove(conversation)?;
    badge::close(&staged.id);
    if (!staged.kept && staged.at.elapsed() >= STAGE_TTL) || !eligible(&staged.window, denied) {
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

/// The target a drop chose, kept until the person confirms or cancels.
fn dropped() -> &'static Mutex<HashMap<String, Window>> {
    static DROPPED: OnceLock<Mutex<HashMap<String, Window>>> = OnceLock::new();
    DROPPED.get_or_init(Mutex::default)
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::desktop_control::attach::desktop_attach_support,
            commands::desktop_control::attach::desktop_attach_windows,
            commands::desktop_control::attach::desktop_attach_confirm,
            commands::desktop_control::attach::desktop_attach_site,
            commands::desktop_control::attach::desktop_attach_get,
            commands::desktop_control::attach::desktop_attach_clear,
            commands::desktop_control::attach::desktop_attach_hand_off,
            commands::desktop_control::attach::desktop_attach_clear_drafts,
            commands::desktop_control::attach::desktop_attach_reveal,
            commands::desktop_control::attach::overlay::desktop_glob_prepare,
            commands::desktop_control::attach::overlay::desktop_glob_start,
            commands::desktop_control::attach::overlay::desktop_glob_end,
            commands::desktop_control::attach::overlay::desktop_overlay_ready,
            commands::desktop_control::attach::overlay::desktop_glob_log,
            commands::desktop_control::attach::badge::desktop_badge_state,
            commands::desktop_control::attach::badge::desktop_badge_resize,
            commands::desktop_control::attach::badge::desktop_badge_detach,
            commands::desktop_control::attach::badge::desktop_badge_open,
            commands::desktop_control::attach::badge::desktop_badge_resume,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[tauri::command]
pub fn desktop_attach_support() -> AttachSupport {
    AttachSupport {
        drag: drag_supported(),
        pick: super::platform::supported() && !super::platform::portal_selected(),
        badge: badge::supported(),
    }
}

#[tauri::command]
pub async fn desktop_attach_windows() -> Result<Vec<AttachTarget>, String> {
    let windows = tauri::async_runtime::spawn_blocking(list)
        .await
        .map_err(|e| e.to_string())??;
    Ok(windows.iter().map(summary).collect())
}

/// The website open in a browser window the attach dialog shows, so the person sees which
/// site attaching allows. `None` for other apps or an unreadable address.
#[tauri::command]
pub async fn desktop_attach_site(
    conversation: String,
    handle: String,
) -> Result<Option<String>, String> {
    let conversation = conversation_id(&conversation)?.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        Ok(read_site(&chosen(&conversation, &handle, false)?))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stages a window the person chose for the conversation. Called only from the
/// confirm dialog; the window is matched again against the live window list. The
/// window's badge opens; it grants nothing either.
#[tauri::command]
pub async fn desktop_attach_confirm(
    app: AppHandle,
    conversation: String,
    handle: String,
    control: bool,
    agent: Option<String>,
    provider: Option<String>,
    site: Option<String>,
) -> Result<AttachedWindow, String> {
    let conversation = conversation_id(&conversation)?.to_owned();
    let agent = agent.unwrap_or_else(|| "the agent".into());
    let provider = provider.unwrap_or_else(|| "auto".into());
    let staged = tauri::async_runtime::spawn_blocking(move || {
        let window = chosen(&conversation, &handle, true)?;
        let site = attach_site(&window, site.as_deref());
        stage(&conversation, window, control, &agent);
        set_provider(&conversation, &provider);
        set_site(&conversation, site);
        staged(&conversation).ok_or_else(|| "The window could not be attached.".to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    if badge::supported() {
        badge::open(&app, &staged.id);
        overlay::flash_attached(&app, staged.window.clone());
    }
    overlay::trace(format_args!(
        "attached {} \u{2014} {} ({}{})",
        grant::app_label(&staged.window),
        staged.window.title.chars().take(60).collect::<String>(),
        if staged.control {
            "can control"
        } else {
            "see only"
        },
        match &staged.site {
            AttachSite::None => String::new(),
            AttachSite::Host(host) => format!(", site {host}"),
            AttachSite::Unread => ", site unread".into(),
        }
    ));
    Ok(AttachedWindow::of(&staged))
}

#[tauri::command]
pub fn desktop_attach_get(conversation: String) -> Option<AttachedWindow> {
    staged(conversation_id(&conversation).ok()?).map(|staged| AttachedWindow::of(&staged))
}

/// Shows where an attached window is: its outline glows again and its badge bounces.
#[tauri::command]
pub fn desktop_attach_reveal(app: AppHandle, conversation: String) {
    let Some(staged) = conversation_id(&conversation).ok().and_then(staged) else {
        return;
    };
    if badge::supported() {
        badge::pulse(&app, &staged.id);
        overlay::flash_attached(&app, staged.window);
    }
}

/// Hands a draft's window to the conversation Send created, or back if that failed.
#[tauri::command]
pub fn desktop_attach_hand_off(from: String, to: String) -> Result<bool, String> {
    hand_off(conversation_id(&from)?, conversation_id(&to)?)
}

#[tauri::command]
pub fn desktop_attach_clear_drafts(keep: Option<String>) {
    let keep = keep.as_deref().and_then(|key| conversation_id(key).ok());
    clear_drafts(keep);
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

/// Tells app windows that the attachment under `key` changed outside them.
fn announce(app: &AppHandle, key: &str) {
    let _ = app.emit(CHANGED_EVENT, key);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Staging is one map for the whole process; tests that change it take turns.
    fn serial() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

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
        let _serial = serial();
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
        let _serial = serial();
        let notes = window("10", 42, "Notes", "com.apple.notes");
        stage("conversation-a", notes.clone(), false, "Codex");
        assert!(staged("conversation-a").is_some_and(|s| !s.control));
        let mut reopened = notes.clone();
        reopened.started = "2".into();
        assert!(take_for("conversation-a", &[reopened], &[]).is_none());
        assert!(
            staged("conversation-a").is_none(),
            "a replaced window is dropped"
        );

        stage("conversation-a", notes.clone(), true, "Codex");
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
    fn a_draft_window_moves_to_the_new_conversation_keeping_its_id_and_attach_time() {
        let _serial = serial();
        let mail = window("40", 42, "Inbox", "mail");
        let id = stage("draft:project-1", mail.clone(), false, "Claude");
        assert!(hand_off("draft:project-1", "draft:project-2").is_err());
        assert!(hand_off("conversation-x", "conversation-y").is_err());
        assert!(hand_off("draft:project-1", "conversation-new").unwrap());
        assert!(staged("draft:project-1").is_none());
        assert_eq!(
            by_id(&id).map(|(key, _)| key).as_deref(),
            Some("conversation-new")
        );
        // Creating the conversation failed: the window goes back to the draft.
        assert!(hand_off("conversation-new", "draft:project-1").unwrap());
        assert!(hand_off("draft:project-1", "conversation-new").unwrap());
        assert!(
            !hand_off("draft:project-1", "conversation-new").unwrap(),
            "nothing left"
        );
        let taken = take_for("conversation-new", &[mail], &[]).unwrap();
        assert!(!taken.control, "see-only survives the hand-off");
        assert_eq!(taken.id, id);
        assert!(by_id(&id).is_none(), "taking it ends the badge's window");
    }

    #[test]
    fn an_expired_draft_window_is_not_handed_off() {
        let _serial = serial();
        let old = Instant::now()
            .checked_sub(STAGE_TTL + Duration::from_secs(1))
            .unwrap();
        insert(
            "draft:project-old",
            window("50", 42, "Notes", "notes"),
            true,
            "Codex",
            old,
        );
        assert!(!hand_off("draft:project-old", "conversation-old").unwrap());
        assert!(staged("conversation-old").is_none());
    }

    #[test]
    fn switching_projects_detaches_other_drafts_and_runs_never_match_a_draft() {
        let _serial = serial();
        stage("draft:project-a", window("60", 42, "A", "a"), true, "Codex");
        stage("draft:project-b", window("61", 42, "B", "b"), true, "Codex");
        stage(
            "conversation-kept",
            window("62", 42, "C", "c"),
            true,
            "Codex",
        );
        clear_drafts(Some("draft:project-b"));
        assert!(staged("draft:project-a").is_none());
        assert!(staged("draft:project-b").is_some());
        assert!(
            staged("conversation-kept").is_some(),
            "conversations are untouched"
        );
        clear_drafts(None);
        assert!(staged("draft:project-b").is_none());

        let mut run = super::super::TaskRun {
            task_id: "task-1".into(),
            ..Default::default()
        };
        assert_eq!(owner(&run), Some("task-1"));
        run.live_session_id = Some("conversation-1".into());
        assert_eq!(owner(&run), Some("conversation-1"));
        run.live_session_id = Some("draft:project-a".into());
        assert_eq!(owner(&run), None);
    }

    #[test]
    fn a_left_behind_grant_offers_resume_and_counts_only_the_first_click() {
        let _serial = serial();
        let window = window("70", 42, "GitHub", "browser");
        let id = offer_resume("conversation-r", window.clone(), true, "codex");
        let offered = staged("conversation-r").unwrap();
        assert!(offered.resume_offered && !offered.resumed && offered.control);
        assert_eq!(offered.provider, "codex");
        let (key, title, first) = mark_resumed(&id).unwrap();
        assert_eq!(
            (key.as_str(), title.as_str(), first),
            ("conversation-r", "GitHub", true)
        );
        assert!(
            !mark_resumed(&id).unwrap().2,
            "a second click sends nothing"
        );
        let taken = take_for("conversation-r", &[window], &[]).unwrap();
        assert!(taken.resumed, "the next grant starts resumed");
        assert!(mark_resumed(&id).is_none());
    }

    #[test]
    fn attaching_a_browser_allows_the_site_the_dialog_showed() {
        let browser = window("40", 42, "MCP servers", "chrome");
        assert_eq!(
            attach_site(&browser, Some("https://AllMCPs.com/servers?q=1")),
            AttachSite::Host("allmcps.com".into())
        );
        let editor = window("41", 42, "notes.txt", "textedit");
        assert_eq!(
            attach_site(&editor, Some("https://allmcps.com")),
            AttachSite::None
        );
        assert_eq!(
            read_site(&editor),
            None,
            "only browsers are asked for an address"
        );
    }

    #[test]
    fn detaching_by_id_or_key_drops_the_attached_window() {
        let _serial = serial();
        stage(
            "conversation-c",
            window("20", 42, "Mail", "mail"),
            true,
            "Codex",
        );
        clear("conversation-c");
        assert!(staged("conversation-c").is_none());
        let id = stage(
            "conversation-d",
            window("21", 42, "Mail", "mail"),
            true,
            "Codex",
        );
        assert_eq!(clear_id(&id).as_deref(), Some("conversation-d"));
        assert!(staged("conversation-d").is_none());
        assert!(clear_id(&id).is_none());
        assert!(conversation_id("").is_err());
        assert!(conversation_id("a\nb").is_err());
    }

    #[test]
    fn the_answered_record_names_the_window_and_what_was_allowed() {
        let _serial = serial();
        let staged = Staged {
            id: "x".into(),
            window: window("30", 42, "Budget", "excel"),
            control: false,
            agent: "Codex".into(),
            provider: "codex".into(),
            resume_offered: false,
            resumed: false,
            kept: false,
            site: AttachSite::None,
            at: Instant::now(),
        };
        let prompt = answered_prompt("run-1", "Trail", &staged);
        assert_eq!(prompt.status, "answered");
        assert_eq!(prompt.run_id, "run-1");
        assert!(prompt.question.contains("read and capture"));
        assert!(!prompt.question.contains("click"));
        assert_eq!(prompt.answer.as_deref(), Some("Budget \u{2014} excel"));
        assert_eq!(AttachedWindow::of(&staged).minutes_left, 30);
    }

    #[test]
    fn a_kept_window_serves_every_later_turn_until_detached() {
        let conversation = "kept-conversation";
        let target = window("31", 43, "Draft", "zen");
        let id = stage(conversation, target.clone(), true, "Codex");
        let taken = take_for(conversation, std::slice::from_ref(&target), &[]).unwrap();
        assert_eq!(taken.id, id);
        assert!(
            staged(conversation).is_none(),
            "a turn holds the window while it works"
        );

        let kept = keep(conversation, taken, "codex", false);
        // Long past the wait for a window nobody has used yet.
        if let Ok(mut map) = staged_map().lock() {
            let entry = map.get_mut(conversation).unwrap();
            entry.at = Instant::now()
                .checked_sub(STAGE_TTL * 2)
                .unwrap_or(entry.at);
        }
        assert!(staged(conversation).is_some_and(|entry| entry.kept));
        let again = take_for(conversation, std::slice::from_ref(&target), &[])
            .expect("the next turn takes it without asking");
        assert_eq!(again.id, kept);
        assert!(again.kept && again.control);

        keep(conversation, again, "codex", false);
        clear(conversation);
        assert!(
            take_for(conversation, &[target], &[]).is_none(),
            "detaching ends it"
        );
    }
}
