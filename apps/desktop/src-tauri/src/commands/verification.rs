use super::{
    process_control,
    tasks::{
        events::activity,
        preparation::{self, PreparationRecord, StepProgress},
        TaskRun, TaskRuntime,
    },
};
use serde::{Deserialize, Serialize};
use std::{path::Path, process::Command, time::Duration};
use tauri::State;
mod leases;
pub(super) mod output;
pub use leases::{ensure_all_idle, ensure_idle};

/// Ceiling on a single check or setup command. Commands are cut off for going quiet
/// (see the stall budgets) long before this; it only bounds a command that keeps
/// printing forever.
pub(super) const CHECK_TIMEOUT_SECS: u64 = 1800;
/// A verification command that has printed nothing for this long is treated as wedged.
/// Generous, because a compile or test step can legitimately think in silence.
pub(super) const CHECK_STALL_SECS: u64 = 600;
/// Setup commands (installs) report progress continuously, so silence means trouble sooner.
pub(super) const PREPARE_STALL_SECS: u64 = 300;
/// How many times a setup command that was cut off mid-progress is retried in total.
pub(super) const PREPARE_ATTEMPTS: u32 = 2;
pub(super) const QUEUE_TIMEOUT_SECS: u64 = 300;
pub(super) const BRIDGE_TIMEOUT_SECS: u64 = CHECK_TIMEOUT_SECS + QUEUE_TIMEOUT_SECS + 120;

fn check_limits(stall: u64) -> process_control::Limits {
    process_control::Limits::supervised(
        Duration::from_secs(CHECK_TIMEOUT_SECS),
        Duration::from_secs(stall),
    )
}

