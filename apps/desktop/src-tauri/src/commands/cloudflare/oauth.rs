//! "Connect Cloudflare" through Jackalope's public OAuth client (authorization
//! code with PKCE, no client secret). The browser returns to a temporary
//! loopback listener on 127.0.0.1; nothing is exposed beyond this computer.
//! Tokens stay in memory until an account is chosen, then in protected storage.

use super::{
    api::API_ROOT,
    scopes::{self, Scope},
};
use crate::commands::http;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

const CLIENT_ID: &str = "0c24764a63057619e2f99d608b5a041b";
const AUTHORIZE_URL: &str = "https://dash.cloudflare.com/oauth2/auth";
const TOKEN_URL: &str = "https://dash.cloudflare.com/oauth2/token";
const REVOKE_URL: &str = "https://dash.cloudflare.com/oauth2/revoke";
/// Must match the client's registered redirect URIs exactly.
const PORTS: [u16; 3] = [47851, 47852, 47853];
const CALLBACK_PATH: &str = "/cloudflare/callback";
const SCOPES: &str =
    "artifacts.write artifacts.read account-settings.read user-details.read offline_access";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
/// Refresh this long before expiry so a slow request never carries a stale token.
const REFRESH_MARGIN_SECONDS: i64 = 300;

/// A refreshable sign-in saved with the connection.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub refresh_token: String,
    /// Unix seconds when the access token expires.
    pub expires_at: i64,
    /// Space-separated scopes Cloudflare reported granting, when it reported them.
    /// Older saved grants have none and are treated as unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scopes: Option<String>,
}

impl Grant {
    /// `Some(false)` only when Cloudflare reported the granted scopes and this one is missing.
    pub fn allows(&self, scope: &Scope) -> Option<bool> {
        self.scopes
            .as_deref()
            .map(|granted| scopes::granted(granted, scope))
    }
}

#[derive(Clone)]
pub struct Tokens {
    pub access: String,
    pub grant: Grant,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub(super) id: String,
    pub(super) name: String,
}

struct Pending {
    state: String,
    verifier: String,
    redirect_uri: String,
    listener: Option<TcpListener>,
    /// What to say when Cloudflare refuses a requested scope, when extra scopes were asked for.
    invalid_scope: Option<String>,
}

static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
/// Tokens from a completed sign-in, waiting for the person to choose an account.
static SIGNED_IN: Mutex<Option<(Tokens, Vec<Account>)>> = Mutex::new(None);
static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

fn random(bytes: usize) -> String {
    let mut data = Vec::with_capacity(bytes + 16);
    while data.len() < bytes {
        data.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    }
    data.truncate(bytes);
    URL_SAFE_NO_PAD.encode(data)
}

fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn form(pairs: &[(&str, &str)]) -> String {
    let mut url = reqwest::Url::parse("http://form.invalid/").expect("static URL");
    url.query_pairs_mut().extend_pairs(pairs);
    url.query().unwrap_or_default().to_owned()
}

fn client() -> Result<reqwest::Client, String> {
    http::client(Duration::from_secs(30))
}

async fn token_request(pairs: &[(&str, &str)]) -> Result<Tokens, String> {
    let response = client()?
        .post(TOKEN_URL)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(form(pairs))
        .send()
        .await
        .map_err(|_| "Could not reach Cloudflare. Check your connection and retry.")?;
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let detail = body["error_description"]
            .as_str()
            .or(body["error"].as_str())
            .unwrap_or("");
        return Err(match body["error"].as_str() {
            Some("invalid_grant") => {
                "Your Cloudflare sign-in expired or was revoked. Connect Cloudflare again.".into()
            }
            _ if detail.is_empty() => format!("Cloudflare sign-in failed ({status})."),
            _ => format!(
                "Cloudflare sign-in failed: {}",
                detail.chars().take(200).collect::<String>()
            ),
        });
    }
    let access = body["access_token"]
        .as_str()
        .filter(|token| !token.is_empty())
        .ok_or("Cloudflare did not return an access token.")?;
    let refresh = body["refresh_token"].as_str().filter(|token| !token.is_empty()).ok_or(
        "Cloudflare did not return a refresh token. Check that the Jackalope app allows offline access.",
    )?;
    Ok(Tokens {
        access: access.to_owned(),
        grant: Grant {
            refresh_token: refresh.to_owned(),
            expires_at: now() + body["expires_in"].as_i64().unwrap_or(3600),
            scopes: body["scope"]
                .as_str()
                .filter(|scopes| !scopes.trim().is_empty())
                .map(str::to_owned),
        },
    })
}

pub fn needs_refresh(grant: &Grant) -> bool {
    grant.expires_at - now() < REFRESH_MARGIN_SECONDS
}

