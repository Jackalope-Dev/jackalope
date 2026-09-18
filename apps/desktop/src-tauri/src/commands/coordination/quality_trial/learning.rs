use crate::commands::{outcomes::TaskContract, tasks::TaskRun, verification::Verification};
use serde::Deserialize;
use serde_json::Value;
use std::{collections::HashSet, path::Path};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PriorAttempt {
    id: String,
    task_id: String,
    prompt: String,
    status: String,
    started_at: String,
    ended_at: String,
    #[serde(default)]
    contract: TaskContract,
    verification: Option<Verification>,
}

pub(super) fn seed(root: &Path, repo: &Path, project: &str, spec: &Value) -> Result<(), String> {
    let Some(history) = spec.get("learningHistory") else {
        return Ok(());
    };
    let cutoff = spec["taskAt"]
        .as_str()
        .ok_or("Learning cases require taskAt.")?;
    let cutoff =
        chrono::DateTime::parse_from_rfc3339(cutoff).map_err(|_| "Invalid learning cutoff.")?;
    let prior: Vec<PriorAttempt> =
        serde_json::from_value(history.clone()).map_err(|e| e.to_string())?;
    if prior.len() > 80 {
        return Err("Keep at most 80 prior learning attempts.".into());
    }
    let mut ids = HashSet::new();
    let mut runs = Vec::new();
    for entry in prior {
        if uuid::Uuid::parse_str(&entry.id).is_err()
            || uuid::Uuid::parse_str(&entry.task_id).is_err()
            || !ids.insert(entry.id.clone())
            || !["review", "reviewed", "failed"].contains(&entry.status.as_str())
            || entry.prompt.len() > 20_000
        {
            return Err(
                "Learning history needs unique UUIDs, bounded prompts and completed statuses."
                    .into(),
            );
        }
        let timestamps = [
            Some(entry.started_at.as_str()),
            Some(entry.ended_at.as_str()),
        ]
        .into_iter()
        .flatten()
        .chain(
            entry
                .contract
                .requirements
                .iter()
                .filter_map(|r| r.receipt.as_ref().map(|r| r.recorded_at.as_str())),
        )
        .chain(entry.verification.as_ref().map(|v| v.checked_at.as_str()));
        for timestamp in timestamps {
            if chrono::DateTime::parse_from_rfc3339(timestamp)
                .map_err(|_| "Invalid learning history date.")?
                >= cutoff
            {
                return Err("Learning history must precede the scored task, including review and check receipts.".into());
            }
        }
        runs.push(TaskRun {
            id: entry.id,
            task_id: entry.task_id,
            project_id: project.into(),
            project_name: "Learning fixture history".into(),
            project_path: repo.to_string_lossy().into(),
            workspace: repo.to_string_lossy().into(),
            agent: "fixture-history".into(),
            account: "fixture".into(),
            prompt: entry.prompt,
            status: entry.status,
            started_at: entry.started_at,
            ended_at: Some(entry.ended_at),
            contract: entry.contract,
            verification: entry.verification,
            ..Default::default()
        });
    }
    let directory = root.join("profile/history");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    for run in runs {
        std::fs::write(
            directory.join(format!("{}.json", run.id)),
            serde_json::to_vec(&run).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[test]
fn future_reviews_cannot_enter_learning_history() {
    let root = std::env::temp_dir().join(format!(
        "jackalope-learning-cutoff-{}",
        uuid::Uuid::new_v4()
    ));
    let spec = serde_json::json!({"taskAt":"2026-09-10T00:00:00Z", "learningHistory":[{
        "id":uuid::Uuid::new_v4(),"taskId":uuid::Uuid::new_v4(),"prompt":"Earlier work","status":"reviewed",
        "startedAt":"2026-09-09T00:00:00Z","endedAt":"2026-09-09T01:00:00Z",
        "contract":{"inputs":{},"requirements":[{"id":"r","title":"Outcome","checkpoint":false,"receipt":{
            "accepted":true,"note":"","evidence":"manual","tree":"tree","recordedAt":"2026-09-10T00:00:00Z"
        }}]}
    }]});
    assert!(seed(&root, &root, "p", &spec)
        .unwrap_err()
        .contains("precede"));
    assert!(!root.exists());
}
