//! Input history kept across launches, like a shell's, in the profile's
//! preferences. Every terminal appends to the same file; each one reads it once
//! at start and then keeps its own order.

use crate::protocol::profile_root;
use std::path::PathBuf;

/// Entries kept on disk; the oldest are dropped first.
const KEPT: usize = 1000;

fn path() -> Option<PathBuf> {
    Some(profile_root()?.join("task-runs-v1/preferences/cli-history.json"))
}

pub fn load() -> Vec<String> {
    path()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<Vec<String>>(&bytes).ok())
        .unwrap_or_default()
}

/// Adds `entry` to the saved history, re-reading it first so terminals open
/// side by side do not overwrite each other's lines.
pub fn append(entry: &str) {
    let Some(path) = path() else {
        return;
    };
    let mut entries = load();
    remember(&mut entries, entry);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(encoded) = serde_json::to_vec(&entries) {
        // Write beside the file, then rename, so a crash never leaves half a list.
        let partial = path.with_extension("json.partial");
        if std::fs::write(&partial, encoded).is_ok() {
            let _ = std::fs::rename(partial, path);
        }
    }
}

/// Moves `entry` to the newest position, without duplicates, within the cap.
pub fn remember(entries: &mut Vec<String>, entry: &str) {
    entries.retain(|existing| existing != entry);
    entries.push(entry.to_string());
    if entries.len() > KEPT {
        let excess = entries.len() - KEPT;
        entries.drain(..excess);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remembering_moves_repeats_to_the_end_and_caps_the_list() {
        let mut entries = vec!["a".to_string(), "b".into(), "c".into()];
        remember(&mut entries, "a");
        assert_eq!(entries, ["b", "c", "a"]);
        for index in 0..KEPT + 5 {
            remember(&mut entries, &index.to_string());
        }
        assert_eq!(entries.len(), KEPT);
        assert_eq!(entries.last().unwrap(), &(KEPT + 4).to_string());
    }
}
