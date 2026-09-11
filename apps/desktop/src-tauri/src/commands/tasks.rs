mod antigravity;
mod delegation;
mod efficiency;
pub(super) mod effort;
pub(in crate::commands) mod events;
pub(super) mod helper_process;
mod journal;
#[cfg(test)]
mod journal_tests;
pub(super) mod kimi;
mod models;
#[cfg(test)]
mod performance;
pub(super) mod preparation;
mod project_setup;
mod routing;
mod runners;
mod runtime;
mod snapshots;
mod storage;
#[cfg(test)]
mod tests;
pub(super) mod timing;

pub(super) use events::consume_adapter_event;
use events::*;
pub use models::*;
pub use preparation::{PreparationRecord, StepProgress};
pub use project_setup::*;
use runners::discover_runner;
pub(super) use runners::executable;
pub(super) use runners::BUILTIN_AGENTS;
pub use snapshots::task_changes;

use super::history::{quarantine, HistoryRecovery, HistoryRecoveryEntry};
use chrono::Utc;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Inner {
    runs: HashMap<String, TaskRun>,
    recovery: Vec<HistoryRecoveryEntry>,
    processes: HashMap<String, Arc<Mutex<std::process::Child>>>,
    canceled: std::collections::HashSet<String>,
}

#[derive(Clone)]
pub struct TaskRuntime {
    pub(crate) access: Arc<super::execution_access::ExecutionAccess>,
    pub(super) knowledge: super::knowledge::KnowledgeStore,
    pub(in crate::commands) mcp_broker: super::mcp_broker::Broker,
    inner: Arc<Mutex<Inner>>,
    directory: PathBuf,
    // Drop joins the writer before releasing the profile lock below.
    writer: journal::Writer,
    _owner: Arc<super::file_lock::FileLock>,
}

fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd
}

fn git(path: &str, args: &[&str]) -> Result<String, String> {
    let out =
        super::git_command::command(Path::new(path), args, super::git_command::Policy::Inherited)
            .output()
            .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim_end().into())
}

pub(super) fn resolve_target_branch(path: &str, requested: Option<&str>) -> Result<String, String> {
    let branch = match requested {
        Some(branch) => branch.to_string(),
        None => git(path, &["symbolic-ref", "--quiet", "--short", "HEAD"]).map_err(|_| {
            "Choose a local target branch; this repository has a detached HEAD.".to_string()
        })?,
    };
    let reference = format!("refs/heads/{branch}");
    git(path, &["check-ref-format", &reference])
        .map_err(|_| "Choose a valid local branch.".to_string())?;
    git(
        path,
        &["rev-parse", "--verify", &format!("{reference}^{{commit}}")],
    )
    .map_err(|_| format!("The local branch {branch} does not exist or has no commits."))?;
    Ok(branch)
}

fn valid_id(id: &str) -> bool {
    (8..=80).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

pub(super) fn probe_auth(
    path: PathBuf,
    args: Vec<&str>,
    binding: Option<&crate::commands::agent_profiles::AccountBinding>,
) -> Result<std::process::Output, std::io::Error> {
    let mut cmd = command(path);
    cmd.args(args);
    if let Some(binding) = binding {
        crate::commands::agent_sign_in::ensure_idle(binding).map_err(std::io::Error::other)?;
        crate::commands::agent_profiles::apply_binding(&mut cmd, binding)
            .map_err(std::io::Error::other)?;
    }
    let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::null()).spawn()?;
    let tree = match super::process_control::ProcessTree::attach(&child) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::other(error));
        }
    };
    let stdout = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut data = Vec::new();
        let _ = stdout.take(64_000).read_to_end(&mut data);
        data
    });
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(status) = child.try_wait()? {
            tree.terminate();
            return Ok(std::process::Output {
                status,
                stdout: reader.join().unwrap_or_default(),
                stderr: vec![],
            });
        }
        if std::time::Instant::now() >= deadline {
            tree.terminate();
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "Sign-in check timed out. Open the agent CLI to check its configuration, then refresh."));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[tauri::command]
pub async fn task_runners(runtime: State<'_, TaskRuntime>) -> Result<Vec<Runner>, String> {
    let policy = runtime.policy()?;
    let profiles_root = runtime.profiles_root();
    let mut ids: Vec<String> = BUILTIN_AGENTS.iter().map(|id| (*id).into()).collect();
    ids.extend(policy.custom_agents.iter().map(|a| a.id.clone()));
    // Each agent's discovery/sign-in probe can take up to probe_auth's own
    // 10-second timeout. Running them in one sequential closure (the
    // previous shape) meant a single slow or hanging CLI added its own
    // full timeout to the total wait for every OTHER agent's status too -
    // worst case ~10s per configured agent instead of ~10s overall.
    // Spawning one blocking task per agent and awaiting them together
    // bounds the whole call by the slowest single probe, not their sum.
    let handles: Vec<_> = ids
        .into_iter()
        .map(|id| {
            let policy = policy.clone();
            let profiles_root = profiles_root.clone();
            tauri::async_runtime::spawn_blocking(move || {
                discover_runner(&policy, &id, &profiles_root)
            })
        })
        .collect();
    let mut runners = Vec::with_capacity(handles.len());
    for handle in handles {
        runners.push(handle.await.map_err(|e| e.to_string())?);
    }
    Ok(runners)
}

