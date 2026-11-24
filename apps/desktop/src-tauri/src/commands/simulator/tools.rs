//! The six simulator tools: their inputs, validation and work.

use super::{
    attempt, device, driver, driver_root, remember_app, render,
    simctl::{self, Simctl},
};
use crate::commands::{
    artifacts,
    harness::ScreenshotArtifact,
    tasks::{events::activity, TaskRun, TaskRuntime},
};
use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

/// Driver calls that wait, such as `wait`, are bounded at 30 seconds there.
const DRIVER_TIMEOUT: Duration = Duration::from_secs(60);
const LOG_LIMIT: usize = 40_000;
const CRASH_LIMIT: usize = 6_000;

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AppRequest {
    #[schemars(
        description = "install (path to a built .app), launch, terminate, uninstall, activate (bring a running app forward without relaunching), state, open_url (a link or deep link) or list (installed apps)"
    )]
    pub action: String,
    #[schemars(
        description = "For install: the simulator build's .app folder, absolute or relative to the workspace (for example build/Build/Products/Debug-iphonesimulator/MyApp.app)."
    )]
    pub path: Option<String>,
    #[serde(alias = "bundleId")]
    #[schemars(description = "The app's bundle identifier, for example com.example.MyApp.")]
    pub bundle_id: Option<String>,
    #[serde(default)]
    #[schemars(description = "For launch: arguments passed to the app.")]
    pub args: Vec<String>,
    #[serde(default)]
    #[schemars(
        description = "For launch: environment variables for the app. Never put secrets here."
    )]
    pub env: BTreeMap<String, String>,
    #[schemars(
        description = "For open_url: the URL, such as myapp://settings or https://example.com."
    )]
    pub url: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SnapshotRequest {
    #[serde(alias = "bundleId")]
    #[schemars(
        description = "The app to read. Omit for the app in front (the last app these tools launched, an installed app, Settings or the home screen)."
    )]
    pub bundle_id: Option<String>,
    #[serde(default)]
    #[schemars(
        description = "Only controls you can act on; omit when checking text or results on screen."
    )]
    pub interactive: bool,
    #[schemars(
        description = "The accessibility identifier or label of a container to read alone, for a large screen."
    )]
    pub scope: Option<String>,
    #[serde(alias = "maxDepth")]
    #[schemars(description = "How deep to read the element tree (default 60).")]
    pub max_depth: Option<u32>,
}

