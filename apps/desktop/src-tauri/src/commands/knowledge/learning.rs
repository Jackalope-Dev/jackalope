//! The learning loop. Reflection proposes changes to lessons Jackalope wrote,
//! `KnowledgeStore::promote` is the only writer that applies them, and usage
//! decides which learned lessons stay available. Every change is appended to a
//! per-project ledger. Hand-written knowledge, lessons a person edited and
//! repository instruction files are never changed here.

use super::*;
use sha2::{Digest, Sha256};

mod agent;
mod curate;
mod export;
pub mod ledger;
mod redact;
mod reflect;
pub mod sync;
pub mod watcher;

pub use agent::{agent_reflection, AgentBudget};
pub use curate::FOLDED;
pub use export::export_project;
pub use ledger::LedgerRecord;
pub use redact::redact;
pub use reflect::{reflect, Observation, ObservationKind};

/// Every tunable of the learning loop. Change values here only; the names
/// below are aliases for use in messages. See docs/PROJECT-KNOWLEDGE.md.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Thresholds {
    /// Distinct deliveries that end a lesson's probation.
    pub probation_deliveries: u64,
    /// Eligible tasks after which a lesson on probation that was never
    /// delivered is archived.
    pub probation_opportunities: u64,
    /// Eligible tasks since its last delivery after which a lesson is archived.
    pub idle_opportunities: u64,
    /// Available learned lessons per project; the least used is archived first.
    pub project_capacity: usize,
    /// New lessons one reflection may add, so a noisy run cannot flood a project.
    pub adds_per_reflection: usize,
    /// Near-duplicates one curator pass may fold.
    pub folds_per_curation: usize,
    /// Lesson changes in a project that make a curator pass due.
    pub curate_after_changes: u64,
    /// Seconds after which an active project is curated again regardless.
    pub curate_every_seconds: u64,
    /// Word overlap (0–1) at which the curator treats two lessons as one.
    pub fold_similarity: f64,
    /// Agent reflections per rolling hour and day across all projects.
    pub agent_reflections_per_hour: usize,
    pub agent_reflections_per_day: usize,
    /// Seconds an agent reflection may take before it is stopped.
    pub agent_timeout_seconds: u64,
    /// Bytes of the person's redacted words one agent reflection reads.
    pub agent_window_bytes: usize,
}

pub const THRESHOLDS: Thresholds = Thresholds {
    probation_deliveries: 2,
    probation_opportunities: 30,
    idle_opportunities: 100,
    project_capacity: 40,
    adds_per_reflection: 5,
    folds_per_curation: 5,
    curate_after_changes: 10,
    curate_every_seconds: 24 * 60 * 60,
    fold_similarity: 0.75,
    agent_reflections_per_hour: 4,
    agent_reflections_per_day: 20,
    agent_timeout_seconds: 45,
    agent_window_bytes: 6000,
};

pub const PROBATION_DELIVERIES: u64 = THRESHOLDS.probation_deliveries;
pub const PROBATION_OPPORTUNITIES: u64 = THRESHOLDS.probation_opportunities;
pub const IDLE_OPPORTUNITIES: u64 = THRESHOLDS.idle_opportunities;
pub const PROJECT_CAPACITY: usize = THRESHOLDS.project_capacity;
const ADDS_PER_REFLECTION: usize = THRESHOLDS.adds_per_reflection;
/// Reported tool calls between background reflections of a running task; a
/// per-project setting.
pub const DEFAULT_CADENCE: u32 = 50;
const EVIDENCE_REFERENCES: usize = 10;
const RECENT_RUNS: usize = 8;

pub const PROBATION: &str = "probation";
pub const ACTIVE: &str = "active";
pub const ARCHIVED: &str = "archived";

