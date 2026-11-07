//! Continuous delivery for projects that merge automatically.
//!
//! Each time a project's target branch moves, Jackalope pushes it to the
//! project's linked Artifacts repository and, when the policy committed on that
//! commit has a `deploy` section for the branch, deploys it from a clean
//! checkout. A deploy that fails, or whose check fails, pauses automatic
//! merging for the project until a later deploy succeeds or a person deploys
//! again. Only projects with "Merge verified work automatically" on take part.

use super::autonomy::{self, DeployPolicy};
use super::Coordinator;
use crate::commands::{
    cloudflare_artifacts, integration,
    repo::{self, Policy},
    verification,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::State;

const INTERVAL: Duration = Duration::from_secs(20);
const HISTORY: usize = 20;
const OUTPUT_CHARS: usize = 2000;
/// Deploys take a moment to reach every location before the check can see them.
const CHECK_ATTEMPTS: u32 = 3;
const CHECK_WAIT: Duration = if cfg!(test) {
    Duration::ZERO
} else {
    Duration::from_secs(15)
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Outcome {
    Deployed,
    Failed,
    CheckFailed,
    RolledBack,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployRecord {
    pub head: String,
    pub started_at: String,
    pub finished_at: String,
    pub outcome: Outcome,
    /// The end of the failing step's output, or the deploy's on success.
    pub output: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployState {
    pub project_path: String,
    pub branch: String,
    /// The branch head Artifacts last accepted.
    #[serde(default)]
    pub pushed_head: Option<String>,
    #[serde(default)]
    pub push_error: Option<String>,
    /// The head the last deploy ran for, whatever its outcome.
    #[serde(default)]
    pub deployed_head: Option<String>,
    #[serde(default)]
    pub deploying: Option<String>,
    /// Why automatic merging is paused for this project.
    #[serde(default)]
    pub halted: Option<String>,
    #[serde(default)]
    pub history: Vec<DeployRecord>,
}

static FILES: Mutex<()> = Mutex::new(());
static RUNNING: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn state_path(directory: &Path, project: &Path) -> PathBuf {
    let canonical = std::fs::canonicalize(project).unwrap_or_else(|_| project.to_path_buf());
    let digest: String = Sha256::digest(canonical.to_string_lossy().as_bytes())
        .iter()
        .take(12)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    directory.join("deploys").join(format!("{digest}.json"))
}

fn read(directory: &Path, project: &Path) -> Option<DeployState> {
    let bytes = std::fs::read(state_path(directory, project)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Reads, changes and saves one project's state under a lock.
fn update<T>(
    directory: &Path,
    project: &Path,
    change: impl FnOnce(&mut DeployState) -> T,
) -> Result<T, String> {
    let _files = FILES
        .lock()
        .map_err(|_| "Deploy state is unavailable.".to_string())?;
    let mut state = read(directory, project).unwrap_or_else(|| DeployState {
        project_path: project.to_string_lossy().into_owned(),
        ..Default::default()
    });
    let result = change(&mut state);
    let path = state_path(directory, project);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?;
    crate::commands::history::write_atomic(&path, &bytes)?;
    Ok(result)
}

/// Why automatic merging is paused for `project`, if a deploy failed.
pub fn halted(directory: &Path, project: &Path) -> Option<String> {
    read(directory, project)?.halted
}

fn tail(text: &str) -> String {
    let text = text.trim();
    let count = text.chars().count();
    if count <= OUTPUT_CHARS {
        return text.into();
    }
    let kept: String = text.chars().skip(count - OUTPUT_CHARS).collect();
    format!("…{kept}")
}

fn output(result: &crate::commands::process_control::CommandResult) -> String {
    tail(&format!(
        "{}\n{}",
        result.stdout.trim(),
        result.stderr.trim()
    ))
}

/// A detached checkout of the deployed commit, removed however the deploy ends.
struct Checkout {
    project: PathBuf,
    path: PathBuf,
}

impl Drop for Checkout {
    fn drop(&mut self) {
        let _guard = integration::execution_guard();
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

/// Runs the deploy, its check and, when the check fails, the rollback.
fn run(directory: &Path, project: &Path, head: &str, deploy: &DeployPolicy) -> DeployRecord {
    let started_at = chrono::Utc::now().to_rfc3339();
    let finish = |outcome, output| DeployRecord {
        head: head.into(),
        started_at: started_at.clone(),
        finished_at: chrono::Utc::now().to_rfc3339(),
        outcome,
        output,
    };
    let path = directory
        .join("deploys")
        .join("work")
        .join(uuid::Uuid::new_v4().simple().to_string());
    let workspace = path.to_string_lossy().into_owned();
    let checkout = {
        let _guard = match integration::execution_guard() {
            Ok(guard) => guard,
            Err(error) => return finish(Outcome::Failed, error),
        };
        if let Err(error) = std::fs::create_dir_all(path.parent().unwrap_or(directory))
            .map_err(|e| e.to_string())
            .and_then(|_| {
                repo::git(
                    project,
                    &["worktree", "add", "--detach", &workspace, head],
                    Policy::Isolated,
                )
            })
        {
            return finish(
                Outcome::Failed,
                format!("Could not check out {head}: {error}"),
            );
        }
        Checkout {
            project: project.to_path_buf(),
            path,
        }
    };
    let step = |command: &str| verification::run_disposable(command, &workspace, false);
    let deployed = match step(&deploy.command) {
        Ok(result) if result.success => output(&result),
        Ok(result) => return finish(Outcome::Failed, output(&result)),
        Err(error) => return finish(Outcome::Failed, error),
    };
    let Some(check) = deploy.check.as_deref() else {
        return finish(Outcome::Deployed, deployed);
    };
    let mut failure = String::new();
    for attempt in 0..CHECK_ATTEMPTS {
        if attempt > 0 {
            std::thread::sleep(CHECK_WAIT);
        }
        match step(check) {
            Ok(result) if result.success => return finish(Outcome::Deployed, deployed),
            Ok(result) => failure = output(&result),
            Err(error) => failure = error,
        }
    }
    let outcome = match deploy.rollback.as_deref().map(step) {
        Some(Ok(result)) if result.success => Outcome::RolledBack,
        Some(Ok(result)) => {
            failure = format!("{failure}\n\nRollback failed:\n{}", output(&result));
            Outcome::CheckFailed
        }
        Some(Err(error)) => {
            failure = format!("{failure}\n\nRollback failed: {error}");
            Outcome::CheckFailed
        }
        None => Outcome::CheckFailed,
    };
    drop(checkout);
    finish(outcome, tail(&failure))
}

fn halt_reason(record: &DeployRecord) -> Option<String> {
    let short = &record.head[..record.head.len().min(8)];
    match record.outcome {
        Outcome::Deployed => None,
        Outcome::Failed => Some(format!(
            "Automatic merging is paused: the deploy of {short} failed."
        )),
        Outcome::CheckFailed => Some(format!(
            "Automatic merging is paused: {short} deployed but its check failed."
        )),
        Outcome::RolledBack => Some(format!(
            "Automatic merging is paused: {short} failed its check and was rolled back."
        )),
    }
}

/// What one project needs this pass, read from Git without holding any lock.
struct Plan {
    head: String,
    deploy: Option<DeployPolicy>,
}

fn plan(project: &Path, branch: &str) -> Option<Plan> {
    let head = autonomy::branch_head(project, branch).ok()?;
    let deploy = autonomy::load(project, &head)
        .ok()
        .flatten()
        .and_then(|policy| policy.deploy)
        .filter(|deploy| deploy.branch == branch);
    Some(Plan { head, deploy })
}

/// The branch a project merges into: the deploy branch when the policy names
/// one, otherwise the target of its most recent attempt.
fn branch_for(project: &Path, latest_target: Option<&str>) -> Option<String> {
    let current = repo::git(
        project,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
        Policy::Isolated,
    )
    .ok();
    let candidate = latest_target.map(str::to_string).or(current)?;
    let head = autonomy::branch_head(project, &candidate).ok()?;
    Some(
        autonomy::load(project, &head)
            .ok()
            .flatten()
            .and_then(|policy| policy.deploy)
            .map(|deploy| deploy.branch)
            .unwrap_or(candidate),
    )
}

async fn pass(service: &Coordinator) -> Result<(), String> {
    let view = service.view()?;
    let runs = service.runtime.integration_runs()?;
    let directory = service.runtime.integration_directory();
    let mut latest: HashMap<String, (String, String)> = HashMap::new();
    for run in &runs {
        let Some(target) = run.target_branch.clone() else {
            continue;
        };
        let entry = latest
            .entry(run.project_id.clone())
            .or_insert_with(|| (run.started_at.clone(), target.clone()));
        if entry.0 < run.started_at {
            *entry = (run.started_at.clone(), target);
        }
    }
    for policy in view.assist_policies.iter().filter(|policy| policy.merge) {
        let project = PathBuf::from(&policy.project_path);
        let target = latest
            .get(&policy.project_id)
            .map(|(_, branch)| branch.clone());
        let checked = project.clone();
        let found = tauri::async_runtime::spawn_blocking(move || {
            let branch = branch_for(&checked, target.as_deref())?;
            plan(&checked, &branch).map(|plan| (branch, plan))
        })
        .await
        .map_err(|e| e.to_string())?;
        let Some((branch, plan)) = found else {
            continue;
        };
        let state = read(&directory, &project).unwrap_or_default();

        if state.pushed_head.as_deref() != Some(plan.head.as_str()) {
            let pushed =
                cloudflare_artifacts::push_branch(&service.runtime, &policy.project_path, &branch)
                    .await;
            let head = plan.head.clone();
            update(&directory, &project, |state| {
                state.branch = branch.clone();
                match pushed {
                    Ok(Some(_)) => {
                        state.pushed_head = Some(head);
                        state.push_error = None;
                    }
                    Ok(None) => state.push_error = None,
                    Err(error) => state.push_error = Some(error),
                }
            })?;
        }

        let Some(deploy) = plan.deploy else { continue };
        if state.deployed_head.as_deref() == Some(plan.head.as_str()) {
            continue;
        }
        let key = state_path(&directory, &project)
            .to_string_lossy()
            .into_owned();
        {
            let mut running = RUNNING.lock().map_err(|_| "Deploys are unavailable.")?;
            if !running.get_or_insert_with(HashSet::new).insert(key.clone()) {
                continue;
            }
        }
        let head = plan.head.clone();
        update(&directory, &project, |state| {
            state.branch = branch.clone();
            state.deploying = Some(head.clone());
        })?;
        let directory = directory.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let record = run(&directory, &project, &head, &deploy);
            if let Err(error) = update(&directory, &project, |state| {
                state.deploying = None;
                state.deployed_head = Some(record.head.clone());
                state.halted = halt_reason(&record);
                state.history.insert(0, record);
                state.history.truncate(HISTORY);
            }) {
                eprintln!("The deploy of {head} finished but its result was not saved: {error}");
            }
            if let Ok(mut running) = RUNNING.lock() {
                running.get_or_insert_with(HashSet::new).remove(&key);
            }
        });
    }
    Ok(())
}

/// Runs delivery for the lifetime of the app.
pub fn launch(service: Coordinator) {
    // A deploy interrupted by quitting is not running any more.
    if let Ok(entries) = std::fs::read_dir(service.runtime.integration_directory().join("deploys"))
    {
        for entry in entries.flatten() {
            let Ok(bytes) = std::fs::read(entry.path()) else {
                continue;
            };
            let Ok(state) = serde_json::from_slice::<DeployState>(&bytes) else {
                continue;
            };
            if state.deploying.is_some() {
                let _ = update(
                    &service.runtime.integration_directory(),
                    Path::new(&state.project_path),
                    |state| state.deploying = None,
                );
            }
        }
    }
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(error) = pass(&service).await {
                eprintln!("deploy: {error}");
            }
            tokio::time::sleep(INTERVAL).await;
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployStatus {
    #[serde(flatten)]
    state: Option<DeployState>,
    /// The policy on the branch head has a deploy section for that branch.
    configured: bool,
}

#[tauri::command]
pub async fn deploy_status(
    project_path: String,
    coordinator: State<'_, Coordinator>,
) -> Result<DeployStatus, String> {
    let directory = coordinator.runtime.integration_directory();
    tauri::async_runtime::spawn_blocking(move || {
        let project = PathBuf::from(&project_path);
        let state = read(&directory, &project);
        let configured = state
            .as_ref()
            .filter(|state| !state.branch.is_empty())
            .and_then(|state| plan(&project, &state.branch))
            .is_some_and(|plan| plan.deploy.is_some());
        DeployStatus { state, configured }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Deploys the branch head again on the next pass and lifts the pause once it succeeds.
#[tauri::command]
pub fn deploy_again(
    project_path: String,
    coordinator: State<'_, Coordinator>,
) -> Result<(), String> {
    let directory = coordinator.runtime.integration_directory();
    update(&directory, Path::new(&project_path), |state| {
        if state.deploying.is_none() {
            state.deployed_head = None;
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(outcome: Outcome) -> DeployRecord {
        DeployRecord {
            head: "0123456789abcdef".into(),
            started_at: String::new(),
            finished_at: String::new(),
            outcome,
            output: String::new(),
        }
    }

    #[test]
    fn only_a_successful_deploy_keeps_automatic_merging_running() {
        assert_eq!(halt_reason(&record(Outcome::Deployed)), None);
        for outcome in [Outcome::Failed, Outcome::CheckFailed, Outcome::RolledBack] {
            let reason = halt_reason(&record(outcome)).unwrap();
            assert!(
                reason.starts_with("Automatic merging is paused"),
                "{reason}"
            );
            assert!(reason.contains("01234567"), "{reason}");
        }
    }

    #[test]
    fn a_paused_project_holds_automatic_merges_until_it_deploys() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-deploy-{}", uuid::Uuid::new_v4()));
        let project = directory.join("project");
        std::fs::create_dir_all(&project).unwrap();
        assert_eq!(halted(&directory, &project), None);
        update(&directory, &project, |state| {
            state.halted = halt_reason(&record(Outcome::Failed));
        })
        .unwrap();
        assert!(halted(&directory, &project).unwrap().contains("paused"));
        let reason = autonomy::accept_before_merge(
            &crate::commands::tasks::TaskRuntime::with_test_access(directory.join("history"))
                .unwrap(),
            &directory,
            &project,
            "HEAD",
            &[],
            &[],
        );
        assert!(reason.unwrap().contains("paused"));
        update(&directory, &project, |state| state.halted = None).unwrap();
        assert_eq!(halted(&directory, &project), None);
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn deploys_run_from_a_clean_checkout_and_roll_back_when_the_check_fails() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-deploy-{}", uuid::Uuid::new_v4()));
        let project = directory.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let git = |args: &[&str]| repo::git(&project, args, Policy::Isolated).unwrap();
        git(&["init", "-q"]);
        git(&["config", "user.name", "Fixture"]);
        git(&["config", "user.email", "fixture@example.invalid"]);
        std::fs::write(project.join("site.txt"), "committed\n").unwrap();
        git(&["add", "."]);
        git(&["commit", "-qm", "start"]);
        let head = git(&["rev-parse", "HEAD"]);
        // Uncommitted edits in the project never reach a deploy.
        std::fs::write(project.join("site.txt"), "local edit\n").unwrap();
        let policy = |command: &str, check: Option<&str>, rollback: Option<&str>| DeployPolicy {
            branch: "main".into(),
            command: command.into(),
            check: check.map(str::to_string),
            rollback: rollback.map(str::to_string),
        };
        let print = if cfg!(windows) {
            "type site.txt"
        } else {
            "cat site.txt"
        };

        let deployed = run(&directory, &project, &head, &policy(print, None, None));
        assert_eq!(deployed.outcome, Outcome::Deployed, "{}", deployed.output);
        assert!(deployed.output.contains("committed"), "{}", deployed.output);

        let rolled = run(
            &directory,
            &project,
            &head,
            &policy(print, Some("exit 1"), Some("echo restored")),
        );
        assert_eq!(rolled.outcome, Outcome::RolledBack, "{}", rolled.output);

        let failed = run(&directory, &project, &head, &policy("exit 3", None, None));
        assert_eq!(failed.outcome, Outcome::Failed);
        assert_eq!(
            std::fs::read_dir(directory.join("deploys").join("work"))
                .unwrap()
                .count(),
            0,
            "every checkout is removed"
        );
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn deploy_output_keeps_the_end_where_errors_appear() {
        let long = format!("{}END", "x".repeat(5000));
        let kept = tail(&long);
        assert!(kept.ends_with("END"));
        assert_eq!(kept.chars().count(), OUTPUT_CHARS + 1);
    }

    #[test]
    fn a_policy_deploys_only_from_a_valid_branch_with_bounded_commands() {
        let parse = |deploy: &str| {
            autonomy::AutonomyPolicy::parse(
                format!(r#"{{"version":1,"deploy":{deploy}}}"#).as_bytes(),
            )
        };
        let policy = parse(r#"{"branch":"main","command":"pnpm deploy","check":"curl -f https://x","rollback":"wrangler rollback"}"#)
            .unwrap();
        assert_eq!(policy.deploy.unwrap().branch, "main");
        for bad in [
            r#"{"branch":"","command":"x"}"#,
            r#"{"branch":"-f","command":"x"}"#,
            r#"{"branch":"a b","command":"x"}"#,
            r#"{"branch":"main","command":" "}"#,
            r#"{"branch":"main","command":"x","check":""}"#,
            r#"{"branch":"main","command":"x","extra":1}"#,
        ] {
            assert!(parse(bad).is_err(), "{bad}");
        }
    }
}
