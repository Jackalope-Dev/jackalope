mod windows;
pub use windows::{live_session_window, live_session_window_pin};

use super::{coordination::Coordinator, history, tasks::{RunRequest, TaskRun, TaskRuntime}};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex}, time::Duration};
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
    #[serde(default)]
    pub pinned: bool,
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

#[derive(Clone, Default, Serialize, Deserialize)]
struct Ledger {
    sessions: Vec<LiveSession>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
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
}

impl LiveSessions {
    pub fn new(path: PathBuf, runtime: TaskRuntime, coordinator: Coordinator) -> Self {
        let loaded = if path.exists() {
            history::read_bounded(&path, 16_000_000)
                .and_then(|bytes| serde_json::from_slice::<Ledger>(&bytes).map_err(|e| e.to_string()))
        } else { Ok(Ledger::default()) };
        let (mut ledger, error) = match loaded {
            Ok(ledger) => (ledger, None),
            Err(error) => (Ledger::default(), Some(format!("Live sessions could not be loaded. The saved file is unchanged: {error}"))),
        };
        for session in &mut ledger.sessions {
            session.paused = true;
            if session.batches.last().is_some_and(|batch| !batch.settled) {
                session.error = Some("The session was interrupted. Review the last attempt before resuming.".into());
            }
        }
        Self { inner: Arc::new(Mutex::new(Inner {ledger, error})), path, runtime, coordinator, alive: Arc::new(AtomicBool::new(true)) }
    }

    fn save(&self, ledger: &Ledger) -> Result<(), String> {
        let bytes = serde_json::to_vec(ledger).map_err(|e| e.to_string())?;
        if bytes.len() > 16_000_000 { return Err("Live session storage is full. Finish or export existing sessions.".into()); }
        std::fs::create_dir_all(self.path.parent().ok_or("Invalid session path")?).map_err(|e| e.to_string())?;
        history::write_atomic(&self.path, &bytes)
    }

