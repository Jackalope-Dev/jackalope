//! Agent tools for an iOS app in the Simulator: launch, read the screen as an
//! accessibility tree with refs, act, configure the device, capture and read
//! logs, without a Simulator window or macOS Accessibility permission.
//!
//! `simctl` covers apps, device settings, screenshots and logs. Reading and
//! acting on an app goes through the bundled XCUITest driver
//! (`resources/simulator-driver`), which [`driver`] builds once per Xcode and
//! runs per device as an owned `xcodebuild test-without-building` process.
//! Each attempt resolves its device through [`device_for`] the first time a
//! tool needs one; its driver stops when the attempt ends or the app quits.

mod driver;
mod render;
mod simctl;
#[cfg(test)]
mod tests;
mod tools;

pub(crate) use driver::failure_tail;
pub(crate) use tools::{app, configure, interact, logs, screenshot, snapshot};
/// The `simctl` commands managed previews and review captures run on a device.
pub(crate) mod device {
    pub(crate) use super::simctl::{
        capture, clean_status_bar, clear_status_bar, install, launch, open_url, plist_value, run,
        terminate, ui, Simctl, TIMEOUT, VIEW_SIZE,
    };
}
pub(crate) use tools::{bundle_id, url as valid_url};
pub(crate) use tools::{
    AppRequest, ConfigureRequest, InteractRequest, LogsRequest, ScreenshotRequest, SnapshotRequest,
};

use super::tasks::{TaskRun, TaskRuntime};
use base64::Engine as _;
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

/// What an attempt's simulator tools have used.
#[derive(Clone, Debug, Default)]
struct Attempt {
    udid: String,
    name: Option<String>,
    /// Apps the tools installed, launched or read, most recent first.
    apps: Vec<String>,
    /// The last snapshot's screen size in points.
    screen: Option<(u32, u32)>,
}

fn attempts() -> std::sync::MutexGuard<'static, HashMap<String, Attempt>> {
    static ATTEMPTS: OnceLock<Mutex<HashMap<String, Attempt>>> = OnceLock::new();
    ATTEMPTS
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
}

/// The task's own Simulator, created and booted within the simulator pool.
/// Follow-ups in the same workspace get the same device, so app state
/// persists between turns.
fn device_for(runtime: &TaskRuntime, run: &TaskRun) -> Result<(String, String), String> {
    let device = super::simulators::ensure(runtime, &run.id, || !runtime.is_running(&run.id))?;
    Ok((device.udid, device.name))
}

/// The attempt's device, resolved once.
fn device(runtime: &TaskRuntime, run: &TaskRun) -> Result<String, String> {
    if let Some(attempt) = attempts().get(&run.id) {
        return Ok(attempt.udid.clone());
    }
    if !runtime.is_running(&run.id) {
        return Err("This attempt has ended.".into());
    }
    let (udid, name) = device_for(runtime, run)?;
    let name = Some(name);
    attempts().entry(run.id.clone()).or_insert_with(|| Attempt {
        udid: udid.clone(),
        name,
        ..Attempt::default()
    });
    Ok(udid)
}

/// Assigns a device to an attempt without [`device_for`].
#[cfg(test)]
fn assign(run_id: &str, udid: &str) {
    attempts().insert(
        run_id.into(),
        Attempt {
            udid: udid.into(),
            ..Attempt::default()
        },
    );
}

/// Puts `bundle` first among the attempt's apps.
fn remember_app(run_id: &str, bundle: &str) {
    if let Some(attempt) = attempts().get_mut(run_id) {
        attempt.apps.retain(|app| app != bundle);
        attempt.apps.insert(0, bundle.to_string());
        attempt.apps.truncate(10);
    }
}

fn attempt(run_id: &str) -> Option<Attempt> {
    attempts().get(run_id).cloned()
}

/// Where built drivers and their run logs live.
fn driver_root(runtime: &TaskRuntime) -> PathBuf {
    runtime.data_directory().join("simulator-driver")
}

/// Whether an attempt is offered the simulator tools: on a Mac with Xcode,
/// for a workspace with an Xcode project, workspace or Swift package near
/// its root.
pub(crate) fn offered(run: &TaskRun) -> bool {
    supported() && super::xcode::toolchain().is_some() && apple_project(Path::new(&run.workspace))
}

/// Whether the tools exist on this platform at all.
pub(crate) fn supported() -> bool {
    cfg!(target_os = "macos")
}

/// Refuses a call where the Simulator cannot run.
pub(crate) fn available() -> Result<(), String> {
    if !supported() {
        return Err("The iOS Simulator tools need macOS.".into());
    }
    if super::xcode::toolchain().is_none() {
        return Err("The iOS Simulator tools need Xcode. Install Xcode from the App Store, open it once, then call again.".into());
    }
    Ok(())
}

