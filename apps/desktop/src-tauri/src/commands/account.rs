use super::{account_storage, execution_access::ExecutionAccess};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::{path::PathBuf, time::Duration};
use tauri::Manager;
use tauri::{AppHandle, State};
use tauri_plugin_shell::ShellExt;
pub mod feedback;
pub mod settings_sync;

pub struct AccountService {
    path: PathBuf,
    access: Arc<ExecutionAccess>,
    restored: AtomicBool,
    operation: tokio::sync::Mutex<()>,
}
impl AccountService {
    pub fn new(path: PathBuf, access: Arc<ExecutionAccess>) -> Self {
        Self {
            path,
            access,
            restored: AtomicBool::new(false),
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
    #[serde(default)]
    verified_at: i64,
    #[serde(default)]
    feedback: feedback::LocalFeedback,
    #[serde(default)]
    settings_sync: bool,
    #[serde(default)]
    settings_sync_pending: bool,
    #[serde(default)]
    settings_sync_automatic: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    state: &'static str,
    email: Option<String>,
    user_code: Option<String>,
    expires_at: Option<i64>,
}
#[derive(Deserialize)]
struct ReferralResponse {
    limit: u16,
    remaining: u16,
    accepted: u16,
    downloaded: u16,
    connected: u16,
    #[serde(rename = "shareUrl")]
    share_url: String,
    invites: Vec<ReferralInviteResponse>,
}
#[derive(Deserialize)]
struct ReferralInviteResponse {
    id: String,
    email: String,
    status: String,
    expires_at: i64,
    accepted_at: Option<i64>,
    downloaded_at: Option<i64>,
    connected_at: Option<i64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferralView {
    limit: u16,
    remaining: u16,
    accepted: u16,
    downloaded: u16,
    connected: u16,
    share_url: String,
    invites: Vec<ReferralInvite>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferralInvite {
    id: String,
    email: String,
    status: String,
    expires_at: i64,
    accepted_at: Option<i64>,
    downloaded_at: Option<i64>,
    connected_at: Option<i64>,
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
fn parse_referrals(data: serde_json::Value, web: &reqwest::Url) -> Result<ReferralView, String> {
    let response: ReferralResponse = serde_json::from_value(data)
        .map_err(|_| "The account service returned invalid invitations.")?;
    let share = reqwest::Url::parse(&response.share_url)
        .map_err(|_| "The account service returned an invalid invitation link.")?;
    let query: Vec<_> = share.query_pairs().collect();
    if share.scheme() != web.scheme()
        || share.host_str() != web.host_str()
        || share.port_or_known_default() != web.port_or_known_default()
        || !share.username().is_empty()
        || share.password().is_some()
        || share.path() != "/access/"
        || share.fragment().is_some()
        || query.len() != 1
        || query[0].0 != "invite"
        || !valid_token(&query[0].1)
        || response.remaining > response.limit
        || response.accepted > response.limit
        || response.downloaded > response.accepted
        || response.connected > response.accepted
        || response.invites.len() > 100
    {
        return Err("The account service returned invalid invitations.".into());
    }
    let mut invites = Vec::with_capacity(response.invites.len());
    for invite in response.invites {
        if uuid::Uuid::parse_str(&invite.id).is_err()
            || invite.email.len() > 254
            || !invite.email.contains('@')
            || !matches!(invite.status.as_str(), "pending" | "accepted")
            || invite.downloaded_at.is_some() && invite.accepted_at.is_none()
            || invite.connected_at.is_some() && invite.accepted_at.is_none()
        {
            return Err("The account service returned invalid invitations.".into());
        }
        invites.push(ReferralInvite {
            id: invite.id,
            email: invite.email,
            status: invite.status,
            expires_at: invite.expires_at,
            accepted_at: invite.accepted_at,
            downloaded_at: invite.downloaded_at,
            connected_at: invite.connected_at,
        });
    }
    Ok(ReferralView {
        limit: response.limit,
        remaining: response.remaining,
        accepted: response.accepted,
        downloaded: response.downloaded,
        connected: response.connected,
        share_url: response.share_url,
        invites,
    })
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
    state.refresh(&app).await
}
impl AccountService {
    async fn refresh(&self, app: &AppHandle) -> Result<AccountStatus, String> {
        let _guard = self.operation.lock().await;
        let result = self.refresh_locked(app).await;
        if result.is_err() {
            self.access.revoke();
        }
        result
    }

    async fn refresh_locked(&self, app: &AppHandle) -> Result<AccountStatus, String> {
        if !cfg!(windows) || endpoints(app).is_err() {
            self.access.revoke();
            return Ok(status("unavailable", None));
        }
        let (api, _) = endpoints(app)?;
        let Some(mut record) = self.read()? else {
            self.access.revoke();
            return Ok(status("disconnected", None));
        };
        bound(&record, &api)?;
        let now = chrono::Utc::now().timestamp_millis();
        if record.email.is_none() {
            self.access.revoke();
            return Ok(status(
                if record.expires_at > now {
                    "pending"
                } else {
                    "expired"
                },
                Some(&record),
            ));
        }
        // Only a previous server verification can authorize a bounded offline lease.
        if !self.restored.swap(true, Ordering::SeqCst) {
            self.access.update(record.verified_at, record.expires_at);
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
            Ok((200, data))
                if data["email"].as_str() == record.email.as_deref()
                    && data["status"] == "approved"
                    && data["expiresAt"]
                        .as_i64()
                        .is_some_and(|expiry| expiry > now) =>
            {
                record.verified_at = chrono::Utc::now().timestamp_millis();
                record.expires_at = data["expiresAt"].as_i64().unwrap();
                self.save(&record)?;
                self.access.update(record.verified_at, record.expires_at);
                Ok(status("connected", Some(&record)))
            }
            Ok((401, _)) => {
                self.access.revoke();
                account_storage::remove(&self.path)?;
                Ok(status("disconnected", None))
            }
            Ok((200, _)) => {
                self.access.revoke();
                record.verified_at = 0;
                self.save(&record)?;
                Err("The account service returned an invalid approval. Please retry.".into())
            }
            _ => Ok(status("offline", Some(&record))),
        }
    }
}

pub fn launch_refresh(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let _ = app.state::<AccountService>().refresh(&app).await;
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });
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
    let sync_choice = settings_sync::read_choice(&state)?;
    let record = SavedAccount {
        origin: api.to_string(),
        secret,
        verification,
        user_code,
        expires_at,
        email: None,
        verified_at: 0,
        feedback: feedback::LocalFeedback::default(),
        settings_sync: sync_choice.enabled,
        settings_sync_pending: false,
        settings_sync_automatic: !sync_choice.explicit,
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
pub async fn app_account_referrals(
    app: AppHandle,
    state: State<'_, AccountService>,
) -> Result<ReferralView, String> {
    let _guard = state.operation.lock().await;
    let (api, web) = endpoints(&app)?;
    let record = state
        .read()?
        .ok_or("Connect your Jackalope account to view invitations.")?;
    bound(&record, &api)?;
    if record.email.is_none() {
        return Err("Finish connecting your Jackalope account to view invitations.".into());
    }
    let (code, data) = request(
        &api,
        "/v1/desktop/referrals",
        reqwest::Method::GET,
        Some(&record.secret),
        None,
    )
    .await?;
    if code == 401 {
        state.access.revoke();
        account_storage::remove(&state.path)?;
        return Err("Your account connection expired. Connect again to view invitations.".into());
    }
    if code != 200 {
        return Err(failure(code));
    }
    parse_referrals(data, &web)
}
#[tauri::command]
pub async fn app_account_open_referrals(
    app: AppHandle,
    state: State<'_, AccountService>,
) -> Result<(), String> {
    let _guard = state.operation.lock().await;
    let (api, web) = endpoints(&app)?;
    let record = state
        .read()?
        .ok_or("Connect your Jackalope account first.")?;
    bound(&record, &api)?;
    if record.email.is_none() {
        return Err("Finish connecting your Jackalope account first.".into());
    }
    app.shell()
        .open(
            web.join("/access/#invitations")
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
        drop(_guard);
        return state.refresh(&app).await;
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
        202 if data["status"] == "waiting" => Ok(status("waiting", Some(&record))),
        202 | 429 => Ok(status("pending", Some(&record))),
        410 | 401 => {
            state.access.revoke();
            account_storage::remove(&state.path)?;
            Ok(status("expired", None))
        }
        200 => {
            if data["status"] != "approved" {
                return Err("Invalid account approval.".into());
            }
            record.email = Some(
                data["email"]
                    .as_str()
                    .filter(|s| s.len() <= 254 && s.contains('@'))
                    .ok_or("Invalid account response.")?
                    .to_string(),
            );
            record.expires_at = data["expiresAt"]
                .as_i64()
                .filter(|expiry| *expiry > chrono::Utc::now().timestamp_millis())
                .ok_or("Invalid account expiry.")?;
            record.verified_at = chrono::Utc::now().timestamp_millis();
            record.verification.clear();
            record.user_code.clear();
            record.settings_sync_pending = record.settings_sync;
            state.save(&record)?;
            state.access.update(record.verified_at, record.expires_at);
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
        settings_sync::preserve_choice(&state, &record)?;
        state.access.revoke();
        account_storage::remove(&state.path)?;
    }
    Ok(status("disconnected", None))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_saved_accounts_need_online_verification_before_beta_execution() {
        let record: SavedAccount = serde_json::from_value(serde_json::json!({
            "origin": "https://api.jackalope.dev/", "secret": "a".repeat(64),
            "verification": "", "user_code": "", "expires_at": i64::MAX,
            "email": "member@example.invalid"
        }))
        .unwrap();
        let access = ExecutionAccess::new(true);
        access.update(record.verified_at, record.expires_at);
        assert!(!access.status().allowed);
        assert_eq!(record.email.as_deref(), Some("member@example.invalid"));
    }
    #[test]
    fn renderer_status_never_contains_credentials_or_browser_approval_tokens() {
        let record = SavedAccount {
            origin: "https://api.jackalope.dev/".into(),
            secret: "a".repeat(64),
            verification: "b".repeat(64),
            user_code: "ABCD1234".into(),
            expires_at: 1,
            email: None,
            verified_at: 0,
            feedback: feedback::LocalFeedback::default(),
            settings_sync: false,
            settings_sync_pending: false,
            settings_sync_automatic: false,
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
            verified_at: 0,
            feedback: feedback::LocalFeedback::default(),
            settings_sync: false,
            settings_sync_pending: false,
            settings_sync_automatic: false,
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
    #[test]
    fn referral_responses_are_bounded_to_the_configured_website() {
        let web = reqwest::Url::parse("https://jackalope.dev/").unwrap();
        let invitation = uuid::Uuid::new_v4().to_string();
        let result = parse_referrals(
            serde_json::json!({
                "limit": 5,
                "remaining": 4,
                "accepted": 1,
                "downloaded": 1,
                "connected": 1,
                "shareUrl": format!("https://jackalope.dev/access/?invite={}", "a".repeat(64)),
                "invites": [{
                    "id": invitation,
                    "email": "friend@example.invalid",
                    "status": "accepted",
                    "expires_at": 1,
                    "accepted_at": 1,
                    "downloaded_at": 1,
                    "connected_at": 2
                }]
            }),
            &web,
        )
        .unwrap();
        assert_eq!(result.remaining, 4);
        for share_url in [
            format!("https://evil.example/access/?invite={}", "a".repeat(64)),
            format!("https://jackalope.dev/other/?invite={}", "a".repeat(64)),
            "https://jackalope.dev/access/?invite=short".into(),
        ] {
            assert!(parse_referrals(
                serde_json::json!({
                    "limit": 5, "remaining": 5, "accepted": 0, "downloaded": 0, "connected": 0,
                    "shareUrl": share_url, "invites": []
                }),
                &web,
            )
            .is_err());
        }
    }
}
