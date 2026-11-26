//! The person's own iPhones and iPads, through Xcode's `devicectl`.
//!
//! Jackalope lists the physical devices paired with this Mac, lets the person attach one
//! to a conversation ([`grant`]), builds the conversation's workspace for it and
//! installs and launches it (Run on device, [`run`]), and keeps a bounded console log of
//! the last launch ([`console`]). Agents reach a device only through the `device_app`
//! and `device_logs` bridge tools ([`tools`]), and only one the person attached to
//! their conversation or allowed for the project. Simulators are left to the Simulator
//! tools.
//!
//! Every `devicectl` call is read from its `--json-output` file ([`devicectl`]).

mod build;
mod console;
mod devicectl;
mod grant;
mod run;
#[cfg(test)]
mod tests;
mod tools;

pub(crate) use tools::{AppInput, LogsInput};

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

use super::tasks::{TaskRun, TaskRuntime};
use devicectl::Device;
use grant::{Attached, Level, RememberedDevice};

/// Tells app windows that a conversation's device, run or console changed.
pub const CHANGED_EVENT: &str = "device-changed";

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::devices::device_support,
            commands::devices::device_list,
            commands::devices::device_attach,
            commands::devices::device_attached,
            commands::devices::device_detach,
            commands::devices::device_permissions,
            commands::devices::device_forget,
            commands::devices::device_run,
            commands::devices::device_run_state,
            commands::devices::device_run_cancel,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

/// The key a run's device attachment, console and installs live under: its
/// conversation, or its task for work outside one.
fn owner(run: &TaskRun) -> Option<String> {
    run.live_session_id
        .as_deref()
        .filter(|id| !id.is_empty())
        .or(Some(run.task_id.as_str()))
        .filter(|key| !key.is_empty())
        .map(str::to_owned)
}

/// Physical devices `devicectl` lists now.
fn list() -> Result<Vec<Device>, String> {
    let output = devicectl::run(
        devicectl::list_args,
        Duration::from_secs(60),
        "this Mac",
        "list devices",
    )?;
    Ok(devicectl::parse_devices(
        &serde_json::json!({ "result": output }),
    ))
}

/// Where Run on device builds a workspace, outside it so the build never shows as a change.
fn own_derived_data(runtime: &TaskRuntime, workspace: &str) -> PathBuf {
    let digest = Sha256::digest(workspace.as_bytes());
    let name: String = digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    runtime.data_directory().join("device-builds").join(name)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Install {
    device_id: String,
    bundle_id: String,
}

fn installs() -> &'static Mutex<HashMap<String, Install>> {
    static INSTALLS: OnceLock<Mutex<HashMap<String, Install>>> = OnceLock::new();
    INSTALLS.get_or_init(Mutex::default)
}

fn record_install(key: &str, device_id: &str, bundle_id: &str) {
    if let Ok(mut map) = installs().lock() {
        map.insert(
            key.to_owned(),
            Install {
                device_id: device_id.to_owned(),
                bundle_id: bundle_id.to_owned(),
            },
        );
    }
}

fn last_install(key: &str) -> Option<Install> {
    installs().lock().ok()?.get(key).cloned()
}

fn app_handle() -> &'static OnceLock<AppHandle> {
    static APP: OnceLock<AppHandle> = OnceLock::new();
    &APP
}

/// Announces changes under `key` to app windows, at most every quarter second while
/// output streams in; a change inside that window is announced at its end.
fn changed(key: &str) -> impl Fn() + Send + Sync + Clone + 'static {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    const QUIET: Duration = Duration::from_millis(250);
    let key: Arc<str> = key.into();
    let last = Arc::new(Mutex::new(None::<Instant>));
    let pending = Arc::new(AtomicBool::new(false));
    move || {
        let Some(app) = app_handle().get() else {
            return;
        };
        let wait = last
            .lock()
            .ok()
            .and_then(|last| *last)
            .map(|at| QUIET.saturating_sub(at.elapsed()))
            .unwrap_or_default();
        if wait.is_zero() {
            if let Ok(mut last) = last.lock() {
                *last = Some(Instant::now());
            }
            let _ = app.emit(CHANGED_EVENT, &*key);
        } else if !pending.swap(true, Ordering::AcqRel) {
            let (app, key, last, pending) =
                (app.clone(), key.clone(), last.clone(), pending.clone());
            std::thread::spawn(move || {
                std::thread::sleep(wait);
                pending.store(false, Ordering::Release);
                if let Ok(mut last) = last.lock() {
                    *last = Some(Instant::now());
                }
                let _ = app.emit(CHANGED_EVENT, &*key);
            });
        }
    }
}

fn remember_app(app: &AppHandle) {
    let _ = app_handle().set(app.clone());
}

