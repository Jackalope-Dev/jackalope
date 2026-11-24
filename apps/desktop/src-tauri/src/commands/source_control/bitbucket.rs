//! Bitbucket Cloud through its REST API 2.0, with an Atlassian API token (with
//! scopes) the person creates. The token is kept in protected storage, sent only to
//! api.bitbucket.org with HTTP Basic authentication beside the account email, and
//! never written to settings, history or logs. Pushing still uses plain Git and the
//! remote's own credentials.

use super::{
    super::{account_storage, http},
    bounded, encode, log_tail, Access, ChangeRequest, Check, HostKind,
};
use crate::commands::source_control::remote::Repository;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};

const API: &str = "https://api.bitbucket.org/2.0";
const RECORD: &str = "bitbucket.bin";
const RESPONSE_LIMIT: usize = 4_000_000;
const LOG_TAIL: usize = 2_500;
const FAILED_LOGS: usize = 3;

/// The scopes a token needs, as Bitbucket names them when the token is created.
pub(crate) const SCOPES: &[&str] = &[
    "read:user:bitbucket",
    "read:repository:bitbucket",
    "read:pullrequest:bitbucket",
    "write:pullrequest:bitbucket",
    "read:pipeline:bitbucket",
    "read:issue:bitbucket",
];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Credentials {
    email: String,
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionView {
    pub email: String,
    /// The Bitbucket account's name, once a check has read it.
    pub name: Option<String>,
    pub scopes: &'static [&'static str],
}

impl Credentials {
    pub(crate) fn new(email: &str, token: &str) -> Result<Self, String> {
        let email = email.trim();
        let token = token.trim();
        if !email.contains('@') || email.len() > 320 || email.chars().any(char::is_whitespace) {
            return Err("Enter the email address of your Atlassian account.".into());
        }
        if token.is_empty() || token.len() > 8192 || token.chars().any(char::is_whitespace) {
            return Err("Paste the Bitbucket API token.".into());
        }
        Ok(Self {
            email: email.into(),
            token: token.into(),
        })
    }

    pub(crate) fn view(&self) -> ConnectionView {
        ConnectionView {
            email: self.email.clone(),
            name: None,
            scopes: SCOPES,
        }
    }
}

pub(crate) fn credentials(integration: &Path) -> Result<Option<Credentials>, String> {
    account_storage::read_json(
        &integration.join(RECORD),
        "The Bitbucket connection could not be read. Connect Bitbucket again in Settings → Connected work.",
    )
}

pub(crate) fn require(integration: &Path) -> Result<Credentials, String> {
    credentials(integration)?.ok_or_else(|| not_connected().message)
}

pub(crate) fn save(integration: &Path, credentials: &Credentials) -> Result<(), String> {
    account_storage::write_json(&integration.join(RECORD), credentials)
}

pub(crate) fn remove(integration: &Path) -> Result<(), String> {
    account_storage::remove(&integration.join(RECORD))
}

pub(crate) fn not_connected() -> Access {
    Access {
        state: "notConnected",
        message: "Connect Bitbucket in Settings → Connected work with your Atlassian email and a Bitbucket API token.".into(),
    }
}

/// Bitbucket's own words for a refused request, with what to do about it.
pub(crate) fn failure(status: u16, body: &[u8]) -> String {
    let value: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let error = &value["error"];
    let mut said = error["message"].as_str().unwrap_or("").to_string();
    match &error["detail"] {
        Value::String(detail) if !detail.is_empty() => said.push_str(&format!(" {detail}")),
        Value::Object(detail) if !detail.is_empty() => {
            said.push_str(&format!(" {}", Value::Object(detail.clone())))
        }
        _ => {}
    }
    let said = bounded(said.trim(), 1_500).0;
    let said = if said.is_empty() {
        String::new()
    } else {
        format!(" Bitbucket said: {said}")
    };
    match status {
        401 => format!("Bitbucket did not accept the API token. Create a new token with the scopes listed in Settings → Connected work and connect again.{said}"),
        403 => format!("The Bitbucket API token is missing a permission this needs. Check its scopes in Settings → Connected work.{said}"),
        404 => format!("Bitbucket could not find this. Check the repository and that your account can read it.{said}"),
        429 => format!("Bitbucket is limiting requests. Retry in a minute.{said}"),
        _ => format!("Bitbucket returned {status}.{said}"),
    }
}

