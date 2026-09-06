use super::{
    git::{list_worktrees, WorktreeEntry},
    tasks::{TaskRun, TaskRuntime},
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::{Command, Output},
};
use tauri::State;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CleanupStatus {
    pub target_branch: Option<String>,
    pub target_head: Option<String>,
    pub merged: Option<bool>,
    pub blocked_reason: Option<String>,
}

pub(super) fn command(path: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(path)
        .args(args)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_NO_REPLACE_OBJECTS", "1");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd
}

fn output(path: &Path, args: &[&str]) -> Result<Output, String> {
    command(path, args).output().map_err(|e| e.to_string())
}

fn git(path: &Path, args: &[&str]) -> Result<String, String> {
    let result = output(path, args)?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).trim().to_string());
    }
    String::from_utf8(result.stdout).map_err(|e| e.to_string())
}

fn canonical(path: &str) -> Result<PathBuf, String> {
    std::fs::canonicalize(path).map_err(|e| format!("Cannot inspect {path}: {e}"))
}

fn target(repo: &Path, requested: Option<&str>) -> Result<(String, String), String> {
    let candidates = match requested {
        Some("main") => vec!["main"],
        Some("master") => vec!["master"],
        Some(_) => return Err("Choose main or master for cleanup.".into()),
        None => vec!["main", "master"],
    };
    for branch in candidates {
        if let Ok(head) = git(
            repo,
            &[
                "rev-parse",
                "--verify",
                &format!("refs/heads/{branch}^{{commit}}"),
            ],
        ) {
            return Ok((branch.into(), head.trim().into()));
        }
    }
    Err("No committed local target branch found. Choose an existing main or master branch.".into())
}

fn protection(
    repo: &Path,
    entries: &[WorktreeEntry],
    index: usize,
    runs: &[TaskRun],
) -> Result<(), String> {
    let wt = &entries[index];
    if index == 0 || wt.is_bare {
        return Err("Primary repository — kept.".into());
    }
    if wt.is_locked {
        return Err("Locked worktree — unlock it before cleanup.".into());
    }
    if ["main", "master"].contains(&wt.branch.as_str()) {
        return Err("Main branch checkout — kept.".into());
    }
    let path = canonical(&wt.path)?;
    if repo.starts_with(&path) {
        return Err("Current project folder — kept.".into());
    }
    for other in entries.iter().filter(|other| other.path != wt.path) {
        if canonical(&other.path).is_ok_and(|other| other.starts_with(&path)) {
            return Err("Contains another worktree — kept.".into());
        }
    }
    for run in runs.iter().filter(|run| {
        ["starting", "running", "stopping", "interrupted"].contains(&run.status.as_str())
    }) {
        let workspace = canonical(&run.workspace)?;
        if workspace.starts_with(&path) || path.starts_with(&workspace) {
            return Err("In use by an active or interrupted task.".into());
        }
    }
    let root = git(&path, &["rev-parse", "--show-toplevel"])?;
    if canonical(root.trim())? != path {
        return Err("Worktree folder no longer matches its Git registration.".into());
    }
    let common = |dir: &Path| -> Result<PathBuf, String> {
        canonical(
            git(
                dir,
                &["rev-parse", "--path-format=absolute", "--git-common-dir"],
            )?
            .trim(),
        )
    };
    if common(repo)? != common(&path)? {
        return Err("Worktree belongs to a different repository.".into());
    }
    let files = git(&path, &["ls-files", "-v", "-z"])?;
    if files
        .split('\0')
        .filter(|s| !s.is_empty())
        .any(|s| !s.starts_with("H "))
    {
        return Err("Index has hidden or unresolved changes; review it before cleanup.".into());
    }
    let index = git(&path, &["ls-files", "--stage", "-z"])?;
    if index.split('\0').any(|s| s.starts_with("160000 ")) {
        return Err("Contains submodules; review and remove this worktree manually.".into());
    }
    let status = git(
        &path,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignored",
            "--ignore-submodules=none",
        ],
    )?;
    if !status.is_empty() {
        return Err(
            "Local changes or untracked/ignored files — review or move them before cleanup.".into(),
        );
    }
    Ok(())
}

