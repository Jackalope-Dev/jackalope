//! Automatic cleanup: removes a project's task worktrees a chosen number of days after their
//! task is merged, integrated or archived. Every removal goes through the same inspection and
//! [`remove`] as the Clean up button, so uncommitted changes, unmerged commits, local data,
//! locks, running work and reservations keep a worktree. Branches are never deleted.
//!
//! The app calls this at a low cadence for projects that turned it on, passing the worktrees
//! its own state retains (a combine follow-up's sources), which task history cannot see.

use super::*;
use crate::commands::integration::{self, IntegrationPlan};
use chrono::{DateTime, Duration, Utc};
use std::collections::HashSet;

const LOG: &str = "worktree-cleanup.jsonl";
const LOG_MAX_BYTES: u64 = 256 * 1024;
const LOG_SHOWN: usize = 20;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RetentionEntry {
    pub project: String,
    pub worktree: String,
    pub branch: String,
    /// `removed`, `kept` or `failed`.
    pub outcome: String,
    pub reason: String,
    pub at: String,
}

/// What task history says about one worktree before Git is asked.
#[derive(Debug, PartialEq)]
pub(super) struct Settled {
    /// Why the task counts as finished from history alone; `None` when only Git can show it
    /// merged.
    pub finished: Option<&'static str>,
    /// When the worktree's last attempt ended, was archived or was merged, whichever is latest.
    pub since: DateTime<Utc>,
    /// The commits its attempts started from, so a branch with no commits of its own does not
    /// count as merged.
    pub base_heads: Vec<String>,
}

fn parse_time(value: Option<&str>) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value?)
        .ok()
        .map(|time| time.with_timezone(&Utc))
}

