use super::ProjectInfo;
use crate::commands::git_command::{command, Policy};
use std::{path::Path, path::PathBuf, process::Stdio};
use tauri::{AppHandle, Manager};

fn default_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map(|path| path.join("Jackalope Projects"))
        .map_err(|_| "Choose a folder for your new project.".into())
}

#[tauri::command]
pub fn task_project_directory(app: AppHandle) -> Result<String, String> {
    Ok(default_directory(&app)?.to_string_lossy().into_owned())
}

fn validate_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    let stem = name.split('.').next().unwrap_or_default().to_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
        });
    if name.is_empty()
        || name.chars().count() > 80
        || name == "."
        || name.eq_ignore_ascii_case(".git")
        || name.ends_with('.')
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || reserved
    {
        return Err("Use a project name of 1–80 characters without path separators or reserved filename characters.".into());
    }
    Ok(name)
}

fn git(path: &Path, args: &[&str]) -> Result<String, String> {
    let output = command(path, args, Policy::Isolated)
        .env_remove("GIT_COMMON_DIR")
        .env_remove("GIT_OBJECT_DIRECTORY")
        .env_remove("GIT_ALTERNATE_OBJECT_DIRECTORIES")
        .env_remove("GIT_CONFIG_PARAMETERS")
        .env_remove("GIT_NAMESPACE")
        .env("GIT_CONFIG_COUNT", "0")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env(
            "GIT_CONFIG_GLOBAL",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        )
        .env("GIT_AUTHOR_NAME", "Jackalope")
        .env("GIT_AUTHOR_EMAIL", "jackalope@localhost")
        .env("GIT_COMMITTER_NAME", "Jackalope")
        .env("GIT_COMMITTER_EMAIL", "jackalope@localhost")
        .stdin(Stdio::null())
        .output()
        .map_err(|_| "Git could not be started. Install Git, then try again.".to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}

fn create_project(parent: &Path, name: &str) -> Result<ProjectInfo, String> {
    let name = validate_name(name)?;
    let parent = parent
        .canonicalize()
        .map_err(|_| "Choose an existing parent folder.".to_string())?;
    git(&parent, &["--version"])?;
    let path = parent.join(name);
    std::fs::create_dir(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            "That folder already exists. Choose another name or open it as an existing project."
                .to_string()
        } else {
            format!("Could not create the project folder: {error}")
        }
    })?;
    let initialize = || -> Result<(), String> {
        git(&path, &["init", "--initial-branch=main", "--template="])?;
        // An empty root commit lets the first task use a worktree without staging user files or running hooks.
        let tree = git(&path, &["hash-object", "-t", "tree", "--stdin", "-w"])?;
        let commit = git(&path, &["commit-tree", &tree, "-m", "Initialize project"])?;
        git(&path, &["update-ref", "refs/heads/main", &commit])?;
        Ok(())
    };
    initialize().map_err(|error| {
        format!(
            "Could not initialize Git: {error} The new folder was kept at {}.",
            path.display()
        )
    })?;
    Ok(ProjectInfo {
        path: path.to_string_lossy().into_owned(),
        name: name.into(),
        branch: "main".into(),
    })
}

#[tauri::command]
pub async fn task_create_project(
    app: AppHandle,
    name: String,
    parent_path: Option<String>,
) -> Result<ProjectInfo, String> {
    validate_name(&name)?;
    let (parent, create_parent) = match parent_path {
        Some(path) => (PathBuf::from(path), false),
        None => (default_directory(&app)?, true),
    };
    tauri::async_runtime::spawn_blocking(move || {
        if create_parent {
            std::fs::create_dir_all(&parent).map_err(|_| {
                "Could not create the default projects folder. Choose another location.".to_string()
            })?;
        }
        create_project(&parent, &name)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_project_has_a_clean_main_branch_and_supports_the_first_worktree() {
        let parent =
            std::env::temp_dir().join(format!("jackalope-project-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&parent).unwrap();
        let info = create_project(&parent, "My new project").unwrap();
        let path = Path::new(&info.path);
        assert_eq!(info.branch, "main");
        assert_eq!(git(path, &["status", "--porcelain"]).unwrap(), "");
        assert_eq!(git(path, &["ls-tree", "HEAD"]).unwrap(), "");
        assert_eq!(git(path, &["rev-list", "--count", "HEAD"]).unwrap(), "1");
        let worktree = parent.join("first-task");
        git(
            path,
            &[
                "worktree",
                "add",
                "-b",
                "first-task",
                worktree.to_str().unwrap(),
            ],
        )
        .unwrap();
        assert!(worktree.join(".git").exists());
        std::fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn creation_preserves_existing_folders_and_rejects_path_escape() {
        let parent =
            std::env::temp_dir().join(format!("jackalope-project-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&parent).unwrap();
        let existing = parent.join("existing");
        std::fs::create_dir(&existing).unwrap();
        std::fs::write(existing.join("keep.txt"), "keep").unwrap();
        assert!(create_project(&parent, "existing")
            .unwrap_err()
            .contains("already exists"));
        assert_eq!(
            std::fs::read_to_string(existing.join("keep.txt")).unwrap(),
            "keep"
        );
        assert!(!existing.join(".git").exists());
        for name in [
            "",
            ".",
            "..",
            "../outside",
            "a/b",
            "a\\b",
            "C:outside",
            "NUL.txt",
            "LPT1",
            "trailing.",
        ] {
            assert!(validate_name(name).is_err(), "{name}");
        }
        assert!(create_project(&parent.join("missing"), "project").is_err());
        std::fs::remove_dir_all(parent).unwrap();
    }
}