pub(super) fn inspect(
    repo_path: &str,
    requested: Option<&str>,
    runs: &[TaskRun],
) -> Result<Vec<WorktreeEntry>, String> {
    let repo = canonical(repo_path)?;
    let mut entries = list_worktrees(repo_path)?;
    let target = target(&repo, requested);
    for index in 0..entries.len() {
        let mut status = CleanupStatus {
            target_branch: None,
            target_head: None,
            merged: None,
            blocked_reason: None,
        };
        match &target {
            Ok((branch, head)) => {
                status.target_branch = Some(branch.clone());
                status.target_head = Some(head.clone());
                match output(
                    &repo,
                    &["merge-base", "--is-ancestor", &entries[index].head, head],
                ) {
                    Ok(result) if result.status.success() => status.merged = Some(true),
                    Ok(result) if result.status.code() == Some(1) => {
                        status.merged = Some(false);
                        status.blocked_reason = Some(format!("Commits are not merged into {branch}; squash/rebase merges need manual review."));
                    }
                    _ => status.blocked_reason = Some("Could not verify commit ancestry.".into()),
                }
            }
            Err(error) => status.blocked_reason = Some(error.clone()),
        }
        if let Err(reason) = protection(&repo, &entries, index, runs) {
            status.blocked_reason = Some(reason);
        }
        entries[index].cleanup = Some(status);
    }
    Ok(entries)
}

