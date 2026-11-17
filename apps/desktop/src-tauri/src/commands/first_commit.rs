//! A first commit for a repository that has none, so features that need a
//! commit (Artifacts, worktrees) do not dead-end on an empty history.
//!
//! The commit uses the person's own Git identity and the plain message
//! "Initial commit", with no trailers. `git add -A` honors `.gitignore`.
//! The preview shows the file count, and the commit is refused when the files
//! changed since then so the person approves what is committed. Plans and isolated tasks
//! that start in a repository without commits create the same commit automatically,
//! leaving out secret-looking files whether or not `.gitignore` lists them.

use super::git_command::{command, Policy};
use serde::Serialize;
use std::path::Path;

const MESSAGE: &str = "Initial commit";
const IDENTITY_FIX: &str = "Git has no name and email for commits. Run git config --global user.name \"Your Name\" and git config --global user.email you@example.com, then try again.";

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    name: String,
    email: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirstCommitPreview {
    /// Files the commit would contain: tracked-to-be and untracked files not ignored.
    files: usize,
    /// The configured Git identity, or `None` when the commit would be refused.
    identity: Option<Identity>,
}

fn run(path: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    let mut git = command(path, args, Policy::Isolated);
    // The configured identity decides authorship, not one inherited from a shell.
    for key in [
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
    ] {
        git.env_remove(key);
    }
    git.stdin(std::process::Stdio::null())
        .output()
        .map_err(|_| "Git could not be started. Install Git, then try again.".to_string())
}

