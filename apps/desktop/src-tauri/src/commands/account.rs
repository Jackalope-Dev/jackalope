use super::account_storage;
use lease::AccountLease;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::{path::PathBuf, time::Duration};
use tauri::Manager;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
pub mod beta;
pub mod feedback;
mod lease;
pub mod lesson_sync;
pub mod settings_sync;
pub mod skill_sync;
mod waitlist;

fn sha256_hex(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Everything that calls the Jackalope service for a member. These are the only
/// features that need a Jackalope account; local tasks, conversations, terminals,
/// previews, checks, swarms, MCP and remote pairing run without one. The
/// renderer mirrors this list in `lib/account-features.ts`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AccountFeature {
    /// Preferences stored on the account so other desktops can restore them.
    SettingsSync,
    /// Learned lessons stored on the account, on top of settings sync.
    LessonSync,
    /// Chosen skills stored on the account, on top of settings sync.
    SkillSync,
    /// The member's share link, Instant Access Passes and their progress.
    Invitations,
    /// Member feedback invitations, coordinated with the service's cooldowns.
    MemberFeedback,
    /// Microsoft Store beta flight requests, which the operator handles.
    BetaProgram,
}

impl AccountFeature {
    fn purpose(self) -> &'static str {
        match self {
            Self::SettingsSync => "sync settings",
            Self::LessonSync => "sync learned lessons",
            Self::SkillSync => "sync skills",
            Self::Invitations => "view invitations",
            Self::MemberFeedback => "manage feedback invitations",
            Self::BetaProgram => "manage beta access",
        }
    }

    pub(super) fn connect_message(self) -> String {
        format!("Connect your Jackalope account to {}.", self.purpose())
    }
}

pub struct AccountService {
    path: PathBuf,
    lease: AccountLease,
    restored: AtomicBool,
    operation: tokio::sync::Mutex<()>,
}
impl AccountService {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lease: AccountLease::default(),
            restored: AtomicBool::new(false),
            operation: tokio::sync::Mutex::new(()),
        }
    }
    fn read(&self) -> Result<Option<SavedAccount>, String> {
        account_storage::read_json(&self.path, "The saved account record is invalid.")
    }
    fn save(&self, record: &SavedAccount) -> Result<(), String> {
        account_storage::write_json(&self.path, record)
    }
    /// Starts the lease from the last saved verification once per launch, so a
    /// feature used before the first background check still honors it.
    fn restore_lease(&self, record: &SavedAccount) {
        if record.waitlist.is_none() && !self.restored.swap(true, Ordering::SeqCst) {
            self.lease.update(record.verified_at, record.expires_at);
        }
    }
    /// The one gate for account features. It refuses before any request unless an
    /// approved account is connected to this service, its device credential has
    /// not expired and its lease is current, so nothing reaches the service for
    /// someone who has not connected.
    fn admit(
        &self,
        record: Option<SavedAccount>,
        api: &reqwest::Url,
        feature: AccountFeature,
    ) -> Result<SavedAccount, String> {
        let record = record.ok_or_else(|| feature.connect_message())?;
        bound(&record, api)?;
        let now = chrono::Utc::now().timestamp_millis();
        if record.email.is_none() || record.expires_at <= now {
            return Err(feature.connect_message());
        }
        if record.waitlist.is_some() {
            return Err(format!(
                "You can {} once your Jackalope account is approved.",
                feature.purpose()
            ));
        }
        self.restore_lease(&record);
        if !self.lease.current_at(now) {
            return Err(format!(
                "Jackalope could not check your account recently. Reconnect to the internet to {}.",
                feature.purpose()
            ));
        }
        Ok(record)
    }
    fn require(
        &self,
        app: &AppHandle,
        feature: AccountFeature,
    ) -> Result<(reqwest::Url, reqwest::Url, SavedAccount), String> {
        let (api, web) = endpoints(app)?;
        let record = self.admit(self.read()?, &api, feature)?;
        Ok((api, web, record))
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
    waitlist: Option<waitlist::WaitlistView>,
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
    waitlist: Option<waitlist::WaitlistView>,
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
    /// Older services omit it; passes then still admit invitees.
    #[serde(rename = "openSignup", default)]
    open_signup: bool,
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
    open_signup: bool,
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
        waitlist: record.and_then(|r| r.waitlist.clone()),
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
/// An opaque key for this computer, so reconnecting from it — from another
/// profile, after a reset or after a reinstall — reuses its account device slot
/// instead of taking a new one. The platform identifier never leaves the
/// machine; only a hash of it, scoped to Jackalope, is sent.
fn machine_key() -> Option<String> {
    key_for(&platform_machine_id()?)
}

fn key_for(identifier: &str) -> Option<String> {
    let identifier = identifier.trim();
    (!identifier.is_empty()).then(|| sha256_hex(&format!("jackalope-device-v1:{identifier}")))
}

#[cfg(target_os = "macos")]
fn platform_machine_id() -> Option<String> {
    let output = std::process::Command::new("/usr/sbin/ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|line| line.contains("\"IOPlatformUUID\""))
        .and_then(|line| line.split('"').nth(3))
        .map(str::to_string)
}