fn remove(
    repo_path: &str,
    worktree_path: &str,
    target_branch: &str,
    expected_head: &str,
    expected_target_head: &str,
    runs: &[TaskRun],
) -> Result<(), String> {
    let entries = inspect(repo_path, Some(target_branch), runs)?;
    let wt = entries
        .iter()
        .find(|wt| wt.path == worktree_path)
        .ok_or("Worktree is no longer registered. Refresh the list.")?;
    let status = wt.cleanup.as_ref().ok_or("Refresh the worktree status.")?;
    if wt.head != expected_head || status.target_head.as_deref() != Some(expected_target_head) {
        return Err(
            "The worktree or target branch changed. Refresh and review its status again.".into(),
        );
    }
    if let Some(reason) = &status.blocked_reason {
        return Err(reason.clone());
    }
    if status.merged != Some(true) {
        return Err("All commits must be merged before cleanup.".into());
    }
    if git(Path::new(worktree_path), &["rev-parse", "HEAD"])?.trim() != expected_head
        || target(Path::new(repo_path), Some(target_branch))?.1 != expected_target_head
    {
        return Err(
            "The worktree or target branch changed. Refresh and review its status again.".into(),
        );
    }
    git(
        Path::new(repo_path),
        &["worktree", "remove", "--", worktree_path],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn git_cleanup_worktree(
    repo_path: String,
    worktree_path: String,
    target_branch: String,
    expected_head: String,
    expected_target_head: String,
    state: State<'_, TaskRuntime>,
) -> Result<(), String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = super::integration::execution_guard()?;
        let runs = runtime.integration_runs()?;
        if runs.iter().any(|run| run.persistence_error.is_some()) {
            return Err("Save pending task history before cleaning up worktrees.".into());
        }
        remove(
            &repo_path,
            &worktree_path,
            &target_branch,
            &expected_head,
            &expected_target_head,
            &runs,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Fixture {
        root: PathBuf,
        repo: PathBuf,
        worktree: PathBuf,
    }
    impl Fixture {
        fn new(branch: &str) -> Self {
            let root =
                std::env::temp_dir().join(format!("jackalope-cleanup-{}", uuid::Uuid::new_v4()));
            let repo = root.join("project");
            let worktree = root.join("finished work");
            fs::create_dir_all(&repo).unwrap();
            git(&repo, &["init", "--initial-branch", branch]).unwrap();
            git(&repo, &["config", "user.name", "Cleanup Test"]).unwrap();
            git(&repo, &["config", "user.email", "cleanup@example.test"]).unwrap();
            fs::write(repo.join("file.txt"), "initial\n").unwrap();
            fs::write(repo.join(".gitignore"), ".env\nignored/\n").unwrap();
            git(&repo, &["add", "."]).unwrap();
            git(&repo, &["commit", "-m", "fixture"]).unwrap();
            git(
                &repo,
                &[
                    "worktree",
                    "add",
                    "-b",
                    "feature",
                    worktree.to_str().unwrap(),
                ],
            )
            .unwrap();
            Self {
                root,
                repo,
                worktree,
            }
        }
        fn entries(&self, runs: &[TaskRun]) -> Vec<WorktreeEntry> {
            inspect(self.repo.to_str().unwrap(), None, runs).unwrap()
        }
        fn entry(&self) -> WorktreeEntry {
            self.entries(&[]).remove(1)
        }
        fn remove(&self, entry: &WorktreeEntry, runs: &[TaskRun]) -> Result<(), String> {
            let status = entry.cleanup.as_ref().unwrap();
            remove(
                self.repo.to_str().unwrap(),
                &entry.path,
                status.target_branch.as_deref().unwrap_or("main"),
                &entry.head,
                status.target_head.as_deref().unwrap_or(""),
                runs,
            )
        }
        fn commit(&self, path: &Path, text: &str) {
            fs::write(path.join("file.txt"), text).unwrap();
            git(path, &["add", "."]).unwrap();
            git(path, &["commit", "-m", "change"]).unwrap();
        }
        fn run(&self, status: &str) -> TaskRun {
            serde_json::from_value(serde_json::json!({
                "id":"run-fixture", "taskId":"task-fixture", "projectId":"fixture", "projectName":"Fixture", "projectPath":self.repo,
                "workspace":self.worktree, "branch":"feature", "baseHead":"", "agent":"codex", "account":"test", "model":null,
                "prompt":"test", "status":status, "startedAt":"2026-09-06T00:00:00Z", "endedAt":null, "sessionId":null,
                "result":"", "activity":[], "error":null, "persistenceError":null, "exitCode":null,
                "usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"reported":false,"estimatedCostUsd":null}
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
                    .starts_with("jackalope-cleanup-")
            {
                let _ = fs::remove_dir_all(&self.root);
            }
        }
    }

    #[test]
    fn merged_main_and_master_cleanup_keeps_branch_and_primary() {
        for branch in ["main", "master"] {
            let f = Fixture::new(branch);
            f.commit(&f.worktree, "merged\n");
            git(&f.repo, &["merge", "--ff-only", "feature"]).unwrap();
            let entries = f.entries(&[]);
            assert!(entries[0]
                .cleanup
                .as_ref()
                .unwrap()
                .blocked_reason
                .as_ref()
                .unwrap()
                .contains("Primary"));
            assert!(f.remove(&entries[0], &[]).is_err());
            let wt = &entries[1];
            assert_eq!(wt.cleanup.as_ref().unwrap().merged, Some(true));
            assert_eq!(wt.cleanup.as_ref().unwrap().blocked_reason, None);
            f.remove(wt, &[]).unwrap();
            assert!(!f.worktree.exists());
            assert!(f.repo.exists());
            git(&f.repo, &["show-ref", "--verify", "refs/heads/feature"]).unwrap();
            assert_eq!(f.entries(&[]).len(), 1);
        }
    }

    #[test]
    fn unmerged_and_squashed_commits_are_kept() {
        let f = Fixture::new("main");
        f.commit(&f.worktree, "unmerged\n");
        assert_eq!(f.entry().cleanup.as_ref().unwrap().merged, Some(false));
        assert!(f.remove(&f.entry(), &[]).is_err());
        f.commit(&f.repo, "unmerged\n");
        git(&f.repo, &["commit", "--amend", "-m", "squash merge"]).unwrap();
        assert!(f.remove(&f.entry(), &[]).is_err());
        assert!(f.worktree.exists());
    }

    #[test]
    fn dirty_untracked_ignored_and_hidden_index_files_block_even_after_listing() {
        for kind in [
            "unstaged",
            "staged",
            "untracked",
            "ignored",
            "assume-unchanged",
            "skip-worktree",
        ] {
            let f = Fixture::new("main");
            let before = f.entry();
            match kind {
                "untracked" => fs::write(f.worktree.join("new.txt"), "keep").unwrap(),
                "ignored" => fs::write(f.worktree.join(".env"), "keep").unwrap(),
                _ => {
                    fs::write(f.worktree.join("file.txt"), "keep").unwrap();
                    match kind {
                        "staged" => {
                            git(&f.worktree, &["add", "file.txt"]).unwrap();
                        }
                        "assume-unchanged" => {
                            git(
                                &f.worktree,
                                &["update-index", "--assume-unchanged", "file.txt"],
                            )
                            .unwrap();
                        }
                        "skip-worktree" => {
                            git(
                                &f.worktree,
                                &["update-index", "--skip-worktree", "file.txt"],
                            )
                            .unwrap();
                        }
                        _ => {}
                    }
                }
            }
            assert!(
                f.entry().cleanup.as_ref().unwrap().blocked_reason.is_some(),
                "{kind}"
            );
            assert!(f.remove(&before, &[]).is_err(), "{kind}");
            assert!(f.worktree.exists());
        }
    }

    #[test]
    fn locks_missing_paths_and_foreign_paths_are_kept() {
        let f = Fixture::new("main");
        let before = f.entry();
        git(&f.repo, &["worktree", "lock", f.worktree.to_str().unwrap()]).unwrap();
        assert!(f.remove(&before, &[]).unwrap_err().contains("Locked"));
        git(
            &f.repo,
            &["worktree", "unlock", f.worktree.to_str().unwrap()],
        )
        .unwrap();
        let moved = f.root.join("moved");
        fs::rename(&f.worktree, &moved).unwrap();
        assert!(f.remove(&before, &[]).is_err());
        let mut foreign = before;
        foreign.path = moved.to_str().unwrap().into();
        assert!(f.remove(&foreign, &[]).unwrap_err().contains("registered"));
        assert!(moved.exists());
    }

    #[test]
    fn active_and_interrupted_tasks_block_cleanup_but_finished_history_remains() {
        let f = Fixture::new("main");
        let before = f.entry();
        for status in ["starting", "running", "stopping", "interrupted"] {
            assert!(f
                .remove(&before, &[f.run(status)])
                .unwrap_err()
                .contains("active or interrupted"));
        }
        let runs = [f.run("review")];
        f.remove(&before, &runs).unwrap();
        assert_eq!(runs[0].status, "review");
    }

    #[test]
    fn changed_heads_and_missing_target_refuse_stale_cleanup() {
        let f = Fixture::new("main");
        let before = f.entry();
        f.commit(&f.repo, "target advanced\n");
        assert!(f.remove(&before, &[]).unwrap_err().contains("changed"));
        let before = f.entry();
        git(&f.worktree, &["merge", "--ff-only", "main"]).unwrap();
        assert!(f.remove(&before, &[]).unwrap_err().contains("changed"));
        git(&f.repo, &["branch", "-m", "trunk"]).unwrap();
        assert_eq!(f.entry().cleanup.as_ref().unwrap().merged, None);
        assert!(f.remove(&before, &[]).is_err());
    }

    #[test]
    fn detached_worktrees_and_explicit_target_selection() {
        let f = Fixture::new("master");
        git(&f.worktree, &["checkout", "--detach"]).unwrap();
        git(&f.repo, &["branch", "main"]).unwrap();
        let wt = f.entry();
        assert!(wt.branch.is_empty());
        assert_eq!(
            wt.cleanup.as_ref().unwrap().target_branch.as_deref(),
            Some("main")
        );
        let explicit = inspect(f.repo.to_str().unwrap(), Some("master"), &[]).unwrap();
        assert_eq!(
            explicit[1]
                .cleanup
                .as_ref()
                .unwrap()
                .target_branch
                .as_deref(),
            Some("master")
        );
        f.remove(&wt, &[]).unwrap();
    }

    #[test]
    fn opened_linked_project_is_never_removed() {
        let f = Fixture::new("main");
        let entries = inspect(f.worktree.to_str().unwrap(), None, &[]).unwrap();
        assert!(entries[1]
            .cleanup
            .as_ref()
            .unwrap()
            .blocked_reason
            .as_ref()
            .unwrap()
            .contains("Current project"));
        assert!(remove(
            f.worktree.to_str().unwrap(),
            &entries[1].path,
            "main",
            &entries[1].head,
            &entries[1].head,
            &[]
        )
        .is_err());
    }
}