/// How the app compares workspace paths: `/` separators, no trailing one, lower case. Matching
/// case-insensitively can only keep more worktrees, never fewer.
pub(super) fn path_key(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

fn same_workspace(run: &TaskRun, path: &Path) -> bool {
    !run.workspace.is_empty()
        && task_workspace(Path::new(&run.workspace)).is_ok_and(|workspace| workspace == path)
}

/// The reason task history needs `path` kept, or what finished its task and when. `path` is
/// canonical; `retained` holds [`path_key`]s of the worktrees the app keeps for a combine
/// follow-up.
pub(super) fn history(
    path: &Path,
    runs: &[TaskRun],
    applied: &HashSet<String>,
    plans: &[IntegrationPlan],
    retained: &HashSet<String>,
) -> Result<Settled, String> {
    if retained.contains(&path_key(&path.to_string_lossy())) {
        return Err("A combine follow-up still reads it.".into());
    }
    let owners: Vec<&TaskRun> = runs
        .iter()
        .filter(|run| same_workspace(run, path))
        .collect();
    if owners.is_empty() {
        return Err("No task in the loaded history uses it.".into());
    }
    if owners.iter().any(|run| run.persistence_error.is_some()) {
        return Err("Its task history is not saved yet.".into());
    }
    if owners
        .iter()
        .any(|run| run.status.is_live() || run.finishing || run.review_capturing)
    {
        return Err("Its task is running, finishing or interrupted.".into());
    }
    if owners.iter().any(|run| run.live_session_id.is_some()) {
        return Err("A conversation keeps working in it.".into());
    }
    let ids: HashSet<&str> = owners.iter().map(|run| run.id.as_str()).collect();
    if runs.iter().any(|run| {
        run.status.is_live()
            && run
                .challenge_of
                .as_ref()
                .is_some_and(|source| ids.contains(source.run_id.as_str()))
    }) {
        return Err("A review of its result is running.".into());
    }
    if plans.iter().any(|plan| {
        matches!(plan.status.as_str(), "ready" | "applying")
            && plan.run_ids.iter().any(|id| ids.contains(id.as_str()))
    }) {
        return Err("A merge of its work is prepared but not applied.".into());
    }
    let tasks: HashSet<&str> = owners.iter().map(|run| run.task_id.as_str()).collect();
    let mut since: Option<DateTime<Utc>> = None;
    let mut later = |time: Option<DateTime<Utc>>| {
        if let Some(time) = time {
            since = Some(since.map_or(time, |current| current.max(time)));
        }
    };
    let mut all_integrated = true;
    let mut all_archived = true;
    for task in &tasks {
        let attempts: Vec<&TaskRun> = runs.iter().filter(|run| run.task_id == *task).collect();
        let latest = attempts
            .iter()
            .max_by_key(|run| parse_time(Some(&run.started_at)))
            .expect("an owner belongs to its own task");
        let integrated = attempts.iter().any(|run| applied.contains(&run.id));
        all_integrated &= integrated;
        all_archived &= latest.archived_at.is_some();
        for run in &owners {
            if run.task_id == *task {
                later(parse_time(run.ended_at.as_deref()));
            }
        }
        later(parse_time(latest.archived_at.as_deref()));
        for plan in plans.iter().filter(|plan| plan.status == "applied") {
            if attempts.iter().any(|run| plan.run_ids.contains(&run.id)) {
                later(parse_time(plan.applied_at.as_deref()));
            }
        }
    }
    let since = since.ok_or("Its task has no recorded end time.")?;
    let finished = if all_integrated {
        Some("its task was merged by Jackalope")
    } else if all_archived {
        Some("its task was archived")
    } else {
        None
    };
    Ok(Settled {
        finished,
        since,
        base_heads: owners.iter().map(|run| run.base_head.clone()).collect(),
    })
}

/// Whether `settled` has waited out the retention period at `now`.
pub(super) fn waited(
    settled: &Settled,
    retention: Duration,
    now: DateTime<Utc>,
) -> Result<(), String> {
    let until = settled.since + retention;
    if now < until {
        return Err(format!(
            "Kept until {} under the retention period.",
            until.format("%Y-%m-%d %H:%M UTC")
        ));
    }
    Ok(())
}

/// The removal reason for a worktree Git inspection found clean, or why it stays. A branch
/// whose head is still where its task started has no commits of its own, so being "merged"
/// says nothing about the task and only an archive or a Jackalope merge counts.
pub(super) fn decide(
    settled: &Settled,
    head: &str,
    status: &CleanupStatus,
) -> Result<String, String> {
    if let Some(reason) = &status.blocked_reason {
        return Err(reason.clone());
    }
    let target = status
        .target_branch
        .as_deref()
        .unwrap_or("the target branch");
    if status.merged != Some(true) && !status.content_merged {
        return Err(format!("It has commits that are not merged into {target}."));
    }
    let own_commits = !settled.base_heads.is_empty()
        && settled
            .base_heads
            .iter()
            .all(|base| !base.is_empty() && base != head);
    let reason = match settled.finished {
        Some(reason) => reason.to_string(),
        None if status.content_merged || own_commits => {
            format!("its commits are merged into {target}")
        }
        None => return Err("Its task is not merged or archived.".into()),
    };
    Ok(reason)
}

fn processes(path: &Path) -> Result<(), String> {
    match crate::commands::tasks::workspace_processes::workspace_processes(path) {
        Some(found) if !found.is_empty() => {
            let process = &found[0];
            Err(format!(
                "{} (process {}) is running in it.",
                process.name, process.pid
            ))
        }
        _ => Ok(()),
    }
}

/// One cleanup pass over `project_path`. Each candidate is checked against history first, then
/// inspected and removed under the execution guard with history read again.
pub(super) fn run_pass(
    runtime: &TaskRuntime,
    project_path: &str,
    retention: Duration,
    retained: &[String],
    now: DateTime<Utc>,
) -> Result<Vec<RetentionEntry>, String> {
    let project = canonical(project_path)?;
    let Ok(parent) = canonical(&project.join(".worktrees").to_string_lossy()) else {
        return Ok(Vec::new());
    };
    if !parent.starts_with(&project) {
        return Err("The .worktrees directory resolves outside this project.".into());
    }
    let retained: HashSet<String> = retained
        .iter()
        .flat_map(|path| {
            let resolved = task_workspace(Path::new(path))
                .ok()
                .map(|resolved| path_key(&resolved.to_string_lossy()));
            std::iter::once(path_key(path)).chain(resolved)
        })
        .collect();
    let entry = |worktree: &WorktreeEntry, outcome: &str, reason: String| RetentionEntry {
        project: project_path.to_string(),
        worktree: worktree.path.clone(),
        branch: worktree.branch.clone(),
        outcome: outcome.into(),
        reason,
        at: Utc::now().to_rfc3339(),
    };
    let facts = || -> Result<_, String> {
        let runs = runtime.integration_runs()?;
        if runs.iter().any(|run| run.persistence_error.is_some()) {
            return Err("Save pending task history before automatic worktree cleanup.".into());
        }
        let applied: HashSet<String> = integration::applied_view(runtime)?.0.into_iter().collect();
        Ok((runs, applied, integration::plans(runtime)?))
    };
    let (runs, applied, plans) = facts()?;
    let mut report = Vec::new();
    for worktree in list_worktrees(project_path)?.iter().skip(1) {
        let Ok(path) = canonical(&worktree.path) else {
            continue;
        };
        if path.parent() != Some(parent.as_path()) {
            continue;
        }
        if retained.contains(&path_key(&worktree.path)) {
            report.push(entry(
                worktree,
                "kept",
                "A combine follow-up still reads it.".into(),
            ));
            continue;
        }
        let screened = history(&path, &runs, &applied, &plans, &retained)
            .and_then(|settled| waited(&settled, retention, now))
            .and_then(|()| processes(&path));
        if let Err(reason) = screened {
            report.push(entry(worktree, "kept", reason));
            continue;
        }
        let _guard = integration::execution_guard()?;
        let (runs, applied, plans) = facts()?;
        let checked = history(&path, &runs, &applied, &plans, &retained).and_then(|settled| {
            waited(&settled, retention, now)?;
            let inspected = inspect_entries(project_path, None, &runs, Some(&worktree.path))?;
            let current = inspected
                .into_iter()
                .find(|entry| entry.path == worktree.path)
                .ok_or("Git no longer registers it.")?;
            let status = current
                .cleanup
                .clone()
                .ok_or("It could not be inspected.")?;
            let reason = decide(&settled, &current.head, &status)?;
            let days = match (now - settled.since).num_days() {
                1 => "1 day".to_string(),
                days => format!("{days} days"),
            };
            Ok((
                current,
                status,
                format!("Removed because {reason} {days} ago and nothing in it needed keeping."),
            ))
        });
        let (current, status, reason) = match checked {
            Ok(checked) => checked,
            Err(reason) => {
                report.push(entry(worktree, "kept", reason));
                continue;
            }
        };
        match remove(
            project_path,
            &current.path,
            status.target_branch.as_deref().unwrap_or_default(),
            &current.head,
            status.target_head.as_deref().unwrap_or_default(),
            &runs,
            false,
            Some(&current.branch),
        ) {
            Ok(()) => report.push(entry(&current, "removed", reason)),
            Err(error) => report.push(entry(&current, "failed", error)),
        }
    }
    Ok(report)
}

fn log_path(runtime: &TaskRuntime) -> PathBuf {
    runtime.integration_directory().join(LOG)
}

/// Appends removals and failures to the cleanup log, keeping its newer half once it grows past
/// its limit. Kept worktrees are only reported to the caller.
fn record(runtime: &TaskRuntime, entries: &[RetentionEntry]) -> Result<(), String> {
    use std::io::Write;
    let lines: Vec<String> = entries
        .iter()
        .filter(|entry| entry.outcome != "kept")
        .filter_map(|entry| serde_json::to_string(entry).ok())
        .collect();
    if lines.is_empty() {
        return Ok(());
    }
    let path = log_path(runtime);
    std::fs::create_dir_all(path.parent().ok_or("No log folder")?).map_err(|e| e.to_string())?;
    if std::fs::metadata(&path).is_ok_and(|metadata| metadata.len() > LOG_MAX_BYTES) {
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        let kept: Vec<&str> = text.lines().collect();
        let newer = kept[kept.len() / 2..].join("\n");
        crate::commands::history::write_atomic(&path, format!("{newer}\n").as_bytes())?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    for line in lines {
        writeln!(file, "{line}").map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn read_log(runtime: &TaskRuntime, project_path: &str) -> Vec<RetentionEntry> {
    let text = std::fs::read_to_string(log_path(runtime)).unwrap_or_default();
    let mut entries: Vec<RetentionEntry> = text
        .lines()
        .filter_map(|line| serde_json::from_str::<RetentionEntry>(line).ok())
        .filter(|entry| crate::commands::project_registry::same_path(&entry.project, project_path))
        .collect();
    entries.reverse();
    entries.truncate(LOG_SHOWN);
    entries
}

#[tauri::command]
pub async fn worktree_retention_run(
    project_path: String,
    retention_days: u32,
    retained: Vec<String>,
    state: State<'_, TaskRuntime>,
) -> Result<Vec<RetentionEntry>, String> {
    if !(1..=365).contains(&retention_days) {
        return Err("Choose a retention period from 1 to 365 days.".into());
    }
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime.access.ensure()?;
        let report = run_pass(
            &runtime,
            &project_path,
            Duration::days(retention_days.into()),
            &retained,
            Utc::now(),
        )?;
        for entry in report.iter().filter(|entry| entry.outcome != "kept") {
            eprintln!(
                "Automatic worktree cleanup {} {}: {}",
                entry.outcome, entry.worktree, entry.reason
            );
        }
        record(&runtime, &report)?;
        Ok(report)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn worktree_retention_log(
    project_path: String,
    state: State<'_, TaskRuntime>,
) -> Result<Vec<RetentionEntry>, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || Ok(read_log(&runtime, &project_path)))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests;
