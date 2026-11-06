//! Plans live in app storage, one JSON record per plan with every revision.
//! Records are written atomically; an unreadable record is quarantined and
//! reported instead of being overwritten.

use super::{
    artifact::{self, PlanDocument},
    rounds::RoundAssignment,
};
use crate::commands::{history, tasks::RunRequest};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

const RECORD_LIMIT: u64 = 4_000_000;
const MAX_PLANS: usize = 500;
const MAX_REVISIONS: usize = 200;

static LOCK: Mutex<()> = Mutex::new(());

/// Counts plan and planning-settings writes, so terminals watching for work
/// changes also see plans edited, decided or re-planned in the app.
fn changes() -> &'static tokio::sync::watch::Sender<u64> {
    static CHANGES: std::sync::OnceLock<tokio::sync::watch::Sender<u64>> =
        std::sync::OnceLock::new();
    CHANGES.get_or_init(|| tokio::sync::watch::channel(0).0)
}

pub fn revision() -> u64 {
    *changes().borrow()
}

pub fn subscribe() -> tokio::sync::watch::Receiver<u64> {
    changes().subscribe()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub number: u32,
    pub markdown: String,
    pub hash: String,
    /// `planner`, `you` or `amendment`.
    pub author: String,
    #[serde(default)]
    pub note: String,
    pub created_at: String,
    #[serde(default)]
    pub run_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub revision: u32,
    pub hash: String,
    pub source_head: String,
    pub approved_by: String,
    pub approved_at: String,
    pub shape: String,
    /// How the work is verified: `project` (the saved check), `criteria`
    /// (the plan's command and test criteria) or `review` (no check; the
    /// independent plan review only). Empty for approvals saved before this
    /// was recorded, which always used the project check.
    #[serde(default)]
    pub verification: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Execution {
    pub shape: String,
    pub revision: u32,
    #[serde(default)]
    pub managed_task_id: Option<String>,
    /// Plan task key → queue item, for showing task progress.
    #[serde(default)]
    pub items: Vec<(String, String)>,
    pub started_at: String,
    /// The most rounds a swarm may run. Zero for executions without rounds,
    /// including every execution saved before rounds existed.
    #[serde(default)]
    pub max_rounds: u32,
    /// Swarm rounds, oldest first; `managed_task_id` is the last round's task.
    #[serde(default)]
    pub rounds: Vec<Round>,
    /// The next round waits for the person to approve the orchestrator's
    /// assignments. False for executions saved before this choice existed.
    #[serde(default)]
    pub ask_before_rounds: bool,
    /// The most orchestrator attempts reviewing a round in parallel, one per
    /// area of the plan. Zero (saved before areas existed) reviews as one.
    #[serde(default)]
    pub orchestrators: u32,
}

/// One swarm round: its assignments run as a managed task, and once their
/// result is merged a read-only orchestrator attempt reviews the integrated
/// tree and either declares the plan done or names the next round's work.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Round {
    pub number: u32,
    pub managed_task_id: String,
    pub started_at: String,
    /// Orchestrator attempts for this round, oldest first.
    #[serde(default)]
    pub review_run_ids: Vec<String>,
    /// Attempts whose result was already read.
    #[serde(default)]
    pub handled: Vec<String>,
    /// Automatic retries since the person last resumed the round.
    #[serde(default)]
    pub retries: u32,
    /// Why the next orchestrator attempt runs again, shown to it.
    #[serde(default)]
    pub note: String,
    /// Why the round waits for the person; cleared when they resume.
    #[serde(default)]
    pub held: Option<String>,
    /// `done`, `next` or `limit`; empty while the round runs or is reviewed.
    #[serde(default)]
    pub verdict: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub evidence: Vec<String>,
    /// The check that ran on the integrated tree, when the plan has one.
    #[serde(default)]
    pub check: Option<RoundCheck>,
    /// Titles of the assignments the verdict named for the next round.
    #[serde(default)]
    pub next: Vec<String>,
    #[serde(default)]
    pub decided_at: Option<String>,
    /// The next round's assignments while they wait for the person's approval.
    #[serde(default)]
    pub proposal: Option<Vec<RoundAssignment>>,
    /// Areas reviewed by parallel orchestrators; empty when one reviews the
    /// whole plan. Their verdicts combine into the round's verdict.
    #[serde(default)]
    pub areas: Vec<AreaReview>,
    /// An agent is deciding the proposal for the person. Cleared when it
    /// approves or hands the proposal to the person.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub agent_deciding: bool,
}

