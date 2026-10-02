//! Cloud swarm: mirrors each live attempt's checked snapshot to its own
//! Artifacts fork through the person's Jackalope Swarm Worker, which compares
//! every fork of the repository and reports overlapping edits, including
//! between agents on different machines.
//!
//! Only projects with a linked Artifacts remote take part. The Worker URL and
//! token stay in protected storage; fork tokens live in memory and are minted
//! again after a restart. Snapshots are synthetic commits on the attempt's
//! starting commit, so nothing is written to the attempt's branch or index.

use super::*;
use crate::commands::{account_storage, cloudflare_artifacts, tasks::TaskRun};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::Path,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const STORAGE_FILE: &str = "swarm.bin";
const SYNC_INTERVAL: Duration = Duration::from_secs(15);
/// Mint a new fork token when the current one has less than this left.
const TOKEN_MARGIN_SECONDS: i64 = 3600;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub url: String,
    token: String,
}

#[derive(Clone)]
struct ForkLink {
    repo: String,
    fork: String,
    remote: String,
    token: String,
    branch: String,
    expires_at: i64,
    pushed_tree: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudState {
    configured: bool,
    repo: Option<String>,
    /// The Worker's view: forks, changed files and conflicts.
    swarm: Option<Value>,
    error: Option<String>,
    synced_at: Option<String>,
}

static FORKS: Mutex<Option<HashMap<String, ForkLink>>> = Mutex::new(None);
static STATES: Mutex<Option<HashMap<String, CloudState>>> = Mutex::new(None);
static SYNC_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

fn storage(runtime: &TaskRuntime) -> std::path::PathBuf {
    runtime.integration_directory().join(STORAGE_FILE)
}

fn connection(runtime: &TaskRuntime) -> Result<Option<Connection>, String> {
    account_storage::read(&storage(runtime))?
        .map(|bytes| {
            serde_json::from_slice(&bytes).map_err(|_| {
                "The saved swarm connection could not be read. Remove it and connect again.".into()
            })
        })
        .transpose()
}

fn validate(connection: &Connection) -> Result<String, String> {
    let url = reqwest::Url::parse(connection.url.trim())
        .map_err(|_| "Enter the URL of your Jackalope Swarm Worker.")?;
    let local = matches!(url.host_str(), Some("127.0.0.1" | "localhost"));
    if !(url.scheme() == "https" || (url.scheme() == "http" && local))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "Use the Worker's https:// URL (http:// only for a local wrangler dev).".into(),
        );
    }
    if connection.token.len() < 32
        || connection.token.len() > 512
        || connection
            .token
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(
            "Use the SWARM_TOKEN secret you set on the Worker (at least 32 characters).".into(),
        );
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}

