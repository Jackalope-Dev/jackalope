//! GitLab through the person's own GitLab CLI. Every request is `glab api` against
//! GitLab's REST API with an explicit `--hostname`, so the answers are GitLab's
//! documented JSON and glab's sign-in decides what the person may see and change.

use super::{
    super::{platform, process_control},
    bounded, encode, log_tail, Access, ChangeRequest, Check, HostKind,
};
use crate::commands::source_control::remote::Repository;
use serde_json::{json, Value};
use std::{
    path::Path,
    process::Command,
    sync::{Arc, Mutex},
    time::Duration,
};

/// Largest response read: a list of fifty issues with long descriptions fits.
const RESPONSE_LIMIT: usize = 4_000_000;
/// Characters kept from the end of each failed job's log.
const LOG_TAIL: usize = 2_500;
const FAILED_LOGS: usize = 3;
/// Pages of pipeline jobs read: five hundred jobs.
const JOB_PAGES: usize = 5;

#[derive(Debug, PartialEq)]
pub(crate) enum Failure {
    Missing,
    SignedOut(String),
    NotFound(String),
    Failed(String),
}

fn install_hint() -> &'static str {
    if cfg!(target_os = "macos") {
        "Install it with `brew install glab`"
    } else if cfg!(windows) {
        "Install it with `winget install GLab.GLab`"
    } else {
        "Install it from https://gitlab.com/gitlab-org/cli#installation"
    }
}

impl Failure {
    pub(crate) fn message(&self, host: &str) -> String {
        match self {
            Self::Missing => format!(
                "The GitLab CLI (glab) is not installed. {}, then run `glab auth login --hostname {host}`.",
                install_hint()
            ),
            Self::SignedOut(detail) => format!(
                "The GitLab CLI is not signed in to {host}. Run `glab auth login --hostname {host}`, then retry. glab said: {detail}"
            ),
            Self::NotFound(detail) => format!(
                "GitLab could not find this on {host}. Check the remote, and that glab is signed in to an account with access (`glab auth status --hostname {host}`). glab said: {detail}"
            ),
            Self::Failed(detail) => format!("GitLab: {detail}"),
        }
    }
}

/// GitLab's own words for a failed request: the response's `message` or `error`,
/// then glab's diagnostics.
fn detail(stdout: &str, stderr: &str) -> String {
    let body = serde_json::from_str::<Value>(stdout.trim()).ok();
    let from_body = body.as_ref().and_then(|body| {
        let value = body.get("message").or_else(|| body.get("error"))?;
        Some(match value {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        })
    });
    let stderr = stderr
        .lines()
        .map(|line| line.trim().trim_start_matches("glab:").trim())
        .filter(|line| !line.is_empty() && !line.chars().all(|c| c == '-' || c == ' '))
        .collect::<Vec<_>>()
        .join(" ");
    let text = match from_body {
        Some(body) if !stderr.contains(&body) => format!("{body} ({stderr})"),
        _ if !stderr.is_empty() => stderr,
        Some(body) => body,
        None => "glab exited without saying why.".into(),
    };
    bounded(text.trim(), 2_000).0
}

/// Sorts a failed glab call by what the person can do about it.
pub(crate) fn classify(stdout: &str, stderr: &str) -> Failure {
    let detail = detail(stdout, stderr);
    let lower = format!("{stdout}\n{stderr}").to_ascii_lowercase();
    if [
        "401",
        "unauthorized",
        "no token found",
        "glab auth login",
        "not authenticated",
        "authentication required",
        "invalid_token",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
        Failure::SignedOut(detail)
    } else if lower.contains("404") || lower.contains("not found") {
        Failure::NotFound(detail)
    } else {
        Failure::Failed(detail)
    }
}

enum Keep {
    /// The whole response, refused past [`RESPONSE_LIMIT`].
    All,
    /// The end of a log.
    Tail(usize),
}

