use super::*;
use crate::commands::tasks::TaskRun;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowUp {
    pub id: String,
    pub task_id: String,
    pub previous_run_id: String,
    pub prompt: String,
    pub connection_ids: Option<Vec<String>>,
    pub run_id: Option<String>,
    pub dispatched: bool,
    pub paused: bool,
    pub error: Option<String>,
    pub allow_failure: Option<String>,
    pub interrupt: bool,
}

fn latest<'a>(runs: &'a [TaskRun], task_id: &str) -> Result<&'a TaskRun, String> {
    runs.iter()
        .filter(|run| run.task_id == task_id)
        .max_by(|a, b| a.started_at.cmp(&b.started_at))
        .ok_or_else(|| "Restore the task from history before continuing.".into())
}

fn resumable(run: &TaskRun) -> Result<(), String> {
    if run.status == "interrupted" || run.session_id.is_none() || run.live_session_id.is_some() {
        return Err(
            "This attempt cannot queue a continuation. Review its recovery or live session.".into(),
        );
    }
    if run.archived_at.is_some() {
        return Err("Restore this task before continuing.".into());
    }
    Ok(())
}

impl Coordinator {
    fn followups(&self, task_id: &str) -> Result<Vec<FollowUp>, String> {
        self.ensure_storage_loaded()?;
        let inner = self.inner.lock().map_err(|error| error.to_string())?;
        Ok(inner
            .ledger
            .followups
            .iter()
            .filter(|item| item.task_id == task_id && !item.dispatched)
            .cloned()
            .collect())
    }

    fn enqueue_followup(
        &self,
        id: String,
        run_id: &str,
        prompt: String,
        connection_ids: Option<Vec<String>>,
        interrupt: bool,
    ) -> Result<(), String> {
        self.runtime.access.ensure()?;
        self.ensure_storage_loaded()?;
        Uuid::parse_str(&id).map_err(|_| "Invalid follow-up identifier")?;
        let prompt = prompt.trim().to_string();
        if prompt.is_empty() || prompt.len() > 100_000 {
            return Err("Enter a follow-up up to 100,000 bytes.".into());
        }
        let mut inner = self.inner.lock().map_err(|error| error.to_string())?;
        let _guard = crate::commands::integration::execution_guard()?;
        self.runtime.ensure_history_saved()?;
        if let Some(existing) = inner.ledger.followups.iter().find(|item| item.id == id) {
            if existing.prompt != prompt
                || existing.previous_run_id != run_id
                || existing.connection_ids != connection_ids
                || existing.interrupt != interrupt
            {
                return Err("This follow-up was already saved with different instructions.".into());
            }
            if interrupt && !existing.dispatched && existing.run_id.is_none() {
                self.stop_for_followup(&mut inner, &id, run_id)?;
            }
            return Ok(());
        }
        let runs = self.runtime.integration_runs()?;
        let run = runs
            .iter()
            .find(|run| run.id == run_id)
            .ok_or("Attempt not found")?;
        resumable(run)?;
        if latest(&runs, &run.task_id)?.id != run.id {
            return Err("Open the latest attempt before queuing a follow-up.".into());
        }
        if crate::commands::integration::applied_run_ids(&self.runtime)?.contains(&run.id) {
            return Err("This task was merged. Start a new task from the updated project.".into());
        }
        if inner
            .ledger
            .followups
            .iter()
            .filter(|item| !item.dispatched)
            .count()
            >= 100
        {
            return Err("Run or cancel queued follow-ups before adding more.".into());
        }
        let mut ledger = inner.ledger.clone();
        let position = if interrupt {
            ledger
                .followups
                .iter()
                .position(|item| item.task_id == run.task_id && !item.dispatched)
                .unwrap_or(ledger.followups.len())
        } else {
            ledger.followups.len()
        };
        ledger.followups.insert(
            position,
            FollowUp {
                id: id.clone(),
                task_id: run.task_id.clone(),
                previous_run_id: run.id.clone(),
                prompt,
                connection_ids,
                run_id: None,
                dispatched: false,
                paused: false,
                error: None,
                allow_failure: interrupt.then(|| run.id.clone()),
                interrupt,
            },
        );
        self.save(&ledger)?;
        inner.ledger = ledger;
        if interrupt {
            self.stop_for_followup(&mut inner, &id, run_id)?;
        }
        Ok(())
    }

