//! Review screenshots of an iOS app.
//!
//! When finished work changes an iOS app's native sources and the project saves
//! no web preview command, Jackalope builds the app for the task's Simulator,
//! installs and launches it with a clean status bar and captures its first
//! screen in light and dark appearance and at a large Dynamic Type size, plus
//! deep links from the feature map whose sources changed. The "before" side
//! builds the project checkout the same way when it still sits at the attempt's
//! starting commit, then puts the result's app back. Every failure becomes a
//! note; none fails the attempt.

use super::{before_source, changed_files, wanted_now, ReviewCapture, ReviewCaptures, Side};
use crate::commands::{
    harness::{png_dimensions, ScreenshotArtifact},
    integration,
    previews::{
        features::{self, Feature},
        simulator as preview,
    },
    project_registry,
    simulator::{self, device as simctl},
    simulators::{self, Device},
    tasks::{TaskRun, TaskRuntime},
    verification, xcode,
};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

/// Building takes most of an iOS capture, so it gets longer than a web one.
pub(super) const BUDGET: Duration = Duration::from_secs(300);
/// Distinct screens captured per attempt, the first screen included.
const SCREEN_LIMIT: usize = 4;
/// The page name of the screen the app opens on.
pub const FIRST_SCREEN: &str = "First screen";
/// The Dynamic Type size of the large-text capture.
const LARGE_TEXT: &str = "accessibility-large";
/// Longest side of a saved capture, in pixels.
const CAPTURE_SIZE: u32 = 1600;
/// How long a screen may keep changing after launch before it is captured anyway.
const SETTLE_LIMIT: Duration = Duration::from_secs(8);

#[derive(Clone, Debug, PartialEq)]
pub struct Settings {
    /// The saved build command, when the detected build is replaced.
    pub custom: Option<String>,
    /// Configured review pages that are deep links.
    pub pages: Vec<String>,
    /// Feature-map entries whose page is a deep link.
    pub features: Vec<Feature>,
}

/// The iOS capture settings, or `None` when captures are off, the project is
/// not an iOS app or this computer cannot run the Simulator.
pub fn settings(record: &project_registry::ProjectRecord, workspace: &Path) -> Option<Settings> {
    if !record.settings.resolve().review_captures
        || !simulator::supported()
        || xcode::toolchain().is_none()
        || !xcode::project::find(workspace).is_some_and(|project| {
            project.ios && project.container != xcode::project::Container::Package
        })
    {
        return None;
    }
    let custom = record
        .simulator_preview
        .as_deref()
        .and_then(|command| preview::valid_command(command).ok())
        .map(str::to_string);
    let mut pages: Vec<String> = Vec::new();
    for page in record
        .review_pages
        .iter()
        .filter_map(|page| features::deep_link(page))
    {
        if !pages.contains(&page) {
            pages.push(page);
        }
    }
    Some(Settings {
        custom,
        pages,
        features: features::usable(&record.feature_map)
            .into_iter()
            .filter(|feature| features::deep_link(&feature.page).is_some())
            .collect(),
    })
}

/// Files whose change can alter what the app shows: Swift and Objective-C
/// sources, interface files, asset catalogs, strings and project settings.
pub fn relevant(path: &str) -> bool {
    let path = path.replace('\\', "/").to_ascii_lowercase();
    const EXTENSIONS: &[&str] = &[
        ".swift",
        ".m",
        ".mm",
        ".xib",
        ".storyboard",
        ".strings",
        ".stringsdict",
        ".xcstrings",
        ".plist",
        ".pbxproj",
        ".xcconfig",
    ];
    EXTENSIONS.iter().any(|extension| path.ends_with(extension))
        || path.contains(".xcassets/")
        || path.ends_with("project.yml")
        || path.ends_with("project.swift")
}

/// Whether finished work gets iOS review screenshots: captures are on, the
/// project is an iOS app and the attempt changed a file that can alter it.
pub(super) fn wanted(record: &project_registry::ProjectRecord, run: &TaskRun) -> bool {
    settings(record, Path::new(&run.workspace)).is_some()
        && changed_files(run).iter().any(|path| relevant(path))
}

/// The screens to capture: the first screen, then configured deep links, then
/// feature deep links whose sources changed, at most [`SCREEN_LIMIT`].
pub fn screens(settings: &Settings, changed: &[String]) -> Vec<(String, &'static str)> {
    let mut screens = vec![(FIRST_SCREEN.to_string(), "launch")];
    let feature_pages = features::changed_pages(&settings.features, changed);
    for (page, reason) in settings
        .pages
        .iter()
        .map(|page| (page, "configured"))
        .chain(feature_pages.iter().map(|page| (page, "feature")))
    {
        if screens.len() >= SCREEN_LIMIT {
            break;
        }
        if !screens.iter().any(|(path, _)| path == page) {
            screens.push((page.clone(), reason));
        }
    }
    screens
}

