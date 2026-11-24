//! The saved check on the tree an automatic merge would create.
//!
//! Each task's check ran on its own workspace snapshot. Before Jackalope merges
//! without a person, the same command runs on the prepared integration commit in
//! a detached worktree, so work that passes alone but breaks once combined with
//! the target or with other work is not applied. A result is bound to the
//! combined tree and the command: a task check that already passed on exactly
//! that tree counts without running anything, and so does an earlier passing
//! combined check.

use super::*;
use crate::commands::{
    harness::ValidationStep, process_control::CommandResult, tasks::events::activity,
    tasks::preparation::tail, verification, workspace_setup,
};
use std::{collections::HashSet, sync::LazyLock};

/// How much of the check's output the review evidence keeps; diagnostics keep all of it.
const OUTPUT_CHARS: usize = 4000;

/// Projects with a combined check running. One runs per project at a time.
static RUNNING: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(Default::default);

pub(in crate::commands) enum Gate {
    /// The combined tree passed the saved check, or the project has none.
    Clear,
    /// The check is running. Ask again once [`running`] is false.
    Waiting,
    /// The check failed on the combined tree. Reported once, so preparing the
    /// same merge again runs the check again.
    Failed(String),
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    command: String,
    tree: String,
    target_head: String,
    checked_at: String,
    passed: bool,
    reason: String,
}

struct Check {
    project: PathBuf,
    project_path: String,
    commit: String,
    tree: String,
    command: String,
    target_branch: String,
    target_head: String,
    run_ids: Vec<String>,
    prepare_command: Option<String>,
    setup_files: Vec<String>,
    time_limits: verification::TimeLimits,
}

struct Claim(PathBuf);

impl Drop for Claim {
    fn drop(&mut self) {
        if let Ok(mut running) = RUNNING.lock() {
            running.remove(&self.0);
        }
    }
}

/// Whether a combined check is running for the project. Automatic merging of
/// that project waits: its result decides the merge that started it.
pub(in crate::commands) fn running(project: &str) -> bool {
    let Ok(project) = fs::canonicalize(project) else {
        return false;
    };
    RUNNING
        .lock()
        .is_ok_and(|running| running.contains(&project))
}

fn record_path(directory: &Path, tree: &str) -> PathBuf {
    directory
        .join("combined-checks")
        .join(format!("{tree}.json"))
}

fn read(path: &Path) -> Option<Record> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// Decides whether the ready `plan` may be applied without a person. Starts the
/// saved check on its combined tree when no result for that tree exists, and
/// never waits for it. Call under the execution guard, before `apply`; `apply`
/// still refuses a target or source that changed after the check.
pub(in crate::commands) fn gate(
    runtime: &TaskRuntime,
    runs: &[TaskRun],
    plan: &IntegrationPlan,
    command: &str,
) -> Result<Gate, String> {
    if command.trim().is_empty() {
        return Ok(Gate::Clear);
    }
    let commit = plan
        .integration_head
        .clone()
        .ok_or("Integration commit is missing.")?;
    let project = canonical(&plan.project_path)?;
    let tree = repo::git(
        &project,
        &["rev-parse", "--verify", &format!("{commit}^{{tree}}")],
        Snapshot,
    )?;
    if tree.is_empty() || !tree.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("The combined result has no tree to check.".into());
    }
    let sources: Vec<&TaskRun> = runs
        .iter()
        .filter(|run| plan.run_ids.contains(&run.id))
        .collect();
    if sources.iter().any(|run| {
        run.verification.as_ref().is_some_and(|check| {
            check.result.success
                && check.command == command
                && check.tree.as_deref() == Some(tree.as_str())
        })
    }) {
        return Ok(Gate::Clear);
    }
    let directory = runtime.integration_directory();
    let path = record_path(&directory, &tree);
    if let Some(record) = read(&path).filter(|r| r.command == command && r.tree == tree) {
        if record.passed {
            return Ok(Gate::Clear);
        }
        fs::remove_file(&path).map_err(|e| e.to_string())?;
        return Ok(Gate::Failed(record.reason));
    }
    if !RUNNING
        .lock()
        .map_err(|e| e.to_string())?
        .insert(project.clone())
    {
        return Ok(Gate::Waiting);
    }
    let claim = Claim(project.clone());
    let setup = sources.first();
    let check = Check {
        project,
        project_path: plan.project_path.clone(),
        commit,
        tree,
        command: command.to_string(),
        target_branch: plan.target_branch.clone(),
        target_head: plan.master_head.clone(),
        run_ids: plan.run_ids.clone(),
        prepare_command: setup.and_then(|run| run.prepare_command.clone()),
        setup_files: setup.map(|run| run.setup_files.clone()).unwrap_or_default(),
        time_limits: setup.and_then(|run| run.time_limits).unwrap_or_default(),
    };
    let runtime = runtime.clone();
    std::thread::spawn(move || {
        let _claim = claim;
        let outcome = execute(&directory, &check);
        finish(&runtime, &directory, &check, outcome);
    });
    Ok(Gate::Waiting)
}

