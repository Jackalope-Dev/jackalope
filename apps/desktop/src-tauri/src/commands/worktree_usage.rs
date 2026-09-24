use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsage {
    bytes: u64,
    files: usize,
    partial: bool,
    skipped_links: usize,
}

fn linked(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

fn measure(root: &Path, limit: usize, timeout: Duration) -> Result<DiskUsage, String> {
    let start = Instant::now();
    let mut result = DiskUsage::default();
    let mut visited = 0;
    let mut pending: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    while let Some((directory, depth)) = pending.pop() {
        if start.elapsed() > timeout || visited >= limit {
            result.partial = true;
            break;
        }
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if directory == root => return Err(error.to_string()),
            Err(_) => {
                result.partial = true;
                continue;
            }
        };
        for entry in entries {
            if start.elapsed() > timeout || visited >= limit {
                result.partial = true;
                break;
            }
            visited += 1;
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    result.partial = true;
                    continue;
                }
            };
            if entry.file_name() == ".git" {
                continue;
            }
            let metadata = match std::fs::symlink_metadata(entry.path()) {
                Ok(metadata) => metadata,
                Err(_) => {
                    result.partial = true;
                    continue;
                }
            };
            if linked(&metadata) {
                result.skipped_links += 1;
                continue;
            }
            if metadata.is_file() {
                result.bytes = result.bytes.saturating_add(metadata.len());
                result.files += 1;
            } else if metadata.is_dir() {
                if depth >= 32 {
                    result.partial = true;
                } else {
                    pending.push((entry.path(), depth + 1));
                }
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn git_worktree_usage(
    repo_path: String,
    worktree_path: String,
) -> Result<DiskUsage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = dunce::canonicalize(&worktree_path).map_err(|e| e.to_string())?;
        let registered = super::git::list_worktrees(&repo_path)?;
        if !registered
            .iter()
            .any(|entry| dunce::canonicalize(&entry.path).ok().as_ref() == Some(&root))
        {
            return Err(
                "Choose a registered worktree and refresh before inspecting its size.".into(),
            );
        }
        measure(&root, 100_000, Duration::from_secs(5))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_files_excludes_git_and_bounds_work() {
        let root = std::env::temp_dir().join(format!("jackalope-usage-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/objects"), [0; 40]).unwrap();
        std::fs::write(root.join("file"), [0; 10]).unwrap();
        let usage = measure(&root, 100, Duration::from_secs(2)).unwrap();
        assert_eq!(usage.bytes, 10);
        assert_eq!(usage.files, 1);
        assert!(!usage.partial);
        assert!(measure(&root, 0, Duration::from_secs(2)).unwrap().partial);
        std::fs::remove_dir_all(root).unwrap();
    }
}