/// The captures of one screen: light and dark, plus large text for the first
/// screen. Viewports read `<family>-light`, `<family>-dark` and
/// `<family>-large-text`, with `iphone` or `ipad` as the family.
pub fn variants(family: &str, first: bool) -> Vec<String> {
    let mut list = vec![format!("{family}-light"), format!("{family}-dark")];
    if first {
        list.push(format!("{family}-large-text"));
    }
    list
}

/// The device family a capture names, from the device type identifier.
pub fn family(device: &Device) -> &'static str {
    if device.device_type.contains("iPad") || device.name.contains("iPad") {
        "ipad"
    } else {
        "iphone"
    }
}

/// The appearance and Dynamic Type size a viewport asks for.
pub fn variant_settings(viewport: &str) -> (&'static str, &'static str) {
    if viewport.ends_with("-dark") {
        ("dark", "large")
    } else if viewport.ends_with("-large-text") {
        ("light", LARGE_TEXT)
    } else {
        ("light", "large")
    }
}

/// The device's appearance and text size before capture, restored after.
struct Restore {
    udid: String,
    appearance: Option<String>,
    content_size: Option<String>,
}

impl Drop for Restore {
    fn drop(&mut self) {
        let _ = simctl::run(&simctl::clear_status_bar(&self.udid), simctl::TIMEOUT);
        if let Some(appearance) = &self.appearance {
            let _ = simctl::run(
                &simctl::ui(&self.udid, "appearance", appearance),
                simctl::TIMEOUT,
            );
        }
        if let Some(size) = &self.content_size {
            let _ = simctl::run(
                &simctl::ui(&self.udid, "content_size", size),
                simctl::TIMEOUT,
            );
        }
    }
}

struct Pass<'a> {
    runtime: &'a TaskRuntime,
    run: &'a TaskRun,
    settings: &'a Settings,
    device: Device,
    folder: PathBuf,
    deadline: Instant,
}

impl Pass<'_> {
    fn canceled(&self) -> bool {
        Instant::now() >= self.deadline || !wanted_now(self.runtime, &self.run.id)
    }

    /// Builds `workspace` and installs its app while holding the workspace like
    /// a running check. Returns the app and its bundle identifier.
    fn build(&self, workspace: &str) -> Result<(PathBuf, String), String> {
        let _lease = {
            let _guard = integration::execution_guard()?;
            crate::commands::previews::ensure_idle(workspace)?;
            verification::reserve_workspace(workspace)?
        };
        let canceled = || self.canceled();
        let app = preview::build(
            Path::new(workspace),
            &self.device,
            self.settings.custom.as_deref(),
            &canceled,
            |_| {},
        )
        .map_err(|error| {
            if self.canceled() {
                "the capture time limit was reached or the result was closed".to_string()
            } else {
                error
            }
        })?;
        let bundle = preview::install(&self.device.udid, &app)?;
        Ok((app, bundle))
    }

    /// Accepts the prompt a deep link raises, starting the driver on first use
    /// and keeping it for the rest of the capture.
    fn accept_prompt(&self, bundle: &str) -> Result<bool, String> {
        let canceled = || self.canceled();
        preview::accept_open_prompt(self.runtime, &self.device.udid, bundle, &|_| {}, &canceled)
    }

    /// Captures every screen and variant for one side, recording failures as notes.
    fn shoot(
        &self,
        bundle: &str,
        side: Side,
        captures: &mut [ReviewCapture],
        notes: &mut Vec<String>,
    ) {
        let label = if side == Side::Before {
            "Before"
        } else {
            "After"
        };
        let udid = &self.device.udid;
        if let Err(error) = simctl::run(&simctl::clean_status_bar(udid), simctl::TIMEOUT) {
            notes.push(format!("The status bar could not be cleaned: {error}"));
        }
        for capture in captures.iter_mut() {
            if self.canceled() {
                notes.push(format!(
                    "{label} screenshots stopped early: the capture time limit was reached or the result was closed."
                ));
                return;
            }
            let (appearance, size) = variant_settings(&capture.viewport);
            let result = simctl::run(&simctl::ui(udid, "appearance", appearance), simctl::TIMEOUT)
                .and_then(|_| simctl::run(&simctl::ui(udid, "content_size", size), simctl::TIMEOUT))
                .and_then(|_| preview::launch(udid, bundle))
                .and_then(|_| {
                    if capture.path == FIRST_SCREEN {
                        Ok(String::new())
                    } else {
                        std::thread::sleep(Duration::from_millis(800));
                        simctl::run(&simctl::open_url(udid, &capture.path), simctl::TIMEOUT)
                            .and_then(|_| self.accept_prompt(bundle))
                            .map(|_| String::new())
                    }
                })
                .and_then(|_| settled(udid, self.deadline))
                .and_then(|png| {
                    let (width, height) = png_dimensions(&png)?;
                    let id = uuid::Uuid::new_v4().to_string();
                    let path = self.folder.join(format!("{id}.png"));
                    std::fs::write(&path, &png).map_err(|e| e.to_string())?;
                    Ok(ScreenshotArtifact {
                        id,
                        name: format!("{label} · {} · {}", capture.path, capture.viewport),
                        url: format!("simulator://{udid}"),
                        file_path: path.to_string_lossy().into_owned(),
                        width,
                        height,
                        timestamp: chrono::Utc::now().to_rfc3339(),
                    })
                });
            match result {
                Ok(artifact) => {
                    capture.width = artifact.width;
                    capture.height = artifact.height;
                    if side == Side::Before {
                        capture.before = Some(artifact);
                    } else {
                        capture.after = Some(artifact);
                    }
                }
                Err(error) => notes.push(format!(
                    "{label} screenshot of {} ({}) failed: {error}",
                    capture.path, capture.viewport
                )),
            }
        }
    }
}