fn glab(
    cwd: &Path,
    host: &str,
    args: &[&str],
    input: Option<Value>,
    keep: Keep,
) -> Result<String, Failure> {
    let program = platform::find_on_path("glab").ok_or(Failure::Missing)?;
    let mut command = Command::new(program);
    command
        .current_dir(cwd)
        .args(args)
        .env_remove("GITLAB_HOST")
        .env("NO_PROMPT", "1")
        .env("NO_COLOR", "1")
        .env("GLAB_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0");
    if !host.is_empty() {
        command.args(["--hostname", host]);
    }
    process_control::hidden(&mut command);
    let output = Arc::new(Mutex::new((Vec::<u8>::new(), false)));
    let sink = output.clone();
    let tail = match keep {
        Keep::All => None,
        Keep::Tail(bytes) => Some(bytes),
    };
    let input = input.map(|body| body.to_string().into_bytes());
    let result = process_control::run_observed(
        command,
        Duration::from_secs(45),
        input,
        move |bytes, stderr| {
            if stderr {
                return;
            }
            let mut output = sink.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            output.0.extend_from_slice(bytes);
            match tail {
                Some(keep) if output.0.len() > keep * 2 => {
                    let cut = output.0.len() - keep;
                    output.0.drain(..cut);
                }
                None if output.0.len() > RESPONSE_LIMIT => {
                    output.1 = true;
                    output.0.truncate(RESPONSE_LIMIT);
                }
                _ => {}
            }
        },
    )
    .map_err(Failure::Failed)?;
    let (bytes, too_large) = std::mem::take(
        &mut *output
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()),
    );
    let stdout = String::from_utf8_lossy(&bytes).into_owned();
    if let Some(interruption) = result.interruption() {
        return Err(Failure::Failed(format!("glab {interruption}.")));
    }
    if !result.success {
        return Err(classify(&stdout, &result.stderr));
    }
    if too_large {
        return Err(Failure::Failed("The response is too large to read.".into()));
    }
    Ok(stdout)
}

/// One GitLab REST request through `glab api`, with a JSON body on stdin for writes.
fn api(
    cwd: &Path,
    repository: &Repository,
    method: &str,
    endpoint: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let mut args = vec!["api", endpoint, "--method", method];
    if body.is_some() {
        // Older glab releases send `--input` without GitLab's required content type.
        args.extend(["--input", "-", "--header", "Content-Type: application/json"]);
    }
    let stdout = glab(cwd, &repository.host, &args, body, Keep::All)
        .map_err(|failure| failure.message(&repository.host))?;
    serde_json::from_str(&stdout)
        .map_err(|_| "GitLab returned an unreadable response. Retry.".into())
}

fn get(cwd: &Path, repository: &Repository, endpoint: &str) -> Result<Value, String> {
    api(cwd, repository, "GET", endpoint, None)
}

fn project(repository: &Repository) -> String {
    format!("projects/{}", encode(&repository.path))
}

/// Whether glab is installed and signed in to `host`, with what to do when it is not.
pub(crate) fn access(host: &str) -> Access {
    let Some(program) = platform::find_on_path("glab") else {
        return Access {
            state: "missing",
            message: Failure::Missing.message(host),
        };
    };
    let mut command = Command::new(program);
    command
        .args(["auth", "status", "--hostname", host])
        .env("NO_PROMPT", "1")
        .env("NO_COLOR", "1");
    process_control::hidden(&mut command);
    match process_control::run(command, Duration::from_secs(20)) {
        Ok(result) if result.success => Access {
            state: "ready",
            message: signed_in_as(&format!("{}\n{}", result.stdout, result.stderr))
                .map(|user| format!("Signed in to {host} as {user}."))
                .unwrap_or_else(|| format!("Signed in to {host}.")),
        },
        Ok(result) => Access {
            state: "signedOut",
            message: Failure::SignedOut(auth_problem(&format!(
                "{}\n{}",
                result.stdout, result.stderr
            )))
            .message(host),
        },
        Err(error) => Access {
            state: "error",
            message: error,
        },
    }
}

/// The account in `glab auth status` output ("Logged in to gitlab.com as ana").
fn signed_in_as(text: &str) -> Option<String> {
    let (_, rest) = text.split_once("Logged in to ")?;
    let (_, rest) = rest.split_once(" as ")?;
    rest.split_whitespace().next().map(String::from)
}

/// The line of `glab auth status` output that says what is wrong.
fn auth_problem(text: &str) -> String {
    text.lines()
        .map(|line| line.trim().trim_start_matches(['x', '!', '✓', '×']).trim())
        .find(|line| {
            let lower = line.to_ascii_lowercase();
            lower.contains("401") || lower.contains("token") || lower.contains("not logged")
        })
        .map(String::from)
        .unwrap_or_else(|| detail("", text))
}

fn text(value: &Value, field: &str) -> String {
    value[field].as_str().unwrap_or("").to_string()
}

fn job_check(job: &Value) -> Check {
    let (status, conclusion) = match job["status"].as_str().unwrap_or("") {
        "success" => ("COMPLETED", Some("SUCCESS")),
        "failed" if job["allow_failure"] == true => ("COMPLETED", Some("NEUTRAL")),
        "failed" => ("COMPLETED", Some("FAILURE")),
        "canceled" | "canceling" => ("COMPLETED", Some("CANCELLED")),
        "skipped" | "manual" => ("COMPLETED", Some("SKIPPED")),
        "created"
        | "pending"
        | "running"
        | "preparing"
        | "waiting_for_resource"
        | "waiting_for_callback"
        | "scheduled" => ("IN_PROGRESS", None),
        _ => ("COMPLETED", None),
    };
    Check {
        name: text(job, "name"),
        status,
        conclusion,
        link: job["web_url"].as_str().map(String::from),
    }
}

