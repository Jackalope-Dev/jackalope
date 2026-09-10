use super::{
    process_control,
    tasks::{TaskRun, TaskRuntime},
};
use serde::{Deserialize, Serialize};
use std::{process::Command, time::Duration};
use tauri::State;
mod leases;
pub(super) mod output;
pub use leases::{ensure_all_idle, ensure_idle};

pub(super) const CHECK_TIMEOUT_SECS: u64 = 300;
pub(super) const QUEUE_TIMEOUT_SECS: u64 = 300;
pub(super) const BRIDGE_TIMEOUT_SECS: u64 = CHECK_TIMEOUT_SECS + QUEUE_TIMEOUT_SECS + 120;

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
) -> Result<process_control::CommandResult, String> {
    let guard = super::integration::execution_guard()?;
    let runs = runtime.integration_runs()?;
    if runs.iter().any(|other| {
        other.id != id
            && other.workspace == workspace
            && ["starting", "running", "stopping", "interrupted"].contains(&other.status.as_str())
    }) {
        return Err("Another attempt owns this workspace. Resolve it before preparation.".into());
    }
    runtime.update_checked(id, |run| {
        run.activity
            .push("Preparing the workspace with the saved project command.".into())
    })?;
    let _lease = leases::reserve(workspace)?;
    drop(guard);
    let _slot = leases::check_slot(|| !runtime.is_running(id))?;
    let result = process_control::run_cancellable(
        shell(command, workspace)?,
        Duration::from_secs(CHECK_TIMEOUT_SECS),
        || !runtime.is_running(id),
    )?;
    runtime.update_checked(id, |run| {
        run.diagnostics.push(format!(
            "Workspace preparation: {command}\n{}\n{}",
            result.stdout, result.stderr
        ))
    })?;
    Ok(result)
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
        let result = process_control::run_cancellable(
            shell(command, &run.workspace)?,
            Duration::from_secs(CHECK_TIMEOUT_SECS),
            || agent_active && !runtime.is_running(&run.id),
        )?;
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
