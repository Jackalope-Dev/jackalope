mod windows;
pub use windows::*;
mod changes;
mod topics;
pub use topics::*;
mod learning;
pub use learning::*;

use super::{
    coordination::Coordinator,
    history,
    tasks::{RunRequest, TaskRun, TaskRuntime},
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessage {
    pub id: String,
    pub text: String,
    pub created_at: String,
    pub run_id: Option<String>,
    pub canceled: bool,
    /// Who sent a message that did not come from the person: a wake-up, another bot or a card answer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<MessageOrigin>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MessageOrigin {
    /// `wake`, `bot`, `reply` or `card`.
    pub kind: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bot_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bot_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Deserialize)]
pub struct FirstMessage {
    pub(super) id: String,
    pub(super) text: String,
    /// Set natively by the bot hub; renderer requests cannot claim an origin.
    #[serde(skip)]
    pub(super) origin: Option<MessageOrigin>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBatch {
    pub run_id: String,
    pub message_ids: Vec<String>,
    pub prompt: String,
    pub previous_run_id: Option<String>,
    pub error: Option<String>,
    pub settled: bool,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDraft {
    pub text: String,
    pub revision: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSession {
    /// Standing instructions from a saved bot, repeated in every batch prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona: Option<SessionPersona>,
    #[serde(default)]
    pub topics: Vec<SessionTopic>,
    #[serde(default)]
    pub topics_revision: u64,
    #[serde(default)]
    pub limits: SessionLimits,
    #[serde(default)]
    pub integrated_run_id: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub last_learned_message_id: Option<String>,
    pub id: String,
    pub title: String,
    pub request: RunRequest,
    pub created_at: String,
    pub updated_at: String,
    pub paused: bool,
    pub closed: bool,
    pub messages: Vec<SessionMessage>,
    pub batches: Vec<SessionBatch>,
    pub draft: SessionDraft,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPersona {
    pub bot_id: String,
    pub name: String,
    pub instructions: String,
}

impl SessionPersona {
    fn validate(&self) -> Result<(), String> {
        Uuid::parse_str(&self.bot_id).map_err(|_| "Invalid bot identifier")?;
        let name = self.name.trim();
        if name.is_empty() || name.chars().count() > 60 || name.chars().any(char::is_control) {
            return Err("Use a bot name up to 60 characters.".into());
        }
        if self.instructions.chars().count() > 6_000 {
            return Err("Keep bot instructions under 6,000 characters.".into());
        }
        Ok(())
    }
}

pub(in crate::commands) struct MessageState {
    pub run_id: Option<String>,
    pub settled: bool,
    pub canceled: bool,
    pub closed: bool,
    pub error: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLimits {
    pub max_batches: Option<usize>,
    pub pause_at_estimated_usd: Option<f64>,
}

impl SessionLimits {
    fn validate(&self) -> Result<(), String> {
        if self
            .max_batches
            .is_some_and(|value| value == 0 || value > 1000)
            || self
                .pause_at_estimated_usd
                .is_some_and(|value| !value.is_finite() || value <= 0.0 || value > 100_000.0)
        {
            return Err("Choose 1–1,000 batches and a positive estimated-cost threshold up to $100,000, or leave limits blank.".into());
        }
        Ok(())
    }
}

fn limit_reason(session: &LiveSession, runs: &[TaskRun]) -> Option<String> {
    if session
        .limits
        .max_batches
        .is_some_and(|limit| session.batches.len() >= limit)
    {
        return Some("The session reached its batch limit. Review the result and adjust limits before resuming.".into());
    }
    let threshold = session.limits.pause_at_estimated_usd?;
    let mut total = 0.0;
    for batch in &session.batches {
        let Some(run) = runs.iter().find(|run| run.id == batch.run_id) else {
            return Some("A session attempt is unavailable. Restore its history before resuming with a cost threshold.".into());
        };
        let mut usage = vec![&run.usage];
        if let Some(routing) = &run.routing {
            usage.extend(routing.handoffs.iter().map(|leg| &leg.usage));
            if routing.attempts.is_empty() {
                usage.extend(routing.decisions.iter().map(|decision| &decision.usage));
            } else {
                usage.extend(routing.attempts.iter().map(|attempt| &attempt.usage));
            }
        }
        for value in usage {
            match value.estimated_cost_usd.filter(|cost| cost.is_finite() && *cost >= 0.0) {
                Some(cost) if value.reported => total += cost,
                _ => return Some("Estimated cost is unavailable for part of this session. Review usage or remove the cost threshold before resuming.".into()),
            }
        }
    }
    (total >= threshold).then(|| "The session reached its estimated-cost threshold. Review usage and adjust limits before resuming.".into())
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct Ledger {
    sessions: Vec<LiveSession>,
}

/// Other conversations a bot's new conversation is told about.
const RECENT_CONVERSATIONS: usize = 5;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revisions: Option<std::collections::BTreeMap<String, String>>,
    pub sessions: Vec<LiveSession>,
    pub runs: Vec<TaskRun>,
    pub error: Option<String>,
}

struct Inner {
    ledger: Ledger,
    error: Option<String>,
}

#[derive(Clone)]
pub struct LiveSessions {
    inner: Arc<Mutex<Inner>>,
    path: PathBuf,
    runtime: TaskRuntime,
    coordinator: Coordinator,
    alive: Arc<AtomicBool>,
    gate: Arc<Mutex<()>>,
    /// Counts changes the dispatch loop makes, such as a batch starting or
    /// failing before any task exists. Task history alone cannot report those.
    changes: Arc<tokio::sync::watch::Sender<u64>>,
}

impl LiveSessions {
    pub fn new(path: PathBuf, runtime: TaskRuntime, coordinator: Coordinator) -> Self {
        let loaded = if path.exists() {
            history::read_bounded(&path, 16_000_000).and_then(|bytes| {
                serde_json::from_slice::<Ledger>(&bytes).map_err(|e| e.to_string())
            })
        } else {
            Ok(Ledger::default())
        };
        let (mut ledger, error) = match loaded {
            Ok(ledger) => (ledger, None),
            Err(error) => (
                Ledger::default(),
                Some(format!(
                    "Live sessions could not be loaded. The saved file is unchanged: {error}"
                )),
            ),
        };
        let runs = runtime.live_session_runs(None).unwrap_or_default();
        for session in &mut ledger.sessions {
            session.paused = true;
            if let Some(batch) = session.batches.last_mut().filter(|batch| !batch.settled) {
                session.error = Some(
                    "The session was interrupted. Review the last attempt before resuming.".into(),
                );
                if !runs.iter().any(|run| run.id == batch.run_id) {
                    batch.error = Some("The pending launch was interrupted. Retry it explicitly after reviewing saved task history.".into());
                }
            }
        }
        Self {
            inner: Arc::new(Mutex::new(Inner { ledger, error })),
            path,
            runtime,
            coordinator,
            alive: Arc::new(AtomicBool::new(true)),
            gate: Arc::new(Mutex::new(())),
            changes: Arc::new(tokio::sync::watch::channel(0).0),
        }
    }

    pub fn subscribe(&self) -> tokio::sync::watch::Receiver<u64> {
        self.changes.subscribe()
    }

    pub fn revision(&self) -> u64 {
        *self.changes.borrow()
    }

    fn changed(&self) {
        self.changes.send_modify(|revision| *revision += 1);
    }

    fn save(&self, ledger: &Ledger) -> Result<(), String> {
        let bytes = serde_json::to_vec(ledger).map_err(|e| e.to_string())?;
        if bytes.len() > 16_000_000 {
            return Err("Live session storage is full. Finish or export existing sessions.".into());
        }
        std::fs::create_dir_all(self.path.parent().ok_or("Invalid session path")?)
            .map_err(|e| e.to_string())?;
        history::write_atomic(&self.path, &bytes)
    }

    fn update<T>(
        &self,
        change: impl FnOnce(&mut Ledger) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(error) = &inner.error {
            return Err(error.clone());
        }
        let mut ledger = inner.ledger.clone();
        let result = change(&mut ledger)?;
        self.save(&ledger)?;
        inner.ledger = ledger;
        Ok(result)
    }

    fn session<'a>(ledger: &'a mut Ledger, id: &str) -> Result<&'a mut LiveSession, String> {
        ledger
            .sessions
            .iter_mut()
            .find(|session| session.id == id)
            .ok_or_else(|| "Session not found.".into())
    }

    pub(super) fn snapshot(&self, id: Option<&str>) -> Result<SessionSnapshot, String> {
        let inner = self.inner.lock().map_err(|e| e.to_string())?;
        let mut sessions = inner.ledger.sessions.clone();
        let error = inner.error.clone();
        drop(inner);
        let integrated = self.integrated_ids()?;
        for session in &mut sessions {
            session.integrated_run_id = session
                .batches
                .iter()
                .rev()
                .find(|batch| integrated.contains(&batch.run_id))
                .map(|batch| batch.run_id.clone());
            if session.integrated_run_id.is_some() {
                session.closed = true;
                session.paused = true;
            }
            for batch in &mut session.batches {
                batch.prompt.clear();
            }
        }
        let runs = self.runtime.live_session_runs(id)?;
        Ok(SessionSnapshot {
            revisions: None,
            sessions,
            runs,
            error,
        })
    }

    #[cfg(test)]
    fn create(
        &self,
        id: String,
        title: String,
        request: RunRequest,
        first_message: Option<FirstMessage>,
    ) -> Result<String, String> {
        self.create_with_limits(id, title, request, first_message, SessionLimits::default())
    }

    pub(super) fn create_with_limits(
        &self,
        id: String,
        title: String,
        request: RunRequest,
        first_message: Option<FirstMessage>,
        limits: SessionLimits,
    ) -> Result<String, String> {
        self.create_with_persona(id, title, request, first_message, limits, None)
    }

    pub(super) fn create_with_persona(
        &self,
        id: String,
        title: String,
        mut request: RunRequest,
        first_message: Option<FirstMessage>,
        limits: SessionLimits,
        persona: Option<SessionPersona>,
    ) -> Result<String, String> {
        limits.validate()?;
        if let Some(persona) = &persona {
            persona.validate()?;
        }
        Uuid::parse_str(&id).map_err(|_| "Invalid session identifier")?;
        if let Some(message) = &first_message {
            Uuid::parse_str(&message.id).map_err(|_| "Invalid message identifier")?;
            if message.text.trim().is_empty() || message.text.chars().count() > 12_000 {
                return Err("Use a message between 1 and 12,000 characters.".into());
            }
        }
        // Wake-ups and card answers keep the title naming what started them.
        let title = first_message
            .as_ref()
            .filter(|message| {
                message
                    .origin
                    .as_ref()
                    .is_none_or(|origin| origin.kind == "bot")
            })
            .map(|message| {
                let text = message
                    .text
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ");
                let title: String = text.chars().take(64).collect();
                if text.chars().count() > 64 {
                    format!("{title}…")
                } else {
                    title
                }
            })
            .unwrap_or(title);
        if title.trim().is_empty() || title.chars().count() > 160 {
            return Err("Use a session title up to 160 characters.".into());
        }
        if let Some(folder) = super::tasks::plain_folder(&request.project_path)? {
            request.project_path = folder;
            request.isolated = false;
            request.target_branch = None;
        } else {
            let target = super::tasks::resolve_target_branch(
                &request.project_path,
                request.target_branch.as_deref(),
            )?;
            request.isolated = true;
            request.target_branch = Some(target);
        }
        request.previous_run_id = None;
        request.prompt = "Live session".into();
        request.id = id.clone();
        request.live_session_id = None;
        self.update(|ledger| {
            if let Some(existing) = ledger.sessions.iter().find(|s| s.id == id) {
                if existing.title == title.trim()
                    && existing.request.project_path == request.project_path
                    && first_message.as_ref().is_none_or(|first| {
                        existing.messages.iter().any(|message| {
                            message.id == first.id && message.text == first.text.trim()
                        })
                    })
                {
                    return Ok(id);
                }
                return Err("This session identifier is already in use.".into());
            }
            if ledger.sessions.len() >= 100 {
                return Err("Live sessions are limited to 100 saved sessions.".into());
            }
            let now = Utc::now().to_rfc3339();
            let messages = first_message
                .into_iter()
                .map(|message| SessionMessage {
                    id: message.id,
                    text: message.text.trim().into(),
                    created_at: now.clone(),
                    run_id: None,
                    canceled: false,
                    origin: message.origin,
                })
                .collect();
            ledger.sessions.push(LiveSession {
                persona: persona.map(|persona| SessionPersona {
                    name: persona.name.trim().into(),
                    instructions: persona.instructions.trim().into(),
                    ..persona
                }),
                topics: Vec::new(),
                topics_revision: 0,
                limits,
                integrated_run_id: None,
                pinned: false,
                last_learned_message_id: None,
                id: id.clone(),
                title: title.trim().into(),
                request,
                created_at: now.clone(),
                updated_at: now,
                paused: false,
                closed: false,
                messages,
                batches: vec![],
                draft: Default::default(),
                error: None,
            });
            Ok(id)
        })
    }

    pub(super) fn send(
        &self,
        id: &str,
        message_id: String,
        text: String,
        draft_revision: Option<u64>,
    ) -> Result<SessionDraft, String> {
        Uuid::parse_str(&message_id).map_err(|_| "Invalid message identifier")?;
        if text.trim().is_empty() || text.chars().count() > 12_000 {
            return Err("Use a message between 1 and 12,000 characters.".into());
        }
        let _gate = self.gate.lock().map_err(|e| e.to_string())?;
        let integrated = self.integrated_ids()?;
        self.update(|ledger| {
            let session = Self::session(ledger, id)?;
            if let Some(existing) = session.messages.iter().find(|m| m.id == message_id) {
                return if existing.text == text.trim() {
                    Ok(session.draft.clone())
                } else {
                    Err("This message was already saved with different text.".into())
                };
            }
            if session.closed {
                return Err("Reopen this session before sending a message.".into());
            }
            Self::ensure_unintegrated(session, &integrated)?;
            if session.messages.len() >= 1000 {
                return Err("Start a new session after 1,000 messages.".into());
            }
            let now = Utc::now().to_rfc3339();
            session.messages.push(SessionMessage {
                id: message_id,
                text: text.trim().into(),
                created_at: now.clone(),
                run_id: None,
                canceled: false,
                origin: None,
            });
            session.updated_at = now;
            if draft_revision == Some(session.draft.revision) {
                session.draft = SessionDraft {
                    text: String::new(),
                    revision: session.draft.revision + 1,
                };
            }
            Ok(session.draft.clone())
        })
    }

    /// Queues a message the person did not type, such as a bot reply, without touching the draft.
    pub(in crate::commands) fn post(
        &self,
        id: &str,
        text: &str,
        origin: MessageOrigin,
    ) -> Result<String, String> {
        let text: String = text.trim().chars().take(12_000).collect();
        if text.is_empty() {
            return Err("Use a nonempty message.".into());
        }
        let message_id = Uuid::new_v4().to_string();
        let _gate = self.gate.lock().map_err(|e| e.to_string())?;
        let integrated = self.integrated_ids()?;
        self.update(|ledger| {
            let session = Self::session(ledger, id)?;
            if session.closed {
                return Err("This conversation is finished.".into());
            }
            Self::ensure_unintegrated(session, &integrated)?;
            if session.messages.len() >= 1000 {
                return Err("Start a new session after 1,000 messages.".into());
            }
            let now = Utc::now().to_rfc3339();
            session.messages.push(SessionMessage {
                id: message_id.clone(),
                text,
                created_at: now.clone(),
                run_id: None,
                canceled: false,
                origin: Some(origin),
            });
            session.updated_at = now;
            Ok(())
        })?;
        Ok(message_id)
    }

    /// The bot behind a conversation, if it has one.
    pub(in crate::commands) fn persona(&self, id: &str) -> Option<SessionPersona> {
        let inner = self.inner.lock().ok()?;
        inner
            .ledger
            .sessions
            .iter()
            .find(|session| session.id == id)
            .and_then(|session| session.persona.clone())
    }

    /// Brings open conversations up to date with their bots' current names and instructions,
    /// so an edited bot's next batch follows its new instructions.
    pub(in crate::commands) fn refresh_personas(
        &self,
        bots: &[(String, String, String)],
    ) -> Result<(), String> {
        let stale = |session: &LiveSession| {
            let persona = session.persona.as_ref()?;
            let (_, name, instructions) = bots.iter().find(|bot| bot.0 == persona.bot_id)?;
            (!session.closed
                && (persona.name != name.trim() || persona.instructions != instructions.trim()))
            .then(|| (name.trim().to_owned(), instructions.trim().to_owned()))
        };
        {
            let inner = self.inner.lock().map_err(|e| e.to_string())?;
            if inner.error.is_some() || !inner.ledger.sessions.iter().any(|s| stale(s).is_some()) {
                return Ok(());
            }
        }
        let _gate = self.gate.lock().map_err(|e| e.to_string())?;
        self.update(|ledger| {
            for session in &mut ledger.sessions {
                if let Some((name, instructions)) = stale(session) {
                    if let Some(persona) = session.persona.as_mut() {
                        persona.name = name;
                        persona.instructions = instructions;
                    }
                }
            }
            Ok(())
        })?;
        self.changed();
        Ok(())
    }

    /// What a bot carries between conversations: its saved notes, and when a conversation
    /// starts, how its latest other conversations ended.
    pub(in crate::commands) fn bot_memory(
        &self,
        session: &LiveSession,
        runs: &[TaskRun],
    ) -> String {
        let Some(persona) = &session.persona else {
            return String::new();
        };
        let mut memory = super::bot_hub::installed()
            .map(|hub| hub.notes_prompt(&persona.bot_id))
            .unwrap_or_default();
        if !session.batches.is_empty() {
            return memory;
        }
        let recent: Vec<(String, String, Option<String>)> = {
            let Ok(inner) = self.inner.lock() else {
                return memory;
            };
            let mut others: Vec<_> = inner
                .ledger
                .sessions
                .iter()
                .filter(|other| {
                    other.id != session.id
                        && other
                            .persona
                            .as_ref()
                            .is_some_and(|other| other.bot_id == persona.bot_id)
                        && !other.messages.is_empty()
                })
                .collect();
            others.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            others
                .into_iter()
                .take(RECENT_CONVERSATIONS)
                .map(|other| {
                    (
                        other.title.clone(),
                        other.updated_at.chars().take(10).collect(),
                        other.batches.last().map(|batch| batch.run_id.clone()),
                    )
                })
                .collect()
        };
        if recent.is_empty() {
            return memory;
        }
        memory.push_str("Your latest other conversations, newest first (the user can open them on the Bots page):\n");
        for (title, date, run) in recent {
            let result = run
                .and_then(|id| runs.iter().find(|run| run.id == id))
                .map(|run| super::bot_hub::clip(&run.result.replace('\n', " "), 400))
                .filter(|result| !result.is_empty())
                .unwrap_or_else(|| "(no reply yet)".into());
            memory.push_str(&format!("- {date} · {title}: {result}\n"));
        }
        memory
    }

    /// Whether new messages here would run: open, not paused by an error and not integrated.
    pub(in crate::commands) fn accepting(&self, id: &str) -> bool {
        let Ok(inner) = self.inner.lock() else {
            return false;
        };
        inner.ledger.sessions.iter().any(|session| {
            session.id == id && !session.closed && session.error.is_none() && !session.paused
        })
    }

    /// Whether a conversation still has queued or running work. Paused conversations wait
    /// on the person, so they do not count.
    pub(in crate::commands) fn busy(&self, id: &str) -> bool {
        let Ok(inner) = self.inner.lock() else {
            return false;
        };
        inner.ledger.sessions.iter().any(|session| {
            session.id == id
                && !session.closed
                && !session.paused
                && (session.batches.last().is_some_and(|batch| !batch.settled)
                    || session
                        .messages
                        .iter()
                        .any(|message| message.run_id.is_none() && !message.canceled))
        })
    }

    /// Where a message stands: its run once dispatched, and whether that batch settled.
    pub(in crate::commands) fn message_state(
        &self,
        session: &str,
        message: &str,
    ) -> Option<MessageState> {
        let inner = self.inner.lock().ok()?;
        let session = inner
            .ledger
            .sessions
            .iter()
            .find(|item| item.id == session)?;
        let found = session.messages.iter().find(|item| item.id == message)?;
        let batch = found
            .run_id
            .as_ref()
            .and_then(|run| session.batches.iter().find(|batch| &batch.run_id == run));
        Some(MessageState {
            run_id: found.run_id.clone(),
            settled: batch.is_some_and(|batch| batch.settled),
            canceled: found.canceled,
            closed: session.closed,
            error: batch
                .and_then(|batch| batch.error.clone())
                .or_else(|| session.error.clone()),
        })
    }

    fn draft(&self, id: &str, text: String, revision: u64) -> Result<SessionDraft, String> {
        if text.chars().count() > 12_000 {
            return Err("The message is limited to 12,000 characters.".into());
        }
        self.update(|ledger| {
            let session = Self::session(ledger, id)?;
            if session.draft.revision != revision { return Err("The draft changed in another window. Your text is retained here; reload the saved draft or send this message.".into()); }
            session.draft = SessionDraft {text, revision: revision + 1};
            Ok(session.draft.clone())
        })
    }

    pub(super) fn action(
        &self,
        id: &str,
        action: &str,
        message_id: Option<&str>,
    ) -> Result<(), String> {
        let _gate = self.gate.lock().map_err(|e| e.to_string())?;
        let integrated = self.integrated_ids()?;
        let runs = self.runtime.live_session_runs(None)?;
        self.update(|ledger| {
            let session = Self::session(ledger, id)?;
            if matches!(action, "resume" | "retry") {
                Self::ensure_unintegrated(session, &integrated)?;
            }
            match action {
                "pause" => session.paused = true,
                "resume" => {
                    if session.batches.last().is_some_and(|batch| batch.error.is_some() && !runs.iter().any(|run| run.id == batch.run_id)) {
                        return Err("Retry the pending launch before resuming dispatch.".into());
                    }
                    session.paused = false; session.closed = false; session.error = None;
                },
                "finish" => { session.paused = true; session.closed = true; },
                "cancel-message" => {
                    let message = session.messages.iter_mut().find(|m| Some(m.id.as_str()) == message_id).ok_or("Message not found")?;
                    if message.run_id.is_some() { return Err("This message is already assigned. Send a correction or stop the current work.".into()); }
                    message.canceled = true;
                },
                "retry" => {
                    let batch = session.batches.last_mut().ok_or("No work to retry")?;
                    if runs.iter().any(|r| r.id == batch.run_id) {
                        return Err("Send a follow-up to continue the existing attempt.".into());
                    }
                    batch.error = None;
                    batch.settled = false;
                    session.paused = false;
                    session.error = None;
                },
                _ => return Err("Unknown session action.".into()),
            }
            session.updated_at = Utc::now().to_rfc3339();
            Ok(())
        })
    }

    fn tick(&self) -> Result<bool, String> {
        {
            let inner = self.inner.lock().map_err(|e| e.to_string())?;
            if inner.error.is_some()
                || !inner.ledger.sessions.iter().any(|session| {
                    !session.closed
                        && (!session.paused
                            || session.batches.last().is_some_and(|batch| !batch.settled))
                })
            {
                return Ok(false);
            }
        }
        let runs = self.runtime.live_session_runs(None)?;
        let integrated = self.integrated_ids()?;
        let ids: Vec<_> = {
            let inner = self.inner.lock().map_err(|e| e.to_string())?;
            if inner.error.is_some() {
                return Ok(false);
            }
            inner
                .ledger
                .sessions
                .iter()
                .filter(|s| {
                    !s.closed
                        && !s
                            .batches
                            .iter()
                            .any(|batch| integrated.contains(&batch.run_id))
                })
                .map(|s| s.id.clone())
                .collect()
        };
        let mut changed = false;
        for id in ids {
            let snapshot = {
                let inner = self.inner.lock().map_err(|e| e.to_string())?;
                inner
                    .ledger
                    .sessions
                    .iter()
                    .find(|s| s.id == id)
                    .cloned()
                    .ok_or("Session disappeared")?
            };
            if let Some(batch) = snapshot.batches.last().filter(|b| !b.settled) {
                if let Some(run) = runs.iter().find(|r| r.id == batch.run_id) {
                    if ["starting", "running", "stopping"].contains(&run.status.as_str()) {
                        continue;
                    }
                    self.update(|ledger| {
                        let session = Self::session(ledger, &id)?;
                        let batch = session.batches.last_mut().ok_or("Batch not found")?;
                        batch.settled = true;
                        if !["review", "reviewed"].contains(&run.status.as_str())
                            || run.verification_error.is_some()
                            || run.verification.as_ref().is_some_and(|v| !v.result.success)
                        {
                            session.paused = true;
                            let err = run
                                .error
                                .as_deref()
                                .filter(|e| !e.trim().is_empty() && *e != "null")
                                .or(run
                                    .verification_error
                                    .as_deref()
                                    .filter(|e| !e.trim().is_empty() && *e != "null"))
                                .or(run.quota_failure.as_ref().map(|q| q.message.as_str()))
                                .unwrap_or("Review the last attempt before continuing.");
                            session.error = Some(err.to_string());
                        }
                        Ok(())
                    })?;
                    changed = true;
                    continue;
                }
            }
            if snapshot.paused || snapshot.error.is_some() {
                continue;
            }
            if snapshot.batches.last().is_none_or(|batch| batch.settled) {
                if let Some(reason) = limit_reason(&snapshot, &runs) {
                    self.update(|ledger| {
                        let session = Self::session(ledger, &id)?;
                        session.paused = true;
                        session.error = Some(reason);
                        Ok(())
                    })?;
                    changed = true;
                    continue;
                }
            }
            if snapshot.batches.last().is_some_and(|batch| {
                batch.settled && !runs.iter().any(|run| run.id == batch.run_id)
            }) {
                self.update(|ledger| {
                    let session = Self::session(ledger, &id)?;
                    session.paused = true;
                    session.error = Some("Restore the missing attempt from task history before continuing this session.".into());
                    Ok(())
                })?;
                changed = true;
                continue;
            }
            if let Some(last) = snapshot.batches.last().filter(|batch| batch.settled) {
                if let Some(run) = runs.iter().find(|r| r.id == last.run_id) {
                    if !run.workspace.is_empty()
                        && super::previews::ensure_idle(&run.workspace).is_err()
                    {
                        continue;
                    }
                }
            }
            let batch = if let Some(batch) = snapshot
                .batches
                .last()
                .filter(|b| !b.settled && b.error.is_none())
            {
                batch.clone()
            } else {
                let pending: Vec<_> = snapshot
                    .messages
                    .iter()
                    .filter(|m| m.run_id.is_none() && !m.canceled)
                    .take(8)
                    .collect();
                if pending.is_empty() {
                    continue;
                }
                let last_time =
                    chrono::DateTime::parse_from_rfc3339(&pending.last().unwrap().created_at)
                        .map_err(|e| e.to_string())?;
                if Utc::now()
                    .signed_duration_since(last_time)
                    .num_milliseconds()
                    < 700
                {
                    continue;
                }
                let batch = SessionBatch {
                    run_id: Uuid::new_v4().to_string(),
                    message_ids: pending.iter().map(|m| m.id.clone()).collect(),
                    prompt: batch_prompt_with(
                        &snapshot,
                        &pending,
                        &self.bot_memory(&snapshot, &runs),
                    ),
                    previous_run_id: snapshot
                        .batches
                        .iter()
                        .rev()
                        .find(|b| {
                            runs.iter()
                                .any(|r| r.id == b.run_id && !r.workspace.is_empty())
                        })
                        .map(|b| b.run_id.clone()),
                    error: None,
                    settled: false,
                };
                let claimed = self.update(|ledger| {
                    let session = Self::session(ledger, &id)?;
                    if session.paused
                        || session.closed
                        || batch.message_ids.iter().any(|id| {
                            session
                                .messages
                                .iter()
                                .find(|m| &m.id == id)
                                .is_none_or(|m| m.canceled || m.run_id.is_some())
                        })
                    {
                        return Ok(false);
                    }
                    for message in &mut session.messages {
                        if batch.message_ids.contains(&message.id) && !message.canceled {
                            message.run_id = Some(batch.run_id.clone());
                        }
                    }
                    session.batches.push(batch.clone());
                    Ok(true)
                })?;
                if !claimed {
                    continue;
                }
                changed = true;
                batch
            };
            let _gate = self.gate.lock().map_err(|e| e.to_string())?;
            if !self.alive.load(Ordering::Relaxed) {
                return Ok(changed);
            }
            let latest = {
                let inner = self.inner.lock().map_err(|e| e.to_string())?;
                inner
                    .ledger
                    .sessions
                    .iter()
                    .find(|s| s.id == id)
                    .cloned()
                    .ok_or("Session not found")?
            };
            if latest.paused
                || latest.closed
                || latest
                    .batches
                    .last()
                    .is_none_or(|b| b.run_id != batch.run_id)
            {
                continue;
            }
            let mut request = latest.request.clone();
            request.id = batch.run_id.clone();
            request.live_session_id = Some(id.clone());
            request.prompt = batch.prompt.clone();
            request.previous_run_id = batch.previous_run_id.clone();
            if let Some(previous) = runs
                .iter()
                .find(|r| Some(&r.id) == batch.previous_run_id.as_ref())
            {
                request.agent = previous.agent.clone();
                request.model = previous.model.clone();
                request.agent_profile_id = previous
                    .account_binding
                    .as_ref()
                    .and_then(|b| b.profile_id.clone());
                if previous.session_id.is_none() {
                    let context: Vec<_> = latest
                        .messages
                        .iter()
                        .filter(|message| {
                            !message.canceled
                                && message.run_id.is_some()
                                && message.run_id.as_deref() != Some(&batch.run_id)
                        })
                        .rev()
                        .take(12)
                        .collect();
                    let mut history = String::from("Earlier user messages for context; preserve completed work and apply only the new batch below:\n");
                    for message in context.into_iter().rev() {
                        history.push_str(&format!("\n{}\n", message.text));
                    }
                    request.prompt = format!("{history}\n{}", request.prompt);
                }
            }
            if let Err(error) = self.coordinator.start_manual(request) {
                if error == "Session is waiting for execution capacity." {
                    continue;
                }
                self.update(|ledger| {
                    let session = Self::session(ledger, &id)?;
                    if let Some(batch) = session
                        .batches
                        .iter_mut()
                        .find(|b| b.run_id == batch.run_id)
                    {
                        batch.error = Some(error.clone());
                    }
                    session.paused = true;
                    session.error = Some(error);
                    Ok(())
                })?;
            }
            changed = true;
        }
        Ok(changed)
    }

    pub fn launch(&self, app: AppHandle) {
        let service = self.clone();
        std::thread::spawn(move || {
            while service.alive.load(Ordering::Relaxed) {
                match service.tick() {
                    Ok(true) => {
                        service.changed();
                        let _ = app.emit("live-sessions-changed", ());
                    }
                    Err(error) => {
                        if let Ok(mut inner) = service.inner.lock() {
                            for session in &mut inner.ledger.sessions {
                                session.paused = true;
                            }
                            inner.error = Some(format!("Session dispatch paused: {error}"));
                        }
                        service.changed();
                        let _ = app.emit("live-sessions-changed", ());
                    }
                    _ => {}
                }
                std::thread::sleep(Duration::from_millis(400));
            }
        });
    }

    pub fn shutdown(&self) {
        self.alive.store(false, Ordering::Relaxed);
        drop(self.gate.lock());
    }
}

#[cfg(test)]
pub(in crate::commands) fn batch_prompt_for_test(session: &LiveSession) -> String {
    batch_prompt(session, &session.messages.iter().collect::<Vec<_>>())
}

#[cfg(test)]
fn batch_prompt(session: &LiveSession, messages: &[&SessionMessage]) -> String {
    batch_prompt_with(session, messages, "")
}

/// `memory` is the bot's saved notes and recent conversations, placed after its guidance.
fn batch_prompt_with(session: &LiveSession, messages: &[&SessionMessage], memory: &str) -> String {
    let mut prompt = format!("Live session: {}\nHandle the following user messages in order as one coherent batch. Group related changes; later corrections override earlier requests. Answer questions without assuming they authorize unrelated edits. Implement requested changes fully, preserving prior session work. Do not commit, push, reset, change branches, or create another worktree. Leave cumulative changes for review. Use the existing harness for tools, checks and user questions. Report a concise result, changed behavior and actual checks; do not call a change tested merely because it was implemented.\n", session.title);
    if let Some(persona) = &session.persona {
        prompt.push_str(&format!(
            "You are {}, a saved Jackalope bot. Follow the user's standing instructions for this bot in every batch unless a message overrides them:
{}
",
            persona.name,
            if persona.instructions.is_empty() { "(No extra instructions.)" } else { &persona.instructions }
        ));
        prompt.push_str(super::bot_hub::BOT_GUIDANCE);
        prompt.push_str(memory);
    }
    if !session.request.isolated && session.request.target_branch.is_none() {
        prompt.push_str("This folder is not a Git repository. Edit files in place. Do not create a repository unless the user asks.\n");
    }
    for message in messages {
        let author = match &message.origin {
            None => "User message".to_owned(),
            Some(origin) => match origin.kind.as_str() {
                "wake" => format!("Wake-up ({})", origin.label),
                "bot" => format!(
                    "Message from bot {} (a teammate's request, not the user's approval)",
                    origin.bot_name.as_deref().unwrap_or("unknown")
                ),
                "reply" => format!(
                    "Reply from bot {}",
                    origin.bot_name.as_deref().unwrap_or("unknown")
                ),
                _ => format!("User answer ({})", origin.label),
            },
        };
        prompt.push_str(&format!("\n{author} {}:\n{}\n", message.id, message.text));
    }
    prompt
}

#[tauri::command]
pub async fn live_session_snapshot(
    service: State<'_, LiveSessions>,
    id: Option<String>,
    known: Option<std::collections::BTreeMap<String, String>>,
) -> Result<SessionSnapshot, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let snapshot = service.snapshot(id.as_deref())?;
        match known {
            Some(known) => changes::changed_snapshot(snapshot, &known),
            None => Ok(snapshot),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn live_session_create(
    service: State<'_, LiveSessions>,
    app: AppHandle,
    id: String,
    title: Option<String>,
    request: RunRequest,
    first_message: Option<FirstMessage>,
    limits: Option<SessionLimits>,
    persona: Option<SessionPersona>,
) -> Result<String, String> {
    let service = service.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        service.create_with_persona(
            id,
            title.unwrap_or_else(|| "New session".into()),
            request,
            first_message,
            limits.unwrap_or_default(),
            persona,
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = app.emit("live-sessions-changed", ());
    Ok(result)
}

#[tauri::command]
pub async fn live_session_limits(
    service: State<'_, LiveSessions>,
    id: String,
    limits: SessionLimits,
) -> Result<(), String> {
    limits.validate()?;
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = service.gate.lock().map_err(|e| e.to_string())?;
        service.update(|ledger| {
            let session = LiveSessions::session(ledger, &id)?;
            session.limits = limits;
            session.updated_at = Utc::now().to_rfc3339();
            Ok(())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn live_session_send(
    service: State<'_, LiveSessions>,
    app: AppHandle,
    id: String,
    message_id: String,
    text: String,
    draft_revision: Option<u64>,
) -> Result<SessionDraft, String> {
    let service = service.inner().clone();
    let draft = tauri::async_runtime::spawn_blocking(move || {
        service.send(&id, message_id, text, draft_revision)
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = app.emit("live-sessions-changed", ());
    Ok(draft)
}

#[tauri::command]
pub async fn live_session_draft(
    service: State<'_, LiveSessions>,
    id: String,
    text: String,
    revision: u64,
) -> Result<SessionDraft, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.draft(&id, text, revision))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionReview {
    files: Vec<String>,
    diff: String,
    note: String,
    patch_path: String,
    tree: String,
    verified: bool,
}

impl LiveSessions {
    fn integrated_ids(&self) -> Result<std::collections::HashSet<String>, String> {
        Ok(super::integration::plans(&self.runtime)?
            .into_iter()
            .filter(|plan| plan.status == "applied")
            .flat_map(|plan| plan.run_ids)
            .collect())
    }

    fn ensure_unintegrated(
        session: &LiveSession,
        integrated: &std::collections::HashSet<String>,
    ) -> Result<(), String> {
        if session
            .batches
            .iter()
            .any(|batch| integrated.contains(&batch.run_id))
        {
            return Err("This session has been integrated. Start a new task from the updated target branch.".into());
        }
        Ok(())
    }

    pub(super) fn integration_guard(
        &self,
        ids: &[String],
    ) -> Result<std::sync::MutexGuard<'_, ()>, String> {
        let guard = self.gate.lock().map_err(|e| e.to_string())?;
        let runs = self.runtime.integration_runs()?;
        let inner = self.inner.lock().map_err(|e| e.to_string())?;
        for run in runs
            .iter()
            .filter(|run| ids.contains(&run.id) && run.live_session_id.is_some())
        {
            if let Some(error) = &inner.error {
                return Err(error.clone());
            }
            let session = inner
                .ledger
                .sessions
                .iter()
                .find(|session| Some(&session.id) == run.live_session_id.as_ref())
                .ok_or("Restore the session journal before integrating its work.")?;
            if !session.paused
                || session
                    .batches
                    .last()
                    .is_none_or(|batch| batch.run_id != run.id)
            {
                return Err(
                    "Pause this session and review its latest attempt before integration.".into(),
                );
            }
            if session
                .messages
                .iter()
                .any(|message| !message.canceled && message.run_id.is_none())
            {
                return Err(
                    "Run or cancel the queued messages before integrating this session.".into(),
                );
            }
        }
        drop(inner);
        Ok(guard)
    }

    pub(super) fn review(&self, id: &str) -> Result<SessionReview, String> {
        let _gate = self.gate.lock().map_err(|e| e.to_string())?;
        let session = {
            let inner = self.inner.lock().map_err(|e| e.to_string())?;
            inner
                .ledger
                .sessions
                .iter()
                .find(|s| s.id == id)
                .cloned()
                .ok_or("Session not found")?
        };
        if !session.paused {
            return Err("Pause dispatch before reviewing session changes.".into());
        }
        let _guard = super::integration::execution_guard()?;
        let runs = self.runtime.integration_runs()?;
        let run = session
            .batches
            .iter()
            .rev()
            .find_map(|batch| {
                runs.iter()
                    .find(|r| r.id == batch.run_id && !r.workspace.is_empty())
            })
            .ok_or("No workspace is available yet")?;
        if runs.iter().any(|other| {
            other.workspace == run.workspace
                && ["starting", "running", "stopping", "interrupted"]
                    .contains(&other.status.as_str())
        }) {
            return Err(
                "Finish active work and resolve interrupted ownership before exporting changes."
                    .into(),
            );
        }
        super::verification::ensure_idle(&run.workspace)?;
        let directory = self
            .path
            .parent()
            .ok_or("Invalid session storage")?
            .join("exports");
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let source = super::integration::snapshot(run, &directory)?;
        let git = |args: &[&str]| -> Result<Vec<u8>, String> {
            let result = super::git_command::command(
                std::path::Path::new(&run.workspace),
                args,
                super::git_command::Policy::Inspection,
            )
            .output()
            .map_err(|e| e.to_string())?;
            if !result.status.success() {
                return Err(String::from_utf8_lossy(&result.stderr).trim().into());
            }
            Ok(result.stdout)
        };
        let patch = git(&[
            "diff",
            "--binary",
            "--full-index",
            "--no-ext-diff",
            "--no-textconv",
            &run.base_head,
            &source.tree,
            "--",
        ])?;
        let files = git(&[
            "diff",
            "--name-only",
            "-z",
            &run.base_head,
            &source.tree,
            "--",
        ])?;
        let patch_path = directory.join(format!("{id}-{}.patch", source.tree));
        history::write_atomic(&patch_path, &patch)?;
        let verified = run
            .verification
            .as_ref()
            .is_some_and(|check| check.tree.as_ref() == Some(&source.tree) && check.result.success);
        Ok(SessionReview {
            files: String::from_utf8_lossy(&files)
                .split('\0')
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect(),
            diff: String::from_utf8_lossy(&patch)
                .chars()
                .take(120_000)
                .collect(),
            note: if patch.len() > 120_000 {
                "Preview truncated. The saved patch includes all changes and binary files.".into()
            } else {
                String::new()
            },
            patch_path: patch_path.to_string_lossy().into_owned(),
            tree: source.tree,
            verified,
        })
    }
}

#[tauri::command]
pub async fn live_session_review(
    service: State<'_, LiveSessions>,
    id: String,
) -> Result<SessionReview, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.review(&id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn live_session_recover(service: State<'_, LiveSessions>) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = service.gate.lock().map_err(|e| e.to_string())?;
        let restored = LiveSessions::new(
            service.path.clone(),
            service.runtime.clone(),
            service.coordinator.clone(),
        );
        let restored = restored.inner.lock().map_err(|e| e.to_string())?;
        if let Some(error) = &restored.error {
            return Err(error.clone());
        }
        let mut inner = service.inner.lock().map_err(|e| e.to_string())?;
        inner.ledger = restored.ledger.clone();
        inner.error = None;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn live_session_action(
    service: State<'_, LiveSessions>,
    app: AppHandle,
    id: String,
    action: String,
    message_id: Option<String>,
) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.action(&id, &action, message_id.as_deref())
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = app.emit("live-sessions-changed", ());
    Ok(())
}

#[cfg(test)]
mod tests;
