//! Quick-open support: list a project's files and open one in the user's editor.

use super::git_command::{command, Policy};
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const MAX_FILES: usize = 50_000;

fn list(project: &Path) -> Result<Vec<String>, String> {
    if !project.is_dir() {
        return Err("The project folder is no longer available".into());
    }
    let output = command(
        project,
        &[
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
        Policy::Inspection,
    )
    .output()
    .map_err(|e| format!("Git is unavailable: {e}"))?;
    if !output.status.success() {
        return Err("File search needs a Git repository".into());
    }
    let mut files: Vec<String> = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .take(MAX_FILES)
        .map(|entry| String::from_utf8_lossy(entry).into_owned())
        .collect();
    files.sort_unstable();
    files.dedup();
    Ok(files)
}

/// Tracked and untracked, non-ignored files, relative to the project root.
#[tauri::command]
pub async fn project_files_list(project_path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || list(Path::new(&project_path)))
        .await
        .map_err(|e| e.to_string())?
}

fn resolve(project: &Path, relative: &str) -> Result<std::path::PathBuf, String> {
    let root = dunce::canonicalize(project).map_err(|_| "The project folder is unavailable")?;
    let file =
        dunce::canonicalize(root.join(relative)).map_err(|_| "This file is no longer available")?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err("Only files inside the project can be opened".into());
    }
    Ok(file)
}

#[tauri::command]
pub async fn project_file_open(
    app: AppHandle,
    project_path: String,
    relative_path: String,
    editor: String,
) -> Result<(), String> {
    if !["vscode", "cursor"].contains(&editor.as_str()) {
        return Err("Choose VS Code or Cursor.".into());
    }
    let file = resolve(Path::new(&project_path), &relative_path)?;
    let mut url = reqwest::Url::parse(&format!("{editor}://file/")).map_err(|e| e.to_string())?;
    url.set_path(&file.to_string_lossy().replace('\\', "/"));
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| format!("Could not open the editor. Check that it is installed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_repository_files_and_confines_opened_paths() {
        let root = std::env::temp_dir().join(format!("jackalope-files-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src")).unwrap();
        let run = |args: &[&str]| {
            assert!(command(&root, args, Policy::Isolated)
                .output()
                .unwrap()
                .status
                .success())
        };
        run(&["init", "-q"]);
        std::fs::write(root.join("src/app.ts"), "x").unwrap();
        std::fs::write(root.join("notes.md"), "x").unwrap();
        std::fs::write(root.join(".gitignore"), "ignored.log\n").unwrap();
        std::fs::write(root.join("ignored.log"), "x").unwrap();
        assert_eq!(
            list(&root).unwrap(),
            vec![".gitignore", "notes.md", "src/app.ts"]
        );
        assert!(resolve(&root, "src/app.ts").is_ok());
        assert!(resolve(&root, "../outside.txt").is_err());
        assert!(resolve(&root, "src").is_err());
        std::fs::remove_dir_all(&root).unwrap();
        assert!(list(&root).is_err());
    }
}
