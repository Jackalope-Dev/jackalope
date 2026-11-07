use super::{
    git_command::{command as git_command, Policy},
    integration, process_control,
    tasks::TaskRuntime,
    worktree_cleanup,
};
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
        process_control::hide_window(&mut command);
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
        if run.status.is_active() {
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
        process_control::hide_window(&mut command);
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

/// Runs a Git command that changes the checkout, reporting Git's own message on failure.
fn change(path: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = git_command(path, args, Policy::Isolated);
    command
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_MERGE_AUTOEDIT", "no");
    let result = process_control::run(command, Duration::from_secs(120))?;
    if result.timed_out {
        return Err(format!("git {} took too long and was stopped.", args[0]));
    }
    if !result.success {
        let detail = format!("{}\n{}", result.stderr.trim(), result.stdout.trim());
        return Err(detail.trim().chars().take(2000).collect());
    }
    Ok(result.stdout.trim().into())
}

/// Merges `branch` into `target` in a checkout that has `branch` checked out, leaving
/// `target` checked out. A conflicting or failed merge is undone and `branch` is checked
/// out again, so the checkout ends where it started.
fn merge_into(path: &Path, branch: &str, target: &str) -> Result<String, String> {
    if git(path, &["branch", "--show-current"])? != branch {
        return Err(format!(
            "Check out {branch} in the project before merging it."
        ));
    }
    if !git(path, &["status", "--porcelain", "--untracked-files=normal"])?.is_empty() {
        return Err("Commit or discard the remaining changes before merging.".into());
    }
    let target_ref = format!("refs/heads/{target}");
    if git(path, &["rev-parse", "--verify", "--quiet", &target_ref]).is_err() {
        return Err(format!("There is no local {target} branch to merge into."));
    }
    change(path, &["switch", target])?;
    if let Err(error) = change(path, &["merge", "--no-ff", "--no-edit", branch]) {
        let _ = change(path, &["merge", "--abort"]);
        let _ = change(path, &["switch", branch]);
        return Err(format!(
            "{branch} could not be merged into {target}, so nothing changed. {error}"
        ));
    }
    git(path, &["rev-parse", "--verify", "HEAD"])
}

/// Merges a task that worked on its own branch in the project checkout into the project's
/// target branch locally. Nothing is pushed.
#[tauri::command]
pub async fn task_merge_locally(
    id: String,
    target: String,
    state: State<'_, TaskRuntime>,
) -> Result<String, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let target = target.trim();
        if target.is_empty() || target.starts_with('-') {
            return Err("Choose a branch to merge into.".into());
        }
        let _guard = integration::execution_guard()?;
        let runs = runtime.integration_runs()?;
        let run = runs
            .iter()
            .find(|run| run.id == id)
            .ok_or("Task not found")?;
        if runs
            .iter()
            .any(|other| other.workspace == run.workspace && other.status.is_active())
        {
            return Err("Wait for work in this checkout to finish before merging.".into());
        }
        if run.workspace.is_empty() || run.branch.is_empty() || run.branch == target {
            return Err(format!(
                "This task has no separate branch to merge into {target}."
            ));
        }
        merge_into(Path::new(&run.workspace), &run.branch, target)
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
    fn local_merge_lands_on_the_target_or_leaves_the_checkout_as_it_was() {
        let temp =
            std::env::temp_dir().join(format!("jackalope-local-merge-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&temp).unwrap();
        let path = temp.as_path();
        let commit = |message: &str| {
            change(
                path,
                &[
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@example.invalid",
                    "commit",
                    "-qam",
                    message,
                ],
            )
            .unwrap();
        };
        change(path, &["init", "-q", "-b", "main"]).unwrap();
        // merge_into makes its own merge commit, so the repository needs an identity on
        // machines without a global one, such as CI runners.
        change(path, &["config", "user.name", "Test"]).unwrap();
        change(path, &["config", "user.email", "test@example.invalid"]).unwrap();
        // Windows runners check files out with CRLF, which would change the contents read back.
        change(path, &["config", "core.autocrlf", "false"]).unwrap();
        std::fs::write(path.join("a.txt"), "base\n").unwrap();
        change(path, &["add", "a.txt"]).unwrap();
        commit("Base");
        change(path, &["switch", "-q", "-c", "task"]).unwrap();
        std::fs::write(path.join("a.txt"), "task\n").unwrap();
        commit("Task");

        std::fs::write(path.join("a.txt"), "dirty\n").unwrap();
        assert!(merge_into(path, "task", "main")
            .unwrap_err()
            .contains("remaining changes"));
        change(path, &["checkout", "--", "a.txt"]).unwrap();
        assert!(merge_into(path, "task", "missing")
            .unwrap_err()
            .contains("no local missing"));

        change(path, &["switch", "-q", "main"]).unwrap();
        std::fs::write(path.join("a.txt"), "main\n").unwrap();
        commit("Main");
        change(path, &["switch", "-q", "task"]).unwrap();
        let error = merge_into(path, "task", "main").unwrap_err();
        assert!(error.contains("nothing changed"), "{error}");
        assert_eq!(git(path, &["branch", "--show-current"]).unwrap(), "task");
        assert!(git(path, &["status", "--porcelain"]).unwrap().is_empty());

        change(path, &["switch", "-q", "main"]).unwrap();
        change(path, &["reset", "-q", "--hard", "HEAD~1"]).unwrap();
        change(path, &["switch", "-q", "task"]).unwrap();
        let head = merge_into(path, "task", "main").unwrap();
        assert_eq!(git(path, &["branch", "--show-current"]).unwrap(), "main");
        assert_eq!(git(path, &["rev-parse", "main"]).unwrap(), head);
        assert_eq!(
            std::fs::read_to_string(path.join("a.txt")).unwrap(),
            "task\n"
        );
        let _ = std::fs::remove_dir_all(temp);
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
