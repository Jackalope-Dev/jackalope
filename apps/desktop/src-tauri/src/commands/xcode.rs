//! The Xcode toolchain used for iOS work on macOS.
//!
//! `xcode-select` often points at the Command Line Tools, which have no
//! `xcodebuild` or `simctl`, even when Xcode is installed. Jackalope then
//! resolves an installed Xcode itself and passes it to the commands it runs
//! through `DEVELOPER_DIR`, without changing the system selection. An explicit
//! `DEVELOPER_DIR` or a full Xcode selection always wins.

use serde::Serialize;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::process_control;

pub mod project;

/// How long a resolution is reused before the disk is checked again, so a
/// newly installed or selected Xcode is noticed without a restart.
const CACHE_FOR: Duration = Duration::from_secs(60);

static CACHE: Mutex<Option<(Instant, Option<Toolchain>)>> = Mutex::new(None);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    /// `DEVELOPER_DIR` in Jackalope's environment.
    Environment,
    /// `xcode-select -p` names a full Xcode.
    Selected,
    /// Found in an Applications folder because the selection is the Command
    /// Line Tools or missing.
    Installed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Toolchain {
    /// `<Xcode>.app/Contents/Developer`.
    pub developer_dir: PathBuf,
    pub version: Option<String>,
    pub build: Option<String>,
    pub source: Source,
}

impl Toolchain {
    /// Whether commands need `DEVELOPER_DIR` to reach this Xcode.
    pub fn needs_environment(&self) -> bool {
        self.source == Source::Installed
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XcodeStatus {
    pub supported: bool,
    pub toolchain: Option<Toolchain>,
    /// What `xcode-select -p` reports, when it is not the resolved toolchain.
    pub selected: Option<PathBuf>,
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::xcode::xcode_status,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[tauri::command]
pub async fn xcode_status() -> Result<XcodeStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let toolchain = refresh();
        let selected = selected_dir().filter(|path| {
            toolchain
                .as_ref()
                .is_none_or(|found| &found.developer_dir != path)
        });
        XcodeStatus {
            supported: cfg!(target_os = "macos"),
            toolchain,
            selected,
        }
    })
    .await
    .map_err(|error| error.to_string())
}

/// The resolved toolchain, cached for [`CACHE_FOR`]. Always `None` off macOS.
pub fn toolchain() -> Option<Toolchain> {
    let mut cache = CACHE.lock().unwrap_or_else(|poison| poison.into_inner());
    if let Some((at, found)) = cache.as_ref() {
        if at.elapsed() < CACHE_FOR {
            return found.clone();
        }
    }
    let found = resolve();
    *cache = Some((Instant::now(), found.clone()));
    found
}

/// Resolves again, ignoring the cache.
pub fn refresh() -> Option<Toolchain> {
    let mut cache = CACHE.lock().unwrap_or_else(|poison| poison.into_inner());
    let found = resolve();
    *cache = Some((Instant::now(), found.clone()));
    found
}

/// The `DEVELOPER_DIR` a child process needs, if any. Commands that inherit
/// an explicit `DEVELOPER_DIR` or a full Xcode selection need nothing.
pub fn environment() -> Option<(&'static str, OsString)> {
    toolchain()
        .filter(Toolchain::needs_environment)
        .map(|found| ("DEVELOPER_DIR", found.developer_dir.into_os_string()))
}

/// Adds [`environment`] to a command unless it already sets `DEVELOPER_DIR`.
pub fn apply(command: &mut Command) -> &mut Command {
    let set = command.get_envs().any(|(name, _)| name == "DEVELOPER_DIR");
    if !set {
        if let Some((name, value)) = environment() {
            command.env(name, value);
        }
    }
    command
}

/// Whether processes Jackalope runs in `workspace` get [`environment`]. Only
/// Xcode projects do, so other projects keep the system's selection for the
/// `/usr/bin` tools Xcode also provides (Git, compilers, make).
pub fn applies_to(workspace: &Path) -> bool {
    cfg!(target_os = "macos") && project::find(workspace).is_some()
}

/// [`environment`] for a process in `workspace`, when [`applies_to`] it.
pub fn environment_for(workspace: &Path) -> Option<(&'static str, OsString)> {
    if !applies_to(workspace) {
        return None;
    }
    environment()
}

/// [`apply`] for a process in `workspace`, when [`applies_to`] it.
pub fn apply_for<'a>(command: &'a mut Command, workspace: &Path) -> &'a mut Command {
    if applies_to(workspace) {
        apply(command);
    }
    command
}

/// Why an Xcode project in `root` cannot be built here, quoting what
/// `xcode-select` reports. `None` when it is not an Xcode project or a full
/// Xcode is available.
pub fn readiness_issue(root: &Path) -> Option<String> {
    project::find(root)?;
    if !cfg!(target_os = "macos") {
        return Some("This is an Xcode project. Xcode projects build only on a Mac.".into());
    }
    if toolchain().is_some() {
        return None;
    }
    let selected = match selected_dir() {
        Some(path) => format!("xcode-select points at {}", path.display()),
        None => "xcode-select reports no developer directory".into(),
    };
    Some(format!(
        "This is an Xcode project, but no full Xcode is installed: {selected}, which has no xcodebuild or Simulator. Install Xcode in Applications; Jackalope finds it there without changing xcode-select."
    ))
}

/// Which Xcode tasks use, when it is not the system selection.
pub fn readiness_note(root: &Path) -> Option<String> {
    project::find(root)?;
    let found = toolchain().filter(Toolchain::needs_environment)?;
    let app = found
        .developer_dir
        .parent()
        .and_then(Path::parent)
        .unwrap_or(&found.developer_dir);
    let version = found
        .version
        .as_deref()
        .map(|version| format!(" {version}"))
        .unwrap_or_default();
    let selected = selected_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "nothing".into());
    Some(format!(
        "Tasks use Xcode{version} at {} because xcode-select points at {selected}.",
        app.display()
    ))
}

