//! `xcrun devicectl` commands and the JSON they write with `--json-output`.
//!
//! Each command's result is read from its JSON file: `info.outcome` says whether it
//! worked, `result` holds what it returns and `error` an NSError with its
//! `NSUnderlyingError` chain. Human-readable output is never parsed; when no JSON is
//! written, the command's own text is passed on as the error.

use serde::Serialize;
use serde_json::Value;
use std::ffi::OsString;
use std::path::Path;
use std::time::Duration;

use super::super::{process_control, xcode};

/// How the device reaches this Mac.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Connection {
    Usb,
    Network,
    /// Reachable, over a transport `devicectl` did not name.
    Available,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeveloperMode {
    Enabled,
    Disabled,
    Unknown,
}

/// A physical iPhone, iPad or other device paired with this Mac. Simulators are left out.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    /// CoreDevice's identifier, which every `devicectl` command accepts.
    pub id: String,
    /// The hardware UDID that xcodebuild destinations name.
    pub udid: Option<String>,
    pub name: String,
    pub model: Option<String>,
    /// `iPhone`, `iPad` and so on.
    pub kind: Option<String>,
    pub os_version: Option<String>,
    pub connection: Connection,
    pub paired: bool,
    pub developer_mode: DeveloperMode,
    /// The developer disk image services are mounted. `devicectl` mounts them on
    /// demand, so this is information rather than a requirement.
    pub ddi_services: bool,
    /// Why apps cannot be installed or launched right now; None when they can.
    pub problem: Option<String>,
}

impl Device {
    /// The xcodebuild destination for this device.
    pub fn destination(&self) -> String {
        format!("id={}", self.udid.as_deref().unwrap_or(&self.id))
    }

    /// Whether `name` names this device: its name, identifier or UDID.
    pub fn named(&self, name: &str) -> bool {
        let name = name.trim();
        !name.is_empty()
            && (self.name.eq_ignore_ascii_case(name)
                || self.id.eq_ignore_ascii_case(name)
                || self
                    .udid
                    .as_deref()
                    .is_some_and(|udid| udid.eq_ignore_ascii_case(name)))
    }
}

/// An app installed on a device.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct App {
    pub bundle_id: String,
    pub name: Option<String>,
    pub version: Option<String>,
    /// Installed from Xcode or Jackalope rather than the App Store.
    pub developer: bool,
    /// Where the bundle lives on the device, which running processes' executables start with.
    #[serde(skip)]
    pub url: Option<String>,
}

