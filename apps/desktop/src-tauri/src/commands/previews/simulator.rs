//! The iOS kind of managed preview. For a workspace whose Xcode project
//! targets iOS, Preview builds the app for the task's own Simulator into the
//! workspace's DerivedData, installs and launches it, and lets the person see
//! and drive it: frames come from `simctl io screenshot`, taps and typing go
//! through the bundled XCUITest driver, and appearance, text size and links go
//! through `simctl`. A running preview holds its device and driver, and lives
//! in the same preview map as web previews, so the same ownership checks
//! apply. Review captures reuse the build here (see `review/ios.rs`).

use super::super::{
    harness::png_dimensions,
    process_control,
    simulator::{self, device as simctl},
    simulators::{self, Device},
    source_packages,
    tasks::TaskRuntime,
    xcode::{
        self,
        project::{Container, XcodeProject},
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant, SystemTime},
};

const BUILD_LIMIT: Duration = Duration::from_secs(30 * 60);
const BUILD_STALL: Duration = Duration::from_secs(10 * 60);
const SETTINGS_TIMEOUT: Duration = Duration::from_secs(90);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(180);
/// The newest build output kept for the Preview log, in characters.
pub(super) const OUTPUT_LIMIT: usize = 64_000;
/// The longest a custom build command may be.
pub const COMMAND_LIMIT: usize = 4000;

/// Dynamic Type sizes the toolbar offers, smallest first.
pub const CONTENT_SIZES: &[&str] = &[
    "extra-small",
    "small",
    "medium",
    "large",
    "extra-large",
    "extra-extra-large",
    "extra-extra-extra-large",
    "accessibility-medium",
    "accessibility-large",
    "accessibility-extra-large",
    "accessibility-extra-extra-large",
    "accessibility-extra-extra-extra-large",
];

/// Element types that only group others; hit-testing passes over them unless
/// they carry a label or identifier of their own.
const STRUCTURAL: &[&str] = &[
    "application",
    "window",
    "other",
    "group",
    "layoutArea",
    "layoutItem",
    "scrollView",
    "table",
    "collectionView",
];

// MARK: Target and build

/// Whether and how a workspace runs in the Simulator.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    /// Why it cannot run here, such as no Xcode; `None` when it can.
    pub issue: Option<String>,
    pub scheme: Option<String>,
    /// The build Jackalope runs without a saved command, as shell text.
    pub build_command: String,
}

/// The project as a Simulator preview builds it: an Xcode workspace or project
/// that targets iOS. Swift packages and other platforms have no app to run.
fn app_project(workspace: &Path) -> Option<XcodeProject> {
    xcode::project::find(workspace)
        .filter(|project| project.ios && project.container != Container::Package)
}

/// The project with a scheme, asking `xcodebuild -list` only when the
/// project files name none.
fn with_scheme(workspace: &Path, project: XcodeProject) -> XcodeProject {
    if project.scheme.is_some() {
        return project;
    }
    xcode::project::detect(workspace).unwrap_or(project)
}

/// How `workspace` runs in the Simulator, or `None` when it is not an iOS app.
pub fn target(workspace: &Path) -> Option<Target> {
    let project = with_scheme(workspace, app_project(workspace)?);
    let issue = if !simulator::supported() {
        Some("The iOS Simulator runs only on a Mac.".to_string())
    } else if xcode::toolchain().is_none() {
        Some(xcode::readiness_issue(workspace).unwrap_or_else(|| {
            "Running in the Simulator needs Xcode. Install it from the App Store and open it once."
                .into()
        }))
    } else if project.scheme.is_none() {
        Some("Jackalope could not find a scheme to build. Share the app's scheme in Xcode (Product → Scheme → Manage Schemes → Shared), or save a build command.".into())
    } else {
        None
    };
    let build_command = shell_text(&build_args(
        &project,
        project.scheme.as_deref().unwrap_or("<scheme>"),
        "$JACKALOPE_SIMULATOR_UDID",
        Path::new("$JACKALOPE_DERIVED_DATA"),
    ));
    Some(Target {
        issue,
        scheme: project.scheme,
        build_command: format!("xcodebuild {build_command}"),
    })
}