/// `xcrun <tool>` against the resolved toolchain, hidden from the console and
/// without Jackalope's credentials.
pub fn xcrun(tool: &str) -> Command {
    let mut command = Command::new("/usr/bin/xcrun");
    command.arg(tool);
    process_control::hidden(&mut command);
    apply(&mut command);
    command
}

fn resolve() -> Option<Toolchain> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    if let Some(dir) = std::env::var_os("DEVELOPER_DIR").map(PathBuf::from) {
        if let Some(found) = describe(&dir, Source::Environment) {
            return Some(found);
        }
    }
    if let Some(found) = selected_dir().and_then(|dir| describe(&dir, Source::Selected)) {
        return Some(found);
    }
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = super::platform::home_dir() {
        roots.push(home.join("Applications"));
    }
    installed(&roots)
}

fn selected_dir() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let mut command = Command::new("/usr/bin/xcode-select");
    command.arg("-p");
    process_control::hidden(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!path.is_empty()).then(|| PathBuf::from(path))
}

/// A full Xcode's developer directory, which has `xcodebuild`; the Command
/// Line Tools do not.
fn describe(dir: &Path, source: Source) -> Option<Toolchain> {
    if !dir.join("usr/bin/xcodebuild").is_file() {
        return None;
    }
    let plist = dir
        .parent()
        .map(|contents| contents.join("version.plist"))
        .and_then(|path| std::fs::read_to_string(path).ok())
        .unwrap_or_default();
    Some(Toolchain {
        developer_dir: dir.to_path_buf(),
        version: plist_string(&plist, "CFBundleShortVersionString"),
        build: plist_string(&plist, "ProductBuildVersion"),
        source,
    })
}

/// Prefers `Xcode.app`, then the newest version among other `Xcode*.app`
/// bundles such as `Xcode-beta.app`.
fn installed(roots: &[PathBuf]) -> Option<Toolchain> {
    let mut found: Vec<(bool, Vec<u64>, Toolchain)> = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !(name.starts_with("Xcode") && name.ends_with(".app")) {
                continue;
            }
            let dir = entry.path().join("Contents/Developer");
            if let Some(toolchain) = describe(&dir, Source::Installed) {
                let version = toolchain
                    .version
                    .as_deref()
                    .map(version_key)
                    .unwrap_or_default();
                found.push((name == "Xcode.app", version, toolchain));
            }
        }
    }
    found
        .into_iter()
        .max_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)))
        .map(|(_, _, toolchain)| toolchain)
}

fn version_key(version: &str) -> Vec<u64> {
    version
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}

/// Reads `<key>name</key><string>value</string>` from an XML property list.
fn plist_string(plist: &str, key: &str) -> Option<String> {
    let marker = format!("<key>{key}</key>");
    let rest = &plist[plist.find(&marker)? + marker.len()..];
    let rest = rest.trim_start().strip_prefix("<string>")?;
    let value = rest[..rest.find("</string>")?].trim();
    (!value.is_empty()).then(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> PathBuf {
        let path = std::env::temp_dir().join(format!("jackalope-xcode-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn fake_xcode(root: &Path, name: &str, version: &str) -> PathBuf {
        let developer = root.join(name).join("Contents/Developer");
        std::fs::create_dir_all(developer.join("usr/bin")).unwrap();
        std::fs::write(developer.join("usr/bin/xcodebuild"), "").unwrap();
        std::fs::write(
            root.join(name).join("Contents/version.plist"),
            format!(
                "<plist><dict>\n\t<key>CFBundleShortVersionString</key>\n\t<string>{version}</string>\n\t<key>ProductBuildVersion</key>\n\t<string>B{version}</string>\n</dict></plist>"
            ),
        )
        .unwrap();
        developer
    }

    #[test]
    fn command_line_tools_are_not_a_toolchain() {
        let root = scratch();
        std::fs::create_dir_all(root.as_path().join("usr/bin")).unwrap();
        assert_eq!(describe(root.as_path(), Source::Selected), None);
    }

    #[test]
    fn describes_version_and_build() {
        let root = scratch();
        let developer = fake_xcode(root.as_path(), "Xcode.app", "27.2");
        let found = describe(&developer, Source::Installed).unwrap();
        assert_eq!(found.version.as_deref(), Some("27.2"));
        assert_eq!(found.build.as_deref(), Some("B27.2"));
        assert!(found.needs_environment());
    }

    #[test]
    fn prefers_xcode_app_then_newest() {
        let root = scratch();
        fake_xcode(root.as_path(), "Xcode-beta.app", "28.0");
        let main = fake_xcode(root.as_path(), "Xcode.app", "27.2");
        std::fs::create_dir_all(root.as_path().join("Xcode-broken.app")).unwrap();
        let found = installed(std::slice::from_ref(&root)).unwrap();
        assert_eq!(found.developer_dir, main);

        let other = scratch();
        fake_xcode(other.as_path(), "Xcode-26.4.app", "26.4");
        let newest = fake_xcode(other.as_path(), "Xcode-26.10.app", "26.10");
        let found = installed(std::slice::from_ref(&other)).unwrap();
        assert_eq!(found.developer_dir, newest);
    }

    #[test]
    fn explicit_environment_is_left_alone() {
        let toolchain = Toolchain {
            developer_dir: PathBuf::from("/x"),
            version: None,
            build: None,
            source: Source::Environment,
        };
        assert!(!toolchain.needs_environment());
    }
}
