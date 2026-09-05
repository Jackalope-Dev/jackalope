use super::{coordination::Coordinator, tasks::TaskRuntime};
use crate::state::AppState;
use std::path::Path;
use tauri::{Manager, State};

pub const RESET_MARKER: &str = "reset-requested";

pub(super) fn reject_links(path: &Path) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("Reset cannot traverse a linked storage folder.".into());
        }
    }
    if metadata.file_type().is_symlink() {
        return Err("Reset cannot traverse a linked storage folder.".into());
    }
    if metadata.is_dir() {
        for child in std::fs::read_dir(path).map_err(|e| e.to_string())? {
            reject_links(&child.map_err(|e| e.to_string())?.path())?;
        }
    }
    Ok(())
}

pub fn reset_on_startup(directory: &Path) -> Result<bool, String> {
    if !directory.join(RESET_MARKER).exists() {
        return Ok(false);
    }
    reject_links(directory)?;
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(directory.join("runtime.lock"))
        .map_err(|e| e.to_string())?;
    lock.try_lock()
        .map_err(|_| "Close the other Jackalope instance before resetting.".to_string())?;
    let coordinator_lock = if directory.join("coordination/owner.lock").exists() {
        let owner = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(directory.join("coordination/owner.lock"))
            .map_err(|e| e.to_string())?;
        owner
            .try_lock()
            .map_err(|_| "The task coordinator is still running.".to_string())?;
        Some(owner)
    } else {
        None
    };
    for child in std::fs::read_dir(directory).map_err(|e| e.to_string())? {
        let child = child.map_err(|e| e.to_string())?;
        if ["runtime.lock", RESET_MARKER, "coordination"]
            .contains(&child.file_name().to_string_lossy().as_ref())
        {
            continue;
        }
        remove_entry(&child.path())?;
    }
    let coordination = directory.join("coordination");
    if coordination.exists() {
        for child in std::fs::read_dir(&coordination).map_err(|e| e.to_string())? {
            let child = child.map_err(|e| e.to_string())?;
            if child.file_name() != "owner.lock" {
                remove_entry(&child.path())?;
            }
        }
    }
    drop(coordinator_lock);
    Ok(true)
}

fn remove_entry(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn app_reset(
    confirmation: String,
    app: tauri::AppHandle,
    coordinator: State<'_, Coordinator>,
    runtime: State<'_, TaskRuntime>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if confirmation != "RESET" {
        return Err("Type RESET to confirm.".into());
    }
    if !state
        .pty_sessions
        .lock()
        .map_err(|e| e.to_string())?
        .is_empty()
    {
        return Err("Stop terminal agent sessions before resetting.".into());
    }
    coordinator.prepare_reset()?;
    runtime.stop_all();
    app.restart();
}

#[tauri::command]
pub fn app_finish_reset(app: tauri::AppHandle) -> Result<(), String> {
    let directory = app
        .state::<TaskRuntime>()
        .integration_directory()
        .parent()
        .unwrap()
        .to_path_buf();
    let marker = directory.join(RESET_MARKER);
    if marker.exists() {
        std::fs::remove_file(marker).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reset_erases_only_owned_data_and_waits_for_owner() {
        let parent = std::env::temp_dir().join(format!("jackalope-reset-{}", uuid::Uuid::new_v4()));
        let directory = parent.join("task-runs-v1");
        std::fs::create_dir_all(directory.join("coordination")).unwrap();
        std::fs::write(parent.join("repository.txt"), "keep").unwrap();
        std::fs::write(directory.join(RESET_MARKER), "reset").unwrap();
        std::fs::write(directory.join("history.json"), "private history").unwrap();
        std::fs::write(directory.join("coordination/queue.json"), "queue").unwrap();
        std::fs::write(directory.join("coordination/owner.lock"), "").unwrap();
        let owner = std::fs::File::create(directory.join("runtime.lock")).unwrap();
        owner.try_lock().unwrap();
        assert!(reset_on_startup(&directory).is_err());
        assert!(directory.join("history.json").exists());
        drop(owner);
        assert!(reset_on_startup(&directory).unwrap());
        assert!(!directory.join("history.json").exists());
        assert!(!directory.join("coordination/queue.json").exists());
        assert!(parent.join("repository.txt").exists());
        assert!(directory.join(RESET_MARKER).exists());
        std::fs::remove_dir_all(parent).unwrap();
    }
}