    fn stop_for_followup(&self, inner: &mut Inner, id: &str, run_id: &str) -> Result<(), String> {
        if let Err(error) = self.runtime.stop(run_id) {
            self.pause_followup(
                inner,
                id,
                format!("Could not stop the current attempt: {error}"),
            )?;
            return Err(error);
        }
        self.update_followup(inner, id, |item| {
            item.paused = false;
            item.error = None;
        })
    }

    fn followup_action(&self, id: &str, action: &str) -> Result<(), String> {
        self.ensure_storage_loaded()?;
        let mut inner = self.inner.lock().map_err(|error| error.to_string())?;
        let mut ledger = inner.ledger.clone();
        let item = ledger
            .followups
            .iter_mut()
            .find(|item| item.id == id && !item.dispatched)
            .ok_or("This follow-up has already started or was canceled.")?;
        match action {
            "cancel" => item.dispatched = true,
            "resume" => {
                self.runtime.access.ensure()?;
                let runs = self.runtime.integration_runs()?;
                let run = latest(&runs, &item.task_id)?;
                resumable(run)?;
                if item.run_id.is_some() {
                    return Err("An interrupted launch needs inspection. Cancel this queued item after reviewing the retained task history.".into());
                }
                item.paused = false;
                item.error = None;
                item.allow_failure = Some(run.id.clone());
            }
            _ => return Err("Choose resume or cancel.".into()),
        }
        self.save(&ledger)?;
        inner.ledger = ledger;
        Ok(())
    }

    pub(super) fn validate_followup_launch(
        &self,
        ledger: &Ledger,
        request: &RunRequest,
    ) -> Result<(), String> {
        let Some(previous) = request
            .previous_run_id
            .as_ref()
            .or(request.retry_of.as_ref())
        else {
            return Ok(());
        };
        let runs = self.runtime.integration_runs()?;
        if let Some(run) = runs.iter().find(|run| &run.id == previous) {
            let pending: Vec<_> = ledger
                .followups
                .iter()
                .filter(|item| item.task_id == run.task_id && !item.dispatched)
                .collect();
            if !pending.is_empty()
                && !pending
                    .iter()
                    .any(|item| item.run_id.as_ref() == Some(&request.id))
            {
                return Err(
                    "Run or cancel queued follow-ups before starting another continuation.".into(),
                );
            }
        }
        Ok(())
    }

