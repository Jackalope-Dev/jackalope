//! Importing Claude Code and Codex conversations into Jackalope, so a person's history is
//! here even when the CLI's own files are later compressed, archived or deleted.
//!
//! A scan reads every session store the import knows about (each CLI's default directory
//! as well as the accounts Jackalope uses) and groups the sessions by the project or
//! repository they ran in. Importing copies a session's transcript into the profile's
//! `imported-conversations` folder: one transcript file per conversation and a small index
//! of what was imported from where. Source files are only read.
//!
//! The index's lock makes it the one writer of that folder: a transcript is written before
//! the index names it, so the index never points at a missing or partial transcript.
//! Importing the same session again replaces its copy when the source has changed since,
//! and leaves one that was continued in Jackalope alone, because its CLI session now also
//! holds Jackalope's own turns.

use super::{
    index::{Index, Source},
    project_for,
    read::{Transcript, TranscriptEntry},
    same_directory, Accounts, ExternalSession, Location, ProjectFolder, Scope, Summary, SUBFOLDER,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, PoisonError,
    },
    time::{Duration, UNIX_EPOCH},
};

const VERSION: u32 = 1;
/// Decompressed bytes read from one session file.
const SOURCE_BYTES: u64 = 1024 * 1024 * 1024;
/// The newest entries an imported transcript keeps; earlier ones are counted.
const ENTRIES: usize = 20_000;
/// The largest saved transcript; longer ones keep their newest entries.
const TRANSCRIPT_BYTES: usize = 64 * 1024 * 1024;
const INDEX_BYTES: u64 = 32 * 1024 * 1024;
/// Conversations imported between saves of the index.
const COMMIT_EVERY: usize = 25;
/// Saved transcript bytes held before the index is saved, so a batch of long
/// conversations is not all in memory at once.
const COMMIT_BYTES: usize = TRANSCRIPT_BYTES;
/// Files whose messages one scan counts at a time.
const READERS: usize = 4;

/// What Jackalope keeps about one imported conversation. Saved, so new fields need defaults.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedRecord {
    /// `<agent>:<session id>`, the same key the session has in its CLI's store listing.
    pub id: String,
    pub agent: String,
    pub session_id: String,
    pub project_id: String,
    pub title: String,
    pub cwd: String,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub last_at: Option<String>,
    pub imported_at: String,
    /// The person's messages and the replies.
    pub messages: usize,
    /// Entries left out from the start of a very long conversation.
    #[serde(default)]
    pub earlier: usize,
    /// Source lines that could not be read.
    #[serde(default)]
    pub skipped_lines: usize,
    #[serde(default)]
    pub subagent_lines: usize,
    pub source_path: PathBuf,
    /// The CLI configuration directory (account) that saved the session.
    pub source_home: PathBuf,
    pub source_size: u64,
    pub source_modified_ms: u64,
    /// The Jackalope conversation that continued it, which now owns its later turns.
    #[serde(default)]
    pub continued_in: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct Ledger {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    conversations: BTreeMap<String, ImportedRecord>,
}

#[derive(Serialize, Deserialize)]
struct SavedTranscript {
    version: u32,
    entries: Vec<TranscriptEntry>,
}

/// The imported conversations on disk, with the index's lock as their single writer.
pub(super) struct Store {
    directory: PathBuf,
    /// Loaded on first use. An index that cannot be read stays an error, and nothing is
    /// written over it.
    ledger: Mutex<Option<Result<Ledger, String>>>,
}