/// Usage and status of a learned lesson. Counters are local observations and
/// do not change the entry's revision, so they never conflict with an edit.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Lifecycle {
    /// `probation`, `active` or `archived`. Text, so a status from a newer app
    /// cannot make saved knowledge unreadable; unknown values read as active.
    #[serde(default)]
    pub status: String,
    /// The one sentence the lesson states, compared when later evidence
    /// repeats or contradicts it.
    #[serde(default)]
    pub statement: String,
    /// `reflection` (background), `session` (`/learn`) or `agent`.
    #[serde(default)]
    pub origin: String,
    #[serde(default)]
    pub born_at: String,
    /// Distinct tasks the lesson was supplied to.
    #[serde(default)]
    pub deliveries: u64,
    /// Eligible tasks in the project since the lesson was born or restored.
    #[serde(default)]
    pub opportunities: u64,
    /// Eligible tasks since the lesson was last supplied.
    #[serde(default)]
    pub idle: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_delivered_at: Option<String>,
    /// Recent receiving runs, so a run is never counted twice.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recent_runs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_reason: Option<String>,
    /// Restored after the curator folded it into another lesson, so the
    /// curator leaves it apart from then on.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub distinct: bool,
}

impl Lifecycle {
    pub fn archived(&self) -> bool {
        self.status == ARCHIVED
    }
    pub fn on_probation(&self) -> bool {
        self.status == PROBATION
    }
}

