use super::{
    process_control,
    repo::{self, Policy},
    tasks::{
        events::activity,
        preparation::{self, PreparationRecord, StepProgress},
        TaskRun, TaskRuntime,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use tauri::State;
mod leases;
mod limits;
pub(super) mod native_output;
pub(super) mod output;
mod test_report;
pub use leases::{ensure_all_idle, ensure_idle};
pub use limits::TimeLimits;

/// Holds a workspace like a running check does, so checks, previews and
/// integration wait while Jackalope runs its own process there.
pub(in crate::commands) struct WorkspaceLease(#[allow(dead_code)] leases::Lease);

/// Call under the execution guard, as for a check.
pub(in crate::commands) fn reserve_workspace(workspace: &str) -> Result<WorkspaceLease, String> {
    leases::reserve(workspace).map(WorkspaceLease)
}

/// A detached worktree of one commit for a command Jackalope runs itself, removed
/// however that run ends. Create and drop it under the execution guard.
pub(in crate::commands) struct DisposableWorktree {
    project: PathBuf,
    path: PathBuf,
}

impl DisposableWorktree {
    pub(in crate::commands) fn add(
        project: &Path,
        path: PathBuf,
        commit: &str,
    ) -> Result<Self, String> {
        let workspace = path.to_string_lossy().into_owned();
        repo::git(
            project,
            &["worktree", "add", "--detach", &workspace, commit],
            Policy::Isolated,
        )?;
        Ok(Self {
            project: project.to_path_buf(),
            path,
        })
    }

    /// Takes over a worktree an interrupted run left behind, so dropping it removes it.
    pub(in crate::commands) fn existing(project: &Path, path: PathBuf) -> Self {
        Self {
            project: project.to_path_buf(),
            path,
        }
    }
}

impl Drop for DisposableWorktree {
    fn drop(&mut self) {
        let path = self.path.to_string_lossy().into_owned();
        let _ = repo::git(
            &self.project,
            &["worktree", "remove", "--force", &path],
            Policy::Isolated,
        );
        let _ = std::fs::remove_dir_all(&self.path);
        let _ = repo::git(&self.project, &["worktree", "prune"], Policy::Isolated);
    }
}

/// Default ceiling on a single check or setup command. Commands are cut off for going
/// quiet (see the stall budgets) long before this; it only bounds a command that keeps
/// printing forever. Projects may set their own budgets ([`TimeLimits`]).
pub(super) const CHECK_TIMEOUT_SECS: u64 = 1800;
/// A verification command that has printed nothing for this long is treated as wedged.
/// Generous, because a compile or test step can legitimately think in silence.
pub(super) const CHECK_STALL_SECS: u64 = 600;
/// Setup commands (installs) report progress continuously, so silence means trouble sooner.
pub(super) const PREPARE_STALL_SECS: u64 = 300;
/// How many times a setup command that was cut off mid-progress is retried in total.
pub(super) const PREPARE_ATTEMPTS: u32 = 2;
pub(super) const QUEUE_TIMEOUT_SECS: u64 = 300;
/// How long an agent waits on a bridge call; it covers the longest check a project may allow.
pub(super) const BRIDGE_TIMEOUT_SECS: u64 =
    limits::MAX_CHECK_TIMEOUT_SECS + QUEUE_TIMEOUT_SECS + 120;

/// The limits saved on an attempt when it started, or the defaults.
fn run_limits(runtime: &TaskRuntime, id: &str) -> TimeLimits {
    runtime
        .run_snapshot(id)
        .and_then(|run| run.time_limits)
        .unwrap_or_default()
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

/// Adds what to do when Xcode refused to run a package's macros or plugins, so
/// the person and the agent see how to trust them rather than a bare build error.
fn explain_macros(mut result: process_control::CommandResult) -> process_control::CommandResult {
    if result.success {
        return result;
    }
    let output = format!("{}\n{}", result.stdout, result.stderr);
    if let Some(hint) = super::xcode::macros::hint(&output, None) {
        result.stderr = format!("{}\n\n{hint}", result.stderr.trim_end());
    }
    result
}

fn shell(command: &str, workspace: &str) -> Result<Command, String> {
    if command.trim().is_empty() || command.len() > 4000 || command.contains('\0') {
        return Err("Set a verification command of 1–4,000 characters in Project Settings.".into());
    }
    // `/S /C "<command>"` hands cmd.exe the line verbatim. Passing it as an
    // ordinary argument would escape its quotes as `\"`, which cmd.exe keeps.
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("cmd.exe");
        cmd.args(["/D", "/S", "/C"])
            .raw_arg(format!("\"{command}\""));
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
    cmd.envs(super::source_packages::environment(Path::new(workspace)));
    super::xcode::apply_for(&mut cmd, Path::new(workspace));
    Ok(cmd)
}

/// The task's Simulator for a command in an iOS project, or one that names
/// `$JACKALOPE_SIMULATOR_UDID`: created for setup, booted for a check. A
/// device that cannot be had is reported and the command runs without it, so
/// its own output shows what failed.
fn task_simulator(
    runtime: &TaskRuntime,
    id: &str,
    workspace: &str,
    command: &str,
    booted: bool,
    canceled: impl Fn() -> bool,
) -> Option<super::simulators::Device> {
    if !super::simulators::needed_by_command(workspace, command) {
        return None;
    }
    let device = super::simulators::assign(runtime, id).and_then(|device| {
        if booted {
            super::simulators::boot(&device, canceled)
        } else {
            Ok(device)
        }
    });
    match device {
        Ok(device) => Some(device),
        Err(error) => {
            runtime.update(id, |run| {
                activity(run, &format!("No Simulator for this command: {error}"))
            });
            None
        }
    }
}

fn with_simulator(
    mut command: Command,
    device: Option<&super::simulators::Device>,
) -> (Command, Option<super::simulators::InUse>) {
    let Some(device) = device else {
        return (command, None);
    };
    command.envs(device.environment());
    super::xcode::apply(&mut command);
    (command, Some(super::simulators::InUse::new(device)))
}

/// Runs an explicitly requested command in a disposable workspace the caller has reserved,
/// with a check slot, stall budget and ceiling like a project check. `setup` uses the setup
/// command's stall budget.
pub(in crate::commands) fn run_disposable(
    command: &str,
    workspace: &str,
    setup: bool,
    limits: &TimeLimits,
) -> Result<process_control::CommandResult, String> {
    let _slot = leases::check_slot(|| false)?;
    let mut process = shell(command, workspace)?;
    // A check in a disposable workspace gets a Simulator of its own that is
    // deleted with it; setup there only gets one when it names the device.
    let wants = if setup {
        command.contains("JACKALOPE_SIMULATOR_")
    } else {
        super::simulators::needed_by_command(workspace, command)
    };
    let simulator = wants.then(|| super::simulators::Disposable::new(workspace, !setup));
    if let Some(Ok(disposable)) = &simulator {
        process.envs(disposable.device.environment());
        super::xcode::apply(&mut process);
    }
    let mut result = explain_macros(process_control::run_supervised(
        process,
        limits.limits(setup),
        || false,
        |_, _| {},
    )?);
    if let Some(Err(error)) = simulator {
        result.stderr = format!(
            "Jackalope could not provide a Simulator: {error}\n{}",
            result.stderr
        );
    }
    Ok(result)
}

/// Runs `work` in `workspace` holding its verification lease. Under the
/// execution guard it refuses a workspace another live attempt owns (any
/// attempt but `owner`, or any at all without one), lets `reuse` answer
/// without running anything, and reserves the lease; `work` then runs with
/// the guard released, so long checks never block launches or integration.
fn with_workspace_lease<T>(
    runtime: &TaskRuntime,
    workspace: &str,
    owner: Option<&str>,
    busy: &str,
    reuse: impl FnOnce(&[TaskRun]) -> Result<Option<T>, String>,
    work: impl FnOnce(&[TaskRun]) -> Result<T, String>,
) -> Result<T, String> {
    let guard = super::integration::execution_guard()?;
    let runs = runtime.integration_runs()?;
    if runs.iter().any(|other| {
        Some(other.id.as_str()) != owner && other.workspace == workspace && other.status.is_live()
    }) {
        return Err(busy.into());
    }
    if let Some(answer) = reuse(&runs)? {
        return Ok(answer);
    }
    let _lease = leases::reserve(workspace)?;
    drop(guard);
    work(&runs)
}

pub(in crate::commands) fn prepare(
    runtime: &TaskRuntime,
    id: &str,
    command: &str,
    workspace: &str,
) -> Result<PreparationRecord, String> {
    let root = Path::new(workspace);
    let fingerprint = preparation::fingerprint(root, command);
    with_workspace_lease(
        runtime,
        workspace,
        Some(id),
        "Another attempt owns this workspace. Resolve it before preparation.",
        // A workspace whose dependency manifests still match a completed setup run does not
        // need the command again, so a retry or a reused worktree starts immediately.
        |_| {
            let Some(completed) = preparation::already_prepared(root, &fingerprint) else {
                return Ok(None);
            };
            let record = PreparationRecord::skipped(
                command,
                format!("Dependency manifests match the setup completed at {completed}."),
            );
            let saved = record.clone();
            runtime.update_checked(id, |run| {
                run.preparation = Some(saved);
                run.efficiency.preparation_reuses = Some(run.efficiency.preparation_reuses.unwrap_or(0) + 1);
                activity(
                    run,
                    "Workspace dependencies already match the project manifests. Skipped the setup command.",
                );
            })?;
            Ok(Some(record))
        },
        |_| run_preparation(runtime, id, command, workspace, root, &fingerprint),
    )
}

/// Runs one saved project command marked to run when a task worktree is created. It always
/// runs (no manifest reuse) and is not retried; a failure keeps its output on the attempt.
pub(in crate::commands) fn run_worktree_command(
    runtime: &TaskRuntime,
    id: &str,
    name: &str,
    command: &str,
    workspace: &str,
) -> Result<PreparationRecord, String> {
    with_workspace_lease(
        runtime,
        workspace,
        Some(id),
        "Another attempt owns this workspace. Resolve it before preparation.",
        |_| Ok(None),
        |_| {
            let _slot = runtime.timed(id, "preparationWait", || {
                leases::check_slot(|| !runtime.is_running(id))
            })?;
            runtime.update_checked(id, |run| {
                run.progress = Some(StepProgress::new("dependencies", name, 1));
                activity(
                    run,
                    &format!("Running {name}, which runs when a worktree is created: {command}"),
                );
            })?;
            let result = runtime
                .timed(id, "worktreeCommand", || {
                    process_control::run_supervised(
                        shell(command, workspace)?,
                        run_limits(runtime, id).limits(true),
                        || !runtime.is_running(id),
                        observer(runtime, id),
                    )
                })
                .map(explain_macros)?;
            let record = PreparationRecord::from_result(command, 1, &result);
            runtime.update_checked(id, |run| {
                run.diagnostics.push(format!(
                    "{name} (runs when a worktree is created): {command}\n{}\n{}",
                    result.stdout, result.stderr
                ));
                if !record.success {
                    run.preparation = Some(record.clone());
                }
                run.progress = None;
            })?;
            Ok(record)
        },
    )
}

fn run_preparation(
    runtime: &TaskRuntime,
    id: &str,
    command: &str,
    workspace: &str,
    root: &Path,
    fingerprint: &str,
) -> Result<PreparationRecord, String> {
    let _slot = runtime.timed(id, "preparationWait", || {
        leases::check_slot(|| !runtime.is_running(id))
    })?;
    let limits = run_limits(runtime, id);
    let simulator = task_simulator(runtime, id, workspace, command, false, || {
        !runtime.is_running(id)
    });
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
        let result = runtime
            .timed(id, "preparation", || {
                let (process, _in_use) =
                    with_simulator(shell(command, workspace)?, simulator.as_ref());
                process_control::run_supervised(
                    process,
                    limits.limits(true),
                    || !runtime.is_running(id),
                    observer(runtime, id),
                )
            })
            .map(explain_macros)?;
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
        save_packages(runtime, id, root);
    }
    runtime.update(id, |run| run.progress = None);
    Ok(record)
}

/// Keeps the Swift package checkouts a successful command left in a task's workspace for
/// the project's next worktrees.
fn save_packages(runtime: &TaskRuntime, id: &str, workspace: &Path) {
    let Some(run) = runtime.run_snapshot(id) else {
        return;
    };
    if super::source_packages::capture(
        runtime.data_directory(),
        Path::new(&run.project_path),
        workspace,
    ) {
        runtime.update(id, |run| {
            activity(
                run,
                "Saved this workspace's Swift package checkouts for the project's next worktrees.",
            )
        });
    }
}

fn execute(runtime: &TaskRuntime, run: &TaskRun, command: &str) -> Result<Verification, String> {
    let active = run.status.is_running();
    let result = (|| {
        runtime.stage(&run.id, Some("verification_wait"));
        runtime.update(&run.id, |r| {
            r.progress = Some(StepProgress::new(
                "verification_wait",
                "Waiting for project checks",
                1,
            ));
        });
        let _slot = runtime.timed(&run.id, "verificationWait", || {
            leases::check_slot(|| active && !runtime.is_running(&run.id))
        })?;
        let simulator = task_simulator(runtime, &run.id, &run.workspace, command, true, || {
            active && !runtime.is_running(&run.id)
        });
        let directory = runtime.integration_directory();
        let before = super::integration::workspace_tree(run, &directory)?;
        runtime.stage(&run.id, Some("verification"));
        let agent_active = run.status.is_running();
        runtime.update(&run.id, |r| {
            r.progress = Some(StepProgress::new(
                "verification",
                "Running project checks",
                1,
            ))
        });
        let result = runtime
            .timed(&run.id, "verification", || {
                let (process, _in_use) =
                    with_simulator(shell(command, &run.workspace)?, simulator.as_ref());
                process_control::run_supervised(
                    process,
                    run.time_limits.unwrap_or_default().limits(false),
                    || agent_active && !runtime.is_running(&run.id),
                    observer(runtime, &run.id),
                )
            })
            .map(explain_macros)?;
        runtime.update(&run.id, |r| r.progress = None);
        if result.success {
            save_packages(runtime, &run.id, Path::new(&run.workspace));
        }
        let after = super::integration::workspace_tree(run, &directory)?;
        let verification = Verification {
            command: command.to_string(),
            checked_at: chrono::Utc::now().to_rfc3339(),
            tree: (before == after).then_some(after),
            result,
        };
        let _guard = super::integration::execution_guard()?;
        runtime.update_checked(&run.id, |r| {
            r.verification = Some(verification.clone());
            *r.efficiency.native_verification_calls.get_or_insert(0) += 1;
            r.efficiency
                .first_check_passed
                .get_or_insert(verification.result.success);
        })?;
        Ok(verification)
    })();
    let resume = active && !run.finishing && runtime.is_running(&run.id);
    runtime.update(&run.id, |r| r.progress = None);
    runtime.stage(&run.id, resume.then_some("execution"));
    result
}

pub(in crate::commands) fn finish(runtime: &TaskRuntime, id: &str) -> Result<(), String> {
    let Some(run) = runtime.run_snapshot(id) else {
        return Err("Task not found".into());
    };
    if !runtime.is_running(id) {
        return Ok(());
    }
    let command = run
        .verify_command
        .as_deref()
        .filter(|command| !command.trim().is_empty())
        .ok_or("No verification command was saved for this task.")?;
    with_workspace_lease(
        runtime,
        &run.workspace,
        Some(id),
        "Checks could not start while another attempt owns this workspace.",
        |runs| {
            let run = runs
                .iter()
                .find(|run| run.id == id)
                .ok_or("Task not found")?;
            if reusable_check(runtime, run, command)?.is_none() {
                return Ok(None);
            }
            runtime.update_checked(id, |r| {
                r.efficiency.verification_reuses =
                    Some(r.efficiency.verification_reuses.unwrap_or(0) + 1)
            })?;
            Ok(Some(()))
        },
        |runs| {
            let run = runs
                .iter()
                .find(|run| run.id == id)
                .ok_or("Task not found")?;
            execute(runtime, run, command).map(|_| ())
        },
    )
}

fn reusable_check<'a>(
    runtime: &TaskRuntime,
    run: &'a TaskRun,
    command: &str,
) -> Result<Option<&'a Verification>, String> {
    let Some(check) = run
        .verification
        .as_ref()
        .filter(|check| check.command == command && check.result.success && check.tree.is_some())
    else {
        return Ok(None);
    };
    let tree = super::integration::workspace_tree(run, &runtime.integration_directory())?;
    Ok((check.tree.as_ref() == Some(&tree)).then_some(check))
}

pub async fn agent_verify(
    runtime: TaskRuntime,
    run: TaskRun,
    input: super::harness::ComputerVerifyInput,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || agent_verify_blocking(&runtime, &run, &input))
        .await
        .map_err(|e| e.to_string())?
}

