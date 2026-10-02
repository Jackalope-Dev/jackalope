//! Connected apps through the user's own Composio project. The project key and
//! the Composio user/session identifiers stay in protected storage; the
//! renderer only sees configuration state, the public catalog and account
//! status. Composio owns third-party OAuth tokens. One managed, on-demand MCP
//! connection delivers every connected app to agents through the existing broker.

use super::{account_storage, mcp, tasks::TaskRuntime};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::State;

const API: &str = "https://backend.composio.dev/api/v3.1";
const CATALOG_API: &str = "https://backend.composio.dev/api/v3";
/// The managed connection that carries every connected app to agents.
pub const CONNECTION_ID: &str = "composio";
const RESPONSE_LIMIT: usize = 8_000_000;

static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static CATALOG: Mutex<Option<(Instant, String, Vec<Toolkit>)>> = Mutex::new(None);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    api_key: String,
    user_id: String,
    session_id: String,
    mcp_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    configured: bool,
    /// Last four characters, so people can tell which project key is saved.
    key_hint: Option<String>,
    connection_id: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Toolkit {
    slug: String,
    name: String,
    description: String,
    logo: Option<String>,
    no_auth: bool,
    categories: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    id: String,
    toolkit: String,
    status: String,
    alias: Option<String>,
    updated_at: Option<String>,
}

fn path(runtime: &TaskRuntime) -> PathBuf {
    runtime.integration_directory().join("composio.bin")
}

fn saved(runtime: &TaskRuntime) -> Result<Option<Saved>, String> {
    account_storage::read(&path(runtime))?
        .map(|bytes| {
            serde_json::from_slice(&bytes).map_err(|_| {
                "The saved Composio connection could not be read. Remove it and add the key again."
                    .into()
            })
        })
        .transpose()
}

fn require(runtime: &TaskRuntime) -> Result<Saved, String> {
    saved(runtime)?.ok_or_else(|| "Add your Composio project key in Connected apps first.".into())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}

async fn send(request: reqwest::RequestBuilder, key: &str) -> Result<Value, String> {
    let mut response = request
        .header("x-api-key", key)
        .send()
        .await
        .map_err(|_| "Could not reach Composio. Check your connection and retry.")?;
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The Composio response was interrupted. Retry.")?
    {
        if bytes.len() + chunk.len() > RESPONSE_LIMIT {
            return Err("The Composio response is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    if !status.is_success() {
        let message = value["error"]["message"]
            .as_str()
            .or(value["message"].as_str())
            .or(value["error"].as_str())
            .unwrap_or("");
        return Err(match status.as_u16() {
            401 | 403 => {
                "Composio rejected this project key. Check it in the Composio dashboard.".into()
            }
            code if message.is_empty() => format!("Composio returned HTTP {code}. Retry."),
            code => format!(
                "Composio returned HTTP {code}: {}",
                message.chars().take(300).collect::<String>()
            ),
        });
    }
    Ok(value)
}

/// Composio-issued URLs only; nothing else is opened or given to agents.
fn trusted(url: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Composio returned an invalid link.")?;
    let host = parsed.host_str().unwrap_or("");
    if parsed.scheme() != "https"
        || !(host == "composio.dev" || host.ends_with(".composio.dev"))
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Composio returned a link outside composio.dev. Nothing was opened.".into());
    }
    Ok(parsed.to_string())
}

fn url(base: String, pairs: &[(&str, &str)]) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(&base).map_err(|e| e.to_string())?;
    url.query_pairs_mut().extend_pairs(pairs);
    Ok(url)
}

fn slug(value: &str) -> Result<String, String> {
    let value = value.trim().to_ascii_lowercase();
    if value.is_empty()
        || value.len() > 80
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Choose an app from the catalog.".into());
    }
    Ok(value)
}

async fn create_session(key: &str, user_id: &str) -> Result<(String, String), String> {
    let body = json!({
        "user_id": user_id,
        "manage_connections": {
            "enable": true,
            "enable_wait_for_connections": true,
            "enable_connection_removal": true
        }
    });
    let session = send(
        client()?
            .post(format!("{API}/tool_router/session"))
            .json(&body),
        key,
    )
    .await?;
    let id = session["session_id"]
        .as_str()
        .filter(|id| !id.is_empty())
        .ok_or("Composio did not return a session.")?;
    let url = trusted(
        session["mcp"]["url"]
            .as_str()
            .ok_or("Composio did not return a tool endpoint.")?,
    )?;
    Ok((id.to_owned(), url))
}

fn connection(saved: &Saved) -> mcp::McpServerConfig {
    let mut extra = serde_json::Map::new();
    extra.insert("headers".into(), json!({ "x-api-key": saved.api_key }));
    mcp::McpServerConfig {
        id: CONNECTION_ID.into(),
        name: "Connected apps (Composio)".into(),
        scope: "global".into(),
        transport: "http".into(),
        command: None,
        args: Vec::new(),
        env: Default::default(),
        url: Some(saved.mcp_url.clone()),
        description: Some(
            "Apps connected in Jackalope through your Composio project, available to every agent."
                .into(),
        ),
        enabled: Some(true),
        discovery: true,
        managed: true,
        agents: None,
        extra,
    }
}

