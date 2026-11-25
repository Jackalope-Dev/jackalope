use super::{
    integration, process_control,
    repo::{self, Policy},
    source_control::{self, bitbucket, gitlab, Route},
    tasks::TaskRuntime,
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

/// Reads the checkout with a time limit, since delivery status is polled.
fn read(path: &Path, args: &[&str]) -> Result<String, String> {
    let result = process_control::run(
        repo::command(path, args, Policy::Inspection),
        Duration::from_secs(10),
    )?;
    if !result.success {
        return Err("Could not inspect this Git workspace. Confirm it is still available.".into());
    }
    Ok(result.stdout.trim().into())
}

/// What Jackalope reads about a pull request: identity, state, review and checks.
const PULL_REQUEST_FIELDS: &str =
    "number,title,url,state,isDraft,headRefOid,reviewDecision,mergeable,statusCheckRollup";

/// A GitHub CLI call that never prompts.
fn gh(path: &Path, args: &[&str]) -> Command {
    let mut command = Command::new("gh");
    command
        .current_dir(path)
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GIT_TERMINAL_PROMPT", "0");
    process_control::hidden(&mut command);
    command
}

/// Reads a pull request through the person's GitHub CLI: the one named by `url`, or the
/// checked-out branch's. `None` when there is none to read or GitHub could not be reached.
fn view_pull_request(path: &Path, url: Option<&str>) -> Result<Option<Value>, String> {
    let mut args = vec!["pr", "view"];
    args.extend(url);
    args.extend(["--json", PULL_REQUEST_FIELDS]);
    let Ok(result) = process_control::run(gh(path, &args), Duration::from_secs(15)) else {
        return Ok(None);
    };
    if !result.success {
        return Ok(None);
    }
    match serde_json::from_str::<Value>(&result.stdout) {
        Ok(value)
            if value["url"]
                .as_str()
                .is_some_and(|url| url.starts_with("https://")) =>
        {
            Ok(Some(value))
        }
        _ => Err("GitHub returned an unreadable PR record. Retry the check.".into()),
    }
}

/// Whether `url` is a pull request address, so nothing else reaches the GitHub CLI.
fn pull_request_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let parts: Vec<_> = rest.trim_end_matches('/').split('/').collect();
    parts.len() == 5
        && parts[3] == "pull"
        && parts[4].parse::<u64>().is_ok_and(|number| number > 0)
        && parts[..3].iter().all(|part| {
            !part.is_empty()
                && !part.starts_with('-')
                && part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        })
}

/// The task checkout the GitHub CLI runs in, or the project once the workspace is gone.
fn checkout<'a>(workspace: &'a str, project: &'a str) -> &'a Path {
    if !workspace.is_empty() && Path::new(workspace).is_dir() {
        Path::new(workspace)
    } else {
        Path::new(project)
    }
}

