use super::{integration, process_control::ProcessTree, tasks::TaskRuntime};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tauri::State;
pub mod design;
pub mod features;
pub mod review;
pub mod simulator;

/// Which kind of preview runs: a local web server, or the app in the task's
/// iOS Simulator.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PreviewKind {
    #[default]
    Web,
    Simulator,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewView {
    pub run_id: String,
    pub command: String,
    /// Absent in views from before Simulator previews, which were all web.
    #[serde(default)]
    pub kind: PreviewKind,
    /// The web preview's local port; 0 for a Simulator preview.
    #[serde(default)]
    pub port: u16,
    pub running: bool,
    pub ready: bool,
    pub exit_code: Option<i32>,
    pub output: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub simulator: Option<simulator::SimulatorPreview>,
}

/// What a preview runs: a web server's process tree, or a Simulator session
/// with its build, app, device and driver.
enum Process {
    Web { child: Child, tree: ProcessTree },
    Simulator(Arc<simulator::Session>),
}

impl Process {
    /// Whether the preview still holds its workspace or device.
    fn alive(&mut self) -> Result<bool, String> {
        match self {
            Process::Web { child, tree } => {
                if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                    tree.terminate();
                    Ok(false)
                } else {
                    Ok(true)
                }
            }
            Process::Simulator(session) => Ok(session.phase().active() || session.busy()),
        }
    }

    fn end(&mut self, wait: bool) {
        match self {
            Process::Web { child, tree } => {
                tree.terminate();
                let _ = child.wait();
            }
            Process::Simulator(session) => session.stop(wait),
        }
    }
}

struct Preview {
    identity: String,
    workspace: String,
    process: Process,
    view: PreviewView,
    output: Arc<Mutex<String>>,
}
static PREVIEWS: OnceLock<Mutex<HashMap<String, Preview>>> = OnceLock::new();
fn sessions() -> &'static Mutex<HashMap<String, Preview>> {
    PREVIEWS.get_or_init(Default::default)
}

pub fn ensure_idle(workspace: &str) -> Result<(), String> {
    super::work_terminal::ensure_idle(workspace)?;
    ensure_preview_idle(workspace)
}
pub(super) fn ensure_preview_idle(workspace: &str) -> Result<(), String> {
    let path = dunce::canonicalize(workspace).map_err(|e| e.to_string())?;
    let mut sessions = sessions().lock().map_err(|e| e.to_string())?;
    for preview in sessions.values_mut() {
        if dunce::canonicalize(&preview.workspace).ok().as_ref() == Some(&path) {
            if !preview.process.alive()? {
                continue;
            }
            return Err("Stop this workspace's managed preview before continuing work, integrating or removing it.".into());
        }
    }
    Ok(())
}

