use super::{integration, process_control::ProcessTree, tasks::TaskRuntime};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tauri::State;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewView {
    pub run_id: String,
    pub command: String,
    pub port: u16,
    pub running: bool,
    pub ready: bool,
    pub exit_code: Option<i32>,
    pub output: String,
}
struct Preview {
    identity: String,
    workspace: String,
    child: Child,
    tree: ProcessTree,
    view: PreviewView,
    output: Arc<Mutex<String>>,
}
static PREVIEWS: OnceLock<Mutex<HashMap<String, Preview>>> = OnceLock::new();
fn sessions() -> &'static Mutex<HashMap<String, Preview>> {
    PREVIEWS.get_or_init(Default::default)
}

pub fn ensure_idle(workspace: &str) -> Result<(), String> {
    let path = dunce::canonicalize(workspace).map_err(|e| e.to_string())?;
    let mut sessions = sessions().lock().map_err(|e| e.to_string())?;
    for preview in sessions.values_mut() {
        if dunce::canonicalize(&preview.workspace).ok().as_ref() == Some(&path) {
            if preview
                .child
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_some()
            {
                preview.tree.terminate();
                continue;
            }
            return Err("Stop this workspace's managed preview before continuing work, integrating or removing it.".into());
        }
    }
    Ok(())
}

pub fn close_all() {
    if let Ok(mut sessions) = sessions().lock() {
        for preview in sessions.values_mut() {
            preview.tree.terminate();
            let _ = preview.child.wait();
        }
        sessions.clear();
    }
}

fn view(preview: &mut Preview) -> Result<PreviewView, String> {
    if let Some(status) = preview.child.try_wait().map_err(|e| e.to_string())? {
        preview.view.running = false;
        preview.view.exit_code = status.code();
        preview.tree.terminate();
    }
    let mut result = preview.view.clone();
    result.output = preview.output.lock().map_err(|e| e.to_string())?.clone();
    Ok(result)
}

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
    if let Some(value) = result.as_mut() {
        value.ready = value.running && http_ready(value.port);
    }
    Ok(result)
}

fn http_ready(port: u16) -> bool {
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let timeout = Duration::from_millis(300);
    let Ok(mut stream) = TcpStream::connect_timeout(&address, timeout) else {
        return false;
    };
    if stream.set_read_timeout(Some(timeout)).is_err()
        || stream.set_write_timeout(Some(timeout)).is_err()
    {
        return false;
    }
    if write!(
        stream,
        "GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    )
    .is_err()
    {
        return false;
    }
    let mut buffer = [0u8; 128];
    let Ok(count) = stream.read(&mut buffer) else {
        return false;
    };
    let status = String::from_utf8_lossy(&buffer[..count]);
    status.starts_with("HTTP/1.")
        && status
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse::<u16>().ok())
            .is_some_and(|code| (200..400).contains(&code))
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
    runtime.access.ensure()?;
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
    if runs.iter().any(|r| {
        r.workspace == run.workspace
            && ["starting", "running", "stopping", "interrupted"].contains(&r.status.as_str())
    }) {
        return Err("Finish active work and resolve interrupted ownership before starting a managed preview.".into());
    }
    ensure_idle(&run.workspace)?;
    super::verification::ensure_idle(&run.workspace)?;
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|_| {
        "This port is in use. Choose another port; no existing process was stopped.".to_string()
    })?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let expanded = command.replace("{port}", &port.to_string());
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("cmd.exe");
        c.args(["/D", "/S", "/C", &expanded])
            .creation_flags(0x08000000);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        use std::os::unix::process::CommandExt;
        let mut c = Command::new("/bin/sh");
        c.args(["-c", &expanded]).process_group(0);
        c
    };
    cmd.current_dir(&run.workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PORT", port.to_string())
        .env_remove("JACKALOPE_BRIDGE_TOKEN")
        .env_remove("JACKALOPE_BRIDGE_URL");
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
        port,
        running: true,
        ready: false,
        exit_code: None,
        output: String::new(),
    };
    sessions.insert(
        id,
        Preview {
            identity: uuid::Uuid::new_v4().to_string(),
            workspace: run.workspace.clone(),
            child,
            tree,
            view: result.clone(),
            output,
        },
    );
    Ok(result)
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
    runtime.access.ensure()?;
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
        let workspace = dunce::canonicalize(&run.workspace).map_err(|e| e.to_string())?;
        let directory = workspace.join(".jackalope/artifacts/screenshots");
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        if !dunce::canonicalize(&directory)
            .map_err(|e| e.to_string())?
            .starts_with(&workspace)
        {
            return Err("The artifact folder resolves outside this workspace.".into());
        }
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
    let mut sessions = sessions().lock().map_err(|e| e.to_string())?;
    let Some(preview) = sessions.get_mut(&id) else {
        return Ok(());
    };
    preview.tree.terminate();
    let _ = preview.child.wait();
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn readiness_requires_a_successful_http_response() {
        for (response, expected) in [
            ("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", true),
            ("HTTP/1.1 503 Unavailable\r\n\r\n", false),
            ("not HTTP", false),
        ] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let port = listener.local_addr().unwrap().port();
            let server = std::thread::spawn(move || {
                let (mut client, _) = listener.accept().unwrap();
                client
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = [0; 512];
                let _ = client.read(&mut request);
                client.write_all(response.as_bytes()).unwrap();
            });
            assert_eq!(http_ready(port), expected);
            server.join().unwrap();
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
        let runtime = TaskRuntime::with_test_access(history).unwrap();
        (runtime, root, id)
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
        assert_eq!(root.parent(), Some(std::env::temp_dir().as_path()));
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("jackalope-preview-test-"));
        std::fs::remove_dir_all(root).unwrap();
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
        if root.parent() == Some(std::env::temp_dir().as_path())
            && root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("jackalope-preview-test-")
        {
            std::fs::remove_dir_all(root).unwrap();
        }
    }
}
