use super::tasks::{TaskRun, TaskRuntime};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::State;

static INTEGRATION_LOCK: Mutex<()> = Mutex::new(());
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

pub fn execution_guard() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    let guard = INTEGRATION_LOCK.lock().map_err(|e| e.to_string())?;
    if super::release::installing() {
        return Err("Wait for the app update to finish before changing work.".into());
    }
    Ok(guard)
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationSource {
    pub run_id: String,
    pub workspace: String,
    pub head: String,
    pub tree: String,
    pub status: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationPlan {
    pub id: String,
    pub project_path: String,
    pub master_head: String,
    #[serde(default = "legacy_target_branch")]
    pub target_branch: String,
    pub integration_head: Option<String>,
    pub run_ids: Vec<String>,
    pub sources: Vec<IntegrationSource>,
    pub files: Vec<String>,
    pub patch: String,
    pub conflicts: Vec<String>,
    pub status: String,
    pub created_at: String,
    pub applied_at: Option<String>,
}

fn legacy_target_branch() -> String {
    "master".into()
}

fn command(path: &Path, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command.current_dir(path).args(args);
    command
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn output_text(output: Output) -> Result<String, String> {
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string())
}

fn git(path: &Path, args: &[&str]) -> Result<String, String> {
    output_text(command(path, args).output().map_err(|e| e.to_string())?)
}

fn unique_id() -> String {
    format!(
        "{}-{}-{}",
        Utc::now().timestamp_micros(),
        std::process::id(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() < 100 && id.bytes().all(|b| b.is_ascii_digit() || b == b'-')
}

fn canonical(path: &str) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|e| format!("Cannot open {path}: {e}"))
}

fn common_dir(path: &Path) -> Result<PathBuf, String> {
    canonical(&git(
        path,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?)
}

struct TemporaryIndex(PathBuf);

impl Drop for TemporaryIndex {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
        let _ = fs::remove_file(self.0.with_extension("index.lock"));
    }
}

fn snapshot(run: &TaskRun, directory: &Path) -> Result<IntegrationSource, String> {
    let workspace = canonical(&run.workspace)?;
    let head = git(&workspace, &["rev-parse", "HEAD"])?;
    let status = git(
        &workspace,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    if !git(&workspace, &["ls-files", "--unmerged"])?.is_empty() {
        return Err("Resolve the task worktree's existing merge conflicts first.".into());
    }
    let index = TemporaryIndex(directory.join(format!("{}.index", unique_id())));
    let source_index = git(
        &workspace,
        &["rev-parse", "--path-format=absolute", "--git-path", "index"],
    )?;
    fs::copy(&source_index, &index.0)
        .map_err(|e| format!("Cannot snapshot the task index: {e}"))?;
    let indexed = |args: &[&str]| -> Result<String, String> {
        output_text(
            command(&workspace, args)
                .env("GIT_INDEX_FILE", &index.0)
                .output()
                .map_err(|e| e.to_string())?,
        )
    };
    indexed(&["add", "--all", "--", "."])?;
    let tree = indexed(&["write-tree"])?;
    if head != git(&workspace, &["rev-parse", "HEAD"])?
        || status
            != git(
                &workspace,
                &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            )?
    {
        return Err(
            "The task worktree changed while preparing review. Try again after it is idle.".into(),
        );
    }
    Ok(IntegrationSource {
        run_id: run.id.clone(),
        workspace: run.workspace.clone(),
        head,
        tree,
        status,
    })
}

pub(super) fn workspace_tree(run: &TaskRun, directory: &Path) -> Result<String, String> {
    Ok(snapshot(run, directory)?.tree)
}

fn commit_tree(path: &Path, tree: &str, parents: &[&str], message: &str) -> Result<String, String> {
    let name = git(path, &["config", "user.name"])
        .map_err(|_| "Set Git user.name before preparing an integration.".to_string())?;
    let email = git(path, &["config", "user.email"])
        .map_err(|_| "Set Git user.email before preparing an integration.".to_string())?;
    if name.is_empty() || email.is_empty() {
        return Err("Configure your Git name and email first.".into());
    }
    let mut cmd = command(path, &["commit-tree", tree]);
    for parent in parents {
        cmd.args(["-p", parent]);
    }
    cmd.args(["-m", message])
        .env("GIT_AUTHOR_NAME", &name)
        .env("GIT_COMMITTER_NAME", &name)
        .env("GIT_AUTHOR_EMAIL", &email)
        .env("GIT_COMMITTER_EMAIL", &email);
    output_text(cmd.output().map_err(|e| e.to_string())?)
}

fn save(directory: &Path, plan: &IntegrationPlan) -> Result<(), String> {
    super::history::write_atomic(
        &directory.join(format!("{}.json", plan.id)),
        &serde_json::to_vec_pretty(plan).map_err(|e| e.to_string())?,
    )
}

fn selected_runs(runs: &[TaskRun], ids: &[String]) -> Result<Vec<TaskRun>, String> {
    if ids.is_empty() || ids.len() > 32 {
        return Err("Choose between 1 and 32 completed tasks.".into());
    }
    let mut selected = Vec::<TaskRun>::new();
    for id in ids {
        let run = runs
            .iter()
            .find(|run| &run.id == id)
            .ok_or("A selected task no longer exists.")?;
        if run.persistence_error.is_some() {
            return Err(
                "Save the task's latest history before preparing or applying integration.".into(),
            );
        }
        if !["review", "reviewed"].contains(&run.status.as_str()) {
            return Err(
                "Only completed tasks awaiting review or already reviewed can be integrated."
                    .into(),
            );
        }
        let workspace = canonical(&run.workspace)?;
        if workspace == canonical(&run.project_path)? {
            return Err("Integration requires an isolated task worktree.".into());
        }
        if selected
            .iter()
            .any(|other| canonical(&other.workspace).ok().as_ref() == Some(&workspace))
        {
            return Err("Choose only the latest attempt from each task worktree.".into());
        }
        if runs.iter().any(|other| {
            (other.task_id == run.task_id
                || canonical(&other.workspace).ok().as_ref() == Some(&workspace))
                && (["starting", "running", "stopping", "interrupted"]
                    .contains(&other.status.as_str())
                    || other.started_at > run.started_at)
        }) {
            return Err("This task has a newer, active, or interrupted attempt. Review its latest completed attempt first.".into());
        }
        selected.push(run.clone());
    }
    let project = canonical(&selected[0].project_path)?;
    let common = common_dir(&project)?;
    for run in &selected {
        if canonical(&run.project_path)? != project
            || common_dir(&canonical(&run.workspace)?)? != common
        {
            return Err("Select tasks from one project and its registered Git worktrees.".into());
        }
    }
    Ok(selected)
}

fn preview(path: &Path, base: &str, target: &str) -> Result<(Vec<String>, String), String> {
    let files = git(path, &["diff", "--name-only", "-z", base, target, "--"])?
        .split('\0')
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect();
    let patch = git(
        path,
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            base,
            target,
            "--",
        ],
    )?;
    let mut clipped: String = patch.chars().take(180_000).collect();
    if clipped.len() < patch.len() {
        clipped.push_str("\n\n[Preview truncated. Inspect the integration reference with Git to see the full diff.]");
    }
    Ok((files, clipped))
}

fn require_verification(run: &TaskRun, tree: &str) -> Result<(), String> {
    if run
        .verify_command
        .as_ref()
        .is_some_and(|s| !s.trim().is_empty())
        || run.verification.is_some()
    {
        let check = run
            .verification
            .as_ref()
            .ok_or("Run project verification before preparing integration.")?;
        if !check.result.success
            || check.tree.as_deref() != Some(tree)
            || run
                .verify_command
                .as_ref()
                .filter(|s| !s.trim().is_empty())
                .is_some_and(|saved| saved != &check.command)
        {
            return Err("Project verification failed or the files changed after verification. Run checks again before integration.".into());
        }
    }
    Ok(())
}

fn prepare(directory: &Path, runs: &[TaskRun], ids: &[String]) -> Result<IntegrationPlan, String> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let selected = selected_runs(runs, ids)?;
    let project = canonical(&selected[0].project_path)?;
    let target_branch = selected[0]
        .target_branch
        .clone()
        .unwrap_or_else(legacy_target_branch);
    if selected
        .iter()
        .any(|run| run.target_branch.as_deref().unwrap_or("master") != target_branch)
    {
        return Err("Select tasks with the same target branch.".into());
    }
    super::tasks::resolve_target_branch(
        project.to_str().ok_or("Invalid project path")?,
        Some(&target_branch),
    )?;
    let master = git(
        &project,
        &["rev-parse", &format!("refs/heads/{target_branch}")],
    )?;
    let mut plan = IntegrationPlan {
        id: unique_id(),
        project_path: selected[0].project_path.clone(),
        master_head: master.clone(),
        target_branch,
        integration_head: None,
        run_ids: ids.to_vec(),
        sources: vec![],
        files: vec![],
        patch: String::new(),
        conflicts: vec![],
        status: "ready".into(),
        created_at: Utc::now().to_rfc3339(),
        applied_at: None,
    };
    let mut combined = master.clone();
    let mut preview_target = master;
    for run in &selected {
        let source = snapshot(run, directory)?;
        require_verification(run, &source.tree)?;
        let base = git(
            &project,
            &[
                "rev-parse",
                "--verify",
                &format!("{}^{{commit}}", run.base_head),
            ],
        )?;
        let source_commit = commit_tree(
            &project,
            &source.tree,
            &[&base],
            &format!("feat: integrate completed task {}", run.id),
        )?;
        plan.sources.push(source);
        let output = command(
            &project,
            &[
                "merge-tree",
                "--write-tree",
                "--name-only",
                &combined,
                &source_commit,
            ],
        )
        .output()
        .map_err(|e| e.to_string())?;
        if !output.status.success() && output.status.code() != Some(1) {
            return Err(String::from_utf8_lossy(&output.stderr).trim().into());
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut lines = stdout.lines();
        let tree = lines
            .next()
            .filter(|s| !s.is_empty())
            .ok_or("Git did not produce an integration tree.")?;
        preview_target = tree.to_string();
        if !output.status.success() {
            plan.conflicts = lines
                .take_while(|line| !line.is_empty())
                .map(str::to_string)
                .collect();
            if plan.conflicts.is_empty() {
                plan.conflicts.push("Git reported a merge conflict.".into());
            }
            plan.status = "conflicted".into();
            break;
        }
        combined = commit_tree(
            &project,
            tree,
            &[&combined, &source_commit],
            &format!("merge: integrate task {}", run.id),
        )?;
    }
    (plan.files, plan.patch) = preview(&project, &plan.master_head, &preview_target)?;
    if plan.status == "ready" {
        git(
            &project,
            &[
                "update-ref",
                &format!("refs/jackalope/integrations/{}", plan.id),
                &combined,
            ],
        )?;
        plan.integration_head = Some(combined);
    }
    save(directory, &plan)?;
    Ok(plan)
}

fn load(directory: &Path, id: &str) -> Result<IntegrationPlan, String> {
    if !valid_id(id) {
        return Err("Invalid integration ID.".into());
    }
    serde_json::from_slice(
        &fs::read(directory.join(format!("{id}.json"))).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Could not read integration plan: {e}"))
}

fn apply(directory: &Path, runs: &[TaskRun], id: &str) -> Result<IntegrationPlan, String> {
    let mut plan = load(directory, id)?;
    if plan.status == "applied" {
        return Ok(plan);
    }
    if !["ready", "applying"].contains(&plan.status.as_str()) {
        return Err(
            "This integration has conflicts. Resolve the task worktrees and prepare a new review."
                .into(),
        );
    }
    let head = plan
        .integration_head
        .clone()
        .ok_or("Integration commit is missing.")?;
    let project = canonical(&plan.project_path)?;
    let reference = format!("refs/heads/{}", plan.target_branch);
    let current = git(&project, &["rev-parse", &reference])?;
    if plan.status == "applying"
        && command(&project, &["merge-base", "--is-ancestor", &head, &current])
            .status()
            .map_err(|e| e.to_string())?
            .success()
    {
        plan.status = "applied".into();
        plan.applied_at = Some(Utc::now().to_rfc3339());
        save(directory, &plan)?;
        return Ok(plan);
    }
    if current != plan.master_head {
        return Err(
            "The target branch changed since this review. Prepare a fresh integration.".into(),
        );
    }
    if git(&project, &["symbolic-ref", "--quiet", "HEAD"])? != reference {
        return Err(format!(
            "Switch the project checkout to {} before applying this integration.",
            plan.target_branch
        ));
    }
    if !git(
        &project,
        &["status", "--porcelain=v1", "--untracked-files=all"],
    )?
    .is_empty()
    {
        return Err("The target checkout has local changes. Review and commit or move them before integration; Jackalope will not stash them.".into());
    }
    let selected = selected_runs(runs, &plan.run_ids)?;
    if canonical(&selected[0].project_path)? != project {
        return Err("The project's location changed. Prepare a fresh integration.".into());
    }
    for run in &selected {
        let before = plan
            .sources
            .iter()
            .find(|source| source.run_id == run.id)
            .ok_or("A task snapshot is missing.")?;
        let now = snapshot(run, directory)?;
        require_verification(run, &now.tree)?;
        if before.head != now.head
            || before.tree != now.tree
            || before.status != now.status
            || canonical(&before.workspace)? != canonical(&now.workspace)?
        {
            return Err("A task worktree changed since review. Prepare a fresh integration before applying it.".into());
        }
    }
    if git(
        &project,
        &[
            "rev-parse",
            &format!("refs/jackalope/integrations/{}", plan.id),
        ],
    )? != head
    {
        return Err("The integration reference changed. Prepare a fresh review.".into());
    }
    plan.status = "applying".into();
    save(directory, &plan)?;
    git(
        &project,
        &[
            "merge",
            "--ff-only",
            "--no-edit",
            "--no-autostash",
            "--no-overwrite-ignore",
            &head,
        ],
    )?;
    plan.status = "applied".into();
    plan.applied_at = Some(Utc::now().to_rfc3339());
    save(directory, &plan).map_err(|e| format!("The target branch was updated, but saving the receipt failed: {e}. Reload and apply this same plan to recover the receipt."))?;
    Ok(plan)
}

pub fn plans(runtime: &TaskRuntime) -> Result<Vec<IntegrationPlan>, String> {
    let directory = runtime.integration_directory();
    if !directory.exists() {
        return Ok(vec![]);
    }
    let mut plans = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or("Invalid integration record.")?;
            plans.push(load(&directory, id)?);
        }
    }
    plans.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(plans)
}

