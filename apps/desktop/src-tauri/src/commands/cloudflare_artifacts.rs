//! Cloudflare Artifacts as a bring-your-own-account project remote.
//!
//! The Cloudflare API token authenticates control-plane calls and stays in
//! protected storage. Git access uses short-lived repo-scoped tokens passed to
//! Git through environment configuration scoped to the Artifacts host, so they
//! never enter argv, remote URLs, `.git/config` or saved history.

use super::{
    account_storage,
    git_command::{command, Policy},
    process_control,
    tasks::{ProjectInfo, TaskRuntime},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, State};

mod oauth;

static CONNECTION_LOCK: Mutex<()> = Mutex::new(());
/// Serializes OAuth refreshes; Cloudflare rotates refresh tokens on use.
static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const STORAGE_FILE: &str = "cloudflare-artifacts.bin";
const REMOTE_NAME: &str = "artifacts";
const API_ROOT: &str = "https://api.cloudflare.com/client/v4/accounts";
const PUSH_TOKEN_TTL_SECONDS: u64 = 900;
const PUSH_TIMEOUT: Duration = Duration::from_secs(900);
/// Local task branches are per-attempt scratch space; pushing them would flood
/// the shared repository with work that has not been reviewed or integrated.
const PUSH_REFSPECS: [&str; 4] = [
    "refs/heads/*:refs/heads/*",
    "^refs/heads/jackalope/*",
    "refs/tags/*:refs/tags/*",
    "refs/notes/*:refs/notes/*",
];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub account_id: String,
    pub namespace: String,
    #[serde(default)]
    pub jurisdiction: Option<String>,
    /// An API token, or the current OAuth access token when `oauth` is set.
    token: String,
    /// Present for Connect Cloudflare sign-ins; never accepted from the renderer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    oauth: Option<oauth::Grant>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    connected: bool,
    account_id: Option<String>,
    namespace: Option<String>,
    jurisdiction: Option<String>,
    /// `oauth` for Connect Cloudflare, `token` for a pasted API token.
    method: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLink {
    repository: bool,
    remote: Option<String>,
    repo: Option<String>,
    namespace: Option<String>,
    /// The project has an Artifacts remote in a namespace or account other than the connected one.
    foreign: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedProject {
    project: ProjectInfo,
    repo: String,
    remote: String,
    /// Set when the repository and folder exist but the first push failed.
    push_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    repo: String,
    remote: String,
    summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewShare {
    repo: String,
    remote: String,
    expires_at: String,
    /// Contains a read token. Shown once; never saved.
    clone_command: String,
}

fn storage_path(runtime: &TaskRuntime) -> PathBuf {
    runtime.integration_directory().join(STORAGE_FILE)
}

fn saved(runtime: &TaskRuntime) -> Result<Option<Connection>, String> {
    account_storage::read(&storage_path(runtime))?
        .map(|data| {
            serde_json::from_slice(&data).map_err(|_| {
                "The Cloudflare Artifacts connection could not be read. Your saved settings were preserved.".into()
            })
        })
        .transpose()
}

fn connection(runtime: &TaskRuntime) -> Result<Connection, String> {
    saved(runtime)?
        .ok_or_else(|| "Connect Cloudflare Artifacts in Settings → Connected work.".to_string())
}

/// The saved connection with a usable access token, refreshing an OAuth sign-in
/// that is about to expire. API tokens are returned unchanged.
async fn current(runtime: &TaskRuntime) -> Result<Connection, String> {
    let saved_connection = connection(runtime)?;
    if !saved_connection
        .oauth
        .as_ref()
        .is_some_and(oauth::needs_refresh)
    {
        return Ok(saved_connection);
    }
    let _refresh = REFRESH_LOCK.lock().await;
    // Another request may have refreshed while this one waited.
    let latest = connection(runtime)?;
    let Some(grant) = latest.oauth.clone().filter(oauth::needs_refresh) else {
        return Ok(latest);
    };
    let tokens = oauth::refresh(&grant).await?;
    let next = Connection {
        token: tokens.access,
        oauth: Some(tokens.grant),
        ..latest
    };
    let _guard = CONNECTION_LOCK.lock().map_err(|e| e.to_string())?;
    account_storage::write(
        &storage_path(runtime),
        &serde_json::to_vec(&next).map_err(|e| e.to_string())?,
    )?;
    Ok(next)
}

fn connected_status(connection: &Connection) -> Status {
    Status {
        connected: true,
        account_id: Some(connection.account_id.clone()),
        namespace: Some(connection.namespace.clone()),
        jurisdiction: connection.jurisdiction.clone(),
        method: Some(if connection.oauth.is_some() {
            "oauth"
        } else {
            "token"
        }),
    }
}

fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn validate_namespace(namespace: &str) -> Result<(), String> {
    if !(2..=63).contains(&namespace.len()) || !valid_name(namespace) {
        return Err("Use a namespace of 2–63 letters, digits, dots, underscores or hyphens, starting with a letter or digit.".into());
    }
    Ok(())
}

fn validate_repo_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 100 || !valid_name(name) || name.ends_with(".git") {
        return Err("Use a repository name of letters, digits, dots, underscores or hyphens, starting with a letter or digit.".into());
    }
    Ok(())
}

fn validate(connection: &Connection) -> Result<(), String> {
    if connection.account_id.len() != 32
        || !connection
            .account_id
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err("Enter the 32-character account ID from your Cloudflare dashboard.".into());
    }
    validate_namespace(&connection.namespace)?;
    if connection
        .jurisdiction
        .as_deref()
        .is_some_and(|value| !matches!(value, "eu" | "us"))
    {
        return Err("Choose EU, US or no data location restriction.".into());
    }
    if connection.token.is_empty()
        || connection.token.len() > 8192
        || connection
            .token
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("Enter a Cloudflare API token with Artifacts Edit permission.".into());
    }
    Ok(())
}