#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct InteractRequest {
    #[schemars(
        description = "tap, double_tap, long_press, type (into the ref, or the focused field), clear (a text field's text), swipe (finger direction), scroll (content direction), scroll_to (scroll until the ref is visible), press_button (home), rotate or wait (for text or a ref)"
    )]
    pub action: String,
    #[serde(rename = "ref")]
    #[schemars(description = "An @e reference from the latest simulator_snapshot.")]
    pub reference: Option<String>,
    #[schemars(description = "Screen x in points (as in snapshot frames), when no ref fits.")]
    pub x: Option<f64>,
    #[schemars(description = "Screen y in points.")]
    pub y: Option<f64>,
    #[schemars(
        description = "Text to type, or to wait for. Never type secrets into tool arguments."
    )]
    pub text: Option<String>,
    #[schemars(description = "up, down, left or right for swipe, scroll and scroll_to.")]
    pub direction: Option<String>,
    #[schemars(
        description = "Swipe or scroll length as a fraction of the area, 0.05 to 0.8 (default 0.5)."
    )]
    pub distance: Option<f64>,
    #[schemars(description = "slow, default or fast.")]
    pub velocity: Option<String>,
    #[schemars(description = "long_press seconds (default 1).")]
    pub duration: Option<f64>,
    #[schemars(description = "wait seconds, at most 30 (default 10).")]
    pub timeout: Option<f64>,
    #[serde(default)]
    #[schemars(description = "wait until the text or ref disappears instead.")]
    pub gone: bool,
    #[schemars(description = "press_button: home.")]
    pub button: Option<String>,
    #[schemars(
        description = "rotate: portrait, portrait_upside_down, landscape_left or landscape_right."
    )]
    pub orientation: Option<String>,
    #[schemars(description = "scroll_to: most swipes to try (default 10).")]
    pub count: Option<u32>,
    #[serde(alias = "bundleId")]
    #[schemars(
        description = "The app for coordinates, typing or text waits; omit for the app in front."
    )]
    pub bundle_id: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ScreenshotRequest {
    #[schemars(description = "A label for the capture, such as settings_dark_mode.")]
    pub name: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ConfigureRequest {
    #[schemars(description = "light or dark.")]
    pub appearance: Option<String>,
    #[serde(alias = "contentSize")]
    #[schemars(
        description = "Dynamic Type size: extra-small, small, medium, large (default), extra-large, extra-extra-large, extra-extra-extra-large, accessibility-medium, accessibility-large, accessibility-extra-large, accessibility-extra-extra-large, accessibility-extra-extra-extra-large, increment or decrement."
    )]
    pub content_size: Option<String>,
    #[serde(alias = "increaseContrast")]
    pub increase_contrast: Option<bool>,
    #[schemars(description = "Simulated location.")]
    pub location: Option<Location>,
    #[serde(default, alias = "clearLocation")]
    pub clear_location: bool,
    #[schemars(description = "Grant, revoke or reset a permission without the system prompt.")]
    pub privacy: Option<Privacy>,
    #[serde(alias = "statusBar")]
    #[schemars(
        description = "clean (9:41, full signal, charged battery, for stable screenshots) or clear (the real status bar)."
    )]
    pub status_bar: Option<String>,
    #[schemars(description = "Deliver a test push notification to an app.")]
    pub push: Option<Push>,
    #[schemars(description = "Text to put on the simulator's pasteboard.")]
    pub pasteboard: Option<String>,
    #[serde(default, alias = "readPasteboard")]
    #[schemars(description = "Return the simulator pasteboard's text.")]
    pub read_pasteboard: bool,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Location {
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Privacy {
    #[schemars(description = "grant, revoke or reset.")]
    pub action: String,
    #[schemars(
        description = "all, calendar, contacts-limited, contacts, location, location-always, photos-add, photos, media-library, microphone, motion, reminders or siri."
    )]
    pub service: String,
    #[serde(alias = "bundleId")]
    #[schemars(description = "The app; required for grant and revoke.")]
    pub bundle_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Push {
    #[serde(alias = "bundleId")]
    pub bundle_id: String,
    #[schemars(description = "The APNs payload, with an aps object.")]
    pub payload: Value,
}

#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LogsRequest {
    #[serde(alias = "bundleId")]
    #[schemars(description = "The app; omit for the app these tools last used.")]
    pub bundle_id: Option<String>,
    #[schemars(description = "How far back to read, in seconds, at most 600 (default 120).")]
    pub seconds: Option<u32>,
    #[schemars(description = "default, info or debug.")]
    pub level: Option<String>,
    #[schemars(description = "Only lines containing this text.")]
    pub contains: Option<String>,
    #[schemars(description = "Include the app's recent crash reports (default true).")]
    pub crashes: Option<bool>,
}

// MARK: Validation

pub(super) fn bundle_id(value: Option<&str>) -> Result<&str, String> {
    let value = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or("Give bundle_id, the app's bundle identifier.")?;
    if value.len() > 255
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
    {
        return Err(format!("{value} is not a bundle identifier."));
    }
    Ok(value)
}

fn environment(env: &BTreeMap<String, String>) -> Result<Vec<(String, String)>, String> {
    if env.len() > 50 {
        return Err("Pass at most 50 environment variables.".into());
    }
    env.iter()
        .map(|(name, value)| {
            let valid = name
                .chars()
                .next()
                .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
                && name
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_');
            if !valid {
                return Err(format!("{name} is not an environment variable name."));
            }
            if value.contains('\0') {
                return Err(format!("{name} contains a NUL character."));
            }
            Ok((name.clone(), value.clone()))
        })
        .collect()
}