impl Store {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            ledger: Mutex::new(None),
        }
    }

    fn index_path(&self) -> PathBuf {
        self.directory.join("index.json")
    }

    fn transcript_path(&self, id: &str) -> PathBuf {
        self.directory
            .join("transcripts")
            .join(format!("{}.json", id.replace(':', "-")))
    }

    fn load(&self) -> Result<Ledger, String> {
        let path = self.index_path();
        let bytes = match super::super::history::read_bounded(&path, INDEX_BYTES) {
            Ok(bytes) => bytes,
            Err(_) if !path.exists() => return Ok(Ledger::default()),
            Err(error) => return Err(unreadable(&path, &error)),
        };
        let ledger: Ledger = serde_json::from_slice(&bytes)
            .map_err(|error| unreadable(&path, &error.to_string()))?;
        if ledger.version > VERSION {
            return Err(format!(
                "Imported conversations at {} were saved by a newer version of Jackalope. Update Jackalope to read them.",
                path.display()
            ));
        }
        Ok(ledger)
    }

    fn with<T>(&self, read: impl FnOnce(&Ledger) -> T) -> Result<T, String> {
        let mut slot = self.ledger.lock().unwrap_or_else(PoisonError::into_inner);
        let ledger = slot.get_or_insert_with(|| self.load());
        ledger.as_ref().map(read).map_err(Clone::clone)
    }

    pub fn records(&self) -> Result<Vec<ImportedRecord>, String> {
        self.with(|ledger| ledger.conversations.values().cloned().collect())
    }

    pub fn record(&self, id: &str) -> Result<Option<ImportedRecord>, String> {
        self.with(|ledger| ledger.conversations.get(id).cloned())
    }

    /// Changes the index under its lock, saving it before the change is kept.
    fn update<T>(
        &self,
        change: impl FnOnce(&Path, &mut Ledger) -> Result<T, String>,
    ) -> Result<T, String> {
        // The ledger is replaced only after a save, so one left by a panic is still whole.
        let mut slot = self.ledger.lock().unwrap_or_else(PoisonError::into_inner);
        let current = slot
            .get_or_insert_with(|| self.load())
            .as_ref()
            .map_err(Clone::clone)?;
        let mut ledger = Ledger {
            version: VERSION,
            conversations: current.conversations.clone(),
        };
        let result = change(&self.directory, &mut ledger)?;
        std::fs::create_dir_all(&self.directory).map_err(|error| error.to_string())?;
        let bytes = serde_json::to_vec(&ledger).map_err(|error| error.to_string())?;
        super::super::history::write_atomic(&self.index_path(), &bytes)?;
        *slot = Some(Ok(ledger));
        Ok(result)
    }

    /// Saves each transcript, then the index naming them. A transcript that cannot be
    /// written stops the batch; those written before it are kept.
    fn commit(&self, batch: Vec<(ImportedRecord, Vec<TranscriptEntry>)>) -> Result<(), String> {
        if batch.is_empty() {
            return Ok(());
        }
        let mut failure = None;
        self.update(|_, ledger| {
            for (record, entries) in batch {
                if let Err(error) = self.write_transcript(&record.id, entries) {
                    failure = Some(format!("{} could not be saved: {error}", record.title));
                    break;
                }
                ledger.conversations.insert(record.id.clone(), record);
            }
            Ok(())
        })?;
        failure.map_or(Ok(()), Err)
    }

    fn write_transcript(&self, id: &str, entries: Vec<TranscriptEntry>) -> Result<(), String> {
        let path = self.transcript_path(id);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let bytes = serde_json::to_vec(&SavedTranscript {
            version: VERSION,
            entries,
        })
        .map_err(|error| error.to_string())?;
        super::super::history::write_atomic(&path, &bytes)
    }

    pub fn transcript(&self, id: &str) -> Result<Vec<TranscriptEntry>, String> {
        let path = self.transcript_path(id);
        let bytes =
            super::super::history::read_bounded(&path, TRANSCRIPT_BYTES as u64 + 1024 * 1024)
                .map_err(|error| unreadable(&path, &error))?;
        let saved: SavedTranscript = serde_json::from_slice(&bytes)
            .map_err(|error| unreadable(&path, &error.to_string()))?;
        if saved.version > VERSION {
            return Err(format!(
                "{} was saved by a newer version of Jackalope. Update Jackalope to read it.",
                path.display()
            ));
        }
        Ok(saved.entries)
    }

    pub fn mark_continued(&self, id: &str, conversation: &str) -> Result<(), String> {
        self.update(|_, ledger| {
            let record = ledger
                .conversations
                .get_mut(id)
                .ok_or("This imported conversation is no longer saved.")?;
            record.continued_in = Some(conversation.to_string());
            Ok(())
        })
    }
}