/// One orchestrator's review of an area of the plan within a round.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AreaReview {
    pub name: String,
    pub scopes: Vec<String>,
    /// This area's orchestrator attempts, oldest first; also in the round's
    /// `review_run_ids`.
    #[serde(default)]
    pub run_ids: Vec<String>,
    /// `done` or `next` once this area's attempt was accepted; empty before.
    #[serde(default)]
    pub verdict: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub evidence: Vec<String>,
    #[serde(default)]
    pub assignments: Vec<RoundAssignment>,
    #[serde(default)]
    pub check: Option<RoundCheck>,
    #[serde(default)]
    pub retries: u32,
    #[serde(default)]
    pub note: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundCheck {
    pub command: String,
    pub passed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Deviation {
    pub id: String,
    #[serde(default)]
    pub run_id: Option<String>,
    /// `declared`, `scope` or `criterion`.
    pub kind: String,
    pub summary: String,
    #[serde(default)]
    pub amendment: String,
    /// `pending`, `accepted`, `redo` or `replan`.
    pub status: String,
    pub created_at: String,
    #[serde(default)]
    pub resolved_at: Option<String>,
    /// An agent is deciding whether to accept it for the person.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub agent_deciding: bool,
    /// Who accepted it, when that was an agent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_by: Option<String>,
}

/// One decision agents made, or tried to make, for the person on this plan:
/// a question, a swarm round or a deviation. Kept so the person can see,
/// question and override every one.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutonomyEntry {
    pub id: String,
    /// `question`, `round` or `deviation`.
    pub kind: String,
    /// The question, `Round n` or the deviation summary.
    pub subject: String,
    /// The execution it counts against, by its start time.
    #[serde(default)]
    pub execution: String,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub prompt_id: Option<String>,
    #[serde(default)]
    pub deviation_id: Option<String>,
    /// `deciding`, `decided`, `escalated` or `person` (the person answered first).
    pub outcome: String,
    #[serde(default)]
    pub answer: Option<String>,
    #[serde(default)]
    pub decider: Option<String>,
    #[serde(default)]
    pub decider_run_id: Option<String>,
    #[serde(default)]
    pub rationale: String,
    #[serde(default)]
    pub confidence: Option<f64>,
    #[serde(default)]
    pub evidence: Vec<String>,
    /// Why it went to the person: a question category, `decider`, `limit`,
    /// `checks` or `interrupted`.
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub decided_at: Option<String>,
    #[serde(default)]
    pub overridden: Option<AutonomyOverride>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutonomyOverride {
    pub answer: String,
    pub by: String,
    pub at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// Every planning attempt, oldest first. They share one conversation.
    #[serde(default)]
    pub run_ids: Vec<String>,
    /// Attempts whose final message was already read into a revision.
    #[serde(default)]
    pub ingested: Vec<String>,
    #[serde(default = "default_cap")]
    pub question_cap: usize,
    /// Questions forwarded before the current attempt.
    #[serde(default)]
    pub asked_before: usize,
}

fn default_cap() -> usize {
    super::interview::DEFAULT_QUESTION_CAP
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRecord {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_path: String,
    pub title: String,
    /// The request as the person first wrote it.
    pub goal: String,
    pub created_at: String,
    pub updated_at: String,
    /// Settings for planning and for the work the plan starts.
    pub request: RunRequest,
    #[serde(default)]
    pub session: Session,
    #[serde(default)]
    pub revisions: Vec<Revision>,
    #[serde(default)]
    pub approval: Option<Approval>,
    #[serde(default)]
    pub execution: Option<Execution>,
    #[serde(default)]
    pub deviations: Vec<Deviation>,
    #[serde(default)]
    pub error: Option<String>,
    /// Reflection proposals were sent after acceptance.
    #[serde(default)]
    pub reflected: bool,
    #[serde(default)]
    pub archived: bool,
    /// Decisions agents made or handed to the person, oldest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub autonomy: Vec<AutonomyEntry>,
}

impl PlanRecord {
    pub fn latest(&self) -> Option<&Revision> {
        self.revisions.last()
    }

    pub fn document(&self) -> Option<PlanDocument> {
        artifact::parse(&self.latest()?.markdown).ok()
    }

    /// `planning`, `draft`, `approved`, `running`, `paused` or `done`.
    pub fn status(&self) -> String {
        self.document()
            .map(|doc| doc.front.status)
            .unwrap_or_else(|| "planning".into())
    }

    /// Appends a revision, numbering it and stamping its front matter.
    pub fn push_revision(
        &mut self,
        mut doc: PlanDocument,
        author: &str,
        note: &str,
        run_id: Option<String>,
    ) -> Result<u32, String> {
        doc.validate()?;
        if self.revisions.len() >= MAX_REVISIONS {
            return Err("This plan has reached its revision limit. Start a new plan.".into());
        }
        let number = self.revisions.last().map_or(1, |rev| rev.number + 1);
        doc.front.id = self.id.clone();
        doc.front.project = self.project_id.clone();
        doc.front.revision = number;
        let markdown = doc.render();
        if markdown.len() > artifact::MAX_DOCUMENT_BYTES {
            return Err("The plan is too large.".into());
        }
        self.revisions.push(Revision {
            number,
            hash: doc.content_hash(),
            markdown,
            author: author.into(),
            note: note.chars().take(500).collect(),
            created_at: Utc::now().to_rfc3339(),
            run_id,
        });
        self.title = doc.title.clone();
        self.updated_at = Utc::now().to_rfc3339();
        Ok(number)
    }
}

/// Per-project planning preferences.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSettings {
    #[serde(default = "default_cap")]
    pub question_cap: usize,
    /// Plan with this agent instead of the task's selected agent.
    #[serde(default)]
    pub planner_agent: Option<String>,
    #[serde(default)]
    pub planner_model: Option<String>,
    /// Where Save to repo writes, relative to the project; `{slug}` is the title.
    #[serde(default = "default_export")]
    pub export_path: String,
    /// The most rounds a swarm runs before it waits for a re-plan.
    #[serde(default = "default_rounds")]
    pub max_rounds: u32,
    /// New swarms ask before starting each next round.
    #[serde(default)]
    pub ask_before_rounds: bool,
    /// The most orchestrators reviewing a swarm round in parallel.
    #[serde(default = "default_orchestrators")]
    pub orchestrators: u32,
    /// What agents may decide for the person in this project's plans.
    #[serde(default)]
    pub decide: DecideSettings,
}

/// The project's Autonomy settings. Everything is off until the person turns
/// it on; a committed `.jackalope/autonomy.json` can only make it stricter.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecideSettings {
    /// Agents answer routine questions from plan work.
    #[serde(default)]
    pub questions: bool,
    /// Agents approve proposed swarm rounds after a checked merge.
    #[serde(default)]
    pub rounds: bool,
    /// Agents accept deviations that stay within the plan's scopes.
    #[serde(default)]
    pub deviations: bool,
    #[serde(default = "default_max_decisions")]
    pub max_agent_decisions: u32,
    /// `auto` (another model family than the asking agent where one is
    /// installed) or an agent ID.
    #[serde(default = "default_decider")]
    pub decider: String,
}

