//! A Simulator of its own for each task workspace of an iOS project.
//!
//! A workspace gets one device, created from the project's base device type
//! and runtime and named `Jackalope <short task id>`, so a continuation or
//! retry in the same workspace finds the app state it left. Devices boot
//! headless (`simctl bootstatus -b`); Jackalope never opens a Simulator
//! window. At most [`pool::concurrency`] of them are booted at once; idle ones
//! shut down after [`IDLE`], all of them when the app quits, and a device is
//! deleted with its workspace. Every device Jackalope creates is recorded in a
//! ledger, and only those are ever shut down or deleted.
//!
//! Other modules use [`ensure`] for a booted device, [`assigned`] to look one
//! up without creating it, and [`simctl`] to drive it.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};

use super::tasks::TaskRuntime;
use super::xcode;

pub mod ledger;
pub mod pool;
pub mod simctl;

pub use simctl::SimulatorBase;

/// How long a booted device with no running task or Jackalope command waits
/// before it is shut down.
const IDLE: Duration = Duration::from_secs(10 * 60);
const SWEEP: Duration = Duration::from_secs(60);
/// The longest a boot waits for a free slot before giving up.
const QUEUE_TIMEOUT: Duration = Duration::from_secs(300);
/// The name every device Jackalope creates starts with.
pub const NAME_PREFIX: &str = "Jackalope ";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub udid: String,
    pub name: String,
    /// Runtime identifier, such as `com.apple.CoreSimulator.SimRuntime.iOS-27-2`.
    pub runtime: String,
    /// Device type identifier, such as `com.apple.CoreSimulator.SimDeviceType.iPhone-17`.
    pub device_type: String,
    /// `Booted`, `Shutdown`, `Booting` or another `simctl` state.
    pub state: String,
}

impl Device {
    /// The variables processes use to reach this device.
    pub fn environment(&self) -> [(&'static str, String); 2] {
        [
            ("JACKALOPE_SIMULATOR_UDID", self.udid.clone()),
            ("JACKALOPE_SIMULATOR_NAME", self.name.clone()),
        ]
    }

    /// What an agent is told about its device.
    pub fn guidance(&self) -> String {
        format!(
            "\nThis task has its own iOS Simulator, {} ({}), UDID in $JACKALOPE_SIMULATOR_UDID. Build, install and test on it with xcodebuild -destination \"id=$JACKALOPE_SIMULATOR_UDID\" or xcrun simctl <command> \"$JACKALOPE_SIMULATOR_UDID\". It runs without a window; do not open Simulator or DeviceHub, boot or erase other devices, or create new ones. App data on it persists across follow-ups to this task. If a build stops because a Swift macro or package plugin \"must be enabled before it can be used\", do not pass -skipMacroValidation or -skipPackagePluginValidation or change Xcode's trust settings; ask the person with request_human_action to open the project in Xcode once and choose Trust & Enable.\n",
            self.name,
            short_runtime(&self.runtime)
        )
    }
}

/// `com.apple.CoreSimulator.SimRuntime.iOS-27-2` as `iOS 27.2`.
fn short_runtime(identifier: &str) -> String {
    let tail = identifier.rsplit('.').next().unwrap_or(identifier);
    match tail.split_once('-') {
        Some((platform, version)) => format!("{platform} {}", version.replace('-', ".")),
        None => tail.to_string(),
    }
}

/// `simctl` through the resolved toolchain, for driving a device:
/// `simctl().args(["io", &device.udid, "screenshot", path])`.
pub fn simctl() -> Command {
    xcode::xcrun("simctl")
}

struct Service {
    root: PathBuf,
    runtime: TaskRuntime,
}

static SERVICE: OnceLock<Service> = OnceLock::new();
/// Serializes ledger changes, device creation and boot admission.
static LOCK: Mutex<()> = Mutex::new(());
static BOOTING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);
/// Devices a Jackalope command is using right now, with how many uses.
static IN_USE: LazyLock<Mutex<HashMap<String, usize>>> = LazyLock::new(Default::default);
static LAST_ACTIVE: LazyLock<Mutex<HashMap<String, Instant>>> = LazyLock::new(Default::default);

fn lock() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|poison| poison.into_inner())
}

fn touch(udid: &str) {
    if let Ok(mut active) = LAST_ACTIVE.lock() {
        active.insert(udid.to_string(), Instant::now());
    }
}

fn service() -> Result<&'static Service, String> {
    SERVICE
        .get()
        .ok_or_else(|| "Task Simulators are not available in this process.".into())
}

