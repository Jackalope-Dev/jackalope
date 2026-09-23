use std::{io::Read, path::Path};

pub(super) fn read_screenshot(workspace: &Path, path: &Path) -> Result<Vec<u8>, String> {
    let root = workspace
        .join(".jackalope/artifacts/screenshots")
        .canonicalize()
        .map_err(|_| "The screenshot folder is no longer available".to_string())?;
    let path = path
        .canonicalize()
        .map_err(|_| "This screenshot is no longer available on disk".to_string())?;
    if !path.starts_with(root) {
        return Err("This screenshot is outside the task's evidence folder".into());
    }
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    const LIMIT: u64 = 8 * 1024 * 1024;
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("This screenshot is too large to preview (8 MB maximum)".into());
    }
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