fn url(value: Option<&str>) -> Result<&str, String> {
    let value = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or("open_url needs url.")?;
    let scheme = value.split(':').next().unwrap_or("");
    let valid = value.contains(':')
        && value.len() <= 4096
        && scheme
            .chars()
            .next()
            .is_some_and(|first| first.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.'))
        && !value
            .chars()
            .any(|ch| ch.is_whitespace() || ch.is_control());
    if valid {
        Ok(value)
    } else {
        Err(format!("{value} is not a URL with a scheme."))
    }
}

/// The `.app` folder to install, inside or outside the workspace.
fn app_path(workspace: &Path, path: Option<&str>) -> Result<PathBuf, String> {
    let path = path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .ok_or("install needs path, the simulator build's .app folder.")?;
    let path = Path::new(path);
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        workspace.join(path)
    };
    if path.extension().is_none_or(|ext| ext != "app") {
        return Err(format!("{} is not an .app folder.", path.display()));
    }
    if !path.join("Info.plist").is_file() {
        return Err(format!(
            "{} is not a built app. Build for the iOS Simulator first and pass the .app from Build/Products/<Configuration>-iphonesimulator.",
            path.display()
        ));
    }
    Ok(path)
}

/// What an app action does.
#[derive(Debug, PartialEq)]
pub(super) enum AppPlan {
    Install(PathBuf),
    Simctl(Simctl),
    /// A driver `/app` action on a bundle.
    Driver(&'static str, String),
    List,
}

pub(super) fn plan_app(
    udid: &str,
    workspace: &Path,
    input: &AppRequest,
) -> Result<AppPlan, String> {
    let bundle = || bundle_id(input.bundle_id.as_deref());
    Ok(match input.action.as_str() {
        "install" => AppPlan::Install(app_path(workspace, input.path.as_deref())?),
        "launch" => {
            if input.args.len() > 50 || input.args.iter().any(|arg| arg.contains('\0')) {
                return Err("Pass at most 50 arguments without NUL characters.".into());
            }
            AppPlan::Simctl(simctl::launch(
                udid,
                bundle()?,
                &input.args,
                &environment(&input.env)?,
            ))
        }
        "terminate" => AppPlan::Simctl(simctl::terminate(udid, bundle()?)),
        "uninstall" => AppPlan::Simctl(simctl::uninstall(udid, bundle()?)),
        "open_url" => AppPlan::Simctl(simctl::open_url(udid, url(input.url.as_deref())?)),
        "activate" => AppPlan::Driver("activate", bundle()?.to_string()),
        "state" => AppPlan::Driver("state", bundle()?.to_string()),
        "list" => AppPlan::List,
        other => {
            return Err(format!(
                "Unknown action {other}. Use install, launch, terminate, uninstall, activate, state, open_url or list."
            ))
        }
    })
}

const DIRECTIONS: &[&str] = &["up", "down", "left", "right"];

fn reference(input: &InteractRequest) -> Option<String> {
    input
        .reference
        .as_deref()
        .map(str::trim)
        .filter(|reference| !reference.is_empty())
        .map(|reference| reference.trim_start_matches('@').to_string())
}

/// The driver's `/act` body for an interaction. `candidates` are apps that
/// may be in front, checked in order when no bundle is named.
pub(super) fn interact_body(
    input: &InteractRequest,
    candidates: &[String],
) -> Result<Value, String> {
    let reference = reference(input);
    if let Some(reference) = &reference {
        let valid = reference.len() > 1
            && reference.starts_with('e')
            && reference[1..].chars().all(|ch| ch.is_ascii_digit());
        if !valid {
            return Err(format!("{reference} is not a snapshot ref such as @e12."));
        }
    }
    let mut body = json!({"action": input.action});
    if let Some(reference) = &reference {
        body["ref"] = json!(reference);
    }
    if let Some(bundle) = input
        .bundle_id
        .as_deref()
        .filter(|bundle| !bundle.trim().is_empty())
    {
        body["bundleId"] = json!(bundle_id(Some(bundle))?);
    }
    body["bundleIds"] = json!(candidates);
    let direction = |required: bool| -> Result<Option<&str>, String> {
        match input.direction.as_deref() {
            Some(direction) if DIRECTIONS.contains(&direction) => Ok(Some(direction)),
            Some(other) => Err(format!(
                "direction {other} must be up, down, left or right."
            )),
            None if required => Err(format!(
                "{} needs direction up, down, left or right.",
                input.action
            )),
            None => Ok(None),
        }
    };
    match input.action.as_str() {
        "tap" | "double_tap" | "long_press" => {
            match (&reference, input.x, input.y) {
                (Some(_), None, None) => {}
                (None, Some(x), Some(y)) if x.is_finite() && y.is_finite() && x >= 0.0 && y >= 0.0 => {
                    body["x"] = json!(x);
                    body["y"] = json!(y);
                }
                _ => return Err(format!("{} needs a ref, or x and y in points.", input.action)),
            }
            if let Some(duration) = input.duration {
                if !(0.1..=10.0).contains(&duration) {
                    return Err("duration must be 0.1 to 10 seconds.".into());
                }
                body["duration"] = json!(duration);
            }
        }
        "type" => {
            let text = input.text.as_deref().filter(|text| !text.is_empty()).ok_or("type needs text.")?;
            if text.chars().count() > 5_000 {
                return Err("Type at most 5,000 characters at once.".into());
            }
            body["text"] = json!(text);
        }
        "clear" | "scroll_to" => {
            if reference.is_none() {
                return Err(format!("{} needs a ref from the latest snapshot.", input.action));
            }
            if input.action == "scroll_to" {
                if let Some(direction) = direction(false)? {
                    body["direction"] = json!(direction);
                }
                if let Some(count) = input.count {
                    body["count"] = json!(count.clamp(1, 25));
                }
            }
        }
        "swipe" | "scroll" => {
            body["direction"] = json!(direction(true)?);
            if let Some(distance) = input.distance {
                if !(0.05..=0.8).contains(&distance) {
                    return Err("distance must be 0.05 to 0.8 of the area.".into());
                }
                body["distance"] = json!(distance);
            }
            match input.velocity.as_deref() {
                None => {}
                Some(velocity @ ("slow" | "default" | "fast")) => body["velocity"] = json!(velocity),
                Some(other) => return Err(format!("velocity {other} must be slow, default or fast.")),
            }
        }
        "press_button" => match input.button.as_deref() {
            Some("home") => body["button"] = json!("home"),
            _ => return Err("The Simulator supports button home.".into()),
        },
        "rotate" => match input.orientation.as_deref() {
            Some(
                orientation @ ("portrait" | "portrait_upside_down" | "landscape_left"
                | "landscape_right"),
            ) => body["orientation"] = json!(orientation),
            _ => {
                return Err("rotate needs orientation portrait, portrait_upside_down, landscape_left or landscape_right.".into())
            }
        },
        "wait" => {
            let text = input.text.as_deref().filter(|text| !text.is_empty());
            if text.is_some() == reference.is_some() {
                return Err("wait needs text or a ref, not both.".into());
            }
            if let Some(text) = text {
                body["text"] = json!(text);
            }
            if let Some(timeout) = input.timeout {
                if !(0.5..=30.0).contains(&timeout) {
                    return Err("timeout must be 0.5 to 30 seconds.".into());
                }
                body["timeout"] = json!(timeout);
            }
            body["gone"] = json!(input.gone);
        }
        other => {
            return Err(format!(
                "Unknown action {other}. Use tap, double_tap, long_press, type, clear, swipe, scroll, scroll_to, press_button, rotate or wait."
            ))
        }
    }
    Ok(body)
}

const CONTENT_SIZES: &[&str] = &[
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
    "increment",
    "decrement",
];

const PRIVACY_SERVICES: &[&str] = &[
    "all",
    "calendar",
    "contacts-limited",
    "contacts",
    "location",
    "location-always",
    "photos-add",
    "photos",
    "media-library",
    "microphone",
    "motion",
    "reminders",
    "siri",
];

/// One configuration change: what it is and the command that makes it.
#[derive(Debug, PartialEq)]
pub(super) struct Step {
    pub label: String,
    pub command: Simctl,
}

pub(super) fn plan_configure(udid: &str, input: &ConfigureRequest) -> Result<Vec<Step>, String> {
    let mut steps = Vec::new();
    let mut step = |label: String, command: Simctl| steps.push(Step { label, command });
    if let Some(appearance) = input.appearance.as_deref() {
        if !matches!(appearance, "light" | "dark") {
            return Err("appearance must be light or dark.".into());
        }
        step(
            format!("appearance {appearance}"),
            simctl::ui(udid, "appearance", appearance),
        );
    }
    if let Some(size) = input.content_size.as_deref() {
        if !CONTENT_SIZES.contains(&size) {
            return Err(format!("content_size {size} is not a Dynamic Type size."));
        }
        step(
            format!("content size {size}"),
            simctl::ui(udid, "content_size", size),
        );
    }
    if let Some(enabled) = input.increase_contrast {
        let value = if enabled { "enabled" } else { "disabled" };
        step(
            format!("increase contrast {value}"),
            simctl::ui(udid, "increase_contrast", value),
        );
    }
    if let Some(location) = &input.location {
        if input.clear_location {
            return Err("Give location or clear_location, not both.".into());
        }
        let valid = location.latitude.is_finite()
            && location.longitude.is_finite()
            && (-90.0..=90.0).contains(&location.latitude)
            && (-180.0..=180.0).contains(&location.longitude);
        if !valid {
            return Err("latitude must be -90 to 90 and longitude -180 to 180.".into());
        }
        step(
            format!("location {},{}", location.latitude, location.longitude),
            simctl::location(udid, Some((location.latitude, location.longitude))),
        );
    } else if input.clear_location {
        step("location cleared".into(), simctl::location(udid, None));
    }
    if let Some(privacy) = &input.privacy {
        if !matches!(privacy.action.as_str(), "grant" | "revoke" | "reset") {
            return Err("privacy action must be grant, revoke or reset.".into());
        }
        if !PRIVACY_SERVICES.contains(&privacy.service.as_str()) {
            return Err(format!("{} is not a privacy service.", privacy.service));
        }
        let bundle = match privacy.bundle_id.as_deref() {
            Some(bundle) => Some(bundle_id(Some(bundle))?),
            None if privacy.action == "reset" => None,
            None => return Err(format!("privacy {} needs bundle_id.", privacy.action)),
        };
        step(
            format!("{} {}", privacy.action, privacy.service),
            simctl::privacy(udid, &privacy.action, &privacy.service, bundle),
        );
    }
    match input.status_bar.as_deref() {
        None => {}
        Some("clean") => step("clean status bar".into(), simctl::clean_status_bar(udid)),
        Some("clear") => step("real status bar".into(), simctl::clear_status_bar(udid)),
        Some(other) => return Err(format!("status_bar {other} must be clean or clear.")),
    }
    if let Some(push) = &input.push {
        if !push.payload["aps"].is_object() {
            return Err("The push payload needs an aps object.".into());
        }
        if push.payload.to_string().len() > 4096 {
            return Err("The push payload is over the 4 KB APNs limit.".into());
        }
        let bundle = bundle_id(Some(&push.bundle_id))?;
        step(
            format!("push to {bundle}"),
            simctl::push(udid, bundle, &push.payload),
        );
    }
    if let Some(text) = &input.pasteboard {
        if text.len() > 100_000 {
            return Err("Put at most 100 KB on the pasteboard.".into());
        }
        step("pasteboard set".into(), simctl::copy(udid, text));
    }
    if steps.is_empty() && !input.read_pasteboard {
        return Err("Name at least one setting to change.".into());
    }
    Ok(steps)
}

/// Seconds and level for a log read.
pub(super) fn log_window(input: &LogsRequest) -> Result<(u32, &str), String> {
    let seconds = input.seconds.unwrap_or(120);
    if !(1..=600).contains(&seconds) {
        return Err("seconds must be 1 to 600.".into());
    }
    let level = input.level.as_deref().unwrap_or("default");
    if !matches!(level, "default" | "info" | "debug") {
        return Err("level must be default, info or debug.".into());
    }
    Ok((seconds, level))
}

/// An executable name safe to quote in a log predicate.
pub(super) fn process_name(name: &str) -> Result<&str, String> {
    let valid = !name.is_empty()
        && name.len() <= 255
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '.' | '_' | '-' | '+'));
    if valid {
        Ok(name)
    } else {
        Err(format!("Cannot read logs for the executable {name}."))
    }
}