#[tauri::command]
pub async fn composio_status(state: State<'_, TaskRuntime>) -> Result<Status, String> {
    let saved = saved(&state)?;
    Ok(Status {
        configured: saved.is_some(),
        key_hint: saved.map(|saved| {
            let chars: Vec<char> = saved.api_key.chars().collect();
            chars[chars.len().saturating_sub(4)..].iter().collect()
        }),
        connection_id: CONNECTION_ID,
    })
}

/// Validates the key by creating (or reusing) this installation's Composio
/// session, saves it securely and registers the managed agent connection.
#[tauri::command]
pub async fn composio_save_key(
    api_key: String,
    state: State<'_, TaskRuntime>,
) -> Result<Status, String> {
    let key = api_key.trim().to_owned();
    if !key.starts_with("ak_") || key.len() > 512 || key.chars().any(char::is_whitespace) {
        return Err(
            "Paste a Composio project API key. Project keys start with ak_ and are under Settings → API Keys."
                .into(),
        );
    }
    let _guard = LOCK.lock().await;
    let previous = saved(&state)?;
    // Connections belong to the Composio user, so keep the same user for the same key.
    let user_id = previous
        .as_ref()
        .filter(|saved| saved.api_key == key)
        .map(|saved| saved.user_id.clone())
        .unwrap_or_else(|| format!("jackalope_{}", uuid::Uuid::new_v4().simple()));
    let (session_id, mcp_url) = create_session(&key, &user_id).await?;
    let next = Saved {
        api_key: key,
        user_id,
        session_id,
        mcp_url,
    };
    account_storage::write(
        &path(&state),
        &serde_json::to_vec(&next).map_err(|e| e.to_string())?,
    )?;
    mcp::mcp_save_server(connection(&next)).await?;
    *CATALOG.lock().map_err(|e| e.to_string())? = None;
    composio_status(state).await
}