pub fn applied_run_ids(runtime: &TaskRuntime) -> Result<Vec<String>, String> {
    reachable_run_ids(plans(runtime)?, &runtime.integration_runs()?)
}

fn reachable_run_ids(plans: Vec<IntegrationPlan>, runs: &[TaskRun]) -> Result<Vec<String>, String> {
    let mut ids = Vec::new();
    for plan in plans.into_iter().filter(|plan| plan.status == "applied") {
        let head = plan
            .integration_head
            .as_deref()
            .ok_or("An applied integration is missing its Git reference.")?;
        let result = command(
            Path::new(&plan.project_path),
            &[
                "merge-base",
                "--is-ancestor",
                head,
                &format!("refs/heads/{}", plan.target_branch),
            ],
        )
        .output()
        .map_err(|e| e.to_string())?;
        if !result.status.success() {
            return Err(format!("Dispatch paused: the target branch in {} no longer contains integration {}. Restore that integration before running dependent work.", plan.project_path, plan.id));
        }
        for id in plan.run_ids {
            if let Some(source) = runs.iter().find(|run| run.id == id) {
                ids.extend(
                    runs.iter()
                        .filter(|run| {
                            run.task_id == source.task_id
                                && run.project_id == source.project_id
                                && run.started_at <= source.started_at
                        })
                        .map(|run| run.id.clone()),
                );
            }
            ids.push(id);
        }
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}

#[tauri::command]
pub async fn integration_prepare(
    state: State<'_, TaskRuntime>,
    run_ids: Vec<String>,
) -> Result<IntegrationPlan, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = execution_guard()?;
        prepare(
            &runtime.integration_directory(),
            &runtime.integration_runs()?,
            &run_ids,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn integration_apply(
    state: State<'_, TaskRuntime>,
    plan_id: String,
) -> Result<IntegrationPlan, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = execution_guard()?;
        apply(
            &runtime.integration_directory(),
            &runtime.integration_runs()?,
            &plan_id,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn integration_plans(
    state: State<'_, TaskRuntime>,
) -> Result<Vec<IntegrationPlan>, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = execution_guard()?;
        plans(&runtime)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
        project: PathBuf,
        plans: PathBuf,
        base: String,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("jackalope-integration-{}", unique_id()));
            let project = root.join("project");
            let plans = root.join("plans");
            fs::create_dir_all(&project).unwrap();
            git(&project, &["init", "--initial-branch=master"]).unwrap();
            git(&project, &["config", "user.name", "Integration Test"]).unwrap();
            git(
                &project,
                &["config", "user.email", "integration@example.test"],
            )
            .unwrap();
            fs::write(project.join("shared.txt"), "original\n").unwrap();
            git(&project, &["add", "."]).unwrap();
            git(&project, &["commit", "-m", "test fixture"]).unwrap();
            let base = git(&project, &["rev-parse", "HEAD"]).unwrap();
            Self {
                root,
                project,
                plans,
                base,
            }
        }

        fn run(&self, number: u32, filename: &str, content: &str) -> TaskRun {
            let workspace = self.root.join(format!("task-{number}"));
            git(
                &self.project,
                &[
                    "worktree",
                    "add",
                    "-b",
                    &format!("task-{number}"),
                    workspace.to_str().unwrap(),
                    &self.base,
                ],
            )
            .unwrap();
            fs::write(workspace.join(filename), content).unwrap();
            serde_json::from_value(serde_json::json!({
                "id": format!("run-{number:08}"), "taskId": format!("task-{number}"),
                "projectId": "fixture", "projectName": "Fixture", "projectPath": self.project,
                "workspace": workspace, "branch": format!("task-{number}"), "baseHead": self.base,
                "agent": "codex", "account": "test", "model": null, "prompt": "Make one change",
                "status": "review", "startedAt": format!("2026-09-04T00:00:{number:02}Z"),
                "endedAt": "2026-09-04T00:01:00Z", "sessionId": null, "result": "Done", "activity": [],
                "diagnostics": [], "error": null, "persistenceError": null, "exitCode": 0,
                "usage": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "reported": false, "estimatedCostUsd": null }
            })).unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            if self.root.parent() == Some(std::env::temp_dir().as_path())
                && self
                    .root
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("jackalope-integration-")
            {
                let _ = fs::remove_dir_all(&self.root);
            }
        }
    }

    #[test]
    fn main_and_custom_targets_remain_bound_when_the_checkout_changes() {
        for branch in ["main", "feature/release"] {
            let fixture = Fixture::new();
            git(&fixture.project, &["branch", "-m", branch]).unwrap();
            let mut run = fixture.run(1, "first.txt", "first\n");
            run.target_branch = Some(branch.into());
            let runs = vec![run.clone()];
            let plan = prepare(&fixture.plans, &runs, &[run.id]).unwrap();
            assert_eq!(plan.target_branch, branch);
            git(&fixture.project, &["checkout", "-b", "unrelated"]).unwrap();
            assert!(apply(&fixture.plans, &runs, &plan.id)
                .unwrap_err()
                .contains("Switch the project checkout"));
            git(&fixture.project, &["checkout", branch]).unwrap();
            apply(&fixture.plans, &runs, &plan.id).unwrap();
            assert_eq!(
                fs::read_to_string(fixture.project.join("first.txt")).unwrap(),
                "first\n"
            );
            assert!(
                reachable_run_ids(vec![load(&fixture.plans, &plan.id).unwrap()], &runs)
                    .unwrap()
                    .contains(&runs[0].id)
            );
        }
    }

    #[test]
    fn failed_missing_or_stale_verification_cannot_be_integrated() {
        let fixture = Fixture::new();
        let mut run = fixture.run(1, "first.txt", "first\n");
        run.verify_command = Some("test".into());
        assert!(prepare(&fixture.plans, &[run.clone()], &[run.id.clone()])
            .unwrap_err()
            .contains("Run project verification"));
        let tree = workspace_tree(&run, &fixture.plans).unwrap();
        run.verification = Some(super::super::verification::Verification {
            command: "test".into(),
            checked_at: Utc::now().to_rfc3339(),
            tree: Some(tree),
            result: super::super::process_control::CommandResult {
                exit_code: Some(1),
                success: false,
                timed_out: false,
                stdout: String::new(),
                stderr: String::new(),
                truncated: false,
                duration_ms: 1,
            },
        });
        assert!(prepare(&fixture.plans, &[run.clone()], &[run.id.clone()]).is_err());
        run.verification.as_mut().unwrap().result.success = true;
        assert!(prepare(&fixture.plans, &[run.clone()], &[run.id.clone()]).is_ok());
        fs::write(
            Path::new(&run.workspace).join("first.txt"),
            "changed after checks",
        )
        .unwrap();
        assert!(prepare(&fixture.plans, &[run.clone()], &[run.id.clone()])
            .unwrap_err()
            .contains("files changed"));
    }

    #[test]
    fn independent_tasks_prepare_without_source_changes_then_apply_together() {
        let fixture = Fixture::new();
        let a = fixture.run(1, "first.txt", "first\n");
        let b = fixture.run(2, "second.txt", "second\n");
        git(Path::new(&a.workspace), &["add", "first.txt"]).unwrap();
        let before = git(Path::new(&a.workspace), &["diff", "--cached"]).unwrap();
        let runs = vec![a, b];
        let ids: Vec<_> = runs.iter().map(|run| run.id.clone()).collect();
        let plan = prepare(&fixture.plans, &runs, &ids).unwrap();
        assert_eq!(plan.status, "ready");
        assert_eq!(plan.files, vec!["first.txt", "second.txt"]);
        assert_eq!(
            git(&fixture.project, &["rev-parse", "HEAD"]).unwrap(),
            fixture.base
        );
        assert!(!fixture.project.join("first.txt").exists());
        assert_eq!(
            before,
            git(Path::new(&runs[0].workspace), &["diff", "--cached"]).unwrap()
        );
        let applied = apply(&fixture.plans, &runs, &plan.id).unwrap();
        assert_eq!(applied.status, "applied");
        assert_eq!(
            fs::read_to_string(fixture.project.join("first.txt")).unwrap(),
            "first\n"
        );
        assert_eq!(
            fs::read_to_string(fixture.project.join("second.txt")).unwrap(),
            "second\n"
        );
        assert!(git(&fixture.project, &["status", "--porcelain"])
            .unwrap()
            .is_empty());
        assert_eq!(
            git(&fixture.project, &["log", "-1", "--format=%an <%ae>"]).unwrap(),
            "Integration Test <integration@example.test>"
        );
        assert!(!git(
            &fixture.project,
            &["log", "--format=%B", &format!("{}..HEAD", fixture.base)]
        )
        .unwrap()
        .contains("Co-authored-by"));
        assert_eq!(
            apply(&fixture.plans, &runs, &plan.id).unwrap().status,
            "applied"
        );
    }

    #[test]
    fn conflicting_tasks_preserve_master_and_report_file() {
        let fixture = Fixture::new();
        let runs = vec![
            fixture.run(1, "shared.txt", "one\n"),
            fixture.run(2, "shared.txt", "two\n"),
        ];
        let ids: Vec<_> = runs.iter().map(|run| run.id.clone()).collect();
        let plan = prepare(&fixture.plans, &runs, &ids).unwrap();
        assert_eq!(plan.status, "conflicted");
        assert!(plan.conflicts.contains(&"shared.txt".to_string()));
        assert!(apply(&fixture.plans, &runs, &plan.id)
            .unwrap_err()
            .contains("conflicts"));
        assert_eq!(
            git(&fixture.project, &["rev-parse", "HEAD"]).unwrap(),
            fixture.base
        );
        assert_eq!(
            fs::read_to_string(fixture.project.join("shared.txt")).unwrap(),
            "original\n"
        );
    }

    #[test]
    fn source_content_change_requires_new_review() {
        let fixture = Fixture::new();
        let runs = vec![fixture.run(1, "shared.txt", "reviewed\n")];
        let plan = prepare(&fixture.plans, &runs, &[runs[0].id.clone()]).unwrap();
        fs::write(
            Path::new(&runs[0].workspace).join("shared.txt"),
            "not reviewed\n",
        )
        .unwrap();
        assert!(apply(&fixture.plans, &runs, &plan.id)
            .unwrap_err()
            .contains("worktree changed"));
        assert_eq!(
            git(&fixture.project, &["rev-parse", "HEAD"]).unwrap(),
            fixture.base
        );
    }

    #[test]
    fn dirty_master_and_changed_master_are_never_overwritten() {
        let fixture = Fixture::new();
        let runs = vec![fixture.run(1, "new.txt", "task\n")];
        let plan = prepare(&fixture.plans, &runs, &[runs[0].id.clone()]).unwrap();
        fs::write(fixture.project.join("untracked.txt"), "user work").unwrap();
        assert!(apply(&fixture.plans, &runs, &plan.id)
            .unwrap_err()
            .contains("local changes"));
        assert_eq!(
            fs::read_to_string(fixture.project.join("untracked.txt")).unwrap(),
            "user work"
        );
        git(&fixture.project, &["add", "."]).unwrap();
        git(&fixture.project, &["commit", "-m", "user change"]).unwrap();
        assert!(apply(&fixture.plans, &runs, &plan.id)
            .unwrap_err()
            .contains("target branch changed"));
        assert!(!fixture.project.join("new.txt").exists());
    }

    #[test]
    fn receipt_recovers_when_master_advanced_before_journal_write() {
        let fixture = Fixture::new();
        let runs = vec![fixture.run(1, "new.txt", "task\n")];
        let mut plan = prepare(&fixture.plans, &runs, &[runs[0].id.clone()]).unwrap();
        plan.status = "applying".into();
        save(&fixture.plans, &plan).unwrap();
        git(
            &fixture.project,
            &[
                "merge",
                "--ff-only",
                plan.integration_head.as_ref().unwrap(),
            ],
        )
        .unwrap();
        let recovered = apply(&fixture.plans, &[], &plan.id).unwrap();
        assert_eq!(recovered.status, "applied");
        assert!(recovered.applied_at.is_some());
    }

    #[test]
    fn active_and_older_attempts_are_not_eligible() {
        let fixture = Fixture::new();
        let original = fixture.run(1, "new.txt", "task\n");
        let mut continuation = original.clone();
        continuation.id = "run-continue".into();
        continuation.started_at = "2026-09-04T01:00:00Z".into();
        continuation.status = "running".into();
        continuation.workspace.clear();
        let ids = vec![original.id.clone()];
        assert!(prepare(&fixture.plans, &[original, continuation], &ids)
            .unwrap_err()
            .contains("newer, active, or interrupted"));
    }

    #[test]
    fn unsaved_task_history_blocks_preparation_and_application() {
        let fixture = Fixture::new();
        let mut run = fixture.run(1, "new.txt", "task\n");
        let ids = vec![run.id.clone()];
        let plan = prepare(&fixture.plans, &[run.clone()], &ids).unwrap();
        let before = git(&fixture.project, &["rev-parse", "HEAD"]).unwrap();
        run.persistence_error = Some("Storage unavailable".into());
        assert!(prepare(&fixture.plans, &[run.clone()], &ids)
            .unwrap_err()
            .contains("latest history"));
        assert!(apply(&fixture.plans, &[run], &plan.id)
            .unwrap_err()
            .contains("latest history"));
        assert_eq!(
            git(&fixture.project, &["rev-parse", "HEAD"]).unwrap(),
            before
        );
    }

    #[test]
    fn ignored_local_files_are_not_overwritten_and_force_added_files_are_reviewed() {
        let fixture = Fixture::new();
        fs::write(fixture.project.join(".git/info/exclude"), "private.txt\n").unwrap();
        let run = fixture.run(1, "private.txt", "task version\n");
        git(
            Path::new(&run.workspace),
            &["add", "--force", "private.txt"],
        )
        .unwrap();
        let ids = vec![run.id.clone()];
        let runs = vec![run];
        let plan = prepare(&fixture.plans, &runs, &ids).unwrap();
        assert!(plan.files.contains(&"private.txt".to_string()));
        fs::write(
            fixture.project.join("private.txt"),
            "private local version\n",
        )
        .unwrap();
        assert!(apply(&fixture.plans, &runs, &plan.id).is_err());
        assert_eq!(
            fs::read_to_string(fixture.project.join("private.txt")).unwrap(),
            "private local version\n"
        );
        assert_eq!(
            git(&fixture.project, &["rev-parse", "HEAD"]).unwrap(),
            fixture.base
        );
    }

    #[test]
    fn resetting_master_does_not_release_dependencies_from_old_receipts() {
        let fixture = Fixture::new();
        let runs = vec![fixture.run(1, "new.txt", "task\n")];
        let plan = prepare(&fixture.plans, &runs, &[runs[0].id.clone()]).unwrap();
        let applied = apply(&fixture.plans, &runs, &plan.id).unwrap();
        assert_eq!(
            reachable_run_ids(vec![applied.clone()], &runs).unwrap(),
            vec![runs[0].id.clone()]
        );
        git(&fixture.project, &["reset", "--hard", &fixture.base]).unwrap();
        assert!(reachable_run_ids(vec![applied], &runs)
            .unwrap_err()
            .contains("no longer contains integration"));
    }
}
