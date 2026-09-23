use super::*;
use std::sync::atomic::Ordering;
use tauri::Emitter;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskChanges {
    revision: u64,
    runs: Vec<TaskRun>,
    ids: Vec<String>,
}

/// A run reduced to just enough to list and open it again, for surfaces
/// outside the frontend (tray menu, dock) that don't need the full record.
pub struct TaskHighlight {
    pub id: String,
    pub label: String,
}

fn tray_label(run: &TaskRun) -> String {
    let prompt = run.prompt.trim();
    let source = if prompt.is_empty() {
        run.project_name.as_str()
    } else {
        prompt
    };
    let mut label: String = source.chars().take(60).collect();
    if label.chars().count() < source.chars().count() {
        label.push('…');
    }
    label
}

impl TaskRuntime {
    /// Recent runs and the count awaiting review, for the tray menu and dock
    /// badge — surfaces that live outside the frontend and need their own
    /// lightweight read of the same state.
    pub fn tray_summary(&self, recent_limit: usize) -> (Vec<TaskHighlight>, usize) {
        let inner = self.inner.lock().unwrap();
        let mut runs: Vec<&TaskRun> = inner.runs.values().collect();
        runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        let awaiting_review = runs.iter().filter(|run| run.status == "review").count();
        let recent = runs
            .into_iter()
            .take(recent_limit)
            .map(|run| TaskHighlight {
                id: run.id.clone(),
                label: tray_label(run),
            })
            .collect();
        (recent, awaiting_review)
    }

    pub(in crate::commands) fn live_session_runs(
        &self,
        detail: Option<&str>,
    ) -> Result<Vec<TaskRun>, String> {
        let inner = self.inner.lock().map_err(|e| e.to_string())?;
        Ok(inner
            .runs
            .values()
            .filter(|run| run.live_session_id.is_some())
            .map(|run| {
                let mut summary = run.summary();
                if detail.is_some() && detail == run.live_session_id.as_deref() {
                    summary.result = run.result.clone();
                }
                summary
            })
            .collect())
    }

    pub(in crate::commands) fn snapshot(&self, detail: Option<&str>) -> Vec<TaskRun> {
        let inner = self.inner.lock().unwrap();
        let mut runs: Vec<_> = inner
            .runs
            .values()
            .map(|run| {
                if detail == Some(run.id.as_str()) {
                    run.clone()
                } else {
                    run.summary()
                }
            })
            .collect();
        runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        runs
    }

    pub fn observe_changes(&self, app: AppHandle) {
        let mut changes = self.writer.subscribe();
        tauri::async_runtime::spawn(async move {
            while changes.changed().await.is_ok() {
                tokio::time::sleep(Duration::from_millis(100)).await;
                changes.borrow_and_update();
                let _ = app.emit("task-state-changed", ());
            }
        });
    }

    pub(super) fn changes(
        &self,
        since: Option<u64>,
        detail: Option<&str>,
        previous_detail: Option<&str>,
    ) -> TaskChanges {
        let inner = self.inner.lock().unwrap();
        let revision = self.writer.revision.load(Ordering::SeqCst);
        let runs = inner
            .runs
            .values()
            .filter(|run| {
                since.is_none_or(|since| since > revision || self.writer.version(&run.id) > since)
                    || (detail != previous_detail
                        && (detail == Some(run.id.as_str())
                            || previous_detail == Some(run.id.as_str())))
            })
            .map(|run| {
                if detail == Some(run.id.as_str()) {
                    run.clone()
                } else {
                    run.summary()
                }
            })
            .collect();
        TaskChanges {
            revision,
            runs,
            ids: inner.runs.keys().cloned().collect(),
        }
    }
}

#[tauri::command]
pub fn task_changes(
    state: State<'_, TaskRuntime>,
    since: Option<u64>,
    detail_id: Option<String>,
    previous_detail_id: Option<String>,
) -> TaskChanges {
    state.changes(since, detail_id.as_deref(), previous_detail_id.as_deref())
}
