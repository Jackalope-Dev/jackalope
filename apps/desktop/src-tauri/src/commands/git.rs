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

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::git::git_list_worktrees,
            commands::git::git_create_worktree,
            commands::git::git_list_branches,
            commands::git::git_switch_branch,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

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

/// A project checkout's branches for the branch picker, most recently committed first.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchList {
    /// Empty on a detached HEAD.
    pub current: String,
    /// Uncommitted changes to tracked files, which keep the checkout on its branch.
    pub changed: bool,
    pub local: Vec<LocalBranch>,
    /// Remote branches without a local branch of the same name, as `remote/name`.
    pub remote: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBranch {
    pub name: String,
    /// Another worktree that has this branch checked out; Git will not check it out twice.
    pub worktree: Option<String>,
}

/// Enough for any picker; filtering happens on the list Git sorted by recency.
const MAX_BRANCHES: usize = 500;

#[tauri::command]
pub async fn git_list_branches(repo_path: String) -> Result<BranchList, String> {
    tauri::async_runtime::spawn_blocking(move || list_branches(Path::new(&repo_path)))
        .await
        .map_err(|e| e.to_string())?
}

fn list_branches(repo: &Path) -> Result<BranchList, String> {
    let current = repo::git(repo, &["branch", "--show-current"], Policy::Inspection)?;
    let changed = repo::is_dirty(repo, repo::Untracked::No, Policy::Inspection)?;
    let refs = repo::git(
        repo,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname)%00%(worktreepath)",
            "refs/heads",
            "refs/remotes",
        ],
        Policy::Inspection,
    )?;
    let mut local = Vec::new();
    let mut remote = Vec::new();
    for line in refs.lines() {
        let (name, worktree) = line.split_once('\0').unwrap_or((line, ""));
        if let Some(name) = name.strip_prefix("refs/heads/") {
            local.push(LocalBranch {
                name: name.to_string(),
                worktree: (name != current && !worktree.is_empty()).then(|| worktree.to_string()),
            });
        } else if let Some(name) = name.strip_prefix("refs/remotes/") {
            if !name.ends_with("/HEAD") {
                remote.push(name.to_string());
            }
        }
    }
    remote.retain(|name| {
        let short = name.split_once('/').map_or(name.as_str(), |(_, short)| short);
        !local.iter().any(|branch| branch.name == short)
    });
    local.truncate(MAX_BRANCHES);
    remote.truncate(MAX_BRANCHES.saturating_sub(local.len()));
    Ok(BranchList {
        current,
        changed,
        local,
        remote,
    })
}