    pub(super) fn dispatch_followups(&self) -> Result<(), String> {
        self.ensure_storage_loaded()?;
        let mut inner = self.inner.lock().map_err(|error| error.to_string())?;
        if !self.alive.load(Ordering::Relaxed) || inner.url.is_none() {
            return Ok(());
        }
        let mut seen = HashSet::new();
        let pending: Vec<_> = inner
            .ledger
            .followups
            .iter()
            .filter(|item| !item.dispatched && seen.insert(item.task_id.clone()))
            .cloned()
            .collect();
        for item in pending {
            let runs = self.runtime.integration_runs()?;
            if item
                .run_id
                .as_ref()
                .is_some_and(|id| runs.iter().any(|run| &run.id == id))
            {
                self.update_followup(&mut inner, &item.id, |entry| entry.dispatched = true)?;
                continue;
            }
            if item.run_id.is_some() {
                self.pause_followup(&mut inner, &item.id, "The launch was interrupted. Inspect retained history before canceling this queued item.".into())?;
                continue;
            }
            if item.paused {
                continue;
            }
            self.runtime.access.ensure()?;
            self.runtime.ensure_history_saved()?;
            let run = match latest(&runs, &item.task_id).and_then(|run| {
                resumable(run)?;
                Ok(run)
            }) {
                Ok(run) => run,
                Err(error) => {
                    self.pause_followup(&mut inner, &item.id, error)?;
                    continue;
                }
            };
            if run.finishing || ["starting", "running", "stopping"].contains(&run.status.as_str()) {
                continue;
            }
            if item.allow_failure.as_ref() != Some(&run.id)
                && (!matches!(run.status.as_str(), "review" | "reviewed")
                    || run.verification_error.is_some()
                    || run
                        .verification
                        .as_ref()
                        .is_some_and(|check| !check.result.success))
            {
                self.pause_followup(
                    &mut inner,
                    &item.id,
                    "Review the last attempt before resuming queued follow-ups.".into(),
                )?;
                continue;
            }
            if crate::commands::integration::applied_run_ids(&self.runtime)?.contains(&run.id) {
                self.pause_followup(
                    &mut inner,
                    &item.id,
                    "This task was merged. Start a new task from the updated project.".into(),
                )?;
                continue;
            }
            if runs
                .iter()
                .filter(|run| matches!(run.status.as_str(), "starting" | "running" | "stopping"))
                .count()
                >= inner.concurrency
                || crate::commands::previews::ensure_idle(&run.workspace).is_err()
                || crate::commands::verification::ensure_idle(&run.workspace).is_err()
            {
                continue;
            }
            let attempt = Uuid::new_v4().to_string();
            let prompt = if run.status == "stopped" && run.result.is_empty() {
                format!("The previous attempt was stopped before completion. Its request is context only; follow the new instruction below instead of restarting that work.\n\nPrevious request:\n{}\n\nCurrent follow-up:\n{}", run.prompt, item.prompt)
            } else {
                item.prompt.clone()
            };
            let request: RunRequest = serde_json::from_value(serde_json::json!({
                "id":attempt,"projectId":run.project_id,"projectName":run.project_name,
                "projectPath":run.project_path,"agent":run.agent,"model":run.model,
                "prompt":prompt,"isolated":false,"previousRunId":run.id,
                "connectionIds":item.connection_ids,
            }))
            .map_err(|error| error.to_string())?;
            // Persist ownership before launch; an interrupted claim must never replay itself.
            self.update_followup(&mut inner, &item.id, |entry| {
                entry.run_id = Some(attempt.clone());
            })?;
            let result = self.start_manual_locked(&mut inner, request);
            let exists = self
                .runtime
                .integration_runs()?
                .iter()
                .any(|run| run.id == attempt);
            self.update_followup(&mut inner, &item.id, |entry| {
                if result.is_ok() || exists {
                    entry.dispatched = true;
                } else {
                    entry.run_id = None;
                    entry.paused = true;
                    entry.error = result.err();
                }
            })?;
        }
        Ok(())
    }

    fn update_followup(
        &self,
        inner: &mut Inner,
        id: &str,
        change: impl FnOnce(&mut FollowUp),
    ) -> Result<(), String> {
        let mut ledger = inner.ledger.clone();
        change(
            ledger
                .followups
                .iter_mut()
                .find(|item| item.id == id)
                .ok_or("Follow-up not found")?,
        );
        self.save(&ledger)?;
        inner.ledger = ledger;
        Ok(())
    }

    fn pause_followup(&self, inner: &mut Inner, id: &str, error: String) -> Result<(), String> {
        if inner
            .ledger
            .followups
            .iter()
            .any(|entry| entry.id == id && entry.paused && entry.error.as_ref() == Some(&error))
        {
            return Ok(());
        }
        self.update_followup(inner, id, |entry| {
            entry.paused = true;
            entry.error = Some(error);
        })
    }
}

#[tauri::command]
pub async fn task_followup_queue(
    service: State<'_, Coordinator>,
    id: String,
    run_id: String,
    prompt: String,
    connection_ids: Option<Vec<String>>,
    interrupt: bool,
) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.enqueue_followup(id, &run_id, prompt, connection_ids, interrupt)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn task_followup_snapshot(
    service: State<'_, Coordinator>,
    task_id: String,
) -> Result<Vec<FollowUp>, String> {
    service.followups(&task_id)
}

#[tauri::command]
pub async fn task_followup_action(
    service: State<'_, Coordinator>,
    id: String,
    action: String,
) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.followup_action(&id, &action))
        .await
        .map_err(|error| error.to_string())?
}