fn grants_path(runtime: &TaskRuntime) -> PathBuf {
    grant::store_path(&runtime.preferences_directory())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSupport {
    /// devicectl is available: macOS with Xcode installed.
    supported: bool,
    /// Why not, when it is not.
    reason: Option<String>,
    /// The workspace has an Xcode project or workspace to build.
    xcode_project: bool,
}

#[tauri::command]
pub async fn device_support(workspace: Option<String>) -> Result<DeviceSupport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let reason = devicectl::unavailable();
        DeviceSupport {
            supported: reason.is_none(),
            reason,
            xcode_project: workspace
                .as_deref()
                .is_some_and(|workspace| build::find_project(Path::new(workspace)).is_some()),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn device_list() -> Result<Vec<Device>, String> {
    tauri::async_runtime::spawn_blocking(list)
        .await
        .map_err(|e| e.to_string())?
}

/// A conversation's attached device and the devices its project allows.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAccess {
    attached: Option<Attached>,
    remembered: Vec<RememberedDevice>,
}

fn access(runtime: &TaskRuntime, conversation: &str, project_id: &str) -> DeviceAccess {
    DeviceAccess {
        attached: grant::attached(conversation),
        remembered: grant::remembered(&grants_path(runtime), project_id),
    }
}

/// Attaches a device the person chose to a conversation, and optionally allows it for
/// the whole project. The device must be listed now.
#[tauri::command]
pub async fn device_attach(
    app: AppHandle,
    state: State<'_, TaskRuntime>,
    conversation: String,
    project_id: String,
    device_id: String,
    control: bool,
    remember: bool,
) -> Result<DeviceAccess, String> {
    remember_app(&app);
    if conversation.trim().is_empty() {
        return Err("Attach a device to a conversation.".into());
    }
    let device = tauri::async_runtime::spawn_blocking(list)
        .await
        .map_err(|e| e.to_string())??
        .into_iter()
        .find(|device| device.id == device_id)
        .ok_or("That device is no longer connected. Refresh the list and choose it again.")?;
    let level = Level::of(control);
    if remember {
        grant::remember(
            &grants_path(&state),
            &project_id,
            &device.id,
            &device.name,
            level,
        )?;
    }
    grant::attach(
        &conversation,
        Attached {
            device_id: device.id,
            name: device.name,
            level,
        },
    );
    changed(&conversation)();
    Ok(access(&state, &conversation, &project_id))
}

#[tauri::command]
pub fn device_attached(
    app: AppHandle,
    state: State<'_, TaskRuntime>,
    conversation: String,
    project_id: String,
) -> DeviceAccess {
    remember_app(&app);
    access(&state, &conversation, &project_id)
}

/// Detaches the conversation's device and stops capturing its console. A device allowed
/// for the project stays allowed until it is removed in Project settings.
#[tauri::command]
pub fn device_detach(
    state: State<'_, TaskRuntime>,
    conversation: String,
    project_id: String,
) -> DeviceAccess {
    grant::detach(&conversation);
    console::stop(&conversation);
    changed(&conversation)();
    access(&state, &conversation, &project_id)
}

#[tauri::command]
pub fn device_permissions(
    state: State<'_, TaskRuntime>,
    project_id: String,
) -> Vec<RememberedDevice> {
    grant::remembered(&grants_path(&state), &project_id)
}

#[tauri::command]
pub fn device_forget(
    state: State<'_, TaskRuntime>,
    project_id: String,
    id: String,
) -> Result<(), String> {
    grant::forget(&grants_path(&state), &project_id, &id).map(|_| ())
}

/// Builds the conversation's latest workspace for `device_id`, installs and launches it.
/// Progress arrives as [`CHANGED_EVENT`]s; read it with `device_run_state`.
#[tauri::command]
pub async fn device_run(
    app: AppHandle,
    state: State<'_, TaskRuntime>,
    conversation: String,
    run_id: String,
    device_id: String,
) -> Result<(), String> {
    remember_app(&app);
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(reason) = devicectl::unavailable() {
            return Err(reason);
        }
        let task = runtime
            .run_snapshot(&run_id)
            .ok_or("That work is no longer available.")?;
        if task.remote.is_some() {
            return Err("This work ran on a computer, so its build is not on this Mac.".into());
        }
        let device = list()?
            .into_iter()
            .find(|device| device.id == device_id)
            .ok_or("That device is no longer connected. Refresh the list and choose it again.")?;
        if let Some(problem) = &device.problem {
            return Err(format!("{} is not ready: {problem}", device.name));
        }
        let team = super::project_registry::record(&runtime, &task.project_id)
            .and_then(|project| project.development_team);
        let derived = own_derived_data(&runtime, &task.workspace);
        run::start(
            run::Plan {
                key: conversation.clone(),
                workspace: task.workspace,
                device,
                team,
                derived,
            },
            changed(&conversation),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn device_run_state(conversation: String) -> Option<run::RunState> {
    run::state(&conversation)
}

#[tauri::command]
pub fn device_run_cancel(conversation: String) {
    run::cancel(&conversation);
    changed(&conversation)();
}

/// `device_app` for an attempt.
pub(crate) async fn app_tool(
    runtime: TaskRuntime,
    run: TaskRun,
    input: AppInput,
) -> Result<serde_json::Value, super::bridge::ToolError> {
    tauri::async_runtime::spawn_blocking(move || tools::app(&runtime, &run, input))
        .await
        .map_err(|error| super::bridge::ToolError::failed(error.to_string()))?
}

/// `device_logs` for an attempt.
pub(crate) async fn logs_tool(
    runtime: TaskRuntime,
    run: TaskRun,
    input: LogsInput,
) -> Result<serde_json::Value, super::bridge::ToolError> {
    tauri::async_runtime::spawn_blocking(move || tools::logs(&runtime, &run, input))
        .await
        .map_err(|error| super::bridge::ToolError::failed(error.to_string()))?
}
