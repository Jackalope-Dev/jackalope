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
    /// The worktree cannot be cleaned plainly, but its only blockers are
    /// recoverable content (uncommitted changes, untracked files, or commits not
    /// yet merged). Archive-and-remove is offered for these.
    #[serde(default)]
    pub recoverable: bool,
    #[serde(default)]
    pub missing: bool,
    #[serde(default)]
    pub generated_paths: Vec<String>,
    #[serde(default)]
    pub content_merged: bool,
}

/// Cap on the untracked content an archive will copy before bailing out.
const ARCHIVE_MAX_BYTES: u64 = 512 * 1024 * 1024;
const ARCHIVE_MAX_FILES: usize = 20_000;

pub(super) fn command(path: &Path, args: &[&str]) -> Command {
    super::git_command::command(path, args, super::git_command::Policy::Inspection)
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

// Resolve the existing ancestor so deleted task folders still protect related
// worktrees without blocking every unrelated worktree in the repository.
fn task_workspace(path: &Path) -> Result<PathBuf, String> {
    match std::fs::canonicalize(path) {
        Ok(path) => Ok(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = path.parent().ok_or("Cannot resolve the task workspace.")?;
            let name = path
                .file_name()
                .ok_or("Cannot resolve the task workspace.")?;
            Ok(task_workspace(parent)?.join(name))
        }
        Err(_) => {
            Err("Cannot verify a task workspace. Check its folder access before cleanup.".into())
        }
    }
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

/// Immovable reasons a worktree must be kept. `Err` here means neither plain
/// cleanup nor archive-and-remove is offered.
fn hard_block(
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
    if !Path::new(&wt.path)
        .try_exists()
        .map_err(|e| e.to_string())?
    {
        return Err(
            "Folder is missing. Remove its stale registration with Remove missing entries.".into(),
        );
    }
    let path = canonical(&wt.path)?;
    super::previews::ensure_idle(&wt.path)?;
    super::verification::ensure_idle(&wt.path)?;
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
        let workspace = task_workspace(Path::new(&run.workspace))?;
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
    Ok(())
}

struct LocalContent {
    changes: bool,
    generated_paths: Vec<String>,
    preserved_path: Option<String>,
}

fn is_link(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

// Only ignored output folders with an adjacent project manifest are disposable.
// Broad ignores such as output/, scratch/ and *.local are never evidence of this.
fn generated_ignored_path(root: &Path, name: &str) -> Option<String> {
    let relative = Path::new(name.trim_end_matches('/'));
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return None;
    }
    for candidate in relative
        .ancestors()
        .filter(|path| !path.as_os_str().is_empty())
    {
        let manifest = match candidate.file_name().and_then(|value| value.to_str()) {
            Some("node_modules" | ".pnpm-store" | "dist" | "dist-ssr" | "dist-lab") => {
                "package.json"
            }
            Some("target") => "Cargo.toml",
            _ => continue,
        };
        let path = root.join(candidate);
        let metadata = std::fs::symlink_metadata(&path).ok()?;
        if !metadata.is_dir() || is_link(&metadata) {
            return None;
        }
        if path.parent()?.join(manifest).is_file() {
            return Some(format!("{}/", candidate.to_string_lossy()));
        }
    }
    None
}

fn preserved_generated_content(root: &Path, name: &str) -> Result<Option<String>, String> {
    let mut directories = vec![root.join(name)];
    let mut inspected = 0usize;
    while let Some(directory) = directories.pop() {
        for entry in std::fs::read_dir(directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            inspected += 1;
            if inspected > 200_000 {
                return Err(
                    "Generated folder is too large to inspect safely; review it manually.".into(),
                );
            }
            let filename = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if matches!(
                filename.as_str(),
                ".git"
                    | ".env"
                    | ".envrc"
                    | ".npmrc"
                    | ".netrc"
                    | ".pypirc"
                    | ".dev.vars"
                    | "credentials"
                    | "credentials.toml"
            ) || filename.starts_with(".env.")
                || filename.starts_with(".dev.vars.")
                || [
                    ".key",
                    ".pem",
                    ".p12",
                    ".pfx",
                    ".keystore",
                    ".db",
                    ".sqlite",
                    ".sqlite3",
                ]
                .iter()
                .any(|suffix| filename.ends_with(suffix))
            {
                return Ok(Some(
                    entry
                        .path()
                        .strip_prefix(root)
                        .map_err(|e| e.to_string())?
                        .to_string_lossy()
                        .into_owned(),
                ));
            }
            // Dependency links are removed as links; never follow them outside the worktree.
            let metadata = std::fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
            if metadata.is_dir() && !is_link(&metadata) {
                directories.push(entry.path());
            }
        }
    }
    Ok(None)
}

fn local_content(path: &Path) -> Result<LocalContent, String> {
    let status = git(
        path,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=normal",
            "--ignore-submodules=none",
        ],
    )?;
    let ignored = git(
        path,
        &[
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
            "--no-empty-directory",
            "-z",
        ],
    )?;
    let mut content = LocalContent {
        changes: !status.is_empty(),
        generated_paths: Vec::new(),
        preserved_path: None,
    };
    for name in ignored.split('\0').filter(|name| !name.is_empty()) {
        if let Some(generated) = generated_ignored_path(path, name) {
            if content.generated_paths.contains(&generated) {
                continue;
            }
            if let Some(preserved) = preserved_generated_content(path, &generated)? {
                content.preserved_path = Some(preserved);
                break;
            }
            content.generated_paths.push(generated);
        } else {
            content.preserved_path = Some(name.to_owned());
            break;
        }
    }
    Ok(content)
}

struct ScratchIndex(PathBuf);
impl Drop for ScratchIndex {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

// Require a no-op three-way merge for both the index and working copy. Comparing
// whole trees would reject older worktrees; checking only HEAD would lose edits.
fn content_in_target(path: &Path, head: &str, target: &str) -> Result<bool, String> {
    let temp = ScratchIndex(
        std::env::temp_dir().join(format!("jackalope-cleanup-{}.index", uuid::Uuid::new_v4())),
    );
    let index = git(
        path,
        &["rev-parse", "--path-format=absolute", "--git-path", "index"],
    )?;
    let before = std::fs::read(index.trim()).map_err(|e| e.to_string())?;
    std::fs::write(&temp.0, &before).map_err(|e| e.to_string())?;
    let indexed = |args: &[&str]| -> Result<String, String> {
        let result = command(path, args)
            .env("GIT_INDEX_FILE", &temp.0)
            .output()
            .map_err(|e| e.to_string())?;
        if !result.status.success() {
            return Err(String::from_utf8_lossy(&result.stderr).trim().into());
        }
        Ok(String::from_utf8_lossy(&result.stdout).trim().into())
    };
    let staged = indexed(&["write-tree"])?;
    indexed(&["add", "--all", "--", "."])?;
    let working = indexed(&["write-tree"])?;
    let target_tree = git(path, &["rev-parse", &format!("{target}^{{tree}}")])?;
    for tree in [&staged, &working] {
        let result = command(
            path,
            &[
                "commit-tree",
                tree,
                "-p",
                head,
                "-m",
                "Cleanup content check",
            ],
        )
        .env("GIT_AUTHOR_NAME", "Jackalope")
        .env("GIT_AUTHOR_EMAIL", "cleanup@jackalope.invalid")
        .env("GIT_COMMITTER_NAME", "Jackalope")
        .env("GIT_COMMITTER_EMAIL", "cleanup@jackalope.invalid")
        .output()
        .map_err(|e| e.to_string())?;
        if !result.status.success() {
            return Err("Cannot inspect local content safely.".into());
        }
        let commit = String::from_utf8_lossy(&result.stdout);
        let result = output(path, &["merge-tree", "--write-tree", target, commit.trim()])?;
        if !result.status.success()
            || String::from_utf8_lossy(&result.stdout).lines().next() != Some(target_tree.trim())
        {
            return Ok(false);
        }
    }
    if git(path, &["rev-parse", "HEAD"])?.trim() != head
        || std::fs::read(index.trim()).map_err(|e| e.to_string())? != before
    {
        return Err("The worktree changed during inspection. Refresh before cleanup.".into());
    }
    indexed(&["add", "--all", "--", "."])?;
    if indexed(&["write-tree"])? != working {
        return Err("Local files changed during inspection.".into());
    }
    Ok(true)
}

pub(super) fn inspect(
    repo_path: &str,
    requested: Option<&str>,
    runs: &[TaskRun],
) -> Result<Vec<WorktreeEntry>, String> {
    inspect_entries(repo_path, requested, runs, None)
}

fn inspect_entries(
    repo_path: &str,
    requested: Option<&str>,
    runs: &[TaskRun],
    only: Option<&str>,
) -> Result<Vec<WorktreeEntry>, String> {
    let repo = canonical(repo_path)?;
    let mut entries = list_worktrees(repo_path)?;
    let target = target(&repo, requested);
    for index in 0..entries.len() {
        if only.is_some_and(|path| entries[index].path != path) {
            continue;
        }
        let mut status = CleanupStatus {
            target_branch: None,
            target_head: None,
            merged: None,
            blocked_reason: None,
            recoverable: false,
            generated_paths: Vec::new(),
            content_merged: false,
            missing: Path::new(&entries[index].path)
                .try_exists()
                .is_ok_and(|exists| !exists),
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
        match hard_block(&repo, &entries, index, runs) {
            Err(reason) => status.blocked_reason = Some(reason),
            Ok(()) => match canonical(&entries[index].path).and_then(|path| local_content(&path)) {
                Ok(content) => {
                    status.generated_paths = content.generated_paths;
                    if let Some(name) = content.preserved_path {
                        status.blocked_reason = Some(format!(
                            "Local ignored content needs preserving: {name}. Move it out before cleanup or archiving; ignored files are not archived."
                        ));
                    } else if content.changes {
                        status.blocked_reason = Some(
                            "Uncommitted changes or untracked files — archive & remove, or preserve them before cleanup.".into(),
                        );
                        status.recoverable = true;
                    } else if status.merged == Some(false) {
                        status.recoverable = true;
                    }
                }
                Err(reason) => status.blocked_reason = Some(reason),
            },
        }
        if status.recoverable {
            if let Some(head) = status.target_head.as_deref() {
                match content_in_target(Path::new(&entries[index].path), &entries[index].head, head)
                {
                    Ok(true) => {
                        status.content_merged = true;
                        status.blocked_reason = None;
                        status.recoverable = false;
                    }
                    Ok(false) => {}
                    Err(reason) => {
                        status.blocked_reason = Some(reason);
                        status.recoverable = false;
                    }
                }
            }
        }
        entries[index].cleanup = Some(status);
    }
    Ok(entries)
}

pub(super) fn remove(
    repo_path: &str,
    worktree_path: &str,
    target_branch: &str,
    expected_head: &str,
    expected_target_head: &str,
    runs: &[TaskRun],
    delete_branch: bool,
    expected_branch: Option<&str>,
) -> Result<(), String> {
    let entries = inspect_entries(repo_path, Some(target_branch), runs, Some(worktree_path))?;
    let wt = entries
        .iter()
        .find(|wt| wt.path == worktree_path)
        .ok_or("Worktree is no longer registered. Refresh the list.")?;
    let status = wt.cleanup.as_ref().ok_or("Refresh the worktree status.")?;
    if expected_branch.is_some_and(|branch| branch != wt.branch)
        || wt.head != expected_head
        || status.target_head.as_deref() != Some(expected_target_head)
    {
        return Err(
            "The worktree or target branch changed. Refresh and review its status again.".into(),
        );
    }
    if let Some(reason) = &status.blocked_reason {
        return Err(reason.clone());
    }
    if status.merged != Some(true) && !status.content_merged {
        return Err("All commits must be merged before cleanup.".into());
    }
    if git(Path::new(worktree_path), &["rev-parse", "HEAD"])?.trim() != expected_head
        || target(Path::new(repo_path), Some(target_branch))?.1 != expected_target_head
    {
        return Err(
            "The worktree or target branch changed. Refresh and review its status again.".into(),
        );
    }
    let root = canonical(worktree_path)?;
    for generated in &status.generated_paths {
        let path = root.join(generated);
        if !path.starts_with(&root)
            || path == root
            || is_link(&std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?)
        {
            return Err("Generated folder changed. Refresh before cleanup.".into());
        }
        std::fs::remove_dir_all(&path).map_err(|e| format!("Cannot remove generated folder {}: {e}. Close terminals, development servers or file viewers using this folder, then retry. Other worktrees can still be cleaned.", path.display()))?;
    }
    // Recheck after potentially slow dependency removal, before permitting dirty removal.
    let checked = inspect_entries(repo_path, Some(target_branch), runs, Some(worktree_path))?;
    let now = checked
        .iter()
        .find(|entry| entry.path == worktree_path)
        .ok_or("Worktree registration changed.")?;
    if now.head != expected_head
        || now.branch != wt.branch
        || now.cleanup.as_ref().is_none_or(|s| {
            s.blocked_reason.is_some() || s.target_head.as_deref() != Some(expected_target_head)
        })
    {
        return Err("Worktree changed during cleanup. Refresh before retrying.".into());
    }
    let args = if status.content_merged {
        vec!["worktree", "remove", "--force", "--", worktree_path]
    } else {
        vec!["worktree", "remove", "--", worktree_path]
    };
    git(Path::new(repo_path), &args).map_err(|e| format!("Could not finish removing {worktree_path}: {e}. Close processes using this folder and refresh. If Git already removed its registration, inspect the remaining folder manually; no unverified files will be deleted."))?;
    if delete_branch && !wt.branch.is_empty() {
        delete_merged_branch(
            repo_path,
            &wt.branch,
            expected_head,
            target_branch,
            expected_target_head,
        )?;
    }
    Ok(())
}

pub(super) fn delete_merged_branch(
    repo: &str,
    branch: &str,
    head: &str,
    target_branch: &str,
    target_head: &str,
) -> Result<(), String> {
    if ["main", "master", target_branch].contains(&branch)
        || list_worktrees(repo)?
            .iter()
            .any(|entry| entry.branch == branch)
    {
        return Err(
            "Worktree removed; branch kept because it is protected or checked out elsewhere."
                .into(),
        );
    }
    use std::io::Write;
    let mut child = command(Path::new(repo), &["update-ref", "--stdin"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let input = format!("start\nverify refs/heads/{target_branch} {target_head}\ndelete refs/heads/{branch} {head}\nprepare\ncommit\n");
    child
        .stdin
        .take()
        .ok_or("Cannot open Git input.")?
        .write_all(input.as_bytes())
        .map_err(|e| e.to_string())?;
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Worktree removed; branch kept because its reference or the target changed. Refresh before removing the branch.".into());
    }
    let _ = git(
        Path::new(repo),
        &[
            "config",
            "--local",
            "--remove-section",
            &format!("branch.{branch}"),
        ],
    );
    Ok(())
}

fn sanitize_component(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(['-', '.']);
    if trimmed.is_empty() {
        "worktree".into()
    } else {
        trimmed.chars().take(60).collect()
    }
}

fn abandon(dir: &Path, why: &str) -> String {
    let _ = std::fs::remove_dir_all(dir);
    format!("Archive stopped: {why}. Move this worktree's files out manually, then use Clean up.")
}

/// Save a soft-blocked worktree's recoverable content (commit history as a git
/// bundle, uncommitted tracked changes as a patch, untracked non-ignored files as
/// copies, plus a manifest) under `<repo>/.worktrees/.archive/`, then force-remove
/// the worktree and delete its `jackalope/` branch. Returns the archive path.
fn archive(
    repo_path: &str,
    worktree_path: &str,
    target_branch: &str,
    expected_head: &str,
    expected_target_head: &str,
    runs: &[TaskRun],
) -> Result<String, String> {
    let entries = inspect_entries(repo_path, Some(target_branch), runs, Some(worktree_path))?;
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
    if !status.recoverable {
        return Err(status.blocked_reason.clone().unwrap_or_else(|| {
            "Nothing to archive here — use Clean up for a merged, clean worktree.".into()
        }));
    }
    // Confirm the raw paths still resolve to what Git registered, then keep using
    // the raw forms: Git rejects the `\\?\` verbatim paths `canonicalize` yields
    // on Windows for the bundle output.
    let repo = Path::new(repo_path);
    let path = Path::new(worktree_path);
    if canonical(worktree_path)? != canonical(git(path, &["rev-parse", "--show-toplevel"])?.trim())?
    {
        return Err("The worktree folder moved. Refresh the list.".into());
    }
    if git(path, &["rev-parse", "HEAD"])?.trim() != expected_head {
        return Err("The worktree changed. Refresh and review its status again.".into());
    }
    let branch = wt.branch.clone();

    let label = sanitize_component(if branch.is_empty() {
        &expected_head[..expected_head.len().min(12)]
    } else {
        &branch
    });
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let archive_parent = repo.join(".worktrees").join(".archive");
    let archive_root = archive_parent.join(format!("{label}-{stamp}"));
    if archive_root.exists() {
        return Err("An archive with this name already exists; retry in a moment.".into());
    }
    std::fs::create_dir_all(&archive_root).map_err(|e| e.to_string())?;
    // Keep the archive folder out of the parent repository's status.
    if let Ok(exclude) = git(
        repo,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "info/exclude",
        ],
    ) {
        if let Ok(existing) = std::fs::read_to_string(exclude.trim()) {
            if !existing.contains("/.worktrees/.archive/") {
                if let Ok(mut file) = std::fs::OpenOptions::new()
                    .append(true)
                    .open(exclude.trim())
                {
                    let _ = std::io::Write::write_all(&mut file, b"\n/.worktrees/.archive/\n");
                }
            }
        }
    }

    // Commit history: a thin bundle relative to the target when known, otherwise
    // the full history reachable from HEAD.
    let bundle = archive_root.join("branch.bundle");
    let bundle_str = bundle.to_str().ok_or("Invalid archive path")?;
    let thin = (!expected_target_head.is_empty())
        && command(
            path,
            &[
                "bundle",
                "create",
                bundle_str,
                &format!("^{expected_target_head}"),
                "HEAD",
            ],
        )
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false);
    if !thin {
        if let Err(error) = git(path, &["bundle", "create", bundle_str, "HEAD"]) {
            return Err(abandon(
                &archive_root,
                &format!("could not bundle commits: {error}"),
            ));
        }
    }
    let bundle_bytes = std::fs::metadata(&bundle).map(|m| m.len()).unwrap_or(0);
    if bundle_bytes == 0 {
        return Err(abandon(&archive_root, "the commit bundle was not written"));
    }
    if bundle_bytes > ARCHIVE_MAX_BYTES {
        return Err(abandon(
            &archive_root,
            "the commit history is larger than 512 MB",
        ));
    }
    git(path, &["bundle", "verify", bundle_str]).map_err(|error| {
        abandon(
            &archive_root,
            &format!("bundle verification failed: {error}"),
        )
    })?;

    // Uncommitted tracked changes.
    let diff = output(path, &["diff", "--binary", "HEAD"])?;
    if !diff.status.success() {
        return Err(abandon(
            &archive_root,
            "could not capture uncommitted changes",
        ));
    }
    std::fs::write(archive_root.join("uncommitted.patch"), &diff.stdout)
        .map_err(|e| e.to_string())?;

    // Untracked, non-ignored files.
    let listing = git(path, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    let mut copied: Vec<String> = Vec::new();
    let mut bytes = bundle_bytes;
    for name in listing.split('\0').filter(|s| !s.is_empty()) {
        if copied.len() >= ARCHIVE_MAX_FILES {
            return Err(abandon(&archive_root, "there are too many untracked files"));
        }
        let src = path.join(name);
        let Ok(meta) = std::fs::symlink_metadata(&src) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        bytes = bytes.saturating_add(meta.len());
        if bytes > ARCHIVE_MAX_BYTES {
            return Err(abandon(
                &archive_root,
                "the untracked content is larger than 512 MB",
            ));
        }
        let dest = archive_root.join("untracked").join(name);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
        copied.push(name.to_string());
    }

    let manifest = serde_json::json!({
        "format": "jackalope-worktree-archive", "version": 1,
        "archivedAt": chrono::Utc::now().to_rfc3339(),
        "repository": repo.to_string_lossy(),
        "worktreePath": path.to_string_lossy(),
        "branch": branch,
        "head": expected_head,
        "targetBranch": target_branch,
        "targetHead": expected_target_head,
        "bundle": "branch.bundle",
        "bundleIsThin": thin,
        "uncommittedPatch": "uncommitted.patch",
        "untrackedFiles": copied,
        "ignoredFilesArchived": false,
    });
    std::fs::write(
        archive_root.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    if let Some(name) = local_content(path)?.preserved_path {
        return Err(abandon(
            &archive_root,
            &format!("local ignored content appeared: {name}"),
        ));
    }
    // Nothing else can be recovered from disk now — take the worktree down.
    git(
        repo,
        &["worktree", "remove", "--force", "--", worktree_path],
    )?;
    if branch.starts_with("jackalope/") {
        let _ = git(repo, &["branch", "-D", &branch]);
    }
    Ok(archive_root.to_string_lossy().into_owned())
}

/// Drop Git's registration for worktrees whose folder is already gone.
fn prune(repo_path: &str) -> Result<usize, String> {
    let before = list_worktrees(repo_path)?.len();
    git(
        &canonical(repo_path)?,
        &["worktree", "prune", "--expire=now"],
    )?;
    Ok(before.saturating_sub(list_worktrees(repo_path)?.len()))
}

#[tauri::command]
pub async fn git_prune_worktrees(repo_path: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = super::integration::execution_guard()?;
        prune(&repo_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_archive_worktree(
    repo_path: String,
    worktree_path: String,
    target_branch: String,
    expected_head: String,
    expected_target_head: String,
    state: State<'_, TaskRuntime>,
) -> Result<String, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = super::integration::execution_guard()?;
        let runs = runtime.integration_runs()?;
        if runs.iter().any(|run| run.persistence_error.is_some()) {
            return Err("Save pending task history before archiving worktrees.".into());
        }
        archive(
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

#[tauri::command]
pub async fn git_cleanup_worktree(
    repo_path: String,
    worktree_path: String,
    target_branch: String,
    expected_head: String,
    expected_target_head: String,
    delete_branch: Option<bool>,
    expected_branch: Option<String>,
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
            delete_branch.unwrap_or(false),
            expected_branch.as_deref(),
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
                false,
                Some(&entry.branch),
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
    fn copied_uncommitted_work_is_ready_but_new_staged_content_is_kept() {
        let f = Fixture::new("main");
        fs::write(f.worktree.join("file.txt"), "integrated\n").unwrap();
        fs::write(f.worktree.join("new.txt"), "new file\n").unwrap();
        fs::write(f.repo.join("new.txt"), "new file\n").unwrap();
        f.commit(&f.repo, "integrated\n");
        let entry = f.entry();
        assert!(entry.cleanup.as_ref().unwrap().content_merged);
        assert!(entry.cleanup.as_ref().unwrap().blocked_reason.is_none());
        fs::write(f.worktree.join("file.txt"), "staged unique\n").unwrap();
        git(&f.worktree, &["add", "file.txt"]).unwrap();
        fs::write(f.worktree.join("file.txt"), "integrated\n").unwrap();
        assert!(!f.entry().cleanup.as_ref().unwrap().content_merged);
        assert!(f.remove(&entry, &[]).is_err());
        assert_eq!(
            git(&f.worktree, &["show", ":file.txt"]).unwrap().trim(),
            "staged unique"
        );
    }

    #[test]
    fn branch_switch_at_the_same_commit_invalidates_cleanup() {
        let f = Fixture::new("main");
        let entry = f.entry();
        git(&f.worktree, &["checkout", "-b", "different-work"]).unwrap();
        assert!(f.remove(&entry, &[]).unwrap_err().contains("changed"));
        assert!(f.worktree.exists());
    }

    #[test]
    fn cleanup_can_remove_the_matching_local_branch() {
        let f = Fixture::new("master");
        let entry = f.entry();
        remove(
            f.repo.to_str().unwrap(),
            &entry.path,
            "master",
            &entry.head,
            entry
                .cleanup
                .as_ref()
                .unwrap()
                .target_head
                .as_deref()
                .unwrap(),
            &[],
            true,
            Some(&entry.branch),
        )
        .unwrap();
        assert!(git(&f.repo, &["show-ref", "--verify", "refs/heads/feature"]).is_err());
        assert!(git(&f.repo, &["show-ref", "--verify", "refs/heads/master"]).is_ok());
    }

    #[test]
    fn unmerged_commits_are_kept_and_exact_squash_content_is_detected() {
        let f = Fixture::new("main");
        f.commit(&f.worktree, "unmerged\n");
        assert_eq!(f.entry().cleanup.as_ref().unwrap().merged, Some(false));
        assert!(f.remove(&f.entry(), &[]).is_err());
        f.commit(&f.repo, "unmerged\n");
        git(&f.repo, &["commit", "--amend", "-m", "squash merge"]).unwrap();
        assert!(f.entry().cleanup.as_ref().unwrap().content_merged);
        f.remove(&f.entry(), &[]).unwrap();
        assert!(!f.worktree.exists());
    }

    #[test]
    fn merged_generated_folders_are_removed_without_force_and_branches_are_kept() {
        let f = Fixture::new("main");
        fs::write(
            f.worktree.join(".gitignore"),
            "node_modules/\ndist/\ntarget/\n",
        )
        .unwrap();
        fs::write(f.worktree.join("package.json"), "{}").unwrap();
        fs::write(f.worktree.join("Cargo.toml"), "[workspace]\n").unwrap();
        f.commit(&f.worktree, "configured project\n");
        git(&f.repo, &["merge", "--ff-only", "feature"]).unwrap();
        for folder in ["node_modules", "dist", "target"] {
            fs::create_dir_all(f.worktree.join(folder)).unwrap();
            fs::write(f.worktree.join(folder).join("generated.js"), "generated").unwrap();
        }
        let entry = f.entry();
        let status = entry.cleanup.as_ref().unwrap();
        assert!(status.blocked_reason.is_none());
        assert_eq!(status.generated_paths.len(), 3);
        assert!(!status.recoverable);
        f.remove(&entry, &[]).unwrap();
        assert!(!f.worktree.exists());
        git(&f.repo, &["show-ref", "--verify", "refs/heads/feature"]).unwrap();
    }

    #[test]
    fn local_config_and_unknown_ignored_content_cannot_be_cleaned_or_archived() {
        for name in [
            ".env",
            "ignored/notes.txt",
            "dist/.env.local",
            "dist/state.sqlite",
        ] {
            let f = Fixture::new("main");
            fs::write(f.worktree.join(".gitignore"), ".env\nignored/\ndist/\n").unwrap();
            fs::write(f.worktree.join("package.json"), "{}").unwrap();
            f.commit(&f.worktree, "configured project\n");
            git(&f.repo, &["merge", "--ff-only", "feature"]).unwrap();
            let before = f.entry();
            let file = f.worktree.join(name);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(&file, "local data").unwrap();
            let entry = f.entry();
            let status = entry.cleanup.as_ref().unwrap();
            assert!(!status.recoverable, "{name}");
            assert!(status
                .blocked_reason
                .as_ref()
                .unwrap()
                .contains("preserving"));
            assert!(f.remove(&before, &[]).is_err(), "{name}");
            assert!(
                archive(
                    f.repo.to_str().unwrap(),
                    &entry.path,
                    "main",
                    &entry.head,
                    status.target_head.as_deref().unwrap(),
                    &[],
                )
                .is_err(),
                "{name}"
            );
            assert_eq!(fs::read_to_string(file).unwrap(), "local data");
        }
    }

    #[test]
    fn generated_names_require_ignore_rules_and_a_project_manifest() {
        for ignored in [false, true] {
            let f = Fixture::new("main");
            if ignored {
                fs::write(f.worktree.join(".gitignore"), "dist/\n").unwrap();
                f.commit(&f.worktree, "ignore output\n");
                git(&f.repo, &["merge", "--ff-only", "feature"]).unwrap();
            } else {
                fs::write(f.worktree.join("package.json"), "{}").unwrap();
                f.commit(&f.worktree, "project\n");
                git(&f.repo, &["merge", "--ff-only", "feature"]).unwrap();
            }
            fs::create_dir(f.worktree.join("dist")).unwrap();
            fs::write(f.worktree.join("dist/notes.txt"), "keep").unwrap();
            let entry = f.entry();
            assert!(entry.cleanup.as_ref().unwrap().generated_paths.is_empty());
            assert!(f.remove(&entry, &[]).is_err());
            assert!(f.worktree.join("dist/notes.txt").exists());
        }
    }

    #[test]
    fn tracked_edits_inside_generated_folders_still_need_archiving() {
        let f = Fixture::new("main");
        fs::write(f.worktree.join(".gitignore"), "dist/\n").unwrap();
        fs::write(f.worktree.join("package.json"), "{}").unwrap();
        fs::create_dir(f.worktree.join("dist")).unwrap();
        fs::write(f.worktree.join("dist/tracked.js"), "original").unwrap();
        git(&f.worktree, &["add", "--force", "dist/tracked.js"]).unwrap();
        f.commit(&f.worktree, "configured project\n");
        git(&f.repo, &["merge", "--ff-only", "feature"]).unwrap();
        fs::write(f.worktree.join("dist/tracked.js"), "local edit").unwrap();
        fs::write(f.worktree.join("dist/generated.js"), "generated").unwrap();
        let entry = f.entry();
        assert!(entry.cleanup.as_ref().unwrap().blocked_reason.is_some());
        assert!(entry.cleanup.as_ref().unwrap().recoverable);
        assert!(f.remove(&entry, &[]).is_err());
        assert_eq!(
            fs::read_to_string(f.worktree.join("dist/tracked.js")).unwrap(),
            "local edit"
        );
    }

    #[test]
    fn dirty_untracked_ignored_and_hidden_index_files_block_even_after_listing() {
        for kind in [
            "unstaged",
            "staged",
            "untracked",
            "ignored",
            "ignored-directory",
            "untracked-directory",
            "assume-unchanged",
            "skip-worktree",
        ] {
            let f = Fixture::new("main");
            let before = f.entry();
            match kind {
                "untracked" => fs::write(f.worktree.join("new.txt"), "keep").unwrap(),
                "ignored" => fs::write(f.worktree.join(".env"), "keep").unwrap(),
                "ignored-directory" | "untracked-directory" => {
                    let directory = if kind == "ignored-directory" {
                        "ignored"
                    } else {
                        "new"
                    };
                    fs::create_dir_all(f.worktree.join(directory).join("nested")).unwrap();
                    fs::write(f.worktree.join(directory).join("nested/keep.txt"), "keep").unwrap();
                }
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
    fn missing_unrelated_task_workspace_does_not_block_merged_cleanup() {
        let f = Fixture::new("main");
        let mut run = f.run("interrupted");
        run.workspace = f
            .root
            .join("deleted task")
            .join("nested")
            .to_string_lossy()
            .into();
        let entries = f.entries(&[run.clone()]);
        assert_eq!(entries[1].cleanup.as_ref().unwrap().blocked_reason, None);
        f.remove(&entries[1], &[run]).unwrap();
        assert!(!f.worktree.exists());
    }

    #[test]
    fn missing_task_subdirectory_still_protects_its_worktree() {
        let f = Fixture::new("main");
        let mut run = f.run("interrupted");
        run.workspace = f
            .worktree
            .join("deleted subdirectory")
            .to_string_lossy()
            .into();
        assert!(f
            .remove(&f.entry(), &[run])
            .unwrap_err()
            .contains("active or interrupted"));
        assert!(f.worktree.exists());
    }

    #[test]
    fn missing_worktrees_have_actionable_status_and_locked_entries_survive_prune() {
        let f = Fixture::new("main");
        git(&f.repo, &["worktree", "lock", f.worktree.to_str().unwrap()]).unwrap();
        fs::rename(&f.worktree, f.root.join("moved")).unwrap();
        assert!(f.entry().cleanup.as_ref().unwrap().missing);
        assert_eq!(prune(f.repo.to_str().unwrap()).unwrap(), 0);
        git(
            &f.repo,
            &["worktree", "unlock", f.worktree.to_str().unwrap()],
        )
        .unwrap();
        let entry = f.entry();
        let status = entry.cleanup.as_ref().unwrap();
        assert!(status.missing);
        assert!(!status.recoverable);
        assert!(status
            .blocked_reason
            .as_ref()
            .unwrap()
            .contains("Remove missing entries"));
        assert!(f.remove(&entry, &[]).is_err());
        assert_eq!(prune(f.repo.to_str().unwrap()).unwrap(), 1);
        assert!(f.root.join("moved").exists());
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
            &[],
            false,
            None,
        )
        .is_err());
    }

    #[test]
    fn archive_saves_recoverable_content_then_force_removes_a_dirty_unmerged_worktree() {
        let f = Fixture::new("main");
        git(&f.worktree, &["branch", "-m", "jackalope/task-1"]).unwrap();
        fs::write(f.worktree.join(".gitignore"), "node_modules/\n").unwrap();
        fs::write(f.worktree.join("package.json"), "{}").unwrap();
        f.commit(&f.worktree, "branch work\n");
        fs::write(f.worktree.join("file.txt"), "uncommitted edit\n").unwrap();
        fs::write(f.worktree.join("scratch.txt"), "untracked note\n").unwrap();
        fs::create_dir(f.worktree.join("node_modules")).unwrap();
        fs::write(f.worktree.join("node_modules/generated.js"), "generated").unwrap();

        let entry = f.entry();
        let status = entry.cleanup.as_ref().unwrap();
        assert!(status.recoverable);
        assert_eq!(status.merged, Some(false));

        let archived = archive(
            f.repo.to_str().unwrap(),
            &entry.path,
            "main",
            &entry.head,
            status.target_head.as_deref().unwrap(),
            &[],
        )
        .unwrap();
        let dir = PathBuf::from(&archived);

        assert!(!f.worktree.exists());
        assert_eq!(f.entries(&[]).len(), 1);
        assert!(
            git(
                &f.repo,
                &["show-ref", "--verify", "refs/heads/jackalope/task-1"]
            )
            .is_err(),
            "the jackalope branch is deleted (preserved in the bundle)"
        );

        let manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest["format"], "jackalope-worktree-archive");
        assert_eq!(
            manifest["untrackedFiles"],
            serde_json::json!(["scratch.txt"])
        );
        assert!(
            !dir.join("untracked/node_modules").exists(),
            "disposable dependencies stay out"
        );
        assert!(fs::read_to_string(dir.join("untracked/scratch.txt"))
            .unwrap()
            .contains("untracked note"));
        assert!(!fs::read(dir.join("uncommitted.patch")).unwrap().is_empty());

        git(
            &f.repo,
            &[
                "fetch",
                dir.join("branch.bundle").to_str().unwrap(),
                "HEAD:refs/heads/recovered",
            ],
        )
        .unwrap();
        assert_eq!(
            git(&f.repo, &["log", "-1", "--format=%s", "recovered"])
                .unwrap()
                .trim(),
            "change"
        );
    }

    #[test]
    fn archive_refuses_a_hard_blocked_worktree_and_leaves_it_in_place() {
        let f = Fixture::new("main");
        f.commit(&f.worktree, "unmerged\n");
        fs::write(f.worktree.join("dirty.txt"), "x").unwrap();
        let entry = f.entry();
        let target_head = entry.cleanup.as_ref().unwrap().target_head.clone().unwrap();
        for status in ["running", "interrupted"] {
            assert!(archive(
                f.repo.to_str().unwrap(),
                &entry.path,
                "main",
                &entry.head,
                &target_head,
                &[f.run(status)],
            )
            .unwrap_err()
            .contains("active or interrupted"));
        }
        assert!(f.worktree.exists());
        assert!(f.worktree.join("dirty.txt").exists());
    }

    #[test]
    fn prune_drops_registrations_for_deleted_worktree_folders() {
        let f = Fixture::new("main");
        assert_eq!(f.entries(&[]).len(), 2);
        fs::remove_dir_all(&f.worktree).unwrap();
        assert_eq!(prune(f.repo.to_str().unwrap()).unwrap(), 1);
        assert_eq!(f.entries(&[]).len(), 1);
    }
}