pub const DEFAULT_MAX_DECISIONS: u32 = 50;
pub const MAX_DECISIONS: u32 = 500;

fn default_max_decisions() -> u32 {
    DEFAULT_MAX_DECISIONS
}

fn default_decider() -> String {
    "auto".into()
}

impl Default for DecideSettings {
    fn default() -> Self {
        Self {
            questions: false,
            rounds: false,
            deviations: false,
            max_agent_decisions: DEFAULT_MAX_DECISIONS,
            decider: default_decider(),
        }
    }
}

fn default_orchestrators() -> u32 {
    1
}

fn default_rounds() -> u32 {
    super::rounds::DEFAULT_ROUNDS
}

fn default_export() -> String {
    "docs/plans/{slug}.md".into()
}

impl Default for PlanSettings {
    fn default() -> Self {
        Self {
            question_cap: default_cap(),
            planner_agent: None,
            planner_model: None,
            export_path: default_export(),
            max_rounds: default_rounds(),
            ask_before_rounds: false,
            orchestrators: default_orchestrators(),
            decide: DecideSettings::default(),
        }
    }
}

impl PlanSettings {
    pub fn validate(&self) -> Result<(), String> {
        if self.question_cap > super::interview::MAX_QUESTION_CAP {
            return Err(format!(
                "Allow up to {} planning questions.",
                super::interview::MAX_QUESTION_CAP
            ));
        }
        if !(1..=super::rounds::MAX_ROUNDS).contains(&self.max_rounds) {
            return Err(format!(
                "Allow between 1 and {} swarm rounds.",
                super::rounds::MAX_ROUNDS
            ));
        }
        if !(1..=super::rounds::MAX_ORCHESTRATORS).contains(&self.orchestrators) {
            return Err(format!(
                "Allow between 1 and {} orchestrators.",
                super::rounds::MAX_ORCHESTRATORS
            ));
        }
        relative_path(&self.export_path.replace("{slug}", "plan"))?;
        if !(1..=MAX_DECISIONS).contains(&self.decide.max_agent_decisions) {
            return Err(format!(
                "Allow between 1 and {MAX_DECISIONS} agent decisions per plan."
            ));
        }
        let decider = self.decide.decider.trim();
        if decider.is_empty()
            || decider.len() > 80
            || decider.chars().any(|c| c.is_whitespace() || c.is_control())
        {
            return Err("Choose Automatic or an installed agent to decide.".into());
        }
        Ok(())
    }
}

