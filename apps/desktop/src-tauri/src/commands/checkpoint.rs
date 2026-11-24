use super::{
    integration, project_git,
    repo::{self, Policy::Inspection, Seed},
    tasks::TaskRun,
};
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub head: String,
    pub message: String,
}

pub(super) fn suggested_message(run: &TaskRun) -> String {
    let explicit = run
        .result
        .lines()
        .find_map(|line| line.trim().strip_prefix("Commit message:"));
    let summary = explicit
        .or_else(|| {
            run.result.lines().find(|line| {
                let line = line.trim();
                !line.is_empty() && !line.starts_with('#') && !line.starts_with("```")
            })
        })
        .unwrap_or(&run.prompt);
    let summary: String = summary
        .trim()
        .trim_matches(['`', '*'])
        .chars()
        .filter(|c| !c.is_control())
        .take(100)
        .collect();
    if summary.is_empty() {
        "Complete task changes".into()
    } else {
        summary
    }
}

struct IndexLock(std::path::PathBuf);
impl Drop for IndexLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

// Called only after the owned process tree has exited, under the execution guard.
// The real index is locked and retained until the branch update succeeds.
pub(super) fn create(run: &TaskRun, directory: &Path) -> Result<Option<Checkpoint>, String> {
    if run.live_session_id.is_some() {
        return Ok(None);
    }
    let policy = project_git::read(Path::new(&run.project_path))?;
    if !policy.auto_checkpoint {
        return Ok(None);
    }
    let path = Path::new(&run.workspace);
    if fs::canonicalize(path).map_err(|e| e.to_string())?
        == fs::canonicalize(&run.project_path).map_err(|e| e.to_string())?
    {
        return Ok(None);
    }
    if !run.branch.starts_with("jackalope/")
        || repo::git(path, &["symbolic-ref", "--quiet", "HEAD"], Inspection)?
            != format!("refs/heads/{}", run.branch)
    {
        return Err("Automatic commits require the task's original Jackalope branch.".into());
    }
    let common = |path: &Path| -> Result<std::path::PathBuf, String> {
        fs::canonicalize(repo::git(
            path,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
            Inspection,
        )?)
        .map_err(|e| e.to_string())
    };
    if common(path)? != common(Path::new(&run.project_path))? {
        return Err("Task worktree no longer belongs to this project.".into());
    }
    super::previews::ensure_idle(&run.workspace)?;
    if repo::git(path, &["ls-files", "-v", "-z"], Inspection)?
        .split('\0')
        .filter(|s| !s.is_empty())
        .any(|s| !s.starts_with("H "))
        || repo::git(path, &["ls-files", "--stage", "-z"], Inspection)?
            .split('\0')
            .any(|s| s.starts_with("160000 "))
    {
        return Err("Review hidden index changes or submodules before committing.".into());
    }
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let source = integration::snapshot(run, directory)?;
    let parent_tree = repo::git(path, &["rev-parse", "HEAD^{tree}"], Inspection)?;
    if source.tree == parent_tree {
        return Ok(None);
    }
    let staged = repo::git(path, &["write-tree"], Inspection)?;
    if staged != parent_tree && staged != source.tree {
        return Err("Staged content differs from the working copy. Review the index before committing; all files are retained.".into());
    }
    policy.validate()?;
    let message = policy.message(
        &format!("{}\n\nJackalope-Run: {}", suggested_message(run), run.id),
        &project_git::contributors(run),
    );
    let index = repo::git(
        path,
        &["rev-parse", "--path-format=absolute", "--git-path", "index"],
        Inspection,
    )?;
    let index_before = fs::read(&index).map_err(|e| e.to_string())?;
    let lock_path = std::path::PathBuf::from(format!("{index}.lock"));
    let mut lock_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_path)
        .map_err(|_| {
            "Another Git operation is using the task index. Retry after it finishes.".to_string()
        })?;
    let lock = IndexLock(lock_path);
    let now = integration::snapshot(run, directory)?;
    if source.head != now.head
        || source.tree != now.tree
        || source.status != now.status
        || fs::read(&index).map_err(|e| e.to_string())? != index_before
    {
        return Err(
            "Task files changed before the checkpoint. They are retained for review.".into(),
        );
    }
    let prepared = repo::with_temp_index(path, directory, Seed::Empty, Inspection, |scratch| {
        scratch
            .git(&["read-tree", &source.tree])
            .map_err(|_| "Cannot prepare the checkpoint index.".to_string())?;
        fs::read(scratch.file()).map_err(|e| e.to_string())
    })?;
    lock_file.write_all(&prepared).map_err(|e| e.to_string())?;
    lock_file.sync_all().map_err(|e| e.to_string())?;
    drop(lock_file);
    let mut cmd = repo::command(
        path,
        &[
            "commit-tree",
            &source.tree,
            "-p",
            &source.head,
            "-m",
            &message,
        ],
        Inspection,
    );
    policy.environment(&mut cmd, &project_git::contributors(run));
    let output = cmd.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Cannot write the task checkpoint.".into());
    }
    let head = String::from_utf8_lossy(&output.stdout).trim().to_string();
    repo::git(
        path,
        &[
            "update-ref",
            &format!("refs/heads/{}", run.branch),
            &head,
            &source.head,
        ],
        Inspection,
    )?;
    fs::rename(&lock.0, &index).map_err(|e| format!("Checkpoint {head} saved, but the index could not be refreshed: {e}. Files are unchanged; inspect Git status before continuing."))?;
    Ok(Some(Checkpoint { head, message }))
}