/// The last lines of `logs` that contain `contains`, at most [`LOG_LIMIT`]
/// characters, newest kept.
pub(super) fn filter_logs(logs: &str, contains: Option<&str>) -> (String, bool) {
    let needle = contains
        .map(str::trim)
        .filter(|needle| !needle.is_empty())
        .map(str::to_lowercase);
    let lines: Vec<&str> = logs
        .lines()
        .filter(|line| {
            needle
                .as_ref()
                .is_none_or(|needle| line.to_lowercase().contains(needle))
        })
        .collect();
    let mut kept = Vec::new();
    let mut size = 0;
    for line in lines.iter().rev() {
        if size + line.len() + 1 > LOG_LIMIT {
            break;
        }
        size += line.len() + 1;
        kept.push(*line);
    }
    let truncated = kept.len() < lines.len();
    kept.reverse();
    (kept.join("\n"), truncated)
}

/// Parses `simctl listapps` as JSON into bundle ID, name and type.
pub(super) fn parse_apps(apps: &Value) -> Vec<Value> {
    let mut list: Vec<Value> = apps
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(bundle, _)| !bundle.starts_with("digital.jackalope.SimulatorDriver"))
        .map(|(bundle, app)| {
            let name = app["CFBundleDisplayName"]
                .as_str()
                .or(app["CFBundleName"].as_str())
                .unwrap_or("");
            json!({"bundleId": bundle, "name": name, "type": app["ApplicationType"].as_str().unwrap_or("")})
        })
        .collect();
    list.sort_by_key(|app| {
        (
            app["type"] != "User",
            app["bundleId"].as_str().unwrap_or("").to_string(),
        )
    });
    list
}

