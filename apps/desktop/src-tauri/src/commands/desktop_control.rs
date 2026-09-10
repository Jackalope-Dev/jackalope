use super::{
    harness::PendingUserPrompt,
    tasks::{TaskRun, TaskRuntime},
};
use rmcp::schemars;
pub mod indicator;
pub mod platform;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DesktopRequest {
    #[schemars(
        description = "request_access, snapshot, screenshot, focus, click, type, press, scroll, or release. On supported desktop platforms, request_access asks the user to select one window. Escape/Stop/release revokes access. Physical input pauses control; only the human can Resume."
    )]
    pub action: String,
    #[schemars(
        description = "Snapshot ID from the latest snapshot or screenshot. Required for input; consumed by each input call. Take a new snapshot after changes."
    )]
    pub snapshot_id: Option<String>,
    #[schemars(
        description = "X coordinate in pixels relative to the selected window's top-left corner. Required for click/scroll."
    )]
    pub x: Option<i32>,
    pub y: Option<i32>,
    #[schemars(
        description = "Literal text, at most 1000 characters. Never supply secrets. Does not interpret key chords."
    )]
    pub text: Option<String>,
    #[schemars(
        description = "Tab, Shift+Tab, Enter, Escape, Space, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, Primary+a/s/z/y (Command on macOS, Control elsewhere), or literal Control+a/s/z/y."
    )]
    pub key: Option<String>,
    #[schemars(description = "Scroll wheel notches, -10 to 10. Positive scrolls up.")]
    pub wheel: Option<i32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Window {
    handle: String,
    pid: u32,
    started: String,
    title: String,
    class: String,
}

struct Snapshot {
    id: String,
    bounds: Value,
    taken: Instant,
    epoch: u64,
}

#[derive(Default)]
struct Access {
    prompt_id: String,
    choices: Vec<(String, Window)>,
    window: Option<Window>,
    snapshot: Option<Snapshot>,
    indicator: Option<indicator::Indicator>,
}

struct Session {
    canceled: AtomicBool,
    access: Mutex<Access>,
    _lease: std::fs::File,
}

static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<Session>>>> = OnceLock::new();
fn sessions() -> &'static Mutex<HashMap<String, Arc<Session>>> {
    SESSIONS.get_or_init(Mutex::default)
}

pub fn close(id: &str) {
    if let Some(session) = sessions().lock().unwrap().remove(id) {
        session.canceled.store(true, Ordering::SeqCst);
    }
}

fn current(runtime: &TaskRuntime, id: &str) -> Result<TaskRun, String> {
    runtime
        .integration_runs()?
        .into_iter()
        .find(|r| r.id == id && ["starting", "running"].contains(&r.status.as_str()))
        .ok_or_else(|| "This attempt has ended or is stopping. Desktop access is revoked.".into())
}

fn session(runtime: &TaskRuntime, id: &str, create: bool) -> Result<Arc<Session>, String> {
    current(runtime, id)?;
    let active: Vec<String> = runtime
        .integration_runs()?
        .into_iter()
        .filter(|r| ["starting", "running"].contains(&r.status.as_str()))
        .map(|r| r.id)
        .collect();
    let mut entries = sessions().lock().map_err(|e| e.to_string())?;
    entries.retain(|key, value| {
        if active.contains(key) {
            true
        } else {
            value.canceled.store(true, Ordering::SeqCst);
            false
        }
    });
    if let Some(session) = entries.get(id) {
        return Ok(session.clone());
    }
    if !create {
        return Err(
            "Request desktop access and wait for the user to choose a window first.".into(),
        );
    }
    if !entries.is_empty() {
        return Err(
            "Another task owns desktop control. Stop or release that task's desktop access first."
                .into(),
        );
    }
    let lock = platform::lease()?;
    let session = Arc::new(Session {
        canceled: AtomicBool::new(false),
        access: Mutex::new(Access::default()),
        _lease: lock,
    });
    entries.insert(id.into(), session.clone());
    Ok(session)
}

fn selected(run: &TaskRun, access: &Access) -> Result<Option<Window>, String> {
    let prompt = run
        .prompts
        .iter()
        .find(|p| p.id == access.prompt_id && p.run_id == run.id)
        .ok_or("Desktop access question is unavailable. Release access and request it again.")?;
    selected_answer(&run.id, prompt, access)
}

