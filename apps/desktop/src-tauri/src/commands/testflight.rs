//! Upload to TestFlight: a delivery action the person starts for a finished
//! iOS task.
//!
//! Jackalope reads the version and build the task's Xcode project produces,
//! can raise the build number as an ordinary change in the task workspace,
//! and, once the person confirms the app and build by name, archives the
//! workspace and uploads it with the project's App Store Connect key. Agents
//! never upload: they prepare the project and ask the person for signing
//! setup. The archive, export and log live in app data, never the workspace;
//! the key is written for the upload only and deleted when it ends.

use super::{
    app_store_connect::{self, Api, Saved},
    process_control::{self, CommandResult, Limits},
    project_secrets,
    tasks::TaskRuntime,
    xcode,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    ffi::OsString,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, LazyLock, Mutex,
    },
    time::Duration,
};

const READ_LIMIT: Duration = Duration::from_secs(180);
const ARCHIVE_LIMITS: Limits = Limits {
    total: Duration::from_secs(90 * 60),
    stall: Some(Duration::from_secs(20 * 60)),
};
/// Uploading can be quiet for a long time on a slow connection.
const EXPORT_LIMITS: Limits = Limits {
    total: Duration::from_secs(90 * 60),
    stall: Some(Duration::from_secs(30 * 60)),
};
const PROCESSING_INTERVAL: Duration = Duration::from_secs(30);
/// Checks over about 30 minutes; App Store Connect emails when it finishes.
const PROCESSING_CHECKS: u32 = 60;
const LOG_LINES: usize = 400;
const LINE_CHARS: usize = 2000;
const ERROR_LINES: usize = 8;
const LOG_FILE_BYTES: u64 = 32 * 1024 * 1024;
const SKIPPED_FOLDERS: &[&str] = &["node_modules", "Pods", "Carthage", "DerivedData", "build"];

/// The Xcode workspace or project an upload archives.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Container {
    Workspace(PathBuf),
    Project(PathBuf),
}

impl Container {
    fn path(&self) -> &Path {
        match self {
            Self::Workspace(path) | Self::Project(path) => path,
        }
    }

    fn args(&self) -> [OsString; 2] {
        match self {
            Self::Workspace(path) => ["-workspace".into(), path.into()],
            Self::Project(path) => ["-project".into(), path.into()],
        }
    }

    fn stem(&self) -> String {
        self.path()
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default()
    }
}

/// The Xcode workspace or project in `root` or one folder down, nearest
/// first; a workspace wins over a project at the same depth, since it
/// includes the project and its packages or pods.
pub(crate) fn find_container(root: &Path) -> Option<Container> {
    let mut level = vec![root.to_path_buf()];
    for _ in 0..2 {
        let mut workspaces = Vec::new();
        let mut projects = Vec::new();
        let mut next = Vec::new();
        for folder in &level {
            let Ok(entries) = std::fs::read_dir(folder) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') || !path.is_dir() {
                    continue;
                }
                if name.ends_with(".xcworkspace") {
                    workspaces.push(path);
                } else if name.ends_with(".xcodeproj") {
                    if name != "Pods.xcodeproj" {
                        projects.push(path);
                    }
                } else if !SKIPPED_FOLDERS.contains(&name.as_str()) {
                    next.push(path);
                }
            }
        }
        workspaces.sort();
        projects.sort();
        if let Some(path) = workspaces.into_iter().next() {
            return Some(Container::Workspace(path));
        }
        if let Some(path) = projects.into_iter().next() {
            return Some(Container::Project(path));
        }
        next.sort();
        level = next;
    }
    None
}

/// How `xcodebuild` is started: through `xcrun` with the resolved Xcode, or
/// a stand-in in tests.
#[derive(Clone, Debug)]
pub(crate) enum Program {
    Xcrun,
    #[cfg_attr(not(test), allow(dead_code))]
    Path(PathBuf),
}

impl Program {
    fn command(&self, dir: &Path) -> Command {
        let mut command = match self {
            Self::Xcrun => xcode::xcrun("xcodebuild"),
            Self::Path(path) => {
                let mut command = Command::new(path);
                process_control::hidden(&mut command);
                command
            }
        };
        command.current_dir(dir);
        command
    }
}

fn read(program: &Program, dir: &Path, args: &[OsString]) -> Result<String, String> {
    let mut command = program.command(dir);
    command.args(args);
    let result = process_control::run(command, READ_LIMIT)?;
    if !result.success {
        let detail = error_lines(&format!("{}\n{}", result.stderr, result.stdout));
        let why = result
            .interruption()
            .unwrap_or_else(|| detail.unwrap_or_else(|| tail(&result.stderr, 6)));
        return Err(format!("xcodebuild could not read the project: {why}"));
    }
    Ok(result.stdout)
}

/// The scheme to archive: the configured one, the only one, the one named
/// like the workspace or project, or the only one that is not a test or
/// CocoaPods scheme.
fn choose_scheme(
    schemes: &[String],
    container: &Container,
    configured: Option<&str>,
) -> Result<String, String> {
    if let Some(configured) = configured {
        return if schemes.iter().any(|scheme| scheme == configured) {
            Ok(configured.to_string())
        } else {
            Err(format!(
                "The scheme {configured} is not in {}. Schemes: {}.",
                display_name(container.path()),
                schemes.join(", ")
            ))
        };
    }
    if let [only] = schemes {
        return Ok(only.clone());
    }
    let stem = container.stem();
    if let Some(named) = schemes.iter().find(|scheme| **scheme == stem) {
        return Ok(named.clone());
    }
    let apps: Vec<_> = schemes
        .iter()
        .filter(|scheme| !scheme.ends_with("Tests") && !scheme.starts_with("Pods"))
        .collect();
    if let [only] = apps.as_slice() {
        return Ok((*only).clone());
    }
    Err(format!(
        "Choose the scheme to archive under Project settings → Integrations → App Store Connect. Schemes: {}.",
        schemes.join(", ")
    ))
}