// MARK: Work

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

/// The attempt's running driver, built and started on first use with
/// progress in the attempt's activity.
fn driver(
    runtime: &TaskRuntime,
    run: &TaskRun,
    udid: &str,
) -> Result<std::sync::Arc<driver::Driver>, String> {
    let root = driver_root(runtime);
    let progress = |line: &str| runtime.update(&run.id, |run| activity(run, line));
    let canceled = || !runtime.is_running(&run.id);
    driver::for_device(
        udid,
        &driver::Context {
            root: &root,
            progress: &progress,
            canceled: &canceled,
        },
    )
}

/// Each device's installed user apps and when they were read.
type AppCache = Mutex<HashMap<String, (Instant, Vec<String>)>>;

/// Installed user apps, read at most every 30 seconds per device.
fn user_apps(udid: &str) -> Vec<String> {
    static CACHE: OnceLock<AppCache> = OnceLock::new();
    let cache = CACHE.get_or_init(Mutex::default);
    if let Some((at, apps)) = cache.lock().ok().and_then(|cache| cache.get(udid).cloned()) {
        if at.elapsed() < Duration::from_secs(30) {
            return apps;
        }
    }
    let apps: Vec<String> = list_apps(udid)
        .unwrap_or_default()
        .into_iter()
        .filter(|app| app["type"] == "User")
        .filter_map(|app| app["bundleId"].as_str().map(str::to_string))
        .collect();
    if let Ok(mut cache) = cache.lock() {
        cache.insert(udid.to_string(), (Instant::now(), apps.clone()));
    }
    apps
}

