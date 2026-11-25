//! The `simctl` commands the tools run, built as plain values so they can be
//! checked without a simulator.

use super::super::{process_control, xcode};
use serde_json::Value;
use std::{path::Path, process::Command, time::Duration};

pub(crate) const TIMEOUT: Duration = Duration::from_secs(60);
pub(super) const BOOT_TIMEOUT: Duration = Duration::from_secs(300);
/// The longest side of a Screen view frame, in pixels.
pub(crate) const VIEW_SIZE: u32 = 1000;

/// One `xcrun simctl` invocation.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Simctl {
    pub args: Vec<String>,
    /// Extra environment, such as `SIMCTL_CHILD_` variables for a launch.
    pub env: Vec<(String, String)>,
    /// Bytes written to standard input.
    pub input: Option<Vec<u8>>,
}

fn simctl(args: &[&str]) -> Simctl {
    Simctl {
        args: args.iter().map(|arg| arg.to_string()).collect(),
        ..Simctl::default()
    }
}

pub(super) fn bootstatus(udid: &str) -> Simctl {
    simctl(&["bootstatus", udid, "-b"])
}

pub(crate) fn install(udid: &str, app: &Path) -> Simctl {
    simctl(&["install", udid, &app.to_string_lossy()])
}

pub(super) fn uninstall(udid: &str, bundle: &str) -> Simctl {
    simctl(&["uninstall", udid, bundle])
}

pub(crate) fn launch(
    udid: &str,
    bundle: &str,
    args: &[String],
    env: &[(String, String)],
) -> Simctl {
    let mut command = simctl(&["launch", "--terminate-running-process", udid, bundle]);
    command.args.extend(args.iter().cloned());
    command.env = env
        .iter()
        .map(|(name, value)| (format!("SIMCTL_CHILD_{name}"), value.clone()))
        .collect();
    command
}

pub(crate) fn terminate(udid: &str, bundle: &str) -> Simctl {
    simctl(&["terminate", udid, bundle])
}

pub(crate) fn open_url(udid: &str, url: &str) -> Simctl {
    simctl(&["openurl", udid, url])
}

pub(super) fn list_apps(udid: &str) -> Simctl {
    simctl(&["listapps", udid])
}

pub(super) fn app_container(udid: &str, bundle: &str) -> Simctl {
    simctl(&["get_app_container", udid, bundle, "app"])
}

pub(crate) fn ui(udid: &str, option: &str, value: &str) -> Simctl {
    simctl(&["ui", udid, option, value])
}

pub(super) fn location(udid: &str, coordinate: Option<(f64, f64)>) -> Simctl {
    match coordinate {
        Some((latitude, longitude)) => {
            simctl(&["location", udid, "set", &format!("{latitude},{longitude}")])
        }
        None => simctl(&["location", udid, "clear"]),
    }
}

pub(super) fn privacy(udid: &str, action: &str, service: &str, bundle: Option<&str>) -> Simctl {
    let mut command = simctl(&["privacy", udid, action, service]);
    command.args.extend(bundle.map(str::to_string));
    command
}

/// A status bar with a fixed time, full signal and a charged battery, for
/// screenshots that do not change from run to run.
pub(crate) fn clean_status_bar(udid: &str) -> Simctl {
    simctl(&[
        "status_bar",
        udid,
        "override",
        "--time",
        "9:41",
        "--dataNetwork",
        "wifi",
        "--wifiMode",
        "active",
        "--wifiBars",
        "3",
        "--cellularMode",
        "active",
        "--cellularBars",
        "4",
        "--batteryState",
        "charged",
        "--batteryLevel",
        "100",
    ])
}

pub(crate) fn clear_status_bar(udid: &str) -> Simctl {
    simctl(&["status_bar", udid, "clear"])
}

pub(super) fn push(udid: &str, bundle: &str, payload: &Value) -> Simctl {
    Simctl {
        input: Some(payload.to_string().into_bytes()),
        ..simctl(&["push", udid, bundle, "-"])
    }
}

pub(super) fn copy(udid: &str, text: &str) -> Simctl {
    Simctl {
        input: Some(text.as_bytes().to_vec()),
        ..simctl(&["pbcopy", udid])
    }
}

pub(super) fn paste(udid: &str) -> Simctl {
    simctl(&["pbpaste", udid])
}

pub(super) fn screenshot(udid: &str, file: &Path) -> Simctl {
    simctl(&[
        "io",
        udid,
        "screenshot",
        "--type=png",
        &file.to_string_lossy(),
    ])
}