pub async fn refresh(grant: &Grant) -> Result<Tokens, String> {
    let mut tokens = token_request(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", &grant.refresh_token),
        ("client_id", CLIENT_ID),
    ])
    .await?;
    // A refresh keeps the original grant's scopes when the response omits them.
    if tokens.grant.scopes.is_none() {
        tokens.grant.scopes = grant.scopes.clone();
    }
    Ok(tokens)
}

fn requested_scopes(extra: &[String]) -> String {
    let mut scopes = SCOPES.to_owned();
    for scope in extra {
        scopes.push(' ');
        scopes.push_str(scope);
    }
    scopes
}

/// A Connect Cloudflare failure. The app reacts to `code` and shows `message`.
#[derive(Debug, Serialize)]
pub struct SignInError {
    pub message: String,
    /// `canceled` when a cancel or a newer sign-in replaced this one; `apiToken` when
    /// only an API token can give the access asked for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<&'static str>,
}

impl SignInError {
    fn canceled() -> Self {
        Self {
            message: "Cloudflare sign-in was canceled.".into(),
            code: Some("canceled"),
        }
    }

    pub fn api_token(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: Some("apiToken"),
        }
    }
}

impl From<String> for SignInError {
    fn from(message: String) -> Self {
        Self {
            message,
            code: None,
        }
    }
}

impl From<&str> for SignInError {
    fn from(message: &str) -> Self {
        message.to_owned().into()
    }
}

/// The sign-in error Cloudflare returns in the redirect, in the person's terms.
fn authorize_error(error: &str, description: Option<&str>, invalid_scope: Option<&str>) -> String {
    match error {
        "access_denied" => "Cloudflare access was not approved.".into(),
        // The public client's registration does not allow a requested scope.
        "invalid_scope" if invalid_scope.is_some() => invalid_scope.unwrap_or_default().into(),
        "invalid_scope" => format!("Cloudflare does not let Jackalope deploy Workers through Connect Cloudflare yet. Connect with an API token that has {} and Artifacts: Edit instead.", scopes::WORKERS.permission),
        _ => format!(
            "Cloudflare sign-in failed: {}",
            description
                .unwrap_or(error)
                .chars()
                .take(200)
                .collect::<String>()
        ),
    }
}

/// Best effort: a failed revocation must not keep the person connected locally.
pub async fn revoke(grant: &Grant) {
    if let Ok(client) = client() {
        let _ = client
            .post(REVOKE_URL)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(form(&[
                ("token", &grant.refresh_token),
                ("token_type_hint", "refresh_token"),
                ("client_id", CLIENT_ID),
            ]))
            .send()
            .await;
    }
}

/// Prepares a sign-in and returns the Cloudflare consent URL to open. `extra` adds
/// product scopes, and `invalid_scope` is the message shown when Cloudflare refuses one.
pub async fn begin(extra: &[String], invalid_scope: Option<String>) -> Result<String, SignInError> {
    let mut bound = None;
    for port in PORTS {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)).await {
            bound = Some((listener, port));
            break;
        }
    }
    let (listener, port) = bound.ok_or_else(|| SignInError::api_token(
        "Ports 47851–47853 on this computer are in use, so Cloudflare cannot return to Jackalope. Close the program using them, or connect with an API token.",
    ))?;
    let state = random(24);
    let verifier = random(48);
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let mut url = reqwest::Url::parse(AUTHORIZE_URL).map_err(|e| e.to_string())?;
    url.query_pairs_mut().extend_pairs([
        ("response_type", "code"),
        ("client_id", CLIENT_ID),
        ("redirect_uri", redirect_uri.as_str()),
        ("scope", requested_scopes(extra).as_str()),
        ("state", state.as_str()),
        ("code_challenge", challenge(&verifier).as_str()),
        ("code_challenge_method", "S256"),
    ]);
    GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    *SIGNED_IN.lock().map_err(|e| e.to_string())? = None;
    *PENDING.lock().map_err(|e| e.to_string())? = Some(Pending {
        state,
        verifier,
        redirect_uri,
        listener: Some(listener),
        invalid_scope,
    });
    Ok(url.to_string())
}

pub fn cancel() {
    GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    if let Ok(mut pending) = PENDING.lock() {
        *pending = None;
    }
    if let Ok(mut signed_in) = SIGNED_IN.lock() {
        *signed_in = None;
    }
}

