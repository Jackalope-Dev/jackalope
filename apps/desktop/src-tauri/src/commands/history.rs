use serde::Serialize;
use std::path::Path;

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