/// Only an Artifacts Git host may receive a repo token.
fn remote_origin(remote: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(remote).map_err(|_| "Cloudflare returned an invalid remote.")?;
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https"
        || !host.ends_with(".artifacts.cloudflare.net")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.path().starts_with("/git/")
    {
        return Err("Cloudflare returned a remote outside Artifacts. Nothing was pushed.".into());
    }
    Ok(format!("https://{host}"))
}

/// `/git/<namespace>/<repo>.git` → (namespace, repo).
fn remote_identity(remote: &str) -> Option<(String, String)> {
    remote_origin(remote).ok()?;
    let url = reqwest::Url::parse(remote).ok()?;
    let mut parts = url.path().trim_start_matches("/git/").split('/');
    let namespace = parts.next()?.to_string();
    let repo = parts.next()?.strip_suffix(".git")?.to_string();
    (parts.next().is_none() && valid_name(&namespace) && valid_name(&repo))
        .then_some((namespace, repo))
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}

fn api_message(status: u16, body: &Value) -> String {
    let code = body["errors"][0]["code"].as_u64().unwrap_or_default();
    match (status, code) {
        (401 | 403, _) => "Cloudflare refused this API token. Use a token with Account → Artifacts → Edit for this account, on the Workers Paid plan.".into(),
        (_, 10201) => "A repository with that name already exists in this namespace. Choose another name.".into(),
        (_, 10200) => "Cloudflare could not find that repository or namespace.".into(),
        (_, 10101) => "Cloudflare rejected the repository name. Use letters, digits, dots, underscores or hyphens.".into(),
        (_, 10302 | 10303) => "The repository is still being prepared. Retry in a moment.".into(),
        (429, _) => "Cloudflare is rate limiting Artifacts requests. Retry shortly.".into(),
        _ => {
            let detail: String = body["errors"][0]["message"]
                .as_str()
                .unwrap_or_default()
                .chars()
                .filter(|c| !c.is_control())
                .take(200)
                .collect();
            if detail.is_empty() {
                format!("Cloudflare Artifacts returned {status}. Retry, or check the Artifacts dashboard.")
            } else {
                format!("Cloudflare Artifacts returned {status}: {detail}")
            }
        }
    }
}