/// Runs the attempt's saved check for an in-session caller such as a stop hook. An unchanged
/// passing snapshot is reused, and the result is saved where the final check reuses it.
pub(in crate::commands) fn saved_check(
    runtime: &TaskRuntime,
    run_id: &str,
) -> Result<Verification, String> {
    let run = runtime.run_snapshot(run_id).ok_or("Task not found")?;
    let input = super::harness::ComputerVerifyInput {
        command: String::new(),
        args: Vec::new(),
    };
    agent_verify_blocking(runtime, &run, &input)?;
    runtime
        .run_snapshot(run_id)
        .and_then(|run| run.verification)
        .ok_or_else(|| "The saved check did not record a result.".into())
}

fn agent_verify_blocking(
    runtime: &TaskRuntime,
    run: &TaskRun,
    input: &super::harness::ComputerVerifyInput,
) -> Result<serde_json::Value, String> {
    let command = agent_command(run.verify_command.as_deref(), &input)?;
    if !runtime.is_running(&run.id) {
        return Err("This attempt is no longer active.".into());
    }
    let current = |runs: &'_ [TaskRun]| -> Result<TaskRun, String> {
        runs.iter()
            .find(|current| current.id == run.id)
            .cloned()
            .ok_or_else(|| "Task not found".to_string())
    };
    let (run, result) = with_workspace_lease(
        runtime,
        &run.workspace,
        Some(&run.id),
        "Checks could not start while another attempt owns this workspace.",
        |runs| {
            let run = current(runs)?;
            let Some(check) = reusable_check(runtime, &run, command)? else {
                return Ok(None);
            };
            let check = check.clone();
            runtime.update_checked(&run.id, |r| {
                r.efficiency.verification_reuses =
                    Some(r.efficiency.verification_reuses.unwrap_or(0) + 1)
            })?;
            Ok(Some((run, Err(check))))
        },
        |runs| {
            let run = current(runs)?;
            let result = execute(runtime, &run, command)?;
            Ok((run, Ok(result)))
        },
    )?;
    let result = match result {
        Err(check) => {
            let mut response = output::response(&check);
            response["reused"] = true.into();
            return Ok(response);
        }
        Ok(result) => result,
    };
    let run = &run;
    let mut response = output::response(&result);
    response["reused"] = false.into();
    runtime.update_checked(&run.id, |current| {
        current
            .efficiency
            .verification(&result.result.stdout, &response, result.result.success);
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
}

fn agent_command<'a>(
    saved: Option<&'a str>,
    input: &super::harness::ComputerVerifyInput,
) -> Result<&'a str, String> {
    let command = saved.filter(|s| !s.trim().is_empty())
        .ok_or("No project verification command is authorized. Ask the user to set one in Project Settings, or use your agent's own permitted tools.")?;
    if input.command.is_empty() && input.args.is_empty() {
        return Ok(command);
    }
    let requested = std::iter::once(input.command.as_str())
        .chain(input.args.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join(" ");
    if requested != command {
        return Err("Only this task's saved project verification command is allowed through the bridge. Call computer_verify with {} to run it; project.verification.command shows the saved command.".into());
    }
    Ok(command)
}