/// GitLab's reason a merge request cannot merge yet, when it is not one the
/// change request's own fields already show.
fn blocker(status: &str) -> Option<String> {
    let text = match status {
        ""
        | "mergeable"
        | "checking"
        | "unchecked"
        | "preparing"
        | "approvals_syncing"
        | "ci_must_pass"
        | "ci_still_running"
        | "conflict"
        | "need_rebase"
        | "draft_status"
        | "not_open"
        | "not_approved"
        | "requested_changes"
        | "discussions_not_resolved" => return None,
        "blocked_status" => "blocked by another merge request",
        "commits_status" => "its source branch has no commits or is missing",
        "external_status_checks" => "external status checks must pass",
        "jira_association_missing" => "the title or description must reference a Jira issue",
        "merge_request_blocked" => "blocked by a merge request dependency",
        "merge_time" => "scheduled to merge later",
        "security_policy_violations" => "security policy violations must be resolved",
        "locked_paths" | "locked_lfs_files" => "it changes locked files",
        "title_regex" => "the title does not match the project's required format",
        "status_checks_must_pass" => "status checks must pass",
        other => return Some(format!("GitLab reports {}", other.replace('_', " "))),
    };
    Some(format!("GitLab: {text}"))
}

/// A merge request from GitLab's REST API, its pipeline's jobs and its project,
/// in the shape the GitHub CLI reports a pull request.
pub(crate) fn normalize(
    mr: &Value,
    jobs: &[Value],
    project: &Value,
) -> Result<ChangeRequest, String> {
    let url = text(mr, "web_url");
    if !url.starts_with("https://") {
        return Err("GitLab returned a merge request without an address.".into());
    }
    let number = mr["iid"]
        .as_u64()
        .ok_or("GitLab returned a merge request without a number.")?;
    let detailed = mr["detailed_merge_status"].as_str().unwrap_or("");
    let state = match mr["state"].as_str().unwrap_or("") {
        "merged" => "MERGED",
        "closed" | "locked" => "CLOSED",
        _ => "OPEN",
    };
    let review_decision = match detailed {
        "requested_changes" | "discussions_not_resolved" => "CHANGES_REQUESTED",
        _ if mr["blocking_discussions_resolved"] == false => "CHANGES_REQUESTED",
        "not_approved" => "REVIEW_REQUIRED",
        _ => "",
    };
    let mergeable =
        if mr["has_conflicts"] == true || detailed == "conflict" || detailed == "need_rebase" {
            "CONFLICTING"
        } else if detailed == "mergeable"
            || (detailed.is_empty() && mr["merge_status"] == "can_be_merged")
        {
            "MERGEABLE"
        } else {
            "UNKNOWN"
        };
    let pipeline = &mr["head_pipeline"];
    let mut checks: Vec<Check> = jobs.iter().map(job_check).collect();
    if checks.is_empty() && pipeline.is_object() {
        // Only trigger jobs or child pipelines: the pipeline's own state stands for them.
        let mut check = job_check(
            &json!({"name": "Pipeline", "status": pipeline["status"], "web_url": pipeline["web_url"]}),
        );
        check.name = "Pipeline".into();
        checks.push(check);
    }
    let merge_methods = match project["squash_option"].as_str() {
        Some("never") => vec!["merge"],
        Some("always") => vec!["squash"],
        _ => vec!["merge", "squash"],
    };
    Ok(ChangeRequest {
        provider: HostKind::Gitlab,
        url,
        number,
        title: text(mr, "title"),
        state,
        is_draft: mr["draft"] == true || mr["work_in_progress"] == true,
        head_ref_oid: text(mr, "sha"),
        review_decision,
        mergeable,
        status_check_rollup: checks,
        pipeline: pipeline["id"].as_u64().map(|id| id.to_string()),
        blocker: if state == "OPEN" {
            blocker(detailed)
        } else {
            None
        },
        merge_methods,
    })
}

/// A pipeline's jobs, a hundred per page (GitLab's most), up to [`JOB_PAGES`] pages.
fn pipeline_jobs(
    cwd: &Path,
    repository: &Repository,
    pipeline: &str,
) -> Result<Vec<Value>, String> {
    let base = project(repository);
    let mut jobs = Vec::new();
    for page in 1..=JOB_PAGES {
        let rows = get(
            cwd,
            repository,
            &format!("{base}/pipelines/{pipeline}/jobs?per_page=100&page={page}"),
        )?;
        let rows = rows.as_array().cloned().unwrap_or_default();
        let full = rows.len() == 100;
        jobs.extend(rows);
        if !full {
            break;
        }
    }
    Ok(jobs)
}