#[tauri::command]
pub async fn task_pick_project(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .map(|p| {
                p.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(|e| e.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_read_context(
    project_path: String,
    relative_path: String,
) -> Result<Option<String>, String> {
    let allowed = [
        "package.json",
        "Cargo.toml",
        "AGENTS.md",
        "TODO.md",
        "TASKS.md",
        "ROADMAP.md",
        "docs/TASKS.md",
        "docs/ROADMAP.md",
        "STATUS.md",
        "docs/TODO.md",
        "docs/STATUS.md",
        "apps/desktop/package.json",
        "apps/desktop/src-tauri/Cargo.toml",
    ];
    if !allowed.contains(&relative_path.as_str()) {
        return Err("Unsupported context file.".into());
    }
    let root = std::fs::canonicalize(project_path).map_err(|e| e.to_string())?;
    let path = match std::fs::canonicalize(root.join(relative_path)) {
        Ok(path) => path,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if !path.starts_with(&root) {
        return Err("Context file resolves outside the project.".into());
    }
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > 262144 {
        return Err("Context file exceeds 256 KiB.".into());
    }
    let mut text = String::new();
    file.take(262145)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if text.len() > 262144 {
        return Err("Context file exceeds 256 KiB.".into());
    }
    Ok(Some(text))
}

#[derive(Debug, Serialize)]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub branch: String,
}

#[tauri::command]
pub async fn task_validate_project(path: String) -> Result<ProjectInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = git(&path, &["rev-parse", "--show-toplevel"])?;
        let branch = git(&root, &["branch", "--show-current"])?;
        Ok(ProjectInfo {
            name: Path::new(&root)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            path: root,
            branch,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn task_history_recovery(state: State<'_, TaskRuntime>) -> HistoryRecovery {
    HistoryRecovery {
        directory: state.directory.to_string_lossy().into_owned(),
        entries: state.inner.lock().unwrap().recovery.clone(),
    }
}

#[tauri::command]
pub fn task_retry_save(id: String, state: State<'_, TaskRuntime>) -> Result<(), String> {
    state.update_checked(&id, |_| {})
}

#[tauri::command]
pub async fn task_export_recovery(
    app: AppHandle,
    id: String,
    state: State<'_, TaskRuntime>,
) -> Result<Option<String>, String> {
    if !valid_id(&id) {
        return Err("Invalid task identifier".into());
    }
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Save a task recovery copy")
            .set_file_name(format!("task-{id}-recovery.json"))
            .add_filter("Task recovery", &["json"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        runtime.export_recovery(&id, &path)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_screenshot(
    run_id: String,
    screenshot_id: String,
    state: State<'_, TaskRuntime>,
) -> Result<Vec<u8>, String> {
    let (workspace, path) = {
        let inner = state.inner.lock().unwrap();
        let run = inner.runs.get(&run_id).ok_or("Task attempt not found")?;
        let screenshot = run
            .screenshots
            .iter()
            .find(|item| item.id == screenshot_id)
            .ok_or("Screenshot not found in this task attempt")?;
        (
            PathBuf::from(&run.workspace),
            PathBuf::from(&screenshot.file_path),
        )
    };
    tauri::async_runtime::spawn_blocking(move || {
        super::artifacts::read_screenshot(&workspace, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_set_archived(
    id: String,
    archived: bool,
    state: State<'_, TaskRuntime>,
) -> Result<(), String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.set_archived(&id, archived))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_archived_runs(state: State<'_, TaskRuntime>) -> Result<Vec<ArchivedRun>, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.archived_runs())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn task_restore_archived(
    id: String,
    state: State<'_, TaskRuntime>,
) -> Result<(), String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.restore_archived(&id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_import_recovery(
    app: AppHandle,
    state: State<'_, TaskRuntime>,
) -> Result<Option<String>, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Restore a task recovery copy")
            .add_filter("Task recovery", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let bytes = crate::commands::history::read_bounded(&path, 8_000_000)?;
        runtime.import_recovery(&bytes).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn task_runs(state: State<'_, TaskRuntime>, detail_id: Option<String>) -> Vec<TaskRun> {
    state.snapshot(detail_id.as_deref())
}

#[tauri::command]
pub async fn task_start(
    request: RunRequest,
    coordinator: State<'_, super::coordination::Coordinator>,
) -> Result<String, String> {
    let coordinator = coordinator.inner().clone();
    tauri::async_runtime::spawn_blocking(move || coordinator.start_manual(request))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_respond_prompt(
    run_id: String,
    prompt_id: String,
    answer: String,
    runtime: State<'_, TaskRuntime>,
) -> Result<bool, String> {
    runtime.respond_prompt(&run_id, &prompt_id, &answer)
}

#[tauri::command]
pub async fn task_stop(id: String, state: State<'_, TaskRuntime>) -> Result<(), String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.stop(&id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_mark_reviewed(id: String, state: State<'_, TaskRuntime>) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = super::integration::execution_guard()?;
        let runs = state.integration_runs()?;
        let current = runs
            .iter()
            .find(|r| r.id == id)
            .ok_or("Attempt not found")?;
        if !current.contract.requirements.is_empty() {
            if runs.iter().any(|r| {
                r.workspace == current.workspace
                    && ["starting", "running", "stopping", "interrupted"]
                        .contains(&r.status.as_str())
            }) {
                return Err("Resolve active workspace ownership before completing review.".into());
            }
            let directory = state.integration_directory();
            std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
            let tree = super::integration::workspace_tree(current, &directory)?;
            current.contract.require_accepted(&tree)?;
        }
        let mut inner = state.inner.lock().unwrap();
        let run = inner.runs.get_mut(&id).ok_or("Attempt not found")?;
        if run.status != "review" {
            return Err("Only a finished result can be marked reviewed.".into());
        }
        let mut updated = run.clone();
        updated.status = "reviewed".into();
        state.save(&updated)?;
        updated.persistence_error = None;
        *run = updated;
        drop(inner);
        state
            .refresh_knowledge(&current.project_id, &current.project_path, true)
            .map_err(|e| format!("Review saved, but project lessons could not refresh: {e}"))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Serialize)]
pub struct Review {
    pub files: Vec<String>,
    pub diff: String,
    pub note: String,
}

#[tauri::command]
pub async fn task_review(id: String, state: State<'_, TaskRuntime>) -> Result<Review, String> {
    let run = state
        .inner
        .lock()
        .unwrap()
        .runs
        .get(&id)
        .cloned()
        .ok_or("Attempt not found")?;
    tauri::async_runtime::spawn_blocking(move || {
        if run.workspace.is_empty() || run.base_head.is_empty() { return Err("Workspace is not available yet.".into()); }
        let changed = git(&run.workspace, &["diff", "--name-only", "-z", &run.base_head, "--"])?;
        let untracked = git(&run.workspace, &["ls-files", "--others", "--exclude-standard", "-z"])?;
        let mut files: Vec<String> = changed.split('\0').chain(untracked.split('\0')).filter(|p| !p.is_empty()).map(String::from).collect();
        files.sort(); files.dedup();
        let mut diff = git(&run.workspace, &["diff", "--no-ext-diff", "--no-textconv", &run.base_head, "--"])?;
        let root = std::fs::canonicalize(&run.workspace).map_err(|e| e.to_string())?;
        for name in untracked.split('\0').filter(|p| !p.is_empty()) {
            if diff.len() >= 120_000 { break; }
            let path = root.join(name);
            diff.push_str(&format!("\n\nNew file: {name}\n"));
            if !std::fs::canonicalize(&path).is_ok_and(|p| p.starts_with(&root)) { diff.push_str("Preview unavailable: file resolves outside the workspace.\n"); continue; }
            let mut data = Vec::new();
            match std::fs::File::open(path).and_then(|f| f.take(120_000).read_to_end(&mut data)) {
                Ok(_) => match String::from_utf8(data) { Ok(text) if !text.contains('\0') => diff.push_str(&text), _ => diff.push_str("Binary file; preview unavailable.") },
                Err(error) => diff.push_str(&format!("Preview unavailable: {error}")),
            }
        }
        Ok(Review { files, diff: diff.chars().take(120_000).collect(), note: "Current workspace compared with the task's starting commit, including new files. Existing working changes may be included when isolation is off. Preview is limited to 120,000 characters; binary files are listed only.".into() })
    }).await.map_err(|e| e.to_string())?
}