fn repository_url(repository: &Repository) -> String {
    let (workspace, slug) = repository.path.split_once('/').unwrap_or(("", ""));
    format!("{API}/repositories/{}/{}", encode(workspace), encode(slug))
}

async fn send(
    credentials: &Credentials,
    method: reqwest::Method,
    url: &str,
    body: Option<Value>,
) -> Result<(u16, Vec<u8>), String> {
    let mut request = http::client(Duration::from_secs(30))?
        .request(method, url)
        .basic_auth(&credentials.email, Some(&credentials.token))
        .header(reqwest::header::ACCEPT, "application/json");
    if let Some(body) = body {
        request = request.json(&body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "Could not reach Bitbucket. Check your connection and retry.")?;
    let status = response.status().as_u16();
    let bytes = http::read_bounded(&mut response, RESPONSE_LIMIT)
        .await
        .map_err(|error| match error {
            http::BodyError::Interrupted => "The Bitbucket response was interrupted. Retry.",
            http::BodyError::TooLarge => "The Bitbucket response is too large to read.",
        })?;
    Ok((status, bytes))
}

async fn request(
    credentials: &Credentials,
    method: reqwest::Method,
    url: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let (status, bytes) = send(credentials, method, url, body).await?;
    if !(200..300).contains(&status) {
        return Err(failure(status, &bytes));
    }
    if bytes.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Bitbucket returned an unreadable response.".into())
}

async fn get(credentials: &Credentials, url: &str) -> Result<Value, String> {
    request(credentials, reqwest::Method::GET, url, None).await
}

/// Checks the token by reading its account; returns the account's display name.
pub(crate) async fn check(credentials: &Credentials) -> Result<String, String> {
    let user = get(credentials, &format!("{API}/user")).await?;
    Ok(user["display_name"]
        .as_str()
        .or(user["nickname"].as_str())
        .unwrap_or(&credentials.email)
        .to_string())
}

pub(crate) struct RepositoryInfo {
    pub has_issues: bool,
}

pub(crate) async fn repository(
    credentials: &Credentials,
    repository: &Repository,
) -> Result<RepositoryInfo, String> {
    let value = get(credentials, &repository_url(repository)).await?;
    Ok(RepositoryInfo {
        has_issues: value["has_issues"] == true,
    })
}

fn text(value: &Value, field: &str) -> String {
    value[field].as_str().unwrap_or("").to_string()
}

fn status_check(status: &Value) -> Check {
    let (state, conclusion) = match status["state"].as_str().unwrap_or("") {
        "SUCCESSFUL" => ("COMPLETED", Some("SUCCESS")),
        "FAILED" => ("COMPLETED", Some("FAILURE")),
        "STOPPED" => ("COMPLETED", Some("CANCELLED")),
        "INPROGRESS" => ("IN_PROGRESS", None),
        _ => ("COMPLETED", None),
    };
    let name = status["name"]
        .as_str()
        .filter(|name| !name.is_empty())
        .or(status["key"].as_str())
        .unwrap_or("Build");
    Check {
        name: name.into(),
        status: state,
        conclusion,
        link: status["url"].as_str().map(String::from),
    }
}

/// The Bitbucket Pipelines build number in a build status link, such as
/// `…/addon/pipelines/home#!/results/188`.
pub(crate) fn pipeline_number(url: &str) -> Option<String> {
    let (_, rest) = url.split_once("/results/")?;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    (!digits.is_empty()).then_some(digits)
}

/// A pull request from the REST API, its build statuses and its diffstat, in the
/// shape the GitHub CLI reports one.
pub(crate) fn normalize(
    pr: &Value,
    statuses: &[Value],
    diffstat: Option<&[Value]>,
) -> Result<ChangeRequest, String> {
    let url = pr["links"]["html"]["href"]
        .as_str()
        .unwrap_or("")
        .to_string();
    if !url.starts_with("https://") {
        return Err("Bitbucket returned a pull request without an address.".into());
    }
    let number = pr["id"]
        .as_u64()
        .ok_or("Bitbucket returned a pull request without a number.")?;
    let state = match pr["state"].as_str().unwrap_or("") {
        "MERGED" => "MERGED",
        "DECLINED" | "SUPERSEDED" => "CLOSED",
        _ => "OPEN",
    };
    let head = pr["source"]["commit"]["hash"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let participants = pr["participants"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let review_decision = if participants
        .iter()
        .any(|p| p["state"] == "changes_requested")
    {
        "CHANGES_REQUESTED"
    } else if participants.iter().any(|p| p["approved"] == true) {
        "APPROVED"
    } else if pr["reviewers"]
        .as_array()
        .is_some_and(|reviewers| !reviewers.is_empty())
    {
        "REVIEW_REQUIRED"
    } else {
        ""
    };
    let mergeable = match diffstat {
        Some(files) if files.iter().any(|file| file["status"] == "merge conflict") => "CONFLICTING",
        Some(_) => "MERGEABLE",
        None => "UNKNOWN",
    };
    // The newest status per build key on the pull request's current commit.
    let current: Vec<&Value> = statuses
        .iter()
        .filter(|status| {
            head.is_empty()
                || status["commit"]["hash"]
                    .as_str()
                    .is_none_or(|hash| hash.starts_with(&head))
        })
        .collect();
    let mut latest: Vec<&Value> = Vec::new();
    for status in current {
        match latest.iter_mut().find(|kept| kept["key"] == status["key"]) {
            Some(kept) if text(kept, "updated_on") < text(status, "updated_on") => *kept = status,
            Some(_) => {}
            None => latest.push(status),
        }
    }
    let checks: Vec<Check> = latest.iter().map(|status| status_check(status)).collect();
    let pipeline = latest
        .iter()
        .filter(|status| status["state"] == "FAILED")
        .chain(latest.iter())
        .find_map(|status| status["url"].as_str().and_then(pipeline_number));
    let strategies: Vec<&'static str> = pr["destination"]["branch"]["merge_strategies"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|strategy| match strategy.as_str() {
                    Some("merge_commit") => Some("merge"),
                    Some("squash") => Some("squash"),
                    Some("fast_forward") => Some("fastForward"),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(ChangeRequest {
        provider: HostKind::Bitbucket,
        url,
        number,
        title: text(pr, "title"),
        state,
        is_draft: pr["draft"] == true,
        head_ref_oid: head,
        review_decision,
        mergeable,
        status_check_rollup: checks,
        pipeline,
        blocker: None,
        merge_methods: if strategies.is_empty() {
            vec!["merge", "squash", "fastForward"]
        } else {
            strategies
        },
    })
}

fn values(value: &Value) -> Vec<Value> {
    value["values"].as_array().cloned().unwrap_or_default()
}

pub(crate) async fn view(
    credentials: &Credentials,
    repository: &Repository,
    number: u64,
) -> Result<ChangeRequest, String> {
    let base = format!("{}/pullrequests/{number}", repository_url(repository));
    let pr = get(credentials, &base).await?;
    let statuses = values(
        &get(
            credentials,
            &format!("{base}/statuses?pagelen=100&sort=-updated_on"),
        )
        .await?,
    );
    // Conflicts are only reported per file; when they cannot be read, mergeability stays unknown.
    let diffstat = get(credentials, &format!("{base}/diffstat?pagelen=100"))
        .await
        .ok()
        .map(|value| values(&value));
    normalize(&pr, &statuses, diffstat.as_deref())
}

fn quoted(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

pub(crate) async fn find_for_branch(
    credentials: &Credentials,
    repository: &Repository,
    branch: &str,
) -> Result<Option<ChangeRequest>, String> {
    let query = encode(&format!("source.branch.name = {}", quoted(branch)));
    for states in ["state=OPEN", "state=MERGED&state=DECLINED&state=SUPERSEDED"] {
        let found = get(
            credentials,
            &format!(
                "{}/pullrequests?q={query}&{states}&sort=-updated_on&pagelen=1",
                repository_url(repository)
            ),
        )
        .await?;
        if let Some(number) = values(&found).first().and_then(|pr| pr["id"].as_u64()) {
            return view(credentials, repository, number).await.map(Some);
        }
    }
    Ok(None)
}

/// Opens a pull request from `branch`, which must already be pushed. Returns its address.
pub(crate) async fn create(
    credentials: &Credentials,
    repository: &Repository,
    branch: &str,
    target: Option<&str>,
    title: &str,
    body: &str,
    draft: bool,
) -> Result<String, String> {
    let mut payload = json!({
        "title": title,
        "description": body,
        "source": { "branch": { "name": branch } },
        "draft": draft,
    });
    if let Some(target) = target.filter(|target| !target.is_empty()) {
        payload["destination"] = json!({ "branch": { "name": target } });
    }
    let created = request(
        credentials,
        reqwest::Method::POST,
        &format!("{}/pullrequests", repository_url(repository)),
        Some(payload),
    )
    .await
    .map_err(|error| format!("The pull request was not opened. {error}"))?;
    created["links"]["html"]["href"]
        .as_str()
        .filter(|url| url.starts_with("https://"))
        .map(String::from)
        .ok_or_else(|| {
            "The pull request was opened, but Bitbucket did not return its address.".into()
        })
}

/// Merges a pull request with the chosen strategy. Bitbucket enforces the
/// repository's merge checks; nothing here bypasses them.
pub(crate) async fn merge(
    credentials: &Credentials,
    repository: &Repository,
    number: u64,
    method: &str,
) -> Result<(), String> {
    let strategy = match method {
        "merge" => "merge_commit",
        "squash" => "squash",
        "fastForward" => "fast_forward",
        _ => return Err("Choose merge commit, squash or fast-forward.".into()),
    };
    let base = format!("{}/pullrequests/{number}", repository_url(repository));
    let pr = get(credentials, &base).await?;
    if pr["state"] != "OPEN" {
        return Err(format!(
            "This pull request is {}.",
            text(&pr, "state").to_lowercase()
        ));
    }
    if pr["draft"] == true {
        return Err(
            "This pull request is a draft. Mark it ready on Bitbucket before merging.".into(),
        );
    }
    request(
        credentials,
        reqwest::Method::POST,
        &format!("{base}/merge"),
        Some(json!({ "merge_strategy": strategy })),
    )
    .await
    .map(|_| ())
    .map_err(|error| format!("Bitbucket did not merge the pull request. {error}"))
}

/// Open comment threads: top-level comments that are neither deleted nor resolved,
/// with their replies. `true` when more comments may exist.
pub(crate) fn threads(comments: &[Value], more: bool) -> (Value, bool) {
    let live: Vec<&Value> = comments
        .iter()
        .filter(|comment| comment["deleted"] != true)
        .collect();
    let open: Vec<Value> = live
        .iter()
        .filter(|comment| comment["parent"].is_null() && comment["resolution"].is_null())
        .map(|top| {
            let replies = live
                .iter()
                .filter(|reply| reply["parent"]["id"] == top["id"])
                .copied()
                .take(19);
            json!({
                "path": top["inline"]["path"],
                "line": top["inline"]["to"].as_u64().or(top["inline"]["from"].as_u64()),
                "comments": std::iter::once(*top).chain(replies).map(|comment| json!({
                    "author": comment["user"]["display_name"],
                    "body": comment["content"]["raw"],
                    "url": comment["links"]["html"]["href"],
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    (Value::Array(open), more)
}

/// The end of a step's log. The log may be served from storage Bitbucket redirects
/// to; that address is signed, so the token is not sent there.
async fn step_log(credentials: &Credentials, url: &str) -> Result<String, String> {
    let client = http::client(Duration::from_secs(30))?;
    let tail = "bytes=-64000";
    let response = client
        .get(url)
        .basic_auth(&credentials.email, Some(&credentials.token))
        .header(reqwest::header::RANGE, tail)
        .send()
        .await
        .map_err(|_| "Could not reach Bitbucket.")?;
    let mut response = if response.status().is_redirection() {
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .filter(|location| location.starts_with("https://"))
            .ok_or("Bitbucket redirected the log somewhere it cannot be read from.")?
            .to_string();
        client
            .get(location)
            .header(reqwest::header::RANGE, tail)
            .send()
            .await
            .map_err(|_| "Could not read the log.")?
    } else {
        response
    };
    let status = response.status().as_u16();
    let bytes = http::read_bounded(&mut response, 256_000)
        .await
        .map_err(|_| "The log could not be read.")?;
    if !(200..300).contains(&status) {
        return Err(failure(status, &bytes));
    }
    Ok(log_tail(&String::from_utf8_lossy(&bytes), LOG_TAIL))
}

fn step_failed(step: &Value) -> bool {
    matches!(
        step["state"]["result"]["name"].as_str(),
        Some("FAILED") | Some("ERROR")
    )
}

fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_default()
}

/// The excerpt a follow-up or starter shows: an issue, a pull request with its open
/// comment threads, or a Pipelines build with the end of each failed step's log.
pub(crate) async fn context(
    credentials: &Credentials,
    repository: &Repository,
    kind: &str,
    number: &str,
) -> Result<(String, String, String, bool), String> {
    let base = repository_url(repository);
    match kind {
        "issue" => {
            let issue = get(credentials, &format!("{base}/issues/{number}"))
                .await
                .map_err(issues_off)?;
            let comments = get(
                credentials,
                &format!("{base}/issues/{number}/comments?pagelen=50"),
            )
            .await
            .unwrap_or(Value::Null);
            let record = json!({
                "number": issue["id"],
                "title": issue["title"],
                "state": issue["state"],
                "kind": issue["kind"],
                "priority": issue["priority"],
                "body": issue["content"]["raw"],
                "url": issue["links"]["html"]["href"],
                "comments": values(&comments).iter().filter(|c| !c["content"]["raw"].as_str().unwrap_or("").is_empty()).map(|c| json!({"author": c["user"]["display_name"], "body": c["content"]["raw"]})).collect::<Vec<_>>(),
            });
            let url = issue["links"]["html"]["href"]
                .as_str()
                .unwrap_or("")
                .to_string();
            Ok((
                text(&issue, "title"),
                url,
                pretty(&record),
                comments["next"].is_string(),
            ))
        }
        "review" => {
            let pr = get(credentials, &format!("{base}/pullrequests/{number}")).await?;
            let comments = get(
                credentials,
                &format!("{base}/pullrequests/{number}/comments?pagelen=100"),
            )
            .await?;
            let (threads, incomplete) = threads(&values(&comments), comments["next"].is_string());
            let record = json!({
                "number": pr["id"],
                "title": pr["title"],
                "body": pr["description"],
                "url": pr["links"]["html"]["href"],
                "sourceBranch": pr["source"]["branch"]["name"],
                "targetBranch": pr["destination"]["branch"]["name"],
                "headCommit": pr["source"]["commit"]["hash"],
                "openThreads": threads,
            });
            let url = pr["links"]["html"]["href"]
                .as_str()
                .unwrap_or("")
                .to_string();
            Ok((text(&pr, "title"), url, pretty(&record), incomplete))
        }
        "ci" => {
            let pipeline = get(credentials, &format!("{base}/pipelines/{number}")).await?;
            let uuid = encode(
                pipeline["uuid"]
                    .as_str()
                    .ok_or("Bitbucket returned no pipeline ID.")?,
            );
            let steps = values(
                &get(
                    credentials,
                    &format!("{base}/pipelines/{uuid}/steps/?pagelen=100"),
                )
                .await?,
            );
            let failed: Vec<&Value> = steps.iter().filter(|step| step_failed(step)).collect();
            let record = json!({
                "buildNumber": pipeline["build_number"],
                "state": pipeline["state"],
                "target": pipeline["target"],
                "steps": steps.iter().map(|step| json!({"name": step["name"], "state": step["state"]})).collect::<Vec<_>>(),
            });
            let mut out = pretty(&record);
            out.push_str("\n\nFailed step output:\n");
            for step in failed.iter().take(FAILED_LOGS) {
                let Some(step_uuid) = step["uuid"].as_str() else {
                    continue;
                };
                out.push_str(&format!("\n--- {} ---\n", text(step, "name")));
                match step_log(
                    credentials,
                    &format!("{base}/pipelines/{uuid}/steps/{}/log", encode(step_uuid)),
                )
                .await
                {
                    Ok(log) => out.push_str(&log),
                    Err(error) => out.push_str(&format!("(log unavailable: {error})")),
                }
                out.push('\n');
            }
            if failed.is_empty() {
                out.push_str("No failed steps reported.");
            }
            let (workspace, slug) = repository.path.split_once('/').unwrap_or(("", ""));
            let url =
                format!("https://bitbucket.org/{workspace}/{slug}/pipelines/results/{number}");
            Ok((
                format!("Pipeline #{number}"),
                url,
                out,
                failed.len() > FAILED_LOGS,
            ))
        }
        _ => Err("Choose an issue, pull request review or failing pipeline.".into()),
    }
}

fn issues_off(error: String) -> String {
    if error.starts_with("Bitbucket returned 410") || error.starts_with("Bitbucket could not find")
    {
        format!("Issues may be turned off for this Bitbucket repository. {error}")
    } else {
        error
    }
}

/// One page of open issues or pull requests for the picker: fifty at a time.
pub(crate) async fn list(
    credentials: &Credentials,
    repository: &Repository,
    kind: &str,
    query: &str,
    mine: bool,
    page: usize,
) -> Result<(Vec<Value>, bool), String> {
    let base = repository_url(repository);
    let me = if mine {
        let user = get(credentials, &format!("{API}/user")).await?;
        Some(quoted(
            user["uuid"]
                .as_str()
                .ok_or("Bitbucket returned no account ID.")?,
        ))
    } else {
        None
    };
    let mut filters = Vec::new();
    let url = if kind == "pr" {
        if let Some(me) = &me {
            filters.push(format!("(author.uuid = {me} OR reviewers.uuid = {me})"));
        }
        if !query.trim().is_empty() {
            filters.push(format!("title ~ {}", quoted(query.trim())));
        }
        format!("{base}/pullrequests?state=OPEN")
    } else {
        filters.push("(state = \"new\" OR state = \"open\")".into());
        if let Some(me) = &me {
            filters.push(format!("assignee.uuid = {me}"));
        }
        if !query.trim().is_empty() {
            filters.push(format!("title ~ {}", quoted(query.trim())));
        }
        format!("{base}/issues?")
    };
    let mut url = format!("{url}&sort=-updated_on&pagelen=50&page={page}");
    if !filters.is_empty() {
        url.push_str(&format!("&q={}", encode(&filters.join(" AND "))));
    }
    let value = get(credentials, &url).await.map_err(issues_off)?;
    Ok((values(&value), value["next"].is_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Value {
        let text = match name {
            "pr-open" => include_str!("fixtures/bitbucket-pr-open.json"),
            "statuses" => include_str!("fixtures/bitbucket-statuses.json"),
            "comments" => include_str!("fixtures/bitbucket-comments.json"),
            _ => unreachable!(),
        };
        serde_json::from_str(text).unwrap()
    }

    #[test]
    fn an_open_pull_request_reads_in_github_terms() {
        let pr = fixture("pr-open");
        let statuses = values(&fixture("statuses"));
        let diffstat = vec![json!({"status": "modified"})];
        let view = normalize(&pr, &statuses, Some(&diffstat)).unwrap();
        assert_eq!(view.provider, HostKind::Bitbucket);
        assert_eq!(view.url, "https://bitbucket.org/acme/web/pull-requests/52");
        assert_eq!(view.number, 52);
        assert_eq!(view.state, "OPEN");
        assert_eq!(view.head_ref_oid, "113ce9372ea0");
        assert_eq!(view.review_decision, "CHANGES_REQUESTED");
        assert_eq!(view.mergeable, "MERGEABLE");
        assert_eq!(view.merge_methods, ["merge", "squash"]);
        let checks: Vec<_> = view
            .status_check_rollup
            .iter()
            .map(|check| (check.name.as_str(), check.status, check.conclusion))
            .collect();
        // The older run of the same build and the status on an earlier commit are dropped.
        assert_eq!(
            checks,
            [
                (
                    "Pipeline #188 for feature/saved-carts",
                    "COMPLETED",
                    Some("FAILURE")
                ),
                ("security-scan", "IN_PROGRESS", None),
            ]
        );
        assert_eq!(view.pipeline.as_deref(), Some("188"));
    }

    #[test]
    fn pull_request_states_conflicts_and_reviews_map_to_github_terms() {
        let mut pr = fixture("pr-open");
        let conflicted = vec![json!({"status": "merge conflict"})];
        assert_eq!(
            normalize(&pr, &[], Some(&conflicted)).unwrap().mergeable,
            "CONFLICTING"
        );
        assert_eq!(normalize(&pr, &[], None).unwrap().mergeable, "UNKNOWN");
        pr["participants"] = json!([{"approved": true, "state": "approved"}]);
        assert_eq!(
            normalize(&pr, &[], None).unwrap().review_decision,
            "APPROVED"
        );
        pr["participants"] = json!([]);
        assert_eq!(
            normalize(&pr, &[], None).unwrap().review_decision,
            "REVIEW_REQUIRED"
        );
        pr["reviewers"] = json!([]);
        assert_eq!(normalize(&pr, &[], None).unwrap().review_decision, "");
        for (state, expected) in [
            ("MERGED", "MERGED"),
            ("DECLINED", "CLOSED"),
            ("SUPERSEDED", "CLOSED"),
        ] {
            pr["state"] = json!(state);
            assert_eq!(normalize(&pr, &[], None).unwrap().state, expected);
        }
        pr["destination"]["branch"]["merge_strategies"] = Value::Null;
        assert_eq!(
            normalize(&pr, &[], None).unwrap().merge_methods,
            ["merge", "squash", "fastForward"]
        );
        pr["links"]["html"]["href"] = json!("http://bitbucket.org/acme/web/pull-requests/52");
        assert!(normalize(&pr, &[], None).is_err());
    }

    #[test]
    fn open_threads_skip_deleted_and_resolved_comments() {
        let comments = values(&fixture("comments"));
        let (open, more) = threads(&comments, false);
        assert!(!more);
        let open = open.as_array().unwrap();
        assert_eq!(open.len(), 2);
        assert_eq!(open[0]["path"], "src/cart.ts");
        assert_eq!(open[0]["line"], 18);
        assert_eq!(open[0]["comments"].as_array().unwrap().len(), 2);
        assert_eq!(open[0]["comments"][1]["body"], "Agreed, and add a test.");
        assert!(open[1]["path"].is_null());
    }

    #[test]
    fn refusals_carry_bitbucket_words_and_next_steps() {
        let scope = br#"{"type":"error","error":{"message":"Your credentials lack one or more required privilege scopes.","detail":{"required":["write:pullrequest:bitbucket"],"granted":["read:pullrequest:bitbucket"]}}}"#;
        let message = failure(403, scope);
        assert!(message.contains("missing a permission"), "{message}");
        assert!(message.contains("write:pullrequest:bitbucket"), "{message}");
        assert!(failure(401, b"").starts_with("Bitbucket did not accept the API token."));
        let gone = issues_off(failure(
            410,
            br#"{"type":"error","error":{"message":"Repository has no issue tracker."}}"#,
        ));
        assert!(gone.starts_with("Issues may be turned off"), "{gone}");
        assert!(gone.contains("Repository has no issue tracker."), "{gone}");
    }

    #[test]
    fn credentials_are_checked_and_never_shown() {
        assert!(Credentials::new("not-an-email", "ATATT123").is_err());
        assert!(Credentials::new("ana@example.com", " ").is_err());
        assert!(Credentials::new("ana@example.com", "ATATT 123").is_err());
        let credentials = Credentials::new(" ana@example.com ", " ATATT123 ").unwrap();
        let view = serde_json::to_string(&credentials.view()).unwrap();
        assert!(view.contains("ana@example.com"));
        assert!(!view.contains("ATATT123"), "{view}");
        assert!(view.contains("write:pullrequest:bitbucket"));
    }

    #[test]
    fn build_links_name_their_pipeline() {
        assert_eq!(
            pipeline_number("https://bitbucket.org/acme/web/addon/pipelines/home#!/results/188"),
            Some("188".into())
        );
        assert_eq!(
            pipeline_number("https://bitbucket.org/acme/web/pipelines/results/7/steps/%7Bx%7D"),
            Some("7".into())
        );
        assert_eq!(pipeline_number("https://ci.example.com/build/9"), None);
    }

    #[test]
    fn query_values_are_quoted() {
        assert_eq!(quoted(r#"fix "x"\y"#), r#""fix \"x\"\\y""#);
    }
}
