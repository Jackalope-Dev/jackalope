//! What a computer runs on, and which projects need a Mac with Xcode.
//!
//! The computer agent reports `os`, `arch` and, on a Mac, the Xcode it
//! resolved in `hello`. Local sandboxes and Agent37 computers run the Linux
//! image; a paired machine keeps what its agent last reported (Linux for
//! records saved before agents reported it). The placer keeps work on a
//! project built with Xcode off hosts that cannot build it.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HostOs {
    #[default]
    Linux,
    Macos,
}

/// The Xcode a Mac computer's agent resolved.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XcodeInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build: Option<String>,
    /// Available simulator runtimes by name, such as `iOS 27.0`.
    #[serde(default)]
    pub runtimes: Vec<String>,
}

/// A computer's system as its agent reported it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostPlatform {
    #[serde(default)]
    pub os: HostOs,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xcode: Option<XcodeInfo>,
}

const TEXT_LIMIT: usize = 80;
const RUNTIME_LIMIT: usize = 32;

fn text(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(|text| text.chars().take(TEXT_LIMIT).collect::<String>())
        .filter(|text| !text.trim().is_empty())
}

impl HostPlatform {
    /// From a `hello` result. An agent that reports no `os` runs the Linux
    /// image.
    pub fn from_hello(hello: &Value) -> Self {
        let os = match hello["os"].as_str() {
            Some("macos") => HostOs::Macos,
            _ => HostOs::Linux,
        };
        let xcode = &hello["xcode"];
        let xcode = (os == HostOs::Macos && xcode.is_object()).then(|| XcodeInfo {
            version: text(&xcode["version"]),
            build: text(&xcode["build"]),
            runtimes: xcode["runtimes"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|runtime| text(&runtime["name"]))
                .take(RUNTIME_LIMIT)
                .collect(),
        });
        Self {
            os,
            arch: text(&hello["arch"]),
            xcode,
        }
    }

    /// Whether Xcode projects build here: a Mac whose agent found Xcode.
    pub fn builds_xcode(&self) -> bool {
        self.os == HostOs::Macos && self.xcode.is_some()
    }

    /// How the computer's system reads in a sentence, such as
    /// `a Mac with Xcode 27.2` or `a Linux computer`.
    pub fn describe(&self) -> String {
        match (&self.os, &self.xcode) {
            (HostOs::Linux, _) => "a Linux computer".into(),
            (HostOs::Macos, None) => "a Mac without Xcode".into(),
            (HostOs::Macos, Some(xcode)) => match &xcode.version {
                Some(version) => format!("a Mac with Xcode {version}"),
                None => "a Mac with Xcode".into(),
            },
        }
    }
}

/// The system `computer` runs: what a paired machine's agent last reported,
/// otherwise the Linux image.
pub(crate) fn of(root: &Path, computer: &super::Computer) -> HostPlatform {
    if computer.provider != super::REMOTE_MACHINE {
        return HostPlatform::default();
    }
    computer
        .machine_id
        .as_deref()
        .and_then(|id| super::remote::machine(root, id).ok())
        .map(|machine| machine.platform)
        .unwrap_or_default()
}

/// Why work on the project at `path` needs a host with Xcode, when it does:
/// an Xcode project or workspace at its root, or a Swift package that
/// declares an Apple platform. A package without one may build with Swift on
/// Linux, so it has no such need.
pub(crate) fn xcode_need(path: &Path) -> Option<String> {
    let entries = std::fs::read_dir(path).ok()?;
    let mut package = false;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.ends_with(".xcodeproj") || name.ends_with(".xcworkspace") {
            return Some(format!("it has the Xcode project {name}"));
        }
        package |= name == "Package.swift";
    }
    if package {
        let manifest = std::fs::read(path.join("Package.swift")).ok()?;
        let manifest = String::from_utf8_lossy(&manifest[..manifest.len().min(256 * 1024)]);
        let apple = [
            ".iOS(",
            ".macOS(",
            ".tvOS(",
            ".watchOS(",
            ".visionOS(",
            ".macCatalyst(",
        ]
        .iter()
        .any(|platform| manifest.contains(platform));
        if apple {
            return Some("its Swift package targets Apple platforms".into());
        }
    }
    None
}