/// A lesson reflection wants to exist. Evidence is a reference (task or
/// conversation id) plus a redacted excerpt that only the ledger keeps.
#[derive(Clone, Debug, PartialEq)]
pub struct Lesson {
    pub key: String,
    pub kind: String,
    pub title: String,
    pub statement: String,
    pub content: String,
    pub keywords: Vec<String>,
    pub reference: String,
    pub excerpt: String,
    pub run_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Proposal {
    Add(Lesson),
    /// The same lesson seen again: record the evidence.
    Merge {
        target: String,
        lesson: Lesson,
    },
    /// A newer lesson contradicts the target: rewrite it.
    Patch {
        target: String,
        lesson: Lesson,
    },
    /// The person said the target no longer applies.
    Retire {
        target: String,
        reason: String,
        reference: String,
        excerpt: String,
    },
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Promotion {
    /// One line per change, such as `Added: User preference`.
    pub applied: Vec<String>,
    /// Why each refused proposal was refused.
    pub rejected: Vec<String>,
    /// Titles of lessons that already existed and gained nothing new.
    pub known: Vec<String>,
}

/// Independent of the folder. Project ids belong to one installation, so
/// lesson sync matches projects by repository and keeps these ids as they are.
pub fn learned_id(project_id: &str, key: &str) -> String {
    let hash = Sha256::digest(format!("learned-v1\0{project_id}\0{key}"));
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&hash[..16]);
    uuid::Uuid::from_bytes(bytes).to_string()
}

pub(super) fn lifecycle(entry: &KnowledgeEntry) -> Option<&Lifecycle> {
    entry.automatic.as_ref()?.lifecycle.as_ref()
}

fn lifecycle_mut(entry: &mut KnowledgeEntry) -> Option<&mut Lifecycle> {
    entry.automatic.as_mut()?.lifecycle.as_mut()
}

/// Whether the loop may change this entry: Jackalope wrote it and nobody has
/// edited it since.
pub(super) fn owned(entry: &KnowledgeEntry) -> bool {
    !entry.dismissed
        && entry
            .automatic
            .as_ref()
            .is_some_and(|source| source.managed && source.lifecycle.is_some())
}

fn in_project(entry: &KnowledgeEntry, project_id: &str, path: &str) -> bool {
    entry.project_id == project_id && entry.project_path == path
}

fn live(entry: &KnowledgeEntry) -> bool {
    !entry.dismissed && lifecycle(entry).is_some_and(|state| !state.archived())
}

fn record(entry: &KnowledgeEntry, action: &str, reason: String, origin: &str) -> LedgerRecord {
    LedgerRecord {
        id: uuid::Uuid::new_v4().to_string(),
        entry_id: entry.id.clone(),
        project_id: entry.project_id.clone(),
        at: Utc::now().to_rfc3339(),
        action: action.into(),
        reason,
        revision: entry.revision,
        origin: origin.into(),
        title: entry.title.clone(),
        evidence: vec![],
    }
}

fn with_evidence(mut record: LedgerRecord, reference: &str, excerpt: &str) -> LedgerRecord {
    let reference = reference.trim();
    let excerpt = excerpt.trim();
    if !reference.is_empty() && !excerpt.is_empty() {
        record.evidence.push(format!("{reference}: {excerpt}"));
    } else if !reference.is_empty() || !excerpt.is_empty() {
        record.evidence.push(format!("{reference}{excerpt}"));
    }
    record
}

fn touch(entry: &mut KnowledgeEntry) {
    entry.revision += 1;
    entry.updated_at = Utc::now().to_rfc3339();
}

fn archive(entry: &mut KnowledgeEntry, reason: &str) {
    if let Some(state) = lifecycle_mut(entry) {
        state.status = ARCHIVED.into();
        state.archived_reason = Some(reason.into());
    }
    entry.enabled = false;
    touch(entry);
}

fn restore(entry: &mut KnowledgeEntry) {
    if let Some(state) = lifecycle_mut(entry) {
        state.distinct |= state.archived_reason.as_deref() == Some(curate::FOLDED);
        state.status = if state.deliveries >= PROBATION_DELIVERIES {
            ACTIVE.into()
        } else {
            PROBATION.into()
        };
        state.archived_reason = None;
        state.opportunities = 0;
        state.idle = 0;
    }
    entry.enabled = true;
    touch(entry);
}

fn push_reference(entry: &mut KnowledgeEntry, reference: &str) -> bool {
    let Some(source) = entry.automatic.as_mut() else {
        return false;
    };
    if reference.is_empty() || source.evidence.iter().any(|item| item == reference) {
        return false;
    }
    if source.evidence.len() >= EVIDENCE_REFERENCES {
        source.evidence.remove(0);
    }
    source.evidence.push(reference.into());
    true
}

/// Validates one lesson. Statements that look like they carry a credential or
/// personal data are refused outright rather than stored redacted.
fn lint(mut lesson: Lesson) -> Result<Lesson, String> {
    let label = lesson.title.chars().take(60).collect::<String>();
    let statement = lesson.statement.trim().to_string();
    let (cleaned, sensitive) = redact::scan(&statement);
    if sensitive || redact::unsafe_text(&statement) {
        return Err(format!(
            "Skipped \"{label}\": it looked like it contained a credential or personal data."
        ));
    }
    let chars = cleaned.chars().count();
    if !(15..=500).contains(&chars)
        || cleaned.contains(['\n', '\r', '\0'])
        || cleaned.contains("```")
    {
        return Err(format!(
            "Skipped \"{label}\": a lesson is one sentence of 15–500 characters."
        ));
    }
    if cleaned != statement {
        lesson.content = lesson.content.replace(&statement, &cleaned);
        lesson.statement = cleaned;
    }
    lesson.title = lesson.title.trim().chars().take(100).collect();
    lesson.content = lesson.content.trim().to_string();
    lesson.keywords = lesson
        .keywords
        .iter()
        .map(|keyword| keyword.trim().to_lowercase())
        .filter(|keyword| (2..=60).contains(&keyword.len()))
        .collect();
    lesson.keywords.sort();
    lesson.keywords.dedup();
    lesson.keywords.truncate(10);
    if lesson.title.is_empty()
        || lesson.title.contains(['\n', '\r'])
        || lesson.content.is_empty()
        || lesson.content.len() > 800
        || lesson.content.contains('\0')
        || lesson.keywords.is_empty()
    {
        return Err(format!(
            "Skipped \"{label}\": it needs a title, content up to 800 characters and a matching phrase."
        ));
    }
    lesson.reference = lesson.reference.chars().take(120).collect();
    lesson.excerpt = redact(&lesson.excerpt).chars().take(240).collect();
    Ok(lesson)
}

/// Applies one proposal, returning the ledger records it produced; none means
/// the lesson was already known.
fn apply(
    entries: &mut Vec<KnowledgeEntry>,
    project_id: &str,
    path: &str,
    proposal: Proposal,
    origin: &str,
    adds: &mut usize,
) -> Result<Vec<LedgerRecord>, String> {
    let target_index = |entries: &[KnowledgeEntry], target: &str| -> Result<usize, String> {
        entries
            .iter()
            .position(|entry| entry.id == target && in_project(entry, project_id, path))
            .filter(|index| owned(&entries[*index]))
            .ok_or_else(|| {
                "Skipped a change to a lesson Jackalope did not write or that was edited.".into()
            })
    };
    match proposal {
        Proposal::Add(lesson) => {
            let lesson = lint(lesson)?;
            let id = learned_id(project_id, &lesson.key);
            if let Some(existing) = entries.iter().find(|entry| entry.id == id) {
                if existing.dismissed {
                    return Err(format!(
                        "Skipped \"{}\": you removed it earlier.",
                        lesson.title
                    ));
                }
                if !owned(existing) {
                    return Ok(vec![]);
                }
                return apply(
                    entries,
                    project_id,
                    path,
                    Proposal::Merge { target: id, lesson },
                    origin,
                    adds,
                );
            }
            let statement = words(&lesson.statement);
            if let Some(covered) = entries.iter().find(|entry| {
                in_project(entry, project_id, path)
                    && !entry.dismissed
                    && words(&entry.content).contains(&statement)
            }) {
                if owned(covered) {
                    let target = covered.id.clone();
                    return apply(
                        entries,
                        project_id,
                        path,
                        Proposal::Merge { target, lesson },
                        origin,
                        adds,
                    );
                }
                return Err(format!(
                    "Skipped \"{}\": already covered by \"{}\".",
                    lesson.title, covered.title
                ));
            }
            if let Some(conflict) = entries.iter().find(|entry| {
                in_project(entry, project_id, path)
                    && !entry.dismissed
                    && entry.enabled
                    && !owned(entry)
                    && entry.kind == KnowledgeKind::Memory
                    && reflect::contradicts(&entry.content, &lesson.statement)
            }) {
                return Err(format!(
                    "Skipped \"{}\": it conflicts with \"{}\", which Jackalope does not change.",
                    lesson.title, conflict.title
                ));
            }
            if *adds >= ADDS_PER_REFLECTION {
                return Err(format!(
                    "Skipped \"{}\": one reflection adds at most {ADDS_PER_REFLECTION} lessons.",
                    lesson.title
                ));
            }
            if entries.len() >= 500
                || entries
                    .iter()
                    .filter(|entry| entry.project_id == project_id)
                    .count()
                    >= 100
            {
                return Err(format!(
                    "Skipped \"{}\": project knowledge is full (100 per project, 500 total).",
                    lesson.title
                ));
            }
            let mut records = vec![];
            let available = entries
                .iter()
                .filter(|entry| in_project(entry, project_id, path) && live(entry))
                .count();
            if available >= PROJECT_CAPACITY {
                let evict = entries
                    .iter()
                    .enumerate()
                    .filter(|(_, entry)| {
                        in_project(entry, project_id, path) && live(entry) && owned(entry)
                    })
                    .min_by(|(_, a), (_, b)| {
                        let (a, b) = (lifecycle(a).unwrap(), lifecycle(b).unwrap());
                        a.deliveries
                            .cmp(&b.deliveries)
                            .then_with(|| {
                                a.last_delivered_at
                                    .as_deref()
                                    .unwrap_or(&a.born_at)
                                    .cmp(b.last_delivered_at.as_deref().unwrap_or(&b.born_at))
                            })
                    })
                    .map(|(index, _)| index)
                    .ok_or_else(|| {
                        format!(
                            "Skipped \"{}\": this project already has {PROJECT_CAPACITY} learned lessons.",
                            lesson.title
                        )
                    })?;
                archive(&mut entries[evict], "capacity");
                records.push(record(
                    &entries[evict],
                    "archived",
                    format!(
                        "Least used when the project reached {PROJECT_CAPACITY} learned lessons."
                    ),
                    "lifecycle",
                ));
            }
            let now = Utc::now().to_rfc3339();
            let entry = KnowledgeEntry {
                id,
                project_id: project_id.into(),
                project_path: path.into(),
                kind: KnowledgeKind::Memory,
                title: lesson.title.clone(),
                content: lesson.content.clone(),
                keywords: lesson.keywords.clone(),
                enabled: true,
                dismissed: false,
                process: Default::default(),
                automatic: Some(LearningSource {
                    kind: lesson.kind.clone(),
                    evidence: vec![lesson.reference.clone()],
                    managed: true,
                    resolution: None,
                    lifecycle: Some(Lifecycle {
                        status: PROBATION.into(),
                        statement: lesson.statement.clone(),
                        origin: origin.into(),
                        born_at: now.clone(),
                        ..Default::default()
                    }),
                }),
                source_run_id: lesson.run_id.clone(),
                source_head: None,
                revision: 1,
                updated_at: now,
            };
            records.push(with_evidence(
                record(
                    &entry,
                    "born",
                    format!("Learned a {}.", lesson.kind),
                    origin,
                ),
                &lesson.reference,
                &lesson.excerpt,
            ));
            entries.push(entry);
            *adds += 1;
            Ok(records)
        }
        Proposal::Merge { target, lesson } => {
            let lesson = lint(lesson)?;
            let index = target_index(entries, &target)?;
            let entry = &mut entries[index];
            if !push_reference(entry, &lesson.reference) {
                return Ok(vec![]);
            }
            let mut keywords = entry.keywords.clone();
            keywords.extend(lesson.keywords.iter().cloned());
            keywords.sort();
            keywords.dedup();
            keywords.truncate(10);
            entry.keywords = keywords;
            touch(entry);
            Ok(vec![with_evidence(
                record(entry, "merged", "Seen again.".into(), origin),
                &lesson.reference,
                &lesson.excerpt,
            )])
        }
        Proposal::Patch { target, lesson } => {
            let lesson = lint(lesson)?;
            let index = target_index(entries, &target)?;
            let entry = &mut entries[index];
            let previous = lifecycle(entry)
                .map(|state| state.statement.clone())
                .unwrap_or_default();
            if previous == lesson.statement {
                return Ok(vec![]);
            }
            push_reference(entry, &lesson.reference);
            entry.title = lesson.title.clone();
            entry.content = lesson.content.clone();
            entry.keywords = lesson.keywords.clone();
            if let Some(source) = entry.automatic.as_mut() {
                source.kind = lesson.kind.clone();
            }
            let was_archived = lifecycle(entry).is_some_and(Lifecycle::archived);
            if let Some(state) = lifecycle_mut(entry) {
                state.statement = lesson.statement.clone();
                state.idle = 0;
            }
            if was_archived {
                restore(entry);
            } else {
                touch(entry);
            }
            Ok(vec![with_evidence(
                record(
                    entry,
                    "patched",
                    format!("A newer instruction replaced: {previous}"),
                    origin,
                ),
                &lesson.reference,
                &lesson.excerpt,
            )])
        }
        Proposal::Retire {
            target,
            reason,
            reference,
            excerpt,
        } => {
            let index = target_index(entries, &target)?;
            let entry = &mut entries[index];
            if lifecycle(entry).is_some_and(Lifecycle::archived) {
                return Ok(vec![]);
            }
            archive(entry, "retired");
            Ok(vec![with_evidence(
                record(entry, "retired", reason, origin),
                &reference,
                &redact(&excerpt).chars().take(240).collect::<String>(),
            )])
        }
    }
}

impl KnowledgeStore {
    fn ledger_directory(&self) -> PathBuf {
        self.path
            .parent()
            .map(|parent| parent.join("ledger"))
            .unwrap_or_else(|| PathBuf::from("ledger"))
    }

