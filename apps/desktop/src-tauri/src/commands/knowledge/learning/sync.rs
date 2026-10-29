//! Account sync of learned lessons. Only `SyncedLesson`, `SyncedBody` and
//! `SyncedRecord` cross the network: evidence references and excerpts, usage
//! counters, recent runs, source runs and commits, project ids and paths stay
//! on the device. Lessons match across devices by learned id within a project
//! key derived from the repository's first commits, never from a path.

use super::*;
use std::collections::{BTreeMap, HashSet};

/// Push limits that keep every request under the service's body limit.
pub const LESSONS_PER_PUSH: usize = 25;
pub const RECORDS_PER_PUSH: usize = 100;
pub const PUSH_BYTES: usize = 24_000;
/// History records uploaded per sync; older ones follow on later syncs.
const RECORDS_PER_SYNC: usize = 500;
const MAX_SAFE: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncedLesson {
    pub id: String,
    /// The project key, see `project_key`.
    pub project: String,
    pub revision: u64,
    /// Milliseconds since the epoch; breaks revision ties, last writer wins.
    pub updated_at: u64,
    /// A tombstone: the lesson was removed and must not be learned again.
    pub deleted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lesson: Option<SyncedBody>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncedBody {
    pub title: String,
    pub content: String,
    pub keywords: Vec<String>,
    pub enabled: bool,
    pub kind: String,
    pub status: String,
    pub statement: String,
    pub origin: String,
    pub born_at: String,
    #[serde(default)]
    pub archived_reason: Option<String>,
    /// Whether Jackalope may still change it (nobody edited it).
    pub managed: bool,
    #[serde(default)]
    pub distinct: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncedRecord {
    pub id: String,
    pub entry_id: String,
    pub project: String,
    pub at: String,
    pub action: String,
    pub reason: String,
    pub revision: u64,
    pub origin: String,
    pub title: String,
}

const ACTIONS: &[&str] = &[
    "born", "merged", "patched", "retired", "promoted", "archived", "restored", "edited",
    "deleted", "curated",
];

fn slug(text: &str) -> bool {
    (1..=24).contains(&text.len())
        && text
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'-')
}

fn hex64(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn plain(text: &str, max: usize) -> bool {
    text.len() <= max && !text.contains('\0')
}

/// Whether text may leave the device: nothing the redactor would replace,
/// including the home folder, and no credential vocabulary.
pub(super) fn shareable(text: &str) -> bool {
    let (cleaned, sensitive) = redact::scan(text);
    !sensitive && cleaned == text && !redact::unsafe_text(text)
}

impl SyncedLesson {
    pub fn validate(&self) -> Result<(), String> {
        let valid = uuid::Uuid::parse_str(&self.id).is_ok()
            && hex64(&self.project)
            && (1..MAX_SAFE).contains(&self.revision)
            && self.updated_at < MAX_SAFE
            && self.deleted == self.lesson.is_none()
            && self.lesson.as_ref().is_none_or(|body| {
                !body.title.trim().is_empty()
                    && plain(&body.title, 120)
                    && !body.title.contains(['\n', '\r'])
                    && !body.content.trim().is_empty()
                    && plain(&body.content, 800)
                    && plain(&body.statement, 500)
                    && body.keywords.len() <= 10
                    && body
                        .keywords
                        .iter()
                        .all(|keyword| (2..=60).contains(&keyword.len()) && plain(keyword, 60))
                    && slug(&body.kind)
                    && matches!(body.status.as_str(), PROBATION | ACTIVE | ARCHIVED)
                    && slug(&body.origin)
                    && plain(&body.born_at, 40)
                    && body.archived_reason.as_deref().is_none_or(slug)
            });
        valid
            .then_some(())
            .ok_or_else(|| "Invalid synced lesson.".into())
    }
}

impl SyncedRecord {
    pub fn validate(&self) -> Result<(), String> {
        let valid = uuid::Uuid::parse_str(&self.id).is_ok()
            && uuid::Uuid::parse_str(&self.entry_id).is_ok()
            && hex64(&self.project)
            && plain(&self.at, 40)
            && ACTIONS.contains(&self.action.as_str())
            && plain(&self.reason, 400)
            && self.revision < MAX_SAFE
            && slug(&self.origin)
            && plain(&self.title, 120);
        valid
            .then_some(())
            .ok_or_else(|| "Invalid synced lesson history.".into())
    }
}

pub fn millis(text: &str) -> u64 {
    chrono::DateTime::parse_from_rfc3339(text)
        .map(|time| time.timestamp_millis().max(0) as u64)
        .unwrap_or(0)
}

fn iso(milliseconds: u64) -> String {
    chrono::DateTime::from_timestamp_millis(milliseconds as i64)
        .unwrap_or_default()
        .to_rfc3339()
}

/// The revision and update time sync compares; the higher pair wins.
pub fn marker(entry: &KnowledgeEntry) -> (u64, u64) {
    (entry.revision, millis(&entry.updated_at))
}

/// A machine-independent project key from the repository's root commits, so
/// clones of one repository match on every device. `None` for folders without
/// a commit, which cannot sync.
pub fn project_key(path: &str) -> Option<String> {
    let output = crate::commands::git_command::command(
        std::path::Path::new(path),
        &["rev-list", "--max-parents=0", "HEAD"],
        crate::commands::git_command::Policy::Isolated,
    )
    .output()
    .ok()
    .filter(|output| output.status.success())?;
    let mut roots: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();
    roots.sort();
    if roots.is_empty() {
        return None;
    }
    let hash = Sha256::digest(format!("jackalope-lessons-v1\0{}", roots.join("\n")));
    Some(hash.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// The (revision, updated-at) of each lesson, by id.
pub type Markers = BTreeMap<String, (u64, u64)>;

/// A local project that takes part in sync.
#[derive(Clone, Debug)]
pub struct SyncProject {
    pub key: String,
    pub project_id: String,
    /// Canonical folder, as knowledge entries store it.
    pub path: String,
}

/// The included projects that can sync, from `(project id, folder)` pairs, and
/// how many cannot because their folder is missing or has no commit. The first
/// project registered for a repository receives its lessons.
pub fn sync_projects(projects: &[(String, String)]) -> (Vec<SyncProject>, usize) {
    let mut found: Vec<SyncProject> = vec![];
    let mut unavailable = 0;
    for (project_id, folder) in projects {
        let Some((path, key)) = canonical(folder)
            .ok()
            .and_then(|path| project_key(&path).map(|key| (path, key)))
        else {
            unavailable += 1;
            continue;
        };
        if !found.iter().any(|project| project.key == key) {
            found.push(SyncProject {
                key,
                project_id: project_id.clone(),
                path,
            });
        }
    }
    (found, unavailable)
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    /// The account (a hash of the service and email) lesson sync is on for.
    /// Another account starts with sync off.
    #[serde(default)]
    pub enabled_for: Option<String>,
    #[serde(default)]
    pub accounts: BTreeMap<String, AccountSync>,
    /// The account each synced lesson belongs to, so a lesson exchanged with
    /// one account is never uploaded to another.
    #[serde(default)]
    pub owners: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSync {
    #[serde(default)]
    pub epoch: u64,
    #[serde(default)]
    pub cursor: u64,
    /// Project keys included at the last pull; a new one forces a full pull.
    #[serde(default)]
    pub projects: Vec<String>,
    /// The (revision, updated-at) last exchanged for each lesson.
    #[serde(default)]
    pub synced: BTreeMap<String, (u64, u64)>,
    /// Per project key, the newest history time uploaded.
    #[serde(default)]
    pub records_after: BTreeMap<String, String>,
    #[serde(default)]
    pub last_synced_at: Option<String>,
}

impl SyncState {
    pub fn reset(&mut self, account: &str) {
        self.accounts.remove(account);
        if self.enabled_for.as_deref() == Some(account) {
            self.enabled_for = None;
        }
    }
}

/// What one sync would upload.
#[derive(Debug, Default)]
pub struct Outgoing {
    pub lessons: Vec<SyncedLesson>,
    pub records: Vec<SyncedRecord>,
    /// Learned lessons that stay local because they look sensitive.
    pub kept_local: usize,
}

/// The wire form of a learned entry, or `None` when it is not a learned lesson
/// or contains something that must not leave the device.
pub fn outgoing_lesson(entry: &KnowledgeEntry, project: &str) -> Option<SyncedLesson> {
    let source = entry.automatic.as_ref()?;
    let state = source.lifecycle.as_ref()?;
    let mut lesson = SyncedLesson {
        id: entry.id.clone(),
        project: project.into(),
        revision: entry.revision,
        updated_at: millis(&entry.updated_at),
        deleted: entry.dismissed,
        lesson: None,
    };
    if !entry.dismissed {
        let texts = [&entry.title, &entry.content, &state.statement];
        if texts.iter().any(|text| !shareable(text))
            || entry.keywords.iter().any(|keyword| !shareable(keyword))
        {
            return None;
        }
        lesson.lesson = Some(SyncedBody {
            title: entry.title.clone(),
            content: entry.content.clone(),
            keywords: entry.keywords.clone(),
            enabled: entry.enabled,
            kind: source.kind.clone(),
            status: state.status.clone(),
            statement: state.statement.clone(),
            origin: state.origin.clone(),
            born_at: state.born_at.clone(),
            archived_reason: state.archived_reason.clone(),
            managed: source.managed,
            distinct: state.distinct,
        });
    }
    lesson.validate().ok().map(|_| lesson)
}

/// The wire form of a history record. Evidence never leaves the device.
pub fn outgoing_record(record: &LedgerRecord, project: &str) -> Option<SyncedRecord> {
    let synced = SyncedRecord {
        id: record.id.clone(),
        entry_id: record.entry_id.clone(),
        project: project.into(),
        at: record.at.clone(),
        action: record.action.clone(),
        reason: redact(&record.reason).chars().take(300).collect(),
        revision: record.revision,
        origin: record.origin.clone(),
        title: redact(&record.title).chars().take(120).collect(),
    };
    synced.validate().ok().map(|_| synced)
}

/// Whether `remote` replaces a local copy at `local`.
pub fn newer(remote: (u64, u64), local: (u64, u64)) -> bool {
    remote > local
}

#[derive(Debug, PartialEq)]
enum Outcome {
    /// The local copy now matches the remote one.
    Applied,
    /// Already identical locally.
    Same,
    /// Kept: local is newer, unknown or full.
    Skipped,
}

fn tombstone(entry: &mut KnowledgeEntry) {
    if let Some(state) = lifecycle_mut(entry) {
        state.statement.clear();
        state.recent_runs.clear();
    }
    if let Some(source) = entry.automatic.as_mut() {
        source.evidence.clear();
    }
    entry.dismissed = true;
    entry.enabled = false;
    entry.title = "Removed automatic lesson".into();
    entry.content.clear();
    entry.keywords.clear();
    entry.source_run_id = None;
    entry.source_head = None;
}

fn adopt(entry: &mut KnowledgeEntry, body: &SyncedBody) {
    let was_archived = lifecycle(entry).is_some_and(Lifecycle::archived);
    entry.dismissed = false;
    entry.title = body.title.clone();
    entry.content = body.content.clone();
    entry.keywords = body.keywords.clone();
    entry.enabled = body.enabled;
    if let Some(source) = entry.automatic.as_mut() {
        source.kind = body.kind.clone();
        source.managed = body.managed;
    }
    if let Some(state) = lifecycle_mut(entry) {
        state.status = body.status.clone();
        state.statement = body.statement.clone();
        state.origin = body.origin.clone();
        state.born_at = body.born_at.clone();
        state.archived_reason = body.archived_reason.clone();
        state.distinct = body.distinct;
        // A restore elsewhere starts fresh local counts, as a local restore does.
        if was_archived && !state.archived() {
            state.opportunities = 0;
            state.idle = 0;
        }
    }
}

fn apply_lesson(
    entries: &mut Vec<KnowledgeEntry>,
    project: &SyncProject,
    remote: &SyncedLesson,
) -> Outcome {
    let remote_marker = (remote.revision, remote.updated_at);
    if let Some(index) = entries.iter().position(|entry| entry.id == remote.id) {
        let entry = &mut entries[index];
        if entry.project_id != project.project_id
            || entry.project_path != project.path
            || lifecycle(entry).is_none()
        {
            return Outcome::Skipped;
        }
        let local = marker(entry);
        if local == remote_marker {
            return Outcome::Same;
        }
        if !newer(remote_marker, local) {
            return Outcome::Skipped;
        }
        match &remote.lesson {
            Some(body) => adopt(entry, body),
            None => tombstone(entry),
        }
        entry.revision = remote.revision;
        entry.updated_at = iso(remote.updated_at);
        return Outcome::Applied;
    }
    if entries.len() >= 500
        || entries
            .iter()
            .filter(|entry| entry.project_id == project.project_id)
            .count()
            >= 100
    {
        return Outcome::Skipped;
    }
    let mut entry = KnowledgeEntry {
        id: remote.id.clone(),
        project_id: project.project_id.clone(),
        project_path: project.path.clone(),
        kind: KnowledgeKind::Memory,
        title: String::new(),
        content: String::new(),
        keywords: vec![],
        enabled: false,
        dismissed: false,
        process: Default::default(),
        automatic: Some(LearningSource {
            kind: "preference".into(),
            evidence: vec![],
            managed: true,
            resolution: None,
            lifecycle: Some(Lifecycle::default()),
        }),
        source_run_id: None,
        source_head: None,
        revision: remote.revision,
        updated_at: iso(remote.updated_at),
    };
    match &remote.lesson {
        Some(body) => adopt(&mut entry, body),
        None => tombstone(&mut entry),
    }
    entries.push(entry);
    Outcome::Applied
}

impl KnowledgeStore {
    fn sync_state_path(&self) -> PathBuf {
        self.path.with_file_name("lesson-sync.json")
    }

    pub fn sync_state(&self) -> SyncState {
        history::read_bounded(&self.sync_state_path(), 2_000_000)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save_sync_state(&self, state: &SyncState) -> Result<(), String> {
        std::fs::create_dir_all(self.path.parent().ok_or("Missing knowledge directory")?)
            .map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec(state).map_err(|e| e.to_string())?;
        history::write_atomic(&self.sync_state_path(), &bytes)
    }

    /// Learned lessons and history to upload for `account`: lessons changed
    /// since they were last exchanged, in included projects, that no other
    /// account owns.
    pub fn sync_outgoing(
        &self,
        projects: &[SyncProject],
        account: &str,
        state: &SyncState,
    ) -> Result<Outgoing, String> {
        let entries = {
            let _lock = self.lock.lock().map_err(|e| e.to_string())?;
            self.read()?
        };
        let synced = state.accounts.get(account);
        let mut outgoing = Outgoing::default();
        for project in projects {
            let mut ids = HashSet::new();
            for entry in entries.iter().filter(|entry| {
                in_project(entry, &project.project_id, &project.path) && lifecycle(entry).is_some()
            }) {
                if state
                    .owners
                    .get(&entry.id)
                    .is_some_and(|owner| owner != account)
                {
                    continue;
                }
                ids.insert(entry.id.clone());
                if synced.and_then(|sync| sync.synced.get(&entry.id)) == Some(&marker(entry)) {
                    continue;
                }
                match outgoing_lesson(entry, &project.key) {
                    Some(lesson) => outgoing.lessons.push(lesson),
                    None => outgoing.kept_local += 1,
                }
            }
            let after = synced
                .and_then(|sync| sync.records_after.get(&project.key))
                .cloned()
                .unwrap_or_default();
            outgoing.records.extend(
                ledger::read_project(&self.ledger_directory(), &project.project_id)
                    .iter()
                    .filter(|record| record.at > after && ids.contains(&record.entry_id))
                    .filter_map(|record| outgoing_record(record, &project.key)),
            );
        }
        outgoing.records.sort_by(|a, b| a.at.cmp(&b.at));
        outgoing.records.truncate(RECORDS_PER_SYNC);
        Ok(outgoing)
    }

    /// Applies downloaded lessons and history. Returns the (revision,
    /// updated-at) now shared for each lesson, and how many changed locally.
    pub fn sync_apply(
        &self,
        projects: &[SyncProject],
        lessons: &[SyncedLesson],
        records: &[SyncedRecord],
    ) -> Result<(Markers, usize), String> {
        let by_key: BTreeMap<&str, &SyncProject> = projects
            .iter()
            .map(|project| (project.key.as_str(), project))
            .collect();
        let mut shared = BTreeMap::new();
        let mut changed = 0;
        {
            let _lock = self.lock.lock().map_err(|e| e.to_string())?;
            let mut entries = self.read()?;
            for remote in lessons {
                if remote.validate().is_err() {
                    continue;
                }
                let Some(project) = by_key.get(remote.project.as_str()) else {
                    continue;
                };
                match apply_lesson(&mut entries, project, remote) {
                    Outcome::Applied => {
                        changed += 1;
                        shared.insert(remote.id.clone(), (remote.revision, remote.updated_at));
                    }
                    Outcome::Same => {
                        shared.insert(remote.id.clone(), (remote.revision, remote.updated_at));
                    }
                    Outcome::Skipped => {}
                }
            }
            if changed > 0 {
                self.write(&entries)?;
            }
        }
        let directory = self.ledger_directory();
        for project in projects {
            let incoming: Vec<&SyncedRecord> = records
                .iter()
                .filter(|record| record.project == project.key && record.validate().is_ok())
                .collect();
            if incoming.is_empty() {
                continue;
            }
            let known: HashSet<String> = ledger::read_project(&directory, &project.project_id)
                .into_iter()
                .map(|record| record.id)
                .collect();
            let fresh: Vec<LedgerRecord> = incoming
                .into_iter()
                .filter(|record| !known.contains(&record.id))
                .map(|record| LedgerRecord {
                    id: record.id.clone(),
                    entry_id: record.entry_id.clone(),
                    project_id: project.project_id.clone(),
                    at: record.at.clone(),
                    action: record.action.clone(),
                    reason: record.reason.clone(),
                    revision: record.revision,
                    origin: record.origin.clone(),
                    title: record.title.clone(),
                    evidence: vec![],
                })
                .collect();
            if let Err(error) = ledger::append(&directory, &fresh) {
                eprintln!("Synced lesson history could not be recorded: {error}");
            }
        }
        Ok((shared, changed))
    }
}

fn size<T: Serialize>(value: &T) -> usize {
    serde_json::to_vec(value).map_or(0, |bytes| bytes.len() + 1)
}

/// Splits uploads into requests under the service's count and size limits.
pub fn batches(outgoing: Outgoing) -> Vec<(Vec<SyncedLesson>, Vec<SyncedRecord>)> {
    let mut batches: Vec<(Vec<SyncedLesson>, Vec<SyncedRecord>)> = vec![];
    let mut current = (vec![], vec![]);
    let mut bytes = 64;
    for lesson in outgoing.lessons {
        let length = size(&lesson);
        if !current.0.is_empty()
            && (current.0.len() >= LESSONS_PER_PUSH || bytes + length > PUSH_BYTES)
        {
            batches.push(std::mem::take(&mut current));
            bytes = 64;
        }
        bytes += length;
        current.0.push(lesson);
    }
    for record in outgoing.records {
        let length = size(&record);
        if (!current.0.is_empty() || !current.1.is_empty())
            && (current.1.len() >= RECORDS_PER_PUSH || bytes + length > PUSH_BYTES)
        {
            batches.push(std::mem::take(&mut current));
            bytes = 64;
        }
        bytes += length;
        current.1.push(record);
    }
    if !current.0.is_empty() || !current.1.is_empty() {
        batches.push(current);
    }
    batches
}

#[cfg(test)]
mod tests;