/// A screenshot taken once the screen stops changing after launch, or after
/// [`SETTLE_LIMIT`].
fn settled(udid: &str, deadline: Instant) -> Result<Vec<u8>, String> {
    let started = Instant::now();
    let limit = (started + SETTLE_LIMIT).min(deadline.max(started + Duration::from_secs(2)));
    std::thread::sleep(Duration::from_millis(1200));
    let mut previous = simctl::capture(udid, Some(CAPTURE_SIZE))?;
    while Instant::now() < limit {
        std::thread::sleep(Duration::from_millis(500));
        let current = simctl::capture(udid, Some(CAPTURE_SIZE))?;
        if current == previous {
            return Ok(current);
        }
        previous = current;
    }
    Ok(previous)
}

pub(in crate::commands::previews) fn collect(
    runtime: &TaskRuntime,
    run: &TaskRun,
    settings: &Settings,
) -> ReviewCaptures {
    let deadline = Instant::now() + BUDGET;
    let mut result = ReviewCaptures {
        captured_at: chrono::Utc::now().to_rfc3339(),
        ..Default::default()
    };
    let folder = match crate::commands::artifacts::evidence_folder(Path::new(&run.workspace)) {
        Ok(folder) => folder,
        Err(error) => {
            result
                .notes
                .push(format!("Review screenshots could not be saved: {error}"));
            return result;
        }
    };
    let canceled = || Instant::now() >= deadline || !wanted_now(runtime, &run.id);
    let device = match simulators::ensure(runtime, &run.id, canceled) {
        Ok(device) => device,
        Err(error) => {
            result
                .notes
                .push(format!("No screenshots of the result: {error}"));
            return result;
        }
    };
    let _use = simulators::InUse::new(&device);
    // A deep link starts the driver to accept its prompt; it stops after capture.
    let _driver = simulator::DriverHold::new(&device.udid);
    let _restore = Restore {
        udid: device.udid.clone(),
        appearance: preview::ui_value(&device.udid, "appearance"),
        content_size: preview::ui_value(&device.udid, "content_size"),
    };
    let changed = changed_files(run);
    let family = family(&device);
    result.pages = screens(settings, &changed)
        .into_iter()
        .flat_map(|(path, reason)| {
            let labels = features::labels(&settings.features, &path);
            variants(family, path == FIRST_SCREEN)
                .into_iter()
                .map(move |viewport| ReviewCapture {
                    path: path.clone(),
                    viewport,
                    width: 0,
                    height: 0,
                    reasons: vec![reason.to_string()],
                    features: labels.clone(),
                    criteria: Vec::new(),
                    before: None,
                    after: None,
                })
                .collect::<Vec<_>>()
        })
        .collect();
    let pass = Pass {
        runtime,
        run,
        settings,
        device,
        folder,
        deadline,
    };
    let (after_app, bundle) = match pass.build(&run.workspace) {
        Ok(built) => built,
        Err(error) => {
            result
                .notes
                .push(format!("No screenshots of the result: {error}."));
            return result;
        }
    };
    pass.shoot(&bundle, Side::After, &mut result.pages, &mut result.notes);
    match before_source(runtime, run).and_then(|checkout| {
        pass.build(&checkout)
            .map_err(|error| format!("Before screenshots are unavailable: {error}."))
    }) {
        Ok((_, before_bundle)) => {
            result.before_available = true;
            pass.shoot(
                &before_bundle,
                Side::Before,
                &mut result.pages,
                &mut result.notes,
            );
            // The task's Simulator keeps the result's app for follow-ups and previews.
            if let Err(error) = preview::install(&pass.device.udid, &after_app)
                .and_then(|bundle| preview::launch(&pass.device.udid, &bundle))
            {
                result.notes.push(format!(
                    "The result's app could not be reinstalled after the before screenshots: {error}"
                ));
            }
        }
        Err(reason) => result.notes.push(reason),
    }
    result
}
