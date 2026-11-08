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
        .map(|run| (run.id, run.workspace, run.base_head))
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        runs.into_iter()
            .filter_map(|(id, workspace, base)| {
                stats(Path::new(&workspace), &base).map(|stats| (id, stats))
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
}