pub fn close_all() {
    design::close_all();
    if let Ok(mut sessions) = sessions().lock() {
        for preview in sessions.values_mut() {
            preview.process.end(false);
        }
        sessions.clear();
    }
}
pub fn active_ports() -> Vec<(String, u16)> {
    sessions()
        .lock()
        .map(|mut sessions| {
            sessions
                .values_mut()
                .filter(|preview| preview.view.kind == PreviewKind::Web)
                .filter_map(|preview| {
                    preview
                        .process
                        .alive()
                        .ok()
                        .filter(|alive| *alive)
                        .map(|_| (preview.view.run_id.clone(), preview.view.port))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn view(preview: &mut Preview) -> Result<PreviewView, String> {
    match &mut preview.process {
        Process::Web { child, tree } => {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                preview.view.running = false;
                preview.view.exit_code = status.code();
                tree.terminate();
            }
        }
        Process::Simulator(session) => {
            let phase = session.phase();
            preview.view.running = phase.active();
            preview.view.ready = phase == simulator::Phase::Running;
            preview.view.simulator = Some(session.view());
        }
    }
    let mut result = preview.view.clone();
    result.output = preview.output.lock().map_err(|e| e.to_string())?.clone();
    Ok(result)
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::previews::features::project_feature_suggestions,
            commands::previews::features::project_feature_drift,
            commands::previews::task_preview_start,
            commands::previews::task_preview_status,
            commands::previews::task_preview_stop,
            commands::previews::task_preview_inspect,
            commands::previews::task_preview_inspect_cancel,
            commands::previews::design::task_preview_design_open,
            commands::previews::design::task_preview_design_capture,
            commands::previews::simulator_preview_target,
            commands::previews::task_preview_simulator_start,
            commands::previews::task_preview_simulator_reload,
            commands::previews::task_preview_simulator_frame,
            commands::previews::task_preview_simulator_act,
            commands::previews::task_preview_simulator_elements,
            commands::previews::task_preview_simulator_select,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[tauri::command]
pub async fn task_preview_status(id: String) -> Result<Option<PreviewView>, String> {
    tauri::async_runtime::spawn_blocking(move || preview_status(id))
        .await
        .map_err(|e| e.to_string())?
}

fn preview_status(id: String) -> Result<Option<PreviewView>, String> {
    let mut result = sessions()
        .lock()
        .map_err(|e| e.to_string())?
        .get_mut(&id)
        .map(view)
        .transpose()?;
    if let Some(value) = result
        .as_mut()
        .filter(|value| value.kind == PreviewKind::Web)
    {
        value.ready = value.running && http_ready(value.port);
    }
    Ok(result)
}

fn http_ready(port: u16) -> bool {
    http_ready_at(port, "/", Duration::from_millis(300))
}

fn http_ready_at(port: u16, path: &str, timeout: Duration) -> bool {
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, timeout) else {
        return false;
    };
    if stream.set_read_timeout(Some(timeout)).is_err()
        || stream.set_write_timeout(Some(timeout)).is_err()
    {
        return false;
    }
    let request =
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let deadline = std::time::Instant::now() + timeout;
    successful_http_response(|buffer| {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Err(std::io::ErrorKind::TimedOut.into());
        }
        stream.set_read_timeout(Some(remaining))?;
        stream.read(buffer)
    })
}

fn successful_http_response(mut read: impl FnMut(&mut [u8]) -> std::io::Result<usize>) -> bool {
    let mut buffer = [0u8; 128];
    let mut count = 0;
    while count < buffer.len() {
        match read(&mut buffer[count..]) {
            Ok(0) => return false,
            Ok(read) => count += read,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return false,
        }
        if let Some(end) = buffer[..count].iter().position(|byte| *byte == b'\n') {
            let status = String::from_utf8_lossy(&buffer[..end]);
            return status.starts_with("HTTP/1.")
                && status
                    .split_whitespace()
                    .nth(1)
                    .and_then(|code| code.parse::<u16>().ok())
                    .is_some_and(|code| (200..400).contains(&code));
        }
    }
    false
}

#[tauri::command]
pub async fn task_preview_start(
    id: String,
    command: String,
    port: u16,
    state: State<'_, TaskRuntime>,
) -> Result<PreviewView, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || start_preview(&runtime, id, command, port))
        .await
        .map_err(|e| e.to_string())?
}

fn start_preview(
    runtime: &TaskRuntime,
    id: String,
    command: String,
    port: u16,
) -> Result<PreviewView, String> {
    let _guard = integration::execution_guard()?;
    if command.trim().is_empty()
        || command.len() > 4000
        || command.contains('\0')
        || !command.contains("{port}")
        || (port != 0 && port < 1024)
    {
        return Err(
            "Use a preview command containing {port} and an unprivileged port (1024–65535).".into(),
        );
    }
    let runs = runtime.integration_runs()?;
    let run = runs.iter().find(|r| r.id == id).ok_or("Task not found")?;
    if runs
        .iter()
        .any(|r| r.workspace == run.workspace && r.status.is_live())
    {
        return Err("Finish active work and resolve interrupted ownership before starting a managed preview.".into());
    }
    ensure_idle(&run.workspace)?;
    super::verification::ensure_idle(&run.workspace)?;
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|_| {
        "This port is in use. Choose another port; no existing process was stopped.".to_string()
    })?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let expanded = command.replace("{port}", &port.to_string());
    let mut cmd = preview_process(&expanded, &run.workspace, port);
    runtime.update_checked(&id, |r| {
        r.activity
            .push(format!("Managed preview requested on local port {port}."))
    })?;
    let mut sessions = sessions().lock().map_err(|e| e.to_string())?;
    if sessions.len() >= 8 && !sessions.contains_key(&id) {
        return Err(
            "Stop and clear an existing preview before opening another (limit eight).".into(),
        );
    }
    drop(listener);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Preview could not start: {e}"))?;
    let tree = match ProcessTree::attach(&child) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let output = Arc::new(Mutex::new(String::new()));
    fn read(reader: impl std::io::Read + Send + 'static, output: Arc<Mutex<String>>) {
        std::thread::spawn(move || {
            let _ =
                super::process_control::bounded_lines(BufReader::new(reader), 4000, |line, _| {
                    if let Ok(mut out) = output.lock() {
                        if out.len() < 64000 {
                            out.push_str(&line);
                            out.push('\n');
                        }
                    }
                });
        });
    }
    if let Some(stdout) = child.stdout.take() {
        read(stdout, output.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        read(stderr, output.clone());
    }
    let result = PreviewView {
        run_id: id.clone(),
        command: expanded,
        kind: PreviewKind::Web,
        port,
        running: true,
        ready: false,
        exit_code: None,
        output: String::new(),
        simulator: None,
    };
    sessions.insert(
        id,
        Preview {
            identity: uuid::Uuid::new_v4().to_string(),
            workspace: run.workspace.clone(),
            process: Process::Web { child, tree },
            view: result.clone(),
            output,
        },
    );
    Ok(result)
}

/// A preview command ready to spawn in `workspace`, with output piped and the
/// task bridge credentials removed.
fn preview_process(expanded: &str, workspace: &str, port: u16) -> Command {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd.exe");
        c.args(["/D", "/S", "/C", expanded]);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("/bin/sh");
        c.args(["-c", expanded]);
        c
    };
    super::process_control::isolated(&mut cmd);
    cmd.current_dir(workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PORT", port.to_string())
        .env_remove("JACKALOPE_BRIDGE_TOKEN")
        .env_remove("JACKALOPE_BRIDGE_URL");
    super::xcode::apply_for(&mut cmd, std::path::Path::new(workspace));
    if let Some(device) = super::simulators::assigned(workspace) {
        cmd.envs(device.environment());
        super::xcode::apply(&mut cmd);
    }
    cmd
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewInspection {
    screenshot: super::harness::ScreenshotArtifact,
    snapshot: String,
    errors: String,
}

struct InspectionSession {
    id: String,
    directory: std::path::PathBuf,
}
impl Drop for InspectionSession {
    fn drop(&mut self) {
        super::browser::close(&self.id);
        if self.directory.parent() == Some(std::env::temp_dir().as_path())
            && self.directory.file_name().is_some_and(|name| {
                name.to_string_lossy()
                    .starts_with("jackalope-preview-inspection-")
            })
        {
            let _ = std::fs::remove_dir_all(&self.directory);
        }
    }
}

#[tauri::command]
pub fn task_preview_inspect_cancel(request_id: String) -> Result<(), String> {
    uuid::Uuid::parse_str(&request_id).map_err(|_| "Invalid preview inspection")?;
    super::browser::close(&format!("preview-inspection-{request_id}"));
    Ok(())
}

#[tauri::command]
pub async fn task_preview_inspect(
    id: String,
    request_id: String,
    path: String,
    narrow: bool,
    state: State<'_, TaskRuntime>,
) -> Result<PreviewInspection, String> {
    inspect_preview(state.inner().clone(), id, request_id, path, narrow).await
}

async fn inspect_preview(
    runtime: TaskRuntime,
    id: String,
    request_id: String,
    path: String,
    narrow: bool,
) -> Result<PreviewInspection, String> {
    use super::harness::{BrowserConfigureRequest, BrowserInspectRequest, BrowserSnapshotRequest};
    uuid::Uuid::parse_str(&request_id).map_err(|_| "Invalid preview inspection")?;
    if !path.starts_with('/')
        || path.starts_with("//")
        || path.len() > 2000
        || path.chars().any(|c| c == '\\' || c.is_control())
    {
        return Err("Choose a local preview page beginning with /.".into());
    }
    let (port, identity) = {
        let mut sessions = sessions().lock().map_err(|e| e.to_string())?;
        let preview = sessions
            .get_mut(&id)
            .ok_or("Start this task's preview before capturing evidence.")?;
        if preview.view.kind != PreviewKind::Web {
            return Err("Fresh page captures are for web previews.".into());
        }
        if !view(preview)?.running {
            return Err("The preview has stopped.".into());
        }
        (preview.view.port, preview.identity.clone())
    };
    let directory = std::env::temp_dir().join(format!("jackalope-preview-inspection-{request_id}"));
    std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
    let inspection = InspectionSession {
        id: format!("preview-inspection-{request_id}"),
        directory,
    };
    super::browser::register(&inspection.id);
    super::browser::browser_configure(
        &inspection.id,
        BrowserConfigureRequest {
            width: Some(if narrow { 390 } else { 1280 }),
            height: Some(840),
            color_scheme: None,
            reduced_motion: Some(true),
        },
    )
    .await?;
    let snapshot = super::browser::browser_snapshot(
        &inspection.id,
        BrowserSnapshotRequest {
            url: Some(format!("http://127.0.0.1:{port}{path}")),
            mode: "accessibility".into(),
            selector: None,
            interactive: false,
        },
    )
    .await?;
    let screenshot = super::browser::browser_screenshot(
        &inspection.id,
        &inspection.directory,
        Some("Fresh preview capture".into()),
        None,
    )
    .await?;
    let errors = super::browser::browser_inspect(
        &inspection.id,
        BrowserInspectRequest {
            kind: "errors".into(),
            selector: None,
        },
    )
    .await?;
    let bytes = std::fs::read(&screenshot.file_path).map_err(|e| e.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = integration::execution_guard()?;
        {
            let mut sessions = sessions().lock().map_err(|e| e.to_string())?;
            let preview = sessions
                .get_mut(&id)
                .ok_or("Preview stopped during capture. Try again after restarting it.")?;
            if preview.identity != identity || !view(preview)?.running {
                return Err(
                    "Preview changed during capture. Capture the current result again.".into(),
                );
            }
        }
        let runs = runtime.integration_runs()?;
        let run = runs
            .iter()
            .find(|run| run.id == id)
            .ok_or("Task not found")?;
        let directory =
            crate::commands::artifacts::evidence_folder(std::path::Path::new(&run.workspace))?;
        let destination = directory.join(format!("{}.png", screenshot.id));
        std::fs::write(&destination, bytes).map_err(|e| e.to_string())?;
        let mut screenshot = screenshot;
        screenshot.file_path = destination.to_string_lossy().into_owned();
        runtime.update_checked(&id, |run| run.screenshots.push(screenshot.clone()))?;
        Ok(PreviewInspection {
            screenshot,
            snapshot: snapshot["snapshot"]
                .as_str()
                .unwrap_or("")
                .chars()
                .take(12000)
                .collect(),
            errors: errors["content"]
                .as_str()
                .unwrap_or("")
                .chars()
                .take(4000)
                .collect(),
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    drop(inspection);
    result
}

#[tauri::command]
pub async fn task_preview_stop(id: String, state: State<'_, TaskRuntime>) -> Result<(), String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || stop_preview(&runtime, id))
        .await
        .map_err(|e| e.to_string())?
}

fn stop_preview(runtime: &TaskRuntime, id: String) -> Result<(), String> {
    let _guard = integration::execution_guard()?;
    design::close(&id);
    let mut sessions = sessions().lock().map_err(|e| e.to_string())?;
    let Some(preview) = sessions.get_mut(&id) else {
        return Ok(());
    };
    preview.process.end(true);
    preview.view.running = false;
    let output = preview.output.lock().map_err(|e| e.to_string())?.clone();
    runtime.update_checked(&id, |r| {
        r.diagnostics.push(format!(
            "Managed preview ({}):\n{output}",
            preview.view.command
        ))
    })?;
    sessions.remove(&id);
    Ok(())
}

/// How a workspace runs in the iOS Simulator, or `None` when it is not an
/// iOS app project.
#[tauri::command]
pub async fn simulator_preview_target(path: String) -> Result<Option<simulator::Target>, String> {
    tauri::async_runtime::spawn_blocking(move || simulator::target(std::path::Path::new(&path)))
        .await
        .map_err(|e| e.to_string())
}

/// Builds the task's app for its own Simulator and launches it. `command`
/// replaces the detected build; empty uses it.
#[tauri::command]
pub async fn task_preview_simulator_start(
    id: String,
    command: Option<String>,
    state: State<'_, TaskRuntime>,
) -> Result<PreviewView, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || start_simulator_preview(&runtime, id, command))
        .await
        .map_err(|e| e.to_string())?
}

fn start_simulator_preview(
    runtime: &TaskRuntime,
    id: String,
    command: Option<String>,
) -> Result<PreviewView, String> {
    let _guard = integration::execution_guard()?;
    let custom = command
        .as_deref()
        .map(str::trim)
        .filter(|command| !command.is_empty())
        .map(simulator::valid_command)
        .transpose()?
        .map(str::to_string);
    let runs = runtime.integration_runs()?;
    let run = runs.iter().find(|r| r.id == id).ok_or("Task not found")?;
    if runs
        .iter()
        .any(|r| r.workspace == run.workspace && r.status.is_live())
    {
        return Err("Finish active work and resolve interrupted ownership before starting a managed preview.".into());
    }
    let target = simulator::target(std::path::Path::new(&run.workspace))
        .ok_or("This workspace has no Xcode project that builds an iOS app.")?;
    if let Some(issue) = target.issue.as_ref().filter(|_| {
        custom.is_none() || !super::simulator::supported() || super::xcode::toolchain().is_none()
    }) {
        return Err(issue.clone());
    }
    let mut previews = sessions().lock().map_err(|e| e.to_string())?;
    if let Some(existing) = previews.get_mut(&id) {
        if existing.process.alive()? {
            return Err("Stop the current preview before starting another.".into());
        }
    }
    if previews.len() >= 8 && !previews.contains_key(&id) {
        return Err(
            "Stop and clear an existing preview before opening another (limit eight).".into(),
        );
    }
    drop(previews);
    ensure_idle(&run.workspace)?;
    super::verification::ensure_idle(&run.workspace)?;
    runtime.update_checked(&id, |r| {
        r.activity.push("Simulator preview requested.".to_string())
    })?;
    let display = custom.clone().unwrap_or(target.build_command);
    let output = Arc::new(Mutex::new(String::new()));
    let session =
        simulator::Session::new(runtime.clone(), &id, &run.workspace, custom, output.clone());
    let mut preview = Preview {
        identity: uuid::Uuid::new_v4().to_string(),
        workspace: run.workspace.clone(),
        process: Process::Simulator(session.clone()),
        view: PreviewView {
            run_id: id.clone(),
            command: display,
            kind: PreviewKind::Simulator,
            port: 0,
            running: true,
            ready: false,
            exit_code: None,
            output: String::new(),
            simulator: None,
        },
        output,
    };
    session.start();
    let result = view(&mut preview)?;
    let mut previews = sessions().lock().map_err(|e| e.to_string())?;
    if let Some(mut old) = previews.insert(id, preview) {
        old.process.end(false);
    }
    Ok(result)
}

/// The task's Simulator preview session, or why there is none.
fn simulator_session(id: &str) -> Result<(Arc<simulator::Session>, String), String> {
    let sessions = sessions().lock().map_err(|e| e.to_string())?;
    match sessions
        .get(id)
        .map(|preview| (&preview.process, &preview.identity))
    {
        Some((Process::Simulator(session), identity)) => Ok((session.clone(), identity.clone())),
        Some(_) => Err("This task's preview is a web preview.".into()),
        None => Err("Start the Simulator preview first.".into()),
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

/// Builds, installs and launches the app again, for changes made since.
#[tauri::command]
pub async fn task_preview_simulator_reload(id: String) -> Result<(), String> {
    blocking(move || {
        let _guard = integration::execution_guard()?;
        let (session, _) = simulator_session(&id)?;
        session.start();
        Ok(())
    })
    .await
}

/// The Simulator screen now, scaled for the Preview tab. Never saved.
#[tauri::command]
pub async fn task_preview_simulator_frame(id: String) -> Result<simulator::Frame, String> {
    blocking(move || simulator_session(&id)?.0.frame()).await
}

/// A tap, typing, Home, rotation or a device setting from the person.
#[tauri::command]
pub async fn task_preview_simulator_act(
    id: String,
    action: simulator::Action,
) -> Result<(), String> {
    blocking(move || simulator_session(&id)?.0.act(&action)).await
}

/// The elements on screen with their frames, for Select mode.
#[tauri::command]
pub async fn task_preview_simulator_elements(id: String) -> Result<simulator::Elements, String> {
    blocking(move || simulator_session(&id)?.0.elements()).await
}

/// A selection note for the element at a frame position: a cropped capture
/// and `.selection.json` saved with the task's evidence.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorSelection {
    selection: serde_json::Value,
    screenshot: super::harness::ScreenshotArtifact,
    context_path: String,
}

#[tauri::command]
pub async fn task_preview_simulator_select(
    id: String,
    x: f64,
    y: f64,
    state: State<'_, TaskRuntime>,
) -> Result<SimulatorSelection, String> {
    let runtime = state.inner().clone();
    blocking(move || select_simulator_element(&runtime, &id, x, y)).await
}

fn select_simulator_element(
    runtime: &TaskRuntime,
    id: &str,
    x: f64,
    y: f64,
) -> Result<SimulatorSelection, String> {
    let (session, identity) = simulator_session(id)?;
    let selected = session.select(x, y)?;
    let _guard = integration::execution_guard()?;
    if simulator_session(id)?.1 != identity {
        return Err("The preview changed during capture. Select the element again.".into());
    }
    let runs = runtime.integration_runs()?;
    let run = runs
        .iter()
        .find(|run| run.id == id)
        .ok_or("Task not found")?;
    let directory = super::artifacts::evidence_folder(std::path::Path::new(&run.workspace))?;
    let (width, height) = super::harness::png_dimensions(&selected.png)?;
    let artifact_id = uuid::Uuid::new_v4().to_string();
    let destination = directory.join(format!("{artifact_id}.png"));
    std::fs::write(&destination, &selected.png).map_err(|e| e.to_string())?;
    let selection = selected.selection(&artifact_id);
    let context_path = directory.join(format!("{artifact_id}.selection.json"));
    std::fs::write(
        &context_path,
        serde_json::to_vec_pretty(&selection).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let screenshot = super::harness::ScreenshotArtifact {
        id: artifact_id,
        name: format!(
            "Selected {}",
            selection["tag"].as_str().unwrap_or("element")
        ),
        url: format!("simulator://{}", selected.udid),
        file_path: destination.to_string_lossy().into_owned(),
        width,
        height,
        timestamp: chrono::Utc::now().to_rfc3339(),
    };
    runtime.update_checked(id, |run| run.screenshots.push(screenshot.clone()))?;
    Ok(SimulatorSelection {
        selection,
        screenshot,
        context_path: context_path.to_string_lossy().into_owned(),
    })
}

/// Entry points the Simulator preview's native test drives.
#[cfg(test)]
pub(in crate::commands::previews) mod tests_support {
    use super::*;

    pub fn start(runtime: &TaskRuntime, id: &str) {
        start_simulator_preview(runtime, id.to_string(), None).unwrap();
    }

    pub fn status(id: &str) -> PreviewView {
        preview_status(id.to_string()).unwrap().unwrap()
    }

    pub fn session(id: &str) -> Arc<simulator::Session> {
        simulator_session(id).unwrap().0
    }

    pub fn select(runtime: &TaskRuntime, id: &str, x: f64, y: f64) -> serde_json::Value {
        serde_json::to_value(select_simulator_element(runtime, id, x, y).unwrap()).unwrap()
    }

    pub fn stop(runtime: &TaskRuntime, id: &str) {
        stop_preview(runtime, id.to_string()).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readiness_handles_fragmented_status_lines() {
        for (response, expected) in [
            ("HTTP/1.1 200 OK\r\n", true),
            ("HTTP/1.0 302 Found\r\n", true),
            ("HTTP/1.1 503 Unavailable\r\n", false),
        ] {
            for split in 1..response.len() {
                let (first, rest) = response.as_bytes().split_at(split);
                let mut reader = first.chain(rest);
                assert_eq!(
                    successful_http_response(|buffer| reader.read(buffer)),
                    expected,
                    "response {response:?}, split at {split}"
                );
            }
        }
    }

    #[test]
    fn readiness_rejects_incomplete_oversized_and_failed_reads() {
        for response in ["", "HTTP/1.1 200 OK", "not HTTP\r\n"] {
            let mut reader = response.as_bytes();
            assert!(!successful_http_response(|buffer| reader.read(buffer)));
        }
        let response = format!("HTTP/1.1 200 {}\r\n", "x".repeat(128));
        let mut reader = response.as_bytes();
        assert!(!successful_http_response(|buffer| reader.read(buffer)));
        for kind in [
            std::io::ErrorKind::TimedOut,
            std::io::ErrorKind::WouldBlock,
            std::io::ErrorKind::ConnectionReset,
        ] {
            let mut prefix = "HTTP/1.1 200".as_bytes();
            assert!(!successful_http_response(|buffer| {
                if prefix.is_empty() {
                    Err(kind.into())
                } else {
                    prefix.read(buffer)
                }
            }));
        }
    }

    #[test]
    fn readiness_retries_interrupted_reads_and_stops_at_the_status_line() {
        let mut calls = 0;
        assert!(successful_http_response(|buffer| {
            calls += 1;
            match calls {
                1 => Err(std::io::ErrorKind::Interrupted.into()),
                2 => "HTTP/1.1 204 No Content\r\n".as_bytes().read(buffer),
                _ => panic!("Read past the complete status line"),
            }
        }));
    }

    #[test]
    fn readiness_requires_a_successful_http_response() {
        for (response, expected) in [
            ("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", true),
            ("HTTP/1.0 302 Found\r\nContent-Length: 0\r\n\r\n", true),
            ("HTTP/1.1 503 Unavailable\r\n\r\n", false),
            ("not HTTP", false),
        ] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let port = listener.local_addr().unwrap().port();
            let server = std::thread::spawn(move || {
                let (mut client, _) = listener.accept().unwrap();
                client
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                client
                    .set_write_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let request = format!(
                    "GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
                );
                let mut received = vec![0; request.len()];
                client.read_exact(&mut received).unwrap();
                assert_eq!(received, request.as_bytes());
                client.write_all(response.as_bytes()).unwrap();
            });
            let ready = http_ready_at(port, "/", Duration::from_secs(5));
            server.join().unwrap();
            assert_eq!(ready, expected, "response {response:?}");
        }
    }
    fn fixture() -> (TaskRuntime, std::path::PathBuf, String) {
        let root =
            std::env::temp_dir().join(format!("jackalope-preview-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let history = root.join("history");
        std::fs::create_dir_all(&history).unwrap();
        let record = serde_json::json!({ "id": id, "taskId": id, "projectId": "test", "projectName": "Test", "projectPath": root, "workspace": root, "branch": "main", "baseHead": "unused", "agent": "codex", "account": "test", "model": null, "prompt": "Preview fixture", "status": "review", "startedAt": "2026-09-08T10:00:00Z", "endedAt": null, "sessionId": null, "result": "Fixture", "activity": [], "diagnostics": [], "error": null, "persistenceError": null, "exitCode": 0, "usage": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "reported": false, "estimatedCostUsd": null } });
        std::fs::write(
            history.join(format!("{id}.json")),
            serde_json::to_vec(&record).unwrap(),
        )
        .unwrap();
        let runtime = TaskRuntime::new(history).unwrap();
        (runtime, root, id)
    }

    fn remove_fixture(root: std::path::PathBuf) {
        let root = dunce::canonicalize(root).unwrap();
        let temporary = dunce::canonicalize(std::env::temp_dir()).unwrap();
        assert_eq!(root.parent(), Some(temporary.as_path()));
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("jackalope-preview-test-"));
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            match std::fs::remove_dir_all(&root) {
                Ok(()) => return,
                // Windows can retain a child's working-directory handle after termination.
                Err(error)
                    if cfg!(windows)
                        && error.raw_os_error() == Some(32)
                        && std::time::Instant::now() < deadline =>
                {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(error) => panic!(
                    "Could not remove preview fixture {}: {error}",
                    root.display()
                ),
            }
        }
    }

    #[tokio::test]
    #[ignore = "Runs a disposable local web server and the bundled browser for preview evidence"]
    async fn real_preview_capture_preserves_evidence_and_ownership() {
        let (runtime, root, id) = fixture();
        std::fs::write(root.join("server.cjs"), "require('http').createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<h1>Preview evidence fixture</h1><button>Save change</button>')}).listen(Number(process.argv[2]),'127.0.0.1')").unwrap();
        let preview =
            start_preview(&runtime, id.clone(), "node server.cjs {port}".into(), 0).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while !http_ready(preview.port) {
            assert!(std::time::Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let request = uuid::Uuid::new_v4().to_string();
        let result = inspect_preview(
            runtime.clone(),
            id.clone(),
            request.clone(),
            "/".into(),
            true,
        )
        .await
        .unwrap();
        assert!(
            result.snapshot.contains("Save change"),
            "{}",
            result.snapshot
        );
        assert!(std::path::Path::new(&result.screenshot.file_path).starts_with(&root));
        assert!(std::fs::read(&result.screenshot.file_path)
            .unwrap()
            .starts_with(b"\x89PNG"));
        assert_eq!(
            runtime.integration_runs().unwrap()[0].screenshots[0].id,
            result.screenshot.id
        );
        assert!(!std::env::temp_dir()
            .join(format!("jackalope-preview-inspection-{request}"))
            .exists());
        assert!(ensure_idle(root.to_str().unwrap()).is_err());
        stop_preview(&runtime, id.clone()).unwrap();
        assert!(inspect_preview(
            runtime.clone(),
            id,
            uuid::Uuid::new_v4().to_string(),
            "/".into(),
            false
        )
        .await
        .is_err());
        drop(runtime);
        remove_fixture(root);
    }

    #[test]
    fn previews_respect_ports_ownership_and_keep_logs() {
        let (runtime, root, id) = fixture();
        let occupied = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = occupied.local_addr().unwrap().port();
        let command = if cfg!(windows) {
            "echo PREVIEW_TEST_{port} & ping -n 30 127.0.0.1 >nul"
        } else {
            "echo PREVIEW_TEST_{port}; sleep 30"
        };
        assert!(start_preview(&runtime, id.clone(), command.into(), port)
            .err()
            .unwrap()
            .contains("port is in use"));
        assert!(occupied.local_addr().is_ok());
        drop(occupied);
        let result = start_preview(&runtime, id.clone(), command.into(), 0).unwrap();
        assert!(result.running);
        assert!(result.port >= 1024);
        assert!(!result.ready);
        assert!(ensure_idle(root.to_str().unwrap()).is_err());
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if preview_status(id.clone())
                .unwrap()
                .unwrap()
                .output
                .contains("PREVIEW_TEST")
            {
                break;
            }
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        stop_preview(&runtime, id.clone()).unwrap();
        assert!(ensure_idle(root.to_str().unwrap()).is_ok());
        assert!(preview_status(id.clone()).unwrap().is_none());
        assert!(runtime
            .integration_runs()
            .unwrap()
            .iter()
            .find(|r| r.id == id)
            .unwrap()
            .diagnostics
            .iter()
            .any(|line| line.contains("PREVIEW_TEST")));
        drop(runtime);
        remove_fixture(root);
    }
}