fn list_apps(udid: &str) -> Result<Vec<Value>, String> {
    let output = simctl::run(&simctl::list_apps(udid), simctl::TIMEOUT)?;
    Ok(parse_apps(&simctl::plist_json(&output)?))
}

/// Apps that may be in front, most likely first.
fn candidates(run_id: &str, udid: &str) -> Vec<String> {
    let mut list = attempt(run_id)
        .map(|attempt| attempt.apps)
        .unwrap_or_default();
    list.extend(user_apps(udid));
    list.extend([
        "com.apple.Preferences".to_string(),
        "com.apple.mobilesafari".to_string(),
    ]);
    let mut seen = std::collections::HashSet::new();
    list.retain(|bundle| seen.insert(bundle.clone()));
    list.truncate(20);
    list
}

pub(crate) async fn app(
    runtime: &TaskRuntime,
    run: &TaskRun,
    input: AppRequest,
) -> Result<Value, String> {
    let (runtime, run) = (runtime.clone(), run.clone());
    blocking(move || {
        plan_app("", Path::new(&run.workspace), &input)?;
        let udid = device(&runtime, &run)?;
        match plan_app(&udid, Path::new(&run.workspace), &input)? {
            AppPlan::Install(path) => {
                let bundle = simctl::plist_value(&path.join("Info.plist"), "CFBundleIdentifier")?;
                simctl::run(&simctl::install(&udid, &path), Duration::from_secs(180))?;
                remember_app(&run.id, &bundle);
                Ok(json!({"installed": path, "bundleId": bundle}))
            }
            AppPlan::Simctl(command) => {
                let output = simctl::run(&command, simctl::TIMEOUT)?;
                let bundle = input.bundle_id.as_deref().map(str::trim);
                match input.action.as_str() {
                    "launch" => {
                        let bundle = bundle.unwrap_or_default();
                        remember_app(&run.id, bundle);
                        let pid = output
                            .rsplit(':')
                            .next()
                            .and_then(|pid| pid.trim().parse::<u64>().ok());
                        Ok(json!({"bundleId": bundle, "pid": pid, "launched": true}))
                    }
                    "open_url" => Ok(json!({"opened": input.url})),
                    action => Ok(json!({"bundleId": bundle, "done": action})),
                }
            }
            AppPlan::Driver(action, bundle) => {
                let driver = driver(&runtime, &run, &udid)?;
                let result = driver.call(
                    "/app",
                    &json!({"action": action, "bundleId": bundle}),
                    DRIVER_TIMEOUT,
                )?;
                if action == "activate" {
                    remember_app(&run.id, &bundle);
                }
                Ok(result)
            }
            AppPlan::List => Ok(json!({"apps": list_apps(&udid)?})),
        }
    })
    .await
}