fn shell_text(args: &[String]) -> String {
    args.iter()
        .map(|arg| {
            if arg.starts_with('$') || arg.starts_with("id=$") {
                format!("\"{arg}\"")
            } else if arg
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_./=:".contains(&b))
            {
                arg.clone()
            } else {
                format!("'{}'", arg.replace('\'', "'\\''"))
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn container_args(project: &XcodeProject) -> Vec<String> {
    match (&project.path, project.container) {
        (Some(path), Container::Workspace) => vec!["-workspace".into(), path.clone()],
        (Some(path), Container::Project) => vec!["-project".into(), path.clone()],
        _ => Vec::new(),
    }
}

/// `xcodebuild` arguments that build the app for one Simulator into `derived`.
pub(super) fn build_args(
    project: &XcodeProject,
    scheme: &str,
    udid: &str,
    derived: &Path,
) -> Vec<String> {
    let mut args = vec!["build".to_string()];
    args.extend(container_args(project));
    args.extend([
        "-scheme".into(),
        scheme.into(),
        "-destination".into(),
        format!("id={udid}"),
        "-derivedDataPath".into(),
        derived.to_string_lossy().into_owned(),
    ]);
    args
}

/// `xcodebuild` arguments that print the same build's settings as JSON.
pub(super) fn settings_args(
    project: &XcodeProject,
    scheme: &str,
    udid: &str,
    derived: &Path,
) -> Vec<String> {
    let mut args = vec!["-showBuildSettings".to_string(), "-json".into()];
    args.extend(
        build_args(project, scheme, udid, derived)
            .into_iter()
            .skip(1),
    );
    args
}

/// The built app from `-showBuildSettings -json`: the application target's
/// `TARGET_BUILD_DIR/WRAPPER_NAME`. Test bundles and extensions are skipped.
pub(super) fn app_from_settings(output: &str) -> Option<PathBuf> {
    let start = output.find('[')?;
    let targets: Value = serde_json::from_str(&output[start..]).ok()?;
    targets.as_array()?.iter().find_map(|target| {
        let settings = &target["buildSettings"];
        let application = settings["PRODUCT_TYPE"]
            .as_str()
            .is_some_and(|kind| kind == "com.apple.product-type.application")
            || settings["WRAPPER_EXTENSION"] == "app";
        if !application || settings["PLATFORM_NAME"] != "iphonesimulator" {
            return None;
        }
        Some(
            Path::new(settings["TARGET_BUILD_DIR"].as_str()?)
                .join(settings["WRAPPER_NAME"].as_str()?),
        )
    })
}

/// The newest Simulator `.app` under `derived`, leaving out test runners.
pub(super) fn newest_app(derived: &Path) -> Option<PathBuf> {
    let mut found: Vec<(SystemTime, PathBuf)> = Vec::new();
    for configuration in std::fs::read_dir(derived.join("Build/Products"))
        .ok()?
        .flatten()
    {
        if !configuration
            .file_name()
            .to_string_lossy()
            .ends_with("-iphonesimulator")
        {
            continue;
        }
        for entry in std::fs::read_dir(configuration.path())
            .into_iter()
            .flatten()
            .flatten()
        {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.ends_with(".app")
                && !name.ends_with("-Runner.app")
                && entry.path().join("Info.plist").is_file()
            {
                let modified = entry
                    .metadata()
                    .and_then(|meta| meta.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                found.push((modified, entry.path()));
            }
        }
    }
    found.into_iter().max().map(|(_, path)| path)
}

/// The workspace's DerivedData folder, as `JACKALOPE_DERIVED_DATA` names it.
pub(super) fn derived_data(workspace: &Path) -> PathBuf {
    source_packages::environment(workspace)[0].1.clone()
}

/// A custom build command ready to run in `workspace` with the device and
/// DerivedData variables.
fn custom_command(command: &str, workspace: &Path, device: &Device) -> Command {
    let mut process = Command::new("/bin/sh");
    process
        .args(["-c", command])
        .current_dir(workspace)
        .envs(device.environment())
        .envs(source_packages::environment(workspace))
        .env_remove("JACKALOPE_BRIDGE_TOKEN")
        .env_remove("JACKALOPE_BRIDGE_URL");
    xcode::apply(&mut process);
    process
}

/// Checks a saved build command before it runs.
pub fn valid_command(command: &str) -> Result<&str, String> {
    let command = command.trim();
    if command.is_empty() || command.len() > COMMAND_LIMIT || command.contains('\0') {
        return Err(format!(
            "Use a build command of at most {COMMAND_LIMIT} characters, or leave it empty to use the detected build."
        ));
    }
    Ok(command)
}

/// Builds the workspace's app for `device` and returns the built `.app`.
/// `custom` replaces the detected `xcodebuild build`; it must build into
/// `$JACKALOPE_DERIVED_DATA`. Output goes to `observe` as it arrives.
pub(super) fn build(
    workspace: &Path,
    device: &Device,
    custom: Option<&str>,
    canceled: &(dyn Fn() -> bool + Sync),
    observe: impl Fn(&[u8]) + Send + Sync + 'static,
) -> Result<PathBuf, String> {
    let derived = derived_data(workspace);
    let detected = match custom {
        Some(_) => None,
        None => {
            let project = app_project(workspace)
                .ok_or("This workspace has no Xcode project that targets iOS.")?;
            let project = with_scheme(workspace, project);
            let path = project
                .path
                .clone()
                .ok_or("Jackalope could not tell which Xcode project to build.")?;
            if !workspace.join(&path).exists() {
                return Err(format!(
                    "{path} does not exist yet. Run the project's preparation (for example xcodegen generate) first, or save a build command."
                ));
            }
            let scheme = project
                .scheme
                .clone()
                .ok_or("Jackalope could not find a scheme to build. Share the app's scheme in Xcode, or save a build command.")?;
            Some((project, scheme))
        }
    };
    let process = match (custom, &detected) {
        (Some(command), _) => custom_command(valid_command(command)?, workspace, device),
        (None, Some((project, scheme))) => {
            let mut process = xcode::xcrun("xcodebuild");
            process
                .args(build_args(project, scheme, &device.udid, &derived))
                .current_dir(workspace)
                .env_remove("JACKALOPE_BRIDGE_TOKEN")
                .env_remove("JACKALOPE_BRIDGE_URL");
            process
        }
        (None, None) => unreachable!(),
    };
    let result = process_control::run_supervised(
        process,
        process_control::Limits::supervised(BUILD_LIMIT, BUILD_STALL),
        canceled,
        move |bytes, _| observe(bytes),
    )?;
    if canceled() {
        return Err("Canceled.".into());
    }
    if !result.success {
        let output = format!("{}\n{}", result.stdout, result.stderr);
        return Err(match result.interruption() {
            Some(why) => format!("The build {why}."),
            None => format!(
                "The build failed (exit {}):\n{}",
                result
                    .exit_code
                    .map_or("unknown".to_string(), |code| code.to_string()),
                xcode::macros::explain(
                    &simulator::failure_tail(&output),
                    detected
                        .as_ref()
                        .and_then(|(project, _)| project.path.as_deref())
                        .map(Path::new)
                )
            ),
        });
    }
    let from_settings = detected.and_then(|(project, scheme)| {
        let mut process = xcode::xcrun("xcodebuild");
        process
            .args(settings_args(&project, &scheme, &device.udid, &derived))
            .current_dir(workspace);
        process_control::run(process, SETTINGS_TIMEOUT)
            .ok()
            .filter(|output| output.success)
            .and_then(|output| app_from_settings(&output.stdout))
            .filter(|app| app.join("Info.plist").is_file())
    });
    from_settings.or_else(|| newest_app(&derived)).ok_or_else(|| {
        format!(
            "The build finished, but no Simulator app was found in {}. A saved build command must build with -derivedDataPath \"$JACKALOPE_DERIVED_DATA\".",
            derived.join("Build/Products").display()
        )
    })
}

/// Installs `app` on the device and returns its bundle identifier.
pub(super) fn install(udid: &str, app: &Path) -> Result<String, String> {
    let bundle = simctl::plist_value(&app.join("Info.plist"), "CFBundleIdentifier")?;
    simulator::bundle_id(Some(&bundle))?;
    simctl::run(&simctl::install(udid, app), INSTALL_TIMEOUT)?;
    Ok(bundle)
}

/// Launches the app, ending a running copy first.
pub(super) fn launch(udid: &str, bundle: &str) -> Result<(), String> {
    simctl::run(&simctl::launch(udid, bundle, &[], &[]), simctl::TIMEOUT).map(|_| ())
}

/// A `simctl ui` setting's current value, such as the appearance.
pub(super) fn ui_value(udid: &str, option: &str) -> Option<String> {
    let value = simctl::run(
        &simctl::Simctl {
            args: vec!["ui".into(), udid.into(), option.into()],
            ..Default::default()
        },
        simctl::TIMEOUT,
    )
    .ok()?;
    let value = value.trim().to_string();
    (!value.is_empty() && value != "unknown" && value != "unsupported").then_some(value)
}

/// Appends build output, keeping the newest [`OUTPUT_LIMIT`] characters.
pub(super) fn append_output(output: &Mutex<String>, text: &str) {
    let Ok(mut output) = output.lock() else {
        return;
    };
    output.push_str(text);
    if output.len() > OUTPUT_LIMIT + OUTPUT_LIMIT / 4 {
        let mut cut = output.len() - OUTPUT_LIMIT;
        while !output.is_char_boundary(cut) {
            cut += 1;
        }
        output.drain(..cut);
    }
}

// MARK: Screen geometry

/// One element of the driver's snapshot, with its frame in points.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Element {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub label: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub identifier: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub value: String,
    /// x, y, width and height in points.
    pub frame: [f64; 4],
}

/// The elements of a `/snapshot` answer, depth first, without empty frames.
pub(super) fn flatten(snapshot: &Value) -> Vec<Element> {
    fn walk(node: &Value, out: &mut Vec<Element>) {
        let frame = &node["frame"];
        let rect = [0, 1, 2, 3].map(|index| frame[index].as_f64().unwrap_or(0.0));
        if rect[2] > 0.0 && rect[3] > 0.0 && out.len() < 5000 {
            let text = |key: &str| node[key].as_str().unwrap_or_default().to_string();
            out.push(Element {
                kind: text("type"),
                label: text("label"),
                identifier: text("id"),
                value: text("value"),
                frame: rect,
            });
        }
        for child in node["children"].as_array().into_iter().flatten() {
            walk(child, out);
        }
    }
    let mut out = Vec::new();
    walk(&snapshot["tree"], &mut out);
    out
}

/// The screen size in points from a `/snapshot` answer.
pub(super) fn screen_of(snapshot: &Value) -> Option<(f64, f64)> {
    let screen = &snapshot["screen"];
    let size = (screen[2].as_f64()?, screen[3].as_f64()?);
    (size.0 > 0.0 && size.1 > 0.0).then_some(size)
}

/// A point on the screen from a position on the frame, each axis from 0 to 1.
pub(super) fn device_point(x: f64, y: f64, screen: (f64, f64)) -> Result<(f64, f64), String> {
    if !(x.is_finite() && y.is_finite() && (0.0..=1.0).contains(&x) && (0.0..=1.0).contains(&y)) {
        return Err("Choose a point on the Simulator screen.".into());
    }
    // A point on the very edge would fall just outside the screen.
    let clamp = |value: f64, size: f64| (value * size).clamp(0.0, (size - 0.5).max(0.0));
    Ok((clamp(x, screen.0), clamp(y, screen.1)))
}

/// The element a person means at `point`: the smallest one that contains it,
/// passing over containers without a label or identifier when anything else
/// matches.
pub(super) fn hit(elements: &[Element], point: (f64, f64)) -> Option<&Element> {
    let contains = |element: &&Element| {
        let [x, y, width, height] = element.frame;
        point.0 >= x && point.0 <= x + width && point.1 >= y && point.1 <= y + height
    };
    let meaningful = |element: &&Element| {
        !STRUCTURAL.contains(&element.kind.as_str())
            || !element.label.is_empty()
            || !element.identifier.is_empty()
    };
    fn smallest(candidates: Vec<&Element>) -> Option<&Element> {
        candidates
            .into_iter()
            .min_by(|a, b| (a.frame[2] * a.frame[3]).total_cmp(&(b.frame[2] * b.frame[3])))
    }
    let inside: Vec<&Element> = elements
        .iter()
        .filter(contains)
        .filter(|element| element.kind != "application")
        .collect();
    smallest(inside.iter().copied().filter(meaningful).collect()).or_else(|| smallest(inside))
}

/// The pixel rectangle of an element in a screenshot `image` pixels wide and
/// high of a screen `screen` points, padded and kept inside the image.
pub(super) fn crop_rect(
    frame: [f64; 4],
    screen: (f64, f64),
    image: (u32, u32),
) -> Option<(u32, u32, u32, u32)> {
    let scale_x = f64::from(image.0) / screen.0;
    let scale_y = f64::from(image.1) / screen.1;
    if !(scale_x.is_finite() && scale_y.is_finite()) || scale_x <= 0.0 || scale_y <= 0.0 {
        return None;
    }
    let pad = 6.0;
    let left = ((frame[0] - pad) * scale_x).floor().max(0.0);
    let top = ((frame[1] - pad) * scale_y).floor().max(0.0);
    let right = ((frame[0] + frame[2] + pad) * scale_x)
        .ceil()
        .min(f64::from(image.0));
    let bottom = ((frame[1] + frame[3] + pad) * scale_y)
        .ceil()
        .min(f64::from(image.1));
    (right - left >= 1.0 && bottom - top >= 1.0).then(|| {
        (
            left as u32,
            top as u32,
            (right - left) as u32,
            (bottom - top) as u32,
        )
    })
}

/// Crops a PNG with `sips`, which ships with macOS.
pub(super) fn crop(png: &[u8], rect: (u32, u32, u32, u32)) -> Result<Vec<u8>, String> {
    let file = std::env::temp_dir().join(format!("jackalope-crop-{}.png", uuid::Uuid::new_v4()));
    std::fs::write(&file, png).map_err(|error| error.to_string())?;
    let (x, y, width, height) = rect;
    let mut command = Command::new("/usr/bin/sips");
    command
        .args(["-c", &height.to_string(), &width.to_string()])
        .args(["--cropOffset", &y.to_string(), &x.to_string()])
        .arg(&file)
        .arg("--out")
        .arg(&file);
    let result = process_control::run(command, Duration::from_secs(30));
    let bytes = match result {
        Ok(result) if result.success => std::fs::read(&file).map_err(|error| error.to_string()),
        Ok(result) => Err(format!(
            "Could not crop the screenshot: {}",
            result.stderr.trim()
        )),
        Err(error) => Err(error),
    };
    let _ = std::fs::remove_file(&file);
    bytes
}

// MARK: Actions

/// What the person asks the running app to do.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum Action {
    /// A tap at a position on the frame, each axis from 0 to 1.
    Tap {
        x: f64,
        y: f64,
    },
    /// Text typed into the focused field.
    Type {
        text: String,
    },
    Home,
    /// Turns the device between portrait and landscape.
    Rotate,
    Appearance {
        value: String,
    },
    ContentSize {
        value: String,
    },
    OpenUrl {
        url: String,
    },
}

/// How an action is carried out.
#[derive(Debug, PartialEq)]
pub(super) enum Plan {
    Driver(Value),
    Simctl(simctl::Simctl),
}

/// The command for an action on the device. Taps need the screen size in
/// points; rotation needs the current orientation.
pub(super) fn plan(
    action: &Action,
    udid: &str,
    bundle: &str,
    screen: Option<(f64, f64)>,
    landscape: bool,
) -> Result<Plan, String> {
    Ok(match action {
        Action::Tap { x, y } => {
            let screen = screen.ok_or("The Simulator screen size is not known yet.")?;
            let (x, y) = device_point(*x, *y, screen)?;
            Plan::Driver(json!({"action": "tap", "x": x, "y": y, "bundleId": bundle}))
        }
        Action::Type { text } => {
            if text.is_empty() || text.chars().count() > 5_000 || text.contains('\0') {
                return Err("Type between 1 and 5,000 characters.".into());
            }
            Plan::Driver(
                json!({"action": "type", "text": text, "bundleId": bundle, "bundleIds": [bundle]}),
            )
        }
        Action::Home => Plan::Driver(json!({"action": "press_button", "button": "home"})),
        Action::Rotate => Plan::Driver(json!({
            "action": "rotate",
            "orientation": if landscape { "portrait" } else { "landscape_left" },
        })),
        Action::Appearance { value } => {
            if !matches!(value.as_str(), "light" | "dark") {
                return Err("Choose light or dark.".into());
            }
            Plan::Simctl(simctl::ui(udid, "appearance", value))
        }
        Action::ContentSize { value } => {
            if !CONTENT_SIZES.contains(&value.as_str()) {
                return Err(format!("{value} is not a Dynamic Type size."));
            }
            Plan::Simctl(simctl::ui(udid, "content_size", value))
        }
        Action::OpenUrl { url } => {
            Plan::Simctl(simctl::open_url(udid, simulator::valid_url(Some(url))?))
        }
    })
}

/// The ref of the Open button in the "Open in “App”?" prompt iOS shows over
/// the app when a custom-scheme link is opened, from a `/snapshot` answer's
/// system alerts. The prompt's text is English on the Simulators Jackalope creates.
pub(super) fn open_button(snapshot: &Value) -> Option<String> {
    fn texts(node: &Value, out: &mut Vec<String>) {
        for key in ["label", "value"] {
            if let Some(text) = node[key].as_str() {
                out.push(text.to_string());
            }
        }
        for child in node["children"].as_array().into_iter().flatten() {
            texts(child, out);
        }
    }
    fn button(node: &Value) -> Option<String> {
        if node["type"] == "button" && node["label"] == "Open" {
            return node["ref"].as_str().map(str::to_string);
        }
        node["children"]
            .as_array()
            .into_iter()
            .flatten()
            .find_map(button)
    }
    snapshot["alerts"].as_array()?.iter().find_map(|alert| {
        let mut found = Vec::new();
        texts(alert, &mut found);
        found
            .iter()
            .any(|text| text.starts_with("Open in"))
            .then(|| button(alert))
            .flatten()
    })
}

/// Opens a link's app past the "Open in “App”?" prompt by tapping Open
/// through the driver, when the prompt appears within a few seconds.
pub(super) fn accept_open_prompt(
    runtime: &TaskRuntime,
    udid: &str,
    bundle: &str,
    progress: &(dyn Fn(&str) + Sync),
    stop: &(dyn Fn() -> bool + Sync),
) -> Result<bool, String> {
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        let tree = simulator::preview_call(
            runtime,
            udid,
            "/snapshot",
            &json!({"bundleId": bundle, "maxDepth": 30}),
            progress,
            stop,
        )?;
        if let Some(reference) = open_button(&tree) {
            simulator::preview_call(
                runtime,
                udid,
                "/act",
                &json!({"action": "tap", "ref": reference}),
                progress,
                stop,
            )?;
            std::thread::sleep(Duration::from_millis(600));
            return Ok(true);
        }
        if Instant::now() >= deadline || stop() {
            return Ok(false);
        }
        std::thread::sleep(Duration::from_millis(400));
    }
}

// MARK: Session

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    /// Waiting for the task's Simulator to boot.
    #[default]
    Booting,
    Building,
    Installing,
    Launching,
    Running,
    Failed,
    Stopped,
}

impl Phase {
    pub fn active(self) -> bool {
        !matches!(self, Phase::Failed | Phase::Stopped)
    }
}

/// The input driver behind taps and typing.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Input {
    #[default]
    Off,
    Starting,
    Ready,
    Failed,
}