fn unreadable(path: &Path, error: &str) -> String {
    format!(
        "Imported conversations could not be read from {}. The file is unchanged: {error}",
        path.display()
    )
}

/// Session stores to scan: the accounts Jackalope uses for each CLI and each CLI's default
/// directory, which a person may use outside Jackalope even when an account points elsewhere.
pub(super) fn homes(accounts: &Accounts) -> Vec<(Source, PathBuf)> {
    let mut homes = accounts.homes();
    let defaults = super::super::platform::home_dir()
        .into_iter()
        .flat_map(|home| {
            Source::ALL.into_iter().filter_map(move |source| {
                Some((
                    source,
                    super::super::agents::find(source.adapter())?.default_directory(&home),
                ))
            })
        });
    for (source, directory) in defaults {
        if directory.is_dir()
            && !homes
                .iter()
                .any(|(seen, home)| *seen == source && same_directory(home, &directory))
        {
            homes.push((source, directory));
        }
    }
    homes
}

/// A session a scan found, as the import dialog lists it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate {
    pub key: String,
    pub agent: String,
    pub agent_name: String,
    pub session_id: String,
    pub title: String,
    pub cwd: String,
    pub branch: Option<String>,
    pub started_at: Option<String>,
    /// The newest message, or when the file last changed.
    pub last_at: String,
    pub messages: usize,
    /// `new`, `imported`, `changed` (grew since it was imported) or `continued`.
    pub status: &'static str,
}

/// Sessions that ran in one project, or in one repository or folder that is not a project.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportGroup {
    /// The project's folder, or the repository's main checkout, or the folder itself.
    pub path: String,
    pub project_id: Option<String>,
    pub exists: bool,
    pub repository: bool,
    /// False for a folder in a protected location, which is listed without being looked at.
    pub checked: bool,
    pub sessions: Vec<ImportCandidate>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportScan {
    pub groups: Vec<ImportGroup>,
    /// The CLI configuration directories read.
    pub stores: Vec<String>,
    pub error: Option<String>,
}

/// What a scan learned about a session, kept so the import reads the same file.
#[derive(Clone)]
struct Found {
    source: Source,
    path: PathBuf,
    home: PathBuf,
    summary: Summary,
}

#[derive(Clone, Copy, PartialEq)]
struct FileState {
    modified_ms: u64,
    size: u64,
}

struct Counted {
    state: FileState,
    messages: usize,
    last_at: Option<String>,
}

#[derive(Default)]
struct ScanState {
    index: Index,
    counts: HashMap<PathBuf, Counted>,
    found: HashMap<String, Found>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProblem {
    pub key: String,
    pub title: String,
    pub reason: String,
}

/// The running or last import, as the app shows its progress.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub running: bool,
    pub canceled: bool,
    pub total: usize,
    pub done: usize,
    pub imported: usize,
    pub updated: usize,
    pub unchanged: usize,
    pub problems: Vec<ImportProblem>,
    pub current: Option<String>,
    /// Why the import stopped early, when saving failed.
    pub error: Option<String>,
}

pub(super) struct Imports {
    pub store: Store,
    scan: Mutex<ScanState>,
    progress: Mutex<ImportProgress>,
    cancel: AtomicBool,
}