/// Reads one merge request with its pipeline's jobs and the project's squash setting.
pub(crate) fn view(
    cwd: &Path,
    repository: &Repository,
    number: u64,
) -> Result<ChangeRequest, String> {
    let base = project(repository);
    let mr = get(cwd, repository, &format!("{base}/merge_requests/{number}"))?;
    let jobs = match mr["head_pipeline"]["id"].as_u64() {
        Some(id) => pipeline_jobs(cwd, repository, &id.to_string())?,
        None => Vec::new(),
    };
    // Only the squash setting comes from here; without it both methods are offered.
    let project = get(cwd, repository, &base).unwrap_or(Value::Null);
    normalize(&mr, &jobs, &project)
}

/// The merge request for `branch`: an open one first, then the most recently updated.
pub(crate) fn find_for_branch(
    cwd: &Path,
    repository: &Repository,
    branch: &str,
) -> Result<Option<ChangeRequest>, String> {
    // A fork's merge requests live in the project they target.
    let destination = target(cwd, repository, None, false)?;
    let into = destination.repository(repository);
    let base = project(&into);
    for state in ["opened", "all"] {
        let found = get(
            cwd,
            &into,
            &format!(
                "{base}/merge_requests?source_branch={}&state={state}&order_by=updated_at&per_page=20",
                encode(branch)
            ),
        )?;
        let number = found.as_array().and_then(|list| {
            list.iter()
                .find(|mr| mr["source_project_id"].as_u64() == Some(destination.source_id))
                .and_then(|mr| mr["iid"].as_u64())
        });
        if let Some(number) = number {
            return view(cwd, &into, number).map(Some);
        }
    }
    Ok(None)
}

/// Where a merge request from a project lands: the project it was forked from,
/// as glab and GitLab's own page choose, unless `in_fork`; otherwise the project itself.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Target {
    pub source_id: u64,
    pub project_id: u64,
    /// `group/name` of the target project.
    pub path: String,
    pub branch: String,
    pub forked: bool,
}

impl Target {
    pub(crate) fn repository(&self, source: &Repository) -> Repository {
        Repository {
            host: source.host.clone(),
            path: self.path.clone(),
        }
    }
}

/// Chooses the target from GitLab's record of the source project. GitLab names the
/// parent only when the person can read it; otherwise the fork itself is the target.
pub(crate) fn choose_target(
    project: &Value,
    requested: Option<&str>,
    in_fork: bool,
) -> Result<Target, String> {
    let source_id = project["id"]
        .as_u64()
        .ok_or("GitLab returned a project without an ID.")?;
    let parent = &project["forked_from_project"];
    let upstream = (!in_fork)
        .then(|| {
            Some((
                parent["id"].as_u64()?,
                parent["path_with_namespace"].as_str()?.to_string(),
                parent["default_branch"].as_str().unwrap_or("").to_string(),
            ))
        })
        .flatten();
    let (project_id, path, default, forked) = match upstream {
        Some((id, path, default)) => (id, path, default, true),
        None => (
            source_id,
            text(project, "path_with_namespace"),
            text(project, "default_branch"),
            false,
        ),
    };
    let branch = requested
        .filter(|branch| !branch.is_empty())
        .map(String::from)
        .or_else(|| (!default.is_empty()).then_some(default))
        .ok_or("GitLab reported no default branch. Set the task's target branch and retry.")?;
    if path.is_empty() {
        return Err("GitLab returned a project without its path.".into());
    }
    Ok(Target {
        source_id,
        project_id,
        path,
        branch,
        forked,
    })
}

pub(crate) fn target(
    cwd: &Path,
    repository: &Repository,
    requested: Option<&str>,
    in_fork: bool,
) -> Result<Target, String> {
    choose_target(
        &get(cwd, repository, &project(repository))?,
        requested,
        in_fork,
    )
}

/// GitLab marks a draft by its title.
pub(crate) fn draft_title(title: &str, draft: bool) -> String {
    let lower = title.to_ascii_lowercase();
    if !draft || lower.starts_with("draft:") || lower.starts_with("[draft]") {
        title.into()
    } else {
        format!("Draft: {title}")
    }
}

/// Opens a merge request from `branch`, which must already be pushed, into the
/// [`target`] project. Returns its address.
#[allow(clippy::too_many_arguments)]
pub(crate) fn create(
    cwd: &Path,
    repository: &Repository,
    branch: &str,
    requested: Option<&str>,
    in_fork: bool,
    title: &str,
    body: &str,
    draft: bool,
) -> Result<String, String> {
    let target = target(cwd, repository, requested, in_fork)?;
    let mut payload = json!({
        "source_branch": branch,
        "target_branch": target.branch,
        "title": draft_title(title, draft),
        "description": body,
    });
    if target.forked {
        payload["target_project_id"] = json!(target.project_id);
    }
    let created = api(
        cwd,
        repository,
        "POST",
        &format!("{}/merge_requests", project(repository)),
        Some(payload),
    )
    .map_err(|error| format!("The merge request was not opened. {error}"))?;
    created["web_url"]
        .as_str()
        .filter(|url| url.starts_with("https://"))
        .map(String::from)
        .ok_or_else(|| {
            "The merge request was opened, but GitLab did not return its address.".into()
        })
}