fn text(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

/// The first present string among the current `properties` field and its deprecated twin.
fn either(values: &[&Value]) -> Option<String> {
    values.iter().find_map(|value| text(value))
}

/// Physical devices in `devicectl list devices` output, ready ones first.
pub fn parse_devices(output: &Value) -> Vec<Device> {
    let mut devices: Vec<Device> = output["result"]["devices"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(device)
        .collect();
    devices.sort_by(|a, b| {
        (a.problem.is_some(), a.name.to_lowercase())
            .cmp(&(b.problem.is_some(), b.name.to_lowercase()))
    });
    devices
}

fn device(value: &Value) -> Option<Device> {
    let properties = &value["properties"];
    let hardware = &properties["hardware"];
    let legacy_hardware = &value["hardwareProperties"];
    let reality = either(&[&hardware["reality"], &legacy_hardware["reality"]]);
    if reality.as_deref() != Some("physical") || value["visibilityClass"] == "simulators" {
        return None;
    }
    let id = text(&value["identifier"])?;
    let connection = &properties["connection"];
    let legacy_connection = &value["connectionProperties"];
    let paired = either(&[
        &connection["pairingState"],
        &legacy_connection["pairingState"],
    ])
    .as_deref()
        == Some("paired");
    let state = either(&[&connection["state"], &legacy_connection["tunnelState"]]);
    let transport = either(&[
        &connection["transportType"],
        &legacy_connection["transportType"],
    ]);
    let connection = match (state.as_deref(), transport.as_deref()) {
        (Some("unavailable") | None, _) => Connection::Unavailable,
        (_, Some("wired")) => Connection::Usb,
        (_, Some("localNetwork" | "network")) => Connection::Network,
        _ => Connection::Available,
    };
    let developer_mode = match value["deviceProperties"]["developerModeStatus"].as_str() {
        Some("enabled") => DeveloperMode::Enabled,
        Some("disabled") => DeveloperMode::Disabled,
        _ => {
            let status = &properties["state"]["developerModeStatus"];
            if status.get("enabled").is_some() {
                DeveloperMode::Enabled
            } else if status.get("disabled").is_some() {
                DeveloperMode::Disabled
            } else {
                DeveloperMode::Unknown
            }
        }
    };
    let model = either(&[
        &hardware["marketingName"],
        &legacy_hardware["marketingName"],
    ]);
    let name = either(&[
        &properties["state"]["name"],
        &value["deviceProperties"]["name"],
    ])
    .or_else(|| model.clone())
    .unwrap_or_else(|| id.clone());
    let problem = if !paired {
        Some("Not paired with this Mac. Connect it with a cable, unlock it and tap Trust.".into())
    } else if connection == Connection::Unavailable {
        Some("Not connected. Connect it with a cable, or turn on Connect via network for it in Xcode's Devices and Simulators window, then unlock it.".into())
    } else if developer_mode == DeveloperMode::Disabled {
        Some("Developer Mode is off. On the device, open Settings → Privacy & Security → Developer Mode, turn it on and restart.".into())
    } else {
        None
    };
    Some(Device {
        udid: either(&[&hardware["udid"], &legacy_hardware["udid"]]),
        kind: either(&[&hardware["deviceType"], &legacy_hardware["deviceType"]]),
        os_version: either(&[
            &properties["software"]["osVersionNumber"]["stringValue"],
            &value["deviceProperties"]["osVersionNumber"],
        ]),
        ddi_services: value["deviceProperties"]["ddiServicesAvailable"] == true,
        id,
        name,
        model,
        connection,
        paired,
        developer_mode,
        problem,
    })
}

/// Apps in `devicectl device info apps` output, developer builds first.
pub fn parse_apps(result: &Value) -> Vec<App> {
    let mut apps: Vec<App> = result["apps"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|app| {
            Some(App {
                bundle_id: text(&app["bundleIdentifier"])?,
                name: text(&app["name"]),
                version: text(&app["version"]),
                developer: app["builtByDeveloper"] == true,
                url: text(&app["url"]),
            })
        })
        .collect();
    apps.sort_by(|a, b| (!a.developer, &a.bundle_id).cmp(&(!b.developer, &b.bundle_id)));
    apps
}

/// The bundle identifier `devicectl device install app` installed.
pub fn installed_bundle(result: &Value) -> Option<String> {
    result["installedApplications"]
        .as_array()?
        .iter()
        .find_map(|app| text(&app["bundleID"]))
}

/// The process a launch started.
pub fn launched_pid(result: &Value) -> Option<u64> {
    result["process"]["processIdentifier"].as_u64()
}

/// How a launched app ended, from a `--console` launch's result.
pub fn termination(result: &Value) -> Option<String> {
    let ended = &result["terminationResult"];
    if let Some(code) = ended["exitCode"].as_i64() {
        return Some(format!("The app exited with code {code}."));
    }
    ended["terminatingSignal"]
        .as_i64()
        .map(|signal| format!("The app ended with signal {signal}."))
}

/// Processes running from the app bundle at `url`, from `devicectl device info processes`.
pub fn pids_from(result: &Value, url: &str) -> Vec<u64> {
    let url = url.trim_end_matches('/');
    result["runningProcesses"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|process| {
            process["executable"]
                .as_str()
                .is_some_and(|executable| executable.starts_with(&format!("{url}/")))
        })
        .filter_map(|process| process["processIdentifier"].as_u64())
        .collect()
}

// ---- commands ----

fn args(parts: &[&str], json: &Path) -> Vec<OsString> {
    let mut args: Vec<OsString> = parts.iter().map(OsString::from).collect();
    args.push("--json-output".into());
    args.push(json.into());
    args
}

pub fn list_args(json: &Path) -> Vec<OsString> {
    args(&["list", "devices"], json)
}

pub fn apps_args(device: &str, json: &Path) -> Vec<OsString> {
    args(&["device", "info", "apps", "--device", device], json)
}

pub fn processes_args(device: &str, json: &Path) -> Vec<OsString> {
    args(&["device", "info", "processes", "--device", device], json)
}

pub fn install_args(device: &str, app: &Path, json: &Path) -> Vec<OsString> {
    let mut args = args(&["device", "install", "app", "--device", device], json);
    args.push(app.into());
    args
}

/// A launch that replaces a running copy. With `console`, `devicectl` relays the app's
/// standard output and error and waits for it to exit.
pub fn launch_args(
    device: &str,
    bundle: &str,
    console: bool,
    arguments: &[String],
    json: &Path,
) -> Vec<OsString> {
    let mut parts = vec![
        "device",
        "process",
        "launch",
        "--device",
        device,
        "--terminate-existing",
    ];
    if console {
        parts.push("--console");
    }
    let mut args = args(&parts, json);
    args.push(bundle.into());
    if !arguments.is_empty() {
        args.push("--".into());
        args.extend(arguments.iter().map(OsString::from));
    }
    args
}

pub fn terminate_args(device: &str, pid: u64, json: &Path) -> Vec<OsString> {
    args(
        &[
            "device",
            "process",
            "terminate",
            "--device",
            device,
            "--pid",
            &pid.to_string(),
        ],
        json,
    )
}

/// A fresh path for one command's `--json-output`.
pub fn json_path() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("jackalope-devicectl-{}.json", uuid::Uuid::new_v4()))
}

