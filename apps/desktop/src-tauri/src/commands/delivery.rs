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

/// Checks a pull request's title and description before anything reaches GitHub.
fn pull_request_text(title: &str, body: &str) -> Result<(String, String), String> {
    let title = title.trim();
    if title.is_empty() || title.contains('\n') || title.chars().count() > 256 {
        return Err("Write a one-line pull request title under 256 characters.".into());
    }
    let body = body.trim();
    if body.chars().count() > 60_000 {
        return Err("Shorten the pull request description.".into());
    }
    Ok((title.into(), body.into()))
}

/// The pull request URL `gh pr create` prints on its last line.
fn created_url(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with("https://"))
        .map(String::from)
}

/// Opens a pull request for a task's pushed branch through the person's GitHub
/// CLI. The branch must already be committed and pushed; this never commits,
/// pushes or merges, and Git and GitHub never prompt.
#[tauri::command]
pub async fn task_pull_request_create(
    id: String,
    title: String,
    body: String,
    draft: bool,
    state: State<'_, TaskRuntime>,
) -> Result<String, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (title, body) = pull_request_text(&title, &body)?;
        let runs = runtime.integration_runs()?;
        let run = runs
            .iter()
            .find(|run| run.id == id)
            .ok_or("Task not found")?;
        if ["starting", "running", "stopping"].contains(&run.status.as_str()) {
            return Err("Wait for the agent to finish before opening a pull request.".into());
        }
        let path = Path::new(&run.workspace);
        let branch = git(path, &["branch", "--show-current"])?;
        if branch.is_empty() {
            return Err("Check out the task branch before opening a pull request.".into());
        }
        let mut command = Command::new("gh");
        command
            .current_dir(path)
            .args(["pr", "create", "--head", &branch, "--title", &title, "--body-file", "-"])
            .env("GH_PROMPT_DISABLED", "1")
            .env("GIT_TERMINAL_PROMPT", "0");
        if let Some(base) = run.target_branch.as_deref().filter(|base| !base.is_empty()) {
            command.args(["--base", base]);
        }
        if draft {
            command.arg("--draft");
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let result = process_control::run_with_input(command, Duration::from_secs(60), body.into_bytes())?;
        if !result.success {
            let detail = result.stderr.trim();
            return Err(if detail.is_empty() {
                "GitHub CLI could not open the pull request. Check that it is installed and signed in.".into()
            } else {
                format!("GitHub CLI could not open the pull request: {}", detail.chars().take(2000).collect::<String>())
            });
        }
        created_url(&result.stdout)
            .ok_or_else(|| "The pull request was created, but GitHub CLI did not print its address.".into())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pull_request_text_and_url_are_checked() {
        assert!(pull_request_text("", "body").is_err());
        assert!(pull_request_text("two\nlines", "").is_err());
        assert_eq!(
            pull_request_text("  Add search  ", " body ").unwrap(),
            ("Add search".into(), "body".into())
        );
        assert_eq!(
            created_url("Creating pull request\nhttps://github.com/o/r/pull/7\n").as_deref(),
            Some("https://github.com/o/r/pull/7")
        );
        assert_eq!(created_url("warning only"), None);
    }

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