fn inspect(path: &Path, remote: bool) -> Result<DeliveryStatus, String> {
    let head = read(path, &["rev-parse", "--verify", "HEAD"])?;
    let branch = read(path, &["branch", "--show-current"])?;
    let changed = !read(path, &["status", "--porcelain", "--untracked-files=normal"])?.is_empty();
    let upstream = read(
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
        read(
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
        match view_pull_request(path, None) {
            Ok(Some(value)) => {
                status.pull_request = Some(value);
                status.remote_note = "PR and CI read through your GitHub CLI. Deployment has not been verified.".into();
            },
            Ok(None) => status.remote_note = "No PR could be read. Check GitHub CLI installation, sign-in, network and the current branch's PR, then retry.".into(),
            Err(error) => status.remote_note = error,
        }
    }
    Ok(status)
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::delivery::task_delivery_status,
            commands::delivery::task_pull_request_create,
            commands::delivery::task_pull_request_target,
            commands::delivery::task_pull_request_status,
            commands::delivery::task_pull_request_merge,
            commands::delivery::task_merge_locally,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[tauri::command]
pub async fn task_delivery_status(
    id: String,
    project: bool,
    remote: bool,
    state: State<'_, TaskRuntime>,
) -> Result<DeliveryStatus, String> {
    let runtime = state.inner().clone();
    let integration = runtime.integration_directory();
    let (status, bitbucket_route) = tauri::async_runtime::spawn_blocking(move || {
        let runs = runtime.integration_runs()?;
        let run = runs
            .iter()
            .find(|run| run.id == id)
            .ok_or("Task not found")?;
        let path = Path::new(if project {
            &run.project_path
        } else {
            &run.workspace
        });
        let route = if remote {
            source_control::route(&integration, path, &run.project_path)
        } else {
            Route::GitHub
        };
        match route {
            Route::GitHub => inspect(path, remote).map(|status| (status, None)),
            Route::GitLab(repository) => {
                let mut status = inspect(path, false)?;
                match gitlab::find_for_branch(path, &repository, &status.branch) {
                    Ok(Some(view)) => {
                        status.pull_request = Some(view.json());
                        status.remote_note = "Merge request and pipeline read through your GitLab CLI. Deployment has not been verified.".into();
                    }
                    Ok(None) => {
                        status.remote_note = format!(
                            "GitLab has no merge request from {} in {}.",
                            status.branch, repository.path
                        )
                    }
                    Err(error) => status.remote_note = error,
                }
                Ok((status, None))
            }
            Route::Bitbucket(repository) => Ok((inspect(path, false)?, Some(repository))),
        }
    })
    .await
    .map_err(|error| error.to_string())??;
    let mut status = status;
    if let Some(repository) = bitbucket_route {
        let found = match bitbucket::require(&state.integration_directory()) {
            Ok(credentials) => {
                bitbucket::find_for_branch(&credentials, &repository, &status.branch).await
            }
            Err(error) => Err(error),
        };
        match found {
            Ok(Some(view)) => {
                status.pull_request = Some(view.json());
                status.remote_note = "Pull request and build statuses read from Bitbucket with your API token. Deployment has not been verified.".into();
            }
            Ok(None) => {
                status.remote_note = format!(
                    "Bitbucket has no pull request from {} in {}.",
                    status.branch, repository.path
                )
            }
            Err(error) => status.remote_note = error,
        }
    }
    Ok(status)
}

/// Checks a pull request's title and description before anything reaches GitHub.
fn pull_request_text(title: &str, body: &str) -> Result<(String, String), String> {
    change_request_text(title, body, "pull request")
}

/// [`pull_request_text`] in the host's own word: "merge request" on GitLab.
fn change_request_text(title: &str, body: &str, noun: &str) -> Result<(String, String), String> {
    let title = title.trim();
    if title.is_empty() || title.contains('\n') || title.chars().count() > 256 {
        return Err(format!(
            "Write a one-line {noun} title under 256 characters."
        ));
    }
    let body = body.trim();
    if body.chars().count() > 60_000 {
        return Err(format!("Shorten the {noun} description."));
    }
    Ok((title.into(), body.into()))
}

/// What a route calls its change requests.
fn noun(route: &Route) -> &'static str {
    match route {
        Route::GitLab(_) => "merge request",
        _ => "pull request",
    }
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

/// What opening a change request led to: its address, or the Bitbucket request
/// still to send once Git has been read.
enum Created {
    Done(String),
    Bitbucket {
        repository: source_control::remote::Repository,
        branch: String,
        target: Option<String>,
        title: String,
        body: String,
    },
}

/// Opens a pull request for a task's pushed branch through the person's GitHub
/// CLI, or a merge request through the GitLab CLI or a Bitbucket pull request
/// through the Bitbucket API when the task's remote is there. The branch must
/// already be committed and pushed; this never commits, pushes or merges, and
/// nothing prompts.
#[tauri::command]
pub async fn task_pull_request_create(
    id: String,
    title: String,
    body: String,
    draft: bool,
    in_fork: Option<bool>,
    state: State<'_, TaskRuntime>,
) -> Result<String, String> {
    let runtime = state.inner().clone();
    let created = tauri::async_runtime::spawn_blocking(move || {
        let runs = runtime.integration_runs()?;
        let run = runs
            .iter()
            .find(|run| run.id == id)
            .ok_or("Task not found")?;
        let path = Path::new(&run.workspace);
        let route = source_control::route(&runtime.integration_directory(), path, &run.project_path);
        let noun = noun(&route);
        let (title, body) = change_request_text(&title, &body, noun)?;
        if run.status.is_active() {
            return Err(format!("Wait for the agent to finish before opening a {noun}."));
        }
        let branch = read(path, &["branch", "--show-current"])?;
        if branch.is_empty() {
            return Err(format!("Check out the task branch before opening a {noun}."));
        }
        match route {
            Route::GitHub => {}
            Route::GitLab(repository) => {
                return gitlab::create(
                    path,
                    &repository,
                    &branch,
                    run.target_branch.as_deref(),
                    in_fork.unwrap_or(false),
                    &title,
                    &body,
                    draft,
                )
                .map(Created::Done)
            }
            Route::Bitbucket(repository) => {
                return Ok(Created::Bitbucket {
                    repository,
                    branch,
                    target: run.target_branch.clone(),
                    title,
                    body,
                })
            }
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
        process_control::hidden(&mut command);
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
            .map(Created::Done)
            .ok_or_else(|| "The pull request was created, but GitHub CLI did not print its address.".into())
    })
    .await
    .map_err(|error| error.to_string())??;
    match created {
        Created::Done(url) => Ok(url),
        Created::Bitbucket {
            repository,
            branch,
            target,
            title,
            body,
        } => {
            let credentials = bitbucket::require(&state.integration_directory())?;
            bitbucket::create(
                &credentials,
                &repository,
                &branch,
                target.as_deref(),
                &title,
                &body,
                draft,
            )
            .await
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestTarget {
    host: String,
    /// The repository the change request opens in.
    repository: String,
    /// The branch it merges into; `None` when the host picks its default.
    branch: Option<String>,
    /// Whether the task's remote is a fork and the target is the project it came from.
    forked: bool,
    /// The fork itself, when `forked`.
    fork: Option<String>,
}

/// Where Create would open a GitLab merge request or Bitbucket pull request, for the
/// confirmation. Read-only. `None` for GitHub, whose CLI chooses as it always has.
#[tauri::command]
pub async fn task_pull_request_target(
    id: String,
    in_fork: Option<bool>,
    state: State<'_, TaskRuntime>,
) -> Result<Option<ChangeRequestTarget>, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let runs = runtime.integration_runs()?;
        let run = runs
            .iter()
            .find(|run| run.id == id)
            .ok_or("Task not found")?;
        let path = checkout(&run.workspace, &run.project_path);
        let target = run
            .target_branch
            .as_deref()
            .filter(|branch| !branch.is_empty());
        Ok(
            match source_control::route(&runtime.integration_directory(), path, &run.project_path) {
                Route::GitHub => None,
                Route::GitLab(repository) => {
                    let chosen =
                        gitlab::target(path, &repository, target, in_fork.unwrap_or(false))?;
                    Some(ChangeRequestTarget {
                        host: repository.host.clone(),
                        repository: chosen.path.clone(),
                        branch: Some(chosen.branch.clone()),
                        forked: chosen.forked,
                        fork: chosen.forked.then(|| repository.path.clone()),
                    })
                }
                Route::Bitbucket(repository) => Some(ChangeRequestTarget {
                    host: repository.host,
                    repository: repository.path,
                    branch: target.map(String::from),
                    forked: false,
                    fork: None,
                }),
            },
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Reads a task's tracked pull request, its review state and its checks. Read-only.
#[tauri::command]
pub async fn task_pull_request_status(
    id: String,
    url: String,
    state: State<'_, TaskRuntime>,
) -> Result<Value, String> {
    let (route, number) = source_control::route_url(&url);
    let runtime = state.inner().clone();
    let integration = runtime.integration_directory();
    let route = tauri::async_runtime::spawn_blocking(move || {
        if route == Route::GitHub && !pull_request_url(&url) {
            return Err("This is not a pull request address.".into());
        }
        let runs = runtime.integration_runs()?;
        let run = runs
            .iter()
            .find(|run| run.id == id)
            .ok_or("Task not found")?;
        let path = checkout(&run.workspace, &run.project_path);
        match route {
            Route::GitHub => view_pull_request(path, Some(&url))?
                .ok_or_else(|| {
                    "The pull request could not be read. Check GitHub CLI sign-in and network."
                        .into()
                })
                .map(Ok),
            Route::GitLab(repository) => {
                source_control::check_gitlab_host(
                    &integration,
                    path,
                    &run.project_path,
                    &repository,
                    false,
                )?;
                gitlab::view(path, &repository, number).map(|view| Ok(view.json()))
            }
            Route::Bitbucket(repository) => Ok(Err(repository)),
        }
    })
    .await
    .map_err(|error| error.to_string())??;
    match route {
        Ok(view) => Ok(view),
        Err(repository) => {
            let credentials = bitbucket::require(&state.integration_directory())?;
            Ok(bitbucket::view(&credentials, &repository, number)
                .await?
                .json())
        }
    }
}

/// Merges a task's pull request on GitHub through the person's GitHub CLI, with the
/// method they chose. GitHub enforces the repository's own rules; nothing local changes.
/// A GitLab merge request or Bitbucket pull request merges through its host the same
/// way, under that host's own pipeline, approval and merge-check rules, and only at
/// `head`, the commit the person saw when they confirmed. GitHub ignores `head`.
#[tauri::command]
pub async fn task_pull_request_merge(
    id: String,
    url: String,
    method: String,
    head: Option<String>,
    state: State<'_, TaskRuntime>,
) -> Result<(), String> {
    let (route, number) = source_control::route_url(&url);
    let head = match head
        .map(|head| head.trim().to_string())
        .filter(|head| !head.is_empty() && route != Route::GitHub)
    {
        Some(head) if !commit_id(&head) => {
            return Err("The commit to merge could not be read. Check again, then merge.".into())
        }
        head => head,
    };
    let pinned = head.clone();
    let runtime = state.inner().clone();
    let integration = runtime.integration_directory();
    let chosen = method.clone();
    let strategy = method.clone();
    let bitbucket_route = tauri::async_runtime::spawn_blocking(move || {
        if route == Route::GitHub && !pull_request_url(&url) {
            return Err("This is not a pull request address.".into());
        }
        let method = match (&route, method.as_str()) {
            (Route::GitHub, "merge") => "--merge",
            (Route::GitHub, "squash") => "--squash",
            (Route::GitHub, "rebase") => "--rebase",
            (Route::GitHub, _) => return Err("Choose merge, squash or rebase.".into()),
            _ => "",
        };
        let runs = runtime.integration_runs()?;
        let run = runs
            .iter()
            .find(|run| run.id == id)
            .ok_or("Task not found")?;
        let path = checkout(&run.workspace, &run.project_path);
        match route {
            Route::GitHub => {}
            Route::GitLab(repository) => {
                source_control::check_gitlab_host(
                    &integration,
                    path,
                    &run.project_path,
                    &repository,
                    true,
                )?;
                return gitlab::merge(path, &repository, number, &chosen, head.as_deref())
                    .map(|()| None);
            }
            Route::Bitbucket(repository) => return Ok(Some(repository)),
        }
        let command = gh(path, &["pr", "merge", &url, method]);
        let result = process_control::run(command, Duration::from_secs(60))?;
        if !result.success {
            let detail = result.stderr.trim();
            return Err(if detail.is_empty() {
                "GitHub CLI could not merge the pull request. Check that it is installed and signed in.".into()
            } else {
                format!(
                    "GitHub did not merge the pull request: {}",
                    detail.chars().take(2000).collect::<String>()
                )
            });
        }
        Ok(None)
    })
    .await
    .map_err(|error| error.to_string())??;
    if let Some(repository) = bitbucket_route {
        let credentials = bitbucket::require(&state.integration_directory())?;
        bitbucket::merge(
            &credentials,
            &repository,
            number,
            &strategy,
            pinned.as_deref(),
        )
        .await?;
    }
    Ok(())
}

/// A full or abbreviated Git commit ID.
fn commit_id(value: &str) -> bool {
    (7..=64).contains(&value.len()) && value.bytes().all(|c| c.is_ascii_hexdigit())
}

/// Runs a Git command that changes the checkout, reporting Git's own message on failure.
pub(super) fn change(path: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = repo::command(path, args, Policy::Isolated);
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
    if read(path, &["branch", "--show-current"])? != branch {
        return Err(format!(
            "Check out {branch} in the project before merging it."
        ));
    }
    if !read(path, &["status", "--porcelain", "--untracked-files=normal"])?.is_empty() {
        return Err("Commit or discard the remaining changes before merging.".into());
    }
    let target_ref = format!("refs/heads/{target}");
    if read(path, &["rev-parse", "--verify", "--quiet", &target_ref]).is_err() {
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
    read(path, &["rev-parse", "--verify", "HEAD"])
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
        assert_eq!(
            pull_request_text("", "body").unwrap_err(),
            "Write a one-line pull request title under 256 characters."
        );
        assert_eq!(
            change_request_text(
                "a\nb",
                "",
                noun(&Route::GitLab(source_control::remote::Repository {
                    host: "gitlab.com".into(),
                    path: "a/b".into()
                }))
            )
            .unwrap_err(),
            "Write a one-line merge request title under 256 characters."
        );
        assert_eq!(noun(&Route::GitHub), "pull request");
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
        assert!(pull_request_url("https://github.com/o/r/pull/7"));
        assert!(pull_request_url(
            "https://github.example.com/o/r.git/pull/7/"
        ));
        for url in [
            "http://github.com/o/r/pull/7",
            "https://github.com/o/r/pull/0",
            "https://github.com/o/r/issues/7",
            "https://github.com/o/r/pull/7/files",
            "https://github.com/--flag/r/pull/7",
            "https://github.com/o/r/pull/7 --admin",
        ] {
            assert!(!pull_request_url(url), "{url}");
        }
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
        assert_eq!(read(path, &["branch", "--show-current"]).unwrap(), "task");
        assert!(read(path, &["status", "--porcelain"]).unwrap().is_empty());

        change(path, &["switch", "-q", "main"]).unwrap();
        change(path, &["reset", "-q", "--hard", "HEAD~1"]).unwrap();
        change(path, &["switch", "-q", "task"]).unwrap();
        let head = merge_into(path, "task", "main").unwrap();
        assert_eq!(read(path, &["branch", "--show-current"]).unwrap(), "main");
        assert_eq!(read(path, &["rev-parse", "main"]).unwrap(), head);
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
        read(path, &["init"]).unwrap();
        read(
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
        assert_eq!(read(path, &["rev-parse", "HEAD"]).unwrap(), clean.head);
        std::fs::remove_dir_all(temp).unwrap();
    }
}
