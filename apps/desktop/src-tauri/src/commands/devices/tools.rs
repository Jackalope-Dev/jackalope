//! The agent tools `device_app` and `device_logs`.

use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::build::{self, Product};
use super::devicectl::{self, Device};
use super::grant::{self, Grant, Need};
use super::{console, owner};
use crate::commands::bridge::ToolError;
use crate::commands::tasks::{TaskRun, TaskRuntime};

const INSTALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const QUICK_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug, Deserialize, schemars::JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AppAction {
    /// The device in use, whether it is ready, its level and this workspace's device build.
    Status,
    /// Apps installed from Xcode or Jackalope.
    Apps,
    /// Install this workspace's device build.
    Install,
    /// Launch an app with its console captured.
    Launch,
    /// Stop a running app.
    Terminate,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AppInput {
    action: AppAction,
    #[schemars(
        description = "The device's name or identifier, when several are allowed. Defaults to the device attached to this conversation."
    )]
    #[serde(default)]
    device: Option<String>,
    #[schemars(
        description = "install: an .app built for iphoneos, inside the workspace or its Xcode derived data. Defaults to the newest device build of this workspace."
    )]
    #[serde(default)]
    path: Option<String>,
    #[schemars(
        description = "launch/terminate: the app's bundle identifier. Defaults to the app last installed from this conversation, else the workspace's device build."
    )]
    #[serde(default)]
    bundle_id: Option<String>,
    #[schemars(description = "launch: arguments passed to the app.")]
    #[serde(default)]
    arguments: Vec<String>,
    #[schemars(
        description = "launch: how long to capture the console, 10 to 1800 seconds. Default 300."
    )]
    #[serde(default)]
    console_seconds: Option<u64>,
    #[schemars(
        description = "launch: how long to wait for early output before returning, 0 to 30 seconds. Default 5."
    )]
    #[serde(default)]
    wait_seconds: Option<u64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LogsInput {
    #[schemars(
        description = "The first line to read, from a previous nextLine. Omit for the latest lines."
    )]
    #[serde(default)]
    from_line: Option<u64>,
    #[schemars(description = "Lines to return, 1 to 1000. Default 200.")]
    #[serde(default)]
    limit: Option<usize>,
}

fn denied(message: String) -> ToolError {
    ToolError::denied(message)
}

struct Context {
    key: String,
    grant: Grant,
}

fn context(
    runtime: &TaskRuntime,
    run: &TaskRun,
    named: Option<&str>,
    need: Need,
) -> Result<Context, ToolError> {
    if let Some(reason) = devicectl::unavailable() {
        return Err(ToolError::refused(reason));
    }
    let key = owner(run).ok_or_else(|| denied(grant::no_device()))?;
    let remembered = grant::remembered(
        &grant::store_path(&runtime.preferences_directory()),
        &run.project_id,
    );
    let grant =
        grant::resolve(grant::attached(&key).as_ref(), &remembered, named, need).map_err(denied)?;
    Ok(Context { key, grant })
}

/// The granted device as `devicectl` lists it now, refusing one that is not ready.
fn ready(grant: &Grant) -> Result<Device, ToolError> {
    let devices = super::list().map_err(ToolError::failed)?;
    let device = devices
        .into_iter()
        .find(|device| device.id == grant.device_id)
        .ok_or_else(|| {
            ToolError::refused(format!(
                "{} is not connected to this Mac. Ask the person to connect and unlock it.",
                grant.name
            ))
        })?;
    if let Some(problem) = &device.problem {
        return Err(ToolError::refused(format!(
            "{} is not ready: {problem}",
            device.name
        )));
    }
    Ok(device)
}

fn derived(runtime: &TaskRuntime, run: &TaskRun) -> Vec<PathBuf> {
    build::derived_folders(
        Path::new(&run.workspace),
        &super::own_derived_data(runtime, &run.workspace),
        build::xcode_derived_data().as_deref(),
    )
}

fn team(runtime: &TaskRuntime, run: &TaskRun) -> Option<String> {
    crate::commands::project_registry::record(runtime, &run.project_id)
        .and_then(|project| project.development_team)
}