pub(crate) async fn snapshot(
    runtime: &TaskRuntime,
    run: &TaskRun,
    input: SnapshotRequest,
) -> Result<Value, String> {
    let (runtime, run) = (runtime.clone(), run.clone());
    blocking(move || {
        let bundle = input
            .bundle_id
            .as_deref()
            .filter(|bundle| !bundle.trim().is_empty())
            .map(|bundle| bundle_id(Some(bundle)).map(str::to_string))
            .transpose()?;
        let udid = device(&runtime, &run)?;
        let mut body = json!({"bundleIds": candidates(&run.id, &udid)});
        if let Some(bundle) = bundle {
            body["bundleId"] = json!(bundle);
        }
        if let Some(depth) = input.max_depth {
            body["maxDepth"] = json!(depth.clamp(1, 200));
        }
        let driver = driver(&runtime, &run, &udid)?;
        let tree = driver.call("/snapshot", &body, DRIVER_TIMEOUT)?;
        let rendered = render::render(
            &tree,
            &render::Options {
                interactive: input.interactive,
                scope: input.scope.clone(),
            },
        )?;
        let bundle = tree["bundleId"].as_str().unwrap_or_default().to_string();
        if let Some(attempt) = super::attempts().get_mut(&run.id) {
            let screen = &tree["screen"];
            attempt.screen = screen[2]
                .as_u64()
                .zip(screen[3].as_u64())
                .map(|(w, h)| (w as u32, h as u32));
        }
        if bundle != "com.apple.springboard" && !bundle.is_empty() {
            remember_app(&run.id, &bundle);
        }
        Ok(json!({
            "bundleId": bundle,
            "state": tree["state"],
            "snapshot": rendered.text,
            "truncated": rendered.truncated,
        }))
    })
    .await
}

pub(crate) async fn interact(
    runtime: &TaskRuntime,
    run: &TaskRun,
    input: InteractRequest,
) -> Result<Value, String> {
    let (runtime, run) = (runtime.clone(), run.clone());
    blocking(move || {
        interact_body(&input, &[])?;
        let udid = device(&runtime, &run)?;
        let body = interact_body(&input, &candidates(&run.id, &udid))?;
        let driver = driver(&runtime, &run, &udid)?;
        let mut result = driver.call("/act", &body, DRIVER_TIMEOUT)?;
        if !matches!(input.action.as_str(), "wait") {
            result["hint"] =
                json!("Take a new snapshot before using refs again if the screen changed.");
        }
        Ok(result)
    })
    .await
}

pub(crate) async fn screenshot(
    runtime: &TaskRuntime,
    run: &TaskRun,
    input: ScreenshotRequest,
) -> Result<(ScreenshotArtifact, Value), String> {
    let (runtime, run) = (runtime.clone(), run.clone());
    blocking(move || {
        let udid = device(&runtime, &run)?;
        let mut png = simctl::capture(&udid, None)?;
        if png.len() as u64 > artifacts::screenshot_limit() {
            png = simctl::capture(&udid, Some(2000))?;
        }
        let name = input
            .name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or("simulator");
        let artifact = artifacts::save_screenshot(
            Path::new(&run.workspace),
            &png,
            name,
            &format!("simulator://{udid}"),
        )?;
        let mut value = serde_json::to_value(&artifact).map_err(|error| error.to_string())?;
        if let Some((width, _)) = attempt(&run.id).and_then(|attempt| attempt.screen) {
            if width > 0 {
                value["pixelsPerPoint"] =
                    json!((artifact.width as f64 / width as f64 * 100.0).round() / 100.0);
            }
        }
        Ok((artifact, value))
    })
    .await
}

