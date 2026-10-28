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
    run.status = "running".into();
    run.project_path = repo.into();
    run.workspace.clear();
    runtime.inner.lock().unwrap().runs.insert(id.into(), run);
}

#[test]
fn in_place_modes_hold_the_checkout_and_never_discard_changes() {
    let root = std::env::temp_dir().join(format!("jackalope-modes-{}", uuid::Uuid::new_v4()));
    let repo = repository(&root);
    let readme = Path::new(&repo).join("README.md");
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();

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
    runtime.update("branch-task", |run| run.status = "review".into());
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
    runtime.update("second-task", |run| run.status = "review".into());
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
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
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
        answering.update("asked-task", |run| run.status = "stopping".into());
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
        stopper.update("stopped-task", |run| run.status = "stopping".into());
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