    fn append_ledger(&self, records: &[LedgerRecord]) {
        if let Err(error) = ledger::append(&self.ledger_directory(), records) {
            eprintln!("Learned knowledge history could not be recorded: {error}");
        }
    }

    /// The promotion gate: the single writer for learned lessons.
    pub fn promote(
        &self,
        project_id: &str,
        project_path: &str,
        proposals: Vec<Proposal>,
        origin: &str,
    ) -> Result<Promotion, String> {
        let path = canonical(project_path)?;
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        let mut entries = self.read()?;
        let mut report = Promotion::default();
        let mut records = vec![];
        let mut adds = 0;
        for proposal in proposals {
            let title = match &proposal {
                Proposal::Add(lesson)
                | Proposal::Merge { lesson, .. }
                | Proposal::Patch { lesson, .. } => lesson.title.clone(),
                Proposal::Retire { target, .. } => entries
                    .iter()
                    .find(|entry| &entry.id == target)
                    .map(|entry| entry.title.clone())
                    .unwrap_or_default(),
            };
            match apply(&mut entries, project_id, &path, proposal, origin, &mut adds) {
                Ok(applied) if applied.is_empty() => report.known.push(title),
                Ok(applied) => {
                    for item in &applied {
                        report.applied.push(format!(
                            "{}: {}",
                            match item.action.as_str() {
                                "born" => "Added",
                                "merged" => "Seen again",
                                "patched" => "Updated",
                                "retired" => "Retired",
                                _ => "Archived",
                            },
                            item.title
                        ));
                    }
                    records.extend(applied);
                }
                Err(reason) => report.rejected.push(reason),
            }
        }
        if !records.is_empty() {
            self.write(&entries)?;
            self.append_ledger(&records);
        }
        Ok(report)
    }