pub(crate) async fn configure(
    runtime: &TaskRuntime,
    run: &TaskRun,
    input: ConfigureRequest,
) -> Result<Value, String> {
    let (runtime, run) = (runtime.clone(), run.clone());
    blocking(move || {
        plan_configure("", &input)?;
        let udid = device(&runtime, &run)?;
        let mut applied = Vec::new();
        for step in plan_configure(&udid, &input)? {
            simctl::run(&step.command, simctl::TIMEOUT)
                .map_err(|error| format!("{error} Applied before it: {}.", list(&applied)))?;
            applied.push(step.label);
        }
        let mut result = json!({"applied": applied});
        if input.read_pasteboard {
            result["pasteboard"] = json!(simctl::run(&simctl::paste(&udid), simctl::TIMEOUT)?);
        }
        Ok(result)
    })
    .await
}

fn list(items: &[String]) -> String {
    if items.is_empty() {
        "nothing".into()
    } else {
        items.join(", ")
    }
}

pub(crate) async fn logs(
    runtime: &TaskRuntime,
    run: &TaskRun,
    input: LogsRequest,
) -> Result<Value, String> {
    let (runtime, run) = (runtime.clone(), run.clone());
    blocking(move || {
        let (seconds, level) = log_window(&input)?;
        let udid = device(&runtime, &run)?;
        let remembered = attempt(&run.id).and_then(|attempt| attempt.apps.first().cloned());
        let bundle = bundle_id(input.bundle_id.as_deref().or(remembered.as_deref()))?.to_string();
        let container = simctl::run(&simctl::app_container(&udid, &bundle), simctl::TIMEOUT)?;
        let container = PathBuf::from(container.trim());
        let executable = simctl::plist_value(&container.join("Info.plist"), "CFBundleExecutable")?;
        let process = process_name(&executable)?;
        let output = simctl::run(
            &simctl::log_show(&udid, process, seconds, level),
            Duration::from_secs(90),
        )?;
        let (text, truncated) = filter_logs(&output, input.contains.as_deref());
        let mut result = json!({
            "bundleId": bundle,
            "process": process,
            "logs": text,
            "truncated": truncated,
        });
        if input.crashes.unwrap_or(true) {
            result["crashes"] = json!(crash_reports(&udid, process));
        }
        Ok(result)
    })
    .await
}

/// The newest crash reports from the last day for `process` on this device:
/// the host's DiagnosticReports (which name the device) and the device's own
/// CrashReporter folder.
fn crash_reports(udid: &str, process: &str) -> Vec<Value> {
    let Some(home) = crate::commands::platform::home_dir() else {
        return Vec::new();
    };
    let folders = [
        (home.join("Library/Logs/DiagnosticReports"), true),
        (
            home.join(format!(
                "Library/Developer/CoreSimulator/Devices/{udid}/data/Library/Logs/CrashReporter"
            )),
            false,
        ),
    ];
    let day = Duration::from_secs(24 * 60 * 60);
    let mut found: Vec<(std::time::SystemTime, PathBuf, String)> = Vec::new();
    for (folder, shared) in folders {
        let Ok(entries) = std::fs::read_dir(&folder) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with(process) || !(name.ends_with(".ips") || name.ends_with(".crash")) {
                continue;
            }
            let Some(modified) = entry
                .metadata()
                .and_then(|meta| meta.modified())
                .ok()
                .filter(|time| time.elapsed().is_ok_and(|age| age < day))
            else {
                continue;
            };
            let Ok(text) = crate::commands::history::read_bounded(&entry.path(), 2 * 1024 * 1024)
            else {
                continue;
            };
            let text = String::from_utf8_lossy(&text).to_string();
            if shared && !text.contains(udid) {
                continue;
            }
            found.push((modified, entry.path(), text));
        }
    }
    found.sort_by_key(|report| std::cmp::Reverse(report.0));
    found
        .into_iter()
        .take(2)
        .map(|(_, path, text)| {
            let cut = text.chars().count() > CRASH_LIMIT;
            json!({
                "file": path,
                "report": text.chars().take(CRASH_LIMIT).collect::<String>(),
                "truncated": cut,
            })
        })
        .collect()
}