    fn update<T>(&self, change: impl FnOnce(&mut Ledger) -> Result<T, String>) -> Result<T, String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(error) = &inner.error { return Err(error.clone()); }
        let mut ledger = inner.ledger.clone();
        let result = change(&mut ledger)?;
        self.save(&ledger)?;
        inner.ledger = ledger;
        Ok(result)
    }

    fn session<'a>(ledger: &'a mut Ledger, id: &str) -> Result<&'a mut LiveSession, String> {
        ledger.sessions.iter_mut().find(|session| session.id == id).ok_or_else(|| "Session not found.".into())
    }

    fn snapshot(&self, id: Option<&str>) -> Result<SessionSnapshot, String> {
        let inner = self.inner.lock().map_err(|e| e.to_string())?;
        let sessions = inner.ledger.sessions.clone();
        let error = inner.error.clone();
        drop(inner);
        let ids: Vec<_> = sessions.iter().flat_map(|s| s.batches.iter().map(|b| b.run_id.as_str())).collect();
        let runs = self.runtime.integration_runs()?.into_iter().filter(|r| ids.contains(&r.id.as_str())).map(|run| {
            if id == run.live_session_id.as_deref() { run } else { run.summary() }
        }).collect();
        Ok(SessionSnapshot { sessions, runs, error })
    }

    fn create(&self, id: String, title: String, mut request: RunRequest) -> Result<String, String> {
        Uuid::parse_str(&id).map_err(|_| "Invalid session identifier")?;
        if title.trim().is_empty() || title.len() > 160 { return Err("Use a session title up to 160 bytes.".into()); }
        let target = super::tasks::resolve_target_branch(&request.project_path, request.target_branch.as_deref())?;
        request.isolated = true;
        request.previous_run_id = None;
        request.target_branch = Some(target);
        request.prompt = "Live session".into();
        request.id = id.clone();
        request.live_session_id = None;
        self.update(|ledger| {
            if let Some(existing) = ledger.sessions.iter().find(|s| s.id == id) {
                if existing.title == title.trim() && existing.request.project_path == request.project_path { return Ok(id); }
                return Err("This session identifier is already in use.".into());
            }
            if ledger.sessions.len() >= 100 { return Err("Live sessions are limited to 100 saved sessions.".into()); }
            let now = Utc::now().to_rfc3339();
            ledger.sessions.push(LiveSession {pinned: false, id: id.clone(), title: title.trim().into(), request, created_at: now.clone(), updated_at: now, paused: false, closed: false, messages: vec![], batches: vec![], draft: Default::default(), error: None});
            Ok(id)
        })
    }

    fn send(&self, id: &str, message_id: String, text: String, draft_revision: Option<u64>) -> Result<(), String> {
        Uuid::parse_str(&message_id).map_err(|_| "Invalid message identifier")?;
        if text.trim().is_empty() || text.len() > 12_000 { return Err("Use a message between 1 and 12,000 bytes.".into()); }
        self.update(|ledger| {
            let session = Self::session(ledger, id)?;
            if let Some(existing) = session.messages.iter().find(|m| m.id == message_id) {
                return if existing.text == text.trim() { Ok(()) } else { Err("This message was already saved with different text.".into()) };
            }
            if session.closed { return Err("Reopen this session before sending a message.".into()); }
            if session.messages.len() >= 1000 { return Err("Start a new session after 1,000 messages.".into()); }
            let now = Utc::now().to_rfc3339();
            session.messages.push(SessionMessage { id: message_id, text: text.trim().into(), created_at: now.clone(), run_id: None, canceled: false });
            session.updated_at = now;
            if draft_revision == Some(session.draft.revision) {
                session.draft = SessionDraft {text: String::new(), revision: session.draft.revision + 1};
            }
            Ok(())
        })
    }

    fn draft(&self, id: &str, text: String, revision: u64) -> Result<SessionDraft, String> {
        if text.len() > 12_000 { return Err("The message is limited to 12,000 bytes.".into()); }
        self.update(|ledger| {
            let session = Self::session(ledger, id)?;
            if session.draft.revision != revision { return Err("The draft changed in another window. Your text is retained here; reload the saved draft or send this message.".into()); }
            session.draft = SessionDraft {text, revision: revision + 1};
            Ok(session.draft.clone())
        })
    }

    fn action(&self, id: &str, action: &str, message_id: Option<&str>) -> Result<(), String> {
        self.update(|ledger| {
            let session = Self::session(ledger, id)?;
            match action {
                "pause" => session.paused = true,
                "resume" => { session.paused = false; session.closed = false; session.error = None; },
                "finish" => { session.paused = true; session.closed = true; },
                "cancel-message" => {
                    let message = session.messages.iter_mut().find(|m| Some(m.id.as_str()) == message_id).ok_or("Message not found")?;
                    if message.run_id.is_some() { return Err("This message is already assigned. Send a correction or stop the current work.".into()); }
                    message.canceled = true;
                },
                "retry" => {
                    let batch = session.batches.last_mut().ok_or("No work to retry")?;
                    if self.runtime.integration_runs()?.iter().any(|r| r.id == batch.run_id) {
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
        let runs = self.runtime.integration_runs()?;
        let ids: Vec<_> = {
            let inner = self.inner.lock().map_err(|e| e.to_string())?;
            if inner.error.is_some() { return Ok(false); }
            inner.ledger.sessions.iter().filter(|s| !s.closed).map(|s| s.id.clone()).collect()
        };
        let mut changed = false;
        for id in ids {
            let snapshot = {
                let inner = self.inner.lock().map_err(|e| e.to_string())?;
                inner.ledger.sessions.iter().find(|s| s.id == id).cloned().ok_or("Session disappeared")?
            };
            if let Some(batch) = snapshot.batches.last().filter(|b| !b.settled) {
                if let Some(run) = runs.iter().find(|r| r.id == batch.run_id) {
                    if ["starting", "running", "stopping"].contains(&run.status.as_str()) { continue; }
                    self.update(|ledger| {
                        let session = Self::session(ledger, &id)?;
                        let batch = session.batches.last_mut().ok_or("Batch not found")?;
                        batch.settled = true;
                        if !["review", "reviewed"].contains(&run.status.as_str()) || run.verification_error.is_some() || run.verification.as_ref().is_some_and(|v| !v.result.success) {
                            session.paused = true;
                            session.error = Some(run.error.clone().or(run.verification_error.clone()).unwrap_or_else(|| "Review the last attempt before continuing.".into()));
                        }
                        Ok(())
                    })?;
                    changed = true;
                    continue;
                }
            }
            if snapshot.paused || snapshot.error.is_some() { continue; }
            if let Some(last) = snapshot.batches.last().filter(|batch| batch.settled) {
                if let Some(run) = runs.iter().find(|r| r.id == last.run_id) {
                    if !run.workspace.is_empty() && super::previews::ensure_idle(&run.workspace).is_err() { continue; }
                }
            }
            let batch = if let Some(batch) = snapshot.batches.last().filter(|b| !b.settled && b.error.is_none()) {
                batch.clone()
            } else {
                let pending: Vec<_> = snapshot.messages.iter().filter(|m| m.run_id.is_none() && !m.canceled).take(8).collect();
                if pending.is_empty() { continue; }
                let last_time = chrono::DateTime::parse_from_rfc3339(&pending.last().unwrap().created_at).map_err(|e| e.to_string())?;
                if Utc::now().signed_duration_since(last_time).num_milliseconds() < 700 { continue; }
                let batch = SessionBatch { run_id: Uuid::new_v4().to_string(), message_ids: pending.iter().map(|m| m.id.clone()).collect(), prompt: batch_prompt(&snapshot, &pending), previous_run_id: snapshot.batches.iter().rev().find(|b| runs.iter().any(|r| r.id == b.run_id && !r.workspace.is_empty())).map(|b| b.run_id.clone()), error: None, settled: false };
                let claimed = self.update(|ledger| {
                    let session = Self::session(ledger, &id)?;
                    if session.paused || session.closed || batch.message_ids.iter().any(|id| session.messages.iter().find(|m| &m.id == id).is_none_or(|m| m.canceled || m.run_id.is_some())) { return Ok(false); }
                    for message in &mut session.messages {
                        if batch.message_ids.contains(&message.id) && !message.canceled { message.run_id = Some(batch.run_id.clone()); }
                    }
                    session.batches.push(batch.clone());
                    Ok(true)
                })?;
                if !claimed { continue; }
                changed = true;
                batch
            };
            let latest = {
                let inner = self.inner.lock().map_err(|e| e.to_string())?;
                inner.ledger.sessions.iter().find(|s| s.id == id).cloned().ok_or("Session not found")?
            };
            if latest.paused || latest.closed || latest.batches.last().is_none_or(|b| b.run_id != batch.run_id) { continue; }
            let mut request = latest.request.clone();
            request.id = batch.run_id.clone();
            request.live_session_id = Some(id.clone());
            request.prompt = batch.prompt.clone();
            request.previous_run_id = batch.previous_run_id.clone();
            if let Some(previous) = runs.iter().find(|r| Some(&r.id) == batch.previous_run_id.as_ref()) {
                request.agent = previous.agent.clone();
                request.model = previous.model.clone();
                request.agent_profile_id = previous.account_binding.as_ref().and_then(|b| b.profile_id.clone());
            }
            if let Err(error) = self.coordinator.start_manual(request) {
                if error == "Session is waiting for execution capacity." { continue; }
                self.update(|ledger| {
                    let session = Self::session(ledger, &id)?;
                    if let Some(batch) = session.batches.iter_mut().find(|b| b.run_id == batch.run_id) { batch.error = Some(error.clone()); }
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
                    Ok(true) => { let _ = app.emit("live-sessions-changed", ()); },
                    Err(error) => {
                        if let Ok(mut inner) = service.inner.lock() {
                            for session in &mut inner.ledger.sessions { session.paused = true; }
                            inner.error = Some(format!("Session dispatch paused: {error}"));
                        }
                        let _ = app.emit("live-sessions-changed", ());
                    },
                    _ => {},
                }
                std::thread::sleep(Duration::from_millis(400));
            }
        });
    }

    pub fn shutdown(&self) { self.alive.store(false, Ordering::Relaxed); }
}

fn batch_prompt(session: &LiveSession, messages: &[&SessionMessage]) -> String {
    let mut prompt = format!("Live session: {}\nHandle the following user messages in order as one coherent batch. Group related changes; later corrections override earlier requests. Answer questions without assuming they authorize unrelated edits. Implement requested changes fully, preserving prior session work. Do not commit, push, reset, change branches, or create another worktree. Leave cumulative changes for review. Use the existing harness for tools, checks and user questions. Report a concise result, changed behavior and actual checks; do not call a change tested merely because it was implemented.\n", session.title);
    for message in messages { prompt.push_str(&format!("\nUser message {}:\n{}\n", message.id, message.text)); }
    prompt
}

#[tauri::command]
pub async fn live_session_snapshot(service: State<'_, LiveSessions>, id: Option<String>) -> Result<SessionSnapshot, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.snapshot(id.as_deref())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn live_session_create(service: State<'_, LiveSessions>, app: AppHandle, id: String, title: String, request: RunRequest) -> Result<String, String> {
    let service = service.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || service.create(id, title, request)).await.map_err(|e| e.to_string())??;
    let _ = app.emit("live-sessions-changed", ());
    Ok(result)
}

#[tauri::command]
pub async fn live_session_send(service: State<'_, LiveSessions>, app: AppHandle, id: String, message_id: String, text: String, draft_revision: Option<u64>) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.send(&id, message_id, text, draft_revision)).await.map_err(|e| e.to_string())??;
    let _ = app.emit("live-sessions-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn live_session_draft(service: State<'_, LiveSessions>, id: String, text: String, revision: u64) -> Result<SessionDraft, String> {
    let service = service.inner().clone();
    service.draft(&id, text, revision)
}

#[tauri::command]
pub async fn live_session_action(service: State<'_, LiveSessions>, app: AppHandle, id: String, action: String, message_id: Option<String>) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.action(&id, &action, message_id.as_deref())).await.map_err(|e| e.to_string())??;
    let _ = app.emit("live-sessions-changed", ());
    Ok(())
}

#[cfg(test)]
mod tests;