/// What to tell the person when a project built with Xcode was meant to run
/// on `computer`, which cannot build it.
pub(crate) fn xcode_refusal(computer: &str, platform: &HostPlatform, why: &str) -> String {
    format!(
        "This project builds with Xcode ({why}), and {computer} is {}, so its agents cannot run there. Choose a Mac with Xcode or This device under Agents run on in Project settings, or install Xcode on that Mac.",
        platform.describe()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hello_reports_the_system() {
        let mac = HostPlatform::from_hello(&json!({
            "protocol": 1,
            "os": "macos",
            "arch": "arm64",
            "xcode": {
                "developerDir": "/Applications/Xcode.app/Contents/Developer",
                "version": "27.2",
                "build": "27B52",
                "runtimes": [{"name": "iOS 27.2"}, {"name": ""}, {"version": "1"}, {"name": "iOS 27.0"}]
            }
        }));
        assert_eq!(mac.os, HostOs::Macos);
        assert_eq!(mac.arch.as_deref(), Some("arm64"));
        let xcode = mac.xcode.clone().unwrap();
        assert_eq!(xcode.version.as_deref(), Some("27.2"));
        assert_eq!(xcode.build.as_deref(), Some("27B52"));
        assert_eq!(xcode.runtimes, ["iOS 27.2", "iOS 27.0"]);
        assert!(mac.builds_xcode());
        assert_eq!(mac.describe(), "a Mac with Xcode 27.2");

        let bare = HostPlatform::from_hello(&json!({"os": "macos", "xcode": null}));
        assert!(!bare.builds_xcode());
        assert_eq!(bare.describe(), "a Mac without Xcode");

        // Older images report no `os`; Linux never reports Xcode.
        let old = HostPlatform::from_hello(&json!({"protocol": 1, "screen": [1280, 800]}));
        assert_eq!(old, HostPlatform::default());
        let linux = HostPlatform::from_hello(&json!({"os": "linux", "xcode": {"version": "1"}}));
        assert!(linux.xcode.is_none() && !linux.builds_xcode());
        assert_eq!(linux.describe(), "a Linux computer");
        let unknown = HostPlatform::from_hello(&json!({"os": "plan9"}));
        assert_eq!(unknown.os, HostOs::Linux);
    }

    #[test]
    fn saved_records_without_a_system_read_as_linux() {
        let saved: HostPlatform = serde_json::from_value(json!({})).unwrap();
        assert_eq!(saved.os, HostOs::Linux);
        let mac: HostPlatform =
            serde_json::from_value(json!({"os": "macos", "xcode": {"version": "27.2"}})).unwrap();
        assert!(mac.builds_xcode());
        assert_eq!(
            serde_json::to_value(HostPlatform::default()).unwrap(),
            json!({"os": "linux"})
        );
    }

    #[test]
    fn xcode_projects_are_detected() {
        let root = std::env::temp_dir().join(format!("jackalope-xcode-{}", uuid::Uuid::new_v4()));
        let project = |name: &str| {
            let dir = root.join(name);
            std::fs::create_dir_all(&dir).unwrap();
            dir
        };
        let app = project("app");
        std::fs::create_dir(app.join("App.xcodeproj")).unwrap();
        assert!(xcode_need(&app).unwrap().contains("App.xcodeproj"));

        let workspace = project("workspace");
        std::fs::create_dir(workspace.join("App.xcworkspace")).unwrap();
        assert!(xcode_need(&workspace).is_some());

        let ios_package = project("ios-package");
        std::fs::write(
            ios_package.join("Package.swift"),
            "let package = Package(name: \"Kit\", platforms: [.iOS(.v17)])",
        )
        .unwrap();
        assert!(xcode_need(&ios_package)
            .unwrap()
            .contains("Apple platforms"));

        let server_package = project("server-package");
        std::fs::write(
            server_package.join("Package.swift"),
            "let package = Package(name: \"Server\")",
        )
        .unwrap();
        assert_eq!(xcode_need(&server_package), None);

        let web = project("web");
        std::fs::write(web.join("package.json"), "{}").unwrap();
        assert_eq!(xcode_need(&web), None);
        assert_eq!(xcode_need(&root.join("missing")), None);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn refusals_name_the_computer_and_the_fix() {
        let message = xcode_refusal(
            "Build box",
            &HostPlatform::default(),
            "it has App.xcodeproj",
        );
        assert!(message.contains("Build box is a Linux computer"));
        assert!(message.contains("Agents run on"));
    }
}