fn page(title: &str, detail: &str) -> String {
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title><style>body{{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f7f7f8;color:#1d1d22}}main{{max-width:28rem;text-align:center}}@media (prefers-color-scheme:dark){{body{{background:#141418;color:#ececf1}}}}</style></head><body><main><h1>{title}</h1><p>{detail}</p></main></body></html>"
    );
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

/// Reads one request line and returns its path and query, if it is a GET.
async fn read_target(stream: &mut tokio::net::TcpStream) -> Option<String> {
    let mut buffer = vec![0u8; 8192];
    let mut read = 0;
    while read < buffer.len() {
        let count = tokio::time::timeout(Duration::from_secs(10), stream.read(&mut buffer[read..]))
            .await
            .ok()?
            .ok()?;
        if count == 0 {
            break;
        }
        read += count;
        if buffer[..read].windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    let text = String::from_utf8_lossy(&buffer[..read]);
    let line = text.lines().next()?;
    let mut parts = line.split_whitespace();
    (parts.next()? == "GET").then(|| parts.next().map(str::to_owned))?
}

/// Waits for the browser to return, exchanges the code and lists the accounts
/// the person granted. Tokens are kept in memory until `take` is called.
pub async fn complete() -> Result<Vec<Account>, SignInError> {
    let generation = GENERATION.load(std::sync::atomic::Ordering::SeqCst);
    let (listener, state, verifier, redirect_uri, invalid_scope) = {
        let mut pending = PENDING.lock().map_err(|e| e.to_string())?;
        let pending = pending.as_mut().ok_or("Start Connect Cloudflare again.")?;
        (
            pending
                .listener
                .take()
                .ok_or("A sign-in is already waiting.")?,
            pending.state.clone(),
            pending.verifier.clone(),
            pending.redirect_uri.clone(),
            pending.invalid_scope.clone(),
        )
    };
    let deadline = tokio::time::Instant::now() + SIGN_IN_TIMEOUT;
    let code = loop {
        if GENERATION.load(std::sync::atomic::Ordering::SeqCst) != generation {
            return Err(SignInError::canceled());
        }
        let accepted = tokio::time::timeout_at(
            deadline.min(tokio::time::Instant::now() + Duration::from_millis(500)),
            listener.accept(),
        )
        .await;
        if tokio::time::Instant::now() >= deadline {
            return Err("Cloudflare sign-in timed out. Start Connect Cloudflare again.".into());
        }
        let Ok(Ok((mut stream, peer))) = accepted else {
            continue;
        };
        if !peer.ip().is_loopback() {
            continue;
        }
        let Some(target) = read_target(&mut stream).await else {
            continue;
        };
        let Ok(url) = reqwest::Url::parse(&format!("http://127.0.0.1{target}")) else {
            continue;
        };
        if url.path() != CALLBACK_PATH {
            let _ = stream
                .write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
            continue;
        }
        let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        if query.get("state") != Some(&state) {
            let _ = stream
                .write_all(page("Sign-in not recognized", "This response did not come from the sign-in Jackalope started. Return to Jackalope and try again.").as_bytes())
                .await;
            continue;
        }
        if let Some(error) = query.get("error") {
            let _ = stream
                .write_all(
                    page(
                        "Cloudflare was not connected",
                        "You can close this tab and return to Jackalope.",
                    )
                    .as_bytes(),
                )
                .await;
            let message = authorize_error(
                error,
                query.get("error_description").map(String::as_str),
                invalid_scope.as_deref(),
            );
            return Err(if error.as_str() == "invalid_scope" {
                SignInError::api_token(message)
            } else {
                message.into()
            });
        }
        let Some(code) = query.get("code").cloned() else {
            continue;
        };
        let _ = stream
            .write_all(
                page(
                    "Cloudflare connected",
                    "You can close this tab and return to Jackalope.",
                )
                .as_bytes(),
            )
            .await;
        break code;
    };
    drop(listener);
    let tokens = token_request(&[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", &redirect_uri),
        ("client_id", CLIENT_ID),
        ("code_verifier", &verifier),
    ])
    .await?;
    let accounts = accounts(&tokens.access).await?;
    if GENERATION.load(std::sync::atomic::Ordering::SeqCst) != generation {
        return Err(SignInError::canceled());
    }
    *PENDING.lock().map_err(|e| e.to_string())? = None;
    *SIGNED_IN.lock().map_err(|e| e.to_string())? = Some((tokens, accounts.clone()));
    Ok(accounts)
}

async fn accounts(access: &str) -> Result<Vec<Account>, String> {
    let body = list_accounts(access).await?;
    if body["success"] != true {
        return Err("Cloudflare signed you in but did not list your accounts. Connect again and allow account access.".into());
    }
    let accounts = parse_accounts(&body);
    if accounts.is_empty() {
        return Err("No Cloudflare accounts were shared with Jackalope. Connect again and select an account.".into());
    }
    Ok(accounts)
}

/// `GET /accounts` with `access`; any API token can list the accounts it covers.
pub(super) async fn list_accounts(access: &str) -> Result<Value, String> {
    let response = client()?
        .get(format!("{API_ROOT}?per_page=50"))
        .bearer_auth(access)
        .send()
        .await
        .map_err(|_| "Could not reach Cloudflare. Check your connection and retry.")?;
    Ok(response.json().await.unwrap_or(Value::Null))
}

/// The accounts in a `GET /accounts` response, skipping malformed IDs.
pub(super) fn parse_accounts(body: &Value) -> Vec<Account> {
    body["result"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|account| {
            let id = account["id"].as_str()?.to_ascii_lowercase();
            (id.len() == 32 && id.chars().all(|c| c.is_ascii_hexdigit())).then(|| Account {
                name: account["name"]
                    .as_str()
                    .unwrap_or(&id)
                    .chars()
                    .take(120)
                    .collect(),
                id,
            })
        })
        .collect()
}

/// The signed-in tokens for a chosen account, which must be one the person
/// granted. They stay available so a failed namespace check can be retried.
pub fn signed_in(account_id: &str) -> Result<Tokens, String> {
    let signed_in = SIGNED_IN.lock().map_err(|e| e.to_string())?;
    let (tokens, accounts) = signed_in
        .as_ref()
        .ok_or("Your Cloudflare sign-in is no longer waiting. Connect Cloudflare again.")?;
    if !accounts.iter().any(|account| account.id == account_id) {
        return Err("Choose one of the accounts you shared with Jackalope.".into());
    }
    Ok(tokens.clone())
}

/// Forgets the in-memory sign-in once its connection is saved.
pub fn finish() {
    if let Ok(mut signed_in) = SIGNED_IN.lock() {
        *signed_in = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_uses_s256_and_url_safe_values() {
        // Expected value computed independently with Python's hashlib and base64.
        assert_eq!(
            challenge("jackalope-pkce-fixture-verifier-0123456789abcdef"),
            "FVXx3u5FuFDtoF7NftOGnQngolU2gBfYDKX_jd4wQzI"
        );
        let verifier = random(48);
        assert_eq!(verifier.len(), 64);
        assert!(verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(random(24), random(24));
    }

    #[test]
    fn forms_encode_reserved_characters() {
        assert_eq!(
            form(&[
                ("redirect_uri", "http://127.0.0.1:47851/cb"),
                ("a", "b c&d")
            ]),
            "redirect_uri=http%3A%2F%2F127.0.0.1%3A47851%2Fcb&a=b+c%26d"
        );
    }

    #[test]
    fn grants_refresh_ahead_of_expiry() {
        let grant = |offset| Grant {
            refresh_token: "r".into(),
            expires_at: now() + offset,
            scopes: None,
        };
        assert!(needs_refresh(&grant(60)));
        assert!(!needs_refresh(&grant(3600)));
    }

    #[test]
    fn product_scopes_are_added_after_the_base_scopes() {
        assert!(!requested_scopes(&[]).contains(scopes::WORKERS.name));
        assert!(requested_scopes(&[]).contains("offline_access"));
        let requested = requested_scopes(&["d1.write".into(), "queues.write".into()]);
        assert!(requested.starts_with(SCOPES));
        assert!(requested.ends_with(" d1.write queues.write"));
    }

    #[test]
    fn granted_scopes_are_known_only_when_reported() {
        let grant = |scopes: Option<&str>| Grant {
            refresh_token: "r".into(),
            expires_at: 0,
            scopes: scopes.map(str::to_owned),
        };
        assert_eq!(grant(None).allows(&scopes::WORKERS), None);
        assert_eq!(
            grant(Some("artifacts.write workers-scripts.write")).allows(&scopes::WORKERS),
            Some(true)
        );
        assert_eq!(
            grant(Some("artifacts.write workers-scripts.read")).allows(&scopes::WORKERS),
            Some(false)
        );
        // Saved grants from before scopes were recorded still load.
        let old: Grant = serde_json::from_str(r#"{"refreshToken":"r","expiresAt":1}"#).unwrap();
        assert!(old.scopes.is_none());
    }

    #[test]
    fn unregistered_scopes_point_to_an_api_token() {
        let message = authorize_error("invalid_scope", None, None);
        assert!(message.contains(scopes::WORKERS.permission));
        assert_eq!(
            authorize_error("access_denied", None, None),
            "Cloudflare access was not approved."
        );
        assert_eq!(
            authorize_error("invalid_scope", None, Some("Use a token with D1: Edit.")),
            "Use a token with D1: Edit."
        );
    }
}