/// Reads and removes a command's JSON output.
pub fn take_json(path: &Path) -> Option<Value> {
    let value = std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok());
    let _ = std::fs::remove_file(path);
    value
}

/// The command's result when it succeeded, else why it failed.
pub fn outcome(output: &Value, device: &str, action: &str) -> Result<Value, String> {
    if output["info"]["outcome"] == "success" {
        return Ok(output["result"].clone());
    }
    Err(describe_error(&output["error"], device, action))
}

pub fn unavailable() -> Option<String> {
    if !cfg!(target_os = "macos") {
        return Some("iPhones and iPads need a Mac with Xcode.".into());
    }
    xcode::toolchain().is_none().then(|| {
        "Xcode is not installed. Install Xcode 15 or later to use iPhones and iPads.".into()
    })
}

/// Runs one `devicectl` command and returns its `result`.
pub fn run(
    args: impl FnOnce(&Path) -> Vec<OsString>,
    timeout: Duration,
    device: &str,
    action: &str,
) -> Result<Value, String> {
    if let Some(reason) = unavailable() {
        return Err(reason);
    }
    let json = json_path();
    let mut command = xcode::xcrun("devicectl");
    command.args(args(&json));
    let ran = process_control::run(command, timeout);
    let output = take_json(&json);
    let ran = ran.map_err(|error| format!("devicectl could not start: {error}"))?;
    if let Some(output) = output {
        return outcome(&output, device, action);
    }
    if ran.timed_out {
        return Err(format!(
            "devicectl did not {action} within {} seconds. Check that {device} is unlocked and connected.",
            timeout.as_secs()
        ));
    }
    let said = [ran.stderr.trim(), ran.stdout.trim()]
        .into_iter()
        .find(|text| !text.is_empty())
        .unwrap_or("no output");
    Err(format!(
        "devicectl could not {action}: {}",
        said.chars().take(600).collect::<String>()
    ))
}

// ---- errors ----

struct Cause {
    domain: String,
    code: i64,
    text: String,
}

fn causes(error: &Value, found: &mut Vec<Cause>) {
    if !error.is_object() || found.len() >= 8 {
        return;
    }
    let info = &error["userInfo"];
    let text = [
        "NSLocalizedDescription",
        "NSLocalizedFailureReason",
        "NSLocalizedRecoverySuggestion",
    ]
    .iter()
    .filter_map(|key| text(&info[*key]["string"]))
    .collect::<Vec<_>>()
    .join(" ");
    found.push(Cause {
        domain: error["domain"].as_str().unwrap_or_default().to_owned(),
        code: error["code"].as_i64().unwrap_or_default(),
        text,
    });
    causes(&info["NSUnderlyingError"]["error"], found);
}

/// A specific, actionable message for a `devicectl` NSError, followed by what
/// `devicectl` itself said.
pub fn describe_error(error: &Value, device: &str, action: &str) -> String {
    let mut found = Vec::new();
    causes(error, &mut found);
    let Some(first) = found.first() else {
        return format!("devicectl could not {action} on {device} and gave no reason.");
    };
    let said = found
        .iter()
        .map(|cause| cause.text.as_str())
        .find(|text| !text.is_empty())
        .unwrap_or("no description");
    let detail = format!("devicectl: {said} ({} {})", first.domain, first.code);
    let all = found
        .iter()
        .map(|cause| cause.text.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ");
    let core = |code: i64| {
        found
            .iter()
            .any(|cause| cause.domain == "com.apple.dt.CoreDeviceError" && cause.code == code)
    };
    let specific = if all.contains("developer mode") {
        format!("Developer Mode is off on {device}. On the device, open Settings → Privacy & Security → Developer Mode, turn it on and restart.")
    } else if all.contains("locked") || all.contains("passcode") {
        format!("{device} is locked. Unlock it and keep it unlocked while Jackalope installs or launches apps.")
    } else if all.contains("trust") || all.contains("not paired") || all.contains("pairing") {
        format!(
            "{device} does not trust this Mac. Connect it with a cable, unlock it and tap Trust."
        )
    } else if all.contains("applicationverificationfailed")
        || all.contains("provisioning profile")
        || all.contains("code signature")
        || all.contains("not signed")
    {
        format!("{device} refused the app's signature. Build it signed for this device: set a development team (Project settings → Commands → Development team) and build with -allowProvisioningUpdates so Xcode registers the device and creates a profile.")
    } else if all.contains("minimumosversion") || all.contains("os version too low") {
        format!("The app needs a newer iOS than {device} runs. Lower the deployment target or update the device.")
    } else if core(1000) {
        format!("{device} was not found. Connect it, unlock it and refresh the device list.")
    } else if core(4016) {
        format!("{device} is not reachable. Connect it with a cable or join the same network as this Mac, then unlock it.")
    } else if core(10014) {
        "The process had already ended.".to_owned()
    } else {
        format!("Could not {action} on {device}.")
    };
    format!("{specific} {detail}")
}