impl Imports {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            store: Store::new(directory),
            scan: Mutex::new(ScanState::default()),
            progress: Mutex::new(ImportProgress::default()),
            cancel: AtomicBool::new(false),
        }
    }

    pub fn session_ids(&self) -> Vec<String> {
        self.store
            .records()
            .map(|records| {
                records
                    .into_iter()
                    .map(|record| record.session_id)
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn progress(&self) -> ImportProgress {
        self.progress
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Reads the stores and lists every session the person had, grouped by where it ran.
    pub fn scan(
        &self,
        homes: &[(Source, PathBuf)],
        projects: &[ProjectFolder],
        scope: &Scope,
    ) -> Result<ImportScan, String> {
        let mut state = self.scan.lock().unwrap_or_else(PoisonError::into_inner);
        state.index.refresh(homes);
        let (records, error) = match self.store.records() {
            Ok(records) => (records, None),
            Err(error) => (Vec::new(), Some(error)),
        };
        let imported: HashMap<&str, &ImportedRecord> = records
            .iter()
            .map(|record| (record.id.as_str(), record))
            .collect();
        let found = sessions(&state.index, scope, &imported);
        count(&mut state.counts, &found);
        let mut locations: HashMap<String, Location> = HashMap::new();
        let mut groups: BTreeMap<String, ImportGroup> = BTreeMap::new();
        for (key, (found, file)) in &found {
            let summary = &found.summary;
            let counted = state.counts.get(&found.path);
            let location = locations
                .entry(summary.cwd.clone())
                .or_insert_with(|| Location::of_session(Path::new(&summary.cwd)));
            let cwd = Path::new(&summary.cwd);
            let project = project_for(projects, cwd, location);
            let path = match project {
                Some(project) => project.path.to_string_lossy().into_owned(),
                None => repository_root(location)
                    .unwrap_or_else(|| summary.cwd.clone().into())
                    .to_string_lossy()
                    .into_owned(),
            };
            let group = groups.entry(path.clone()).or_insert_with(|| ImportGroup {
                path,
                project_id: project.map(|project| project.id.clone()),
                exists: location.canonical.is_some() || location.protected,
                repository: location.top.is_some(),
                checked: !location.protected,
                sessions: Vec::new(),
            });
            let status = match imported.get(key.as_str()) {
                None => "new",
                Some(record) if record.continued_in.is_some() => "continued",
                Some(record) if unchanged(record, &found.path, *file) => "imported",
                Some(_) => "changed",
            };
            group.sessions.push(ImportCandidate {
                key: key.clone(),
                agent: found.source.adapter().into(),
                agent_name: super::super::agents::name(found.source.adapter()).into(),
                session_id: summary.session_id.clone(),
                title: summary.title.clone().unwrap_or_default(),
                cwd: summary.cwd.clone(),
                branch: summary.branch.clone(),
                started_at: summary.started_at.clone(),
                last_at: counted
                    .and_then(|counted| counted.last_at.clone())
                    .unwrap_or_else(|| timestamp(file.modified_ms)),
                messages: counted.map_or(0, |counted| counted.messages),
                status,
            });
        }
        let mut groups: Vec<_> = groups.into_values().collect();
        for group in &mut groups {
            group
                .sessions
                .sort_by(|left, right| right.last_at.cmp(&left.last_at));
        }
        // Projects first, then folders that still exist, each by their newest conversation.
        groups.sort_by(|left, right| {
            (right.project_id.is_some(), right.exists)
                .cmp(&(left.project_id.is_some(), left.exists))
                .then_with(|| right.sessions[0].last_at.cmp(&left.sessions[0].last_at))
        });
        state.found = found
            .into_iter()
            .map(|(key, (found, _))| (key, found))
            .collect();
        Ok(ImportScan {
            groups,
            stores: homes
                .iter()
                .map(|(_, home)| home.to_string_lossy().into_owned())
                .collect(),
            error,
        })
    }

    /// Where each of the person's sessions ran and when its file last changed, newest copy of
    /// each. Reads only the stores: the folders themselves are not touched, so a caller can
    /// decide which of them it may look at.
    pub fn folders(
        &self,
        homes: &[(Source, PathBuf)],
        recorded: &std::collections::HashSet<String>,
        data_directory: &Path,
    ) -> Vec<(String, u64)> {
        let mut state = self.scan.lock().unwrap_or_else(PoisonError::into_inner);
        state.index.refresh(homes);
        let mut newest: HashMap<String, (String, u64)> = HashMap::new();
        for entry in state.index.files.values() {
            let Some(summary) = entry
                .summary
                .as_ref()
                .filter(|summary| summary.title.is_some())
            else {
                continue;
            };
            let cwd = Path::new(&summary.cwd);
            if recorded.contains(&summary.session_id)
                || super::jackalope_worktree(cwd, summary.branch.as_deref())
                || cwd.starts_with(data_directory)
            {
                continue;
            }
            let key = format!("{}:{}", entry.source.adapter(), summary.session_id);
            if newest
                .get(&key)
                .is_none_or(|(_, modified)| *modified < entry.modified_ms)
            {
                newest.insert(key, (summary.cwd.clone(), entry.modified_ms));
            }
        }
        newest.into_values().collect()
    }

    /// Imports `keys` from the last scan, reporting progress through `changed`. Runs on the
    /// caller's thread until done or canceled.
    pub fn run(
        &self,
        keys: Vec<String>,
        projects: &[ProjectFolder],
        changed: &dyn Fn(),
    ) -> ImportProgress {
        let found = self
            .scan
            .lock()
            .map(|state| state.found.clone())
            .unwrap_or_default();
        let update = |change: &dyn Fn(&mut ImportProgress)| {
            change(&mut self.progress.lock().unwrap_or_else(PoisonError::into_inner));
            changed();
        };
        let mut pending = Vec::new();
        let mut pending_bytes = 0;
        let mut counts = (0, 0);
        let mut locations: HashMap<String, Location> = HashMap::new();
        let commit = |pending: &mut Vec<(ImportedRecord, Vec<TranscriptEntry>, bool)>,
                      counts: &mut (usize, usize)| {
            let batch: Vec<_> = pending.drain(..).collect();
            let added = batch.iter().filter(|(_, _, update)| !update).count();
            let updated = batch.len() - added;
            let result = self.store.commit(
                batch
                    .into_iter()
                    .map(|(record, entries, _)| (record, entries))
                    .collect(),
            );
            if result.is_ok() {
                counts.0 += added;
                counts.1 += updated;
            }
            result
        };
        let mut error = None;
        for key in &keys {
            if self.cancel.load(Ordering::SeqCst) {
                break;
            }
            let title = found
                .get(key)
                .and_then(|found| found.summary.title.clone())
                .unwrap_or_else(|| key.clone());
            update(&|progress| progress.current = Some(title.clone()));
            let outcome = found
                .get(key)
                .ok_or_else(|| {
                    "This conversation is no longer in its CLI's files. Scan again.".to_string()
                })
                .and_then(|found| self.prepare(key, found, projects, &mut locations));
            match outcome {
                Ok(Some((record, entries, replacing, size))) => {
                    pending.push((record, entries, replacing));
                    pending_bytes += size;
                }
                Ok(None) => update(&|progress| progress.unchanged += 1),
                Err(reason) => update(&|progress| {
                    progress.problems.push(ImportProblem {
                        key: key.clone(),
                        title: title.clone(),
                        reason: reason.clone(),
                    })
                }),
            }
            if pending.len() >= COMMIT_EVERY || pending_bytes >= COMMIT_BYTES {
                pending_bytes = 0;
                if let Err(failure) = commit(&mut pending, &mut counts) {
                    error = Some(failure);
                    break;
                }
            }
            update(&|progress| {
                progress.done += 1;
                progress.imported = counts.0;
                progress.updated = counts.1;
            });
        }
        if error.is_none() {
            error = commit(&mut pending, &mut counts).err();
        }
        let canceled = self.cancel.swap(false, Ordering::SeqCst);
        update(&|progress| {
            progress.running = false;
            progress.canceled = canceled;
            progress.current = None;
            progress.imported = counts.0;
            progress.updated = counts.1;
            progress.error = error.clone();
        });
        self.progress()
    }

    /// Marks an import as started, refusing a second one while it runs.
    pub fn begin(&self, total: usize) -> Result<(), String> {
        let mut progress = self.progress.lock().unwrap_or_else(PoisonError::into_inner);
        if progress.running {
            return Err("An import is already running. Wait for it to finish or cancel it.".into());
        }
        self.cancel.store(false, Ordering::SeqCst);
        *progress = ImportProgress {
            running: true,
            total,
            ..ImportProgress::default()
        };
        Ok(())
    }

    /// Runs an import begun with [`Imports::begin`], so that a panic while importing ends
    /// it with the panic's message instead of leaving it running forever.
    pub fn run_guarded(
        &self,
        keys: Vec<String>,
        projects: &dyn Fn() -> Vec<ProjectFolder>,
        changed: &dyn Fn(),
    ) {
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.run(keys, &projects(), changed)
        }));
        if let Err(panic) = outcome {
            let message = panic
                .downcast_ref::<&str>()
                .map(|text| text.to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "no message".into());
            self.cancel.store(false, Ordering::SeqCst);
            let mut progress = self.progress.lock().unwrap_or_else(PoisonError::into_inner);
            progress.running = false;
            progress.current = None;
            progress.error = Some(format!("The import stopped unexpectedly: {message}. Conversations saved before it stopped are kept."));
        }
    }

    pub fn cancel(&self) {
        if self.progress().running {
            self.cancel.store(true, Ordering::SeqCst);
        }
    }

    /// What to save for one session, or None when the saved copy is current.
    fn prepare(
        &self,
        key: &str,
        found: &Found,
        projects: &[ProjectFolder],
        locations: &mut HashMap<String, Location>,
    ) -> Result<Option<Prepared>, String> {
        let existing = self.store.record(key)?;
        if existing
            .as_ref()
            .is_some_and(|record| record.continued_in.is_some())
        {
            return Err(
                "It was continued in Jackalope, so its later turns are already here.".into(),
            );
        }
        let summary = &found.summary;
        let location = locations
            .entry(summary.cwd.clone())
            .or_insert_with(|| Location::of_session(Path::new(&summary.cwd)));
        let project =
            project_for(projects, Path::new(&summary.cwd), location).ok_or_else(|| {
                format!(
                    "{} is not in a Jackalope project. Add it as a project to import it.",
                    summary.cwd
                )
            })?;
        let state = file_state(&found.path)
            .ok_or_else(|| format!("{} can no longer be read.", found.path.display()))?;
        if existing
            .as_ref()
            .is_some_and(|record| unchanged(record, &found.path, state))
        {
            return Ok(None);
        }
        let transcript = found
            .source
            .read_transcript(&found.path, Transcript::keeping(ENTRIES), SOURCE_BYTES)
            .ok_or_else(|| format!("{} could not be read.", found.path.display()))?;
        let mut earlier = transcript.earlier;
        let mut entries: Vec<_> = transcript.entries.into();
        let size = fit(&mut entries, &mut earlier);
        let record = ImportedRecord {
            id: key.to_string(),
            agent: found.source.adapter().into(),
            session_id: summary.session_id.clone(),
            project_id: project.id.clone(),
            title: summary.title.clone().unwrap_or_else(|| key.to_string()),
            cwd: summary.cwd.clone(),
            branch: summary.branch.clone(),
            started_at: summary.started_at.clone(),
            last_at: transcript
                .last_at
                .or_else(|| Some(timestamp(state.modified_ms))),
            imported_at: chrono::Utc::now().to_rfc3339(),
            messages: transcript.messages,
            earlier,
            skipped_lines: transcript.skipped_lines,
            subagent_lines: transcript.subagent_lines,
            source_path: found.path.clone(),
            source_home: found.home.clone(),
            source_size: state.size,
            source_modified_ms: state.modified_ms,
            continued_in: None,
        };
        Ok(Some((record, entries, existing.is_some(), size)))
    }
}

