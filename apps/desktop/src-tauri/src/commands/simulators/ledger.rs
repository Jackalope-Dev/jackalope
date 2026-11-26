//! The devices Jackalope created, saved so it only ever shuts down or deletes
//! its own and never a device the person made.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub udid: String,
    pub name: String,
    /// The canonical workspace path the device belongs to.
    pub workspace: String,
    #[serde(default)]
    pub project_id: String,
    pub runtime: String,
    pub device_type: String,
    pub created_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Ledger {
    #[serde(default)]
    pub devices: Vec<Entry>,
}

pub fn path(root: &Path) -> PathBuf {
    root.join("devices.json")
}

/// A missing ledger is empty. An unreadable one is an error, so devices it
/// lists are not forgotten by a later write.
pub fn read(root: &Path) -> Result<Ledger, String> {
    match std::fs::read(path(root)) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("The Simulator ledger could not be read: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Ledger::default()),
        Err(error) => Err(format!("The Simulator ledger could not be read: {error}")),
    }
}

pub fn write(root: &Path, ledger: &Ledger) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec_pretty(ledger).map_err(|error| error.to_string())?;
    crate::commands::history::write_atomic(&path(root), &bytes)
}

impl Ledger {
    pub fn for_workspace(&self, workspace: &str) -> Option<&Entry> {
        self.devices
            .iter()
            .find(|entry| entry.workspace == workspace)
    }

    pub fn owns(&self, udid: &str) -> bool {
        self.devices.iter().any(|entry| entry.udid == udid)
    }

    pub fn remove(&mut self, udid: &str) {
        self.devices.retain(|entry| entry.udid != udid);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(udid: &str, workspace: &str) -> Entry {
        Entry {
            udid: udid.into(),
            name: format!("Jackalope {udid}"),
            workspace: workspace.into(),
            project_id: "p".into(),
            runtime: "r".into(),
            device_type: "t".into(),
            created_at: "2026-11-24T00:00:00Z".into(),
        }
    }

    #[test]
    fn round_trips_and_refuses_to_overwrite_an_unreadable_ledger() {
        let root = std::env::temp_dir().join(format!("jackalope-sims-{}", uuid::Uuid::new_v4()));
        assert!(read(&root).unwrap().devices.is_empty());
        let mut ledger = Ledger::default();
        ledger.devices.push(entry("A", "/w/a"));
        ledger.devices.push(entry("B", "/w/b"));
        write(&root, &ledger).unwrap();
        let mut saved = read(&root).unwrap();
        assert_eq!(saved.for_workspace("/w/b").unwrap().udid, "B");
        assert!(saved.owns("A") && !saved.owns("C"));
        saved.remove("A");
        assert_eq!(saved.devices, vec![entry("B", "/w/b")]);
        std::fs::write(path(&root), "{").unwrap();
        assert!(read(&root).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