/// What the Preview tab shows about a Simulator preview.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorPreview {
    pub udid: String,
    pub device: String,
    #[serde(default)]
    pub bundle_id: Option<String>,
    #[serde(default)]
    pub phase: String,
    #[serde(default)]
    pub input: String,
    #[serde(default)]
    pub input_error: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub appearance: Option<String>,
    #[serde(default)]
    pub content_size: Option<String>,
    #[serde(default)]
    pub landscape: bool,
}

#[derive(Default)]
struct State {
    phase: Phase,
    device: Option<Device>,
    bundle_id: Option<String>,
    error: Option<String>,
    input: Input,
    input_error: Option<String>,
    screen: Option<(f64, f64)>,
    elements: Vec<Element>,
    appearance: Option<String>,
    content_size: Option<String>,
    landscape: bool,
}

struct Worker {
    canceled: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

/// Holds the device and its driver while the preview runs.
struct Holds {
    _device: simulators::InUse,
    _driver: simulator::DriverHold,
}

/// One running Simulator preview.
pub(super) struct Session {
    runtime: TaskRuntime,
    run_id: String,
    workspace: String,
    custom: Option<String>,
    state: Mutex<State>,
    output: Arc<Mutex<String>>,
    worker: Mutex<Option<Worker>>,
    holds: Mutex<Option<Holds>>,
    stopped: AtomicBool,
}

impl Session {
    pub(super) fn new(
        runtime: TaskRuntime,
        run_id: &str,
        workspace: &str,
        custom: Option<String>,
        output: Arc<Mutex<String>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            runtime,
            run_id: run_id.to_string(),
            workspace: workspace.to_string(),
            custom,
            state: Mutex::default(),
            output,
            worker: Mutex::default(),
            holds: Mutex::default(),
            stopped: AtomicBool::new(false),
        })
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    pub(super) fn phase(&self) -> Phase {
        self.state().phase
    }