    /// Records that a fresh task in the project selected context and which
    /// learned lessons it received. With automatic learning off only deliveries
    /// are counted, so turning it on later does not archive everything at once.
    pub fn record_delivery(
        &self,
        project_id: &str,
        project_path: &str,
        run_id: &str,
        delivered: &[String],
        automatic: bool,
    ) -> Result<(), String> {
        let path = canonical(project_path)?;
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        let mut entries = self.read()?;
        let mut records = vec![];
        let mut changed = false;
        let now = Utc::now().to_rfc3339();
        for entry in entries
            .iter_mut()
            .filter(|entry| in_project(entry, project_id, &path) && live(entry))
        {
            let managed = owned(entry);
            let received = delivered.contains(&entry.id);
            let counted = lifecycle(entry)
                .is_some_and(|state| state.recent_runs.iter().any(|id| id == run_id));
            if counted || (!received && !automatic) {
                continue;
            }
            let state = lifecycle_mut(entry).unwrap();
            if automatic {
                state.opportunities += 1;
                state.idle += 1;
            }
            if received {
                state.deliveries += 1;
                state.idle = 0;
                state.last_delivered_at = Some(now.clone());
            }
            state.recent_runs.push(run_id.into());
            if state.recent_runs.len() > RECENT_RUNS {
                state.recent_runs.remove(0);
            }
            changed = true;
            let promoted = state.on_probation() && state.deliveries >= PROBATION_DELIVERIES;
            if promoted {
                state.status = ACTIVE.into();
            }
            let expired = automatic
                && managed
                && if state.deliveries == 0 && state.on_probation() {
                    state.opportunities >= PROBATION_OPPORTUNITIES
                } else {
                    state.idle >= IDLE_OPPORTUNITIES
                };
            if promoted {
                touch(entry);
                records.push(record(
                    entry,
                    "promoted",
                    format!("Supplied to {PROBATION_DELIVERIES} tasks; probation ended."),
                    "lifecycle",
                ));
            }
            if expired {
                let never = lifecycle(entry)
                    .is_some_and(|state| state.deliveries == 0 && state.on_probation());
                archive(entry, "unused");
                records.push(record(
                    entry,
                    "archived",
                    if never {
                        format!("Not supplied to any of {PROBATION_OPPORTUNITIES} eligible tasks.")
                    } else {
                        format!("Not supplied to the last {IDLE_OPPORTUNITIES} eligible tasks.")
                    },
                    "lifecycle",
                ));
            }
        }
        if changed {
            self.write(&entries)?;
            self.append_ledger(&records);
        }
        Ok(())
    }