async fn call(
    connection: &Connection,
    method: reqwest::Method,
    route: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let mut request = client()?
        .request(method, format!("{}{route}", connection.url))
        .bearer_auth(&connection.token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Could not reach the swarm Worker.".to_string())?;
    let status = response.status();
    let value: Value = response.json().await.unwrap_or(Value::Null);
    if status.as_u16() == 401 {
        return Err("The swarm Worker rejected the token. Check SWARM_TOKEN.".into());
    }
    if !status.is_success() {
        let detail = value["error"].as_str().unwrap_or("");
        return Err(format!(
            "The swarm Worker returned {status}{}{}",
            if detail.is_empty() { "" } else { ": " },
            detail.chars().take(300).collect::<String>()
        ));
    }
    Ok(value)
}

fn segment(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .collect()
}

fn remember_state(project_id: &str, state: CloudState) {
    if let Ok(mut states) = STATES.lock() {
        states
            .get_or_insert_with(HashMap::new)
            .insert(project_id.into(), state);
    }
}

async fn register(
    connection: &Connection,
    repo: &str,
    run: &TaskRun,
    title: &str,
) -> Result<ForkLink, String> {
    let created = call(
        connection,
        reqwest::Method::POST,
        &format!("/v1/swarms/{}/forks", segment(repo)),
        Some(json!({
            "attemptId": run.id,
            "agent": run.agent,
            "title": title,
            "baseCommit": run.base_head,
        })),
    )
    .await?;
    let text = |key: &str| created[key].as_str().unwrap_or_default().to_string();
    let expires_at = chrono::DateTime::parse_from_rfc3339(&text("tokenExpiresAt"))
        .map(|time| time.timestamp())
        .unwrap_or_else(|_| now() + 3600);
    if text("fork").is_empty() || text("remote").is_empty() || text("token").is_empty() {
        return Err("The swarm Worker did not return a fork.".into());
    }
    Ok(ForkLink {
        repo: repo.into(),
        fork: text("fork"),
        remote: text("remote"),
        token: text("token"),
        branch: Some(text("branch"))
            .filter(|b| !b.is_empty())
            .unwrap_or_else(|| "main".into()),
        expires_at,
        pushed_tree: None,
    })
}

/// Pushes one attempt's snapshot when it changed and asks the Worker to re-analyze.
async fn sync_run(
    connection: &Connection,
    repo: &str,
    run: &TaskRun,
    tree: &str,
    title: &str,
) -> Result<(), String> {
    let existing = FORKS
        .lock()
        .ok()
        .and_then(|forks| forks.as_ref()?.get(&run.id).cloned());
    let mut link = match existing {
        Some(link) if link.repo == repo => link,
        _ => register(connection, repo, run, title).await?,
    };
    if link.expires_at - now() < TOKEN_MARGIN_SECONDS {
        let fresh = call(
            connection,
            reqwest::Method::POST,
            &format!(
                "/v1/swarms/{}/forks/{}/token",
                segment(repo),
                segment(&link.fork)
            ),
            None,
        )
        .await?;
        if let Some(token) = fresh["token"].as_str() {
            link.token = token.into();
            link.expires_at = fresh["tokenExpiresAt"]
                .as_str()
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .map(|time| time.timestamp())
                .unwrap_or_else(|| now() + 3600);
        }
    }
    if link.pushed_tree.as_deref() != Some(tree) {
        let workspace = run.workspace.clone();
        let (tree_owned, base, remote, token, branch) = (
            tree.to_string(),
            run.base_head.clone(),
            link.remote.clone(),
            link.token.clone(),
            link.branch.clone(),
        );
        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            let path = Path::new(&workspace);
            let commit = peers::synthetic_commit(path, &tree_owned, &base)?;
            let refspec = format!("+{commit}:refs/heads/{branch}");
            cloudflare_artifacts::push_with_token(path, &remote, &token, &[&refspec]).map(|_| ())
        })
        .await
        .map_err(|e| e.to_string())??;
        call(
            connection,
            reqwest::Method::POST,
            &format!(
                "/v1/swarms/{}/forks/{}/analyze",
                segment(repo),
                segment(&link.fork)
            ),
            None,
        )
        .await?;
        link.pushed_tree = Some(tree.into());
    }
    if let Ok(mut forks) = FORKS.lock() {
        forks
            .get_or_insert_with(HashMap::new)
            .insert(run.id.clone(), link);
    }
    Ok(())
}

/// One pass over every linked project. Errors are kept per project for the UI.
pub(super) async fn sync(service: &Coordinator) -> Result<(), String> {
    let _single = SYNC_LOCK.lock().await;
    let Some(connection) = connection(&service.runtime)? else {
        return Ok(());
    };
    let view = service.view()?;
    let runs = service.runtime.integration_runs()?;
    let (snapshots, view) = tauri::async_runtime::spawn_blocking(move || {
        let snapshots = peers::snapshots(&view, &runs);
        (snapshots, view)
    })
    .await
    .map_err(|e| e.to_string())?;
    let mut projects: HashMap<String, (String, Vec<(TaskRun, String)>)> = HashMap::new();
    for (run, tree) in snapshots {
        let path = run.project_path.clone();
        let Some((_, repo)) = tauri::async_runtime::spawn_blocking(move || {
            cloudflare_artifacts::linked_repository(Path::new(&path))
        })
        .await
        .map_err(|e| e.to_string())?
        else {
            continue;
        };
        projects
            .entry(run.project_id.clone())
            .or_insert_with(|| (repo, Vec::new()))
            .1
            .push((run, tree));
    }
    let active: Vec<String> = projects
        .values()
        .flat_map(|(_, runs)| runs.iter().map(|(run, _)| run.id.clone()))
        .collect();
    for (project_id, (repo, runs)) in &projects {
        let mut error = None;
        for (run, tree) in runs {
            let title = peers::title(&view, run);
            if let Err(cause) = sync_run(&connection, repo, run, tree, &title).await {
                error = Some(cause);
            }
        }
        let swarm = call(
            &connection,
            reqwest::Method::GET,
            &format!("/v1/swarms/{}", segment(repo)),
            None,
        )
        .await;
        let (swarm, read_error) = match swarm {
            Ok(value) => (Some(value), None),
            Err(cause) => (None, Some(cause)),
        };
        remember_state(
            project_id,
            CloudState {
                configured: true,
                repo: Some(repo.clone()),
                swarm,
                error: error.or(read_error),
                synced_at: Some(chrono::Utc::now().to_rfc3339()),
            },
        );
    }
    // Attempts that finished, were integrated or archived give their forks back.
    let finished: Vec<ForkLink> = FORKS
        .lock()
        .ok()
        .and_then(|mut forks| {
            let forks = forks.as_mut()?;
            let gone: Vec<String> = forks
                .keys()
                .filter(|id| !active.contains(id))
                .cloned()
                .collect();
            Some(gone.iter().filter_map(|id| forks.remove(id)).collect())
        })
        .unwrap_or_default();
    for link in finished {
        let _ = call(
            &connection,
            reqwest::Method::DELETE,
            &format!(
                "/v1/swarms/{}/forks/{}?delete=1",
                segment(&link.repo),
                segment(&link.fork)
            ),
            None,
        )
        .await;
    }
    Ok(())
}

