use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorktreeEntry {
    pub path: String,
    pub head: String,
    pub branch: String,
    pub is_bare: bool,
    pub is_locked: bool,
}

#[tauri::command]
pub async fn git_list_worktrees(repo_path: String) -> Result<Vec<WorktreeEntry>, String> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Git worktree list error: {}", err));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut worktrees = Vec::new();
    let mut current_path = String::new();
    let mut current_head = String::new();
    let mut current_branch = String::new();
    let mut is_bare = false;
    let mut is_locked = false;

    for line in stdout.lines() {
        if line.starts_with("worktree ") {
            if !current_path.is_empty() {
                worktrees.push(WorktreeEntry {
                    path: current_path.clone(),
                    head: current_head.clone(),
                    branch: current_branch.clone(),
                    is_bare,
                    is_locked,
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
        });
    }

    Ok(worktrees)
}

#[tauri::command]
pub async fn git_create_worktree(
    repo_path: String,
    worktree_path: String,
    branch_name: String,
    base_commit: Option<String>,
) -> Result<WorktreeEntry, String> {
    let mut args = vec!["worktree", "add", "-b", &branch_name, &worktree_path];
    if let Some(ref base) = base_commit {
        args.push(base);
    }

    let output = Command::new("git")
        .args(&args)
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to spawn git worktree add: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Worktree creation failed: {}", err));
    }

    // `base_commit` (when given) is whatever ref the caller asked to branch
    // from — a branch name, a tag, "HEAD", a short hash — not necessarily the
    // worktree's actual resulting commit. Resolve the real HEAD of the new
    // worktree directly instead of echoing that input back.
    let full_worktree_path = Path::new(&repo_path).join(&worktree_path);
    let head_output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&full_worktree_path)
        .output()
        .map_err(|e| format!("Worktree created, but failed to resolve its HEAD: {}", e))?;

    if !head_output.status.success() {
        let err = String::from_utf8_lossy(&head_output.stderr);
        return Err(format!("Worktree created, but `git rev-parse HEAD` failed: {}", err));
    }

    let head = String::from_utf8_lossy(&head_output.stdout).trim().to_string();

    Ok(WorktreeEntry {
        path: worktree_path,
        head,
        branch: branch_name,
        is_bare: false,
        is_locked: false,
    })
}

#[cfg(test)]
mod tests {
    //! Exercises `git_create_worktree` against a real, disposable git repo —
    //! proves the returned `head` is the worktree's actual resolved commit,
    //! not an echo of whatever `base_commit` string was passed in (the bug
    //! this module used to have: `head: base_commit.unwrap_or("HEAD")`).
    use super::*;
    use std::fs;

    fn run(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(dir)
            .status()
            .expect("failed to run git");
        assert!(status.success(), "git {:?} failed in {:?}", args, dir);
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
            // Deliberately pass a non-hash ref as base_commit: the exact old
            // bug (`head: base_commit.unwrap_or_else(|| "HEAD".to_string())`)
            // would return the literal string "HEAD" here instead of a real hash.
            Some("HEAD".to_string()),
        )
        .await
        .expect("git_create_worktree should succeed");

        assert_ne!(
            result.head, "HEAD",
            "head must be the resolved commit, not the base_commit string echoed back"
        );
        assert_eq!(
            result.head.len(),
            40,
            "head should be a full git SHA-1 hex hash, got {:?}",
            result.head
        );
        assert!(
            result.head.chars().all(|c| c.is_ascii_hexdigit()),
            "head should be hex, got {:?}",
            result.head
        );

        let _ = fs::remove_dir_all(&repo);
    }
}
