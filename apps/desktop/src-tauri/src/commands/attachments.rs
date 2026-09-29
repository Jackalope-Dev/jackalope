//! Files a user attaches to a prompt. Existing files are referenced by path;
//! pasted images have no path, so they are written under the project's
//! `.jackalope/attachments` folder, which Git ignores through info/exclude.

use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

const FOLDER: &str = ".jackalope/attachments";
const MAX_BYTES: usize = 20 * 1024 * 1024;
const IMAGE_TYPES: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];

fn save_image(project: &Path, extension: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let extension = extension.trim_start_matches('.').to_ascii_lowercase();
    if !IMAGE_TYPES.contains(&extension.as_str()) {
        return Err("Only PNG, JPEG, GIF and WebP images can be pasted".into());
    }
    if bytes.is_empty() {
        return Err("The pasted image is empty".into());
    }
    if bytes.len() > MAX_BYTES {
        return Err("Pasted images can be up to 20 MB".into());
    }
    if !project.is_dir() {
        return Err("The project folder is no longer available".into());
    }
    let folder = project.join(FOLDER);
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    super::tasks::preparation::exclude_marker(project);
    let path = folder.join(format!("{}.{extension}", uuid::Uuid::new_v4()));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Saves a pasted image for the given project and returns its absolute path.
#[tauri::command]
pub async fn prompt_attachment_save(
    project_path: String,
    extension: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_image(Path::new(&project_path), &extension, &bytes)
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens the system file picker and returns the chosen files' paths.
#[tauri::command]
pub async fn prompt_attachment_pick(
    app: AppHandle,
    project_path: Option<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        if let Some(folder) = project_path.filter(|path| Path::new(path).is_dir()) {
            dialog = dialog.set_directory(folder);
        }
        dialog
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|file| {
                file.into_path()
                    .map(|path| path.to_string_lossy().into_owned())
                    .map_err(|e| e.to_string())
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pasted_images_are_bounded_typed_and_kept_in_the_project_folder() {
        let project =
            std::env::temp_dir().join(format!("jackalope-attachments-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&project).unwrap();
        let path = save_image(&project, "PNG", b"\x89PNG").unwrap();
        assert!(path.starts_with(project.join(FOLDER)));
        assert_eq!(path.extension().unwrap(), "png");
        assert_eq!(std::fs::read(&path).unwrap(), b"\x89PNG");
        assert!(save_image(&project, "exe", b"x")
            .unwrap_err()
            .contains("images"));
        assert!(save_image(&project, "png", b"")
            .unwrap_err()
            .contains("empty"));
        assert!(save_image(&project, "png", &vec![0; MAX_BYTES + 1])
            .unwrap_err()
            .contains("20 MB"));
        assert!(save_image(&project.join("missing"), "png", b"x")
            .unwrap_err()
            .contains("no longer"));
        std::fs::remove_dir_all(project).unwrap();
    }
}
