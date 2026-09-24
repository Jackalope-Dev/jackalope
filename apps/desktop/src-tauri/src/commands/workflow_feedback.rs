use super::{
    history, integration,
    tasks::{TaskRun, TaskRuntime},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::Mutex,
};
use tauri::State;

static FEEDBACK_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usefulness {
    run_id: String,
    useful: bool,
    review_minutes: Option<u32>,
    recorded_at: String,
}

type Feedback = BTreeMap<String, Usefulness>;

fn path(runtime: &TaskRuntime) -> PathBuf {
    runtime
        .integration_directory()
        .join("workflow-feedback")
        .join("ratings.json")
}

fn read(runtime: &TaskRuntime) -> Result<Feedback, String> {
    let path = path(runtime);
    if !path.exists() {
        return Ok(Feedback::new());
    }
    serde_json::from_slice(&history::read_bounded(&path, 4_000_000)?).map_err(|e| {
        format!("Local usefulness ratings could not be read. Existing data is preserved: {e}")
    })
}

#[tauri::command]
pub async fn task_usefulness(
    state: State<'_, TaskRuntime>,
    id: String,
    useful: Option<bool>,
    review_minutes: Option<u32>,
) -> Result<Option<Usefulness>, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = integration::execution_guard()?;
        let runs = runtime.integration_runs()?;
        let run = runs
            .iter()
            .find(|run| run.id == id)
            .ok_or("Task not found")?;
        let _lock = FEEDBACK_LOCK.lock().map_err(|e| e.to_string())?;
        let mut ratings = read(&runtime)?;
        if let Some(useful) = useful {
            if ["starting", "running", "stopping"].contains(&run.status.as_str()) || run.finishing {
                return Err("Wait for this attempt to finish before rating its result.".into());
            }
            if review_minutes.is_some_and(|value| value > 10_080) {
                return Err("Use review minutes between 0 and 10,080, or leave them blank.".into());
            }
            if ratings.len() >= 10_000 && !ratings.contains_key(&run.task_id) {
                return Err(
                    "The local usefulness journal is full. Existing ratings are preserved.".into(),
                );
            }
            ratings.insert(
                run.task_id.clone(),
                Usefulness {
                    run_id: run.id.clone(),
                    useful,
                    review_minutes,
                    recorded_at: Utc::now().to_rfc3339(),
                },
            );
            let path = path(&runtime);
            std::fs::create_dir_all(path.parent().ok_or("Invalid feedback location")?)
                .map_err(|e| e.to_string())?;
            history::write_atomic(
                &path,
                &serde_json::to_vec(&ratings).map_err(|e| e.to_string())?,
            )?;
        }
        Ok(ratings
            .get(&run.task_id)
            .filter(|rating| rating.run_id == run.id)
            .cloned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowReport {
    generated_at: String,
    period_days: u32,
    tasks_started: usize,
    days_with_task_starts: usize,
    useful_results: usize,
    needs_more_work: usize,
    reported_review_minutes: u64,
    review_time_reports: usize,
    follow_up_attempts: usize,
    failed_or_interrupted_attempts: usize,
    recovered_useful_tasks: usize,
    first_useful_result_minutes: Option<i64>,
    coverage: String,
}

fn report(runs: &[TaskRun], ratings: &Feedback, now: DateTime<Utc>) -> WorkflowReport {
    let cutoff = now - chrono::Duration::days(7);
    let date = |text: &str| {
        DateTime::parse_from_rfc3339(text)
            .ok()
            .map(|date| date.with_timezone(&Utc))
    };
    let mut latest: BTreeMap<&str, &TaskRun> = BTreeMap::new();
    let mut first: BTreeMap<&str, DateTime<Utc>> = BTreeMap::new();
    let mut attempts: BTreeMap<&str, usize> = BTreeMap::new();
    let mut failures = BTreeSet::new();
    let mut active_days = BTreeSet::new();
    let mut result = WorkflowReport { generated_at: now.to_rfc3339(), period_days: 7,
        coverage: "Loaded local task history only; days use UTC. Usefulness and review time are self-reported. Ratings from superseded attempts are excluded. This report stays local until you copy or share it.".into(), ..Default::default() };
    for run in runs {
        if let Some(start) = date(&run.started_at) {
            first
                .entry(&run.task_id)
                .and_modify(|time| *time = (*time).min(start))
                .or_insert(start);
            if start >= cutoff && start <= now {
                active_days.insert(start.date_naive());
                *attempts.entry(&run.task_id).or_default() += 1;
                if ["failed", "interrupted"].contains(&run.status.as_str()) {
                    result.failed_or_interrupted_attempts += 1;
                }
            }
        }
        if ["failed", "interrupted"].contains(&run.status.as_str()) {
            failures.insert(run.task_id.as_str());
        }
        latest
            .entry(&run.task_id)
            .and_modify(|current| {
                if run.started_at > current.started_at {
                    *current = run;
                }
            })
            .or_insert(run);
    }
    result.tasks_started = first
        .values()
        .filter(|time| **time >= cutoff && **time <= now)
        .count();
    result.days_with_task_starts = active_days.len();
    result.follow_up_attempts = attempts
        .iter()
        .map(|(task, count)| {
            if first.get(task).is_some_and(|start| *start < cutoff) {
                *count
            } else {
                count.saturating_sub(1)
            }
        })
        .sum();
    let first_start = first.values().min();
    let mut first_useful = None;
    for (task, rating) in ratings {
        if latest
            .get(task.as_str())
            .is_none_or(|run| run.id != rating.run_id)
        {
            continue;
        }
        let Some(recorded) = date(&rating.recorded_at).filter(|time| *time <= now) else {
            continue;
        };
        if rating.useful {
            first_useful =
                Some(first_useful.map_or(recorded, |time: DateTime<Utc>| time.min(recorded)));
        }
        if recorded < cutoff {
            continue;
        }
        if rating.useful {
            result.useful_results += 1;
            if failures.contains(task.as_str()) {
                result.recovered_useful_tasks += 1;
            }
        } else {
            result.needs_more_work += 1;
        }
        if let Some(minutes) = rating.review_minutes {
            result.reported_review_minutes += minutes as u64;
            result.review_time_reports += 1;
        }
    }
    result.first_useful_result_minutes = first_start
        .zip(first_useful)
        .map(|(start, end)| end.signed_duration_since(*start).num_minutes().max(0));
    result
}

#[tauri::command]
pub async fn workflow_report(state: State<'_, TaskRuntime>) -> Result<WorkflowReport, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let runs = runtime.integration_runs()?;
        let _lock = FEEDBACK_LOCK.lock().map_err(|e| e.to_string())?;
        Ok(report(&runs, &read(&runtime)?, Utc::now()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_latest_rated_results_once_and_keeps_missing_time_unknown() {
        let now = DateTime::parse_from_rfc3339("2026-09-16T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let old = TaskRun {
            id: "old".into(),
            task_id: "task".into(),
            started_at: "2026-09-16T09:00:00Z".into(),
            status: "failed".into(),
            ..Default::default()
        };
        let current = TaskRun {
            id: "current".into(),
            task_id: "task".into(),
            started_at: "2026-09-16T10:00:00Z".into(),
            status: "reviewed".into(),
            ..Default::default()
        };
        let mut ratings = Feedback::from([(
            "task".into(),
            Usefulness {
                run_id: "old".into(),
                useful: true,
                review_minutes: None,
                recorded_at: "2026-09-16T11:00:00Z".into(),
            },
        )]);
        assert_eq!(
            report(&[old.clone(), current.clone()], &ratings, now).useful_results,
            0
        );
        ratings.get_mut("task").unwrap().run_id = "current".into();
        let summary = report(&[old, current], &ratings, now);
        assert_eq!(summary.useful_results, 1);
        assert_eq!(summary.tasks_started, 1);
        assert_eq!(summary.follow_up_attempts, 1);
        assert_eq!(summary.recovered_useful_tasks, 1);
        assert_eq!(summary.review_time_reports, 0);
        assert_eq!(summary.first_useful_result_minutes, Some(120));
    }
}