/// Merges a merge request now, pinned with GitLab's `sha` to `head`, the commit the
/// person saw when they confirmed (without one, the commit read just before merging).
/// GitLab refuses the merge when the branch has moved past it, and enforces the
/// project's pipeline, approval and discussion rules; nothing here bypasses them.
pub(crate) fn merge(
    cwd: &Path,
    repository: &Repository,
    number: u64,
    method: &str,
    head: Option<&str>,
) -> Result<(), String> {
    let squash = match method {
        "merge" => false,
        "squash" => true,
        _ => return Err("Choose merge or squash.".into()),
    };
    let base = project(repository);
    let mr = get(cwd, repository, &format!("{base}/merge_requests/{number}"))?;
    if mr["state"] != "opened" {
        return Err(format!("This merge request is {}.", text(&mr, "state")));
    }
    let current = text(&mr, "sha");
    let sha = match head {
        Some(head) if !head.eq_ignore_ascii_case(&current) => {
            return Err(
                "This merge request has new commits since it was last checked. Check it again and review them before merging."
                    .into(),
            )
        }
        Some(head) => head.to_string(),
        None => current,
    };
    let status = mr["detailed_merge_status"].as_str().unwrap_or("");
    if !status.is_empty() && status != "mergeable" {
        return Err(format!(
            "GitLab will not merge this yet: {}.",
            not_mergeable(status)
        ));
    }
    api(
        cwd,
        repository,
        "PUT",
        &format!("{base}/merge_requests/{number}/merge"),
        Some(json!({ "sha": sha, "squash": squash })),
    )
    .map(|_| ())
    .map_err(|error| format!("GitLab did not merge the merge request. {error}"))
}

fn not_mergeable(status: &str) -> String {
    match status {
        "ci_must_pass" => "its pipeline must pass first".into(),
        "ci_still_running" => "its pipeline is still running".into(),
        "not_approved" => "it needs approval".into(),
        "requested_changes" => "a reviewer requested changes".into(),
        "discussions_not_resolved" => "its threads must be resolved".into(),
        "conflict" => "it has conflicts".into(),
        "need_rebase" => "its branch must be rebased onto the target".into(),
        "draft_status" => "it is a draft".into(),
        "checking" | "unchecked" | "preparing" | "approvals_syncing" => {
            "it is still checking whether it can merge; retry in a moment".into()
        }
        other => blocker(other)
            .map(|text| text.trim_start_matches("GitLab: ").to_string())
            .unwrap_or_else(|| other.replace('_', " ")),
    }
}