/// Removes this project's checkouts left by an interrupted check. Safe because
/// one check runs per project. Call under the execution guard.
fn sweep(project: &Path, work: &Path) {
    let Ok(work) = fs::canonicalize(work) else {
        return;
    };
    let Ok(list) = repo::git(project, &["worktree", "list", "--porcelain"], Snapshot) else {
        return;
    };
    for path in list
        .lines()
        .filter_map(|line| line.strip_prefix("worktree "))
    {
        if let Ok(path) = fs::canonicalize(path) {
            if path.starts_with(&work) {
                drop(verification::DisposableWorktree::existing(project, path));
            }
        }
    }
}

type Ran = (Option<CommandResult>, Option<CommandResult>);

/// Checks out the integration commit, runs the project's setup and saved check
/// there with a check slot and the usual limits, and removes the checkout. The
/// execution guard is held only to add and remove the worktree.
fn execute(directory: &Path, check: &Check) -> Result<Ran, String> {
    let work = directory.join("combined-checks").join("work");
    let path = work.join(uuid::Uuid::new_v4().simple().to_string());
    let workspace = path.to_string_lossy().into_owned();
    let guard = execution_guard()?;
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    sweep(&check.project, &work);
    let worktree = verification::DisposableWorktree::add(&check.project, path, &check.commit)?;
    let lease = verification::reserve_workspace(&workspace);
    drop(guard);
    let ran = lease.and_then(|_lease| {
        workspace_setup::copy_files(&check.project_path, &workspace, &check.setup_files)?;
        let preparation = check
            .prepare_command
            .as_deref()
            .filter(|setup| !setup.trim().is_empty())
            .map(|setup| verification::run_disposable(setup, &workspace, true, &check.time_limits))
            .transpose()?;
        let result = if preparation.as_ref().is_none_or(|setup| setup.success) {
            Some(verification::run_disposable(
                &check.command,
                &workspace,
                false,
                &check.time_limits,
            )?)
        } else {
            None
        };
        Ok((preparation, result))
    });
    let _guard = execution_guard();
    drop(worktree);
    ran
}

fn output(result: &CommandResult) -> String {
    format!("{}\n{}", result.stdout.trim(), result.stderr.trim())
        .trim()
        .to_string()
}

/// Saves the result for the gate and records it on every source attempt.
fn finish(runtime: &TaskRuntime, directory: &Path, check: &Check, outcome: Result<Ran, String>) {
    let short = &check.target_head[..check.target_head.len().min(8)];
    let combined = format!("combined with {} at {short}", check.target_branch);
    let (passed, reason, printed) = match &outcome {
        Ok((_, Some(result))) if result.success => (true, String::new(), output(result)),
        Ok((_, Some(result))) => (
            false,
            format!("The saved check failed on this work {combined}, so it was not merged. Each task's review evidence has the output."),
            output(result),
        ),
        Ok((Some(setup), None)) => (
            false,
            format!("The setup command failed for this work {combined}, so the saved check did not run and nothing was merged. Each task's review evidence has the output."),
            output(setup),
        ),
        Ok((None, None)) => (
            false,
            format!("The saved check did not run on this work {combined}, so it was not merged."),
            String::new(),
        ),
        Err(error) => (
            false,
            format!("The saved check could not run on this work {combined}, so it was not merged: {error}"),
            String::new(),
        ),
    };
    let checked_at = Utc::now().to_rfc3339();
    let note = if passed {
        format!("The saved check passed on this work {combined}.")
    } else {
        reason.clone()
    };
    let step = ValidationStep {
        id: uuid::Uuid::new_v4().to_string(),
        step: "Combined check".into(),
        status: if passed { "passed" } else { "failed" }.into(),
        notes: Some(
            format!(
                "{note}\n{}\n{}",
                check.command,
                tail(&printed, OUTPUT_CHARS)
            )
            .trim()
            .to_string(),
        ),
        evidence: vec![],
        timestamp: checked_at.clone(),
        requirements: vec![],
        finding: None,
        safety_fact: None,
    };
    {
        let _guard = execution_guard();
        for id in &check.run_ids {
            runtime.update(id, |run| {
                activity(run, &note);
                run.diagnostics
                    .push(format!("Combined check: {}\n{printed}", check.command));
                run.validation_steps.push(step.clone());
            });
        }
    }
    let record = Record {
        command: check.command.clone(),
        tree: check.tree.clone(),
        target_head: check.target_head.clone(),
        checked_at,
        passed,
        reason,
    };
    let saved = serde_json::to_vec_pretty(&record)
        .map_err(|e| e.to_string())
        .and_then(|bytes| {
            crate::commands::history::write_atomic(&record_path(directory, &check.tree), &bytes)
        });
    if let Err(error) = saved {
        eprintln!("The combined check finished but its result was not saved: {error}");
    }
}

/// Waits for the project's combined check to finish.
#[cfg(test)]
pub(in crate::commands) fn wait(project: &str) {
    let started = std::time::Instant::now();
    while running(project) {
        assert!(started.elapsed().as_secs() < 120, "combined check hung");
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}