/// Starts the ledger under `root`, cleans up after earlier sessions and
/// shuts down idle devices from then on. Does nothing until a device exists,
/// so projects without one never run `simctl`.
pub fn initialize(root: PathBuf, runtime: TaskRuntime) {
    if SERVICE.set(Service { root, runtime }).is_err() {
        return;
    }
    if !cfg!(target_os = "macos") {
        return;
    }
    let _ = std::thread::Builder::new()
        .name("simulators".into())
        .spawn(|| {
            let _ = recover();
            loop {
                std::thread::sleep(SWEEP);
                let _ = sweep();
            }
        });
}

fn workspace_key(workspace: &str) -> String {
    dunce::canonicalize(workspace)
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| workspace.trim_end_matches('/').to_string())
}

/// Whether an agent in `workspace` gets a Simulator: the project is an Xcode
/// project that targets iOS.
pub fn needed_by_agent(workspace: &str) -> bool {
    xcode::project::find(Path::new(workspace)).is_some_and(|project| project.ios)
}

/// Whether a setup or check command gets a Simulator: it names
/// `$JACKALOPE_SIMULATOR_UDID`, or it runs Apple's build tools in an iOS
/// project. A JavaScript check in a React Native app does not.
pub fn needed_by_command(workspace: &str, command: &str) -> bool {
    command.contains("JACKALOPE_SIMULATOR_")
        || (["xcodebuild", "fastlane", "tuist test", "simctl"]
            .iter()
            .any(|tool| command.contains(tool))
            && needed_by_agent(workspace))
}

/// The device assigned to `workspace`, with its current state, if any.
pub fn assigned(workspace: &str) -> Option<Device> {
    let service = service().ok()?;
    let key = workspace_key(workspace);
    let entry = ledger::read(&service.root)
        .ok()?
        .for_workspace(&key)?
        .clone();
    xcode::toolchain()?;
    let state = simctl::devices()
        .ok()?
        .into_iter()
        .find(|device| device.udid == entry.udid)?
        .state;
    Some(device(&entry, state))
}

/// The device assigned to a task's workspace, if any.
pub fn assigned_to_run(runtime: &TaskRuntime, run_id: &str) -> Option<Device> {
    assigned(&runtime.run_snapshot(run_id)?.workspace)
}

fn device(entry: &ledger::Entry, state: String) -> Device {
    Device {
        udid: entry.udid.clone(),
        name: entry.name.clone(),
        runtime: entry.runtime.clone(),
        device_type: entry.device_type.clone(),
        state,
    }
}

/// The run's workspace, project and base device.
struct Request {
    run_id: String,
    workspace: String,
    project_id: String,
    base: Option<SimulatorBase>,
}

impl Request {
    fn for_run(runtime: &TaskRuntime, run_id: &str) -> Result<Self, String> {
        let run = runtime.run_snapshot(run_id).ok_or("Task not found")?;
        let base = super::project_registry::record(runtime, &run.project_id)
            .and_then(|project| project.simulator);
        Ok(Self {
            run_id: run.id,
            workspace: run.workspace,
            project_id: run.project_id,
            base,
        })
    }
}

/// The task's device, created if the workspace has none yet, without
/// booting it. Fast enough to run before an agent starts.
pub fn assign(runtime: &TaskRuntime, run_id: &str) -> Result<Device, String> {
    assign_for(&Request::for_run(runtime, run_id)?)
}