pub struct Store {
    directory: PathBuf,
}

fn relative_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value.trim());
    if value.trim().is_empty()
        || value.len() > 240
        || path.is_absolute()
        || value.starts_with(['/', '\\'])
        || value.contains(':')
        || path
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
        || !value.ends_with(".md")
    {
        return Err(
            "Use a relative .md path inside the project, such as docs/plans/{slug}.md.".into(),
        );
    }
    Ok(path.to_path_buf())
}

pub fn slug(title: &str) -> String {
    let mut slug = String::new();
    for c in title.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
        if slug.len() >= 60 {
            break;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "plan".into()
    } else {
        slug
    }
}

impl Store {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    fn path(&self, id: &str) -> Result<PathBuf, String> {
        uuid::Uuid::parse_str(id).map_err(|_| "Unknown plan.")?;
        Ok(self.directory.join(format!("{id}.json")))
    }

    pub fn load(&self, id: &str) -> Result<PlanRecord, String> {
        let path = self.path(id)?;
        let bytes = history::read_bounded(&path, RECORD_LIMIT).map_err(|_| "Plan not found.")?;
        serde_json::from_slice(&bytes).map_err(|error| {
            let entry = history::quarantine(&path, format!("The plan could not be read: {error}"));
            entry.reason
        })
    }

    fn write(&self, record: &PlanRecord) -> Result<(), String> {
        std::fs::create_dir_all(&self.directory).map_err(|error| error.to_string())?;
        let bytes = serde_json::to_vec_pretty(record).map_err(|error| error.to_string())?;
        history::write_atomic(&self.path(&record.id)?, &bytes)?;
        changes().send_modify(|revision| *revision += 1);
        Ok(())
    }