/// Forgets the key and removes the agent connection. Accounts connected in
/// Composio remain in that project until disconnected there or here first.
#[tauri::command]
pub async fn composio_remove_key(state: State<'_, TaskRuntime>) -> Result<(), String> {
    let _guard = LOCK.lock().await;
    let configured = mcp::mcp_list_servers(None)
        .await?
        .into_iter()
        .any(|server| server.id == CONNECTION_ID && server.scope == "global" && server.managed);
    if configured {
        mcp::mcp_delete_server(CONNECTION_ID.into(), "global".into()).await?;
    }
    account_storage::remove(&path(&state))?;
    *CATALOG.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// The app catalog, most used first. Cached for ten minutes per key.
#[tauri::command]
pub async fn composio_catalog(
    refresh: Option<bool>,
    state: State<'_, TaskRuntime>,
) -> Result<Vec<Toolkit>, String> {
    let saved = require(&state)?;
    let fingerprint = saved.user_id.clone();
    if !refresh.unwrap_or(false) {
        if let Some((at, owner, toolkits)) = CATALOG.lock().map_err(|e| e.to_string())?.as_ref() {
            if owner == &fingerprint && at.elapsed() < Duration::from_secs(600) {
                return Ok(toolkits.clone());
            }
        }
    }
    let mut toolkits: Vec<Toolkit> = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..6 {
        let mut pairs = vec![("limit", "500"), ("sort_by", "usage")];
        if let Some(cursor) = &cursor {
            pairs.push(("cursor", cursor));
        }
        let request = client()?.get(url(format!("{CATALOG_API}/toolkits"), &pairs)?);
        let page = send(request, &saved.api_key).await?;
        for item in page["items"].as_array().into_iter().flatten() {
            let Some(slug) = item["slug"].as_str().filter(|slug| !slug.is_empty()) else {
                continue;
            };
            let slug = slug.to_ascii_lowercase();
            if toolkits.iter().any(|toolkit| toolkit.slug == slug) {
                continue;
            }
            let logo = item["meta"]["logo"]
                .as_str()
                .filter(|logo| logo.starts_with("https://"))
                .map(str::to_owned);
            toolkits.push(Toolkit {
                name: item["name"].as_str().unwrap_or(&slug).to_owned(),
                description: item["meta"]["description"]
                    .as_str()
                    .unwrap_or("")
                    .chars()
                    .take(160)
                    .collect(),
                logo,
                no_auth: item["no_auth"].as_bool().unwrap_or(false),
                categories: item["meta"]["categories"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|category| category["name"].as_str().map(str::to_owned))
                    .take(4)
                    .collect(),
                slug,
            });
        }
        match page["next_cursor"].as_str().filter(|next| !next.is_empty()) {
            Some(next) if cursor.as_deref() != Some(next) => cursor = Some(next.to_owned()),
            _ => break,
        }
    }
    *CATALOG.lock().map_err(|e| e.to_string())? =
        Some((Instant::now(), fingerprint, toolkits.clone()));
    Ok(toolkits)
}

/// Every account this installation connected, newest first.
#[tauri::command]
pub async fn composio_accounts(state: State<'_, TaskRuntime>) -> Result<Vec<Account>, String> {
    let saved = require(&state)?;
    let mut accounts = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..10 {
        let mut pairs = vec![
            ("user_ids", saved.user_id.as_str()),
            ("limit", "50"),
            ("order_by", "updated_at"),
            ("order_direction", "desc"),
        ];
        if let Some(cursor) = &cursor {
            pairs.push(("cursor", cursor));
        }
        let request = client()?.get(url(format!("{API}/connected_accounts"), &pairs)?);
        let page = send(request, &saved.api_key).await?;
        for item in page["items"].as_array().into_iter().flatten() {
            let (Some(id), Some(toolkit)) = (item["id"].as_str(), item["toolkit"]["slug"].as_str())
            else {
                continue;
            };
            accounts.push(Account {
                id: id.to_owned(),
                toolkit: toolkit.to_ascii_lowercase(),
                status: item["status"].as_str().unwrap_or("UNKNOWN").to_owned(),
                alias: item["alias"].as_str().map(str::to_owned),
                updated_at: item["updated_at"].as_str().map(str::to_owned),
            });
        }
        match page["next_cursor"].as_str().filter(|next| !next.is_empty()) {
            Some(next) if cursor.as_deref() != Some(next) => cursor = Some(next.to_owned()),
            _ => break,
        }
    }
    Ok(accounts)
}

/// Returns Composio's hosted sign-in link for one app. The caller opens it in
/// the user's browser; Jackalope never sees the app's credentials.
#[tauri::command]
pub async fn composio_authorize(
    toolkit: String,
    state: State<'_, TaskRuntime>,
) -> Result<String, String> {
    let toolkit = slug(&toolkit)?;
    let saved = require(&state)?;
    let link = |session: &str| {
        client().map(|client| {
            client
                .post(format!("{API}/tool_router/session/{session}/link"))
                .json(&json!({ "toolkit": toolkit }))
        })
    };
    let result = match send(link(&saved.session_id)?, &saved.api_key).await {
        Ok(value) => value,
        // A session deleted in the dashboard is recreated for the same user,
        // which keeps every existing connection.
        Err(error) if error.contains("HTTP 404") => {
            let _guard = LOCK.lock().await;
            let (session_id, mcp_url) = create_session(&saved.api_key, &saved.user_id).await?;
            let next = Saved {
                session_id,
                mcp_url,
                ..saved.clone()
            };
            account_storage::write(
                &path(&state),
                &serde_json::to_vec(&next).map_err(|e| e.to_string())?,
            )?;
            mcp::mcp_save_server(connection(&next)).await?;
            send(link(&next.session_id)?, &next.api_key).await?
        }
        Err(error) if error.contains("auth_config") || error.contains("auth config") => {
            return Err(format!(
                "{toolkit} has no Composio-managed sign-in. Create an auth config for it in your Composio project, then connect again."
            ))
        }
        Err(error) => return Err(error),
    };
    trusted(
        result["redirect_url"]
            .as_str()
            .ok_or("Composio did not return a sign-in link.")?,
    )
}

/// Revokes the provider grant and removes the account from Composio.
#[tauri::command]
pub async fn composio_disconnect(
    account_id: String,
    state: State<'_, TaskRuntime>,
) -> Result<(), String> {
    if account_id.is_empty()
        || account_id.len() > 120
        || !account_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Choose a connected account.".into());
    }
    let saved = require(&state)?;
    let owned = composio_accounts(state)
        .await?
        .into_iter()
        .any(|account| account.id == account_id);
    if !owned {
        return Err("That account is not connected through this Jackalope installation.".into());
    }
    send(
        client()?.delete(url(
            format!("{API}/connected_accounts/{account_id}"),
            &[("revoke_on_delete", "true")],
        )?),
        &saved.api_key,
    )
    .await
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_composio_https_links_are_trusted() {
        assert!(trusted("https://connect.composio.dev/link/abc").is_ok());
        assert!(trusted("https://backend.composio.dev/tool_router/x/mcp").is_ok());
        assert!(trusted("http://connect.composio.dev/link").is_err());
        assert!(trusted("https://composio.dev.evil.example/link").is_err());
        assert!(trusted("https://user:pass@connect.composio.dev/").is_err());
    }

    #[test]
    fn toolkit_slugs_are_bounded_identifiers() {
        assert_eq!(slug(" GitHub ").unwrap(), "github");
        assert!(slug("google_calendar").is_ok());
        assert!(slug("../x").is_err());
        assert!(slug("").is_err());
    }

    #[test]
    fn the_agent_connection_is_managed_and_on_demand() {
        let server = connection(&Saved {
            api_key: "ak_test".into(),
            user_id: "u".into(),
            session_id: "s".into(),
            mcp_url: "https://backend.composio.dev/tool_router/s/mcp".into(),
        });
        assert!(server.managed && server.discovery);
        assert_eq!(server.scope, "global");
        assert_eq!(server.extra["headers"]["x-api-key"], "ak_test");
    }
}
