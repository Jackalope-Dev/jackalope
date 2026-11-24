//! Device builds of a workspace: finding the Xcode project and scheme, the xcodebuild
//! command for one device, the `.app` a build produced and whether its signature can
//! run on a device.

use serde::Serialize;
use serde_json::Value;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime};

use super::super::{process_control, xcode};

/// Folders never searched for Xcode projects or build products.
const SKIP: &[&str] = &[
    "node_modules",
    "Pods",
    "Carthage",
    "DerivedData",
    "build",
    ".build",
    "target",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectKind {
    Workspace,
    Project,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct XcodeProject {
    pub kind: ProjectKind,
    pub path: PathBuf,
}

impl XcodeProject {
    fn flag(&self) -> &'static str {
        match self.kind {
            ProjectKind::Workspace => "-workspace",
            ProjectKind::Project => "-project",
        }
    }

    pub fn name(&self) -> String {
        self.path
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default()
    }
}

/// The workspace's Xcode project: a `.xcworkspace` before a `.xcodeproj`, the shallowest
/// first, searching two folders deep.
pub fn find_project(workspace: &Path) -> Option<XcodeProject> {
    let mut found: Vec<(usize, ProjectKind, PathBuf)> = Vec::new();
    search(workspace, 0, &mut found);
    found.sort_by(|a, b| {
        let kind = |kind: ProjectKind| kind == ProjectKind::Project;
        (a.0, kind(a.1), &a.2).cmp(&(b.0, kind(b.1), &b.2))
    });
    found
        .into_iter()
        .next()
        .map(|(_, kind, path)| XcodeProject { kind, path })
}

fn search(dir: &Path, depth: usize, found: &mut Vec<(usize, ProjectKind, PathBuf)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if !path.is_dir() || name.starts_with('.') {
            continue;
        }
        if name.ends_with(".xcworkspace") {
            found.push((depth, ProjectKind::Workspace, path));
        } else if name.ends_with(".xcodeproj") {
            found.push((depth, ProjectKind::Project, path));
        } else if depth < 2 && !SKIP.contains(&name.as_str()) {
            search(&path, depth + 1, found);
        }
    }
}

/// Schemes in `xcodebuild -list -json` output.
pub fn schemes(list: &Value) -> Vec<String> {
    ["workspace", "project"]
        .iter()
        .flat_map(|kind| list[*kind]["schemes"].as_array().into_iter().flatten())
        .filter_map(|scheme| scheme.as_str().map(str::to_owned))
        .collect()
}

/// The scheme named like the project, else the first one that is not a test or package scheme.
pub fn pick_scheme(schemes: &[String], project: &str) -> Option<String> {
    schemes
        .iter()
        .find(|scheme| scheme.eq_ignore_ascii_case(project))
        .or_else(|| {
            schemes.iter().find(|scheme| {
                let lower = scheme.to_lowercase();
                !lower.ends_with("tests") && !lower.ends_with("-package")
            })
        })
        .or(schemes.first())
        .cloned()
}

pub fn list_schemes(project: &XcodeProject) -> Result<Vec<String>, String> {
    let mut command = xcode::xcrun("xcodebuild");
    command
        .args(["-list", "-json", project.flag()])
        .arg(&project.path);
    let ran = process_control::run(command, Duration::from_secs(120))?;
    let list: Value = serde_json::from_str(&ran.stdout).map_err(|_| {
        let said = ran.stderr.trim();
        format!(
            "xcodebuild could not list the schemes of {}: {}",
            project.name(),
            said.chars().take(600).collect::<String>()
        )
    })?;
    Ok(schemes(&list))
}

/// A team ID as Apple issues them: ten capital letters and digits.
pub fn valid_team(team: &str) -> bool {
    team.len() == 10
        && team
            .chars()
            .all(|c| c.is_ascii_digit() || c.is_ascii_uppercase())
}

/// xcodebuild arguments that build `scheme` for one device into `derived`,
/// letting Xcode register the device and create a development profile.
pub fn device_build_args(
    project: &XcodeProject,
    scheme: &str,
    destination: &str,
    derived: &Path,
    team: Option<&str>,
) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec![
        project.flag().into(),
        project.path.clone().into(),
        "-scheme".into(),
        scheme.into(),
        "-configuration".into(),
        "Debug".into(),
        "-destination".into(),
        destination.into(),
        "-derivedDataPath".into(),
        derived.into(),
        "-allowProvisioningUpdates".into(),
    ];
    if let Some(team) = team.filter(|team| valid_team(team)) {
        args.push(format!("DEVELOPMENT_TEAM={team}").into());
    }
    args.push("build".into());
    args
}