    pub(super) fn view(&self) -> SimulatorPreview {
        let state = self.state();
        SimulatorPreview {
            udid: state
                .device
                .as_ref()
                .map(|device| device.udid.clone())
                .unwrap_or_default(),
            device: state
                .device
                .as_ref()
                .map(|device| device.name.clone())
                .unwrap_or_default(),
            bundle_id: state.bundle_id.clone(),
            phase: serde_json::to_value(state.phase)
                .ok()
                .and_then(|value| value.as_str().map(str::to_string))
                .unwrap_or_default(),
            input: serde_json::to_value(state.input)
                .ok()
                .and_then(|value| value.as_str().map(str::to_string))
                .unwrap_or_default(),
            input_error: state.input_error.clone(),
            error: state.error.clone(),
            appearance: state.appearance.clone(),
            content_size: state.content_size.clone(),
            landscape: state.landscape,
        }
    }

    fn say(&self, line: &str) {
        append_output(&self.output, &format!("{line}\n"));
    }

    /// Builds, installs and launches the app in the background, ending any
    /// build already under way first.
    pub(super) fn start(self: &Arc<Self>) {
        self.cancel_worker();
        let canceled = Arc::new(AtomicBool::new(false));
        {
            let mut state = self.state();
            state.phase = Phase::Booting;
            state.error = None;
        }
        let session = self.clone();
        let flag = canceled.clone();
        let handle = std::thread::spawn(move || session.run(&flag));
        *self
            .worker
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = Some(Worker { canceled, handle });
    }