fn selected_answer(
    run_id: &str,
    prompt: &PendingUserPrompt,
    access: &Access,
) -> Result<Option<Window>, String> {
    if prompt.run_id != run_id || prompt.id != access.prompt_id {
        return Err("Desktop access question does not belong to this attempt.".into());
    }
    if prompt.status != "answered" {
        return Ok(None);
    }
    access
        .choices
        .iter()
        .find(|(label, _)| Some(label) == prompt.answer.as_ref())
        .map(|(_, window)| Some(window.clone()))
        .ok_or_else(|| "Desktop access was declined. No window was granted.".into())
}

fn validate(request: &DesktopRequest) -> Result<(), String> {
    if ![
        "request_access",
        "snapshot",
        "screenshot",
        "focus",
        "click",
        "type",
        "press",
        "scroll",
        "release",
    ]
    .contains(&request.action.as_str())
    {
        return Err("Unsupported desktop action.".into());
    }
    if request
        .text
        .as_ref()
        .is_some_and(|s| s.chars().count() > 1000 || s.chars().any(char::is_control))
    {
        return Err("Use at most 1000 printable characters; use press for control keys.".into());
    }
    if request.action == "type" && request.text.as_ref().is_none_or(String::is_empty) {
        return Err("Supply text to type.".into());
    }
    if ["click", "scroll"].contains(&request.action.as_str())
        && (request.x.is_none_or(|x| x < 0) || request.y.is_none_or(|y| y < 0))
    {
        return Err("Supply nonnegative window-relative x and y coordinates.".into());
    }
    if request.action == "scroll"
        && request
            .wheel
            .is_none_or(|n| n == 0 || !(-10..=10).contains(&n))
    {
        return Err("Supply 1 to 10 wheel notches in either direction.".into());
    }
    if request.action == "press"
        && ![
            "Tab",
            "Shift+Tab",
            "Enter",
            "Escape",
            "Space",
            "Backspace",
            "Delete",
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "Home",
            "End",
            "PageUp",
            "PageDown",
            "Control+a",
            "Control+s",
            "Control+z",
            "Control+y",
            "Primary+a",
            "Primary+s",
            "Primary+z",
            "Primary+y",
        ]
        .contains(&request.key.as_deref().unwrap_or(""))
    {
        return Err(
            "Unsupported key. Desktop switching and system-wide shortcuts are not exposed.".into(),
        );
    }
    Ok(())
}

fn take_snapshot(access: &mut Access, id: Option<&str>) -> Result<Snapshot, String> {
    let snapshot = access
        .snapshot
        .take()
        .ok_or("Take a fresh snapshot or screenshot before input.")?;
    if Some(snapshot.id.as_str()) != id || snapshot.taken.elapsed() > Duration::from_secs(60) {
        return Err("The desktop snapshot is stale. Take a new snapshot before input.".into());
    }
    Ok(snapshot)
}

