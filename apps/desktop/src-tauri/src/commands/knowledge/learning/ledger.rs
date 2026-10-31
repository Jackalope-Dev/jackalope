//! Append-only history of learned lessons: one JSON line per change, one file
//! per project. Records are never rewritten. Evidence excerpts are redacted
//! and kept only here, apart from the entry, so lesson sync omits them.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Past this size the file is moved aside (replacing the previous one) and a
/// new file starts, bounding history to two files per project.
const ROTATE_BYTES: u64 = 1_000_000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LedgerRecord {
    pub id: String,
    pub entry_id: String,
    pub project_id: String,
    pub at: String,
    /// `born`, `merged`, `patched`, `retired`, `promoted`, `archived`,
    /// `restored`, `edited`, `deleted`, `curated` (folded by the curator),
    /// `missed` (restated after it was supplied), `contradicted`, `stale`
    /// (names something the project no longer has), `enforced` (a repository
    /// check now enforces it), `unenforced` (that check is gone) or
    /// `unreported` (an accepted check task named no enforcer).
    pub action: String,
    pub reason: String,
    /// The entry revision after the change.
    #[serde(default)]
    pub revision: u64,
    /// `reflection`, `session`, `agent`, `curator`, `lifecycle` or `user`.
    #[serde(default)]
    pub origin: String,
    /// The entry title when the change was made.
    #[serde(default)]
    pub title: String,
    /// Redacted `reference: excerpt` lines.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub evidence: Vec<String>,
}

fn file(directory: &Path, project_id: &str) -> PathBuf {
    let hash = Sha256::digest(project_id.as_bytes());
    let name: String = hash[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    directory.join(format!("{name}.jsonl"))
}

fn rotated(path: &Path) -> PathBuf {
    path.with_extension("1.jsonl")
}

pub(super) fn append(directory: &Path, records: &[LedgerRecord]) -> Result<(), String> {
    if records.is_empty() {
        return Ok(());
    }
    std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let mut projects: Vec<&str> = records.iter().map(|r| r.project_id.as_str()).collect();
    projects.sort();
    projects.dedup();
    for project in projects {
        let path = file(directory, project);
        if std::fs::metadata(&path).is_ok_and(|meta| meta.len() > ROTATE_BYTES) {
            std::fs::rename(&path, rotated(&path)).map_err(|e| e.to_string())?;
        }
        let mut text = String::new();
        for record in records.iter().filter(|r| r.project_id == project) {
            text.push_str(&serde_json::to_string(record).map_err(|e| e.to_string())?);
            text.push('\n');
        }
        // One write per batch keeps a batch's lines together.
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .and_then(|mut handle| handle.write_all(text.as_bytes()))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Every retained record for a project, oldest first. Unreadable lines, such
/// as one cut short by a crash, are skipped.
pub(super) fn read_project(directory: &Path, project_id: &str) -> Vec<LedgerRecord> {
    let path = file(directory, project_id);
    [rotated(&path), path]
        .iter()
        .filter_map(|path| crate::commands::history::read_bounded(path, 2 * ROTATE_BYTES).ok())
        .flat_map(|bytes| {
            String::from_utf8_lossy(&bytes)
                .lines()
                .filter_map(|line| serde_json::from_str::<LedgerRecord>(line).ok())
                .filter(|record| record.project_id == project_id)
                .collect::<Vec<_>>()
        })
        .collect()
}

/// The newest `limit` records for an entry, oldest first.
pub(super) fn read(
    directory: &Path,
    project_id: &str,
    entry_id: &str,
    limit: usize,
) -> Vec<LedgerRecord> {
    let mut found: Vec<LedgerRecord> = read_project(directory, project_id)
        .into_iter()
        .filter(|record| record.entry_id == entry_id)
        .collect();
    let skip = found.len().saturating_sub(limit);
    found.drain(..skip);
    found
}
