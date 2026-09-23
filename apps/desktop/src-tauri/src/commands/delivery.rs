use super::{process_control, tasks::TaskRuntime, worktree_cleanup};
use serde::Serialize;
use serde_json::Value;
use std::{path::Path, process::Command, time::Duration};
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryStatus {
    head: String,
    branch: String,
    changed: bool,
    upstream: Option<String>,
    ahead: Option<u64>,
    behind: Option<u64>,
    pull_request: Option<Value>,
    remote_note: String,
    checked_at: String,
}

fn git(path: &Path, args: &[&str]) -> Result<String, String> {
    let result = process_control::run(
        worktree_cleanup::command(path, args),
        Duration::from_secs(10),
    )?;
    if !result.success {
        return Err("Could not inspect this Git workspace. Confirm it is still available.".into());
    }
    Ok(result.stdout.trim().into())
}

fn inspect(path: &Path, remote: bool) -> Result<DeliveryStatus, String> {
    let head = git(path, &["rev-parse", "--verify", "HEAD"])?;
    let branch = git(path, &["branch", "--show-current"])?;
    let changed = !git(path, &["status", "--porcelain", "--untracked-files=normal"])?.is_empty();
    let upstream = git(
        path,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .ok();
    let counts = if upstream.is_some() {
        git(
            path,
            &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        )
        .ok()
    } else {
        None
    };
    let counts: Vec<_> = counts
        .as_deref()
        .unwrap_or("")
        .split_whitespace()
        .filter_map(|value| value.parse::<u64>().ok())
        .collect();
    let mut status = DeliveryStatus {
        head,
        branch,
        changed,
        upstream,
        ahead: counts.first().copied(),
        behind: counts.get(1).copied(),
        pull_request: None,
        remote_note: "Remote PR and CI not checked. Upstream counts use local Git references."
            .into(),
        checked_at: chrono::Utc::now().to_rfc3339(),
    };
    if remote {
        let mut command = Command::new("gh");
        command
            .current_dir(path)
            .args([
                "pr",
                "view",
                "--json",
                "url,state,headRefOid,statusCheckRollup",
            ])
            .env("GH_PROMPT_DISABLED", "1")
            .env("GIT_TERMINAL_PROMPT", "0");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        match process_control::run(command, Duration::from_secs(15)) {
            Ok(result) if result.success => {
                match serde_json::from_str::<Value>(&result.stdout) {
                    Ok(value) if value["url"].as_str().is_some_and(|url| url.starts_with("https://")) => {
                        status.pull_request = Some(value);
                        status.remote_note = "PR and CI read through your GitHub CLI. Deployment has not been verified.".into();
                    },
                    _ => status.remote_note = "GitHub returned an unreadable PR record. Retry the check.".into(),
                }
            },
            _ => status.remote_note = "No PR could be read. Check GitHub CLI installation, sign-in, network and the current branch's PR, then retry.".into(),
        }
    }
    Ok(status)
}

#[tauri::command]
pub async fn task_delivery_status(
    id: String,
    project: bool,
    remote: bool,
    state: State<'_, TaskRuntime>,
) -> Result<DeliveryStatus, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let runs = runtime.integration_runs()?;
        let run = runs
            .iter()
            .find(|run| run.id == id)
            .ok_or("Task not found")?;
        inspect(
            Path::new(if project {
                &run.project_path
            } else {
                &run.workspace
            }),
            remote,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inspection_distinguishes_local_changes_and_missing_upstream() {
        let temp =
            std::env::temp_dir().join(format!("jackalope-delivery-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&temp).unwrap();
        let path = temp.as_path();
        git(path, &["init"]).unwrap();
        git(
            path,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "Base",
            ],
        )
        .unwrap();
        let clean = inspect(path, false).unwrap();
        assert!(!clean.changed);
        assert!(clean.upstream.is_none());
        assert!(clean.ahead.is_none());
        assert!(clean.pull_request.is_none());
        std::fs::write(path.join("work.txt"), "local work").unwrap();
        assert!(inspect(path, false).unwrap().changed);
        assert_eq!(git(path, &["rev-parse", "HEAD"]).unwrap(), clean.head);
        assert_eq!(temp.parent(), Some(std::env::temp_dir().as_path()));
        assert!(temp
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("jackalope-delivery-"));
        std::fs::remove_dir_all(temp).unwrap();
    }
}