/// A record and transcript to save, whether it replaces an earlier copy, and the
/// transcript's saved size.
type Prepared = (ImportedRecord, Vec<TranscriptEntry>, bool, usize);

/// Drops the oldest entries until the saved transcript fits, measured as the JSON it is
/// saved as, since escaping can make that several times longer than the text. Returns
/// the saved size of the entries kept.
fn fit(entries: &mut Vec<TranscriptEntry>, earlier: &mut usize) -> usize {
    let sizes: Vec<usize> = entries.iter().map(|entry| saved_size(entry) + 1).collect();
    let mut size: usize = sizes.iter().sum();
    let mut drop = 0;
    while size > TRANSCRIPT_BYTES && drop < sizes.len() {
        size -= sizes[drop];
        drop += 1;
    }
    entries.drain(..drop);
    *earlier += drop;
    size
}

fn saved_size(entry: &TranscriptEntry) -> usize {
    struct Count(usize);
    impl std::io::Write for Count {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 += bytes.len();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut count = Count(0);
    let _ = serde_json::to_writer(&mut count, entry);
    count.0
}

fn unchanged(record: &ImportedRecord, path: &Path, state: FileState) -> bool {
    record.source_path == path
        && record.source_size == state.size
        && record.source_modified_ms == state.modified_ms
}

fn file_state(path: &Path) -> Option<FileState> {
    let metadata = std::fs::metadata(path).ok()?;
    Some(FileState {
        modified_ms: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |since| since.as_millis() as u64),
        size: metadata.len(),
    })
}