#[cfg(test)]
mod agent_command_tests {
    use super::*;
    use serde_json::json;

    #[cfg(windows)]
    #[test]
    fn saved_checks_keep_their_double_quotes_on_windows() {
        let workspace = std::env::temp_dir();
        let output = shell(r#"echo "a b""#, workspace.to_str().unwrap())
            .unwrap()
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), r#""a b""#);
    }

    #[test]
    fn saved_checks_accept_empty_or_matching_requests_without_expanding_authority() {
        let saved = "node --check \"a b.mjs\" && node --check next.mjs";
        for input in [
            json!({}),
            json!({"command":saved}),
            json!({"command":"node","args":["--check", "\"a b.mjs\"", "&&", "node", "--check", "next.mjs"]}),
        ] {
            assert_eq!(
                agent_command(Some(saved), &serde_json::from_value(input).unwrap()).unwrap(),
                saved
            );
        }
        for input in [json!({}), json!({"command":"node","args":["--test"]})] {
            for saved in [None, Some(""), Some("   ")] {
                assert!(
                    agent_command(saved, &serde_json::from_value(input.clone()).unwrap()).is_err()
                );
            }
        }
        for input in [
            json!({"args":["--test"]}),
            json!({"command":" "}),
            json!({"command":"node","args":["--test"]}),
            json!({"command":saved,"args":["&&", "echo", "unexpected"]}),
        ] {
            assert!(agent_command(Some(saved), &serde_json::from_value(input).unwrap()).is_err());
        }
    }
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::verification::task_verify,
            commands::verification::project_time_limit_suggestion,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[tauri::command]
pub async fn task_verify(
    id: String,
    command: String,
    state: State<'_, TaskRuntime>,
) -> Result<Verification, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let run = runtime.run_snapshot(&id).ok_or("Task not found")?;
        if run.verify_command.as_ref().filter(|s| !s.trim().is_empty()).is_some_and(|saved| saved != &command) {
            return Err("Run this attempt's saved verification command. Start a new attempt to change its required checks.".into());
        }
        with_workspace_lease(
            &runtime,
            &run.workspace,
            None,
            "Stop active work and resolve interrupted attempts before verifying this workspace.",
            |_| Ok(None),
            |runs| {
                let run = runs.iter().find(|run| run.id == id).ok_or("Task not found")?;
                execute(&runtime, run, &command)
            },
        )
    }).await.map_err(|e| e.to_string())?
}

/// Larger time limits suggested for a project at `path`, or `None` when the defaults suit it.
/// Nothing is saved: Project settings offer the values and the person chooses.
#[tauri::command]
pub async fn project_time_limit_suggestion(path: String) -> Result<Option<TimeLimits>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        limits::xcode_project(Path::new(&path)).then_some(TimeLimits::XCODE)
    })
    .await
    .map_err(|e| e.to_string())
}
