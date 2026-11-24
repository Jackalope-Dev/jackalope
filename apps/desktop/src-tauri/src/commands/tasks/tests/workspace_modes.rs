use super::*;
use serde_json::json;

fn repository(root: &Path) -> String {
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    let path = repo.to_string_lossy().into_owned();
    git(&path, &["init", "--initial-branch=main"]).unwrap();
    git(&path, &["config", "user.email", "fixture@localhost"]).unwrap();
    git(&path, &["config", "user.name", "Fixture"]).unwrap();
    std::fs::write(repo.join("README.md"), "fixture").unwrap();
    git(&path, &["add", "README.md"]).unwrap();
    git(
        &path,
        &["-c", "commit.gpgsign=false", "commit", "-m", "Baseline"],
    )
    .unwrap();
    git(&path, &["rev-parse", "--show-toplevel"]).unwrap()
}

fn request(id: &str, repo: &str, mode: &str) -> RunRequest {
    serde_json::from_value(json!({
        "id": id, "projectId": "p", "projectName": "P", "projectPath": repo,
        "agent": "codex", "prompt": "Fixture", "isolated": false,
        "targetBranch": "main", "workspaceMode": mode,
    }))
    .unwrap()
}

fn running(runtime: &TaskRuntime, id: &str, repo: &str) {
    let mut run = sample("codex");
    run.id = id.into();
    run.task_id = id.into();
    run.status = RunStatus::Running;
    run.project_path = repo.into();
    run.workspace.clear();
    runtime.inner.lock().unwrap().runs.insert(id.into(), run);
}

