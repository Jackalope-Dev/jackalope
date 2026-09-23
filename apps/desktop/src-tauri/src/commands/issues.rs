use super::{account_storage, github_workflows, tasks::TaskRuntime};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::Path, sync::Mutex, time::Duration};
use tauri::State;

static CONNECTION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub provider: String,
    pub site: String,
    pub email: String,
    token: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub id: String,
    pub title: String,
    pub url: String,
    pub state: String,
    pub body: String,
    pub provider: String,
    pub kind: String,
    pub truncated: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    items: Vec<Issue>,
    next: Option<String>,
}

fn connections(runtime: &TaskRuntime) -> Result<Vec<Connection>, String> {
    let path = runtime
        .integration_directory()
        .join("issue-connections.bin");
    account_storage::read(&path)?
        .map(|data| {
            serde_json::from_slice(&data).map_err(|_| {
                "Issue connections could not be read. Your saved settings were preserved.".into()
            })
        })
        .unwrap_or(Ok(Vec::new()))
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}
async fn response(request: reqwest::RequestBuilder) -> Result<Value, String> {
    let mut response = request
        .send()
        .await
        .map_err(|_| "Could not reach the issue service. Check your connection and retry.")?;
    if !response.status().is_success() {
        return Err(format!(
            "The issue service returned {}. Check the connection in Settings → Connected work.",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The issue response was interrupted. Retry.")?
    {
        if bytes.len() + chunk.len() > 2_000_000 {
            return Err("The issue response is too large. Narrow your search.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "The issue service returned an unreadable response.")?;
    if value.get("errors").is_some() {
        return Err(
            "The issue service could not complete this request. Check your access and retry."
                .into(),
        );
    }
    Ok(value)
}
fn validate(connection: &Connection) -> Result<(), String> {
    if !["linear", "jira"].contains(&connection.provider.as_str())
        || connection.token.trim().is_empty()
        || connection.token.len() > 8192
    {
        return Err("Choose Linear or Jira and enter an API token.".into());
    }
    if connection.provider == "jira" {
        let url =
            reqwest::Url::parse(&connection.site).map_err(|_| "Enter your Jira Cloud site URL.")?;
        if url.scheme() != "https"
            || !url
                .host_str()
                .is_some_and(|host| host.ends_with(".atlassian.net"))
            || url.port().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
            || !connection.email.contains('@')
        {
            return Err("Use your https://team.atlassian.net site and account email.".into());
        }
    }
    Ok(())
}
async fn linear(connection: &Connection, query: &str, variables: Value) -> Result<Value, String> {
    response(
        client()?
            .post("https://api.linear.app/graphql")
            .header("Authorization", &connection.token)
            .json(&json!({"query":query,"variables":variables})),
    )
    .await
}
fn jira(connection: &Connection, route: &str) -> Result<reqwest::RequestBuilder, String> {
    validate(connection)?;
    Ok(client()?
        .get(format!(
            "{}{}",
            connection.site.trim_end_matches('/'),
            route
        ))
        .basic_auth(&connection.email, Some(&connection.token)))
}

#[tauri::command]
pub async fn issue_connections(state: State<'_, TaskRuntime>) -> Result<Vec<Value>, String> {
    Ok(connections(&state)?.into_iter().map(|connection| json!({"provider":connection.provider,"site":connection.site,"email":connection.email})).collect())
}
#[tauri::command]
pub async fn issue_connection_save(
    connection: Connection,
    state: State<'_, TaskRuntime>,
) -> Result<(), String> {
    validate(&connection)?;
    if connection.provider == "linear" {
        linear(&connection, "query { viewer { id } }", json!({})).await?;
    } else {
        response(jira(&connection, "/rest/api/3/myself")?).await?;
    }
    let _guard = CONNECTION_LOCK.lock().map_err(|e| e.to_string())?;
    let mut saved = connections(&state)?;
    saved.retain(|item| item.provider != connection.provider);
    saved.push(connection);
    account_storage::write(
        &state.integration_directory().join("issue-connections.bin"),
        &serde_json::to_vec(&saved).map_err(|e| e.to_string())?,
    )
}
#[tauri::command]
pub fn issue_connection_remove(
    provider: String,
    state: State<'_, TaskRuntime>,
) -> Result<(), String> {
    let _guard = CONNECTION_LOCK.lock().map_err(|e| e.to_string())?;
    let mut saved = connections(&state)?;
    saved.retain(|item| item.provider != provider);
    account_storage::write(
        &state.integration_directory().join("issue-connections.bin"),
        &serde_json::to_vec(&saved).map_err(|e| e.to_string())?,
    )
}
fn text(value: &Value, field: &str) -> String {
    value[field].as_str().unwrap_or("").into()
}
fn jira_text(node: &Value) -> String {
    if let Some(text) = node.as_str() {
        return text.into();
    }
    let mut text = node["text"].as_str().unwrap_or("").to_string();
    if let Some(children) = node["content"].as_array() {
        for child in children {
            text.push_str(&jira_text(child));
        }
    }
    if let Some(marks) = node["marks"].as_array() {
        for mark in marks {
            if mark["type"] == "link" {
                if let Some(href) = mark["attrs"]["href"].as_str() {
                    text.push_str(&format!(" ({href})"));
                }
            }
        }
    }
    if node["type"] == "inlineCard" {
        text.push_str(node["attrs"]["url"].as_str().unwrap_or(""));
    }
    if node["type"] == "mention" {
        text.push_str(node["attrs"]["text"].as_str().unwrap_or(""));
    }
    if [
        "paragraph",
        "heading",
        "listItem",
        "hardBreak",
        "codeBlock",
        "tableRow",
    ]
    .iter()
    .any(|kind| node["type"] == *kind)
    {
        text.push('\n');
    }
    text
}
fn issue(provider: &str, value: &Value, site: &str, kind: &str) -> Issue {
    let (id, title, url, state, body) = match provider {
        "linear" => (
            text(value, "identifier"),
            text(value, "title"),
            text(value, "url"),
            text(&value["state"], "name"),
            text(value, "description"),
        ),
        "jira" => (
            text(value, "key"),
            text(&value["fields"], "summary"),
            format!(
                "{}/browse/{}",
                site.trim_end_matches('/'),
                text(value, "key")
            ),
            text(&value["fields"]["status"], "name"),
            jira_text(&value["fields"]["description"]),
        ),
        _ => (
            value["number"].to_string(),
            text(value, "title"),
            text(value, "url"),
            text(value, "state"),
            text(value, "body"),
        ),
    };
    let truncated = body.chars().count() > 10000;
    Issue {
        id,
        title: title.chars().take(300).collect(),
        url,
        state,
        body: body.chars().take(10000).collect(),
        provider: provider.into(),
        kind: kind.into(),
        truncated,
    }
}

#[tauri::command]
pub async fn project_issues(
    project_path: String,
    provider: String,
    kind: String,
    query: String,
    mine: bool,
    cursor: Option<String>,
    state: State<'_, TaskRuntime>,
) -> Result<Page, String> {
    if query.len() > 200
        || cursor.as_ref().is_some_and(|value| value.len() > 2000)
        || !["issue", "pr"].contains(&kind.as_str())
    {
        return Err("Narrow your search and try again.".into());
    }
    if provider == "github" {
        return tauri::async_runtime::spawn_blocking(move || {
            let page = cursor
                .as_deref()
                .unwrap_or("1")
                .parse::<usize>()
                .map_err(|_| "Invalid issue page")?;
            if !(1..=10).contains(&page) {
                return Err("Narrow your search to see more issues.".into());
            }
            let limit = (page * 50 + 1).to_string();
            let mut args = vec![
                kind.as_str(),
                "list",
                "--state",
                "open",
                "--limit",
                &limit,
                "--json",
                "number,title,url,state,body",
            ];
            if !query.trim().is_empty() {
                args.extend(["--search", query.trim()]);
            }
            if mine {
                args.extend(["--assignee", "@me"]);
            }
            let value: Value =
                serde_json::from_str(&github_workflows::gh(Path::new(&project_path), &args)?)
                    .map_err(|_| "GitHub returned an unreadable issue list.")?;
            let rows = value.as_array().ok_or("GitHub returned no issue list.")?;
            Ok(Page {
                items: rows
                    .iter()
                    .skip((page - 1) * 50)
                    .take(50)
                    .map(|value| issue("github", value, "", &kind))
                    .collect(),
                next: (rows.len() > page * 50 && page < 10).then(|| (page + 1).to_string()),
            })
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    let connection = connections(&state)?
        .into_iter()
        .find(|connection| connection.provider == provider)
        .ok_or("Connect this service in Settings → Connected work.")?;
    if provider == "linear" {
        let mut filter = json!({"state":{"type":{"nin":["completed","canceled"]}}});
        if mine {
            filter["assignee"] = json!({"isMe":{"eq":true}});
        }
        if !query.trim().is_empty() {
            filter["title"] = json!({"containsIgnoreCase":query.trim()});
        }
        let value = linear(&connection, "query($filter:IssueFilter,$after:String){issues(first:50,after:$after,filter:$filter,orderBy:updatedAt){nodes{identifier title url description state{name}}pageInfo{hasNextPage endCursor}}}",json!({"filter":filter,"after":cursor})).await?;
        let data = &value["data"]["issues"];
        let rows = data["nodes"]
            .as_array()
            .ok_or("Linear returned no issue list.")?;
        Ok(Page {
            items: rows
                .iter()
                .map(|value| issue("linear", value, "", "issue"))
                .collect(),
            next: if data["pageInfo"]["hasNextPage"] == true {
                data["pageInfo"]["endCursor"].as_str().map(String::from)
            } else {
                None
            },
        })
    } else if provider == "jira" {
        let mut jql = "statusCategory != Done".to_string();
        if mine {
            jql.push_str(" AND assignee = currentUser()");
        }
        if !query.trim().is_empty() {
            let escaped = query.replace('\\', "\\\\").replace('"', "\\\"");
            jql.push_str(&format!(" AND summary ~ \"{escaped}\""));
        }
        jql.push_str(" ORDER BY updated DESC");
        let mut params = vec![
            ("jql", jql),
            ("maxResults", "50".into()),
            ("fields", "summary,status,description".into()),
        ];
        if let Some(cursor) = cursor {
            params.push(("nextPageToken", cursor));
        }
        let mut url = reqwest::Url::parse(&format!(
            "{}/rest/api/3/search/jql",
            connection.site.trim_end_matches('/')
        ))
        .map_err(|_| "Invalid Jira site")?;
        url.query_pairs_mut().extend_pairs(&params);
        let value = response(
            client()?
                .get(url)
                .basic_auth(&connection.email, Some(&connection.token)),
        )
        .await?;
        let rows = value["issues"]
            .as_array()
            .ok_or("Jira returned no issue list.")?;
        Ok(Page {
            items: rows
                .iter()
                .map(|value| issue("jira", value, &connection.site, "issue"))
                .collect(),
            next: value["nextPageToken"].as_str().map(String::from),
        })
    } else {
        Err("Choose a supported issue service.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn jira_credentials_only_go_to_a_cloud_site_root() {
        for site in [
            "http://team.atlassian.net",
            "https://team.atlassian.net.evil.com",
            "https://user@team.atlassian.net",
            "https://team.atlassian.net/path",
            "https://127.0.0.1",
            "https://team.atlassian.net?token=x",
        ] {
            assert!(
                validate(&Connection {
                    provider: "jira".into(),
                    site: site.into(),
                    email: "a@b.com".into(),
                    token: "fixture".into()
                })
                .is_err(),
                "{site}"
            );
        }
        assert!(validate(&Connection {
            provider: "jira".into(),
            site: "https://team.atlassian.net".into(),
            email: "a@b.com".into(),
            token: "fixture".into()
        })
        .is_ok());
    }
    #[test]
    fn long_issue_bodies_remain_valid_and_disclose_the_excerpt() {
        let record = issue(
            "linear",
            &json!({"identifier":"APP-1","title":"Fix","description":"😀".repeat(10001)}),
            "",
            "issue",
        );
        assert!(record.truncated);
        assert_eq!(record.body.chars().count(), 10000);
    }
}
