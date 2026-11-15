//! What each session file says about itself, kept between refreshes. A file is read
//! again only when its modification time or size changes; a growing file whose start
//! was already understood keeps its summary, since CLIs only append.

use super::{claude, codex, read, Summary};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

const VERSION: u32 = 1;
/// Store entries walked per account directory before a refresh stops looking.
const ENTRY_LIMIT: usize = 50_000;

/// A CLI whose session store Jackalope can read. Another CLI joins by adding its
/// layout and parser here.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Claude,
    Codex,
}

impl Source {
    pub const ALL: [Source; 2] = [Source::Claude, Source::Codex];

    pub fn adapter(self) -> &'static str {
        match self {
            Source::Claude => "claude",
            Source::Codex => "codex",
        }
    }

    pub fn roots(self, home: &Path) -> Vec<PathBuf> {
        match self {
            Source::Claude => claude::roots(home),
            Source::Codex => codex::roots(home),
        }
    }

    fn depth(self) -> usize {
        match self {
            Source::Claude => claude::DEPTH,
            Source::Codex => codex::DEPTH,
        }
    }

    fn is_session(self, name: &str) -> bool {
        match self {
            Source::Claude => claude::is_session(name),
            Source::Codex => codex::is_session(name),
        }
    }

    pub(super) fn summarize(self, path: &Path) -> Option<Summary> {
        let lines = read::lines(path, read::HEAD_BYTES)?;
        match self {
            Source::Claude => claude::summarize(lines),
            Source::Codex => codex::summarize(lines),
        }
    }

    pub(super) fn transcript(self, path: &Path) -> Option<read::Transcript> {
        let mut transcript = read::Transcript::default();
        for line in read::transcript_lines(path)? {
            match self {
                Source::Claude => claude::transcript(&line, &mut transcript),
                Source::Codex => codex::transcript(&line, &mut transcript),
            }
        }
        Some(transcript)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Entry {
    pub source: Source,
    pub home: PathBuf,
    pub modified_ms: u64,
    pub size: u64,
    /// None when the file is not a session Jackalope recognizes.
    pub summary: Option<Summary>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub(super) struct Index {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    pub files: BTreeMap<PathBuf, Entry>,
}

impl Index {
    /// The saved index, or an empty one when it is missing, unreadable or older.
    pub fn load(path: &Path) -> Self {
        super::super::history::read_bounded(path, 64 * 1024 * 1024)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Index>(&bytes).ok())
            .filter(|index| index.version == VERSION)
            .unwrap_or_default()
    }

    pub fn save(&mut self, path: &Path) -> Result<(), String> {
        self.version = VERSION;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let bytes = serde_json::to_vec(self).map_err(|error| error.to_string())?;
        super::super::history::write_atomic(path, &bytes)
    }

    /// Brings the index up to date with the stores of `homes`, reading only new and
    /// changed files. Files that are gone, or belong to a store no longer read, are
    /// dropped. Returns whether anything changed.
    pub fn refresh(&mut self, homes: &[(Source, PathBuf)]) -> bool {
        let mut seen = HashSet::new();
        let mut changed = false;
        for (source, home) in homes {
            let mut budget = ENTRY_LIMIT;
            for root in source.roots(home) {
                walk(
                    &root,
                    source.depth(),
                    &mut budget,
                    &mut |path, modified_ms, size| {
                        if !source
                            .is_session(&path.file_name().unwrap_or_default().to_string_lossy())
                        {
                            return;
                        }
                        seen.insert(path.to_path_buf());
                        changed |= self.update(*source, home, path, modified_ms, size);
                    },
                );
            }
        }
        let before = self.files.len();
        self.files.retain(|path, _| seen.contains(path));
        changed || self.files.len() != before
    }

    fn update(
        &mut self,
        source: Source,
        home: &Path,
        path: &Path,
        modified_ms: u64,
        size: u64,
    ) -> bool {
        if let Some(entry) = self
            .files
            .get_mut(path)
            .filter(|entry| entry.source == source && entry.home == home)
        {
            if entry.modified_ms == modified_ms && entry.size == size {
                return false;
            }
            let appended = size >= entry.size
                && !path.to_string_lossy().ends_with(".zst")
                && entry
                    .summary
                    .as_ref()
                    .is_some_and(|summary| summary.title.is_some());
            if appended {
                entry.modified_ms = modified_ms;
                entry.size = size;
                return true;
            }
        }
        self.files.insert(
            path.to_path_buf(),
            Entry {
                source,
                home: home.to_path_buf(),
                modified_ms,
                size,
                summary: source.summarize(path),
            },
        );
        true
    }
}

/// Visits regular files up to `depth` levels below `directory` without following links.
fn walk(
    directory: &Path,
    depth: usize,
    budget: &mut usize,
    visit: &mut dyn FnMut(&Path, u64, u64),
) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let Some(left) = budget.checked_sub(1) else {
            return;
        };
        *budget = left;
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            if depth > 1 {
                walk(&entry.path(), depth - 1, budget, visit);
            }
        } else if kind.is_file() {
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            let modified_ms = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |since| since.as_millis() as u64);
            visit(&entry.path(), modified_ms, metadata.len());
        }
    }
}