/// The error lines of a failed xcodebuild, and what to do about a signing failure.
pub fn build_failure(output: &str, team: Option<&str>) -> String {
    let errors: Vec<&str> = output
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("error:") || line.contains(": error:"))
        .take(6)
        .collect();
    let said = if errors.is_empty() {
        output
            .lines()
            .rev()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or("no output")
            .to_owned()
    } else {
        errors.join("\n")
    };
    let lower = said.to_lowercase();
    let hint = if lower.contains("development team") || lower.contains("signing for") {
        if team.is_none() {
            " Set your Apple team ID in Project settings → Commands → Development team, or choose a team in Xcode's Signing & Capabilities."
        } else {
            " Check that the development team in Project settings is a team your Xcode account belongs to."
        }
    } else if lower.contains("no accounts") || lower.contains("no account for team") {
        " Sign in to your Apple account in Xcode → Settings → Accounts, then run it again."
    } else if lower.contains("provisioning profile") || lower.contains("no profiles for") {
        " Xcode could not create a development profile; open the project in Xcode once and check Signing & Capabilities."
    } else {
        ""
    };
    format!("The device build failed.{hint}\n{said}")
}

/// One value from a property list, binary or XML.
pub fn plist_value(plist: &Path, key: &str) -> Option<String> {
    let mut command = Command::new("/usr/bin/plutil");
    command.args(["-extract", key, "raw", "-o", "-"]).arg(plist);
    process_control::hidden(&mut command);
    let output = command.output().ok()?;
    let value = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (output.status.success() && !value.is_empty()).then_some(value)
}

/// What a built `.app` is.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub path: PathBuf,
    pub bundle_id: Option<String>,
    /// `iphoneos` for a device build, `iphonesimulator` for a Simulator build.
    pub platform: Option<String>,
    pub signing: Signing,
}

impl Product {
    pub fn read(path: &Path) -> Self {
        let info = path.join("Info.plist");
        Self {
            path: path.to_path_buf(),
            bundle_id: plist_value(&info, "CFBundleIdentifier"),
            platform: plist_value(&info, "DTPlatformName"),
            signing: signing(path),
        }
    }

    pub fn name(&self) -> String {
        self.path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default()
    }