fn timestamp(modified_ms: u64) -> String {
    chrono::DateTime::<chrono::Utc>::from(UNIX_EPOCH + Duration::from_millis(modified_ms))
        .to_rfc3339()
}

/// The folder that names a repository: the main checkout of a worktree, or the top of
/// the checkout. None outside a repository.
pub(super) fn repository_root(location: &Location) -> Option<PathBuf> {
    let common = location.common.as_deref();
    match common {
        Some(common) if common.file_name().is_some_and(|name| name == ".git") => {
            common.parent().map(Path::to_path_buf)
        }
        _ => location.top.clone(),
    }
}

/// The person's own sessions in the index, newest copy of each, by key. Jackalope's own
/// work is left out unless it was imported earlier.
fn sessions(
    index: &Index,
    scope: &Scope,
    imported: &HashMap<&str, &ImportedRecord>,
) -> HashMap<String, (Found, FileState)> {
    let mut sessions: HashMap<String, (Found, FileState)> = HashMap::new();
    let mut locations: HashMap<&str, Location> = HashMap::new();
    for (path, entry) in &index.files {
        let Some(summary) = entry
            .summary
            .as_ref()
            .filter(|summary| summary.title.is_some())
        else {
            continue;
        };
        let key = format!("{}:{}", entry.source.adapter(), summary.session_id);
        if !imported.contains_key(key.as_str()) {
            let location = locations
                .entry(summary.cwd.as_str())
                .or_insert_with(|| Location::of_session(Path::new(&summary.cwd)));
            if super::own_work(summary, location, scope) {
                continue;
            }
        }
        let state = FileState {
            modified_ms: entry.modified_ms,
            size: entry.size,
        };
        if sessions
            .get(&key)
            .is_none_or(|(_, seen)| seen.modified_ms < state.modified_ms)
        {
            sessions.insert(
                key,
                (
                    Found {
                        source: entry.source,
                        path: path.clone(),
                        home: entry.home.clone(),
                        summary: summary.clone(),
                    },
                    state,
                ),
            );
        }
    }
    sessions
}

