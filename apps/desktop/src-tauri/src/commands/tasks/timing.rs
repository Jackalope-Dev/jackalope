use super::*;

#[derive(Clone, Default, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionStage {
    pub stage: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_ms: Option<i64>,
}

impl TaskRuntime {
    pub(in crate::commands) fn stage(&self, id: &str, next: Option<&str>) {
        self.update(id, |run| {
            let now = Utc::now();
            if let Some(last) = run.stages.last_mut().filter(|s| s.ended_at.is_none()) {
                last.ended_at = Some(now.to_rfc3339());
                last.duration_ms = chrono::DateTime::parse_from_rfc3339(&last.started_at)
                    .ok()
                    .map(|start| (now - start.with_timezone(&Utc)).num_milliseconds().max(0));
            }
            if let Some(stage) = next {
                if run.stages.len() < 128 {
                    run.stages.push(ExecutionStage {
                        stage: stage.into(),
                        started_at: now.to_rfc3339(),
                        ..Default::default()
                    });
                }
            }
        });
    }
}
