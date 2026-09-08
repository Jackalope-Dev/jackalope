use super::{integration, process_control::ProcessTree, tasks::TaskRuntime};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::BufReader,
    net::TcpListener,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
};
use tauri::State;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewView {
    pub run_id: String,
    pub command: String,
    pub port: u16,
    pub running: bool,
    pub exit_code: Option<i32>,
    pub output: String,
}
struct Preview {
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
pub fn task_preview_status(id: String) -> Result<Option<PreviewView>, String> {
    sessions()
        .lock()
        .map_err(|e| e.to_string())?
        .get_mut(&id)
        .map(view)
        .transpose()
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
        || port < 1024
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
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|_| {
        "This port is in use. Choose another port; no existing process was stopped.".to_string()
    })?;
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
        exit_code: None,
        output: String::new(),
    };
    sessions.insert(
        id,
        Preview {
            workspace: run.workspace.clone(),
            child,
            tree,
            view: result.clone(),
            output,
        },
    );
    Ok(result)
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
    fn previews_respect_ports_ownership_and_keep_logs() {
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
        let result = start_preview(&runtime, id.clone(), command.into(), port).unwrap();
        assert!(result.running);
        assert!(ensure_idle(root.to_str().unwrap()).is_err());
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if task_preview_status(id.clone())
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
        assert!(task_preview_status(id.clone()).unwrap().is_none());
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
