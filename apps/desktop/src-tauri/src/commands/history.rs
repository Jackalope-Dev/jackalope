use serde::Serialize;
use std::path::Path;

pub(super) fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err(format!("History exceeds the {limit}-byte load limit; the original remains available for recovery."));
    }
    Ok(bytes)
}

pub(super) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    replace_with(path, |file| std::io::Write::write_all(file, bytes))
        .map_err(|error| error.to_string())
}

fn replace_with(
    path: &Path,
    write: impl FnOnce(&mut std::fs::File) -> std::io::Result<()>,
) -> std::io::Result<()> {
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    let result = write(&mut file).and_then(|_| file.sync_all());
    drop(file);
    let result = result.and_then(|_| std::fs::rename(&temporary, path));
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecovery {
    pub directory: String,
    pub entries: Vec<HistoryRecoveryEntry>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecoveryEntry {
    pub path: String,
    pub reason: String,
    pub quarantined: bool,
}

pub(super) fn quarantine(path: &Path, reason: String) -> HistoryRecoveryEntry {
    let mut backup = path.with_extension("json.corrupt");
    loop {
        match std::fs::hard_link(path, &backup) {
            Ok(()) => break,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                backup = path.with_extension(format!("json.{}.corrupt", uuid::Uuid::new_v4()));
            }
            Err(error) => {
                return HistoryRecoveryEntry {
                    path: path.to_string_lossy().into_owned(),
                    reason: format!("{reason}. Could not set this file aside: {error}. The original remains in place."),
                    quarantined: false,
                };
            }
        }
    }
    match std::fs::remove_file(path) {
        Ok(()) => HistoryRecoveryEntry {
            path: backup.to_string_lossy().into_owned(),
            reason,
            quarantined: true,
        },
        Err(error) => HistoryRecoveryEntry {
            path: path.to_string_lossy().into_owned(),
            reason: format!(
                "{reason}. A backup was saved at {}, but the original could not be moved: {error}.",
                backup.display()
            ),
            quarantined: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_write_failure_keeps_the_previous_checkpoint() {
        use std::io::Write;
        let folder = std::env::temp_dir().join(format!("jackalope-write-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        let path = folder.join("record.json");
        write_atomic(&path, br#"{"result":"saved"}"#).unwrap();
        let result = replace_with(&path, |file| {
            file.write_all(b"partial")?;
            Err(std::io::Error::other("simulated storage full"))
        });
        assert!(result.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), br#"{"result":"saved"}"#);
        assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 1);
        write_atomic(&path, br#"{"result":"recovered"}"#).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), br#"{"result":"recovered"}"#);
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn failed_replacement_preserves_the_destination_and_cleans_its_temporary_file() {
        let folder =
            std::env::temp_dir().join(format!("jackalope-replace-{}", uuid::Uuid::new_v4()));
        let path = folder.join("record.json");
        std::fs::create_dir_all(&path).unwrap();
        assert!(write_atomic(&path, b"new record").is_err());
        assert!(path.is_dir());
        assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 1);
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn quarantine_preserves_existing_backups_and_original_bytes() {
        let folder =
            std::env::temp_dir().join(format!("jackalope-history-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        let source = folder.join("broken.json");
        let backup = folder.join("broken.json.corrupt");
        std::fs::write(&source, [0xff, 0x00, 0xfe]).unwrap();
        std::fs::write(&backup, b"earlier backup").unwrap();
        let entry = quarantine(&source, "Invalid history".into());
        assert!(entry.quarantined);
        assert_eq!(std::fs::read(&entry.path).unwrap(), [0xff, 0x00, 0xfe]);
        assert_eq!(std::fs::read(&backup).unwrap(), b"earlier backup");
        assert!(!source.exists());
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn quarantine_failure_reports_the_original_location() {
        let folder =
            std::env::temp_dir().join(format!("jackalope-history-{}", uuid::Uuid::new_v4()));
        let source = folder.join("directory.json");
        std::fs::create_dir_all(&source).unwrap();
        let entry = quarantine(&source, "Cannot read history".into());
        assert!(!entry.quarantined);
        assert_eq!(entry.path, source.to_string_lossy());
        assert!(entry.reason.contains("Could not set this file aside"));
        assert!(source.is_dir());
        std::fs::remove_dir_all(folder).unwrap();
    }
}
