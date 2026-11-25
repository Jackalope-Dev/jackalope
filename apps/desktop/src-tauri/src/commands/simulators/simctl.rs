//! `simctl` calls and the parsing of its JSON listings.

use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::Duration;

use crate::commands::{process_control, xcode};

const TIMEOUT: Duration = Duration::from_secs(60);
/// A first boot of a new device sets up its data and can take minutes.
pub(super) const BOOT_TIMEOUT: Duration = Duration::from_secs(300);

/// What a project's tasks boot: a device type and a runtime, by identifier.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorBase {
    pub device_type: String,
    pub runtime: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    pub identifier: String,
    pub name: String,
    pub version: String,
    pub platform: String,
    /// Device type identifiers this runtime runs.
    pub device_types: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceType {
    pub identifier: String,
    pub name: String,
    pub family: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub runtimes: Vec<Runtime>,
    pub device_types: Vec<DeviceType>,
}

impl Catalog {
    /// The newest available iOS runtime and its newest standard iPhone, such
    /// as "iPhone 17" rather than a Pro, Max, Plus, mini or e model.
    pub fn default_base(&self) -> Option<SimulatorBase> {
        let runtime = self
            .runtimes
            .iter()
            .filter(|runtime| runtime.platform == "iOS")
            .max_by(|a, b| version_key(&a.version).cmp(&version_key(&b.version)))?;
        let iphones: Vec<&DeviceType> = runtime
            .device_types
            .iter()
            .filter_map(|id| self.device_types.iter().find(|kind| &kind.identifier == id))
            .filter(|kind| kind.family == "iPhone")
            .collect();
        let standard = |kind: &&&DeviceType| {
            kind.name
                .strip_prefix("iPhone ")
                .is_some_and(|model| !model.is_empty() && model.bytes().all(|b| b.is_ascii_digit()))
        };
        let chosen = iphones
            .iter()
            .filter(standard)
            .max_by_key(|kind| kind.name[7..].parse::<u32>().unwrap_or(0))
            .or_else(|| iphones.first())?;
        Some(SimulatorBase {
            device_type: chosen.identifier.clone(),
            runtime: runtime.identifier.clone(),
        })
    }

    /// Whether `base` names an available runtime that runs that device type.
    pub fn supports(&self, base: &SimulatorBase) -> bool {
        self.runtimes.iter().any(|runtime| {
            runtime.identifier == base.runtime && runtime.device_types.contains(&base.device_type)
        })
    }

    pub fn runtime_name(&self, identifier: &str) -> String {
        self.runtimes
            .iter()
            .find(|runtime| runtime.identifier == identifier)
            .map(|runtime| runtime.name.clone())
            .unwrap_or_else(|| identifier.to_string())
    }
}

/// A device as `simctl list -j devices` reports it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Listed {
    pub udid: String,
    pub name: String,
    pub state: String,
    pub runtime: String,
    pub device_type: String,
}

fn version_key(version: &str) -> Vec<u64> {
    version
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}

fn command(args: &[&str]) -> Command {
    let mut command = xcode::xcrun("simctl");
    command.args(args);
    command
}

fn run(args: &[&str], timeout: Duration, canceled: impl Fn() -> bool) -> Result<String, String> {
    let output = process_control::run_cancellable(command(args), timeout, canceled)?;
    if output.success {
        return Ok(output.stdout);
    }
    let detail = if output.stderr.trim().is_empty() {
        output.stdout.trim().to_string()
    } else {
        output.stderr.trim().to_string()
    };
    Err(match output.interruption() {
        Some(why) => format!("simctl {} {why}.", args[0]),
        None => format!("simctl {} failed: {detail}", args[0]),
    })
}

pub fn catalog() -> Result<Catalog, String> {
    let runtimes = run(&["list", "-j", "runtimes"], TIMEOUT, || false)?;
    let device_types = run(&["list", "-j", "devicetypes"], TIMEOUT, || false)?;
    parse_catalog(&runtimes, &device_types)
}

pub fn devices() -> Result<Vec<Listed>, String> {
    parse_devices(&run(&["list", "-j", "devices"], TIMEOUT, || false)?)
}

/// Creates a shut-down device and returns its UDID.
pub fn create(name: &str, base: &SimulatorBase) -> Result<String, String> {
    let udid = run(
        &["create", name, &base.device_type, &base.runtime],
        TIMEOUT,
        || false,
    )?
    .trim()
    .to_string();
    if udid.len() != 36 || !udid.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err(format!(
            "simctl create returned an unexpected device id: {udid}"
        ));
    }
    Ok(udid)
}

/// Boots the device headless if needed and waits until it has finished
/// booting. Never opens a Simulator window.
pub fn boot(udid: &str, canceled: impl Fn() -> bool) -> Result<(), String> {
    run(&["bootstatus", udid, "-b"], BOOT_TIMEOUT, canceled).map(|_| ())
}

pub fn shutdown(udid: &str) -> Result<(), String> {
    match run(&["shutdown", udid], TIMEOUT, || false) {
        Err(error) if error.contains("current state: Shutdown") => Ok(()),
        other => other.map(|_| ()),
    }
}

/// Starts a shutdown without waiting for it, for app exit.
pub fn shutdown_detached(udid: &str) -> Option<std::process::Child> {
    let mut command = command(&["shutdown", udid]);
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    command.spawn().ok()
}

pub fn delete(udid: &str) -> Result<(), String> {
    let _ = shutdown(udid);
    run(&["delete", udid], TIMEOUT, || false).map(|_| ())
}