pub fn app(runtime: &TaskRuntime, run: &TaskRun, input: AppInput) -> Result<Value, ToolError> {
    let need = match input.action {
        AppAction::Status | AppAction::Apps => Need::See,
        _ => Need::Control,
    };
    let Context { key, grant } = context(runtime, run, input.device.as_deref(), need)?;
    match input.action {
        AppAction::Status => status(runtime, run, &key, &grant),
        AppAction::Apps => {
            let device = ready(&grant)?;
            let result = devicectl::run(
                |json| devicectl::apps_args(&device.id, json),
                QUICK_TIMEOUT,
                &device.name,
                "list apps",
            )
            .map_err(ToolError::refused)?;
            Ok(json!({ "device": device.name, "apps": devicectl::parse_apps(&result) }))
        }
        AppAction::Install => install(runtime, run, &key, &grant, input.path.as_deref()),
        AppAction::Launch => launch(runtime, run, &key, &grant, input),
        AppAction::Terminate => terminate(runtime, run, &key, &grant, input.bundle_id.as_deref()),
    }
}

fn status(
    runtime: &TaskRuntime,
    run: &TaskRun,
    key: &str,
    grant: &Grant,
) -> Result<Value, ToolError> {
    let device = super::list()
        .map_err(ToolError::failed)?
        .into_iter()
        .find(|device| device.id == grant.device_id);
    let product = build::default_product(&derived(runtime, run)).map(|path| Product::read(&path));
    let destination = device
        .as_ref()
        .map_or_else(|| format!("id={}", grant.device_id), Device::destination);
    let problem = product
        .as_ref()
        .and_then(|product| product.problem(&destination, team(runtime, run).as_deref()));
    Ok(json!({
        "device": device,
        "connected": device.is_some(),
        "level": grant.level,
        "allowedForProject": grant.remembered,
        "destination": destination,
        "build": product,
        "buildProblem": problem,
        "lastInstall": super::last_install(key),
        "console": console::session(key).map(|session| json!({
            "bundleId": session.bundle_id,
            "running": session.running(),
            "ended": session.ended(),
        })),
    }))
}

fn install(
    runtime: &TaskRuntime,
    run: &TaskRun,
    key: &str,
    grant: &Grant,
    path: Option<&str>,
) -> Result<Value, ToolError> {
    let device = ready(grant)?;
    let folders = derived(runtime, run);
    let app = match path {
        Some(path) => build::allowed_product(Path::new(path), Path::new(&run.workspace), &folders)
            .map_err(ToolError::invalid)?,
        None => build::default_product(&folders).ok_or_else(|| {
            ToolError::refused(format!(
                "No device build of this workspace was found. Build it first: xcodebuild -scheme <scheme> -destination {} -allowProvisioningUpdates build, then call install again or pass its .app as path.",
                device.destination()
            ))
        })?,
    };
    let product = Product::read(&app);
    if let Some(problem) = product.problem(&device.destination(), team(runtime, run).as_deref()) {
        return Err(ToolError::refused(problem));
    }
    let result = devicectl::run(
        |json| devicectl::install_args(&device.id, &app, json),
        INSTALL_TIMEOUT,
        &device.name,
        "install the app",
    )
    .map_err(ToolError::refused)?;
    let bundle = devicectl::installed_bundle(&result).or(product.bundle_id.clone());
    if let Some(bundle) = &bundle {
        super::record_install(key, &device.id, bundle);
    }
    Ok(json!({
        "installed": bundle,
        "device": device.name,
        "path": app,
    }))
}

/// The app a launch or terminate means.
fn bundle_for(
    runtime: &TaskRuntime,
    run: &TaskRun,
    key: &str,
    device: &str,
    given: Option<&str>,
) -> Result<String, ToolError> {
    if let Some(bundle) = given.map(str::trim).filter(|bundle| !bundle.is_empty()) {
        return Ok(bundle.to_owned());
    }
    if let Some(install) = super::last_install(key).filter(|install| install.device_id == device) {
        return Ok(install.bundle_id);
    }
    build::default_product(&derived(runtime, run))
        .and_then(|path| Product::read(&path).bundle_id)
        .ok_or_else(|| {
            ToolError::invalid(
                "Name the app with bundle_id, or install the workspace's build first.",
            )
        })
}

