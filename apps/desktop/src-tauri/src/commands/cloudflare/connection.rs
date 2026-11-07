//! The saved Cloudflare connection: an account, the Artifacts namespace it was set
//! up with, and an API token or a Connect Cloudflare sign-in. The token stays in
//! protected storage; OAuth access tokens are refreshed here before use.

use super::{oauth, scopes};
use crate::commands::{account_storage, tasks::TaskRuntime};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{path::PathBuf, sync::Mutex};
use tauri::State;

static CONNECTION_LOCK: Mutex<()> = Mutex::new(());
/// Serializes OAuth refreshes; Cloudflare rotates refresh tokens on use.
static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const STORAGE_FILE: &str = "cloudflare-artifacts.bin";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub account_id: String,
    pub namespace: String,
    #[serde(default)]
    pub jurisdiction: Option<String>,
    /// An API token, or the current OAuth access token when `oauth` is set.
    pub(in crate::commands) token: String,
    /// Present for Connect Cloudflare sign-ins; never accepted from the renderer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(in crate::commands) oauth: Option<oauth::Grant>,
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

fn storage_path(runtime: &TaskRuntime) -> PathBuf {
    runtime.integration_directory().join(STORAGE_FILE)
}

pub(in crate::commands) fn saved(runtime: &TaskRuntime) -> Result<Option<Connection>, String> {
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

pub(in crate::commands) fn save(
    runtime: &TaskRuntime,
    connection: &Connection,
) -> Result<(), String> {
    let _guard = CONNECTION_LOCK.lock().map_err(|e| e.to_string())?;
    account_storage::write(
        &storage_path(runtime),
        &serde_json::to_vec(connection).map_err(|e| e.to_string())?,
    )
}

/// The saved connection with a usable access token, refreshing an OAuth sign-in
/// that is about to expire. API tokens are returned unchanged.
pub(in crate::commands) async fn current(runtime: &TaskRuntime) -> Result<Connection, String> {
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
    save(runtime, &next)?;
    Ok(next)
}

pub(in crate::commands) fn connected_status(connection: &Connection) -> Status {
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

pub(in crate::commands) fn plausible_token(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= 8192
        && !token.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// The accounts a pasted API token covers, from its `GET /accounts` response.
fn token_accounts(body: &Value) -> Result<Vec<oauth::Account>, String> {
    if body["success"] != true {
        return Err(
            if matches!(super::api::code(body), 1000 | 6003 | 9109 | 10000) {
                "Cloudflare did not accept this API token. Check that you copied all of it."
            } else {
                "Cloudflare did not list the accounts for this token. Enter the account ID instead."
            }
            .into(),
        );
    }
    let accounts = oauth::parse_accounts(body);
    if accounts.is_empty() {
        return Err("This token is not scoped to an account. Give it Account → Artifacts → Edit, or enter the account ID.".into());
    }
    Ok(accounts)
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

/// The accounts a pasted API token can use, so the person need not look up an account ID.
#[tauri::command]
pub async fn cloudflare_token_accounts(token: String) -> Result<Vec<oauth::Account>, String> {
    let token = token.trim();
    if !plausible_token(token) {
        return Err("Enter a Cloudflare API token with Artifacts Edit permission.".into());
    }
    token_accounts(&oauth::list_accounts(token).await?)
}

/// The scopes to request: those the saved sign-in already has, so a
/// reauthorization never drops them, then Workers when asked, then `requested`.
fn scopes_to_request(
    granted: &str,
    workers: bool,
    requested: &[&'static scopes::Scope],
) -> Vec<String> {
    let mut extra: Vec<String> = Vec::new();
    let mut add = |name: &str| {
        if !extra.iter().any(|scope| scope == name) {
            extra.push(name.to_owned());
        }
    };
    for scope in granted.split_whitespace() {
        if scopes::find(scope).is_some() {
            add(scope);
        }
    }
    if workers {
        add(scopes::WORKERS.name);
    }
    for scope in requested {
        add(scope.name);
    }
    extra
}

/// Starts Connect Cloudflare and returns the consent URL for the browser. `workers`
/// also asks to deploy Workers, which Jackalope Swarm setup needs. `scopes` asks for
/// the extra product scopes cloud resource setup needs; only known scopes are accepted.
#[tauri::command]
pub async fn cloudflare_oauth_begin(
    workers: Option<bool>,
    scopes: Option<Vec<String>>,
    state: State<'_, TaskRuntime>,
) -> Result<String, String> {
    let mut requested = Vec::new();
    for name in scopes.unwrap_or_default() {
        requested.push(
            scopes::find(&name)
                .ok_or_else(|| format!("{name} is not a scope Jackalope asks Cloudflare for."))?,
        );
    }
    let granted = saved(&state)
        .ok()
        .flatten()
        .and_then(|connection| connection.oauth)
        .and_then(|grant| grant.scopes)
        .unwrap_or_default();
    let permissions: Vec<&str> = requested
        .iter()
        .filter(|scope| **scope != &scopes::WORKERS)
        .map(|scope| scope.permission)
        .collect();
    let invalid_scope = (!permissions.is_empty()).then(|| {
        format!(
            "Cloudflare does not let Jackalope create these resources through Connect Cloudflare yet. Connect with an API token that has {} and Artifacts: Edit instead.",
            permissions.join(", ")
        )
    });
    let extra = scopes_to_request(&granted, workers.unwrap_or(false), &requested);
    oauth::begin(&extra, invalid_scope).await
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

/// Replaces the saved sign-in with a newer one for the same account, keeping the
/// namespace and data location. Used after Connect Cloudflare asks for Workers access.
#[tauri::command]
pub async fn cloudflare_oauth_reauthorize(state: State<'_, TaskRuntime>) -> Result<Status, String> {
    let existing = connection(&state)?;
    let previous = existing.oauth.clone().ok_or(
        "This connection uses an API token. Replace it with one that has Workers Scripts: Edit.",
    )?;
    let tokens = oauth::signed_in(&existing.account_id).map_err(|_| {
        "Share the same Cloudflare account you connected before, or disconnect and connect again."
            .to_string()
    })?;
    let next = Connection {
        token: tokens.access,
        oauth: Some(tokens.grant),
        ..existing
    };
    save(&state, &next)?;
    oauth::finish();
    oauth::revoke(&previous).await;
    Ok(connected_status(&next))
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

/// What Workers deployment can use from the saved Cloudflare connection.
pub(in crate::commands) struct WorkersAccess {
    pub account_id: String,
    pub namespace: String,
    pub token: String,
    pub oauth: bool,
    /// `Some(false)` when Connect Cloudflare reported a grant without Workers access.
    pub workers_allowed: Option<bool>,
}

fn workers_access_of(connection: Connection) -> WorkersAccess {
    WorkersAccess {
        workers_allowed: connection
            .oauth
            .as_ref()
            .and_then(|grant| grant.allows(&scopes::WORKERS)),
        oauth: connection.oauth.is_some(),
        account_id: connection.account_id,
        namespace: connection.namespace,
        token: connection.token,
    }
}

/// The connected account and a fresh token for account-level product APIs.
pub(in crate::commands) struct AccountAccess {
    pub account_id: String,
    pub token: String,
    pub oauth: bool,
    /// Scopes Cloudflare reported for an OAuth grant; `None` when unknown or an API token.
    pub granted: Option<String>,
}

pub(in crate::commands) async fn account_access(
    runtime: &TaskRuntime,
) -> Result<AccountAccess, String> {
    let connection = current(runtime).await?;
    Ok(AccountAccess {
        oauth: connection.oauth.is_some(),
        granted: connection.oauth.and_then(|grant| grant.scopes),
        account_id: connection.account_id,
        token: connection.token,
    })
}

/// Whether Cloudflare is connected, without refreshing.
pub(in crate::commands) fn connected_account(runtime: &TaskRuntime) -> Option<String> {
    saved(runtime)
        .ok()
        .flatten()
        .map(|connection| connection.account_id)
}

/// The saved connection without refreshing, for status checks. The token may be stale.
pub(in crate::commands) fn workers_access_saved(
    runtime: &TaskRuntime,
) -> Result<Option<WorkersAccess>, String> {
    Ok(saved(runtime)?.map(workers_access_of))
}

pub(in crate::commands) async fn workers_access(
    runtime: &TaskRuntime,
) -> Result<WorkersAccess, String> {
    Ok(workers_access_of(current(runtime).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
                scopes: None,
            }),
            ..fixture()
        };
        assert_eq!(connected_status(&signed_in).method, Some("oauth"));
        let round_trip: Connection =
            serde_json::from_slice(&serde_json::to_vec(&signed_in).unwrap()).unwrap();
        assert_eq!(round_trip.oauth.unwrap().refresh_token, "refresh");
    }

    #[test]
    fn pasted_tokens_derive_their_accounts() {
        let one = json!({"success": true, "result": [
            {"id": "0123456789ABCDEF0123456789abcdef", "name": "Personal"},
            {"id": "not-an-account", "name": "Broken"}
        ]});
        let accounts = token_accounts(&one).unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].id, "0123456789abcdef0123456789abcdef");
        assert_eq!(accounts[0].name, "Personal");

        let several = json!({"success": true, "result": [
            {"id": "a".repeat(32), "name": "Team"},
            {"id": "b".repeat(32)}
        ]});
        let accounts = token_accounts(&several).unwrap();
        assert_eq!(accounts.len(), 2);
        assert_eq!(accounts[1].name, "b".repeat(32));

        assert!(token_accounts(&json!({"success": true, "result": []}))
            .unwrap_err()
            .contains("enter the account ID"));
        assert!(
            token_accounts(&json!({"success": false, "errors": [{"code": 1000}]}))
                .unwrap_err()
                .contains("did not accept this API token")
        );
        assert!(token_accounts(&Value::Null)
            .unwrap_err()
            .contains("Enter the account ID"));
        assert!(!plausible_token("has space"));
        assert!(!plausible_token(""));
        assert!(plausible_token("abc_DEF-123"));
    }

    #[test]
    fn reauthorizing_keeps_granted_scopes_and_adds_workers_and_requested_ones() {
        assert_eq!(
            scopes_to_request(
                "artifacts.write d1.write workers-scripts.write",
                false,
                &[&scopes::KV]
            ),
            [
                "d1.write",
                "workers-scripts.write",
                "workers-kv-storage.write"
            ]
        );
        assert_eq!(
            scopes_to_request("", true, &[&scopes::WORKERS]),
            ["workers-scripts.write"]
        );
        assert!(scopes_to_request("", false, &[]).is_empty());
    }
}
