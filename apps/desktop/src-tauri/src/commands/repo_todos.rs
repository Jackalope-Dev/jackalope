use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const TODO_FILES: [&str; 6] = [
    "TODO.md",
    "TASKS.md",
    "ROADMAP.md",
    "docs/TODO.md",
    "docs/TASKS.md",
    "docs/ROADMAP.md",
];
const LIMIT: usize = 262144;
static SAVE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
pub struct TodoDocument {
    path: String,
    content: Option<String>,
    error: Option<String>,
}

fn document_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if !TODO_FILES.contains(&relative) {
        return Err("Unsupported TODO file.".into());
    }
    let root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let mut path = root.clone();
    for component in relative.split('/') {
        path.push(component);
        match std::fs::symlink_metadata(&path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err("Linked TODO files or folders cannot be edited here.".into());
                }
                let resolved = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
                if !resolved.starts_with(&root) {
                    return Err("TODO file resolves outside the project.".into());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(path)
}

fn read_document(path: &Path) -> Result<Option<String>, String> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("The TODO path is not a regular file.".into());
    }
    let mut content = String::new();
    file.take((LIMIT + 1) as u64)
        .read_to_string(&mut content)
        .map_err(|e| e.to_string())?;
    if content.len() > LIMIT {
        return Err("TODO file exceeds 256 KiB. Edit it in your code editor.".into());
    }
    Ok(Some(content))
}

#[tauri::command]
pub async fn repo_todos_read(project_path: String) -> Result<Vec<TodoDocument>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = std::fs::canonicalize(project_path).map_err(|e| e.to_string())?;
        if !root.is_dir() {
            return Err("Choose a repository folder.".into());
        }
        Ok(TODO_FILES
            .iter()
            .map(|relative| {
                let result = document_path(&root, relative).and_then(|path| read_document(&path));
                match result {
                    Ok(content) => TodoDocument {
                        path: relative.to_string(),
                        content,
                        error: None,
                    },
                    Err(error) => TodoDocument {
                        path: relative.to_string(),
                        content: None,
                        error: Some(error),
                    },
                }
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn save_document(
    root: &Path,
    relative: &str,
    expected: Option<&str>,
    content: &str,
) -> Result<(), String> {
    let _guard = SAVE_LOCK.lock().map_err(|e| e.to_string())?;
    if content.len() > LIMIT {
        return Err("TODO file exceeds 256 KiB.".into());
    }
    let path = document_path(root, relative)?;
    if read_document(&path)?.as_deref() != expected {
        return Err("This file changed outside Jackalope. Your draft is kept. Copy your draft, then reload the file to reconcile the changes.".into());
    }
    let permissions = if expected.is_some() {
        let permissions = std::fs::metadata(&path)
            .map_err(|e| e.to_string())?
            .permissions();
        if permissions.readonly() {
            return Err("This TODO file is read-only.".into());
        }
        Some(permissions)
    } else {
        None
    };
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<(), String> {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        if let Some(permissions) = permissions {
            file.set_permissions(permissions)
                .map_err(|e| e.to_string())?;
        }
        file.write_all(content.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        document_path(root, relative)?;
        if read_document(&path)?.as_deref() != expected {
            return Err("This file changed while saving. Your draft is kept; reload the file before trying again.".into());
        }
        if expected.is_none() {
            // Publish the complete file exclusively; never replace a concurrently created list.
            std::fs::hard_link(&temporary, &path).map_err(|e| e.to_string())?;
        } else {
            std::fs::rename(&temporary, &path).map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    let _ = std::fs::remove_file(&temporary);
    result?;
    Ok(())
}

#[tauri::command]
pub async fn repo_todos_save(
    project_path: String,
    relative_path: String,
    expected_content: Option<String>,
    content: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_document(
            Path::new(&project_path),
            &relative_path,
            expected_content.as_deref(),
            &content,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saves_creates_and_rejects_stale_edits_without_touching_files() {
        let root = std::env::temp_dir().join(format!("jackalope-todos-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let first = "# TODO\r\n- [ ] First\r\n";
        save_document(&root, "TODO.md", None, first).unwrap();
        assert!(save_document(&root, "TODO.md", None, "overwrite").is_err());
        save_document(&root, "TODO.md", Some(first), "# Updated\n").unwrap();
        assert!(save_document(&root, "TODO.md", Some(first), "stale").is_err());
        assert_eq!(
            read_document(&root.join("TODO.md")).unwrap().unwrap(),
            "# Updated\n"
        );
        assert!(save_document(&root, "../TODO.md", None, "escape").is_err());
        assert!(save_document(&root, "AGENTS.md", None, "unrelated").is_err());
        assert!(save_document(&root, "TASKS.md", None, &"x".repeat(LIMIT + 1)).is_err());
        std::fs::create_dir(root.join("docs")).unwrap();
        save_document(&root, "docs/ROADMAP.md", None, "").unwrap();
        assert_eq!(
            read_document(&root.join("docs/ROADMAP.md")).unwrap(),
            Some("".into())
        );
        std::fs::write(root.join("TASKS.md"), [0xff]).unwrap();
        assert!(save_document(&root, "TASKS.md", None, "bad encoding").is_err());
        assert_eq!(std::fs::read(root.join("TASKS.md")).unwrap(), [0xff]);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn linked_folders_cannot_redirect_writes() {
        let root =
            std::env::temp_dir().join(format!("jackalope-todo-links-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("outside")).unwrap();
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_dir(root.join("outside"), root.join("docs"));
        #[cfg(not(windows))]
        let linked = std::os::unix::fs::symlink(root.join("outside"), root.join("docs"));
        if linked.is_ok() {
            assert!(save_document(&root, "docs/TODO.md", None, "escape").is_err());
            assert!(!root.join("outside/TODO.md").exists());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