/// Publish a long command's newest output line onto the run so the interface can show what
/// is happening while it happens. Throttled, because the point is a readable signal rather
/// than a transcript, and every update costs a history write.
fn observer(runtime: &TaskRuntime, id: &str) -> impl Fn(&[u8], bool) + Send + Sync + 'static {
    let runtime = runtime.clone();
    let id = id.to_string();
    let state = std::sync::Mutex::new((String::new(), None::<std::time::Instant>));
    move |bytes: &[u8], _stderr: bool| {
        let Ok(mut state) = state.lock() else { return };
        state.0.push_str(&String::from_utf8_lossy(bytes));
        let Some(end) = state.0.rfind('\n') else {
            return;
        };
        let newest = state.0[..end]
            .rsplit('\n')
            .map(str::trim)
            .find(|line| !line.is_empty())
            .map(str::to_owned);
        state.0.drain(..end + 1);
        // A partial line longer than this is progress-bar noise, not a message worth keeping.
        if state.0.len() > 8000 {
            state.0.clear();
        }
        let Some(newest) = newest else { return };
        if state
            .1
            .is_some_and(|last| last.elapsed() < Duration::from_millis(750))
        {
            return;
        }
        state.1 = Some(std::time::Instant::now());
        let detail = preparation::tail(&newest, 200);
        let _ = runtime.update_output(&id, |run| {
            if let Some(progress) = run.progress.as_mut() {
                progress.detail = detail;
            }
        });
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Verification {
    pub command: String,
    pub checked_at: String,
    pub tree: Option<String>,
    pub result: process_control::CommandResult,
}

fn shell(command: &str, workspace: &str) -> Result<Command, String> {
    if command.trim().is_empty() || command.len() > 4000 || command.contains('\0') {
        return Err("Set a verification command of 1–4,000 characters in Project Settings.".into());
    }
    #[cfg(windows)]
    let mut cmd = {
        let mut cmd = Command::new("cmd.exe");
        cmd.args(["/D", "/S", "/C", command]);
        cmd
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", command]);
        cmd
    };
    cmd.current_dir(workspace);
    cmd.env_remove("JACKALOPE_BRIDGE_TOKEN")
        .env_remove("JACKALOPE_BRIDGE_URL");
    Ok(cmd)
}

pub(in crate::commands) fn prepare(
    runtime: &TaskRuntime,
    id: &str,
    command: &str,
    workspace: &str,
) -> Result<PreparationRecord, String> {
    let guard = super::integration::execution_guard()?;
    let runs = runtime.integration_runs()?;
    if runs.iter().any(|other| {
        other.id != id
            && other.workspace == workspace
            && ["starting", "running", "stopping", "interrupted"].contains(&other.status.as_str())
    }) {
        return Err("Another attempt owns this workspace. Resolve it before preparation.".into());
    }
    // A workspace whose dependency manifests still match a completed setup run does not need
    // the command again. This is what lets a retry, or a reused worktree, start immediately.
    let root = Path::new(workspace);
    let fingerprint = preparation::fingerprint(root, command);
    if let Some(completed) = preparation::already_prepared(root, &fingerprint) {
        let record = PreparationRecord::skipped(
            command,
            format!("Dependency manifests match the setup completed at {completed}."),
        );
        let saved = record.clone();
        runtime.update_checked(id, |run| {
            run.preparation = Some(saved);
            activity(
                run,
                "Workspace dependencies already match the project manifests. Skipped the setup command.",
            );
        })?;
        return Ok(record);
    }
    let _lease = leases::reserve(workspace)?;
    drop(guard);
    let _slot = leases::check_slot(|| !runtime.is_running(id))?;
    let mut attempt = 1;
    let record = loop {
        runtime.update_checked(id, |run| {
            run.progress = Some(StepProgress::new(
                "dependencies",
                "Running project setup",
                attempt,
            ));
            activity(
                run,
                &if attempt == 1 {
                    format!("Preparing the workspace with the saved project command: {command}")
                } else {
                    format!("The setup command was cut off before it finished. Retrying ({attempt} of {PREPARE_ATTEMPTS}): {command}")
                },
            );
        })?;
        let result = process_control::run_supervised(
            shell(command, workspace)?,
            check_limits(PREPARE_STALL_SECS),
            || !runtime.is_running(id),
            observer(runtime, id),
        )?;
        let record = PreparationRecord::from_result(command, attempt, &result);
        let saved = record.clone();
        runtime.update_checked(id, |run| {
            run.preparation = Some(saved);
            run.diagnostics.push(format!(
                "Workspace preparation attempt {attempt}: {command}\n{}\n{}",
                result.stdout, result.stderr
            ));
        })?;
        let again = !record.success
            && preparation::worth_retrying(&result)
            && attempt < PREPARE_ATTEMPTS
            && runtime.is_running(id);
        if !again {
            break record;
        }
        attempt += 1;
    };
    if record.success {
        preparation::record_prepared(root, &fingerprint, command);
    }
    runtime.update(id, |run| run.progress = None);
    Ok(record)
}

fn execute(runtime: &TaskRuntime, run: &TaskRun, command: &str) -> Result<Verification, String> {
    let active = ["starting", "running"].contains(&run.status.as_str());
    let result = (|| {
        runtime.stage(&run.id, Some("verification_wait"));
        let _slot = leases::check_slot(|| active && !runtime.is_running(&run.id))?;
        let directory = runtime.integration_directory();
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let before = super::integration::workspace_tree(run, &directory)?;
        runtime.stage(&run.id, Some("verification"));
        let agent_active = ["starting", "running"].contains(&run.status.as_str());
        runtime.update(&run.id, |r| {
            r.progress = Some(StepProgress::new(
                "verification",
                "Running project checks",
                1,
            ))
        });
        let result = process_control::run_supervised(
            shell(command, &run.workspace)?,
            check_limits(CHECK_STALL_SECS),
            || agent_active && !runtime.is_running(&run.id),
            observer(runtime, &run.id),
        )?;
        runtime.update(&run.id, |r| r.progress = None);
        let after = super::integration::workspace_tree(run, &directory)?;
        let verification = Verification {
            command: command.to_string(),
            checked_at: chrono::Utc::now().to_rfc3339(),
            tree: (before == after).then_some(after),
            result,
        };
        let _guard = super::integration::execution_guard()?;
        runtime.update_checked(&run.id, |r| r.verification = Some(verification.clone()))?;
        Ok(verification)
    })();
    let resume = active && !run.finishing && runtime.is_running(&run.id);
    runtime.stage(&run.id, resume.then_some("execution"));
    result
}

pub(in crate::commands) fn finish(runtime: &TaskRuntime, id: &str) -> Result<(), String> {
    let guard = super::integration::execution_guard()?;
    let runs = runtime.integration_runs()?;
    let run = runs
        .iter()
        .find(|run| run.id == id)
        .ok_or("Task not found")?;
    if !runtime.is_running(id) {
        return Ok(());
    }
    let command = run
        .verify_command
        .as_deref()
        .filter(|command| !command.trim().is_empty())
        .ok_or("No verification command was saved for this task.")?;
    if runs.iter().any(|other| {
        other.id != id
            && other.workspace == run.workspace
            && ["starting", "running", "stopping", "interrupted"].contains(&other.status.as_str())
    }) {
        return Err("Checks could not start while another attempt owns this workspace.".into());
    }
    if let Some(check) = &run.verification {
        let tree = super::integration::workspace_tree(run, &runtime.integration_directory())?;
        if check.command == command && check.result.success && check.tree.as_ref() == Some(&tree) {
            return Ok(());
        }
    }
    let _lease = leases::reserve(&run.workspace)?;
    drop(guard);
    execute(runtime, run, command)?;
    Ok(())
}

pub async fn agent_verify(
    runtime: TaskRuntime,
    run: TaskRun,
    input: super::harness::ComputerVerifyInput,
) -> Result<serde_json::Value, String> {
    let command = run.verify_command.clone().filter(|s| !s.trim().is_empty())
        .ok_or("No project verification command is authorized. Ask the user to set one in Project Settings, or use your agent's own permitted tools.")?;
    let requested = std::iter::once(input.command)
        .chain(input.args)
        .collect::<Vec<_>>()
        .join(" ");
    if requested != command {
        return Err(
            "Only this task's saved project verification command is allowed through the bridge."
                .into(),
        );
    }
    tauri::async_runtime::spawn_blocking(move || {
        let guard = super::integration::execution_guard()?;
        if !runtime.is_running(&run.id) {
            return Err("This attempt is no longer active.".into());
        }
        let _lease = leases::reserve(&run.workspace)?;
        drop(guard);
        let result = execute(&runtime, &run, &command)?;
        let response = output::response(&result);
        runtime.update_checked(&run.id, |current| {
            current.efficiency.verification(
                &result.result.stdout,
                &response,
                result.result.success,
            );
        })?;
        #[cfg(test)]
        if let Some(spec) = std::env::var_os("JACKALOPE_QUALITY_SPEC") {
            use std::io::Write;
            let path = std::path::PathBuf::from(spec).with_extension("verification.jsonl");
            let mut capture = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .map_err(|e| e.to_string())?;
            writeln!(capture, "{}", response).map_err(|e| e.to_string())?;
        }
        Ok(response)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn task_verify(
    id: String,
    command: String,
    state: State<'_, TaskRuntime>,
) -> Result<Verification, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let guard = super::integration::execution_guard()?;
        let runs = runtime.integration_runs()?;
        let run = runs.iter().find(|run| run.id == id).ok_or("Task not found")?;
        if runs.iter().any(|other| other.workspace == run.workspace && ["starting", "running", "stopping", "interrupted"].contains(&other.status.as_str())) {
            return Err("Stop active work and resolve interrupted attempts before verifying this workspace.".into());
        }
        if run.verify_command.as_ref().filter(|s| !s.trim().is_empty()).is_some_and(|saved| saved != &command) {
            return Err("Run this attempt's saved verification command. Start a new attempt to change its required checks.".into());
        }
        let _lease = leases::reserve(&run.workspace)?;
        drop(guard);
        execute(&runtime, run, &command)
    }).await.map_err(|e| e.to_string())?
}
