//! Compact per-task change counts for work lists, without loading full diffs.

use super::git_command::{command, Policy};
use super::tasks::TaskRuntime;
use serde::Serialize;
use std::{collections::HashMap, io::Read, path::Path};
use tauri::State;

const MAX_IDS: usize = 200;
const MAX_UNTRACKED: usize = 200;
const UNTRACKED_READ_LIMIT: u64 = 1024 * 1024;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct ChangeStats {
    pub files: usize,
    pub added: usize,
    pub removed: usize,
}

fn git(path: &Path, args: &[&str]) -> Option<Vec<u8>> {
    let output = command(path, args, Policy::Inspection).output().ok()?;
    output.status.success().then_some(output.stdout)
}

/// Lines changed in `workspace` since `base`, counting new untracked files as added.
fn stats(workspace: &Path, base: &str) -> Option<ChangeStats> {
    if base.is_empty() || !workspace.is_dir() {
        return None;
    }
    let mut result = ChangeStats::default();
    let numstat = git(
        workspace,
        &["diff", "--numstat", "-z", "--no-renames", base, "--"],
    )?;
    for entry in numstat
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
    {
        let text = String::from_utf8_lossy(entry);
        let mut fields = text.split('\t');
        // Binary files report "-" for both counts; they still count as a changed file.
        let added = fields.next().and_then(|value| value.parse::<usize>().ok());
        let removed = fields.next().and_then(|value| value.parse::<usize>().ok());
        result.files += 1;
        result.added += added.unwrap_or(0);
        result.removed += removed.unwrap_or(0);
    }
    let untracked = git(
        workspace,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    )?;
    for name in untracked
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .take(MAX_UNTRACKED)
    {
        result.files += 1;
        let path = workspace.join(String::from_utf8_lossy(name).as_ref());
        let mut data = Vec::new();
        if std::fs::File::open(path)
            .and_then(|file| file.take(UNTRACKED_READ_LIMIT).read_to_end(&mut data))
            .is_ok()
            && !data.contains(&0)
        {
            result.added += data.iter().filter(|byte| **byte == b'\n').count()
                + usize::from(!data.is_empty() && !data.ends_with(b"\n"));
        }
    }
    Some(result)
}

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
            assert!(command(&root, args, Policy::Isolated)
                .output()
                .unwrap()
                .status
                .success())
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
        let base = String::from_utf8(git(&root, &["rev-parse", "HEAD"]).unwrap())
            .unwrap()
            .trim()
            .to_string();
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
