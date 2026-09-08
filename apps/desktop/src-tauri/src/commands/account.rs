use super::account_storage;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, time::Duration};
use tauri::{AppHandle, State};
use tauri_plugin_shell::ShellExt;

pub struct AccountService {
    path: PathBuf,
    operation: tokio::sync::Mutex<()>,
}
impl AccountService {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            operation: tokio::sync::Mutex::new(()),
        }
    }
    fn read(&self) -> Result<Option<SavedAccount>, String> {
        account_storage::read(&self.path)?
            .map(|bytes| {
                serde_json::from_slice(&bytes)
                    .map_err(|_| "The saved account record is invalid.".into())
            })
            .transpose()
    }
    fn save(&self, record: &SavedAccount) -> Result<(), String> {
        account_storage::write(
            &self.path,
            &serde_json::to_vec(record).map_err(|_| "Could not encode the account record.")?,
        )
    }
}
#[derive(Serialize, Deserialize)]
struct SavedAccount {
    origin: String,
    secret: String,
    verification: String,
    user_code: String,
    expires_at: i64,
    email: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    state: &'static str,
    email: Option<String>,
    user_code: Option<String>,
    expires_at: Option<i64>,
}
fn status(state: &'static str, record: Option<&SavedAccount>) -> AccountStatus {
    AccountStatus {
        state,
        email: record.and_then(|r| r.email.clone()),
        user_code: record
            .filter(|r| r.email.is_none())
            .map(|r| r.user_code.clone()),
        expires_at: record.map(|r| r.expires_at),
    }
}
fn endpoints(app: &AppHandle) -> Result<(reqwest::Url, reqwest::Url), String> {
    let api = super::community::configured_url(app, "accountServiceUrl")
        .filter(|u| u.path() == "/")
        .ok_or("This build has no account connection service.")?;
    let web = super::community::configured_url(app, "accountWebUrl")
        .filter(|u| u.path() == "/")
        .ok_or("This build has no account connection page.")?;
    Ok((api, web))
}
fn valid_token(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn bound(record: &SavedAccount, api: &reqwest::Url) -> Result<(), String> {
    if record.origin != api.as_str() || !valid_token(&record.secret) {
        return Err(
            "This account belongs to a different service. Use the original build to disconnect it."
                .into(),
        );
    }
    Ok(())
}
async fn request(
    api: &reqwest::Url,
    path: &str,
    method: reqwest::Method,
    secret: Option<&str>,
    body: Option<serde_json::Value>,
) -> Result<(u16, serde_json::Value), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Account connection is unavailable.")?;
    let mut builder = client.request(
        method,
        api.join(path).map_err(|_| "Invalid account service.")?,
    );
    if let Some(secret) = secret {
        builder = builder.bearer_auth(secret);
    }
    if let Some(body) = body {
        builder = builder
            .header("content-type", "application/json")
            .body(serde_json::to_vec(&body).map_err(|_| "Could not prepare account request.")?);
    }
    let mut response = builder.send().await.map_err(|_| {
        "Could not reach Jackalope. Your local projects are still available; retry when connected."
    })?;
    let code = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The account response was interrupted. Please retry.")?
    {
        if bytes.len() + chunk.len() > 16384 {
            return Err("The account service returned an invalid response.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((
        code,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    ))
}
fn failure(code: u16) -> String {
    match code {
        429 => "Too many requests. Wait a minute and try again.",
        409 => {
            "Your account has reached its device limit. Disconnect an old device on the website."
        }
        503 => "Account connections are not available yet. Try again later.",
        _ => "The account service could not complete this request. Please retry.",
    }
    .into()
}
#[tauri::command]
pub async fn app_account_status(
    app: AppHandle,
    state: State<'_, AccountService>,
) -> Result<AccountStatus, String> {
    let _guard = state.operation.lock().await;
    if !cfg!(windows) || endpoints(&app).is_err() {
        return Ok(status("unavailable", None));
    }
    let (api, _) = endpoints(&app)?;
    let Some(record) = state.read()? else {
        return Ok(status("disconnected", None));
    };
    bound(&record, &api)?;
    if record.email.is_none() {
        return Ok(status(
            if record.expires_at > chrono::Utc::now().timestamp_millis() {
                "pending"
            } else {
                "expired"
            },
            Some(&record),
        ));
    }
    match request(
        &api,
        "/v1/desktop/me",
        reqwest::Method::GET,
        Some(&record.secret),
        None,
    )
    .await
    {
        Ok((200, data)) if data["email"].as_str() == record.email.as_deref() => {
            Ok(status("connected", Some(&record)))
        }
        Ok((401, _)) => {
            account_storage::remove(&state.path)?;
            Ok(status("disconnected", None))
        }
        _ => Ok(status("offline", Some(&record))),
    }
}
#[tauri::command]
pub async fn app_account_connect(
    app: AppHandle,
    state: State<'_, AccountService>,
) -> Result<AccountStatus, String> {
    let _guard = state.operation.lock().await;
    let (api, web) = endpoints(&app)?;
    if let Some(record) = state.read()? {
        bound(&record, &api)?;
        if record.email.is_some() {
            return Err("Disconnect the current account before connecting another.".into());
        }
        if record.expires_at > chrono::Utc::now().timestamp_millis() {
            return Ok(status("pending", Some(&record)));
        }
    }
    let secret = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge = format!("{:x}", Sha256::digest(secret.as_bytes()));
    let (code, data) = request(
        &api,
        "/v1/desktop/start",
        reqwest::Method::POST,
        None,
        Some(serde_json::json!({"challenge":challenge})),
    )
    .await?;
    if code != 201 {
        return Err(failure(code));
    }
    let verification = data["verification"]
        .as_str()
        .filter(|s| valid_token(s))
        .ok_or("Invalid connection response.")?
        .to_string();
    let user_code = data["userCode"]
        .as_str()
        .filter(|s| s.len() == 8 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("Invalid connection response.")?
        .to_string();
    let expires_at = data["expiresAt"]
        .as_i64()
        .filter(|n| {
            *n > chrono::Utc::now().timestamp_millis()
                && *n <= chrono::Utc::now().timestamp_millis() + 11 * 60000
        })
        .ok_or("Invalid connection expiry.")?;
    let record = SavedAccount {
        origin: api.to_string(),
        secret,
        verification,
        user_code,
        expires_at,
        email: None,
    };
    state.save(&record)?;
    let url = web
        .join(&format!("/access/#desktop={}", record.verification))
        .map_err(|_| "Invalid account page.")?;
    // Saving first lets the user reopen the browser or resume after a restart.
    let _ = app.shell().open(url.as_str(), None);
    Ok(status("pending", Some(&record)))
}
#[tauri::command]
pub async fn app_account_open_browser(
    app: AppHandle,
    state: State<'_, AccountService>,
) -> Result<(), String> {
    let _guard = state.operation.lock().await;
    let (api, web) = endpoints(&app)?;
    let record = state.read()?.ok_or("Start a connection first.")?;
    bound(&record, &api)?;
    let path = if record.email.is_some() {
        "/access/".to_string()
    } else {
        format!("/access/#desktop={}", record.verification)
    };
    app.shell()
        .open(
            web.join(&path)
                .map_err(|_| "Invalid account page.")?
                .as_str(),
            None,
        )
        .map_err(|_| {
            "Could not open your browser. Check your default browser and try again.".into()
        })
}
#[tauri::command]
pub async fn app_account_poll(
    app: AppHandle,
    state: State<'_, AccountService>,
) -> Result<AccountStatus, String> {
    let _guard = state.operation.lock().await;
    let (api, _) = endpoints(&app)?;
    let Some(mut record) = state.read()? else {
        return Ok(status("disconnected", None));
    };
    bound(&record, &api)?;
    if record.email.is_some() {
        return Ok(status("connected", Some(&record)));
    }
    if record.expires_at <= chrono::Utc::now().timestamp_millis() {
        return Ok(status("expired", Some(&record)));
    }
    let (code, data) = request(
        &api,
        "/v1/desktop/exchange",
        reqwest::Method::POST,
        Some(&record.secret),
        None,
    )
    .await?;
    match code {
        202 | 429 => Ok(status("pending", Some(&record))),
        410 | 401 => {
            account_storage::remove(&state.path)?;
            Ok(status("expired", None))
        }
        200 => {
            record.email = Some(
                data["email"]
                    .as_str()
                    .filter(|s| s.len() <= 254 && s.contains('@'))
                    .ok_or("Invalid account response.")?
                    .to_string(),
            );
            record.expires_at = data["expiresAt"]
                .as_i64()
                .ok_or("Invalid account expiry.")?;
            record.verification.clear();
            record.user_code.clear();
            state.save(&record)?;
            Ok(status("connected", Some(&record)))
        }
        _ => Err(failure(code)),
    }
}
#[tauri::command]
pub async fn app_account_disconnect(
    app: AppHandle,
    state: State<'_, AccountService>,
) -> Result<AccountStatus, String> {
    let _guard = state.operation.lock().await;
    let (api, _) = endpoints(&app)?;
    if let Some(record) = state.read()? {
        bound(&record, &api)?;
        let (code, _) = request(
            &api,
            "/v1/desktop/session",
            reqwest::Method::DELETE,
            Some(&record.secret),
            None,
        )
        .await?;
        if code != 200 && code != 401 {
            return Err(failure(code));
        }
        account_storage::remove(&state.path)?;
    }
    Ok(status("disconnected", None))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn renderer_status_never_contains_credentials_or_browser_approval_tokens() {
        let record = SavedAccount {
            origin: "https://api.jackalope.dev/".into(),
            secret: "a".repeat(64),
            verification: "b".repeat(64),
            user_code: "ABCD1234".into(),
            expires_at: 1,
            email: None,
        };
        let result = serde_json::to_string(&status("pending", Some(&record))).unwrap();
        assert!(!result.contains(&record.secret));
        assert!(!result.contains(&record.verification));
        assert!(result.contains(&record.user_code));
        assert!(!result.contains("origin"));
    }
    #[test]
    fn saved_credentials_cannot_follow_a_changed_service_origin() {
        let record = SavedAccount {
            origin: "https://api.jackalope.dev/".into(),
            secret: "a".repeat(64),
            verification: "b".repeat(64),
            user_code: "ABCD1234".into(),
            expires_at: 1,
            email: None,
        };
        assert!(bound(
            &record,
            &reqwest::Url::parse("https://api.jackalope.dev/").unwrap()
        )
        .is_ok());
        assert!(bound(
            &record,
            &reqwest::Url::parse("https://other.example/").unwrap()
        )
        .is_err());
        for token in [
            "",
            "https://evil.example/",
            &"z".repeat(64),
            &"a".repeat(63),
        ] {
            assert!(!valid_token(token));
        }
    }
}