/// Switches the project checkout to a local or remote branch, or creates a branch at
/// the current commit. A new branch keeps uncommitted changes, since no file changes;
/// another branch needs a clean checkout so changes are never carried over or lost.
/// It holds the execution guard and refuses while a task works in the checkout.
#[tauri::command]
pub async fn git_switch_branch(
    repo_path: String,
    branch: String,
    create: bool,
    state: tauri::State<'_, super::tasks::TaskRuntime>,
) -> Result<String, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = super::integration::execution_guard()?;
        switch_branch(
            Path::new(&repo_path),
            branch.trim(),
            create,
            &runtime.integration_runs()?,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

fn switch_branch(
    repo: &Path,
    branch: &str,
    create: bool,
    runs: &[super::tasks::TaskRun],
) -> Result<String, String> {
    if branch.is_empty() || branch.starts_with('-') {
        return Err("Enter a branch name.".into());
    }
    let root = repo::git(repo, &["rev-parse", "--show-toplevel"], Policy::Isolated)?;
    let canonical = |path: &str| dunce::canonicalize(path).ok();
    let target = canonical(&root);
    if runs.iter().any(|run| {
        run.status.is_active()
            && !run.workspace.is_empty()
            && (Path::new(&run.workspace) == Path::new(&root)
                || target.is_some() && canonical(&run.workspace) == target)
    }) {
        return Err(
            "A task is working in the project checkout. Wait for it to finish before switching branches."
                .into(),
        );
    }
    let root = Path::new(&root);
    let exists = |reference: &str| {
        repo::succeeds(
            root,
            &["rev-parse", "--verify", "--quiet", reference],
            Policy::Isolated,
        )
    };
    let clean = || {
        if repo::is_dirty(root, repo::Untracked::No, Policy::Isolated)? {
            return Err("The project checkout has uncommitted changes. Commit them, or create a new branch to take them with you, before switching.".to_string());
        }
        Ok(())
    };
    if create {
        let name = repo::git(
            root,
            &["check-ref-format", "--branch", branch],
            Policy::Isolated,
        )
        .map_err(|_| format!("{branch} is not a valid branch name."))?;
        if exists(&format!("refs/heads/{name}")) {
            return Err(format!("A branch named {name} already exists."));
        }
        super::delivery::change(root, &["switch", "-c", &name])?;
    } else if exists(&format!("refs/heads/{branch}")) {
        clean()?;
        super::delivery::change(root, &["switch", "--no-guess", branch])?;
    } else if exists(&format!("refs/remotes/{branch}")) {
        clean()?;
        super::delivery::change(root, &["switch", "--track", branch])?;
    } else {
        return Err(format!("There is no branch named {branch}."));
    }
    repo::git(root, &["branch", "--show-current"], Policy::Isolated)
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

    fn branch_repo() -> std::path::PathBuf {
        let repo = std::env::temp_dir().join(format!("jackalope-branches-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&repo).unwrap();
        run(&repo, &["init", "-q", "-b", "main"]);
        run(&repo, &["config", "user.email", "test@example.com"]);
        run(&repo, &["config", "user.name", "Test"]);
        fs::write(repo.join("README.md"), "hello").unwrap();
        run(&repo, &["add", "."]);
        run(&repo, &["commit", "-q", "-m", "initial"]);
        repo
    }

    fn current(repo: &Path) -> String {
        repo::git(repo, &["branch", "--show-current"], Policy::Isolated).unwrap()
    }

    #[test]
    fn a_new_branch_takes_changes_along_but_another_branch_needs_a_clean_checkout() {
        let repo = branch_repo();
        run(&repo, &["branch", "other"]);
        fs::write(repo.join("README.md"), "edited").unwrap();

        let refused = switch_branch(&repo, "other", false, &[]).unwrap_err();
        assert!(refused.contains("uncommitted changes"), "{refused}");
        assert_eq!(current(&repo), "main");

        assert_eq!(switch_branch(&repo, "feature/new", true, &[]).unwrap(), "feature/new");
        assert_eq!(fs::read_to_string(repo.join("README.md")).unwrap(), "edited");
        assert!(switch_branch(&repo, "other", true, &[])
            .unwrap_err()
            .contains("already exists"));
        assert!(switch_branch(&repo, "bad..name", true, &[]).is_err());
        assert!(switch_branch(&repo, "-f", false, &[]).is_err());

        run(&repo, &["commit", "-qam", "edit"]);
        assert_eq!(switch_branch(&repo, "other", false, &[]).unwrap(), "other");
        assert_eq!(fs::read_to_string(repo.join("README.md")).unwrap(), "hello");
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn remote_branches_check_out_as_tracking_branches_and_listing_marks_other_worktrees() {
        let repo = branch_repo();
        run(&repo, &["remote", "add", "origin", "https://example.invalid/repo.git"]);
        run(&repo, &["update-ref", "refs/remotes/origin/shared", "HEAD"]);
        run(&repo, &["update-ref", "refs/remotes/origin/main", "HEAD"]);
        run(&repo, &["worktree", "add", "-q", "-b", "task", ".worktrees/task"]);

        let list = list_branches(&repo).unwrap();
        assert_eq!(list.current, "main");
        assert!(!list.changed);
        assert_eq!(list.remote, vec!["origin/shared".to_string()]);
        assert!(list.local.iter().any(|b| b.name == "main" && b.worktree.is_none()));
        assert!(list
            .local
            .iter()
            .any(|b| b.name == "task" && b.worktree.as_deref().is_some_and(|p| p.ends_with("task"))));

        assert_eq!(switch_branch(&repo, "origin/shared", false, &[]).unwrap(), "shared");
        assert_eq!(
            repo::git(&repo, &["rev-parse", "--abbrev-ref", "@{upstream}"], Policy::Isolated).unwrap(),
            "origin/shared"
        );
        assert!(switch_branch(&repo, "missing", false, &[]).is_err());
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn switching_waits_for_a_task_working_in_the_checkout() {
        let repo = branch_repo();
        run(&repo, &["branch", "other"]);
        let active = super::super::tasks::TaskRun {
            workspace: repo.to_string_lossy().into_owned(),
            status: crate::cli_protocol::RunStatus::Running,
            ..Default::default()
        };
        assert!(switch_branch(&repo, "other", false, &[active])
            .unwrap_err()
            .contains("A task is working"));
        assert_eq!(current(&repo), "main");
        let _ = fs::remove_dir_all(&repo);
    }
}
