//! Compact per-task change counts for work lists, without loading full diffs.

use super::repo::{self, Policy};
use super::tasks::TaskRuntime;
use serde::Serialize;
use std::{collections::HashMap, path::Path};
use tauri::State;

const MAX_IDS: usize = 200;
const MAX_UNTRACKED: usize = 200;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct ChangeStats {
    pub files: usize,
    pub added: usize,
    pub removed: usize,
}

/// Lines changed in `workspace` since `base`, counting new untracked files as added.
fn stats(workspace: &Path, base: &str) -> Option<ChangeStats> {
    if base.is_empty() || !workspace.is_dir() {
        return None;
    }
    let numstat = repo::git_exact(
        workspace,
        &["diff", "--numstat", "-z", "--no-renames", base, "--"],
        Policy::Inspection,
    )
    .ok()?;
    let mut result = ChangeStats::default();
    for entry in repo::parse_numstat(&numstat) {
        result.files += 1;
        result.added += entry.added.unwrap_or(0) as usize;
        result.removed += entry.removed.unwrap_or(0) as usize;
    }
    let untracked = repo::untracked_files(workspace, Policy::Inspection).ok()?;
    for name in untracked.iter().take(MAX_UNTRACKED) {
        result.files += 1;
        result.added += repo::untracked_lines(&workspace.join(name)).unwrap_or(0) as usize;
    }
    Some(result)
}

/// Whether the HEAD of a project checkout that an attempt edited in place has moved since
/// the attempt ended. Its diff from the base would then also hold later commits, so it no
/// longer describes the attempt.
fn moved_since(workspace: &Path, base: &str, ended: i64) -> bool {
    let read = |args: &[&str]| repo::git(workspace, args, Policy::Inspection).ok();
    let Some(head) = read(&["rev-parse", "HEAD"]) else {
        return true;
    };
    if head == base {
        return false;
    }
    // The reflog records when HEAD moved in this checkout, so commits pulled in later count
    // even when their own dates are older. Without a reflog, fall back to commit dates.
    let moved =
        read(&["log", "-g", "-1", "--date=unix", "--format=%gd", "HEAD"]).and_then(|entry| {
            let (_, time) = entry.split_once("@{")?;
            time.strip_suffix('}')?.parse::<i64>().ok()
        });
    if let Some(moved) = moved {
        return moved > ended;
    }
    read(&[
        "rev-list",
        "-1",
        &format!("--since=@{ended}"),
        &format!("{base}..HEAD"),
    ])
    .is_none_or(|later| !later.is_empty())
}

/// End time of an attempt that edited its project checkout in place, if it has ended.
fn ended_in_place(workspace: &str, project: &str, ended: Option<&str>) -> Option<i64> {
    let ended = chrono::DateTime::parse_from_rfc3339(ended?)
        .ok()?
        .timestamp();
    let same = std::fs::canonicalize(workspace).ok()? == std::fs::canonicalize(project).ok()?;
    same.then_some(ended)
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::change_stats::task_change_stats,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

/// Change counts for the given attempts. Attempts without a readable workspace are omitted.
#[tauri::command]
pub async fn task_change_stats(
    ids: Vec<String>,
    state: State<'_, TaskRuntime>,
) -> Result<HashMap<String, ChangeStats>, String> {
    let wanted: std::collections::HashSet<String> = ids.into_iter().take(MAX_IDS).collect();
    let runs: Vec<_> = state
        .integration_runs()?
        .into_iter()
        .filter(|run| wanted.contains(&run.id))
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        runs.into_iter()
            .filter_map(|run| {
                let workspace = Path::new(&run.workspace);
                // Omitted rather than counting later work in the shared checkout as the attempt's.
                let ended =
                    ended_in_place(&run.workspace, &run.project_path, run.ended_at.as_deref());
                if ended.is_some_and(|ended| moved_since(workspace, &run.base_head, ended)) {
                    return None;
                }
                stats(workspace, &run.base_head).map(|stats| (run.id, stats))
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_tracked_and_untracked_changes_since_the_base() {
        let root = std::env::temp_dir().join(format!("jackalope-stats-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let run = |args: &[&str]| {
            repo::git(&root, args, Policy::Isolated).unwrap();
        };
        run(&["init", "-q"]);
        std::fs::write(root.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        run(&["add", "."]);
        run(&[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit",
            "-qm",
            "base",
        ]);
        let base = repo::git(&root, &["rev-parse", "HEAD"], Policy::Isolated).unwrap();
        assert_eq!(stats(&root, &base), Some(ChangeStats::default()));
        std::fs::write(root.join("a.txt"), "one\n2\nthree\nfour\n").unwrap();
        std::fs::write(root.join("new.txt"), "x\ny").unwrap();
        assert_eq!(
            stats(&root, &base),
            Some(ChangeStats {
                files: 2,
                added: 4,
                removed: 1
            })
        );
        assert_eq!(stats(&root, ""), None);
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(stats(&root, &base), None);
    }

    #[test]
    fn an_in_place_attempt_stops_counting_once_the_checkout_moves_on() {
        let root = std::env::temp_dir().join(format!("jackalope-moved-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let run = |args: &[&str]| repo::git(&root, args, Policy::Isolated).unwrap();
        let commit = |message: &str| {
            run(&["add", "."]);
            run(&[
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "commit",
                "-qm",
                message,
            ]);
        };
        run(&["init", "-q"]);
        std::fs::write(root.join("a.txt"), "one\n").unwrap();
        commit("base");
        let base = run(&["rev-parse", "HEAD"]);
        let now = chrono::Utc::now().timestamp();
        let path = root.to_str().unwrap();
        let ended = |at: i64| {
            chrono::DateTime::from_timestamp(at, 0)
                .unwrap()
                .to_rfc3339()
        };

        assert_eq!(ended_in_place(path, path, None), None);
        assert_eq!(ended_in_place(path, "/elsewhere", Some(&ended(now))), None);
        assert_eq!(ended_in_place(path, path, Some(&ended(now))), Some(now));

        std::fs::write(root.join("a.txt"), "two\n").unwrap();
        assert!(!moved_since(&root, &base, now - 60));
        commit("after the attempt");
        // A commit before the attempt ended is its own; one after it is later work.
        assert!(!moved_since(&root, &base, now + 60));
        assert!(moved_since(&root, &base, now - 60));
        std::fs::remove_dir_all(&root).unwrap();
    }
}