/// Unresolved discussion threads in GitLab's own words; `true` when more may exist.
pub(crate) fn threads(discussions: &[Value]) -> (Value, bool) {
    let open: Vec<Value> = discussions
        .iter()
        .filter(|discussion| {
            let notes = discussion["notes"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or_default();
            notes
                .iter()
                .any(|note| note["resolvable"] == true && note["resolved"] != true)
        })
        .map(|discussion| {
            let notes = discussion["notes"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or_default();
            let position = notes
                .iter()
                .find_map(|note| note["position"].as_object())
                .cloned()
                .map(Value::Object)
                .unwrap_or(Value::Null);
            json!({
                "path": position["new_path"].as_str().or(position["old_path"].as_str()),
                "line": position["new_line"].as_u64().or(position["old_line"].as_u64()),
                "comments": notes
                    .iter()
                    .filter(|note| note["system"] != true)
                    .take(20)
                    .map(|note| json!({
                        "author": note["author"]["username"],
                        "body": note["body"],
                    }))
                    .collect::<Vec<_>>(),
            })
        })
        .collect();
    (Value::Array(open), discussions.len() >= 100)
}

/// The excerpt a follow-up or starter shows: an issue, a merge request with its
/// unresolved threads, or a pipeline with the end of each failed job's log.
pub(crate) fn context(
    cwd: &Path,
    repository: &Repository,
    kind: &str,
    number: &str,
) -> Result<(String, String, String, bool), String> {
    let base = project(repository);
    match kind {
        "issue" => {
            let issue = get(cwd, repository, &format!("{base}/issues/{number}"))?;
            let notes = get(
                cwd,
                repository,
                &format!("{base}/issues/{number}/notes?sort=asc&per_page=50"),
            )
            .ok()
            .and_then(|notes| notes.as_array().cloned())
            .unwrap_or_default();
            let record = json!({
                "number": issue["iid"],
                "title": issue["title"],
                "state": issue["state"],
                "labels": issue["labels"],
                "body": issue["description"],
                "url": issue["web_url"],
                "comments": notes.iter().filter(|note| note["system"] != true).map(|note| json!({"author": note["author"]["username"], "body": note["body"]})).collect::<Vec<_>>(),
            });
            Ok((
                text(&issue, "title"),
                text(&issue, "web_url"),
                pretty(&record),
                notes.len() >= 50,
            ))
        }
        "review" => {
            let number: u64 = number
                .parse()
                .map_err(|_| "Enter a merge request number.")?;
            let mr = get(cwd, repository, &format!("{base}/merge_requests/{number}"))?;
            let discussions = get(
                cwd,
                repository,
                &format!("{base}/merge_requests/{number}/discussions?per_page=100"),
            )?;
            let (threads, incomplete) = threads(
                discussions
                    .as_array()
                    .map(Vec::as_slice)
                    .unwrap_or_default(),
            );
            let record = json!({
                "number": mr["iid"],
                "title": mr["title"],
                "body": mr["description"],
                "url": mr["web_url"],
                "sourceBranch": mr["source_branch"],
                "targetBranch": mr["target_branch"],
                "headSha": mr["sha"],
                "mergeStatus": mr["detailed_merge_status"],
                "unresolvedThreads": threads,
            });
            Ok((
                text(&mr, "title"),
                text(&mr, "web_url"),
                pretty(&record),
                incomplete,
            ))
        }
        "ci" => {
            let pipeline = get(cwd, repository, &format!("{base}/pipelines/{number}"))?;
            let jobs = pipeline_jobs(cwd, repository, number)?;
            let failed: Vec<&Value> = jobs
                .iter()
                .filter(|job| job["status"] == "failed" && job["allow_failure"] != true)
                .collect();
            let record = json!({
                "id": pipeline["id"],
                "url": pipeline["web_url"],
                "ref": pipeline["ref"],
                "sha": pipeline["sha"],
                "status": pipeline["status"],
                "jobs": jobs.iter().map(|job| json!({"name": job["name"], "stage": job["stage"], "status": job["status"], "allowFailure": job["allow_failure"], "failureReason": job["failure_reason"], "url": job["web_url"]})).collect::<Vec<_>>(),
            });
            let mut out = pretty(&record);
            out.push_str("\n\nFailed job output:\n");
            out.push_str(&failed_logs(cwd, repository, &failed));
            let title = format!("Pipeline #{} ({})", number, text(&pipeline, "ref"));
            Ok((
                title,
                text(&pipeline, "web_url"),
                out,
                failed.len() > FAILED_LOGS,
            ))
        }
        _ => Err("Choose an issue, merge request review or failing pipeline.".into()),
    }
}

/// The end of each failed job's log, a few jobs at most.
fn failed_logs(cwd: &Path, repository: &Repository, failed: &[&Value]) -> String {
    let base = project(repository);
    let mut out = String::new();
    for job in failed.iter().take(FAILED_LOGS) {
        let Some(id) = job["id"].as_u64() else {
            continue;
        };
        out.push_str(&format!(
            "\n--- {} ({}) ---\n",
            text(job, "name"),
            text(job, "stage")
        ));
        let endpoint = format!("{base}/jobs/{id}/trace");
        match glab(
            cwd,
            &repository.host,
            &["api", &endpoint, "--method", "GET"],
            None,
            Keep::Tail(64_000),
        ) {
            Ok(log) => out.push_str(&log_tail(&log, LOG_TAIL)),
            Err(failure) => out.push_str(&format!(
                "(log unavailable: {})",
                failure.message(&repository.host)
            )),
        }
        out.push('\n');
    }
    if out.is_empty() {
        out.push_str("No failed jobs reported.");
    }
    out
}

fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_default()
}

/// One page of open issues or merge requests for the picker: fifty at a time.
pub(crate) fn list(
    cwd: &Path,
    repository: &Repository,
    kind: &str,
    query: &str,
    mine: bool,
    page: usize,
) -> Result<(Vec<Value>, bool), String> {
    let collection = if kind == "pr" {
        "merge_requests"
    } else {
        "issues"
    };
    let mut endpoint = format!(
        "{}/{collection}?state=opened&order_by=updated_at&per_page=50&page={page}",
        project(repository)
    );
    if !query.trim().is_empty() {
        endpoint.push_str(&format!("&search={}&in=title", encode(query.trim())));
    }
    if mine {
        endpoint.push_str("&scope=assigned_to_me");
    }
    let rows = get(cwd, repository, &endpoint)?;
    let rows = rows.as_array().cloned().ok_or("GitLab returned no list.")?;
    let more = rows.len() == 50;
    Ok((rows, more))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Value {
        let text = match name {
            "mr-open" => include_str!("fixtures/gitlab-mr-open.json"),
            "mr-merged" => include_str!("fixtures/gitlab-mr-merged.json"),
            "jobs-failed" => include_str!("fixtures/gitlab-jobs-failed.json"),
            "discussions" => include_str!("fixtures/gitlab-discussions.json"),
            _ => unreachable!(),
        };
        serde_json::from_str(text).unwrap()
    }

    #[test]
    fn an_open_merge_request_reads_as_a_pull_request() {
        let mr = fixture("mr-open");
        let view = normalize(
            &mr,
            fixture("jobs-failed").as_array().unwrap(),
            &json!({"squash_option": "default_off"}),
        )
        .unwrap();
        assert_eq!(view.provider, HostKind::Gitlab);
        assert_eq!(
            view.url,
            "https://gitlab.com/acme/platform/web/-/merge_requests/42"
        );
        assert_eq!(view.number, 42);
        assert_eq!(view.state, "OPEN");
        assert!(!view.is_draft);
        assert_eq!(view.review_decision, "REVIEW_REQUIRED");
        assert_eq!(view.mergeable, "UNKNOWN");
        assert_eq!(view.pipeline.as_deref(), Some("3109717199"));
        assert_eq!(view.merge_methods, ["merge", "squash"]);
        let outcomes: Vec<_> = view
            .status_check_rollup
            .iter()
            .map(|check| (check.name.as_str(), check.status, check.conclusion))
            .collect();
        assert_eq!(
            outcomes,
            [
                ("lint", "COMPLETED", Some("SUCCESS")),
                ("unit", "COMPLETED", Some("FAILURE")),
                ("flaky-e2e", "COMPLETED", Some("NEUTRAL")),
                ("deploy-review", "COMPLETED", Some("SKIPPED")),
                ("docs", "IN_PROGRESS", None),
            ]
        );
        let json = view.json();
        assert_eq!(
            json["headRefOid"],
            "1cb8a0961c4d3e2b5a7f8e9d0c1b2a3f4e5d6c7b"
        );
        assert_eq!(json["statusCheckRollup"][1]["conclusion"], "FAILURE");
        assert!(json.get("blocker").is_none());
    }

    #[test]
    fn merge_request_states_map_to_github_terms() {
        let mut mr = fixture("mr-open");
        let read = |mr: &Value| normalize(mr, &[], &Value::Null).unwrap();
        mr["detailed_merge_status"] = json!("mergeable");
        assert_eq!(read(&mr).mergeable, "MERGEABLE");
        assert_eq!(read(&mr).review_decision, "");
        mr["detailed_merge_status"] = json!("conflict");
        assert_eq!(read(&mr).mergeable, "CONFLICTING");
        mr["detailed_merge_status"] = json!("discussions_not_resolved");
        assert_eq!(read(&mr).review_decision, "CHANGES_REQUESTED");
        mr["detailed_merge_status"] = json!("blocked_status");
        assert_eq!(
            read(&mr).blocker.as_deref(),
            Some("GitLab: blocked by another merge request")
        );
        mr["detailed_merge_status"] = json!("draft_status");
        mr["draft"] = json!(true);
        assert!(read(&mr).is_draft);
        assert!(read(&mr).blocker.is_none());
        let merged = normalize(
            &fixture("mr-merged"),
            &[],
            &json!({"squash_option": "always"}),
        )
        .unwrap();
        assert_eq!(merged.state, "MERGED");
        assert_eq!(merged.merge_methods, ["squash"]);
        assert_eq!(merged.status_check_rollup[0].name, "Pipeline");
        assert_eq!(merged.status_check_rollup[0].conclusion, Some("SUCCESS"));
        let mut closed = fixture("mr-merged");
        closed["state"] = json!("closed");
        assert_eq!(read(&closed).state, "CLOSED");
        assert!(normalize(
            &json!({"iid": 1, "web_url": "javascript:x"}),
            &[],
            &Value::Null
        )
        .is_err());
    }

    #[test]
    fn unresolved_threads_keep_their_place_and_words() {
        let discussions = fixture("discussions");
        let (open, incomplete) = threads(discussions.as_array().unwrap());
        assert!(!incomplete);
        let open = open.as_array().unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0]["path"], "src/cart.ts");
        assert_eq!(open[0]["line"], 18);
        assert_eq!(open[0]["comments"].as_array().unwrap().len(), 2);
        assert_eq!(open[0]["comments"][0]["author"], "reviewer");
    }

    #[test]
    fn glab_failures_say_what_to_do() {
        let signed_out = classify(
            "{\"message\":\"401 Unauthorized\"}",
            "glab: 401 Unauthorized (HTTP 401)\n",
        );
        assert_eq!(
            signed_out,
            Failure::SignedOut("401 Unauthorized (HTTP 401)".into())
        );
        let message = signed_out.message("gitlab.com");
        assert!(
            message.contains("glab auth login --hostname gitlab.com"),
            "{message}"
        );
        assert!(message.contains("401 Unauthorized (HTTP 401)"), "{message}");
        assert!(matches!(
            classify(
                "{\"message\":\"404 Project Not Found\"}",
                "glab: 404 Project Not Found (HTTP 404)"
            ),
            Failure::NotFound(_)
        ));
        let refused = classify(
            "{\"message\":\"Another open merge request already exists for this source branch: !41\"}",
            "glab: Another open merge request already exists for this source branch: !41 (HTTP 409)",
        );
        assert_eq!(
            refused,
            Failure::Failed(
                "Another open merge request already exists for this source branch: !41 (HTTP 409)"
                    .into()
            )
        );
        assert_eq!(
            classify(
                "{\"message\":{\"title\":[\"is too long\"]}}",
                "glab: HTTP 400"
            ),
            Failure::Failed("{\"title\":[\"is too long\"]} (HTTP 400)".into())
        );
        let missing = Failure::Missing.message("git.corp.example");
        assert!(missing.contains("glab auth login --hostname git.corp.example"));
        assert!(missing.contains("Install it"));
    }

    #[test]
    fn auth_status_output_names_the_account_or_the_problem() {
        assert_eq!(
            signed_in_as("gitlab.com\n  ✓ Logged in to gitlab.com as ana (/Users/ana/.config/glab-cli/config.yml)\n"),
            Some("ana".into())
        );
        let output = "gitlab.com\n  x gitlab.com: API call failed: GET https://gitlab.com/api/v4/user: 401 {message: 401 Unauthorized}\n  ✓ Git operations for gitlab.com configured to use ssh protocol.\n  ! No token found (checked config file, keyring, and environment variables).\n";
        assert_eq!(
            auth_problem(output),
            "gitlab.com: API call failed: GET https://gitlab.com/api/v4/user: 401 {message: 401 Unauthorized}"
        );
    }

    /// Opt-in: reads a public gitlab.com merge request through the installed glab,
    /// signed out. `cargo test -- --ignored public_merge_request_reads_through_glab`
    #[test]
    #[ignore = "Requires glab on PATH and network access to gitlab.com"]
    fn public_merge_request_reads_through_glab() {
        let repository = Repository {
            host: "gitlab.com".into(),
            path: "gitlab-org/cli".into(),
        };
        let cwd = std::env::temp_dir();
        let open = get(
            &cwd,
            &repository,
            &format!(
                "{}/merge_requests?state=merged&per_page=1",
                project(&repository)
            ),
        )
        .unwrap();
        let number = open[0]["iid"].as_u64().unwrap();
        let view = view(&cwd, &repository, number).unwrap();
        assert_eq!(view.state, "MERGED");
        assert!(view.url.ends_with(&format!("/-/merge_requests/{number}")));
        assert!(!view.head_ref_oid.is_empty());
        let error = get(&cwd, &repository, "user").unwrap_err();
        assert!(
            error.contains("glab auth login --hostname gitlab.com"),
            "{error}"
        );
    }

    #[test]
    fn forks_target_the_project_they_came_from() {
        let fork = json!({
            "id": 77,
            "path_with_namespace": "ana/web",
            "default_branch": "ana-main",
            "forked_from_project": {"id": 12, "path_with_namespace": "acme/platform/web", "default_branch": "main"}
        });
        let upstream = choose_target(&fork, None, false).unwrap();
        assert_eq!(
            upstream,
            Target {
                source_id: 77,
                project_id: 12,
                path: "acme/platform/web".into(),
                branch: "main".into(),
                forked: true
            }
        );
        assert_eq!(
            choose_target(&fork, Some("release"), false).unwrap().branch,
            "release"
        );
        let own = choose_target(&fork, None, true).unwrap();
        assert_eq!(
            (
                own.project_id,
                own.path.as_str(),
                own.branch.as_str(),
                own.forked
            ),
            (77, "ana/web", "ana-main", false)
        );
        // A parent the person cannot read is not named, so the fork is the target.
        let hidden = json!({"id": 77, "path_with_namespace": "ana/web", "default_branch": "main"});
        assert!(!choose_target(&hidden, None, false).unwrap().forked);
        let bare = json!({"id": 77, "path_with_namespace": "ana/web", "default_branch": ""});
        assert!(choose_target(&bare, None, false)
            .unwrap_err()
            .contains("target branch"));
        assert!(choose_target(&bare, Some("main"), false).is_ok());
    }

    #[test]
    fn drafts_are_marked_in_the_title_once() {
        assert_eq!(draft_title("Add search", true), "Draft: Add search");
        assert_eq!(draft_title("Draft: Add search", true), "Draft: Add search");
        assert_eq!(draft_title("Add search", false), "Add search");
    }
}