#[cfg(target_os = "linux")]
fn platform_machine_id() -> Option<String> {
    ["/etc/machine-id", "/var/lib/dbus/machine-id"]
        .iter()
        .find_map(|path| std::fs::read_to_string(path).ok())
}

#[cfg(windows)]
fn platform_machine_id() -> Option<String> {
    let output = super::process_control::hidden(&mut std::process::Command::new("reg"))
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|line| line.contains("MachineGuid"))
        .and_then(|line| line.split_whitespace().last())
        .map(str::to_string)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn platform_machine_id() -> Option<String> {
    None
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
        open_signup: response.open_signup,
    })
}
async fn request(
    api: &reqwest::Url,
    path: &str,
    method: reqwest::Method,
    secret: Option<&str>,
    body: Option<serde_json::Value>,
) -> Result<(u16, serde_json::Value), String> {
    request_with_limit(api, path, method, secret, body, 16384).await
}
async fn request_with_limit(
    api: &reqwest::Url,
    path: &str,
    method: reqwest::Method,
    secret: Option<&str>,
    body: Option<serde_json::Value>,
    limit: usize,
) -> Result<(u16, serde_json::Value), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Account connection is unavailable.")?;
    let mut builder = client
        .request(
            method,
            api.join(path).map_err(|_| "Invalid account service.")?,
        )
        .header("x-jackalope-waitlist", "1");
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
        if bytes.len() + chunk.len() > limit {
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
        429 => "Too many requests. Wait a minute and try again.".into(),
        409 => {
            "Your account has reached its device limit. Disconnect an old device on the website."
                .into()
        }
        503 => "Account connections are not available yet. Try again later.".into(),
        // An unmapped status has no advice worth giving, so name it instead of
        // hiding it: without the code there is nothing to act on or report.
        _ => format!(
            "The account service could not complete this request (HTTP {code}). Please retry."
        ),
    }
}