fn text(path: &Path, args: &[&str]) -> Result<String, String> {
    let output = run(path, args)?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() {
            format!("Git exited with status {}", output.status)
        } else {
            error
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// The repository at `project_path`, which must be its top level and have no commits.
fn unborn_root(project_path: &str) -> Result<&Path, String> {
    let path = Path::new(project_path);
    let top = text(path, &["rev-parse", "--show-toplevel"])
        .map_err(|_| "This folder is not a Git repository.".to_string())?;
    let same = match (Path::new(&top).canonicalize(), path.canonicalize()) {
        (Ok(top), Ok(path)) => top == path,
        _ => false,
    };
    if !same {
        return Err("Open the repository's top-level folder as the project first.".into());
    }
    if text(path, &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).is_ok() {
        return Err("This repository already has commits.".into());
    }
    Ok(path)
}

/// Whether `project_path` is a repository's top level without any commits.
pub(in crate::commands) fn is_unborn(project_path: &str) -> bool {
    unborn_root(project_path).is_ok()
}

fn configured(path: &Path, key: &str) -> Option<String> {
    text(path, &["config", "--get", key])
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn identity(path: &Path) -> Option<Identity> {
    Some(Identity {
        name: configured(path, "user.name")?,
        email: configured(path, "user.email")?,
    })
}

/// Files `git add -A` would stage: already staged and untracked, not ignored.
fn pending_files(path: &Path) -> Result<usize, String> {
    let output = run(
        path,
        &[
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ],
    )?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    Ok(count_entries(&output.stdout))
}

/// Distinct NUL-separated paths; a file both staged and modified is listed once.
fn count_entries(stdout: &[u8]) -> usize {
    let mut paths: Vec<&[u8]> = stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .collect();
    paths.sort_unstable();
    paths.dedup();
    paths.len()
}

/// Refuses a commit without an identity, or when the files changed since the preview.
fn gate(identity: Option<&Identity>, files: usize, approved: usize) -> Result<(), String> {
    if identity.is_none() {
        return Err(IDENTITY_FIX.into());
    }
    if files != approved {
        return Err(format!(
            "The folder now has {files} files to commit instead of {approved}. Review the new count, then commit again."
        ));
    }
    Ok(())
}

fn commit_args(files: usize) -> Vec<&'static str> {
    let mut args = vec!["commit", "--no-gpg-sign", "--quiet"];
    if files == 0 {
        args.push("--allow-empty");
    }
    args.extend_from_slice(&["-m", MESSAGE]);
    args
}

fn preview(project_path: &str) -> Result<FirstCommitPreview, String> {
    let path = unborn_root(project_path)?;
    Ok(FirstCommitPreview {
        files: pending_files(path)?,
        identity: identity(path),
    })
}

fn create(project_path: &str, approved_files: usize) -> Result<(), String> {
    let path = unborn_root(project_path)?;
    let files = pending_files(path)?;
    gate(identity(path).as_ref(), files, approved_files)?;
    text(path, &["add", "-A"])?;
    text(path, &commit_args(files))?;
    Ok(())
}

/// Files an automatic first commit never includes, ignored by `.gitignore` or not.
const SECRET_PATHS: &[&str] = &[
    ":(exclude,glob)**/.env",
    ":(exclude,glob)**/.env.*",
    ":(exclude,glob)**/*.pem",
    ":(exclude,glob)**/*.key",
    ":(exclude,glob)**/*.p12",
    ":(exclude,glob)**/*.pfx",
    ":(exclude,glob)**/id_rsa*",
    ":(exclude,glob)**/id_ed25519*",
];

/// Notes about automatic first commits, by project path, for the next attempt
/// started there to show in its activity.
static NOTES: std::sync::Mutex<Vec<(String, String)>> = std::sync::Mutex::new(Vec::new());

/// The note left by an automatic first commit in `project_path`, once.
pub(in crate::commands) fn take_note(project_path: &str) -> Option<String> {
    let mut notes = NOTES.lock().ok()?;
    let index = notes.iter().position(|(path, _)| path == project_path)?;
    Some(notes.remove(index).1)
}

fn staged_files(path: &Path) -> Result<usize, String> {
    let output = run(path, &["diff", "--cached", "--name-only", "-z"])?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    Ok(count_entries(&output.stdout))
}

/// Gives a repository without commits its first one so plans and isolated
/// tasks can start, instead of failing. `init` also turns a folder that is in
/// no repository into one; a subfolder of another repository is left alone.
/// The commit honors `.gitignore` and always leaves out secret-looking files.
/// Returns what was done, also kept for [`take_note`].
pub(in crate::commands) fn ensure_first_commit(
    project_path: &str,
    init: bool,
) -> Result<Option<String>, String> {
    let path = Path::new(project_path);
    let initialize = if is_unborn(project_path) {
        false
    } else if init && path.is_dir() && text(path, &["rev-parse", "--show-toplevel"]).is_err() {
        true
    } else {
        return Ok(None);
    };
    // Checked first, so a refused commit leaves a plain folder untouched.
    if identity(path).is_none() {
        return Err(IDENTITY_FIX.into());
    }
    if initialize {
        text(path, &["init", "-q"])?;
    }
    let mut add = vec!["add", "-A", "--", "."];
    add.extend_from_slice(SECRET_PATHS);
    text(path, &add)?;
    let files = staged_files(path)?;
    text(path, &commit_args(files))?;
    let note = format!(
        "Jackalope {}created the first commit with {files} file{} so work could start in its own worktree. Files that look like secrets (.env files and keys) were left out.",
        if initialize { "turned the folder into a Git repository and " } else { "" },
        if files == 1 { "" } else { "s" },
    );
    if let Ok(mut notes) = NOTES.lock() {
        notes.retain(|(saved, _)| saved != project_path);
        if notes.len() < 100 {
            notes.push((project_path.to_string(), note.clone()));
        }
    }
    Ok(Some(note))
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::first_commit::project_first_commit_preview,
            commands::first_commit::project_first_commit,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

/// What a first commit would contain and who it would be attributed to.
#[tauri::command]
pub async fn project_first_commit_preview(
    project_path: String,
) -> Result<FirstCommitPreview, String> {
    tauri::async_runtime::spawn_blocking(move || preview(&project_path))
        .await
        .map_err(|e| e.to_string())?
}

/// Commits every non-ignored file as the configured Git identity. `files` is
/// the count the person approved from the preview.
#[tauri::command]
pub async fn project_first_commit(project_path: String, files: usize) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || create(&project_path, files))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Scratch(PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn scratch() -> Scratch {
        let path =
            std::env::temp_dir().join(format!("jackalope-first-commit-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        text(&path, &["init", "-q"]).unwrap();
        Scratch(path)
    }

    fn set_identity(path: &Path) {
        text(path, &["config", "user.name", "Pat Example"]).unwrap();
        text(path, &["config", "user.email", "pat@example.com"]).unwrap();
    }

    #[test]
    fn counts_distinct_paths() {
        assert_eq!(count_entries(b""), 0);
        assert_eq!(count_entries(b"a\0b\0a\0"), 2);
        assert_eq!(count_entries(b"dir/with space\0"), 1);
    }

    #[test]
    fn commits_need_an_identity_and_the_approved_count() {
        let pat = Identity {
            name: "Pat".into(),
            email: "pat@example.com".into(),
        };
        assert!(gate(None, 3, 3)
            .unwrap_err()
            .contains("git config --global user.name"));
        assert!(gate(Some(&pat), 4, 3).unwrap_err().contains("4 files"));
        assert!(gate(Some(&pat), 3, 3).is_ok());
    }

    #[test]
    fn first_commit_respects_gitignore_and_uses_the_configured_identity() {
        let repo = scratch();
        let path = repo.0.as_path();
        let project = path.to_str().unwrap();
        std::fs::write(path.join(".gitignore"), ".env\n").unwrap();
        std::fs::write(path.join(".env"), "SECRET=1").unwrap();
        std::fs::write(path.join("main.rs"), "fn main() {}").unwrap();
        set_identity(path);
        assert!(is_unborn(project));
        let shown = preview(project).unwrap();
        assert_eq!(shown.files, 2);
        assert_eq!(shown.identity.as_ref().unwrap().name, "Pat Example");
        assert!(create(project, 1).unwrap_err().contains("2 files"));
        create(project, 2).unwrap();
        assert!(!is_unborn(project));
        assert_eq!(
            text(path, &["log", "-1", "--format=%an <%ae>%n%B"]).unwrap(),
            "Pat Example <pat@example.com>\nInitial commit"
        );
        let committed = text(path, &["ls-tree", "-r", "--name-only", "HEAD"]).unwrap();
        assert!(committed.contains("main.rs"));
        assert!(!committed.lines().any(|line| line == ".env"));
        assert!(create(project, 2)
            .unwrap_err()
            .contains("already has commits"));
    }

    #[test]
    fn automatic_first_commits_leave_out_secrets_and_note_what_happened() {
        let repo = scratch();
        let path = repo.0.as_path();
        let project = path.to_str().unwrap();
        set_identity(path);
        std::fs::write(path.join("main.rs"), "fn main() {}").unwrap();
        std::fs::write(path.join(".env"), "SECRET=1").unwrap();
        std::fs::write(path.join(".env.local"), "SECRET=2").unwrap();
        std::fs::create_dir_all(path.join("config")).unwrap();
        std::fs::write(path.join("config/server.pem"), "key").unwrap();
        let note = ensure_first_commit(project, false).unwrap().unwrap();
        assert!(note.contains("1 file "), "{note}");
        assert_eq!(take_note(project).as_deref(), Some(note.as_str()));
        assert_eq!(take_note(project), None);
        let committed = text(path, &["ls-tree", "-r", "--name-only", "HEAD"]).unwrap();
        assert_eq!(committed, "main.rs");
        // Secret-looking files stay in the folder, untracked.
        assert!(path.join(".env").exists());
        // Nothing to do once the repository has commits.
        assert_eq!(ensure_first_commit(project, true).unwrap(), None);
    }

    #[test]
    fn plain_folders_become_repositories_only_when_asked() {
        let folder =
            std::env::temp_dir().join(format!("jackalope-greenfield-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        let scratch = Scratch(folder.clone());
        let project = scratch.0.to_str().unwrap();
        std::fs::write(folder.join("index.html"), "<h1>Hi</h1>").unwrap();
        assert_eq!(ensure_first_commit(project, false).unwrap(), None);
        assert!(text(&folder, &["rev-parse", "--show-toplevel"]).is_err());
        // A plain folder uses the machine's global identity, which a test
        // machine may lack; without one the folder is left as it was.
        match ensure_first_commit(project, true) {
            Ok(note) => {
                assert!(note.unwrap().contains("turned the folder"));
                assert!(!is_unborn(project));
                assert!(text(&folder, &["rev-parse", "HEAD"]).is_ok());
            }
            Err(error) => {
                assert!(error.contains("git config"), "{error}");
                assert!(!folder.join(".git").exists());
            }
        }
        let _ = take_note(project);
    }

    #[test]
    fn subfolders_are_not_treated_as_the_repository() {
        let repo = scratch();
        let nested = repo.0.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        assert!(!is_unborn(nested.to_str().unwrap()));
        assert!(preview(nested.to_str().unwrap())
            .unwrap_err()
            .contains("top-level"));
    }
}