    /// Why this build cannot be installed on a device, with what to do instead.
    pub fn problem(&self, destination: &str, team: Option<&str>) -> Option<String> {
        let name = self.name();
        if self
            .platform
            .as_deref()
            .is_some_and(|platform| platform != "iphoneos")
        {
            return Some(format!(
                "{name} is a {} build. Build it for a device: xcodebuild -scheme <scheme> -destination {destination} -allowProvisioningUpdates build.",
                self.platform.as_deref().unwrap_or("Simulator")
            ));
        }
        let reason = match &self.signing {
            Signing::Signed { .. } => return None,
            Signing::Unsigned => "it is not signed",
            Signing::AdHoc => "it is only ad hoc signed",
            Signing::NoProfile { .. } => "it has no provisioning profile",
        };
        let team = team
            .filter(|team| valid_team(team))
            .map_or_else(|| "<your team ID>".to_owned(), str::to_owned);
        Some(format!(
            "{name} cannot run on a device because {reason}. Build it with a development team and let Xcode provision the device: xcodebuild -scheme <scheme> -destination {destination} -allowProvisioningUpdates DEVELOPMENT_TEAM={team} build. Set the team once in Project settings → Commands → Development team; Xcode must be signed in to that team's Apple account."
        ))
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Signing {
    Unsigned,
    AdHoc,
    /// Signed with a certificate but without the profile a device needs.
    NoProfile {
        team: Option<String>,
    },
    Signed {
        team: String,
        authority: Option<String>,
    },
}

fn signing(app: &Path) -> Signing {
    let mut command = Command::new("/usr/bin/codesign");
    command.args(["-dv", "--verbose=2"]).arg(app);
    process_control::hidden(&mut command);
    let text = command
        .output()
        .map(|output| {
            format!(
                "{}{}",
                String::from_utf8_lossy(&output.stderr),
                String::from_utf8_lossy(&output.stdout)
            )
        })
        .unwrap_or_default();
    parse_signing(&text, app.join("embedded.mobileprovision").is_file())
}

/// Reads `codesign -dv --verbose=2` output, whose `Key=value` lines are its stable format.
pub fn parse_signing(text: &str, has_profile: bool) -> Signing {
    if text.contains("not signed at all") {
        return Signing::Unsigned;
    }
    let field = |key: &str| {
        text.lines()
            .find_map(|line| line.trim().strip_prefix(key))
            .map(str::trim)
            .filter(|value| !value.is_empty() && *value != "not set")
            .map(str::to_owned)
    };
    if field("Signature=").as_deref() == Some("adhoc") {
        return Signing::AdHoc;
    }
    let team = field("TeamIdentifier=");
    match team {
        Some(team) if has_profile => Signing::Signed {
            team,
            authority: field("Authority="),
        },
        Some(team) => Signing::NoProfile { team: Some(team) },
        None if field("Authority=").is_some() => Signing::NoProfile { team: None },
        None => Signing::Unsigned,
    }
}

/// The newest device `.app` under one derived data folder, leaving out test runners.
pub fn newest_product(derived: &Path) -> Option<PathBuf> {
    let products = derived.join("Build/Products");
    let mut found: Vec<(SystemTime, PathBuf)> = Vec::new();
    for configuration in std::fs::read_dir(products).ok()?.flatten() {
        let name = configuration.file_name().to_string_lossy().into_owned();
        if !name.ends_with("-iphoneos") {
            continue;
        }
        for app in std::fs::read_dir(configuration.path())
            .into_iter()
            .flatten()
            .flatten()
        {
            let file = app.file_name().to_string_lossy().into_owned();
            if file.ends_with(".app") && !file.ends_with("-Runner.app") {
                let modified = app
                    .metadata()
                    .and_then(|meta| meta.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                found.push((modified, app.path()));
            }
        }
    }
    found.into_iter().max().map(|(_, path)| path)
}

/// Derived data folders that hold builds of `workspace`: Jackalope's own device builds
/// and Xcode's DerivedData folders whose `WorkspacePath` lies inside the workspace.
pub fn derived_folders(workspace: &Path, own: &Path, xcode_root: Option<&Path>) -> Vec<PathBuf> {
    let mut folders = vec![own.to_path_buf()];
    let workspace = dunce::canonicalize(workspace).unwrap_or_else(|_| workspace.to_path_buf());
    for local in [
        "build",
        "DerivedData",
        crate::commands::source_packages::DERIVED_DATA,
    ] {
        folders.push(workspace.join(local));
    }
    let Some(root) = xcode_root else {
        return folders;
    };
    for entry in std::fs::read_dir(root).into_iter().flatten().flatten() {
        let info = entry.path().join("info.plist");
        if !info.is_file() {
            continue;
        }
        if plist_value(&info, "WorkspacePath")
            .is_some_and(|path| Path::new(&path).starts_with(&workspace))
        {
            folders.push(entry.path());
        }
    }
    folders
}

/// The newest device build among `folders`.
pub fn default_product(folders: &[PathBuf]) -> Option<PathBuf> {
    folders
        .iter()
        .filter_map(|folder| newest_product(folder))
        .filter_map(|path| {
            let modified = std::fs::metadata(&path)
                .and_then(|meta| meta.modified())
                .ok()?;
            Some((modified, path))
        })
        .max()
        .map(|(_, path)| path)
}

/// An `.app` an agent named, accepted only inside the workspace or one of its derived
/// data folders.
pub fn allowed_product(
    path: &Path,
    workspace: &Path,
    folders: &[PathBuf],
) -> Result<PathBuf, String> {
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        workspace.join(path)
    };
    let resolved =
        dunce::canonicalize(&path).map_err(|_| format!("{} does not exist.", path.display()))?;
    if resolved.extension().and_then(|ext| ext.to_str()) != Some("app") || !resolved.is_dir() {
        return Err(format!("{} is not an .app bundle.", path.display()));
    }
    let inside = std::iter::once(workspace)
        .chain(folders.iter().map(PathBuf::as_path))
        .filter_map(|root| dunce::canonicalize(root).ok())
        .any(|root| resolved.starts_with(root));
    if !inside {
        return Err("Install only builds of this workspace: an .app inside it or in its Xcode derived data.".into());
    }
    Ok(resolved)
}

/// Xcode's default DerivedData folder.
pub fn xcode_derived_data() -> Option<PathBuf> {
    super::super::platform::home_dir().map(|home| home.join("Library/Developer/Xcode/DerivedData"))
}