#[test]
fn in_place_modes_hold_the_checkout_and_never_discard_changes() {
    let root = std::env::temp_dir().join(format!("jackalope-modes-{}", uuid::Uuid::new_v4()));
    let repo = repository(&root);
    let readme = Path::new(&repo).join("README.md");
    let runtime = TaskRuntime::new(root.join("history")).unwrap();

    // New branch: the checkout switches to the task's own branch.
    running(&runtime, "branch-task", &repo);
    runtime
        .prepare_workspace(
            "branch-task",
            &request("branch-task", &repo, "branch"),
            None,
        )
        .unwrap();
    let run = runtime.run_snapshot("branch-task").unwrap();
    assert_eq!(run.workspace, repo);
    assert_eq!(run.branch, "jackalope/fixture-branch");
    assert_eq!(
        git(&repo, &["branch", "--show-current"]).unwrap(),
        "jackalope/fixture-branch"
    );

    // One in-place task at a time per checkout.
    running(&runtime, "second-task", &repo);
    let busy = runtime
        .prepare_workspace(
            "second-task",
            &request("second-task", &repo, "current"),
            None,
        )
        .unwrap_err();
    assert!(busy.contains("Another task"), "{busy}");

    // Once it finishes, current-branch work still requires the target branch.
    runtime.update("branch-task", |run| run.status = RunStatus::Review);
    let moved = runtime
        .prepare_workspace(
            "second-task",
            &request("second-task", &repo, "current"),
            None,
        )
        .unwrap_err();
    assert!(moved.contains("different branch"), "{moved}");

    // Current branch keeps the person's uncommitted edits in place.
    git(&repo, &["checkout", "main"]).unwrap();
    std::fs::write(&readme, "edited by the person").unwrap();
    runtime
        .prepare_workspace(
            "second-task",
            &request("second-task", &repo, "current"),
            None,
        )
        .unwrap();
    let run = runtime.run_snapshot("second-task").unwrap();
    assert_eq!(
        (run.workspace.as_str(), run.branch.as_str()),
        (repo.as_str(), "main")
    );
    assert_eq!(
        std::fs::read_to_string(&readme).unwrap(),
        "edited by the person"
    );

    // A new branch refuses to carry or discard those edits.
    runtime.update("second-task", |run| run.status = RunStatus::Review);
    running(&runtime, "third-task", &repo);
    let dirty = runtime
        .prepare_workspace("third-task", &request("third-task", &repo, "branch"), None)
        .unwrap_err();
    assert!(dirty.contains("uncommitted changes"), "{dirty}");
    assert_eq!(
        std::fs::read_to_string(&readme).unwrap(),
        "edited by the person"
    );
    assert_eq!(git(&repo, &["branch", "--show-current"]).unwrap(), "main");

    // Continuing in-place work requires the branch it started on.
    git(&repo, &["stash", "push", "-m", "fixture"]).unwrap();
    git(&repo, &["checkout", "jackalope/fixture-branch"]).unwrap();
    let previous = runtime.run_snapshot("second-task").unwrap();
    let mut previous_with_session = previous.clone();
    previous_with_session.session_id = Some("session".into());
    running(&runtime, "continued-task", &repo);
    let wrong = runtime
        .prepare_workspace(
            "continued-task",
            &request("continued-task", &repo, "current"),
            Some(previous_with_session),
        )
        .unwrap_err();
    assert!(wrong.contains("Switch back to main"), "{wrong}");

    drop(runtime);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn ask_each_time_waits_for_the_person_and_honors_the_choice() {
    let root = std::env::temp_dir().join(format!("jackalope-ask-{}", uuid::Uuid::new_v4()));
    let repo = repository(&root);
    let runtime = TaskRuntime::new(root.join("history")).unwrap();
    running(&runtime, "asked-task", &repo);
    let answering = runtime.clone();
    let answer = std::thread::spawn(move || {
        for _ in 0..400 {
            let prompt = answering
                .run_snapshot("asked-task")
                .and_then(|run| run.prompts.first().cloned());
            if let Some(prompt) = prompt {
                assert_eq!(prompt.options.len(), 3);
                answering
                    .respond_prompt("asked-task", &prompt.id, "Isolated worktree")
                    .unwrap();
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        answering.update("asked-task", |run| run.status = RunStatus::Stopping);
        panic!("no workspace question was asked");
    });
    runtime
        .prepare_workspace("asked-task", &request("asked-task", &repo, "ask"), None)
        .unwrap();
    answer.join().unwrap();
    let run = runtime.run_snapshot("asked-task").unwrap();
    assert_ne!(run.workspace, repo);
    assert!(run.workspace.contains("fixture-asked"));
    assert_eq!(git(&repo, &["branch", "--show-current"]).unwrap(), "main");
    git(&repo, &["worktree", "remove", "--force", &run.workspace]).unwrap();

    // Stopping while the question is open stops without touching the checkout.
    running(&runtime, "stopped-task", &repo);
    let stopper = runtime.clone();
    let stop = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(200));
        stopper.update("stopped-task", |run| run.status = RunStatus::Stopping);
    });
    runtime
        .prepare_workspace("stopped-task", &request("stopped-task", &repo, "ask"), None)
        .unwrap();
    stop.join().unwrap();
    assert!(runtime
        .run_snapshot("stopped-task")
        .unwrap()
        .workspace
        .is_empty());

    drop(runtime);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn workspace_mode_overrides_isolation_only_when_present() {
    let legacy: RunRequest = serde_json::from_value(json!({
        "id": "x", "projectId": "p", "projectName": "P", "projectPath": ".",
        "agent": "codex", "prompt": "Fixture", "isolated": true,
    }))
    .unwrap();
    assert_eq!(legacy.workspace_mode, None);
    assert!(!serde_json::to_string(&legacy)
        .unwrap()
        .contains("workspaceMode"));
    let chosen = request("x", ".", "branch");
    assert_eq!(chosen.workspace_mode, Some(WorkspaceMode::Branch));
    for mode in ["worktree", "branch", "current", "ask"] {
        assert_eq!(WorkspaceMode::parse(mode).unwrap().as_str(), mode);
    }
    assert_eq!(WorkspaceMode::parse("cloud"), None);
}

/// A request that changes no code, whatever workspace the project would choose.
fn non_code(id: &str, path: &str) -> RunRequest {
    serde_json::from_value(json!({
        "id": id, "projectId": "p", "projectName": "P", "projectPath": path,
        "agent": "codex", "prompt": "Check the MCP connection", "isolated": true,
        "targetBranch": "main", "workspaceMode": "worktree", "nonCode": true,
        "prepareCommand": "git config jackalope.prepared yes",
    }))
    .unwrap()
}

#[test]
fn non_code_work_reads_the_checkout_without_a_worktree_or_preparation() {
    let root = std::env::temp_dir().join(format!("jackalope-noncode-{}", uuid::Uuid::new_v4()));
    let repo = repository(&root);
    let runtime = TaskRuntime::new(root.join("history")).unwrap();
    // The person is on another branch with their own edits; neither matters to it.
    git(&repo, &["checkout", "-b", "feature"]).unwrap();
    std::fs::write(Path::new(&repo).join("README.md"), "edited by the person").unwrap();

    running(&runtime, "first-look", &repo);
    runtime
        .prepare_workspace("first-look", &non_code("first-look", &repo), None)
        .unwrap();
    let run = runtime.run_snapshot("first-look").unwrap();
    assert_eq!(
        (run.workspace.as_str(), run.branch.as_str()),
        (repo.as_str(), "feature")
    );
    assert_eq!(run.base_head, git(&repo, &["rev-parse", "HEAD"]).unwrap());
    assert!(!Path::new(&repo).join(".worktrees").exists());
    assert_eq!(
        git(&repo, &["worktree", "list", "--porcelain"])
            .unwrap()
            .matches("worktree ")
            .count(),
        1
    );
    assert!(git(&repo, &["config", "--get", "jackalope.prepared"]).is_err());
    assert_eq!(
        git(&repo, &["branch", "--show-current"]).unwrap(),
        "feature"
    );
    assert_eq!(
        std::fs::read_to_string(Path::new(&repo).join("README.md")).unwrap(),
        "edited by the person"
    );

    // It does not hold the checkout: another non-code conversation and in-place work
    // can start beside it.
    runtime.update("first-look", |run| run.non_code = true);
    running(&runtime, "second-look", &repo);
    runtime
        .prepare_workspace("second-look", &non_code("second-look", &repo), None)
        .unwrap();
    runtime.update("second-look", |run| run.non_code = true);
    git(&repo, &["checkout", "main"]).unwrap();
    running(&runtime, "in-place-task", &repo);
    runtime
        .prepare_workspace(
            "in-place-task",
            &request("in-place-task", &repo, "current"),
            None,
        )
        .unwrap();
    assert_eq!(
        runtime.run_snapshot("in-place-task").unwrap().workspace,
        repo
    );

    // A plain folder stays one, and still skips preparation.
    let folder = root.join("notes");
    std::fs::create_dir_all(&folder).unwrap();
    let folder = dunce::canonicalize(folder)
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let mut plain = non_code("plain-folder", &folder);
    plain.prepare_command = Some("touch prepared".into());
    running(&runtime, "plain-folder", &folder);
    runtime
        .prepare_workspace("plain-folder", &plain, None)
        .unwrap();
    assert_eq!(
        runtime.run_snapshot("plain-folder").unwrap().workspace,
        folder
    );
    assert!(!Path::new(&folder).join("prepared").exists());
    assert!(!Path::new(&folder).join(".git").exists());

    drop(runtime);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn non_code_is_absent_from_saved_requests_that_never_set_it() {
    let legacy = request("x", ".", "current");
    assert!(!legacy.non_code);
    assert!(!serde_json::to_string(&legacy).unwrap().contains("nonCode"));
    assert!(non_code("x", ".").non_code);
}
