use super::repo::{self, Policy};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorktreeEntry {
    pub path: String,
    pub head: String,
    pub branch: String,
    pub is_bare: bool,
    pub is_locked: bool,
    #[serde(default)]
    pub cleanup: Option<super::worktree_cleanup::CleanupStatus>,
}

#[tauri::command]
pub async fn git_list_worktrees(
    repo_path: String,
    target_branch: Option<String>,
    inspect_cleanup: Option<bool>,
    state: tauri::State<'_, super::tasks::TaskRuntime>,
) -> Result<Vec<WorktreeEntry>, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if inspect_cleanup == Some(false) {
            return list_worktrees(&repo_path);
        }
        let _guard = super::integration::execution_guard()?;
        super::worktree_cleanup::inspect(
            &repo_path,
            target_branch.as_deref(),
            &runtime.integration_runs()?,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(super) fn list_worktrees(repo_path: &str) -> Result<Vec<WorktreeEntry>, String> {
    let stdout = repo::git_exact(
        Path::new(repo_path),
        &["worktree", "list", "--porcelain", "-z"],
        Policy::Inspection,
    )
    .map_err(|error| format!("Git worktree list error: {error}"))?;
    let mut worktrees = Vec::new();
    let mut current_path = String::new();
    let mut current_head = String::new();
    let mut current_branch = String::new();
    let mut is_bare = false;
    let mut is_locked = false;

    for line in stdout.split('\0') {
        if line.starts_with("worktree ") {
            if !current_path.is_empty() {
                worktrees.push(WorktreeEntry {
                    path: current_path.clone(),
                    head: current_head.clone(),
                    branch: current_branch.clone(),
                    is_bare,
                    is_locked,
                    cleanup: None,
                });
                current_head.clear();
                current_branch.clear();
                is_bare = false;
                is_locked = false;
            }
            current_path = line.trim_start_matches("worktree ").to_string();
        } else if line.starts_with("HEAD ") {
            current_head = line.trim_start_matches("HEAD ").to_string();
        } else if line.starts_with("branch ") {
            current_branch = line.trim_start_matches("branch refs/heads/").to_string();
        } else if line == "bare" {
            is_bare = true;
        } else if line.starts_with("locked") {
            is_locked = true;
        }
    }

    if !current_path.is_empty() {
        worktrees.push(WorktreeEntry {
            path: current_path,
            head: current_head,
            branch: current_branch,
            is_bare,
            is_locked,
            cleanup: None,
        });
    }

    Ok(worktrees)
}

/// The worktree folder comes from user input and `git worktree add` accepts
/// any path relative to the repository, so anything that could leave it is refused.
fn relative_and_contained(path: &str) -> Result<(), String> {
    let contained = !path.starts_with(['/', '\\'])
        && super::scope_path::ScopePath::parse(path).is_some_and(|path| !path.is_root());
    if !contained {
        return Err(
            "Worktree path must be a relative path inside the repository, without parent-directory references."
                .into(),
        );
    }
    Ok(())
}

/// Adds a worktree on a new branch. Like every other worktree change it holds
/// the execution guard, so it cannot race integration or cleanup.
#[tauri::command]
pub async fn git_create_worktree(
    repo_path: String,
    worktree_path: String,
    branch_name: String,
    base_commit: Option<String>,
) -> Result<WorktreeEntry, String> {
    relative_and_contained(&worktree_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = super::integration::execution_guard()?;
        let repo_path = Path::new(&repo_path);
        let mut args = vec!["worktree", "add", "-b", &branch_name, &worktree_path];
        if let Some(base) = &base_commit {
            args.push(base);
        }
        repo::git(repo_path, &args, Policy::Isolated)
            .map_err(|error| format!("Worktree creation failed: {error}"))?;
        // `base_commit` may be any ref, so report the commit the worktree resolved to.
        let head = repo::git(
            &repo_path.join(&worktree_path),
            &["rev-parse", "HEAD"],
            Policy::Isolated,
        )
        .map_err(|error| format!("Worktree created, but its HEAD could not be read: {error}"))?;
        Ok(WorktreeEntry {
            path: worktree_path,
            head,
            branch: branch_name,
            is_bare: false,
            is_locked: false,
            cleanup: None,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn run(dir: &Path, args: &[&str]) {
        repo::git(dir, args, Policy::Isolated)
            .unwrap_or_else(|error| panic!("git {args:?} failed in {dir:?}: {error}"));
    }

    #[tokio::test]
    async fn worktree_head_is_the_real_resolved_commit_not_the_base_commit_string() {
        let repo = std::env::temp_dir().join(format!(
            "jackalope-git-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&repo).unwrap();

        run(&repo, &["init", "-q"]);
        run(&repo, &["config", "user.email", "test@example.com"]);
        run(&repo, &["config", "user.name", "Test"]);
        fs::write(repo.join("README.md"), "hello").unwrap();
        run(&repo, &["add", "."]);
        run(&repo, &["commit", "-q", "-m", "initial"]);

        let repo_path = repo.to_string_lossy().to_string();

        let result = git_create_worktree(
            repo_path.clone(),
            ".worktrees/test-branch".to_string(),
            "feat/test-branch".to_string(),
            Some("HEAD".to_string()),
        )
        .await
        .expect("git_create_worktree should succeed");

        assert_eq!(
            result.head,
            repo::git(&repo, &["rev-parse", "HEAD"], Policy::Isolated).unwrap(),
            "head must be the resolved commit, not the base_commit string echoed back"
        );

        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn relative_and_contained_rejects_every_escape_shape() {
        for path in [
            "../outside",
            ".worktrees/../../outside",
            "/etc/passwd",
            "\\Windows\\System32",
            "C:/outside",
            "",
            ".worktrees//double-slash",
        ] {
            assert!(
                relative_and_contained(path).is_err(),
                "expected {path:?} to be rejected"
            );
        }
        for path in [".worktrees/task-123", "task-123", "nested/task-123"] {
            assert!(
                relative_and_contained(path).is_ok(),
                "expected {path:?} to be accepted"
            );
        }
    }

    #[tokio::test]
    async fn worktree_creation_refuses_a_traversal_attempt_and_creates_nothing_outside_the_repo() {
        let root = std::env::temp_dir().join(format!(
            "jackalope-git-traversal-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let repo = root.join("repo");
        let escape_target = root.join("outside-the-repo");
        fs::create_dir_all(&repo).unwrap();

        run(&repo, &["init", "-q"]);
        run(&repo, &["config", "user.email", "test@example.com"]);
        run(&repo, &["config", "user.name", "Test"]);
        fs::write(repo.join("README.md"), "hello").unwrap();
        run(&repo, &["add", "."]);
        run(&repo, &["commit", "-q", "-m", "initial"]);

        let repo_path = repo.to_string_lossy().to_string();
        // Relative traversal out of the repo, landing exactly on a sibling
        // directory name we can check was never created.
        let traversal = "../outside-the-repo".to_string();

        let result =
            git_create_worktree(repo_path, traversal, "feat/escape".to_string(), None).await;

        assert!(result.is_err(), "a traversal attempt must be rejected");
        assert!(
            !escape_target.exists(),
            "no worktree should ever be created outside the repository"
        );

        let _ = fs::remove_dir_all(&root);
    }
}