/// An `.xcodeproj`, `.xcworkspace`, `Package.swift`, XcodeGen `project.yml`
/// or Tuist `Project.swift` in the workspace or one folder below it.
fn apple_project(workspace: &Path) -> bool {
    let marker = |name: &str| {
        name.ends_with(".xcodeproj")
            || name.ends_with(".xcworkspace")
            || matches!(name, "Package.swift" | "Project.swift" | "project.yml")
    };
    let Ok(entries) = std::fs::read_dir(workspace) else {
        return false;
    };
    let mut folders = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if marker(&name) {
            return true;
        }
        if !name.starts_with('.')
            && name != "node_modules"
            && entry.file_type().is_ok_and(|kind| kind.is_dir())
        {
            folders.push(entry.path());
        }
    }
    folders.into_iter().take(200).any(|folder| {
        std::fs::read_dir(folder).is_ok_and(|entries| {
            entries
                .flatten()
                .any(|entry| marker(&entry.file_name().to_string_lossy()))
        })
    })
}

/// Stops the attempt's driver unless another attempt or a managed preview
/// still uses its device.
pub fn attempt_ended(run_id: &str) {
    let Some(ended) = attempts().remove(run_id) else {
        return;
    };
    let shared = attempts()
        .values()
        .any(|attempt| attempt.udid == ended.udid);
    if !shared && !held(&ended.udid) {
        std::thread::spawn(move || driver::stop(&ended.udid));
    }
}

/// Devices a managed preview drives, with how many holds each has. Their
/// driver outlives the attempts that used the device.
fn holds() -> std::sync::MutexGuard<'static, HashMap<String, usize>> {
    static HOLDS: OnceLock<Mutex<HashMap<String, usize>>> = OnceLock::new();
    HOLDS
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
}

fn held(udid: &str) -> bool {
    holds().contains_key(udid)
}

/// Keeps a device's driver for a managed preview. Dropping the last hold
/// stops the driver unless an attempt's tools still use the device.
pub(crate) struct DriverHold(String);

impl DriverHold {
    pub(crate) fn new(udid: &str) -> Self {
        *holds().entry(udid.to_string()).or_default() += 1;
        Self(udid.to_string())
    }
}

impl Drop for DriverHold {
    fn drop(&mut self) {
        let last = {
            let mut holds = holds();
            match holds.get_mut(&self.0) {
                Some(count) if *count > 1 => {
                    *count -= 1;
                    false
                }
                _ => {
                    holds.remove(&self.0);
                    true
                }
            }
        };
        let attempt = attempts().values().any(|attempt| attempt.udid == self.0);
        if last && !attempt {
            let udid = std::mem::take(&mut self.0);
            std::thread::spawn(move || driver::stop(&udid));
        }
    }
}

/// Calls the device's driver for a managed preview, building and starting it
/// on first use. `progress` receives the build and start lines.
pub(crate) fn preview_call(
    runtime: &TaskRuntime,
    udid: &str,
    path: &str,
    body: &serde_json::Value,
    progress: &(dyn Fn(&str) + Sync),
    canceled: &(dyn Fn() -> bool + Sync),
) -> Result<serde_json::Value, String> {
    available()?;
    let root = driver_root(runtime);
    let driver = driver::for_device(
        udid,
        &driver::Context {
            root: &root,
            progress,
            canceled,
        },
    )?;
    driver.call(path, body, std::time::Duration::from_secs(60))
}

/// Stops every driver; called when the app quits.
pub fn close_all() {
    attempts().clear();
    driver::stop_all();
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorView {
    /// live or unavailable.
    pub status: &'static str,
    pub udid: String,
    pub device: Option<String>,
    /// The app the agent last used.
    pub app: Option<String>,
    /// Base64 PNG of the screen, scaled down.
    pub frame: Option<String>,
    pub error: Option<String>,
}

/// The attempt's simulator screen, for the agent-screen panel. It never
/// resolves or boots a device: only a device the attempt's tools already use
/// is shown, and the frame is not saved as an artifact.
pub(crate) fn view(run_id: &str) -> Option<SimulatorView> {
    let attempt = attempt(run_id)?;
    let mut view = SimulatorView {
        status: "unavailable",
        udid: attempt.udid.clone(),
        device: attempt.name.clone(),
        app: attempt.apps.first().cloned(),
        frame: None,
        error: None,
    };
    match simctl::capture(&attempt.udid, Some(simctl::VIEW_SIZE)) {
        Ok(png) => {
            view.status = "live";
            view.frame = Some(base64::engine::general_purpose::STANDARD.encode(png));
        }
        Err(error) => view.error = Some(error),
    }
    Some(view)
}