    pub fn create(&self, record: &PlanRecord) -> Result<(), String> {
        let _guard = LOCK.lock().map_err(|error| error.to_string())?;
        if self.list(None)?.0.len() >= MAX_PLANS {
            return Err("The plan history limit has been reached. Archive older plans.".into());
        }
        if self.path(&record.id)?.exists() {
            return Err("This plan already exists.".into());
        }
        self.write(record)
    }

    /// Read-modify-write under the store lock. Never call the coordinator from
    /// `change`: the store lock is taken after the coordinator's, never before.
    pub fn update<T>(
        &self,
        id: &str,
        change: impl FnOnce(&mut PlanRecord) -> Result<T, String>,
    ) -> Result<(PlanRecord, T), String> {
        let _guard = LOCK.lock().map_err(|error| error.to_string())?;
        let mut record = self.load(id)?;
        let value = change(&mut record)?;
        record.updated_at = Utc::now().to_rfc3339();
        self.write(&record)?;
        Ok((record, value))
    }

    /// Plans, newest first, with reasons for any that could not be read.
    pub fn list(&self, project_id: Option<&str>) -> Result<(Vec<PlanRecord>, Vec<String>), String> {
        let mut plans = vec![];
        let mut problems = vec![];
        let Ok(entries) = std::fs::read_dir(&self.directory) else {
            return Ok((plans, problems));
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(id) = path
                .file_name()
                .and_then(|name| name.to_str())
                .and_then(|name| name.strip_suffix(".json"))
            else {
                continue;
            };
            if uuid::Uuid::parse_str(id).is_err() {
                continue;
            }
            match self.load(id) {
                Ok(record) if project_id.is_none_or(|project| record.project_id == project) => {
                    plans.push(record)
                }
                Ok(_) => {}
                Err(error) => problems.push(error),
            }
        }
        plans.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok((plans, problems))
    }

    fn settings_path(&self) -> PathBuf {
        self.directory.join("settings.json")
    }

    pub fn settings(&self, project_id: &str) -> PlanSettings {
        history::read_bounded(&self.settings_path(), 1_000_000)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<HashMap<String, PlanSettings>>(&bytes).ok())
            .and_then(|mut all| all.remove(project_id))
            .unwrap_or_default()
    }

    pub fn save_settings(&self, project_id: &str, settings: PlanSettings) -> Result<(), String> {
        settings.validate()?;
        let _guard = LOCK.lock().map_err(|error| error.to_string())?;
        let mut all: HashMap<String, PlanSettings> =
            history::read_bounded(&self.settings_path(), 1_000_000)
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                .unwrap_or_default();
        all.insert(project_id.into(), settings);
        std::fs::create_dir_all(&self.directory).map_err(|error| error.to_string())?;
        history::write_atomic(
            &self.settings_path(),
            &serde_json::to_vec_pretty(&all).map_err(|error| error.to_string())?,
        )?;
        changes().send_modify(|revision| *revision += 1);
        Ok(())
    }
}

/// Writes the current revision into the project. Never stages or commits.
pub fn export(record: &PlanRecord, template: &str) -> Result<PathBuf, String> {
    let revision = record.latest().ok_or("This plan has no revision yet.")?;
    let relative = relative_path(&template.replace("{slug}", &slug(&record.title)))?;
    let root = std::fs::canonicalize(&record.project_path).map_err(|error| error.to_string())?;
    let target = root.join(&relative);
    let parent = target.parent().ok_or("Choose a file inside the project.")?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let parent = std::fs::canonicalize(parent).map_err(|error| error.to_string())?;
    if !parent.starts_with(&root) {
        return Err("Choose a file inside the project.".into());
    }
    let target = parent.join(target.file_name().ok_or("Choose a file name.")?);
    if target.is_symlink() {
        return Err("The export path is a symbolic link.".into());
    }
    history::write_atomic(&target, revision.markdown.as_bytes())?;
    Ok(relative)
}