fn parse_catalog(runtimes: &str, device_types: &str) -> Result<Catalog, String> {
    let runtimes: serde_json::Value =
        serde_json::from_str(runtimes).map_err(|error| format!("simctl runtimes: {error}"))?;
    let device_types: serde_json::Value = serde_json::from_str(device_types)
        .map_err(|error| format!("simctl device types: {error}"))?;
    let text = |value: &serde_json::Value| value.as_str().unwrap_or_default().to_string();
    Ok(Catalog {
        runtimes: runtimes["runtimes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|runtime| runtime["isAvailable"].as_bool() == Some(true))
            .map(|runtime| Runtime {
                identifier: text(&runtime["identifier"]),
                name: text(&runtime["name"]),
                version: text(&runtime["version"]),
                platform: text(&runtime["platform"]),
                device_types: runtime["supportedDeviceTypes"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|kind| text(&kind["identifier"]))
                    .collect(),
            })
            .collect(),
        device_types: device_types["devicetypes"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|kind| DeviceType {
                identifier: text(&kind["identifier"]),
                name: text(&kind["name"]),
                family: text(&kind["productFamily"]),
            })
            .collect(),
    })
}

fn parse_devices(output: &str) -> Result<Vec<Listed>, String> {
    let value: serde_json::Value =
        serde_json::from_str(output).map_err(|error| format!("simctl devices: {error}"))?;
    let mut found = Vec::new();
    for (runtime, devices) in value["devices"].as_object().into_iter().flatten() {
        for device in devices.as_array().into_iter().flatten() {
            let text = |key: &str| device[key].as_str().unwrap_or_default().to_string();
            found.push(Listed {
                udid: text("udid"),
                name: text("name"),
                state: text("state"),
                runtime: runtime.clone(),
                device_type: text("deviceTypeIdentifier"),
            });
        }
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUNTIMES: &str = r#"{"runtimes":[
      {"isAvailable":true,"version":"27.0","identifier":"com.apple.CoreSimulator.SimRuntime.iOS-27-0","platform":"iOS","name":"iOS 27.0",
       "supportedDeviceTypes":[{"identifier":"t.iPhone-18-Pro"},{"identifier":"t.iPhone-17"}]},
      {"isAvailable":true,"version":"27.2","identifier":"com.apple.CoreSimulator.SimRuntime.iOS-27-2","platform":"iOS","name":"iOS 27.2",
       "supportedDeviceTypes":[{"identifier":"t.iPhone-18-Pro"},{"identifier":"t.iPhone-17e"},{"identifier":"t.iPhone-Air"},{"identifier":"t.iPhone-17"},{"identifier":"t.iPhone-16"},{"identifier":"t.iPad"}]},
      {"isAvailable":false,"version":"28.0","identifier":"r.iOS-28","platform":"iOS","name":"iOS 28.0","supportedDeviceTypes":[]},
      {"isAvailable":true,"version":"30.0","identifier":"r.watchOS-30","platform":"watchOS","name":"watchOS 30.0","supportedDeviceTypes":[]}
    ]}"#;
    const TYPES: &str = r#"{"devicetypes":[
      {"identifier":"t.iPhone-18-Pro","name":"iPhone 18 Pro","productFamily":"iPhone"},
      {"identifier":"t.iPhone-17e","name":"iPhone 17e","productFamily":"iPhone"},
      {"identifier":"t.iPhone-Air","name":"iPhone Air","productFamily":"iPhone"},
      {"identifier":"t.iPhone-17","name":"iPhone 17","productFamily":"iPhone"},
      {"identifier":"t.iPhone-16","name":"iPhone 16","productFamily":"iPhone"},
      {"identifier":"t.iPad","name":"iPad (A16)","productFamily":"iPad"}
    ]}"#;

    #[test]
    fn default_is_the_newest_runtime_and_its_standard_iphone() {
        let catalog = parse_catalog(RUNTIMES, TYPES).unwrap();
        assert_eq!(catalog.runtimes.len(), 3);
        let base = catalog.default_base().unwrap();
        assert_eq!(base.runtime, "com.apple.CoreSimulator.SimRuntime.iOS-27-2");
        assert_eq!(base.device_type, "t.iPhone-17");
        assert!(catalog.supports(&base));
        assert!(!catalog.supports(&SimulatorBase {
            device_type: "t.iPad".into(),
            runtime: "com.apple.CoreSimulator.SimRuntime.iOS-27-0".into(),
        }));
        assert_eq!(catalog.runtime_name("r.unknown"), "r.unknown");

        let only_pro = parse_catalog(
            r#"{"runtimes":[{"isAvailable":true,"version":"27.0","identifier":"r","platform":"iOS","name":"iOS","supportedDeviceTypes":[{"identifier":"t.iPhone-18-Pro"}]}]}"#,
            TYPES,
        )
        .unwrap();
        assert_eq!(
            only_pro.default_base().unwrap().device_type,
            "t.iPhone-18-Pro"
        );
        assert_eq!(Catalog::default().default_base(), None);
    }

    #[test]
    fn devices_carry_their_runtime() {
        let devices = parse_devices(
            r#"{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-27-0":[
              {"udid":"174A0893-56DA-48F5-BBFA-30B525C89AE0","name":"iPhone 18 Pro","state":"Booted","deviceTypeIdentifier":"t.iPhone-18-Pro"}
            ],"empty":[]}}"#,
        )
        .unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].state, "Booted");
        assert_eq!(
            devices[0].runtime,
            "com.apple.CoreSimulator.SimRuntime.iOS-27-0"
        );
        assert!(parse_devices("not json").is_err());
    }
}
