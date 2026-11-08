//! An agent's saved output in its workspace, and the screenshot evidence every
//! browser and desktop tool saves there.

use super::{computers::protocol::protocol, harness::ScreenshotArtifact};
use std::path::{Path, PathBuf};

/// Where an agent's saved output lives in a workspace.
pub(crate) const FOLDER: &str = ".jackalope/artifacts/";

/// The screenshot evidence folder, relative to the workspace.
pub(crate) fn screenshot_folder() -> &'static str {
    &protocol().screenshots.folder
}

/// The largest screenshot saved or previewed.
pub(crate) fn screenshot_limit() -> u64 {
    protocol().screenshots.limit
}

fn screenshots(workspace: &Path) -> PathBuf {
    workspace.join(screenshot_folder())
}

/// Saves a PNG capture as screenshot evidence in the workspace. `url` names
/// what was captured, such as a page address or `desktop://granted`.
pub(crate) fn save_screenshot(
    workspace: &Path,
    bytes: &[u8],
    name: &str,
    url: &str,
) -> Result<ScreenshotArtifact, String> {
    if bytes.len() as u64 > screenshot_limit() {
        return Err("The capture exceeds the 8 MiB preview limit.".into());
    }
    let (width, height) = super::harness::png_dimensions(bytes)?;
    let id = uuid::Uuid::new_v4().to_string();
    let directory = screenshots(workspace);
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let file = directory.join(format!("{id}.png"));
    std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
    Ok(ScreenshotArtifact {
        id,
        name: name.into(),
        url: url.into(),
        file_path: file.to_string_lossy().into_owned(),
        width,
        height,
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}

/// The workspace's screenshot evidence folder, created when missing and
/// confirmed to resolve inside the workspace, for captures saved by hand.
pub(crate) fn evidence_folder(workspace: &Path) -> Result<PathBuf, String> {
    let workspace = dunce::canonicalize(workspace).map_err(|e| e.to_string())?;
    let directory = screenshots(&workspace);
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    if !dunce::canonicalize(&directory)
        .map_err(|e| e.to_string())?
        .starts_with(&workspace)
    {
        return Err("The artifact folder resolves outside this workspace.".into());
    }
    Ok(directory)
}

pub(super) fn read_screenshot(workspace: &Path, path: &Path) -> Result<Vec<u8>, String> {
    let root = screenshots(workspace)
        .canonicalize()
        .map_err(|_| "The screenshot folder is no longer available".to_string())?;
    let path = path
        .canonicalize()
        .map_err(|_| "This screenshot is no longer available on disk".to_string())?;
    if !path.starts_with(root) {
        return Err("This screenshot is outside the task's evidence folder".into());
    }
    let bytes = match super::history::read_capped(&path, screenshot_limit()) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => return Err("This screenshot is no longer available on disk".into()),
        Err(error) if error.kind() == std::io::ErrorKind::InvalidData => {
            return Err("This screenshot is too large to preview (8 MB maximum)".into())
        }
        Err(error) => return Err(error.to_string()),
    };
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return Err("This file is not a readable PNG screenshot".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screenshot_preview_is_bounded_and_confined_to_task_evidence() {
        let folder =
            std::env::temp_dir().join(format!("jackalope-artifacts-{}", uuid::Uuid::new_v4()));
        let root = folder.join(".jackalope/artifacts/screenshots");
        std::fs::create_dir_all(&root).unwrap();
        let screenshot = root.join("capture.png");
        let mut png = vec![0; 24];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[12..16].copy_from_slice(b"IHDR");
        std::fs::write(&screenshot, &png).unwrap();
        assert_eq!(read_screenshot(&folder, &screenshot).unwrap(), png);
        let outside = folder.join("private.png");
        std::fs::write(&outside, &png).unwrap();
        assert!(read_screenshot(&folder, &outside)
            .unwrap_err()
            .contains("outside"));
        assert!(read_screenshot(&folder, &root.join("missing.png"))
            .unwrap_err()
            .contains("no longer"));
        std::fs::write(&screenshot, b"not an image").unwrap();
        assert!(read_screenshot(&folder, &screenshot)
            .unwrap_err()
            .contains("PNG"));
        std::fs::File::create(&screenshot)
            .unwrap()
            .set_len(8 * 1024 * 1024 + 1)
            .unwrap();
        assert!(read_screenshot(&folder, &screenshot)
            .unwrap_err()
            .contains("too large"));
        std::fs::remove_dir_all(folder).unwrap();
    }
}