    /// Archives or restores a learned lesson for a person. Edited lessons can
    /// be archived too; hand-written ones have no lifecycle and are paused instead.
    pub fn set_archived(
        &self,
        id: &str,
        revision: u64,
        archived: bool,
    ) -> Result<KnowledgeEntry, String> {
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        let mut entries = self.read()?;
        let entry = entries
            .iter_mut()
            .find(|entry| entry.id == id && !entry.dismissed)
            .ok_or("This lesson no longer exists.")?;
        if entry.revision != revision {
            return Err("This lesson changed. Reload it first.".into());
        }
        let Some(state) = lifecycle(entry) else {
            return Err("Only learned lessons can be archived; pause this one instead.".into());
        };
        if state.archived() == archived {
            return Ok(entry.clone());
        }
        let record = if archived {
            archive(entry, "user");
            record(entry, "archived", "Archived by you.".into(), "user")
        } else {
            restore(entry);
            record(entry, "restored", "Restored by you.".into(), "user")
        };
        let saved = entry.clone();
        self.write(&entries)?;
        self.append_ledger(&[record]);
        Ok(saved)
    }

    /// The newest ledger records for one entry, oldest first.
    pub fn history(&self, project_id: &str, entry_id: &str, limit: usize) -> Vec<LedgerRecord> {
        ledger::read(&self.ledger_directory(), project_id, entry_id, limit)
    }

