//! Before/after review screenshots of finished work.
//!
//! When an attempt with changes finishes and its project saves a preview command,
//! Jackalope runs that command on a free local port, opens a few pages in a
//! disposable headless task browser and keeps a first-screen PNG of each. The
//! "before" side runs the same command in the project checkout, only when that
//! checkout still sits cleanly at the attempt's starting commit. Every failure
//! becomes a note on the capture; none fails the attempt.

use super::super::{
    harness::{ScreenshotArtifact, ValidationStep},
    integration,
    process_control::ProcessTree,
    project_registry,
    tasks::{events::activity, preparation::StepProgress, TaskRun, TaskRuntime},
};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    process::{Child, Stdio},
    time::{Duration, Instant},
};

/// Most distinct pages captured per attempt.
pub const PAGE_LIMIT: usize = 6;
/// Every capture, both previews included, finishes within this budget.
const TOTAL_BUDGET: Duration = Duration::from_secs(150);
/// How long one preview may take to answer before its side is skipped.
const READY_BUDGET: Duration = Duration::from_secs(60);
const VISIT_LIMIT: usize = 20;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCaptures {
    pub captured_at: String,
    /// Whether the before side ran; when false, `notes` says why.
    #[serde(default)]
    pub before_available: bool,
    #[serde(default)]
    pub pages: Vec<ReviewCapture>,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCapture {
    pub path: String,
    /// `desktop` or `narrow`.
    pub viewport: String,
    pub width: u32,
    pub height: u32,
    /// Why the page was chosen: `configured`, `plan` or `visited`.
    #[serde(default)]
    pub reasons: Vec<String>,
    /// Plan criteria tagged `browser` that name this page.
    #[serde(default)]
    pub criteria: Vec<String>,
    #[serde(default)]
    pub before: Option<ScreenshotArtifact>,
    #[serde(default)]
    pub after: Option<ScreenshotArtifact>,
}

impl ReviewCaptures {
    pub fn image_count(&self) -> usize {
        self.pages
            .iter()
            .map(|page| page.before.iter().chain(page.after.iter()).count())
            .sum()
    }

    pub fn artifact(&self, id: &str) -> Option<&ScreenshotArtifact> {
        self.pages
            .iter()
            .flat_map(|page| page.before.iter().chain(page.after.iter()))
            .find(|artifact| artifact.id == id)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Settings {
    pub command: String,
    pub pages: Vec<String>,
    pub viewports: Vec<&'static str>,
}

/// The project's capture settings, or `None` when captures are off or no
/// usable preview command is saved.
pub fn settings(record: &project_registry::ProjectRecord) -> Option<Settings> {
    let command = record.preview_command.as_deref()?.trim();
    if record.review_captures == Some(false)
        || command.is_empty()
        || command.len() > 4000
        || command.contains('\0')
        || !command.contains("{port}")
    {
        return None;
    }
    let mut pages: Vec<String> = Vec::new();
    for page in record
        .review_pages
        .iter()
        .filter_map(|page| normalize(page))
    {
        if !pages.contains(&page) {
            pages.push(page);
        }
    }
    if pages.is_empty() {
        pages.push("/".into());
    }
    let mut viewports: Vec<&'static str> = ["desktop", "narrow"]
        .into_iter()
        .filter(|name| record.review_viewports.iter().any(|v| v == name))
        .collect();
    if viewports.is_empty() {
        viewports.push("desktop");
    }
    Some(Settings {
        command: command.to_string(),
        pages,
        viewports,
    })
}

fn dimensions(viewport: &str) -> (u32, u32) {
    if viewport == "narrow" {
        (390, 844)
    } else {
        (1280, 800)
    }
}

/// A preview path as captured: begins with one `/`, has no fragment, no
/// trailing slash except the root, and nothing that could leave the preview origin.
pub fn normalize(path: &str) -> Option<String> {
    let path = path.trim();
    let path = path.split('#').next().unwrap_or_default();
    if !path.starts_with('/')
        || path.starts_with("//")
        || path.len() > 300
        || path
            .chars()
            .any(|c| c == '\\' || c.is_control() || c.is_whitespace())
    {
        return None;
    }
    let trimmed = path.trim_end_matches('/');
    Some(if trimmed.is_empty() {
        "/".into()
    } else {
        trimmed.into()
    })
}

/// The path of a URL on this computer's preview servers, which is all a
/// visited page says about the route.
fn local_path(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if parsed.scheme() != "http"
        || !matches!(
            parsed.host_str(),
            Some("127.0.0.1" | "localhost" | "[::1]" | "0.0.0.0")
        )
    {
        return None;
    }
    let mut path = parsed.path().to_string();
    if let Some(query) = parsed.query() {
        path.push('?');
        path.push_str(query);
    }
    normalize(&path)
}

/// Pages named in a criterion: local URLs and `/route` tokens. File paths
/// such as `/src/app.ts` are skipped.
pub fn paths_in_text(text: &str) -> Vec<String> {
    const FILES: &[&str] = &[
        ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".rs", ".json", ".md", ".css", ".py",
        ".toml", ".yaml", ".yml", ".lock",
    ];
    let mut found = Vec::new();
    for token in text.split(|c: char| c.is_whitespace() || "`'\"()[]<>,;".contains(c)) {
        let token = token.trim_end_matches(['.', ':', '!', '?']);
        let path = if token.starts_with("http://") {
            local_path(token)
        } else if token.starts_with('/') && token.len() > 1 {
            normalize(token)
        } else {
            None
        };
        let Some(path) = path else { continue };
        let route = path
            .split('?')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if FILES.iter().any(|suffix| route.ends_with(suffix)) || found.contains(&path) {
            continue;
        }
        found.push(path);
    }
    found
}

/// Remembers a local page the agent opened in its task browser.
pub fn record_visit(run: &mut TaskRun, url: &str) {
    let Some(path) = local_path(url) else { return };
    run.visited_pages.retain(|seen| seen != &path);
    run.visited_pages.push(path);
    if run.visited_pages.len() > VISIT_LIMIT {
        run.visited_pages.remove(0);
    }
}

/// Plan criteria tagged `browser` in this attempt's requirements, as `(id, text)`.
fn browser_criteria(run: &TaskRun) -> Vec<(String, String)> {
    run.contract
        .requirements
        .iter()
        .filter_map(|requirement| {
            let (id, text) = requirement.title.split_once(':')?;
            let text = text
                .trim()
                .strip_prefix(crate::commands::planning::handoff::BROWSER_TAG)?;
            id.starts_with("AC-")
                .then(|| (id.to_string(), text.trim().to_string()))
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq)]
pub struct Page {
    pub path: String,
    pub reasons: Vec<&'static str>,
    pub criteria: Vec<String>,
}

/// Configured pages first, then pages named by browser criteria, then pages the
/// agent visited (newest first), capped at [`PAGE_LIMIT`].
pub fn select_pages(
    configured: &[String],
    criteria: &[(String, String)],
    visited: &[String],
) -> Vec<Page> {
    let mut pages: Vec<Page> = Vec::new();
    let mut add = |path: String, reason: &'static str, criterion: Option<&str>| {
        if let Some(page) = pages.iter_mut().find(|page| page.path == path) {
            if !page.reasons.contains(&reason) {
                page.reasons.push(reason);
            }
            if let Some(id) = criterion.filter(|id| !page.criteria.iter().any(|c| c == id)) {
                page.criteria.push(id.to_string());
            }
        } else if pages.len() < PAGE_LIMIT {
            pages.push(Page {
                path,
                reasons: vec![reason],
                criteria: criterion.map(str::to_string).into_iter().collect(),
            });
        }
    };
    for path in configured {
        add(path.clone(), "configured", None);
    }
    for (id, text) in criteria {
        for path in paths_in_text(text) {
            add(path, "plan", Some(id));
        }
    }
    for path in visited.iter().rev().filter_map(|path| normalize(path)) {
        add(path, "visited", None);
    }
    pages
}

/// A preview process this module started. Dropping it ends the process tree.
struct Server {
    child: Child,
    tree: ProcessTree,
    port: u16,
    _lease: crate::commands::verification::WorkspaceLease,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.tree.terminate();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A disposable browser session, closed with its temporary profile on drop.
struct Browser(String);

impl Drop for Browser {
    fn drop(&mut self) {
        super::super::browser::close(&self.0);
    }
}

fn serve(
    runtime: &TaskRuntime,
    id: &str,
    workspace: &str,
    command: &str,
    first_page: &str,
    deadline: Instant,
) -> Result<Server, String> {
    let lease = {
        let _guard = integration::execution_guard()?;
        super::ensure_idle(workspace)?;
        crate::commands::verification::reserve_workspace(workspace)?
    };
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);
    let mut process = super::preview_process(
        &command.replace("{port}", &port.to_string()),
        workspace,
        port,
    );
    process.stdout(Stdio::null()).stderr(Stdio::null());
    let mut child = process
        .spawn()
        .map_err(|e| format!("the preview command could not start: {e}"))?;
    let tree = match ProcessTree::attach(&child) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let mut server = Server {
        child,
        tree,
        port,
        _lease: lease,
    };
    let ready_by = deadline.min(Instant::now() + READY_BUDGET);
    let waited = ready_by.saturating_duration_since(Instant::now()).as_secs();
    loop {
        if super::http_ready_at(port, first_page, Duration::from_millis(500)) {
            return Ok(server);
        }
        if let Some(status) = server.child.try_wait().map_err(|e| e.to_string())? {
            return Err(format!(
                "the preview command exited ({}) before answering",
                status
                    .code()
                    .map_or("no exit code".into(), |code| format!("code {code}"))
            ));
        }
        if !runtime.is_running(id) {
            return Err("the attempt was stopped".into());
        }
        if Instant::now() >= ready_by {
            return Err(format!(
                "the preview did not answer at {first_page} within {waited} seconds"
            ));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// The project checkout to capture "before" from, or why there is none.
fn before_source(runtime: &TaskRuntime, run: &TaskRun) -> Result<String, String> {
    if run.base_head.is_empty() {
        return Err("Before screenshots need the task's starting Git commit.".into());
    }
    let workspace = dunce::canonicalize(&run.workspace).map_err(|e| e.to_string())?;
    let checkout = dunce::canonicalize(&run.project_path)
        .map_err(|_| "Before screenshots need the project checkout.".to_string())?;
    if workspace == checkout {
        return Err("Before screenshots are skipped when work happens in the project checkout itself; only the result was captured.".into());
    }
    let read = |args: &[&str]| {
        crate::commands::git_command::command(
            &checkout,
            args,
            crate::commands::git_command::Policy::Inspection,
        )
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
    };
    if read(&["rev-parse", "HEAD"]).as_deref() != Some(run.base_head.as_str()) {
        return Err("Before screenshots are skipped because the project checkout is no longer at the task's starting commit.".into());
    }
    if read(&["status", "--porcelain", "--untracked-files=no"]).is_none_or(|s| !s.is_empty()) {
        return Err(
            "Before screenshots are skipped because the project checkout has uncommitted changes."
                .into(),
        );
    }
    let busy = runtime.integration_runs()?.iter().any(|other| {
        other.id != run.id
            && dunce::canonicalize(&other.workspace).ok().as_ref() == Some(&checkout)
            && ["starting", "running", "stopping", "interrupted"].contains(&other.status.as_str())
    });
    if busy {
        return Err(
            "Before screenshots are skipped because other work is running in the project checkout."
                .into(),
        );
    }
    Ok(checkout.to_string_lossy().into_owned())
}

#[derive(Clone, Copy, PartialEq)]
enum Side {
    Before,
    After,
}

fn evidence_folder(workspace: &str) -> Result<PathBuf, String> {
    let workspace = dunce::canonicalize(workspace).map_err(|e| e.to_string())?;
    let directory = workspace.join(".jackalope/artifacts/screenshots");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    if !dunce::canonicalize(&directory)
        .map_err(|e| e.to_string())?
        .starts_with(&workspace)
    {
        return Err("The artifact folder resolves outside this workspace.".into());
    }
    Ok(directory)
}

/// What one capture pass shares across both sides.
struct Pass<'a> {
    runtime: &'a TaskRuntime,
    id: &'a str,
    folder: PathBuf,
    deadline: Instant,
}

impl Pass<'_> {
    /// Captures every page at every viewport for one side, recording failures as notes.
    fn shoot(
        &self,
        server: &Server,
        side: Side,
        captures: &mut [ReviewCapture],
        notes: &mut Vec<String>,
    ) {
        let session = Browser(format!("review-capture-{}", uuid::Uuid::new_v4()));
        super::super::browser::register(&session.0);
        let label = if side == Side::Before {
            "Before"
        } else {
            "After"
        };
        for capture in captures.iter_mut() {
            if Instant::now() >= self.deadline || !self.runtime.is_running(self.id) {
                notes.push(format!(
                    "{label} screenshots stopped early: the capture time limit was reached or the attempt stopped."
                ));
                return;
            }
            let url = format!("http://127.0.0.1:{}{}", server.port, capture.path);
            let result = super::super::browser::capture_first_screen(
                &session.0,
                &url,
                capture.width,
                capture.height,
            )
            .and_then(|(current, bytes)| {
                let (width, height) = super::super::harness::png_dimensions(&bytes)?;
                let artifact_id = uuid::Uuid::new_v4().to_string();
                let path = self.folder.join(format!("{artifact_id}.png"));
                std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
                Ok(ScreenshotArtifact {
                    id: artifact_id,
                    name: format!("{label} · {} · {}", capture.path, capture.viewport),
                    url: current,
                    file_path: path.to_string_lossy().into_owned(),
                    width,
                    height,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                })
            });
            match result {
                Ok(artifact) if side == Side::Before => capture.before = Some(artifact),
                Ok(artifact) => capture.after = Some(artifact),
                Err(error) => notes.push(format!(
                    "{label} screenshot of {} ({}) failed: {error}",
                    capture.path, capture.viewport
                )),
            }
        }
    }
}

fn collect(runtime: &TaskRuntime, run: &TaskRun, settings: &Settings) -> ReviewCaptures {
    let deadline = Instant::now() + TOTAL_BUDGET;
    let criteria = browser_criteria(run);
    let visited: Vec<String> = run
        .visited_pages
        .iter()
        .cloned()
        .chain(run.screenshots.iter().filter_map(|s| local_path(&s.url)))
        .collect();
    let pages = select_pages(&settings.pages, &criteria, &visited);
    let mut result = ReviewCaptures {
        captured_at: chrono::Utc::now().to_rfc3339(),
        ..Default::default()
    };
    result.pages = settings
        .viewports
        .iter()
        .flat_map(|viewport| {
            pages.iter().map(move |page| {
                let (width, height) = dimensions(viewport);
                ReviewCapture {
                    path: page.path.clone(),
                    viewport: (*viewport).into(),
                    width,
                    height,
                    reasons: page.reasons.iter().map(|r| r.to_string()).collect(),
                    criteria: page.criteria.clone(),
                    before: None,
                    after: None,
                }
            })
        })
        .collect();
    let pass = match evidence_folder(&run.workspace) {
        Ok(folder) => Pass {
            runtime,
            id: &run.id,
            folder,
            deadline,
        },
        Err(error) => {
            result
                .notes
                .push(format!("Review screenshots could not be saved: {error}"));
            return result;
        }
    };
    let first = pages.first().map_or("/", |page| page.path.as_str());
    match serve(
        runtime,
        &run.id,
        &run.workspace,
        &settings.command,
        first,
        deadline,
    ) {
        Ok(server) => pass.shoot(&server, Side::After, &mut result.pages, &mut result.notes),
        Err(error) => {
            result
                .notes
                .push(format!("No screenshots of the result: {error}."));
            return result;
        }
    }
    match before_source(runtime, run).and_then(|checkout| {
        serve(
            runtime,
            &run.id,
            &checkout,
            &settings.command,
            first,
            deadline,
        )
        .map_err(|error| format!("Before screenshots are unavailable: {error}."))
    }) {
        Ok(server) => {
            result.before_available = true;
            pass.shoot(&server, Side::Before, &mut result.pages, &mut result.notes);
        }
        Err(reason) => result.notes.push(reason),
    }
    result
}

/// Review evidence for each browser criterion with a matching capture. The
/// steps stay `pending`: images help a person review but verify nothing.
pub fn criterion_steps(run: &TaskRun, captures: &ReviewCaptures) -> Vec<ValidationStep> {
    browser_criteria(run)
        .into_iter()
        .filter_map(|(id, _)| {
            let named: Vec<&ReviewCapture> = captures
                .pages
                .iter()
                .filter(|page| page.criteria.contains(&id) && page.after.is_some())
                .collect();
            // A criterion that names no page is shown with the first configured page.
            let matched = if named.is_empty() {
                captures
                    .pages
                    .iter()
                    .filter(|page| page.after.is_some())
                    .take(1)
                    .collect()
            } else {
                named
            };
            if matched.is_empty() {
                return None;
            }
            let evidence = matched
                .iter()
                .flat_map(|page| page.before.iter().chain(page.after.iter()))
                .map(|artifact| artifact.file_path.clone())
                .take(8)
                .collect();
            let described: Vec<String> = matched
                .iter()
                .map(|page| format!("{} ({})", page.path, page.viewport))
                .collect();
            Some(ValidationStep {
                id: uuid::Uuid::new_v4().to_string(),
                step: format!("{id} review screenshots"),
                status: "pending".into(),
                notes: Some(format!(
                    "Jackalope captured {} for this browser criterion. Compare them in Review; screenshots do not verify the criterion.",
                    described.join(", ")
                )),
                evidence,
                timestamp: chrono::Utc::now().to_rfc3339(),
                requirements: vec![],
            })
        })
        .collect()
}

/// Captures review screenshots for an attempt that finished with changes, when
/// its project allows it. Never fails the attempt.
pub(in crate::commands) fn capture(runtime: &TaskRuntime, id: &str) {
    let Some(run) = runtime.run_snapshot(id) else {
        return;
    };
    let Some(settings) =
        project_registry::record(runtime, &run.project_id).and_then(|record| settings(&record))
    else {
        return;
    };
    runtime.update(id, |r| {
        r.progress = Some(StepProgress::new(
            "review_capture",
            "Capturing review screenshots",
            1,
        ));
    });
    let captures = runtime
        .timed(id, "reviewCapture", || {
            Ok(collect(runtime, &run, &settings))
        })
        .unwrap_or_else(|error| ReviewCaptures {
            captured_at: chrono::Utc::now().to_rfc3339(),
            notes: vec![error],
            ..Default::default()
        });
    let steps = criterion_steps(&run, &captures);
    let count = captures.image_count();
    runtime.update(id, |r| {
        r.progress = None;
        activity(
            r,
            &match count {
                0 => "No review screenshots were captured. See the review notes.".to_string(),
                1 => "Captured 1 review screenshot.".to_string(),
                n => format!("Captured {n} review screenshots."),
            },
        );
        r.validation_steps.extend(steps);
        r.review_captures = Some(captures);
    });
}

#[cfg(test)]
mod tests;