fn assign_for(request: &Request) -> Result<Device, String> {
    let service = service()?;
    if xcode::toolchain().is_none() {
        return Err(xcode::readiness_issue(Path::new(&request.workspace))
            .unwrap_or_else(|| "A Simulator needs a full Xcode, and none is installed.".into()));
    }
    let key = workspace_key(&request.workspace);
    let _guard = lock();
    let mut saved = ledger::read(&service.root)?;
    let devices = simctl::devices()?;
    if let Some(entry) = saved.for_workspace(&key).cloned() {
        if let Some(listed) = devices.iter().find(|device| device.udid == entry.udid) {
            touch(&entry.udid);
            return Ok(device(&entry, listed.state.clone()));
        }
        saved.remove(&entry.udid);
        ledger::write(&service.root, &saved)?;
    }
    let catalog = simctl::catalog()?;
    let base = request
        .base
        .clone()
        .filter(|base| catalog.supports(base))
        .or_else(|| catalog.default_base())
        .ok_or(
            "No iOS Simulator runtime is installed. Add one in Xcode under Settings → Components.",
        )?;
    let short: String = request
        .run_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    let name = format!("{NAME_PREFIX}{short}");
    let udid = simctl::create(&name, &base)?;
    let entry = ledger::Entry {
        udid,
        name,
        workspace: key,
        project_id: request.project_id.clone(),
        runtime: base.runtime,
        device_type: base.device_type,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    saved.devices.push(entry.clone());
    if let Err(error) = ledger::write(&service.root, &saved) {
        // Unrecorded devices would never be cleaned up, so remove it now.
        let _ = simctl::delete(&entry.udid);
        return Err(error);
    }
    touch(&entry.udid);
    Ok(device(&entry, "Shutdown".into()))
}

/// Marks a device in use by a Jackalope command, so it is neither shut down
/// for being idle nor evicted to make room.
pub struct InUse(String);

impl InUse {
    pub fn new(device: &Device) -> Self {
        if let Ok(mut uses) = IN_USE.lock() {
            *uses.entry(device.udid.clone()).or_default() += 1;
        }
        touch(&device.udid);
        Self(device.udid.clone())
    }
}

impl Drop for InUse {
    fn drop(&mut self) {
        if let Ok(mut uses) = IN_USE.lock() {
            if let Some(count) = uses.get_mut(&self.0) {
                *count -= 1;
                if *count == 0 {
                    uses.remove(&self.0);
                }
            }
        }
        touch(&self.0);
    }
}

/// The task's device, created and booted. Waits for a free slot when
/// [`pool::concurrency`] devices are busy, until `canceled` or the queue
/// timeout.
pub fn ensure(
    runtime: &TaskRuntime,
    run_id: &str,
    canceled: impl Fn() -> bool,
) -> Result<Device, String> {
    let device = assign(runtime, run_id)?;
    boot(&device, canceled)
}

/// Boots an assigned device within the pool's limit.
pub fn boot(device: &Device, canceled: impl Fn() -> bool) -> Result<Device, String> {
    let service = service()?;
    let _use = InUse::new(device);
    let started = Instant::now();
    loop {
        if canceled() {
            return Err("The task stopped before its Simulator booted.".into());
        }
        if started.elapsed() >= QUEUE_TIMEOUT {
            return Err(format!(
                "Timed out waiting for one of the {} Simulators already running to become free. Set JACKALOPE_SIMULATOR_CONCURRENCY to allow more.",
                pool::concurrency()
            ));
        }
        let busy = busy_workspaces(&service.runtime);
        let decision = {
            let _guard = lock();
            let saved = ledger::read(&service.root)?;
            let listed = simctl::devices()?;
            let booting = BOOTING.lock().map(|set| set.clone()).unwrap_or_default();
            let mut booted: Vec<&ledger::Entry> = saved
                .devices
                .iter()
                .filter(|entry| {
                    booting.contains(&entry.udid)
                        || listed
                            .iter()
                            .any(|device| device.udid == entry.udid && device.state != "Shutdown")
                })
                .collect();
            let active = LAST_ACTIVE
                .lock()
                .map(|map| map.clone())
                .unwrap_or_default();
            booted.sort_by_key(|entry| active.get(&entry.udid).copied());
            let booted_ids: Vec<String> = booted.iter().map(|entry| entry.udid.clone()).collect();
            let ready = listed
                .iter()
                .any(|listed| listed.udid == device.udid && listed.state == "Booted");
            let decision = if ready {
                pool::Admit::Ready
            } else {
                pool::admit(&device.udid, pool::concurrency(), &booted_ids, |udid| {
                    idle(udid, &saved, &busy, &booting)
                })
            };
            if decision == pool::Admit::Boot {
                if let Ok(mut set) = BOOTING.lock() {
                    set.insert(device.udid.clone());
                }
            }
            decision
        };
        match decision {
            pool::Admit::Ready => {
                touch(&device.udid);
                return Ok(Device {
                    state: "Booted".into(),
                    ..device.clone()
                });
            }
            pool::Admit::Boot => {
                let result = simctl::boot(&device.udid, &canceled);
                if let Ok(mut set) = BOOTING.lock() {
                    set.remove(&device.udid);
                }
                result?;
                touch(&device.udid);
                return Ok(Device {
                    state: "Booted".into(),
                    ..device.clone()
                });
            }
            pool::Admit::Evict(udid) => {
                let _ = simctl::shutdown(&udid);
            }
            pool::Admit::Wait => std::thread::sleep(Duration::from_secs(1)),
        }
    }
}

/// A device for a command in a disposable workspace, deleted when dropped.
pub struct Disposable {
    pub device: Device,
    identity: String,
    _use: Option<InUse>,
}

impl Disposable {
    pub fn new(workspace: &str, booted: bool) -> Result<Self, String> {
        let request = Request {
            run_id: format!("check{}", uuid::Uuid::new_v4().simple()),
            workspace: workspace.to_string(),
            project_id: String::new(),
            base: None,
        };
        let mut disposable = Self {
            device: assign_for(&request)?,
            identity: workspace_key(workspace),
            _use: None,
        };
        if booted {
            disposable.device = boot(&disposable.device, || false)?;
        }
        disposable._use = Some(InUse::new(&disposable.device));
        Ok(disposable)
    }
}

impl Drop for Disposable {
    fn drop(&mut self) {
        self._use = None;
        release(std::mem::take(&mut self.identity));
    }
}

/// Boots the device in the background, for an agent that starts before it
/// is needed. The agent can wait for it with `simctl bootstatus`.
pub fn boot_in_background(device: Device, canceled: impl Fn() -> bool + Send + 'static) {
    let _ = std::thread::Builder::new()
        .name("simulator-boot".into())
        .spawn(move || {
            let _ = boot(&device, canceled);
        });
}

/// Canonical workspaces of attempts that are running now.
fn busy_workspaces(runtime: &TaskRuntime) -> HashSet<String> {
    runtime
        .integration_runs()
        .unwrap_or_default()
        .into_iter()
        .filter(|run| run.status.is_active())
        .map(|run| workspace_key(&run.workspace))
        .collect()
}

fn idle(
    udid: &str,
    saved: &ledger::Ledger,
    busy: &HashSet<String>,
    booting: &HashSet<String>,
) -> bool {
    let in_use = IN_USE
        .lock()
        .map(|uses| uses.contains_key(udid))
        .unwrap_or(true);
    let running = saved
        .devices
        .iter()
        .any(|entry| entry.udid == udid && busy.contains(&entry.workspace));
    !in_use && !running && !booting.contains(udid)
}

/// Refuses while a Jackalope command uses or boots the workspace's device,
/// for checks before a workspace is removed.
pub fn ensure_idle(workspace: &str) -> Result<(), String> {
    let Ok(service) = service() else {
        return Ok(());
    };
    let key = workspace_key(workspace);
    let Ok(saved) = ledger::read(&service.root) else {
        return Ok(());
    };
    let Some(entry) = saved.for_workspace(&key) else {
        return Ok(());
    };
    let booting = BOOTING
        .lock()
        .map(|set| set.contains(&entry.udid))
        .unwrap_or(false);
    let in_use = IN_USE
        .lock()
        .map(|uses| uses.contains_key(&entry.udid))
        .unwrap_or(false);
    if booting || in_use {
        return Err("Wait for this workspace's Simulator to finish its current command.".into());
    }
    Ok(())
}

/// The canonical form of a workspace path, taken before the folder is
/// removed so [`release`] can still match it.
pub fn workspace_identity(workspace: &str) -> String {
    workspace_key(workspace)
}

/// Releases a workspace's device when dropped, so a failing native test
/// leaves no device behind.
#[cfg(test)]
pub(crate) struct ReleaseOnDrop(pub String);

#[cfg(test)]
impl Drop for ReleaseOnDrop {
    fn drop(&mut self) {
        if std::thread::panicking() {
            for entry in service()
                .and_then(|service| ledger::read(&service.root))
                .map(|saved| saved.devices)
                .unwrap_or_default()
                .into_iter()
                .filter(|entry| entry.workspace == self.0)
            {
                delete(&entry.udid);
            }
        }
    }
}

/// Deletes the device of a removed workspace in the background. A device
/// that cannot be deleted stays in the ledger and is retried on next start.
pub fn release(identity: String) {
    let Ok(service) = service() else {
        return;
    };
    let entries: Vec<ledger::Entry> = match ledger::read(&service.root) {
        Ok(saved) => saved
            .devices
            .into_iter()
            .filter(|entry| entry.workspace == identity)
            .collect(),
        Err(_) => return,
    };
    if entries.is_empty() {
        return;
    }
    let _ = std::thread::Builder::new()
        .name("simulator-delete".into())
        .spawn(move || {
            for entry in entries {
                delete(&entry.udid);
            }
        });
}

/// Deletes one of Jackalope's devices and drops it from the ledger.
fn delete(udid: &str) {
    let Ok(service) = service() else {
        return;
    };
    let gone = simctl::delete(udid).is_ok()
        || simctl::devices().is_ok_and(|devices| devices.iter().all(|device| device.udid != udid));
    if !gone {
        return;
    }
    let _guard = lock();
    if let Ok(mut saved) = ledger::read(&service.root) {
        saved.remove(udid);
        let _ = ledger::write(&service.root, &saved);
    }
    if let Ok(mut active) = LAST_ACTIVE.lock() {
        active.remove(udid);
    }
}

/// After a restart: forgets devices that no longer exist and deletes the
/// ones whose workspace is gone.
fn recover() -> Result<(), String> {
    let service = service()?;
    let saved = ledger::read(&service.root)?;
    if saved.devices.is_empty() || xcode::toolchain().is_none() {
        return Ok(());
    }
    let listed = simctl::devices()?;
    for entry in &saved.devices {
        let exists = listed.iter().any(|device| device.udid == entry.udid);
        if !exists || !Path::new(&entry.workspace).exists() {
            delete(&entry.udid);
        }
    }
    Ok(())
}

/// Shuts down booted devices no running task or command has used for [`IDLE`].
fn sweep() -> Result<(), String> {
    let service = service()?;
    let saved = ledger::read(&service.root)?;
    if saved.devices.is_empty() || xcode::toolchain().is_none() {
        return Ok(());
    }
    let busy = busy_workspaces(&service.runtime);
    let booting = BOOTING.lock().map(|set| set.clone()).unwrap_or_default();
    let listed = simctl::devices()?;
    for entry in &saved.devices {
        let booted = listed
            .iter()
            .any(|device| device.udid == entry.udid && device.state == "Booted");
        if !booted {
            continue;
        }
        if !idle(&entry.udid, &saved, &busy, &booting) {
            touch(&entry.udid);
            continue;
        }
        let since = LAST_ACTIVE.lock().ok().map(|mut active| {
            *active
                .entry(entry.udid.clone())
                .or_insert_with(Instant::now)
        });
        if since.is_some_and(|since| since.elapsed() >= IDLE) {
            let _ = simctl::shutdown(&entry.udid);
        }
    }
    Ok(())
}

/// Shuts down Jackalope's booted devices as the app exits, waiting at most
/// a few seconds; shutdowns still running finish on their own.
pub fn shutdown_all() {
    let Ok(service) = service() else {
        return;
    };
    let Ok(saved) = ledger::read(&service.root) else {
        return;
    };
    if saved.devices.is_empty() || xcode::toolchain().is_none() {
        return;
    }
    let Ok(listed) = simctl::devices() else {
        return;
    };
    let mut children: Vec<_> = saved
        .devices
        .iter()
        .filter(|entry| {
            listed
                .iter()
                .any(|device| device.udid == entry.udid && device.state != "Shutdown")
        })
        .filter_map(|entry| simctl::shutdown_detached(&entry.udid))
        .collect();
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        children.retain_mut(|child| matches!(child.try_wait(), Ok(None)));
        if children.is_empty() {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorCatalog {
    /// Why Simulators cannot be listed here, such as no full Xcode.
    pub issue: Option<String>,
    pub runtimes: Vec<simctl::Runtime>,
    pub device_types: Vec<simctl::DeviceType>,
    pub default: Option<SimulatorBase>,
    /// Whether the project is an Xcode project that targets iOS.
    pub ios_project: bool,
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::simulators::simulator_catalog,
            commands::simulators::task_simulator,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

/// The iOS runtimes and device types a project can choose from.
#[tauri::command]
pub async fn simulator_catalog(path: String) -> Result<SimulatorCatalog, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ios_project = xcode::project::find(Path::new(&path)).is_some_and(|project| project.ios);
        let unavailable = |issue: String| SimulatorCatalog {
            issue: Some(issue),
            runtimes: vec![],
            device_types: vec![],
            default: None,
            ios_project,
        };
        if !cfg!(target_os = "macos") {
            return unavailable("iOS Simulators run only on a Mac.".into());
        }
        if xcode::toolchain().is_none() {
            return unavailable(
                xcode::readiness_issue(Path::new(&path))
                    .unwrap_or_else(|| "iOS Simulators need a full Xcode installation.".into()),
            );
        }
        match simctl::catalog() {
            Ok(catalog) => {
                let default = catalog.default_base();
                let runtimes: Vec<_> = catalog
                    .runtimes
                    .into_iter()
                    .filter(|runtime| runtime.platform == "iOS")
                    .collect();
                let device_types = catalog
                    .device_types
                    .into_iter()
                    .filter(|kind| {
                        runtimes
                            .iter()
                            .any(|runtime| runtime.device_types.contains(&kind.identifier))
                    })
                    .collect();
                SimulatorCatalog {
                    issue: None,
                    runtimes,
                    device_types,
                    default,
                    ios_project,
                }
            }
            Err(error) => unavailable(error),
        }
    })
    .await
    .map_err(|error| error.to_string())
}

/// The Simulator assigned to a task's workspace, if it has one.
#[tauri::command]
pub async fn task_simulator(
    id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<Option<Device>, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || assigned_to_run(&runtime, &id))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests;
