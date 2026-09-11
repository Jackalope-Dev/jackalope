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

impl TaskRuntime {
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

    pub(super) fn snapshot(&self, detail: Option<&str>) -> Vec<TaskRun> {
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
