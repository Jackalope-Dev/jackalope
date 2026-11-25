use super::{
    process_control,
    source_control::{self, bitbucket, gitlab, Route},
    tasks::TaskRuntime,
};
use serde::Serialize;
use serde_json::Value;
use std::{path::Path, process::Command, time::Duration};
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowContext {
    title: String,
    url: String,
    text: String,
    truncated: bool,
}

fn identifier(value: &str) -> Result<String, String> {
    number(value.trim().trim_start_matches('#')).ok_or_else(|| {
        "Enter the issue, pull request or workflow run number from this repository.".into()
    })
}

fn number(value: &str) -> Option<String> {
    (!value.is_empty()
        && value.len() <= 20
        && value.bytes().all(|c| c.is_ascii_digit())
        && value.parse::<u64>().ok().is_some_and(|n| n > 0))
    .then(|| value.into())
}

/// An item number on GitLab or Bitbucket, in that host's words. GitLab writes
/// merge requests as `!12`.
fn host_identifier(value: &str, route: &Route) -> Result<String, String> {
    let value = value.trim().trim_start_matches(['#', '!']);
    number(value).ok_or_else(|| match route {
        Route::GitLab(_) => {
            "Enter the issue, merge request or pipeline number from this repository.".into()
        }
        _ => "Enter the issue, pull request or pipeline number from this repository.".into(),
    })
}

pub(super) fn gh(path: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("gh");
    command
        .current_dir(path)
        .args(args)
        .env_remove("GH_REPO")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GIT_TERMINAL_PROMPT", "0");
    let result = process_control::run(command, Duration::from_secs(20))?;
    if !result.success {
        return Err("GitHub could not read this item. Check its number, repository, GitHub CLI sign-in and network, then retry.".into());
    }
    Ok(result.stdout)
}

fn bounded(text: &str, bytes: usize) -> (String, bool) {
    let mut end = text.len().min(bytes);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].into(), end < text.len())
}

pub(super) fn inspect(path: &Path, kind: &str, value: &str) -> Result<WorkflowContext, String> {
    let number = identifier(value)?;
    let args = match kind {
        "issue" => vec![
            "issue",
            "view",
            &number,
            "--json",
            "number,title,body,url,state,labels,comments",
        ],
        "review" => vec![
            "pr",
            "view",
            &number,
            "--json",
            "number,title,body,url,headRefOid,headRefName,baseRefName,reviews,statusCheckRollup",
        ],
        "ci" => vec![
            "run",
            "view",
            &number,
            "--json",
            "databaseId,name,url,headSha,headBranch,status,conclusion,jobs",
        ],
        _ => return Err("Choose an issue, pull request review or failing CI run.".into()),
    };
    let mut record: Value = serde_json::from_str(&gh(path, &args)?)
        .map_err(|_| "GitHub returned an unreadable item.")?;
    let url = record["url"]
        .as_str()
        .filter(|url| url.starts_with("https://"))
        .ok_or("GitHub returned no item URL.")?
        .to_string();
    let title = record["title"]
        .as_str()
        .or(record["name"].as_str())
        .unwrap_or("GitHub work")
        .to_string();
    let mut incomplete = false;
    if kind == "review" {
        let repo: Value =
            serde_json::from_str(&gh(path, &["repo", "view", "--json", "nameWithOwner,url"])?)
                .map_err(|_| "GitHub returned an unreadable repository.")?;
        let name = repo["nameWithOwner"]
            .as_str()
            .ok_or("GitHub returned no repository name.")?;
        let (owner, name) = name
            .split_once('/')
            .ok_or("GitHub returned an invalid repository name.")?;
        let repo_url = reqwest::Url::parse(repo["url"].as_str().unwrap_or(""))
            .map_err(|_| "GitHub returned an invalid repository URL.")?;
        let host = repo_url
            .host_str()
            .ok_or("GitHub returned no repository host.")?;
        let query = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved isOutdated path line comments(first:20){pageInfo{hasNextPage} nodes{body url author{login}}}}}}}}";
        let owner = format!("owner={owner}");
        let name = format!("name={name}");
        let number = format!("number={number}");
        let query = format!("query={query}");
        let response: Value = serde_json::from_str(&gh(
            path,
            &[
                "api",
                "graphql",
                "--hostname",
                host,
                "-f",
                &query,
                "-f",
                &owner,
                "-f",
                &name,
                "-F",
                &number,
            ],
        )?)
        .map_err(|_| "GitHub returned unreadable review threads.")?;
        if response.get("errors").is_some() {
            return Err(
                "GitHub could not read review threads. Check repository access and retry.".into(),
            );
        }
        let threads = &response["data"]["repository"]["pullRequest"]["reviewThreads"];
        let nodes = threads["nodes"]
            .as_array()
            .ok_or("GitHub returned no review thread collection.")?;
        incomplete = threads["pageInfo"]["hasNextPage"] == true
            || nodes
                .iter()
                .any(|n| n["comments"]["pageInfo"]["hasNextPage"] == true);
        record["reviewThreads"] = threads.clone();
    }
    let mut text = serde_json::to_string_pretty(&record).map_err(|e| e.to_string())?;
    if kind == "ci" {
        text.push_str("\n\nFailed job output:\n");
        text.push_str(&gh(path, &["run", "view", &number, "--log-failed"])?);
    }
    let (text, truncated) = bounded(&text, 8_000);
    Ok(WorkflowContext {
        title,
        url,
        text,
        truncated: truncated || incomplete,
    })
}

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::github_workflows::project_github_context,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