/// Counts the messages of files that are new or changed since they were last counted.
fn count(counts: &mut HashMap<PathBuf, Counted>, found: &HashMap<String, (Found, FileState)>) {
    counts.retain(|path, _| found.values().any(|(found, _)| &found.path == path));
    let stale: Vec<(Source, PathBuf, FileState)> = found
        .values()
        .filter(|(found, state)| {
            counts
                .get(&found.path)
                .is_none_or(|counted| counted.state != *state)
        })
        .map(|(found, state)| (found.source, found.path.clone(), *state))
        .collect();
    if stale.is_empty() {
        return;
    }
    let results: Vec<(PathBuf, Counted)> = std::thread::scope(|scope| {
        let workers: Vec<_> = stale
            .chunks(stale.len().div_ceil(READERS).max(1))
            .map(|chunk| {
                scope.spawn(move || {
                    chunk
                        .iter()
                        .filter_map(|(source, path, state)| {
                            let transcript = source.read_transcript(
                                path,
                                Transcript::keeping(1),
                                SOURCE_BYTES,
                            )?;
                            Some((
                                path.clone(),
                                Counted {
                                    state: *state,
                                    messages: transcript.messages,
                                    last_at: transcript.last_at,
                                },
                            ))
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        workers
            .into_iter()
            .flat_map(|worker| worker.join().unwrap_or_default())
            .collect()
    });
    counts.extend(results);
}

/// An imported conversation, as the work list and its view show it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedConversation {
    #[serde(flatten)]
    pub record: ImportedRecord,
    pub agent_name: String,
    /// Why it cannot be continued in Jackalope, when it cannot.
    pub unavailable: Option<String>,
    /// Whether its CLI has written to it since it was imported.
    pub changed: bool,
    /// Its folder was not checked, because looking could ask for macOS permission.
    pub protected_folder: bool,
}

/// The session behind an imported conversation, as continuing it needs to see it.
pub(super) fn as_session(record: &ImportedRecord, project_id: &str) -> Option<ExternalSession> {
    let source = Source::from_adapter(&record.agent)?;
    Some(ExternalSession {
        key: record.id.clone(),
        agent: record.agent.clone(),
        agent_name: super::super::agents::name(&record.agent).into(),
        session_id: record.session_id.clone(),
        project_id: project_id.to_string(),
        title: record.title.clone(),
        cwd: record.cwd.clone(),
        branch: record.branch.clone(),
        started_at: record.started_at.clone(),
        updated_at: record.last_at.clone().unwrap_or_default(),
        unavailable: None,
        protected_folder: false,
        source,
        path: record.source_path.clone(),
        home: record.source_home.clone(),
    })
}

/// Lists imported conversations under the project they ran in now, and says why any
/// cannot be continued.
pub(super) fn describe(
    records: Vec<ImportedRecord>,
    projects: &[ProjectFolder],
    account: &dyn Fn(&ExternalSession) -> Option<String>,
) -> Vec<ImportedConversation> {
    let mut locations: HashMap<String, Location> = HashMap::new();
    let mut conversations: Vec<_> = records
        .into_iter()
        .map(|mut record| {
            let location = locations
                .entry(record.cwd.clone())
                .or_insert_with(|| Location::of_session(Path::new(&record.cwd)));
            let project = project_for(projects, Path::new(&record.cwd), location);
            if let Some(project) = project {
                record.project_id = project.id.clone();
            }
            let unavailable = if record.continued_in.is_some() {
                Some("It was continued in Jackalope.".to_string())
            } else if location.protected {
                match project {
                    None => Some(format!(
                        "{} is not in a Jackalope project. Add it as a project to continue this conversation here.",
                        record.cwd
                    )),
                    Some(_) => match as_session(&record, &record.project_id) {
                        Some(session) => account(&session),
                        None => Some(format!(
                            "Jackalope cannot continue {} conversations.",
                            record.agent
                        )),
                    },
                }
            } else {
                match (&location.canonical, &location.top, project) {
                    (None, _, _) => Some(format!("{} no longer exists.", record.cwd)),
                    (_, _, None) => Some(format!(
                        "{} is not in a Jackalope project. Add it as a project to continue this conversation here.",
                        record.cwd
                    )),
                    (Some(folder), Some(top), _) if folder != top => Some(SUBFOLDER.into()),
                    (Some(folder), None, Some(project)) if folder != project.root() => {
                        Some(SUBFOLDER.into())
                    }
                    _ => match as_session(&record, &record.project_id) {
                        Some(session) => account(&session),
                        None => Some(format!(
                            "Jackalope cannot continue {} conversations.",
                            record.agent
                        )),
                    },
                }
            };
            let changed = record.continued_in.is_none()
                && file_state(&record.source_path)
                    .is_some_and(|state| !unchanged(&record, &record.source_path, state));
            ImportedConversation {
                protected_folder: location.protected,
                agent_name: super::super::agents::name(&record.agent).into(),
                record,
                unavailable,
                changed,
            }
        })
        .collect();
    conversations.sort_by(|left, right| right.record.last_at.cmp(&left.record.last_at));
    conversations
}

#[cfg(test)]
mod tests;
