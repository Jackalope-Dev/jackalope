use super::*;
use crate::commands::tasks::RunStatus;
use std::fs;

fn git(path: &Path, args: &[&str]) -> String {
    repo::git(path, args, Inspection).unwrap()
}

fn run(id: &str, task: &str, workspace: &Path, base: &str) -> TaskRun {
    serde_json::from_value(serde_json::json!({
        "id": id, "taskId": task, "projectId": "fixture", "projectName": "Fixture",
        "projectPath": "/fixture", "workspace": workspace, "branch": "jackalope/x",
        "baseHead": base, "agent": "codex", "account": "test", "model": null, "prompt": "test",
        "status": "review", "startedAt": "2026-09-01T00:00:00Z",
        "endedAt": "2026-09-02T00:00:00Z", "sessionId": null, "result": "", "activity": [],
        "error": null, "persistenceError": null, "exitCode": null,
        "usage": {"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"reported":false,"estimatedCostUsd":null}
    }))
    .unwrap()
}

fn time(value: &str) -> DateTime<Utc> {
    parse_time(Some(value)).unwrap()
}

fn plan(status: &str, run_ids: &[&str], applied_at: Option<&str>) -> IntegrationPlan {
    serde_json::from_value(serde_json::json!({
        "id": "1-1-1", "projectPath": "/fixture", "masterHead": "a", "integrationHead": null,
        "runIds": run_ids, "sources": [], "files": [], "patch": "", "conflicts": [],
        "status": status, "createdAt": "2026-09-02T00:00:00Z", "appliedAt": applied_at
    }))
    .unwrap()
}

fn status(merged: Option<bool>, content_merged: bool, blocked: Option<&str>) -> CleanupStatus {
    CleanupStatus {
        target_branch: Some("main".into()),
        target_head: Some("t".into()),
        merged,
        blocked_reason: blocked.map(str::to_string),
        recoverable: false,
        missing: false,
        discarded_paths: Vec::new(),
        content_merged,
    }
}

#[test]
fn history_keeps_worktrees_that_running_work_reservations_or_recovery_need() {
    let path = std::env::temp_dir().join(format!("jl-retention-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&path).unwrap();
    let path = canonical(&path.to_string_lossy()).unwrap();
    let none = HashSet::new();
    let keep = |runs: &[TaskRun], plans: &[IntegrationPlan], retained: &[PathBuf]| {
        let keys = retained
            .iter()
            .map(|path| path_key(&path.to_string_lossy()))
            .collect();
        history(&path, runs, &none, plans, &keys).unwrap_err()
    };
    let owner = run("r1", "t1", &path, "base");
    assert!(history(
        &path,
        std::slice::from_ref(&owner),
        &none,
        &[],
        &HashSet::new()
    )
    .is_ok());

    assert!(keep(&[], &[], &[]).contains("No task"));
    assert!(keep(&[owner.clone()], &[], std::slice::from_ref(&path)).contains("combine"));

    let mut unsaved = owner.clone();
    unsaved.persistence_error = Some("disk full".into());
    assert!(keep(&[unsaved], &[], &[]).contains("not saved"));

    for live in [
        RunStatus::Running,
        RunStatus::Interrupted,
        RunStatus::Starting,
    ] {
        let mut active = owner.clone();
        active.status = live;
        assert!(keep(&[active], &[], &[]).contains("running"));
    }
    let mut finishing = owner.clone();
    finishing.finishing = true;
    assert!(keep(&[finishing], &[], &[]).contains("finishing"));

    let mut conversation = owner.clone();
    conversation.live_session_id = Some("session".into());
    assert!(keep(&[conversation], &[], &[]).contains("conversation"));

    let mut reviewer = run("r2", "t2", Path::new("/elsewhere"), "base");
    reviewer.status = RunStatus::Running;
    reviewer.challenge_of = Some(crate::commands::challenge_review::ChallengeSource {
        run_id: "r1".into(),
        tree: String::new(),
        base: String::new(),
        kind: Default::default(),
    });
    assert!(keep(&[owner.clone(), reviewer], &[], &[]).contains("review"));

    for pending in ["ready", "applying"] {
        assert!(keep(&[owner.clone()], &[plan(pending, &["r1"], None)], &[]).contains("prepared"));
    }
    assert!(history(
        &path,
        std::slice::from_ref(&owner),
        &none,
        &[plan("conflicted", &["r1"], None)],
        &HashSet::new()
    )
    .is_ok());
    let _ = fs::remove_dir_all(path);
}

#[test]
fn history_reports_what_finished_the_task_and_when() {
    let path = std::env::temp_dir().join(format!("jl-retention-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&path).unwrap();
    let path = canonical(&path.to_string_lossy()).unwrap();
    let owner = run("r1", "t1", &path, "base");
    let none = HashSet::new();

    let open = history(
        &path,
        std::slice::from_ref(&owner),
        &none,
        &[],
        &HashSet::new(),
    )
    .unwrap();
    assert_eq!(open.finished, None);
    assert_eq!(open.since, time("2026-09-02T00:00:00Z"));
    assert_eq!(open.base_heads, ["base"]);

    let mut archived = owner.clone();
    archived.archived_at = Some("2026-09-05T00:00:00Z".into());
    let settled = history(&path, &[archived.clone()], &none, &[], &HashSet::new()).unwrap();
    assert_eq!(settled.finished, Some("its task was archived"));
    assert_eq!(settled.since, time("2026-09-05T00:00:00Z"));

    // A newer attempt of the same task, anywhere, brings the task back from the archive.
    let mut newer = run("r2", "t1", Path::new("/elsewhere"), "base");
    newer.started_at = "2026-09-06T00:00:00Z".into();
    let reopened = history(&path, &[archived, newer], &none, &[], &HashSet::new()).unwrap();
    assert_eq!(reopened.finished, None);

    let applied: HashSet<String> = ["r1".to_string()].into();
    let merged = history(
        &path,
        std::slice::from_ref(&owner),
        &applied,
        &[plan("applied", &["r1"], Some("2026-09-08T00:00:00Z"))],
        &HashSet::new(),
    )
    .unwrap();
    assert_eq!(merged.finished, Some("its task was merged by Jackalope"));
    assert_eq!(merged.since, time("2026-09-08T00:00:00Z"));

    assert!(waited(&merged, Duration::days(7), time("2026-09-14T23:00:00Z")).is_err());
    assert!(waited(&merged, Duration::days(7), time("2026-09-15T00:00:00Z")).is_ok());
    let _ = fs::remove_dir_all(path);
}

#[test]
fn decide_never_removes_blocked_unmerged_or_unfinished_worktrees() {
    let settled = |finished, base: &str| Settled {
        finished,
        since: time("2026-09-02T00:00:00Z"),
        base_heads: vec![base.into()],
    };
    let archived = settled(Some("its task was archived"), "base");
    assert!(decide(
        &archived,
        "head",
        &status(Some(true), false, Some("Locked worktree"))
    )
    .unwrap_err()
    .contains("Locked"));
    assert!(decide(&archived, "head", &status(Some(false), false, None))
        .unwrap_err()
        .contains("not merged into main"));
    assert!(decide(&archived, "head", &status(None, false, None)).is_err());
    assert_eq!(
        decide(&archived, "base", &status(Some(true), false, None)).unwrap(),
        "its task was archived"
    );

    let open = settled(None, "base");
    assert!(
        decide(&open, "base", &status(Some(true), false, None))
            .unwrap_err()
            .contains("not merged or archived"),
        "a branch with no commits of its own is not a merged task"
    );
    assert!(decide(&settled(None, ""), "head", &status(Some(true), false, None)).is_err());
    assert_eq!(
        decide(&open, "head", &status(Some(true), false, None)).unwrap(),
        "its commits are merged into main"
    );
    assert!(decide(&open, "base", &status(Some(false), true, None)).is_ok());
}

/// A project with task worktrees in `.worktrees/` and their attempts saved in history.
struct Project {
    root: PathBuf,
    repo: PathBuf,
}

impl Project {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("jl-retention-{}", uuid::Uuid::new_v4()));
        let repo = root.join("project");
        fs::create_dir_all(&repo).unwrap();
        git(&repo, &["init", "--initial-branch", "main"]);
        git(&repo, &["config", "user.name", "Retention Test"]);
        git(&repo, &["config", "user.email", "retention@example.test"]);
        fs::write(repo.join(".gitignore"), ".worktrees/\n.env\n").unwrap();
        fs::write(repo.join("file.txt"), "initial\n").unwrap();
        git(&repo, &["add", "."]);
        git(&repo, &["commit", "-m", "fixture"]);
        let repo = canonical(&repo.to_string_lossy()).unwrap();
        Self { root, repo }
    }

    /// A task worktree on a new `jackalope/<name>` branch, with the commit it started from.
    fn worktree(&self, name: &str) -> (PathBuf, String) {
        let path = self.repo.join(".worktrees").join(name);
        git(
            &self.repo,
            &[
                "worktree",
                "add",
                "-b",
                &format!("jackalope/{name}"),
                path.to_str().unwrap(),
            ],
        );
        let base = git(&path, &["rev-parse", "HEAD"]);
        (path, base)
    }

    fn commit(&self, path: &Path, name: &str) {
        fs::write(path.join(format!("{name}.txt")), name).unwrap();
        git(path, &["add", "."]);
        git(path, &["commit", "-m", name]);
    }

    fn merge(&self, name: &str) {
        git(
            &self.repo,
            &[
                "merge",
                "--no-edit",
                "--no-ff",
                &format!("jackalope/{name}"),
            ],
        );
    }

    fn runtime(&self, runs: &[TaskRun]) -> TaskRuntime {
        let history = self.root.join("history");
        fs::create_dir_all(&history).unwrap();
        for run in runs {
            fs::write(
                history.join(format!("{}.json", run.id)),
                serde_json::to_vec(run).unwrap(),
            )
            .unwrap();
        }
        TaskRuntime::with_test_access(history).unwrap()
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn a_pass_removes_only_finished_clean_worktrees_past_retention_and_logs_why() {
    let project = Project::new();
    let ended = |run: &mut TaskRun, at: &str| run.ended_at = Some(at.into());
    let mut runs = Vec::new();

    let (merged, merged_base) = project.worktree("merged");
    project.commit(&merged, "merged");
    project.merge("merged");
    let mut merged_run = run("run-merged", "t-merged", &merged, &merged_base);
    ended(&mut merged_run, "2026-09-01T00:00:00Z");
    runs.push(merged_run);

    let (archived, archived_base) = project.worktree("archived");
    let mut archived_run = run("run-archived", "t-archived", &archived, &archived_base);
    archived_run.archived_at = Some("2026-09-01T00:00:00Z".into());
    runs.push(archived_run);

    let (unfinished, unfinished_base) = project.worktree("unfinished");
    runs.push(run(
        "run-unfinished",
        "t-unfinished",
        &unfinished,
        &unfinished_base,
    ));

    let (recent, recent_base) = project.worktree("recent");
    project.commit(&recent, "recent");
    project.merge("recent");
    let mut recent_run = run("run-recent", "t-recent", &recent, &recent_base);
    ended(&mut recent_run, "2026-09-09T00:00:00Z");
    runs.push(recent_run);

    let (dirty, dirty_base) = project.worktree("dirty");
    fs::write(dirty.join("file.txt"), "uncommitted\n").unwrap();
    let mut dirty_run = run("run-dirty", "t-dirty", &dirty, &dirty_base);
    dirty_run.archived_at = Some("2026-09-01T00:00:00Z".into());
    runs.push(dirty_run);

    let (unmerged, unmerged_base) = project.worktree("unmerged");
    project.commit(&unmerged, "unmerged");
    let mut unmerged_run = run("run-unmerged", "t-unmerged", &unmerged, &unmerged_base);
    unmerged_run.archived_at = Some("2026-09-01T00:00:00Z".into());
    runs.push(unmerged_run);

    let (edited, edited_base) = project.worktree("edited");
    fs::write(project.repo.join(".env"), "KEY=checkout").unwrap();
    fs::write(edited.join(".env"), "KEY=edited in the task").unwrap();
    let mut edited_run = run("run-edited", "t-edited", &edited, &edited_base);
    edited_run.archived_at = Some("2026-09-01T00:00:00Z".into());
    runs.push(edited_run);

    let (copied, copied_base) = project.worktree("copied");
    fs::write(copied.join(".env"), "KEY=checkout").unwrap();
    let mut copied_run = run("run-copied", "t-copied", &copied, &copied_base);
    copied_run.archived_at = Some("2026-09-01T00:00:00Z".into());
    runs.push(copied_run);

    let (combined, combined_base) = project.worktree("combined");
    let mut combined_run = run("run-combined", "t-combined", &combined, &combined_base);
    combined_run.archived_at = Some("2026-09-01T00:00:00Z".into());
    runs.push(combined_run);

    let (foreign, _) = project.worktree("foreign");
    let outside = project.root.join("outside");
    git(
        &project.repo,
        &[
            "worktree",
            "add",
            "-b",
            "outside",
            outside.to_str().unwrap(),
        ],
    );
    let mut outside_run = run("run-outside", "t-outside", &outside, "");
    outside_run.archived_at = Some("2026-09-01T00:00:00Z".into());
    runs.push(outside_run);

    let runtime = project.runtime(&runs);
    let report = run_pass(
        &runtime,
        project.repo.to_str().unwrap(),
        Duration::days(7),
        &[format!("{}/", combined.to_string_lossy().to_lowercase())],
        time("2026-09-10T00:00:00Z"),
    )
    .unwrap();
    let outcome = |path: &Path| {
        report
            .iter()
            .find(|entry| Path::new(&entry.worktree) == path)
            .map(|entry| (entry.outcome.as_str(), entry.reason.as_str()))
            .unwrap_or_else(|| panic!("{} missing from {report:?}", path.display()))
    };
    for (path, reason) in [
        (&merged, "its commits are merged into main 9 days ago"),
        (&archived, "its task was archived 8 days ago"),
        (&copied, "its task was archived"),
    ] {
        let (result, why) = outcome(path);
        assert_eq!(result, "removed", "{why}");
        assert!(why.contains(reason), "{why}");
        assert!(!path.exists());
    }
    for (path, reason) in [
        (&unfinished, "not merged or archived"),
        (&recent, "Kept until 2026-09-16"),
        (&dirty, "Uncommitted changes"),
        (&unmerged, "not merged into main"),
        (&edited, "secrets or local data"),
        (&combined, "combine"),
        (&foreign, "No task"),
    ] {
        let (result, why) = outcome(path);
        assert_eq!(result, "kept", "{}: {why}", path.display());
        assert!(why.contains(reason), "{}: {why}", path.display());
        assert!(path.exists());
    }
    assert!(
        report
            .iter()
            .all(|entry| Path::new(&entry.worktree) != outside),
        "worktrees outside the project's .worktrees folder are not considered"
    );
    assert!(outside.exists());
    assert_eq!(
        git(&project.repo, &["branch", "--list", "jackalope/merged"]),
        "  jackalope/merged",
        "branches are kept"
    );
    assert_eq!(
        fs::read_to_string(project.repo.join(".env")).unwrap(),
        "KEY=checkout"
    );

    record(&runtime, &report).unwrap();
    let logged = read_log(&runtime, project.repo.to_str().unwrap());
    assert_eq!(logged.len(), 3, "only removals and failures are logged");
    assert!(logged.iter().all(|entry| entry.outcome == "removed"));
    assert!(read_log(&runtime, "/another/project").is_empty());

    let mut unsaved = runs[2].clone();
    unsaved.persistence_error = Some("disk full".into());
    drop(runtime);
    let runtime = project.runtime(&[unsaved]);
    assert!(run_pass(
        &runtime,
        project.repo.to_str().unwrap(),
        Duration::days(7),
        &[],
        time("2026-09-10T00:00:00Z"),
    )
    .unwrap_err()
    .contains("Save pending task history"));
}