async fn call(
    connection: &Connection,
    method: reqwest::Method,
    route: &str,
    body: Option<Value>,
) -> Result<(u16, Value), String> {
    let mut request = client()?
        .request(
            method,
            format!("{API_ROOT}/{}/artifacts{route}", connection.account_id),
        )
        .bearer_auth(&connection.token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "Could not reach Cloudflare. Check your connection and retry.")?;
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The Cloudflare response was interrupted. Retry.")?
    {
        if bytes.len() + chunk.len() > 1_000_000 {
            return Err("Cloudflare returned an unexpectedly large response.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    Ok((status, value))
}

async fn expect(
    connection: &Connection,
    method: reqwest::Method,
    route: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let (status, value) = call(connection, method, route, body).await?;
    if !(200..300).contains(&status) || value["success"] != true {
        return Err(api_message(status, &value));
    }
    Ok(value["result"].clone())
}

fn namespace_route(connection: &Connection, rest: &str) -> String {
    format!("/namespaces/{}{rest}", connection.namespace)
}

struct RepoAccess {
    repo: String,
    remote: String,
    token: String,
    token_id: Option<String>,
}

async fn create_repo(
    connection: &Connection,
    name: &str,
    description: &str,
    default_branch: &str,
) -> Result<RepoAccess, String> {
    let mut body = json!({"name": name, "default_branch": default_branch});
    if !description.trim().is_empty() {
        body["description"] = json!(description.trim().chars().take(500).collect::<String>());
    }
    let result = expect(
        connection,
        reqwest::Method::POST,
        &namespace_route(connection, "/repos"),
        Some(body),
    )
    .await?;
    let remote = result["remote"].as_str().unwrap_or_default().to_string();
    remote_origin(&remote)?;
    Ok(RepoAccess {
        repo: name.into(),
        remote,
        token: result["token"].as_str().unwrap_or_default().into(),
        token_id: None,
    })
}

async fn delete_repo(connection: &Connection, name: &str) {
    let _ = call(
        connection,
        reqwest::Method::DELETE,
        &namespace_route(connection, &format!("/repos/{name}")),
        None,
    )
    .await;
}

async fn mint_token(
    connection: &Connection,
    repo: &str,
    scope: &str,
    ttl: u64,
) -> Result<(String, String, String), String> {
    let result = expect(
        connection,
        reqwest::Method::POST,
        &namespace_route(connection, "/tokens"),
        Some(json!({"repo": repo, "scope": scope, "ttl": ttl})),
    )
    .await?;
    let token = result["plaintext"].as_str().unwrap_or_default().to_string();
    if token.is_empty() {
        return Err("Cloudflare did not return a repository token.".into());
    }
    Ok((
        token,
        result["id"].as_str().unwrap_or_default().into(),
        result["expires_at"].as_str().unwrap_or_default().into(),
    ))
}

async fn revoke_token(connection: &Connection, id: &str) {
    if !id.is_empty() {
        let _ = call(
            connection,
            reqwest::Method::DELETE,
            &namespace_route(connection, &format!("/tokens/{id}")),
            None,
        )
        .await;
    }
}

async fn repo_remote(connection: &Connection, repo: &str) -> Result<String, String> {
    let result = expect(
        connection,
        reqwest::Method::GET,
        &namespace_route(connection, &format!("/repos/{repo}")),
        None,
    )
    .await?;
    let remote = result["remote"].as_str().unwrap_or_default().to_string();
    remote_origin(&remote)?;
    Ok(remote)
}

fn git(path: &Path, args: &[&str]) -> Result<String, String> {
    let output = command(path, args, Policy::Inspection)
        .stdin(Stdio::null())
        .output()
        .map_err(|_| "Git could not be started. Install Git, then try again.".to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}

fn same_path(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

/// The project folder must be the top level of a repository with at least one commit.
fn repository_root(project_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(project_path);
    let top = git(&path, &["rev-parse", "--show-toplevel"])
        .map_err(|_| "Artifacts needs a Git repository. Initialize Git for this project first.")?;
    if !same_path(Path::new(&top), &path) {
        return Err(
            "Open the repository's top-level folder as the project to use Artifacts.".into(),
        );
    }
    git(
        &path,
        &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
    )
    .map_err(|_| "Commit at least once before moving this project to Artifacts.")?;
    Ok(path)
}

fn linked_remote(path: &Path) -> Option<String> {
    git(path, &["remote", "get-url", REMOTE_NAME])
        .ok()
        .filter(|remote| remote_identity(remote).is_some())
}

fn scrub(text: &str, secret: &str) -> String {
    let secret = secret.split('?').next().unwrap_or(secret);
    let cleaned = if secret.is_empty() {
        text.to_string()
    } else {
        text.replace(secret, "[redacted]")
    };
    let mut bounded: String = cleaned.chars().take(4000).collect();
    if cleaned.chars().count() > 4000 {
        bounded.push('…');
    }
    bounded
}

/// Pushes with a token visible only to this Git process and only for the Artifacts host.
fn push(path: &Path, remote: &str, token: &str, refspecs: &[&str]) -> Result<String, String> {
    let origin = remote_origin(remote)?;
    let mut args = vec!["push", "--porcelain", remote];
    args.extend_from_slice(refspecs);
    let mut push = command(path, &args, Policy::Isolated);
    push.env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("GIT_CONFIG_COUNT", "2")
        .env("GIT_CONFIG_KEY_0", format!("http.{origin}/.extraHeader"))
        .env(
            "GIT_CONFIG_VALUE_0",
            format!("Authorization: Bearer {token}"),
        )
        // Without this a rejected token would open a system credential prompt.
        .env("GIT_CONFIG_KEY_1", format!("credential.{origin}/.helper"))
        .env("GIT_CONFIG_VALUE_1", "")
        .stdin(Stdio::null());
    let result = process_control::run(push, PUSH_TIMEOUT)?;
    let output = scrub(
        format!("{}\n{}", result.stdout.trim(), result.stderr.trim()).trim(),
        token,
    );
    if result.timed_out || result.stalled {
        return Err("The push to Artifacts took too long and was stopped.".into());
    }
    if !result.success {
        return Err(if output.is_empty() {
            "Git could not push to Artifacts.".into()
        } else {
            format!("Git could not push to Artifacts:\n{output}")
        });
    }
    let updated = result
        .stdout
        .lines()
        .filter(|line| line.starts_with(['*', '+', ' ', '-']) && line.contains('\t'))
        .count();
    Ok(match updated {
        0 => "Artifacts already has every branch and tag.".into(),
        1 => "Pushed 1 ref to Artifacts.".into(),
        count => format!("Pushed {count} refs to Artifacts."),
    })
}

fn current_branch(path: &Path) -> String {
    git(path, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .ok()
        .filter(|branch| !branch.is_empty() && !branch.starts_with("jackalope/"))
        .unwrap_or_else(|| "main".into())
}

#[tauri::command]
pub fn cloudflare_artifacts_status(state: State<'_, TaskRuntime>) -> Result<Status, String> {
    Ok(match saved(&state)? {
        Some(connection) => connected_status(&connection),
        None => Status {
            connected: false,
            account_id: None,
            namespace: None,
            jurisdiction: None,
            method: None,
        },
    })
}

#[tauri::command]
pub async fn cloudflare_artifacts_connect(
    connection: Connection,
    state: State<'_, TaskRuntime>,
) -> Result<Status, String> {
    let connection = Connection {
        account_id: connection.account_id.trim().to_ascii_lowercase(),
        namespace: connection.namespace.trim().into(),
        jurisdiction: connection.jurisdiction.filter(|value| !value.is_empty()),
        token: connection.token.trim().into(),
        oauth: None,
    };
    establish(connection, &state).await
}

/// Validates the connection against its namespace and saves it.
async fn establish(connection: Connection, runtime: &TaskRuntime) -> Result<Status, String> {
    validate(&connection)?;
    let (status, value) = call(
        &connection,
        reqwest::Method::GET,
        &namespace_route(&connection, ""),
        None,
    )
    .await?;
    if status == 404 || value["errors"][0]["code"] == 10200 {
        // Artifacts creates a namespace with its first repository, but a data
        // location can only be chosen when the namespace is created.
        if connection.jurisdiction.is_some() {
            expect(
                &connection,
                reqwest::Method::POST,
                "/namespaces",
                Some(json!({"namespace": connection.namespace, "jurisdiction": connection.jurisdiction})),
            )
            .await?;
        } else {
            expect(
                &connection,
                reqwest::Method::GET,
                "/namespaces?limit=1",
                None,
            )
            .await?;
        }
    } else if !(200..300).contains(&status) || value["success"] != true {
        return Err(api_message(status, &value));
    } else if let (Some(requested), Some(existing)) = (
        connection.jurisdiction.as_deref(),
        value["result"]["jurisdiction"].as_str(),
    ) {
        if requested != existing {
            return Err(format!(
                "The {} namespace already stores data in {}. Choose that location or another namespace.",
                connection.namespace,
                existing.to_uppercase()
            ));
        }
    }
    let _guard = CONNECTION_LOCK.lock().map_err(|e| e.to_string())?;
    account_storage::write(
        &storage_path(runtime),
        &serde_json::to_vec(&connection).map_err(|e| e.to_string())?,
    )?;
    Ok(connected_status(&connection))
}

/// Starts Connect Cloudflare and returns the consent URL for the browser.
#[tauri::command]
pub async fn cloudflare_oauth_begin() -> Result<String, String> {
    oauth::begin().await
}

/// Waits for the browser sign-in and returns the accounts the person shared.
#[tauri::command]
pub async fn cloudflare_oauth_complete() -> Result<Vec<oauth::Account>, String> {
    oauth::complete().await
}

#[tauri::command]
pub fn cloudflare_oauth_cancel() {
    oauth::cancel();
}

/// Saves the signed-in connection for the chosen account and namespace.
#[tauri::command]
pub async fn cloudflare_oauth_connect(
    account_id: String,
    namespace: String,
    jurisdiction: Option<String>,
    state: State<'_, TaskRuntime>,
) -> Result<Status, String> {
    let account_id = account_id.trim().to_ascii_lowercase();
    let tokens = oauth::signed_in(&account_id)?;
    let result = establish(
        Connection {
            account_id,
            namespace: namespace.trim().into(),
            jurisdiction: jurisdiction.filter(|value| !value.is_empty()),
            token: tokens.access,
            oauth: Some(tokens.grant),
        },
        &state,
    )
    .await?;
    oauth::finish();
    Ok(result)
}

#[tauri::command]
pub async fn cloudflare_artifacts_disconnect(state: State<'_, TaskRuntime>) -> Result<(), String> {
    if let Some(grant) = saved(&state).ok().flatten().and_then(|saved| saved.oauth) {
        oauth::revoke(&grant).await;
    }
    let _guard = CONNECTION_LOCK.lock().map_err(|e| e.to_string())?;
    match std::fs::remove_file(storage_path(&state)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not remove the saved connection: {error}")),
    }
}

#[tauri::command]
pub async fn cloudflare_artifacts_project(
    project_path: String,
    state: State<'_, TaskRuntime>,
) -> Result<ProjectLink, String> {
    let connected = saved(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&project_path);
        let repository = repository_root(&project_path).is_ok();
        let remote = repository.then(|| linked_remote(&path)).flatten();
        let identity = remote.as_deref().and_then(remote_identity);
        let foreign = match (&remote, &identity, &connected) {
            (Some(remote), Some((namespace, _)), Some(connection)) => {
                namespace != &connection.namespace
                    || !remote.contains(&format!("//{}.", connection.account_id))
            }
            _ => false,
        };
        Ok(ProjectLink {
            repository,
            remote,
            namespace: identity.as_ref().map(|(namespace, _)| namespace.clone()),
            repo: identity.map(|(_, repo)| repo),
            foreign,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cloudflare_artifacts_create_project(
    app: AppHandle,
    name: String,
    parent_path: Option<String>,
    repo_name: String,
    state: State<'_, TaskRuntime>,
) -> Result<CreatedProject, String> {
    let connection = current(&state).await?;
    validate_repo_name(&repo_name)?;
    let name = super::tasks::validate_project_name(&name)?.to_string();
    let (parent, create_parent) = match parent_path {
        Some(path) => (PathBuf::from(path), false),
        None => (super::tasks::default_project_directory(&app)?, true),
    };
    {
        let (parent, name) = (parent.clone(), name.clone());
        tauri::async_runtime::spawn_blocking(move || {
            git(&std::env::temp_dir(), &["--version"])
                .map_err(|_| "Artifacts projects need Git. Install Git, then try again.")?;
            if create_parent {
                std::fs::create_dir_all(&parent).map_err(|_| {
                    "Could not create the default projects folder. Choose another location."
                })?;
            }
            if parent.join(&name).exists() {
                return Err("That folder already exists. Choose another name or open it as an existing project.".to_string());
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())??;
    }
    let access = create_repo(&connection, &repo_name, &name, "main").await?;
    let created = {
        let (parent, name) = (parent.clone(), name.clone());
        tauri::async_runtime::spawn_blocking(move || {
            super::tasks::create_project_folder(&parent, &name)
        })
        .await
        .map_err(|e| e.to_string())?
    };
    let project = match created {
        Ok(project) if project.repository => project,
        Ok(project) => {
            delete_repo(&connection, &repo_name).await;
            let _ = std::fs::remove_dir_all(&project.path);
            return Err("Git could not initialize the project folder.".into());
        }
        Err(error) => {
            delete_repo(&connection, &repo_name).await;
            return Err(error);
        }
    };
    let path = PathBuf::from(&project.path);
    let remote = access.remote.clone();
    let token = access.token.clone();
    let push_error = tauri::async_runtime::spawn_blocking(move || {
        git(&path, &["remote", "add", REMOTE_NAME, &remote])?;
        push(&path, &remote, &token, &["refs/heads/main:refs/heads/main"]).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
    .err();
    Ok(CreatedProject {
        project,
        repo: access.repo,
        remote: access.remote,
        push_error,
    })
}

#[tauri::command]
pub async fn cloudflare_artifacts_convert(
    project_path: String,
    repo_name: String,
    description: String,
    state: State<'_, TaskRuntime>,
) -> Result<PushResult, String> {
    let connection = current(&state).await?;
    validate_repo_name(&repo_name)?;
    let checked = project_path.clone();
    let (path, branch) = tauri::async_runtime::spawn_blocking(move || {
        let path = repository_root(&checked)?;
        if git(&path, &["remote", "get-url", REMOTE_NAME]).is_ok() {
            return Err(format!(
                "This repository already has a remote named {REMOTE_NAME}. Rename or remove it to continue."
            ));
        }
        let branch = current_branch(&path);
        Ok((path, branch))
    })
    .await
    .map_err(|e| e.to_string())??;
    let access = create_repo(&connection, &repo_name, &description, &branch).await?;
    let remote = access.remote.clone();
    let token = access.token.clone();
    let summary = tauri::async_runtime::spawn_blocking(move || {
        git(&path, &["remote", "add", REMOTE_NAME, &remote])?;
        push(&path, &remote, &token, &PUSH_REFSPECS)
    })
    .await
    .map_err(|e| e.to_string())?;
    match summary {
        Ok(summary) => Ok(PushResult {
            repo: access.repo,
            remote: access.remote,
            summary,
        }),
        // The remote stays so Push to Artifacts can retry without creating another repository.
        Err(error) => Err(format!(
            "Created {} in Artifacts, but the first push failed. Use Push to Artifacts to retry.\n{error}",
            access.repo
        )),
    }
}

#[tauri::command]
pub async fn cloudflare_artifacts_push(
    project_path: String,
    state: State<'_, TaskRuntime>,
) -> Result<PushResult, String> {
    let connection = current(&state).await?;
    let checked = project_path.clone();
    let (path, remote) = tauri::async_runtime::spawn_blocking(move || {
        let path = repository_root(&checked)?;
        let remote = linked_remote(&path)
            .ok_or("Move this project to Artifacts before pushing.".to_string())?;
        Ok::<_, String>((path, remote))
    })
    .await
    .map_err(|e| e.to_string())??;
    let (namespace, repo) = remote_identity(&remote).ok_or("Invalid Artifacts remote.")?;
    if namespace != connection.namespace
        || !remote.contains(&format!("//{}.", connection.account_id))
    {
        return Err("This project uses an Artifacts repository outside the connected account and namespace.".into());
    }
    let mut access = RepoAccess {
        repo: repo.clone(),
        remote: repo_remote(&connection, &repo).await?,
        token: String::new(),
        token_id: None,
    };
    let (token, id, _) = mint_token(&connection, &repo, "write", PUSH_TOKEN_TTL_SECONDS).await?;
    access.token = token;
    access.token_id = Some(id);
    let (remote, token) = (access.remote.clone(), access.token.clone());
    let summary =
        tauri::async_runtime::spawn_blocking(move || push(&path, &remote, &token, &PUSH_REFSPECS))
            .await
            .map_err(|e| e.to_string())?;
    revoke_token(&connection, access.token_id.as_deref().unwrap_or_default()).await;
    Ok(PushResult {
        repo: access.repo,
        remote: access.remote,
        summary: summary?,
    })
}

#[tauri::command]
pub async fn cloudflare_artifacts_share(
    project_path: String,
    hours: u64,
    state: State<'_, TaskRuntime>,
) -> Result<ReviewShare, String> {
    let connection = current(&state).await?;
    if ![1, 24, 168].contains(&hours) {
        return Err("Choose 1 hour, 1 day or 7 days.".into());
    }
    let checked = project_path.clone();
    let remote = tauri::async_runtime::spawn_blocking(move || {
        linked_remote(&repository_root(&checked)?)
            .ok_or("Move this project to Artifacts before sharing.".to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    let (namespace, repo) = remote_identity(&remote).ok_or("Invalid Artifacts remote.")?;
    if namespace != connection.namespace {
        return Err(
            "This project uses an Artifacts repository outside the connected namespace.".into(),
        );
    }
    let stamp = chrono::Utc::now().format("%Y%m%d%H%M%S");
    let base: String = repo.chars().take(80).collect();
    let fork_name = format!("{base}-review-{stamp}");
    // A read-only fork freezes what was last pushed, so later pushes never change what the reviewer sees.
    let fork = expect(
        &connection,
        reqwest::Method::POST,
        &namespace_route(&connection, &format!("/repos/{repo}/fork")),
        Some(json!({
            "name": fork_name,
            "description": format!("Review snapshot of {repo}"),
            "read_only": true,
        })),
    )
    .await?;
    let fork_remote = fork["remote"].as_str().unwrap_or_default().to_string();
    remote_origin(&fork_remote)?;
    let mut attempt = 0;
    let (token, _, expires_at) = loop {
        match mint_token(&connection, &fork_name, "read", hours * 3600).await {
            Ok(minted) => break minted,
            // Forks become readable asynchronously.
            Err(error) if attempt < 5 && error.contains("still being prepared") => {
                attempt += 1;
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            Err(error) => return Err(error),
        }
    };
    let secret = token.split('?').next().unwrap_or(&token);
    let authenticated = fork_remote.replacen("https://", &format!("https://x:{secret}@"), 1);
    Ok(ReviewShare {
        repo: fork_name.clone(),
        remote: fork_remote,
        expires_at,
        clone_command: format!("git clone {authenticated} {fork_name}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Connection {
        Connection {
            account_id: "0123456789abcdef0123456789abcdef".into(),
            namespace: "jackalope".into(),
            jurisdiction: None,
            token: "fixture-token".into(),
            oauth: None,
        }
    }

    #[test]
    fn saved_api_token_connections_still_load_and_report_their_method() {
        let saved: Connection = serde_json::from_value(json!({
            "accountId": "0123456789abcdef0123456789abcdef",
            "namespace": "jackalope",
            "token": "legacy-token"
        }))
        .unwrap();
        assert!(saved.oauth.is_none());
        assert_eq!(connected_status(&saved).method, Some("token"));
        let signed_in = Connection {
            oauth: Some(oauth::Grant {
                refresh_token: "refresh".into(),
                expires_at: 0,
            }),
            ..fixture()
        };
        assert_eq!(connected_status(&signed_in).method, Some("oauth"));
        let round_trip: Connection =
            serde_json::from_slice(&serde_json::to_vec(&signed_in).unwrap()).unwrap();
        assert_eq!(round_trip.oauth.unwrap().refresh_token, "refresh");
    }

    #[test]
    fn connection_requires_an_account_id_namespace_and_token() {
        assert!(validate(&fixture()).is_ok());
        for broken in [
            Connection {
                account_id: "not-an-account".into(),
                ..fixture()
            },
            Connection {
                account_id: "0123456789ABCDEF0123456789ABCDEF".into(),
                ..fixture()
            },
            Connection {
                namespace: "-bad".into(),
                ..fixture()
            },
            Connection {
                namespace: "a".into(),
                ..fixture()
            },
            Connection {
                jurisdiction: Some("apac".into()),
                ..fixture()
            },
            Connection {
                token: "has space".into(),
                ..fixture()
            },
            Connection {
                token: String::new(),
                ..fixture()
            },
        ] {
            assert!(validate(&broken).is_err());
        }
    }

    #[test]
    fn repo_tokens_only_go_to_an_artifacts_git_host() {
        assert_eq!(
            remote_origin("https://abc.artifacts.cloudflare.net/git/default/app.git").unwrap(),
            "https://abc.artifacts.cloudflare.net"
        );
        for remote in [
            "http://abc.artifacts.cloudflare.net/git/default/app.git",
            "https://abc.artifacts.cloudflare.net.evil.com/git/default/app.git",
            "https://x:secret@abc.artifacts.cloudflare.net/git/default/app.git",
            "https://abc.artifacts.cloudflare.net:8443/git/default/app.git",
            "https://abc.artifacts.cloudflare.net/other/default/app.git",
            "https://github.com/git/default/app.git",
            "not a url",
        ] {
            assert!(remote_origin(remote).is_err(), "{remote}");
        }
    }

    #[test]
    fn remote_identity_reads_namespace_and_repository() {
        assert_eq!(
            remote_identity("https://abc.artifacts.cloudflare.net/git/team/my-app.git"),
            Some(("team".into(), "my-app".into()))
        );
        assert_eq!(
            remote_identity("https://abc.artifacts.cloudflare.net/git/team/a/b.git"),
            None
        );
        assert_eq!(remote_identity("https://github.com/team/app.git"), None);
    }

    #[test]
    fn repository_names_follow_artifacts_rules() {
        for name in ["app", "my-app.v2", "a_b", "9lives"] {
            assert!(validate_repo_name(name).is_ok(), "{name}");
        }
        for name in [
            "", "-app", ".app", "my app", "app/sub", "app.git", "ünicode",
        ] {
            assert!(validate_repo_name(name).is_err(), "{name}");
        }
    }

    #[test]
    fn push_output_never_contains_the_token_secret() {
        let output = scrub(
            "fatal: https://x:art_v1_abc@host/git/a/b.git denied art_v1_abc",
            "art_v1_abc?expires=1",
        );
        assert!(!output.contains("art_v1_abc"));
        assert!(output.contains("[redacted]"));
    }

    #[test]
    fn auth_errors_explain_the_required_token_permission() {
        assert!(api_message(403, &Value::Null).contains("Artifacts → Edit"));
        assert!(api_message(409, &json!({"errors":[{"code":10201}]})).contains("already exists"));
        let message = api_message(500, &json!({"errors":[{"code":1,"message":"boom\u{7}"}]}));
        assert!(message.ends_with("boom"));
    }

    #[test]
    fn push_refspecs_send_branches_and_tags_but_keep_task_branches_local() {
        let root =
            std::env::temp_dir().join(format!("jackalope-artifacts-{}", uuid::Uuid::new_v4()));
        let source = root.join("source");
        std::fs::create_dir_all(&source).unwrap();
        let target = root.join("target.git");
        let run = |path: &Path, args: &[&str]| {
            let output = std::process::Command::new("git")
                .current_dir(path)
                .args(args)
                .env("GIT_AUTHOR_NAME", "t")
                .env("GIT_AUTHOR_EMAIL", "t@t")
                .env("GIT_COMMITTER_NAME", "t")
                .env("GIT_COMMITTER_EMAIL", "t@t")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{:?}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        run(&root, &["init", "--bare", "target.git"]);
        run(&source, &["init", "--initial-branch=main"]);
        run(&source, &["commit", "--allow-empty", "-m", "one"]);
        run(&source, &["tag", "v1"]);
        run(&source, &["branch", "jackalope/task-1"]);
        // A local path stands in for the Artifacts host; the origin check is covered above.
        let mut args = vec!["push", "--porcelain", target.to_str().unwrap()];
        args.extend_from_slice(&PUSH_REFSPECS);
        run(&source, &args);
        let refs = git(&target, &["for-each-ref", "--format=%(refname)"]).unwrap();
        assert!(refs.contains("refs/heads/main"));
        assert!(refs.contains("refs/tags/v1"));
        assert!(!refs.contains("jackalope/task-1"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
