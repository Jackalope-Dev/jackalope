//! Input history kept across launches, like a shell's, in the profile's
//! preferences. Every terminal appends to the same file; each one reads it once
//! at start and then keeps its own order.

use crate::prefs;

/// Entries kept on disk; the oldest are dropped first.
const KEPT: usize = 1000;
const FILE: &str = "cli-history.json";

pub fn load() -> Vec<String> {
    prefs::read_json(FILE).unwrap_or_default()
}

/// Whether a submitted line belongs in history. As in shells, a leading space
/// keeps a line out, for commands that carry a secret.
pub fn keep(raw: &str) -> bool {
    !raw.starts_with(' ') && !raw.trim().is_empty()
}

/// Adds `entry` to the saved history. Terminals open side by side each
/// re-read under a lock first, so none overwrites another's lines.
pub fn append(entry: &str) {
    let Some(lock_path) = prefs::path("cli-history.lock") else {
        return;
    };
    if let Some(parent) = lock_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // Closing the file releases the lock. Without one, save anyway: losing a
    // line to a race beats losing it outright.
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock_path);
    if let Ok(file) = &lock {
        let _ = file.lock();
    }
    let mut entries = load();
    remember(&mut entries, entry);
    let _ = prefs::write_json(FILE, &entries);
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

    #[test]
    fn a_leading_space_keeps_a_line_private() {
        assert!(keep("!deploy"));
        assert!(!keep(" !export TOKEN=secret"));
        assert!(!keep("   "));
    }
}