async fn sync_device_name(api: &reqwest::Url, secret: &str, data: &serde_json::Value) {
    let metadata = device_metadata(
        cfg!(debug_assertions),
        std::env::var_os("JACKALOPE_PROFILE_DIR").is_some()
            || cfg!(debug_assertions) && std::env::var_os("JACKALOPE_TEST_DATA_DIR").is_some(),
    );
    if data.get("deviceMetadata").is_some() && data["deviceMetadata"] != metadata {
        let _ = request(
            api,
            "/v1/desktop/metadata",
            reqwest::Method::POST,
            Some(secret),
            Some(metadata),
        )
        .await;
    }
    // Older services omit this field and do not support device names.
    if data.get("deviceName").is_none() {
        return;
    }
    let name: String = super::system::device_name()
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(120)
        .collect();
    if name.is_empty() || data["deviceName"].as_str() == Some(name.as_str()) {
        return;
    }
    let _ = request(
        api,
        "/v1/desktop/name",
        reqwest::Method::POST,
        Some(secret),
        Some(serde_json::json!({ "name": name })),
    )
    .await;
}
fn device_metadata(development: bool, isolated: bool) -> serde_json::Value {
    serde_json::json!({
        "appVersion": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "buildKind": if development { "development" } else { "release" },
        "profileKind": if isolated { "isolated" } else { "default" },
    })
}
macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::account::app_account_status,
            commands::account::settings_sync::app_settings_sync,
            commands::account::lesson_sync::app_lesson_sync,
            commands::account::skill_sync::app_skill_sync,
            commands::account::app_account_connect,
            commands::account::app_account_open_browser,
            commands::account::app_account_referrals,
            commands::account::app_account_open_referrals,
            commands::account::app_account_poll,
            commands::account::app_account_disconnect,
            commands::account::beta::app_account_beta,
            commands::account::feedback::app_account_feedback,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

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
            self.lease.revoke();
        }
        result
    }

    async fn refresh_locked(&self, app: &AppHandle) -> Result<AccountStatus, String> {
        if endpoints(app).is_err() {
            self.lease.revoke();
            return Ok(status("unavailable", None));
        }
        let (api, web) = endpoints(app)?;
        let Some(mut record) = self.read()? else {
            self.lease.revoke();
            return Ok(status("disconnected", None));
        };
        bound(&record, &api)?;
        let now = chrono::Utc::now().timestamp_millis();
        if record.email.is_none() {
            self.lease.revoke();
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
        if record.waitlist.is_some() {
            self.lease.revoke();
        } else {
            self.restore_lease(&record);
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
                    && matches!(data["status"].as_str(), Some("approved" | "waiting"))
                    && data["expiresAt"]
                        .as_i64()
                        .is_some_and(|expiry| expiry > now) =>
            {
                let next = match waitlist::accept(&mut record, &data, &web, now) {
                    Ok(next) => next,
                    Err(error) => {
                        record.verified_at = 0;
                        self.save(&record)?;
                        return Err(error);
                    }
                };
                self.save(&record)?;
                self.lease.update(record.verified_at, record.expires_at);
                sync_device_name(&api, &record.secret, &data).await;
                Ok(status(next, Some(&record)))
            }
            Ok((401, _)) => {
                self.lease.revoke();
                account_storage::remove(&self.path)?;
                Ok(status("disconnected", None))
            }
            Ok((200, _)) => {
                self.lease.revoke();
                record.verified_at = 0;
                self.save(&record)?;
                Err("The account service returned an invalid approval. Please retry.".into())
            }
            _ => Ok(status(
                if record.waitlist.is_some() {
                    "waiting-offline"
                } else {
                    "offline"
                },
                Some(&record),
            )),
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
    let challenge = sha256_hex(&secret);
    let start = |body: serde_json::Value| {
        let api = api.clone();
        async move {
            request(
                &api,
                "/v1/desktop/start",
                reqwest::Method::POST,
                None,
                Some(body),
            )
            .await
        }
    };
    let (mut code, mut data) = match machine_key() {
        Some(key) => start(serde_json::json!({"challenge":challenge,"deviceKey":key})).await?,
        None => start(serde_json::json!({"challenge":challenge})).await?,
    };
    if code == 400 {
        // A service that predates machine keys rejects the unknown field.
        // Connecting still works; this machine just takes a slot per connection.
        (code, data) = start(serde_json::json!({"challenge":challenge})).await?;
    }
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
        waitlist: None,
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
    let _ = app.opener().open_url(url.as_str(), None::<&str>);
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
    let path = if record.waitlist.is_some() {
        "/waitlist/".to_string()
    } else if record.email.is_some() {
        "/access/".to_string()
    } else {
        format!("/access/#desktop={}", record.verification)
    };
    app.opener()
        .open_url(
            web.join(&path)
                .map_err(|_| "Invalid account page.")?
                .as_str(),
            None::<&str>,
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
    let (api, web, record) = state.require(&app, AccountFeature::Invitations)?;
    let (code, data) = request(
        &api,
        "/v1/desktop/referrals",
        reqwest::Method::GET,
        Some(&record.secret),
        None,
    )
    .await?;
    if code == 401 {
        state.lease.revoke();
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
    app.opener()
        .open_url(
            web.join("/access/#invitations")
                .map_err(|_| "Invalid account page.")?
                .as_str(),
            None::<&str>,
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
    let (api, web) = endpoints(&app)?;
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
            state.lease.revoke();
            account_storage::remove(&state.path)?;
            Ok(status("expired", None))
        }
        200 => {
            let next = waitlist::accept(
                &mut record,
                &data,
                &web,
                chrono::Utc::now().timestamp_millis(),
            )?;
            state.save(&record)?;
            state.lease.update(record.verified_at, record.expires_at);
            sync_device_name(&api, &record.secret, &data).await;
            Ok(status(next, Some(&record)))
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
        state.lease.revoke();
        account_storage::remove(&state.path)?;
    }
    Ok(status("disconnected", None))
}

/// Account states that local work must never depend on, held in memory so tests
/// never touch the OS credential store.
#[cfg(test)]
pub(crate) mod fixture {
    use super::*;

    #[derive(Clone, Copy, Debug)]
    pub(crate) enum State {
        /// Never connected.
        None,
        /// Connected, but the device credential has expired.
        Expired,
        /// Connected, but not verified within the offline lease.
        Lapsed,
        /// Connected, but the service refused the approval, so the lease was revoked.
        Revoked,
    }
    pub(crate) const STATES: [State; 4] =
        [State::None, State::Expired, State::Lapsed, State::Revoked];
    pub(crate) const FEATURES: [AccountFeature; 6] = [
        AccountFeature::SettingsSync,
        AccountFeature::LessonSync,
        AccountFeature::SkillSync,
        AccountFeature::Invitations,
        AccountFeature::MemberFeedback,
        AccountFeature::BetaProgram,
    ];

    pub(super) fn api() -> reqwest::Url {
        reqwest::Url::parse("https://api.jackalope.dev/").unwrap()
    }

    pub(super) fn approved(verified_at: i64, expires_at: i64) -> SavedAccount {
        SavedAccount {
            origin: api().to_string(),
            secret: "a".repeat(64),
            verification: String::new(),
            user_code: String::new(),
            expires_at,
            email: Some("member@example.invalid".into()),
            verified_at,
            waitlist: None,
            feedback: feedback::LocalFeedback::default(),
            settings_sync: true,
            settings_sync_pending: false,
            settings_sync_automatic: false,
        }
    }

    pub(crate) struct Account {
        pub(super) service: AccountService,
        pub(super) record: Option<SavedAccount>,
    }

    impl Account {
        pub(crate) fn new(state: State) -> Self {
            let now = chrono::Utc::now().timestamp_millis();
            let service = AccountService::new(std::env::temp_dir().join(format!(
                "jackalope-account-fixture-{}.bin",
                uuid::Uuid::new_v4()
            )));
            let record = match state {
                State::None => None,
                State::Expired => Some(approved(now - 1000, now - 1)),
                State::Lapsed => Some(approved(
                    now - lease::OFFLINE_GRACE_MS - 1,
                    now + lease::OFFLINE_GRACE_MS,
                )),
                State::Revoked => {
                    let record = approved(now, now + lease::OFFLINE_GRACE_MS);
                    service.restore_lease(&record);
                    service.lease.revoke();
                    Some(record)
                }
            };
            Self { service, record }
        }

        /// What `feature` answers in this state: the refusal, or `Ok` when admitted.
        pub(crate) fn admit(&self, feature: AccountFeature) -> Result<(), String> {
            self.service
                .admit(self.record.as_ref().map(clone_record), &api(), feature)
                .map(|_| ())
        }
    }

    fn clone_record(record: &SavedAccount) -> SavedAccount {
        serde_json::from_value(serde_json::to_value(record).unwrap()).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn machine_key_is_stable_and_never_the_raw_identifier() {
        let raw = "4C4C4544-0042-3510-8051-B4C04F4D3732";
        let key = key_for(&format!("{raw}\n")).unwrap();
        assert!(
            valid_token(&key),
            "the service only accepts 64 lowercase hex"
        );
        assert_eq!(key_for(raw).as_deref(), Some(key.as_str()));
        assert!(!key.contains(raw) && !key.contains(&raw.to_lowercase()));
        assert_eq!(key_for(" \n"), None);
    }
    #[test]
    fn account_hashes_preserve_lowercase_hex_and_leading_zeroes() {
        assert_eq!(
            sha256_hex("hello world"),
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    #[test]
    fn device_metadata_distinguishes_profiles_without_sending_paths() {
        let default = device_metadata(false, false);
        assert_eq!(default["buildKind"], "release");
        assert_eq!(default["profileKind"], "default");
        let isolated = device_metadata(true, true);
        assert_eq!(isolated["buildKind"], "development");
        assert_eq!(isolated["profileKind"], "isolated");
        assert_eq!(isolated.as_object().unwrap().len(), 4);
    }
    #[test]
    fn legacy_saved_accounts_need_online_verification_before_account_features() {
        let record: SavedAccount = serde_json::from_value(serde_json::json!({
            "origin": "https://api.jackalope.dev/", "secret": "a".repeat(64),
            "verification": "", "user_code": "", "expires_at": i64::MAX,
            "email": "member@example.invalid"
        }))
        .unwrap();
        let lease = AccountLease::default();
        lease.update(record.verified_at, record.expires_at);
        assert!(!lease.current_at(chrono::Utc::now().timestamp_millis()));
        assert!(!record.settings_sync);
        assert!(!record.settings_sync_pending);
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
            waitlist: None,
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
            waitlist: None,
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

    #[test]
    fn account_features_refuse_cleanly_without_a_current_approved_account() {
        use fixture::{Account, State, FEATURES, STATES};
        for state in STATES {
            let account = Account::new(state);
            for feature in FEATURES {
                let refusal = account.admit(feature).unwrap_err();
                assert!(
                    refusal.contains(feature.purpose()),
                    "{state:?} {feature:?}: {refusal}"
                );
                assert!(!refusal.contains(&"a".repeat(64)));
                if matches!(state, State::None | State::Expired) {
                    assert_eq!(refusal, feature.connect_message());
                }
            }
        }
    }

    #[test]
    fn a_current_approved_account_is_admitted_until_revoked() {
        let now = chrono::Utc::now().timestamp_millis();
        let account = fixture::Account {
            service: AccountService::new(std::env::temp_dir().join("jackalope-unused.bin")),
            record: Some(fixture::approved(now, now + lease::OFFLINE_GRACE_MS)),
        };
        for feature in fixture::FEATURES {
            account.admit(feature).unwrap();
        }
        account.service.lease.revoke();
        assert!(account.admit(AccountFeature::SettingsSync).is_err());

        let mut waiting = fixture::approved(now, now + lease::OFFLINE_GRACE_MS);
        waiting.waitlist = Some(serde_json::from_value(serde_json::json!({
            "position": 4, "referrals": 0, "pending": 0, "priorityDays": 0,
            "shareUrl": format!("https://jackalope.dev/?ref={}", "c".repeat(64)), "checkedAt": now
        })).unwrap());
        let service = AccountService::new(std::env::temp_dir().join("jackalope-unused.bin"));
        assert!(service
            .admit(Some(waiting), &fixture::api(), AccountFeature::Invitations)
            .err()
            .unwrap()
            .contains("once your Jackalope account is approved"));

        let mut other = fixture::approved(now, now + lease::OFFLINE_GRACE_MS);
        other.origin = "https://other.example/".into();
        assert!(service
            .admit(Some(other), &fixture::api(), AccountFeature::SettingsSync)
            .err()
            .unwrap()
            .contains("different service"));
    }
}