/// Runs the sync for the lifetime of the app.
pub fn launch(service: Coordinator) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(error) = sync(&service).await {
                eprintln!("swarm sync: {error}");
            }
            tokio::time::sleep(SYNC_INTERVAL).await;
        }
    });
}

#[tauri::command]
pub fn swarm_connection_status(state: State<'_, Coordinator>) -> Result<Value, String> {
    Ok(match connection(&state.runtime)? {
        Some(connection) => json!({"configured": true, "url": connection.url}),
        None => json!({"configured": false}),
    })
}

/// Checks the Worker and token before saving them.
#[tauri::command]
pub async fn swarm_connection_save(
    url: String,
    token: String,
    state: State<'_, Coordinator>,
) -> Result<Value, String> {
    let mut candidate = Connection {
        url,
        token: token.trim().into(),
    };
    candidate.url = validate(&candidate)?;
    call(
        &candidate,
        reqwest::Method::GET,
        "/v1/swarms/jackalope-connection-check",
        None,
    )
    .await?;
    account_storage::write(
        &storage(&state.runtime),
        &serde_json::to_vec(&candidate).map_err(|e| e.to_string())?,
    )?;
    let service = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        let _ = sync(&service).await;
    });
    Ok(json!({"configured": true, "url": candidate.url}))
}

#[tauri::command]
pub fn swarm_connection_remove(state: State<'_, Coordinator>) -> Result<(), String> {
    account_storage::remove(&storage(&state.runtime))?;
    if let Ok(mut forks) = FORKS.lock() {
        *forks = None;
    }
    if let Ok(mut states) = STATES.lock() {
        *states = None;
    }
    Ok(())
}

/// The latest synced view for one project.
#[tauri::command]
pub fn swarm_cloud_state(
    project_id: String,
    state: State<'_, Coordinator>,
) -> Result<CloudState, String> {
    let configured = connection(&state.runtime)?.is_some();
    let cached = STATES
        .lock()
        .ok()
        .and_then(|states| states.as_ref()?.get(&project_id).cloned());
    Ok(cached.filter(|_| configured).unwrap_or(CloudState {
        configured,
        repo: None,
        swarm: None,
        error: None,
        synced_at: None,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_urls_must_be_https_or_local_development() {
        let token = "t".repeat(40);
        let check = |url: &str| {
            validate(&Connection {
                url: url.into(),
                token: token.clone(),
            })
        };
        assert_eq!(
            check("https://swarm.example.workers.dev/").unwrap(),
            "https://swarm.example.workers.dev"
        );
        assert!(check("http://127.0.0.1:8787").is_ok());
        assert!(check("http://example.com").is_err());
        assert!(check("https://user:pass@example.com").is_err());
        assert!(validate(&Connection {
            url: "https://example.com".into(),
            token: "short".into()
        })
        .is_err());
    }

    #[test]
    fn route_segments_drop_anything_outside_artifact_names() {
        assert_eq!(segment("app--3f2a/../x?y"), "app--3f2a..xy");
    }
}