fn schemes(listing: &str) -> Vec<String> {
    let value: Value = serde_json::from_str(listing).unwrap_or_default();
    let owner = if value["workspace"].is_object() {
        &value["workspace"]
    } else {
        &value["project"]
    };
    owner["schemes"]
        .as_array()
        .map(|schemes| {
            schemes
                .iter()
                .filter_map(|scheme| scheme.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// What the project's app target builds, from `-showBuildSettings -json`.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Settings {
    pub app_name: String,
    pub bundle_id: String,
    pub version: String,
    pub build: String,
    pub development_team: Option<String>,
    /// The `.xcodeproj` that defines the app target.
    pub project_file: Option<PathBuf>,
    /// An Info.plist that spells out the build number instead of using
    /// `CURRENT_PROJECT_VERSION`.
    pub info_plist: Option<PathBuf>,
    pub source_root: Option<PathBuf>,
}

fn settings(json: &str, scheme: &str) -> Result<Settings, String> {
    let targets: Vec<Value> = serde_json::from_str(json)
        .map_err(|_| "xcodebuild returned build settings Jackalope could not read.".to_string())?;
    let apps: Vec<&Value> = targets
        .iter()
        .filter(|target| {
            let settings = &target["buildSettings"];
            settings["PRODUCT_TYPE"] == "com.apple.product-type.application"
                || settings["WRAPPER_EXTENSION"] == "app"
        })
        .collect();
    let target = apps
        .iter()
        .find(|target| target["target"] == scheme)
        .or_else(|| apps.first())
        .ok_or_else(|| format!("The scheme {scheme} does not build an iOS app."))?;
    let settings = &target["buildSettings"];
    let text = |name: &str| {
        settings[name]
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let source_root = text("SRCROOT")
        .or_else(|| text("PROJECT_DIR"))
        .map(PathBuf::from);
    let mut found = Settings {
        app_name: text("INFOPLIST_KEY_CFBundleDisplayName")
            .or_else(|| text("PRODUCT_NAME"))
            .or_else(|| target["target"].as_str().map(str::to_string))
            .unwrap_or_default(),
        bundle_id: text("PRODUCT_BUNDLE_IDENTIFIER").unwrap_or_default(),
        version: text("MARKETING_VERSION").unwrap_or_default(),
        build: text("CURRENT_PROJECT_VERSION").unwrap_or_default(),
        development_team: text("DEVELOPMENT_TEAM"),
        project_file: text("PROJECT_FILE_PATH").map(PathBuf::from),
        info_plist: None,
        source_root: source_root.clone(),
    };
    if let (Some(root), Some(file)) = (source_root, text("INFOPLIST_FILE")) {
        let path = root.join(file);
        if let Ok(plist) = std::fs::read_to_string(&path) {
            if let Some(build) =
                plist_string(&plist, "CFBundleVersion").filter(|v| !v.contains("$("))
            {
                found.build = build;
                found.info_plist = Some(path);
            }
            if let Some(version) =
                plist_string(&plist, "CFBundleShortVersionString").filter(|v| !v.contains("$("))
            {
                found.version = version;
            }
        }
    }
    Ok(found)
}

/// Reads `<key>name</key><string>value</string>` from an XML property list.
fn plist_string(plist: &str, key: &str) -> Option<String> {
    let marker = format!("<key>{key}</key>");
    let rest = &plist[plist.find(&marker)? + marker.len()..];
    let rest = rest.trim_start().strip_prefix("<string>")?;
    let value = rest[..rest.find("</string>")?].trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// A build number App Store Connect accepts: one to three period-separated
/// integers.
fn valid_build(build: &str) -> bool {
    let parts: Vec<&str> = build.split('.').collect();
    (1..=3).contains(&parts.len())
        && parts.iter().all(|part| {
            !part.is_empty() && part.len() <= 18 && part.bytes().all(|b| b.is_ascii_digit())
        })
}

fn build_key(build: &str) -> Vec<u64> {
    let mut key: Vec<u64> = build
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect();
    while key.len() < 3 {
        key.push(0);
    }
    key
}

/// The build number after `build`: its last part plus one.
fn next_build(build: &str) -> String {
    if !valid_build(build) {
        return "1".into();
    }
    let mut parts: Vec<u64> = build
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect();
    if let Some(last) = parts.last_mut() {
        *last += 1;
    }
    parts
        .iter()
        .map(u64::to_string)
        .collect::<Vec<_>>()
        .join(".")
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    /// The workspace or project, relative to the task workspace.
    pub container: String,
    pub scheme: String,
    pub app_name: String,
    pub bundle_id: String,
    pub version: String,
    pub build: String,
    pub suggested_build: String,
    /// The build number App Store Connect last received for this app.
    pub latest_uploaded: Option<String>,
    /// Why App Store Connect could not be read, in its own words.
    pub remote_note: Option<String>,
    pub development_team: Option<String>,
    /// Why this build cannot be uploaded as it is.
    pub blocked: Option<String>,
    #[serde(skip)]
    app_id: Option<String>,
    #[serde(skip)]
    local: Local,
}

/// What the workspace says, before App Store Connect is asked.
#[derive(Clone, Debug, PartialEq)]
struct Local {
    container: Container,
    scheme: String,
    settings: Settings,
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn read_local(
    program: &Program,
    workspace: &Path,
    configured: Option<&str>,
) -> Result<Local, String> {
    let container = find_container(workspace)
        .ok_or("This task's workspace has no Xcode project or workspace.")?;
    let mut list: Vec<OsString> = vec!["-list".into(), "-json".into()];
    list.extend(container.args());
    let scheme = choose_scheme(
        &schemes(&read(program, workspace, &list)?),
        &container,
        configured,
    )?;
    let mut show: Vec<OsString> = vec![
        "-showBuildSettings".into(),
        "-json".into(),
        "-scheme".into(),
        scheme.clone().into(),
        "-configuration".into(),
        "Release".into(),
        "-sdk".into(),
        "iphoneos".into(),
    ];
    show.extend(container.args());
    let settings = settings(&read(program, workspace, &show)?, &scheme)?;
    Ok(Local {
        container,
        scheme,
        settings,
    })
}

/// Compares what the workspace builds with the connection and App Store
/// Connect, and says what would stop an upload.
fn assess(workspace: &Path, local: Local, connection: Option<&Saved>, remote: Remote) -> Info {
    let settings = &local.settings;
    let latest = remote.latest.clone();
    let behind = latest.as_deref().is_some_and(|latest| {
        valid_build(&settings.build) && build_key(&settings.build) <= build_key(latest)
    });
    let suggested_build = match &latest {
        Some(latest) if behind || !valid_build(&settings.build) => next_build(latest),
        _ if !valid_build(&settings.build) => next_build(&settings.build),
        _ => settings.build.clone(),
    };
    let blocked = if connection.is_none() {
        Some("Connect App Store Connect under Project settings → Integrations first.".to_string())
    } else if settings.bundle_id.is_empty() {
        Some("The app target has no bundle ID (PRODUCT_BUNDLE_IDENTIFIER).".into())
    } else if let Some(expected) = connection
        .and_then(|saved| saved.bundle_id.as_deref())
        .filter(|expected| *expected != settings.bundle_id)
    {
        Some(format!(
            "The project builds {}, but App Store Connect is set up for {expected}.",
            settings.bundle_id
        ))
    } else if settings.version.is_empty() {
        Some(
            "The app target has no version (MARKETING_VERSION or CFBundleShortVersionString)."
                .into(),
        )
    } else if !valid_build(&settings.build) {
        Some(format!(
            "The build number {:?} is not one to three numbers separated by periods. Set one first.",
            settings.build
        ))
    } else if let Some(team) = connection
        .map(|saved| saved.development_team.as_str())
        .filter(|team| {
            settings
                .development_team
                .as_deref()
                .is_some_and(|signing| signing != *team)
        })
    {
        Some(format!(
            "The project signs with team {}, but the App Store Connect key belongs to team {team}.",
            settings.development_team.as_deref().unwrap_or_default()
        ))
    } else if let Some(missing) = &remote.missing_app {
        Some(missing.clone())
    } else if behind {
        Some(format!(
            "Build {} is not newer than build {} on App Store Connect. Set a higher build number first.",
            settings.build,
            latest.as_deref().unwrap_or_default()
        ))
    } else {
        None
    };
    Info {
        container: local
            .container
            .path()
            .strip_prefix(workspace)
            .unwrap_or(local.container.path())
            .to_string_lossy()
            .into_owned(),
        scheme: local.scheme.clone(),
        app_name: settings.app_name.clone(),
        bundle_id: settings.bundle_id.clone(),
        version: settings.version.clone(),
        build: settings.build.clone(),
        suggested_build,
        latest_uploaded: latest,
        remote_note: remote.note,
        development_team: settings
            .development_team
            .clone()
            .or_else(|| connection.map(|saved| saved.development_team.clone())),
        blocked,
        app_id: remote.app_id,
        local,
    }
}

/// What App Store Connect says about the app.
#[derive(Default)]
struct Remote {
    app_id: Option<String>,
    latest: Option<String>,
    missing_app: Option<String>,
    note: Option<String>,
}

async fn read_remote(api: Result<Api, String>, bundle_id: &str) -> Remote {
    let api = match api {
        Ok(api) => api,
        Err(error) => {
            return Remote {
                note: Some(error),
                ..Remote::default()
            }
        }
    };
    if bundle_id.is_empty() {
        return Remote::default();
    }
    match api.app(bundle_id).await {
        Ok(None) => Remote {
            missing_app: Some(format!(
                "App Store Connect has no app with the bundle ID {bundle_id}. Create it under Apps first."
            )),
            ..Remote::default()
        },
        Ok(Some((app_id, _))) => match api.latest_build(&app_id).await {
            Ok(latest) => Remote {
                app_id: Some(app_id),
                latest,
                ..Remote::default()
            },
            Err(error) => Remote {
                app_id: Some(app_id),
                note: Some(error),
                ..Remote::default()
            },
        },
        Err(error) => Remote {
            note: Some(error),
            ..Remote::default()
        },
    }
}

/// Replaces build number `old` with `new` wherever the project spells it:
/// `CURRENT_PROJECT_VERSION` in the `.pbxproj` and an XcodeGen `project.yml`,
/// and a literal `CFBundleVersion` in the Info.plist. Every file must be in
/// `workspace`. Returns the files changed.
fn set_build_number(
    workspace: &Path,
    settings: &Settings,
    old: &str,
    new: &str,
) -> Result<Vec<PathBuf>, String> {
    let inside = |path: &Path| {
        dunce::canonicalize(path)
            .ok()
            .zip(dunce::canonicalize(workspace).ok())
            .is_some_and(|(path, root)| path.starts_with(root))
    };
    let mut edits: Vec<(PathBuf, String)> = Vec::new();
    if let Some(project) = &settings.project_file {
        let path = project.join("project.pbxproj");
        if inside(&path) {
            let text = std::fs::read_to_string(&path)
                .map_err(|error| format!("{} could not be read: {error}", path.display()))?;
            if let Some(changed) =
                replace_setting(&text, "CURRENT_PROJECT_VERSION = ", ";", old, new)
            {
                edits.push((path, changed));
            }
        }
    }
    if let Some(root) = &settings.source_root {
        let path = root.join("project.yml");
        if path.is_file() && inside(&path) {
            if let Ok(text) = std::fs::read_to_string(&path) {
                if let Some(changed) =
                    replace_setting(&text, "CURRENT_PROJECT_VERSION: ", "", old, new)
                {
                    edits.push((path, changed));
                }
            }
        }
    }
    if let Some(path) = settings.info_plist.as_ref().filter(|path| inside(path)) {
        let text = std::fs::read_to_string(path)
            .map_err(|error| format!("{} could not be read: {error}", path.display()))?;
        let marker = "<key>CFBundleVersion</key>";
        if let Some(at) = text.find(marker) {
            let after = &text[at + marker.len()..];
            let from = format!("<string>{old}</string>");
            if after.trim_start().starts_with(&from) {
                let start = at + marker.len() + (after.len() - after.trim_start().len());
                let mut changed = text.clone();
                changed.replace_range(
                    start..start + from.len(),
                    &format!("<string>{new}</string>"),
                );
                edits.push((path.clone(), changed));
            }
        }
    }
    if edits.is_empty() {
        return Err(format!(
            "Build number {old} is not set in the project file, project.yml or Info.plist. Change CURRENT_PROJECT_VERSION in Xcode, or wherever an .xcconfig sets it."
        ));
    }
    for (path, text) in &edits {
        std::fs::write(path, text)
            .map_err(|error| format!("{} could not be saved: {error}", path.display()))?;
    }
    Ok(edits.into_iter().map(|(path, _)| path).collect())
}

/// `text` with every `<prefix><old><suffix>` setting line, quoted or not, set
/// to `new`; `None` when no line had `old`.
fn replace_setting(text: &str, prefix: &str, suffix: &str, old: &str, new: &str) -> Option<String> {
    let mut changed = false;
    let lines: Vec<String> = text
        .split_inclusive('\n')
        .map(|line| {
            let body = line.trim_end_matches(['\r', '\n']);
            let ending = &line[body.len()..];
            let indent = &body[..body.len() - body.trim_start().len()];
            let Some(value) = body.trim_start().strip_prefix(prefix) else {
                return line.to_string();
            };
            let Some(value) = value.trim_end().strip_suffix(suffix) else {
                return line.to_string();
            };
            let bare = value.trim().trim_matches(['"', '\'']);
            if bare != old {
                return line.to_string();
            }
            changed = true;
            format!("{indent}{prefix}{new}{suffix}{ending}")
        })
        .collect();
    changed.then(|| lines.concat())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Archiving,
    Exporting,
    Processing,
    Done,
    Failed,
    Canceled,
}

impl Phase {
    fn active(self) -> bool {
        matches!(self, Self::Archiving | Self::Exporting | Self::Processing)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadState {
    pub run_id: String,
    pub phase: Phase,
    pub app_name: String,
    pub bundle_id: String,
    pub version: String,
    pub build: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    /// The newest lines of output.
    pub log: Vec<String>,
    /// What failed, in xcodebuild's or App Store Connect's own words.
    pub error: Option<String>,
    /// Where App Store Connect's processing of the build stands.
    pub processing: Option<String>,
    pub log_path: String,
}

/// A running or finished upload.
pub(crate) struct Job {
    state: Mutex<UploadState>,
    canceled: AtomicBool,
    output: Mutex<Output>,
    record: PathBuf,
}

#[derive(Default)]
struct Output {
    partial: [Vec<u8>; 2],
    lines: VecDeque<String>,
    errors: Vec<String>,
    file: Option<std::fs::File>,
    written: u64,
}

impl Job {
    fn new(state: UploadState, record: PathBuf, log: &Path) -> Self {
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log)
            .ok();
        Self {
            state: Mutex::new(state),
            canceled: AtomicBool::new(false),
            output: Mutex::new(Output {
                file,
                ..Output::default()
            }),
            record,
        }
    }

    pub(crate) fn snapshot(&self) -> UploadState {
        let mut state = self.state.lock().unwrap().clone();
        state.log = self.output.lock().unwrap().lines.iter().cloned().collect();
        state
    }

    fn canceled(&self) -> bool {
        self.canceled.load(Ordering::Relaxed)
    }

    fn update(&self, change: impl FnOnce(&mut UploadState)) {
        change(&mut self.state.lock().unwrap());
        self.save();
    }

    fn save(&self) {
        if let Ok(text) = serde_json::to_vec_pretty(&self.snapshot()) {
            let _ = std::fs::write(&self.record, text);
        }
    }

    /// Records a line Jackalope itself writes to the log.
    fn note(&self, line: &str) {
        self.output(format!("{line}\n").as_bytes(), false);
        self.flush();
    }

    /// Takes a chunk of a step's output, splitting it into lines.
    fn output(&self, bytes: &[u8], stderr: bool) {
        let mut output = self.output.lock().unwrap();
        if output.written < LOG_FILE_BYTES {
            let written = bytes.len() as u64;
            if let Some(file) = output.file.as_mut() {
                let _ = file.write_all(bytes);
            }
            output.written += written;
        }
        let stream = usize::from(stderr);
        output.partial[stream].extend_from_slice(bytes);
        while let Some(end) = output.partial[stream].iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = output.partial[stream].drain(..=end).collect();
            let line = String::from_utf8_lossy(&line).trim_end().to_string();
            output.push(line);
        }
    }

    /// Ends a step: a final line without a newline counts too.
    fn flush(&self) {
        let mut output = self.output.lock().unwrap();
        for stream in 0..2 {
            if !output.partial[stream].is_empty() {
                let line = String::from_utf8_lossy(&std::mem::take(&mut output.partial[stream]))
                    .trim_end()
                    .to_string();
                output.push(line);
            }
        }
    }

    fn take_errors(&self) -> Vec<String> {
        std::mem::take(&mut self.output.lock().unwrap().errors)
    }

    fn recent(&self, count: usize) -> Vec<String> {
        let output = self.output.lock().unwrap();
        let skip = output.lines.len().saturating_sub(count);
        output.lines.iter().skip(skip).cloned().collect()
    }
}

impl Output {
    fn push(&mut self, line: String) {
        if line.is_empty() {
            return;
        }
        let line: String = line.chars().take(LINE_CHARS).collect();
        if is_error_line(&line) && !self.errors.contains(&line) {
            self.errors.push(line.clone());
            if self.errors.len() > ERROR_LINES {
                self.errors.remove(0);
            }
        }
        self.lines.push_back(line);
        while self.lines.len() > LOG_LINES {
            self.lines.pop_front();
        }
    }
}

fn is_error_line(line: &str) -> bool {
    let line = line.trim();
    line.starts_with("error:")
        || line.contains(" error: ")
        || line.starts_with("❌")
        || line.contains("Error Domain=")
        || line.starts_with("** ARCHIVE FAILED **")
        || line.starts_with("** EXPORT FAILED **")
}

fn error_lines(text: &str) -> Option<String> {
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|line| is_error_line(line))
        .collect();
    (!lines.is_empty()).then(|| lines[lines.len().saturating_sub(ERROR_LINES)..].join("\n"))
}

fn tail(text: &str, count: usize) -> String {
    let lines: Vec<&str> = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    lines[lines.len().saturating_sub(count)..].join("\n")
}

/// The key xcodebuild signs and uploads with.
pub(crate) struct Auth {
    pub key: String,
    pub key_id: String,
    pub issuer_id: String,
}

/// One upload, as xcodebuild will run it.
pub(crate) struct Plan {
    pub program: Program,
    pub workspace: PathBuf,
    pub container: Container,
    pub scheme: String,
    pub development_team: String,
    /// Build settings added to the archive, such as `DEVELOPMENT_TEAM=…`.
    pub settings: Vec<String>,
    pub export_method: String,
    pub auth: Option<Auth>,
    /// Private folder in app data for the archive, export, key and log.
    pub folder: PathBuf,
}

impl Plan {
    fn archive_path(&self) -> PathBuf {
        self.folder
            .join(format!("{}.xcarchive", self.scheme.replace('/', "-")))
    }

    fn export_path(&self) -> PathBuf {
        self.folder.join("export")
    }

    fn options_path(&self) -> PathBuf {
        self.folder.join("ExportOptions.plist")
    }

    fn key_folder(&self) -> PathBuf {
        self.folder.join("key")
    }

    fn key_path(&self) -> Option<PathBuf> {
        self.auth.as_ref().map(|auth| {
            self.key_folder()
                .join(format!("AuthKey_{}.p8", auth.key_id))
        })
    }

    fn auth_args(&self) -> Vec<OsString> {
        let (Some(auth), Some(key)) = (&self.auth, self.key_path()) else {
            return Vec::new();
        };
        vec![
            "-allowProvisioningUpdates".into(),
            "-authenticationKeyPath".into(),
            key.into(),
            "-authenticationKeyID".into(),
            auth.key_id.clone().into(),
            "-authenticationKeyIssuerID".into(),
            auth.issuer_id.clone().into(),
        ]
    }

    pub(crate) fn archive_args(&self) -> Vec<OsString> {
        let mut args: Vec<OsString> = vec!["archive".into()];
        args.extend(self.container.args());
        args.extend([
            "-scheme".into(),
            self.scheme.clone().into(),
            "-configuration".into(),
            "Release".into(),
            "-destination".into(),
            "generic/platform=iOS".into(),
            "-archivePath".into(),
            self.archive_path().into(),
        ]);
        args.extend(self.auth_args());
        args.extend(self.settings.iter().map(OsString::from));
        args
    }

    pub(crate) fn export_args(&self) -> Vec<OsString> {
        let mut args: Vec<OsString> = vec![
            "-exportArchive".into(),
            "-archivePath".into(),
            self.archive_path().into(),
            "-exportOptionsPlist".into(),
            self.options_path().into(),
            "-exportPath".into(),
            self.export_path().into(),
        ];
        args.extend(self.auth_args());
        args
    }

    /// Export options that sign for App Store Connect and upload, keeping the
    /// version and build the person confirmed.
    pub(crate) fn export_options(&self) -> String {
        let escape = |text: &str| {
            text.replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
        };
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>destination</key>
	<string>upload</string>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
	<key>method</key>
	<string>{}</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>teamID</key>
	<string>{}</string>
	<key>uploadSymbols</key>
	<true/>
</dict>
</plist>
"#,
            escape(&self.export_method),
            escape(&self.development_team)
        )
    }
}

/// Deletes the key when the upload ends, however it ends.
struct KeyFile(PathBuf);

impl Drop for KeyFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// How App Store Connect's processing of an uploaded build ended.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Processing {
    Ready,
    Rejected(String),
    Unfinished,
    Stopped,
    Unchecked(String),
}

/// Runs an upload to its end: archive, export with upload, then
/// `processing` to follow App Store Connect. Every outcome is saved.
pub(crate) fn execute(plan: &Plan, job: &Arc<Job>, processing: impl FnOnce(&Job) -> Processing) {
    let result = steps(plan, job, processing);
    job.flush();
    job.update(|state| {
        state.finished_at = Some(chrono::Utc::now().to_rfc3339());
        match result {
            Ok(Some(note)) => {
                state.phase = Phase::Done;
                state.processing = Some(note);
            }
            Ok(None) => state.phase = Phase::Canceled,
            Err(error) => {
                state.phase = Phase::Failed;
                state.error = Some(error);
            }
        }
    });
}

/// `Ok(None)` when canceled before the upload finished.
fn steps(
    plan: &Plan,
    job: &Arc<Job>,
    processing: impl FnOnce(&Job) -> Processing,
) -> Result<Option<String>, String> {
    let failed = |what: &str, error: std::io::Error| format!("{what}: {error}");
    std::fs::create_dir_all(&plan.folder)
        .map_err(|e| failed("The upload folder could not be made", e))?;
    std::fs::write(plan.options_path(), plan.export_options())
        .map_err(|e| failed("ExportOptions.plist could not be written", e))?;
    let key_file = match (&plan.auth, plan.key_path()) {
        (Some(auth), Some(path)) => {
            let folder = plan.key_folder();
            let _ = std::fs::remove_dir_all(&folder);
            let mut builder = std::fs::DirBuilder::new();
            #[cfg(unix)]
            std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
            builder
                .create(&folder)
                .map_err(|e| failed("The signing key could not be prepared", e))?;
            let guard = KeyFile(folder);
            project_secrets::write_private(&path, auth.key.as_bytes())
                .map_err(|e| failed("The signing key could not be prepared", e))?;
            Some(guard)
        }
        _ => None,
    };
    job.note(&format!("$ xcodebuild {}", shown(&plan.archive_args())));
    let archived = run_step(plan, job, plan.archive_args(), ARCHIVE_LIMITS)?;
    if !archived.success {
        return if job.canceled() {
            Ok(None)
        } else {
            Err(failure("The archive", &archived, job))
        };
    }
    job.update(|state| state.phase = Phase::Exporting);
    job.note(&format!("$ xcodebuild {}", shown(&plan.export_args())));
    let exported = run_step(plan, job, plan.export_args(), EXPORT_LIMITS)?;
    if !exported.success {
        return if job.canceled() {
            Ok(None)
        } else {
            Err(failure("The upload", &exported, job))
        };
    }
    drop(key_file);
    job.update(|state| {
        state.phase = Phase::Processing;
        state.processing =
            Some("Uploaded. Waiting for App Store Connect to list the build.".into());
    });
    match processing(job) {
        Processing::Ready => Ok(Some("Processed. The build is ready to test in TestFlight.".into())),
        Processing::Rejected(state) => Err(format!(
            "The upload finished, but App Store Connect could not process the build ({state}). Apple emails the reason to the account holder."
        )),
        Processing::Unfinished => Ok(Some(
            "Uploaded. App Store Connect is still processing it and emails when it finishes.".into(),
        )),
        Processing::Stopped => Ok(Some("Uploaded. Jackalope stopped following its processing.".into())),
        Processing::Unchecked(why) => Ok(Some(format!("Uploaded. Processing was not followed: {why}"))),
    }
}

/// Arguments as the log shows them; paths are app data, never secret.
fn shown(args: &[OsString]) -> String {
    args.iter()
        .map(|arg| {
            let arg = arg.to_string_lossy();
            if arg.contains(' ') {
                format!("'{arg}'")
            } else {
                arg.into_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn run_step(
    plan: &Plan,
    job: &Arc<Job>,
    args: Vec<OsString>,
    limits: Limits,
) -> Result<CommandResult, String> {
    let mut command = plan.program.command(&plan.workspace);
    command.args(args);
    let sink = job.clone();
    let result = process_control::run_supervised(
        command,
        limits,
        || job.canceled(),
        move |bytes, stderr| sink.output(bytes, stderr),
    );
    job.flush();
    result
}

fn failure(step: &str, result: &CommandResult, job: &Job) -> String {
    if let Some(why) = result.interruption() {
        return format!("{step} {why}.");
    }
    let exit = result
        .exit_code
        .map(|code| format!(" (exit {code})"))
        .unwrap_or_default();
    let errors = job.take_errors();
    let detail = if errors.is_empty() {
        job.recent(8).join("\n")
    } else {
        errors.join("\n")
    };
    crate::commands::xcode::macros::explain(&format!("{step} failed{exit}:\n{detail}"), None)
}

static JOBS: LazyLock<Mutex<HashMap<String, Arc<Job>>>> = LazyLock::new(Default::default);

fn folder(runtime: &TaskRuntime, run_id: &str) -> Result<PathBuf, String> {
    let plain = !run_id.is_empty()
        && run_id.len() <= 120
        && run_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if !plain {
        return Err("Task not found".into());
    }
    Ok(runtime.data_directory().join("testflight").join(run_id))
}

/// The current or last upload of a run: from memory while the app runs it,
/// otherwise from its saved record.
fn status(record: &Path, run_id: &str) -> Option<UploadState> {
    if let Some(job) = JOBS.lock().unwrap().get(run_id) {
        return Some(job.snapshot());
    }
    let mut state: UploadState = serde_json::from_slice(&std::fs::read(record).ok()?).ok()?;
    if state.phase.active() {
        state.phase = Phase::Failed;
        state.error = Some("Jackalope closed before the upload finished. Check App Store Connect before uploading again.".into());
    }
    Some(state)
}

/// A build App Store Connect received.
pub(crate) struct Uploaded<'a> {
    pub app_id: &'a str,
    pub version: &'a str,
    pub build: &'a str,
}

/// Follows App Store Connect's processing of the uploaded build, checking
/// `checks` times `interval` apart.
pub(crate) async fn follow_processing(
    api: &Api,
    build: &Uploaded<'_>,
    (interval, checks): (Duration, u32),
    canceled: impl Fn() -> bool,
    report: impl Fn(String),
) -> Processing {
    for check in 0..checks {
        if check > 0 {
            let mut waited = Duration::ZERO;
            while waited < interval {
                if canceled() {
                    return Processing::Stopped;
                }
                let step = Duration::from_millis(500).min(interval - waited);
                tokio::time::sleep(step).await;
                waited += step;
            }
        }
        if canceled() {
            return Processing::Stopped;
        }
        match api
            .build_state(build.app_id, build.version, build.build)
            .await
        {
            Ok(Some(state)) if state == "VALID" => return Processing::Ready,
            Ok(Some(state)) if state == "INVALID" || state == "FAILED" => {
                return Processing::Rejected(state)
            }
            Ok(Some(state)) => report(format!(
                "App Store Connect is processing the build ({state})."
            )),
            Ok(None) => report("Uploaded. Waiting for App Store Connect to list the build.".into()),
            Err(error) => report(error),
        }
    }
    Processing::Unfinished
}

fn find_run(runtime: &TaskRuntime, id: &str) -> Result<super::tasks::TaskRun, String> {
    runtime
        .run_snapshot(id)
        .ok_or_else(|| "Task not found".to_string())
}

fn workspace(run: &super::tasks::TaskRun) -> Result<PathBuf, String> {
    let path = PathBuf::from(&run.workspace);
    if run.workspace.is_empty() || !path.is_dir() {
        return Err("This task's workspace is no longer available.".into());
    }
    Ok(path)
}

fn require_xcode() -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("TestFlight uploads need a Mac with Xcode.".into());
    }
    if xcode::toolchain().is_none() {
        return Err("Install Xcode to upload to TestFlight.".into());
    }
    Ok(())
}

async fn gather(
    runtime: &TaskRuntime,
    id: &str,
) -> Result<(super::tasks::TaskRun, Option<Saved>, Info), String> {
    require_xcode()?;
    let run = find_run(runtime, id)?;
    let workspace = workspace(&run)?;
    let root = app_store_connect::root(runtime);
    let project_id = run.project_id.clone();
    let connection =
        tauri::async_runtime::spawn_blocking(move || app_store_connect::load(&root, &project_id))
            .await
            .map_err(|error| error.to_string())??;
    let configured = connection.as_ref().and_then(|saved| saved.scheme.clone());
    let read_in = workspace.clone();
    let local = tauri::async_runtime::spawn_blocking(move || {
        read_local(&Program::Xcrun, &read_in, configured.as_deref())
    })
    .await
    .map_err(|error| error.to_string())??;
    let remote = match &connection {
        Some(saved) => read_remote(Api::new(saved), &local.settings.bundle_id).await,
        None => Remote::default(),
    };
    let info = assess(&workspace, local, connection.as_ref(), remote);
    Ok((run, connection, info))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    /// The workspace or project relative to the task workspace.
    pub xcode_project: Option<String>,
    pub connection: bool,
    pub upload: Option<UploadState>,
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::testflight::task_testflight_available,
            commands::testflight::task_testflight_info,
            commands::testflight::task_testflight_set_build,
            commands::testflight::task_testflight_upload,
            commands::testflight::task_testflight_status,
            commands::testflight::task_testflight_cancel,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

/// Whether a task can offer an upload: its Xcode project, the project's
/// connection, and its current or last upload. Reads no build settings.
#[tauri::command]
pub async fn task_testflight_available(
    id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<Availability, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let run = find_run(&runtime, &id)?;
        let record = folder(&runtime, &id)?.join("upload.json");
        let upload = status(&record, &id);
        let xcode_project = cfg!(target_os = "macos")
            .then(|| workspace(&run).ok())
            .flatten()
            .and_then(|path| {
                find_container(&path).map(|container| {
                    container
                        .path()
                        .strip_prefix(&path)
                        .unwrap_or(container.path())
                        .to_string_lossy()
                        .into_owned()
                })
            });
        let connection = xcode_project.is_some()
            && app_store_connect::load(&app_store_connect::root(&runtime), &run.project_id)?
                .is_some();
        Ok(Availability {
            xcode_project,
            connection,
            upload,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// The app, version and build the task's workspace would upload, what App
/// Store Connect last received, and anything that blocks the upload.
#[tauri::command]
pub async fn task_testflight_info(
    id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<Info, String> {
    Ok(gather(state.inner(), &id).await?.2)
}

/// Sets the build number in the task workspace, as a change the person
/// reviews like any other. Nothing is committed.
#[tauri::command]
pub async fn task_testflight_set_build(
    id: String,
    build: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<Info, String> {
    let build = build.trim().to_string();
    if !valid_build(&build) {
        return Err("Use one to three numbers separated by periods, such as 14 or 1.0.14.".into());
    }
    let runtime = state.inner().clone();
    let (run, _, info) = gather(&runtime, &id).await?;
    if run.status.is_active() {
        return Err("Wait for the agent to finish before changing the build number.".into());
    }
    if JOBS
        .lock()
        .unwrap()
        .get(&id)
        .is_some_and(|job| job.snapshot().phase.active())
    {
        return Err("Wait for the upload to finish.".into());
    }
    if info.build != build {
        let workspace = workspace(&run)?;
        let settings = info.local.settings.clone();
        let old = info.build.clone();
        tauri::async_runtime::spawn_blocking(move || {
            set_build_number(&workspace, &settings, &old, &build)
        })
        .await
        .map_err(|error| error.to_string())??;
    }
    Ok(gather(&runtime, &id).await?.2)
}

/// Archives the task workspace and uploads it, after the person confirmed
/// this app, version and build. Refuses when the project now builds
/// something else.
#[tauri::command]
pub async fn task_testflight_upload(
    id: String,
    bundle_id: String,
    version: String,
    build: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<UploadState, String> {
    let runtime = state.inner().clone();
    if JOBS
        .lock()
        .unwrap()
        .get(&id)
        .is_some_and(|job| job.snapshot().phase.active())
    {
        return Err("This task is already uploading.".into());
    }
    let (run, connection, info) = gather(&runtime, &id).await?;
    if run.status.is_active() {
        return Err("Wait for the agent to finish before uploading.".into());
    }
    let saved = connection
        .ok_or("Connect App Store Connect under Project settings → Integrations first.")?;
    if let Some(blocked) = &info.blocked {
        return Err(blocked.clone());
    }
    if (
        info.bundle_id.as_str(),
        info.version.as_str(),
        info.build.as_str(),
    ) != (bundle_id.as_str(), version.as_str(), build.as_str())
    {
        return Err(format!(
            "The project now builds {} {} ({}). Review it and confirm again.",
            info.bundle_id, info.version, info.build
        ));
    }
    let base = folder(&runtime, &id)?;
    // Only the latest upload's archive is kept for a task.
    let current = base.join("current");
    let _ = std::fs::remove_dir_all(&current);
    std::fs::create_dir_all(&current)
        .map_err(|error| format!("The upload folder could not be made: {error}"))?;
    let local = &info.local;
    let settings = if local.settings.development_team.is_none() {
        vec![format!("DEVELOPMENT_TEAM={}", saved.development_team)]
    } else {
        Vec::new()
    };
    let plan = Plan {
        program: Program::Xcrun,
        workspace: workspace(&run)?,
        container: local.container.clone(),
        scheme: local.scheme.clone(),
        development_team: saved.development_team.clone(),
        settings,
        export_method: saved.export_method().to_string(),
        auth: Some(Auth {
            key: saved.key.clone(),
            key_id: saved.key_id.clone(),
            issuer_id: saved.issuer_id.clone(),
        }),
        folder: current.clone(),
    };
    let log_path = current.join("upload.log");
    let job = Arc::new(Job::new(
        UploadState {
            run_id: id.clone(),
            phase: Phase::Archiving,
            app_name: info.app_name.clone(),
            bundle_id: info.bundle_id.clone(),
            version: info.version.clone(),
            build: info.build.clone(),
            started_at: chrono::Utc::now().to_rfc3339(),
            finished_at: None,
            log: Vec::new(),
            error: None,
            processing: None,
            log_path: log_path.to_string_lossy().into_owned(),
        },
        base.join("upload.json"),
        &log_path,
    ));
    JOBS.lock().unwrap().insert(id.clone(), job.clone());
    job.save();
    let started = job.snapshot();
    let app_id = info.app_id.clone();
    std::thread::spawn(move || {
        let (version, build) = (info.version.clone(), info.build.clone());
        execute(&plan, &job, |job| {
            let Some(app_id) = app_id else {
                return Processing::Unchecked(
                    "App Store Connect did not return the app's ID.".into(),
                );
            };
            let api = match Api::new(&saved) {
                Ok(api) => api,
                Err(error) => return Processing::Unchecked(error),
            };
            let uploaded = Uploaded {
                app_id: &app_id,
                version: &version,
                build: &build,
            };
            tauri::async_runtime::block_on(follow_processing(
                &api,
                &uploaded,
                (PROCESSING_INTERVAL, PROCESSING_CHECKS),
                || job.canceled(),
                |note| job.update(|state| state.processing = Some(note)),
            ))
        });
        JOBS.lock().unwrap().remove(&job.snapshot().run_id);
    });
    Ok(started)
}

#[tauri::command]
pub async fn task_testflight_status(
    id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<Option<UploadState>, String> {
    let record = folder(state.inner(), &id)?.join("upload.json");
    Ok(status(&record, &id))
}

/// Stops an upload. Before the upload finishes, xcodebuild is stopped; after,
/// Jackalope only stops following App Store Connect's processing.
#[tauri::command]
pub async fn task_testflight_cancel(
    id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<Option<UploadState>, String> {
    if let Some(job) = JOBS.lock().unwrap().get(&id) {
        job.canceled.store(true, Ordering::Relaxed);
        job.note("Canceling…");
    }
    let record = folder(state.inner(), &id)?.join("upload.json");
    Ok(status(&record, &id))
}

#[cfg(test)]
#[path = "testflight_tests.rs"]
mod tests;