fn launch(
    runtime: &TaskRuntime,
    run: &TaskRun,
    key: &str,
    grant: &Grant,
    input: AppInput,
) -> Result<Value, ToolError> {
    let device = ready(grant)?;
    let bundle = bundle_for(runtime, run, key, &device.id, input.bundle_id.as_deref())?;
    let seconds = input
        .console_seconds
        .unwrap_or(300)
        .clamp(10, console::MAX_SECONDS);
    let wait = input.wait_seconds.unwrap_or(5).min(30);
    let session = console::launch(
        key,
        &device.id,
        &device.name,
        &bundle,
        input.arguments,
        seconds,
        super::changed(key),
    );
    session.wait(Duration::from_secs(wait));
    let ended = session.ended();
    if let Some(ended) = ended.as_ref().filter(|ended| ended.failed) {
        return Err(ToolError::refused(ended.message.clone()));
    }
    let (lines, first, _) = session
        .log
        .lock()
        .map(|log| log.read(None, 50))
        .unwrap_or_default();
    Ok(json!({
        "launched": bundle,
        "device": device.name,
        "running": ended.is_none(),
        "ended": ended,
        "consoleSeconds": seconds,
        "output": lines,
        "firstLine": first,
        "note": "Console output (stdout and stderr) is captured while devicectl stays attached; read more with device_logs. Unified logging (os_log, Logger) is not captured.",
    }))
}

fn terminate(
    runtime: &TaskRuntime,
    run: &TaskRun,
    key: &str,
    grant: &Grant,
    given: Option<&str>,
) -> Result<Value, ToolError> {
    let device = ready(grant)?;
    let bundle = bundle_for(runtime, run, key, &device.id, given)?;
    let captured = console::session(key)
        .filter(|session| session.bundle_id == bundle && session.device_id == device.id);
    let mut pids: Vec<u64> = captured
        .as_ref()
        .and_then(|session| *session.pid.lock().ok()?)
        .into_iter()
        .collect();
    if pids.is_empty() {
        let apps = devicectl::run(
            |json| devicectl::apps_args(&device.id, json),
            QUICK_TIMEOUT,
            &device.name,
            "list apps",
        )
        .map_err(ToolError::refused)?;
        let url = devicectl::parse_apps(&apps)
            .into_iter()
            .find(|app| app.bundle_id == bundle)
            .and_then(|app| app.url)
            .ok_or_else(|| {
                ToolError::refused(format!("{bundle} is not installed on {}.", device.name))
            })?;
        let processes = devicectl::run(
            |json| devicectl::processes_args(&device.id, json),
            QUICK_TIMEOUT,
            &device.name,
            "list processes",
        )
        .map_err(ToolError::refused)?;
        pids = devicectl::pids_from(&processes, &url);
    }
    if let Some(session) = &captured {
        session.stop();
    }
    if pids.is_empty() {
        return Ok(
            json!({ "terminated": false, "bundleId": bundle, "device": device.name, "message": format!("{bundle} is not running on {}.", device.name) }),
        );
    }
    for pid in &pids {
        devicectl::run(
            |json| devicectl::terminate_args(&device.id, *pid, json),
            QUICK_TIMEOUT,
            &device.name,
            "stop the app",
        )
        .map_err(ToolError::refused)?;
    }
    Ok(json!({ "terminated": true, "bundleId": bundle, "device": device.name, "pids": pids }))
}

pub fn logs(runtime: &TaskRuntime, run: &TaskRun, input: LogsInput) -> Result<Value, ToolError> {
    let Context { key, grant } = context(runtime, run, None, Need::See)?;
    let session = console::session(&key)
        .filter(|session| session.device_id == grant.device_id)
        .ok_or_else(|| {
            ToolError::refused(format!(
                "Nothing was launched on {} from this conversation yet. Launch an app with device_app first.",
                grant.name
            ))
        })?;
    let limit = input.limit.unwrap_or(200).clamp(1, 1000);
    let (lines, first, dropped) = session
        .log
        .lock()
        .map(|log| log.read(input.from_line, limit))
        .unwrap_or_default();
    let next = first + lines.len() as u64;
    Ok(json!({
        "device": session.device,
        "bundleId": session.bundle_id,
        "startedAt": session.started_at,
        "running": session.running(),
        "ended": session.ended(),
        "firstLine": first,
        "nextLine": next,
        "skippedOlderLines": dropped,
        "lines": lines,
    }))
}
