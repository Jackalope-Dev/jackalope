use super::*;

pub(crate) struct UseGuard {
    _lock: FileLock,
}

fn lock(path: &Path) -> Result<File, String> {
    File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|e| e.to_string())
}

pub(super) fn acquire_in(root: &Path, executable: &Path) -> Result<Option<UseGuard>, String> {
    if !executable.starts_with(root) {
        return Ok(None);
    }
    let directory = executable.parent().ok_or("Invalid runner path.")?;
    if directory.parent() != Some(root) || executable.file_name() != Some(BINARY.as_ref()) {
        return Err("Invalid private runner path.".into());
    }
    let _gate = FileLock::try_new(lock(&root.join("lifecycle.lock"))?)
        .map_err(|_| "Runner maintenance is in progress. Retry when it finishes.")?;
    if fs::symlink_metadata(directory)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
        || directory
            .canonicalize()
            .map_err(|e| e.to_string())?
            .parent()
            != Some(root.canonicalize().map_err(|e| e.to_string())?.as_path())
        || !executable.is_file()
    {
        return Err("The private runner was removed or changed. Prepare it again.".into());
    }
    let lease = FileLock::try_shared(lock(&directory.join("use.lock"))?)
        .map_err(|_| "This runner is being removed. Retry when maintenance finishes.")?;
    Ok(Some(UseGuard { _lock: lease }))
}

pub(crate) fn acquire(executable: &Path) -> Result<Option<UseGuard>, String> {
    ROOT.get()
        .map(|root| acquire_in(root, executable))
        .unwrap_or(Ok(None))
}

pub(super) fn disk_bytes(root: &Path) -> Result<u64, String> {
    if !root.exists() {
        return Ok(0);
    }
    let mut total = 0u64;
    for directory in fs::read_dir(root).map_err(|e| e.to_string())? {
        let directory = directory.map_err(|e| e.to_string())?;
        if !directory.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        for file in fs::read_dir(directory.path()).map_err(|e| e.to_string())? {
            let file = file.map_err(|e| e.to_string())?;
            if file.file_type().map_err(|e| e.to_string())?.is_file() {
                total = total.saturating_add(file.metadata().map_err(|e| e.to_string())?.len());
            }
        }
    }
    Ok(total)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cleanup {
    removed: u32,
    retained: u32,
}

pub(super) fn cleanup(root: &Path, remove_active: bool) -> Result<Cleanup, String> {
    if !root.exists() {
        return Ok(Cleanup {
            removed: 0,
            retained: 0,
        });
    }
    let _install = FileLock::try_new(lock(&root.join("install.lock"))?)
        .map_err(|_| "Wait for runner setup to finish before cleaning up.")?;
    let _gate = FileLock::try_new(lock(&root.join("lifecycle.lock"))?)
        .map_err(|_| "Runner maintenance is already in progress.")?;
    let active_path = root.join("active.json");
    let active = if active_path.exists() {
        serde_json::from_slice::<receipt::Receipt>(&history::read_bounded(&active_path, 8192)?).ok()
    } else {
        None
    };
    let mut result = Cleanup {
        removed: 0,
        retained: 0,
    };
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if uuid::Uuid::parse_str(&name).is_err() {
            continue;
        }
        let directory = entry.path();
        let is_active = active
            .as_ref()
            .is_some_and(|receipt| receipt.installation == name);
        if (is_active && !remove_active)
            || !entry.file_type().map_err(|e| e.to_string())?.is_dir()
            || directory
                .canonicalize()
                .map_err(|e| e.to_string())?
                .parent()
                != Some(root.canonicalize().map_err(|e| e.to_string())?.as_path())
        {
            result.retained += 1;
            continue;
        }
        let files = fs::read_dir(&directory)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if files.iter().any(|file| {
            !file.file_type().is_ok_and(|kind| kind.is_file())
                || ![BINARY, "LICENSE", "download.tgz", "use.lock"]
                    .contains(&file.file_name().to_string_lossy().as_ref())
        }) {
            result.retained += 1;
            continue;
        }
        let Ok(lease) = FileLock::try_new(lock(&directory.join("use.lock"))?) else {
            result.retained += 1;
            continue;
        };
        if is_active {
            fs::remove_file(&active_path).map_err(|e| e.to_string())?;
        }
        for file in files {
            if file.file_name() != "use.lock" {
                fs::remove_file(file.path()).map_err(|e| e.to_string())?;
            }
        }
        drop(lease);
        fs::remove_file(directory.join("use.lock")).map_err(|e| e.to_string())?;
        fs::remove_dir(directory).map_err(|e| e.to_string())?;
        result.removed += 1;
    }
    // An unreadable receipt cannot be used to launch a runner or identify a version to keep.
    if remove_active && active.is_none() && active_path.exists() {
        fs::remove_file(active_path).map_err(|e| e.to_string())?;
    }
    Ok(result)
}

pub async fn managed_runtime_cleanup(remove_active: bool) -> Result<Cleanup, String> {
    let root = ROOT
        .get()
        .ok_or("Private runner storage is unavailable.")?
        .clone();
    tauri::async_runtime::spawn_blocking(move || cleanup(&root, remove_active))
        .await
        .map_err(|e| e.to_string())?
}