/// Recent unified log lines from one process. `level` adds info or debug
/// messages to the default ones.
pub(super) fn log_show(udid: &str, process: &str, seconds: u32, level: &str) -> Simctl {
    let mut command = simctl(&[
        "spawn",
        udid,
        "log",
        "show",
        "--last",
        &format!("{seconds}s"),
        "--style",
        "compact",
        "--predicate",
        &format!("process == \"{process}\""),
    ]);
    match level {
        "debug" => command.args.extend(["--info".into(), "--debug".into()]),
        "info" => command.args.push("--info".into()),
        _ => {}
    }
    command
}

/// Runs `command` against the resolved Xcode and returns its output, or the
/// tool's own error text.
pub(crate) fn run(command: &Simctl, timeout: Duration) -> Result<String, String> {
    let mut process = xcode::xcrun("simctl");
    process.args(&command.args);
    for (name, value) in &command.env {
        process.env(name, value);
    }
    let result = match &command.input {
        Some(input) => process_control::run_with_input(process, timeout, input.clone())?,
        None => process_control::run(process, timeout)?,
    };
    if result.success {
        return Ok(result.stdout);
    }
    let verb = command.args.first().map_or("simctl", String::as_str);
    if result.timed_out {
        return Err(format!(
            "simctl {verb} did not finish within {}s.",
            timeout.as_secs()
        ));
    }
    let detail = [result.stderr.trim(), result.stdout.trim()]
        .into_iter()
        .find(|text| !text.is_empty())
        .unwrap_or("no output");
    Err(format!(
        "simctl {verb} failed: {}",
        super::driver::tail(detail, 2_000)
    ))
}

/// A simulator as `simctl list devices` reports it.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Device {
    pub udid: String,
    pub name: String,
    pub booted: bool,
}

pub(super) fn devices() -> Result<Vec<Device>, String> {
    let output = run(&simctl(&["list", "devices", "--json"]), TIMEOUT)?;
    parse_devices(&output)
}

pub(super) fn parse_devices(json: &str) -> Result<Vec<Device>, String> {
    let value: Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
    Ok(value["devices"]
        .as_object()
        .into_iter()
        .flat_map(|runtimes| runtimes.values())
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(|device| {
            Some(Device {
                udid: device["udid"].as_str()?.to_string(),
                name: device["name"].as_str().unwrap_or_default().to_string(),
                booted: device["state"] == "Booted",
            })
        })
        .collect())
}

/// A PNG of the screen, scaled so its longest side is at most `longest`.
pub(crate) fn capture(udid: &str, longest: Option<u32>) -> Result<Vec<u8>, String> {
    let file =
        std::env::temp_dir().join(format!("jackalope-simulator-{}.png", uuid::Uuid::new_v4()));
    let taken = run(&screenshot(udid, &file), TIMEOUT).and_then(|_| match longest {
        Some(size) => scale(&file, size),
        None => Ok(()),
    });
    let bytes = taken.and_then(|_| std::fs::read(&file).map_err(|error| error.to_string()));
    let _ = std::fs::remove_file(&file);
    bytes
}

/// Scales a PNG in place with `sips`, which ships with macOS.
pub(crate) fn scale(file: &Path, longest: u32) -> Result<(), String> {
    let mut command = Command::new("/usr/bin/sips");
    command
        .arg("-Z")
        .arg(longest.to_string())
        .arg(file)
        .arg("--out")
        .arg(file);
    let result = process_control::run(command, Duration::from_secs(30))?;
    if result.success {
        Ok(())
    } else {
        Err(format!(
            "Could not scale the screenshot: {}",
            result.stderr.trim()
        ))
    }
}

/// Reads one string key from a property list file with `plutil`.
pub(crate) fn plist_value(file: &Path, key: &str) -> Result<String, String> {
    let mut command = Command::new("/usr/bin/plutil");
    command.args(["-extract", key, "raw", "-o", "-"]).arg(file);
    let result = process_control::run(command, Duration::from_secs(10))?;
    let value = result.stdout.trim().to_string();
    if result.success && !value.is_empty() {
        Ok(value)
    } else {
        Err(format!("{} has no {key}.", file.display()))
    }
}

/// Converts a property list in any format to JSON with `plutil`.
pub(super) fn plist_json(text: &str) -> Result<Value, String> {
    let mut command = Command::new("/usr/bin/plutil");
    command.args(["-convert", "json", "-o", "-", "-"]);
    let result = process_control::run_with_input(
        command,
        Duration::from_secs(10),
        text.as_bytes().to_vec(),
    )?;
    if !result.success {
        return Err(format!(
            "Could not read the app list: {}",
            result.stderr.trim()
        ));
    }
    serde_json::from_str(&result.stdout).map_err(|error| error.to_string())
}