    pub(super) fn record_edit(&self, entry: &KnowledgeEntry, action: &str, reason: &str) {
        if lifecycle(entry).is_some() {
            self.append_ledger(&[record(entry, action, reason.into(), "user")]);
        }
    }
}

/// Counts delivery for a freshly launched task. Failures are logged, never
/// surfaced to the task.
pub fn observe_delivery(runtime: &TaskRuntime, request: &super::super::tasks::RunRequest) {
    if request.previous_run_id.is_some() || request.context_selection.memory_off {
        return;
    }
    let automatic = crate::commands::project_registry::settings(runtime, &request.project_id)
        .learn_automatically;
    let delivered: Vec<String> = request
        .context_receipt
        .entries
        .iter()
        .filter(|entry| entry.kind == KnowledgeKind::Memory)
        .map(|entry| entry.id.clone())
        .collect();
    if let Err(error) = runtime.knowledge.record_delivery(
        &request.project_id,
        &request.project_path,
        &request.id,
        &delivered,
        automatic,
    ) {
        eprintln!("Learned lesson usage was not recorded: {error}");
    }
}

/// Local counts that help calibrate the thresholds: current lessons by status
/// and their deliveries, and changes recorded in the retained history.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningMetrics {
    pub probation: usize,
    pub active: usize,
    pub archived: usize,
    /// Deliveries of current learned lessons on this device.
    pub deliveries: u64,
    pub learned: usize,
    pub promoted: usize,
    pub archived_events: usize,
    pub restored: usize,
    pub folded: usize,
    pub retired: usize,
    /// Lessons an agent reflection suggested.
    pub by_agent: usize,
    /// The oldest retained history record, which bounds the counts above.
    pub since: Option<String>,
}

impl KnowledgeStore {
    pub fn metrics(&self, project_id: &str, project_path: &str) -> Result<LearningMetrics, String> {
        let mut metrics = LearningMetrics::default();
        for entry in self.list(project_id, project_path)? {
            let Some(state) = lifecycle(&entry) else {
                continue;
            };
            metrics.deliveries += state.deliveries;
            if state.archived() {
                metrics.archived += 1;
            } else if state.on_probation() {
                metrics.probation += 1;
            } else {
                metrics.active += 1;
            }
        }
        for record in ledger::read_project(&self.ledger_directory(), project_id) {
            if metrics
                .since
                .as_ref()
                .is_none_or(|since| record.at < *since)
            {
                metrics.since = Some(record.at.clone());
            }
            match record.action.as_str() {
                "born" => {
                    metrics.learned += 1;
                    metrics.by_agent += usize::from(record.origin == "agent");
                }
                "promoted" => metrics.promoted += 1,
                "archived" => metrics.archived_events += 1,
                "restored" => metrics.restored += 1,
                "curated" => metrics.folded += 1,
                "retired" => metrics.retired += 1,
                _ => {}
            }
        }
        Ok(metrics)
    }
}

#[tauri::command]
pub fn knowledge_learning_metrics(
    project_id: String,
    project_path: String,
    state: State<'_, TaskRuntime>,
) -> Result<LearningMetrics, String> {
    state.knowledge.metrics(&project_id, &project_path)
}

#[tauri::command]
pub fn knowledge_history(
    project_id: String,
    entry_id: String,
    state: State<'_, TaskRuntime>,
) -> Vec<LedgerRecord> {
    state.knowledge.history(&project_id, &entry_id, 50)
}

#[tauri::command]
pub fn knowledge_set_archived(
    id: String,
    revision: u64,
    archived: bool,
    state: State<'_, TaskRuntime>,
) -> Result<KnowledgeEntry, String> {
    state.knowledge.set_archived(&id, revision, archived)
}

#[cfg(test)]
mod tests;