/// Reads an issue, a change request's review threads or a failing CI run from the
/// project's code host, as a bounded excerpt for a task draft. The name predates
/// GitLab and Bitbucket, which are read here too.
#[tauri::command]
pub async fn project_github_context(
    project_path: String,
    kind: String,
    number: String,
    state: State<'_, TaskRuntime>,
) -> Result<WorkflowContext, String> {
    let integration = state.integration_directory();
    let path = project_path.clone();
    let route = tauri::async_runtime::spawn_blocking(move || {
        source_control::route(&integration, Path::new(&path), &path)
    })
    .await
    .map_err(|e| e.to_string())?;
    let found = match route {
        Route::GitHub => {
            return tauri::async_runtime::spawn_blocking(move || {
                inspect(Path::new(&project_path), &kind, &number)
            })
            .await
            .map_err(|e| e.to_string())?
        }
        Route::GitLab(repository) => {
            let number = host_identifier(&number, &Route::GitLab(repository.clone()))?;
            tauri::async_runtime::spawn_blocking(move || {
                gitlab::context(Path::new(&project_path), &repository, &kind, &number)
            })
            .await
            .map_err(|e| e.to_string())??
        }
        Route::Bitbucket(repository) => {
            let number = host_identifier(&number, &Route::Bitbucket(repository.clone()))?;
            let credentials = bitbucket::require(&state.integration_directory())?;
            bitbucket::context(&credentials, &repository, &kind, &number).await?
        }
    };
    let (title, url, text, incomplete) = found;
    if !url.starts_with("https://") {
        return Err("The code host returned no item address.".into());
    }
    let (text, truncated) = bounded(&text, 8_000);
    Ok(WorkflowContext {
        title,
        url,
        text,
        truncated: truncated || incomplete,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_positive_repository_item_numbers() {
        assert_eq!(identifier(" #123 ").unwrap(), "123");
        for value in [
            "0",
            "-1",
            "--repo",
            "1; echo",
            "https://github.com/other/repo/issues/1",
            "18446744073709551616",
        ] {
            assert!(identifier(value).is_err(), "{value}");
        }
    }
    #[test]
    fn code_hosts_name_their_own_items() {
        let gitlab = Route::GitLab(source_control::remote::Repository {
            host: "gitlab.com".into(),
            path: "a/b".into(),
        });
        assert_eq!(host_identifier(" !12 ", &gitlab).unwrap(), "12");
        assert!(host_identifier("x", &gitlab)
            .unwrap_err()
            .contains("merge request or pipeline"));
        assert!(host_identifier("0", &Route::GitHub)
            .unwrap_err()
            .contains("pull request or pipeline"));
        assert!(identifier("!12").is_err());
    }
    #[test]
    fn context_limit_keeps_valid_utf8_and_reports_truncation() {
        assert_eq!(bounded("abc", 3), ("abc".into(), false));
        assert_eq!(bounded("a😀b", 4), ("a".into(), true));
        assert_eq!(bounded("a😀b", 5), ("a😀".into(), true));
    }
}