    fn run(self: &Arc<Self>, canceled: &Arc<AtomicBool>) {
        let stop = || canceled.load(Ordering::SeqCst) || self.stopped.load(Ordering::SeqCst);
        match self.launch_app(&stop) {
            Ok(()) => {}
            Err(_) if stop() => {}
            Err(error) => {
                self.say(&error);
                {
                    let mut state = self.state();
                    state.phase = Phase::Failed;
                    state.error = Some(error);
                    state.input = Input::Off;
                }
                // A failed preview keeps its log but not the device or driver.
                self.holds
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner())
                    .take();
            }
        }
    }

    fn set_phase(&self, phase: Phase) {
        self.state().phase = phase;
    }

    fn launch_app(self: &Arc<Self>, stop: &(dyn Fn() -> bool + Sync)) -> Result<(), String> {
        let saved = self.state().device.clone();
        let device = match saved {
            None => {
                self.say("Waiting for the task's Simulator to boot…");
                let device = simulators::ensure(&self.runtime, &self.run_id, stop)?;
                self.state().device = Some(device.clone());
                device
            }
            Some(device) => simulators::boot(&device, stop)?,
        };
        {
            let mut holds = self
                .holds
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            if holds.is_none() {
                *holds = Some(Holds {
                    _device: simulators::InUse::new(&device),
                    _driver: simulator::DriverHold::new(&device.udid),
                });
            }
        }
        self.set_phase(Phase::Building);
        self.say(&format!("Building for {} ({})", device.name, device.udid));
        let output = self.output.clone();
        let started = Instant::now();
        let app = build(
            Path::new(&self.workspace),
            &device,
            self.custom.as_deref(),
            stop,
            move |bytes| append_output(&output, &String::from_utf8_lossy(bytes)),
        )?;
        self.say(&format!(
            "Built {} in {}s",
            app.file_name().unwrap_or_default().to_string_lossy(),
            started.elapsed().as_secs()
        ));
        if stop() {
            return Err("Canceled.".into());
        }
        self.set_phase(Phase::Installing);
        let bundle = install(&device.udid, &app)?;
        if stop() {
            return Err("Canceled.".into());
        }
        self.set_phase(Phase::Launching);
        launch(&device.udid, &bundle)?;
        self.say(&format!("Launched {bundle}"));
        {
            let mut state = self.state();
            state.bundle_id = Some(bundle.clone());
            state.appearance = ui_value(&device.udid, "appearance");
            state.content_size = ui_value(&device.udid, "content_size");
            state.phase = Phase::Running;
        }
        self.start_input(stop, &device.udid, &bundle);
        Ok(())
    }

    /// Starts the input driver so the first tap does not wait for it, then
    /// brings the app back in front of the driver's runner.
    fn start_input(&self, stop: &(dyn Fn() -> bool + Sync), udid: &str, bundle: &str) {
        if self.state().input == Input::Ready {
            return;
        }
        self.state().input = Input::Starting;
        let result = self
            .driver(
                udid,
                "/app",
                &json!({"action": "activate", "bundleId": bundle}),
                stop,
            )
            .and_then(|_| self.snapshot(udid, bundle, stop));
        let mut state = self.state();
        match result {
            Ok(_) => {
                state.input = Input::Ready;
                state.input_error = None;
            }
            Err(_) if stop() => state.input = Input::Off,
            Err(error) => {
                state.input = Input::Failed;
                state.input_error = Some(error);
            }
        }
    }

    fn driver(
        &self,
        udid: &str,
        path: &str,
        body: &Value,
        stop: &(dyn Fn() -> bool + Sync),
    ) -> Result<Value, String> {
        let output = self.output.clone();
        let progress = move |line: &str| append_output(&output, &format!("{line}\n"));
        simulator::preview_call(&self.runtime, udid, path, body, &progress, stop)
    }

    /// Reads the app in front, remembering its elements and the screen size.
    fn snapshot(
        &self,
        udid: &str,
        bundle: &str,
        stop: &(dyn Fn() -> bool + Sync),
    ) -> Result<(Option<(f64, f64)>, Vec<Element>), String> {
        let tree = self.driver(
            udid,
            "/snapshot",
            &json!({"bundleIds": [bundle], "alerts": true}),
            stop,
        )?;
        let screen = screen_of(&tree);
        let elements = flatten(&tree);
        let mut state = self.state();
        if screen.is_some() {
            state.screen = screen;
        }
        state.elements = elements.clone();
        Ok((state.screen, elements))
    }

    /// The running device and app, or why the preview cannot act yet.
    fn running(&self) -> Result<(String, String), String> {
        let state = self.state();
        match (&state.device, &state.bundle_id, state.phase) {
            (Some(device), Some(bundle), Phase::Running) => {
                Ok((device.udid.clone(), bundle.clone()))
            }
            (_, _, Phase::Failed | Phase::Stopped) => {
                Err("The Simulator preview is not running. Start it again.".into())
            }
            _ => Err("Wait for the app to launch.".into()),
        }
    }

    fn halted(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    /// A frame of the screen, scaled for the Preview tab.
    pub(super) fn frame(&self) -> Result<Frame, String> {
        let udid = self
            .state()
            .device
            .as_ref()
            .map(|device| device.udid.clone())
            .ok_or("The Simulator is not ready yet.")?;
        let png = simctl::capture(&udid, Some(simctl::VIEW_SIZE))?;
        let (width, height) = png_dimensions(&png)?;
        use base64::Engine as _;
        Ok(Frame {
            png: base64::engine::general_purpose::STANDARD.encode(png),
            width,
            height,
            captured_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    pub(super) fn act(&self, action: &Action) -> Result<(), String> {
        let (udid, bundle) = self.running()?;
        let (screen, landscape) = {
            let state = self.state();
            (state.screen, state.landscape)
        };
        let screen = match (action, screen) {
            (Action::Tap { .. }, None) => self.snapshot(&udid, &bundle, &|| self.halted())?.0,
            _ => screen,
        };
        match plan(action, &udid, &bundle, screen, landscape)? {
            Plan::Simctl(command) => {
                simctl::run(&command, simctl::TIMEOUT)?;
                if matches!(action, Action::OpenUrl { .. }) && self.state().input == Input::Ready {
                    let output = self.output.clone();
                    let progress = move |line: &str| append_output(&output, &format!("{line}\n"));
                    accept_open_prompt(&self.runtime, &udid, &bundle, &progress, &|| {
                        self.halted()
                    })?;
                }
            }
            Plan::Driver(body) => {
                self.driver(&udid, "/act", &body, &|| self.halted())?;
                self.state().input = Input::Ready;
            }
        }
        let mut state = self.state();
        match action {
            Action::Appearance { value } => state.appearance = Some(value.clone()),
            Action::ContentSize { value } => state.content_size = Some(value.clone()),
            // The screen's size in points swaps; the next tap reads it again.
            Action::Rotate => {
                state.landscape = !state.landscape;
                state.screen = None;
            }
            _ => {}
        }
        Ok(())
    }

    /// The elements on screen now, for highlighting in Select mode.
    pub(super) fn elements(&self) -> Result<Elements, String> {
        let (udid, bundle) = self.running()?;
        let (screen, elements) = self.snapshot(&udid, &bundle, &|| self.halted())?;
        Ok(Elements {
            screen: screen.map(|(width, height)| [width, height]),
            elements,
        })
    }

    /// The element at a frame position with a full-resolution screenshot.
    pub(super) fn select(&self, x: f64, y: f64) -> Result<Selected, String> {
        let (udid, bundle) = self.running()?;
        let (screen, elements) = self.snapshot(&udid, &bundle, &|| self.halted())?;
        let screen = screen.ok_or("The Simulator screen size is not known yet.")?;
        let point = device_point(x, y, screen)?;
        let element = hit(&elements, point)
            .cloned()
            .ok_or("Nothing selectable is at that point.")?;
        let png = simctl::capture(&udid, None)?;
        let image = png_dimensions(&png)?;
        let rect = crop_rect(element.frame, screen, image)
            .ok_or("The element is outside the screenshot.")?;
        Ok(Selected {
            png: crop(&png, rect)?,
            element,
            screen,
            udid,
            bundle,
        })
    }

    fn cancel_worker(&self) {
        let worker = self
            .worker
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .take();
        if let Some(worker) = worker {
            worker.canceled.store(true, Ordering::SeqCst);
            // Every step polls for cancellation, so this is quick.
            let deadline = Instant::now() + Duration::from_secs(20);
            while !worker.handle.is_finished() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }

    /// Whether a build, install or launch is under way.
    pub(super) fn busy(&self) -> bool {
        self.worker
            .lock()
            .ok()
            .and_then(|worker| worker.as_ref().map(|worker| !worker.handle.is_finished()))
            .unwrap_or(false)
    }

    /// Ends the build, closes the app and lets the device and driver go.
    pub(super) fn stop(&self, wait: bool) {
        self.stopped.store(true, Ordering::SeqCst);
        if wait {
            self.cancel_worker();
        } else if let Some(worker) = self
            .worker
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .as_ref()
        {
            worker.canceled.store(true, Ordering::SeqCst);
        }
        let (udid, bundle) = {
            let mut state = self.state();
            if state.phase.active() {
                state.phase = Phase::Stopped;
            }
            (
                state.device.as_ref().map(|device| device.udid.clone()),
                state.bundle_id.clone(),
            )
        };
        if let (Some(udid), Some(bundle), true) = (udid, bundle, wait) {
            let _ = simctl::run(&simctl::terminate(&udid, &bundle), Duration::from_secs(15));
        }
        self.holds
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .take();
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::SeqCst);
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    /// Base64 PNG, at most 1000 pixels on its longest side.
    pub png: String,
    pub width: u32,
    pub height: u32,
    pub captured_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Elements {
    /// The screen's width and height in points, once known.
    pub screen: Option<[f64; 2]>,
    pub elements: Vec<Element>,
}

pub(super) struct Selected {
    pub png: Vec<u8>,
    pub element: Element,
    pub screen: (f64, f64),
    pub udid: String,
    pub bundle: String,
}

impl Selected {
    /// What `.selection.json` records and the selection note shows.
    pub fn selection(&self, id: &str) -> Value {
        let element = &self.element;
        let mut tag = element.kind.clone();
        if !element.label.is_empty() {
            tag.push_str(&format!(
                " \"{}\"",
                element.label.chars().take(80).collect::<String>()
            ));
        } else if !element.identifier.is_empty() {
            tag.push_str(&format!(" #{}", element.identifier));
        }
        json!({
            "id": id,
            "url": format!("simulator://{}/{}", self.udid, self.bundle),
            "tag": tag,
            "html": "",
            "styles": {},
            "source": null,
            "type": element.kind,
            "label": element.label,
            "identifier": element.identifier,
            "value": element.value,
            "frame": element.frame,
            "screen": [self.screen.0, self.screen.1],
            "bundleId": self.bundle,
        })
    }
}

#[cfg(test)]
mod tests;