#[cfg(windows)]
fn native_command(script: &str, payload: Value) -> Result<std::process::Command, String> {
    use std::os::windows::process::CommandExt;
    let windows =
        std::env::var_os("SystemRoot").ok_or("Windows system directory is unavailable.")?;
    let mut command = std::process::Command::new(
        std::path::PathBuf::from(&windows).join("System32/WindowsPowerShell/v1.0/powershell.exe"),
    );
    command
        .env_clear()
        .env("SystemRoot", &windows)
        .env("WINDIR", &windows)
        .env("TEMP", std::env::temp_dir())
        .env("TMP", std::env::temp_dir())
        .env("JACKALOPE_DESKTOP_REQUEST", payload.to_string())
        .args(["-NoProfile", "-NonInteractive", "-Command", script]);
    command.creation_flags(0x08000000);
    Ok(command)
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
fn native(payload: Value, canceled: &AtomicBool) -> Result<Value, String> {
    #[cfg(windows)]
    let command = native_command(include_str!("desktop_control/windows.ps1"), payload)?;
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let command = platform::command(payload)?;
    if canceled.load(Ordering::SeqCst) {
        return Err("Desktop access was revoked.".into());
    }
    let output = super::process_control::run_cancellable(command, Duration::from_secs(20), || {
        canceled.load(Ordering::SeqCst)
    })?;
    if canceled.load(Ordering::SeqCst) {
        return Err(
            "Desktop access was revoked. An in-flight action may have occurred; do not replay it."
                .into(),
        );
    }
    if output.timed_out {
        return Err("The desktop operation timed out. Inspect the window before retrying; an action may have occurred.".into());
    }
    if !output.success || output.truncated {
        return Err(format!(
            "Desktop operation failed: {}",
            output.stderr.chars().take(1200).collect::<String>()
        ));
    }
    serde_json::from_str(output.stdout.trim_start_matches('\u{feff}').trim())
        .map_err(|_| "Desktop helper returned invalid output.".into())
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn native(_: Value, _: &AtomicBool) -> Result<Value, String> {
    Err("Guarded native desktop control is unavailable on this desktop. Task browser automation is available separately.".into())
}

pub async fn execute(
    runtime: TaskRuntime,
    run: TaskRun,
    request: DesktopRequest,
) -> Result<Value, String> {
    validate(&request)?;
    if request.action == "release" {
        close(&run.id);
        return Ok(json!({"status":"released"}));
    }
    if !platform::supported() {
        return Err("Guarded native desktop control is unavailable on this desktop. Task browser automation is available separately.".into());
    }
    let owned = session(&runtime, &run.id, request.action == "request_access")?;
    let id = run.id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let mut access = owned.access.try_lock().map_err(|_| "A desktop operation is already in progress. Wait for it to finish.")?;
        let fresh = current(&runtime, &run.id)?;
        if access.prompt_id.is_empty() {
            if fresh.prompts.len() >= 100 { return Err("This task has reached its question limit.".into()); }
            let value = native(json!({"action":"list"}), &owned.canceled)?;
            let windows: Vec<Window> = serde_json::from_value(value["windows"].clone()).map_err(|_| "Invalid window inventory.")?;
            if windows.is_empty() { return Err("No available desktop windows were found.".into()); }
            access.choices = windows.into_iter().take(20).enumerate().map(|(index, window)| (format!("{}: {}", index + 1, window.title.chars().take(140).collect::<String>()), window)).collect();
            let mut options = vec!["Do not allow".to_owned()];
            options.extend(access.choices.iter().map(|(label, _)| label.clone()));
            let prompt = PendingUserPrompt { id: uuid::Uuid::new_v4().to_string(), run_id: run.id.clone(),
                question: "Allow desktop control for this attempt? Choose one window the agent may read, capture, focus, click, and type into. A desktop glow shows when control is active. Escape or Stop revokes access. Moving the mouse or using the keyboard pauses control until you click Resume. This is your live desktop; input can change files or send data. Other windows and popups need separate access. Do not choose a window containing secrets.".into(),
                input_type: "choice".into(), options, default_value: None, status: "pending".into(), answer: None,
                created_at: chrono::Utc::now().to_rfc3339(), answered_at: None };
            current(&runtime, &run.id)?;
            runtime.update_checked(&run.id, |r| {
                if ["starting", "running"].contains(&r.status.as_str()) { r.prompts.push(prompt.clone()); }
            })?;
            current(&runtime, &run.id)?;
            access.prompt_id = prompt.id;
            return Ok(json!({"status":"pending","questionId":access.prompt_id,"instruction":"Wait for the user to choose a window. Call desktop_control again after their answer; do not use another transport to bypass access."}));
        }
        if access.window.is_none() {
            let Some(window) = selected(&fresh, &access)? else { return Ok(json!({"status":"pending","questionId":access.prompt_id})); };
            let indicator = indicator::Indicator::start(&window)?;
            indicator.watch(&owned, runtime.clone(), run.id.clone());
            access.indicator = Some(indicator);
            runtime.update_checked(&run.id, |r| r.activity.push("User granted desktop control for one window. Escape or Stop revokes access; user input pauses it until Resume.".into()))?;
            access.window = Some(window);
        }
        let window = access.window.clone().ok_or("No selected window.")?;
        let state = access.indicator.as_mut().ok_or("Desktop indicator is unavailable.")?.state()?;
        if state.status == "canceled" { return Err("Desktop control canceled by the user.".into()); }
        if request.action == "request_access" { return Ok(json!({"status":state.status,"pauseReason":state.reason,"window":window,"instruction":"The window indicator must be active. If paused, wait for the human to click Resume. Never resume or refocus through another tool. Take a fresh snapshot after resuming. Escape or Stop cancels access."})); }
        if state.status != "active" { access.snapshot = None; return Err("Desktop control paused. Wait for the user to click Resume in the window indicator; then take a fresh snapshot. Do not reclaim focus or bypass the pause.".into()); }
        let input = ["click", "type", "press", "scroll"].contains(&request.action.as_str());
        let bounds = if input {
            let snapshot = take_snapshot(&mut access, request.snapshot_id.as_deref())?;
            if snapshot.epoch != state.epoch { return Err("Desktop control changed since the snapshot. Take a fresh snapshot after the user resumes.".into()); }
            Some(snapshot.bounds)
        } else { access.snapshot = None; None };
        current(&runtime, &run.id)?;
        let mut payload = json!({"action":request.action,"window":window,"bounds":bounds,"x":request.x,"y":request.y,"text":request.text,"key":request.key.as_deref().map(platform::key),"wheel":request.wheel});
        payload["guard"] = access.indicator.as_ref().unwrap().guard(state.epoch);
        let artifact_id = uuid::Uuid::new_v4().to_string();
        let temporary = std::env::temp_dir().join(format!("jackalope-desktop-{artifact_id}.png"));
        if request.action == "screenshot" { payload["path"] = json!(temporary); }
        let result = native(payload, &owned.canceled);
        let mut value = match result { Ok(value) => value, Err(error) => { let _ = std::fs::remove_file(&temporary); return Err(error); } };
        if let Err(error) = current(&runtime, &run.id) {
            let _ = std::fs::remove_file(&temporary);
            return Err(error);
        }
        if request.action == "screenshot" {
            let bytes = std::fs::read(&temporary);
            let _ = std::fs::remove_file(&temporary);
            let bytes = bytes.map_err(|e| e.to_string())?;
            if bytes.len() > 8 * 1024 * 1024 { return Err("Window capture exceeds the 8 MiB preview limit.".into()); }
            let (width, height) = super::harness::png_dimensions(&bytes)?;
            let directory = std::path::Path::new(&run.workspace).join(".jackalope/artifacts/screenshots");
            std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
            let file = directory.join(format!("{artifact_id}.png"));
            std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
            let artifact = super::harness::ScreenshotArtifact { id: artifact_id, name: "Desktop window capture".into(), url: "desktop://selected-window".into(), file_path: file.to_string_lossy().into_owned(), width, height, timestamp: chrono::Utc::now().to_rfc3339() };
            runtime.update_checked(&run.id, |r| r.screenshots.push(artifact.clone()))?;
            value["artifact"] = json!(artifact);
        }
        if ["snapshot", "screenshot"].contains(&request.action.as_str()) {
            let after = access.indicator.as_mut().unwrap().state()?;
            if after.status != "active" || after.epoch != state.epoch { return Err("Desktop control paused or changed during capture. Wait for the user to resume and take a new snapshot.".into()); }
            let id = uuid::Uuid::new_v4().to_string();
            access.snapshot = Some(Snapshot { id: id.clone(), bounds: value["bounds"].clone(), taken: Instant::now(), epoch: state.epoch });
            value["snapshotId"] = json!(id);
        }
        value["untrustedContent"] = json!(true);
        if input { runtime.update_checked(&run.id, |r| r.activity.push(format!("Desktop {} sent to the user-selected window; inspect the result before further input.", request.action)))?; }
        Ok(value)
    }).await.map_err(|e| e.to_string())?;
    if result
        .as_ref()
        .err()
        .is_some_and(|e| e.contains("declined") || e.contains("Desktop control canceled"))
    {
        close(&id);
    }
    result
}

pub(super) async fn bridge(
    axum::extract::State(service): axum::extract::State<super::coordination::Coordinator>,
    headers: axum::http::HeaderMap,
    axum::Json(input): axum::Json<DesktopRequest>,
) -> Result<axum::Json<Value>, (axum::http::StatusCode, axum::Json<Value>)> {
    let run = service.authorized_run(&headers).map_err(|status| {
        (
            status,
            axum::Json(json!({"error":"Task authorization required"})),
        )
    })?;
    execute(service.runtime.clone(), run, input)
        .await
        .map(axum::Json)
        .map_err(|error| {
            (
                axum::http::StatusCode::BAD_REQUEST,
                axum::Json(json!({"error":error})),
            )
        })
}

#[cfg(test)]
mod tests;
