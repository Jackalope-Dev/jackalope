use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex, time::Duration};
use tauri::{AppHandle, State};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ReleaseChannel {
    #[default]
    Stable,
    Beta,
}
impl ReleaseChannel {
    pub fn label(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub reviewed: bool,
    pub telemetry: bool,
    pub errors: bool,
    pub channel: Option<ReleaseChannel>,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            reviewed: false,
            telemetry: true,
            errors: true,
            channel: None,
        }
    }
}
pub struct Community {
    path: PathBuf,
    prefs: Mutex<Preferences>,
    cancel: tokio::sync::watch::Sender<u64>,
}
impl Community {
    pub fn load(path: PathBuf) -> Self {
        let prefs = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let (cancel, _) = tokio::sync::watch::channel(0);
        Self {
            path,
            prefs: Mutex::new(prefs),
            cancel,
        }
    }
    pub fn preferences(&self) -> Result<Preferences, String> {
        self.prefs
            .lock()
            .map(|p| p.clone())
            .map_err(|_| "Community settings unavailable.".into())
    }
    fn update(&self, edit: impl FnOnce(&mut Preferences)) -> Result<(), String> {
        let mut prefs = self
            .prefs
            .lock()
            .map_err(|_| "Community settings unavailable.")?;
        let mut next = prefs.clone();
        edit(&mut next);
        super::history::write_atomic(
            &self.path,
            &serde_json::to_vec(&next).map_err(|_| "Could not encode settings.")?,
        )?;
        *prefs = next;
        self.cancel
            .send_modify(|generation| *generation = generation.wrapping_add(1));
        Ok(())
    }
}
pub fn build_channel(app: &AppHandle) -> ReleaseChannel {
    if app
        .config()
        .plugins
        .0
        .get("jackalope")
        .and_then(|c| c.get("channel"))
        .and_then(|c| c.as_str())
        == Some("beta")
    {
        ReleaseChannel::Beta
    } else {
        ReleaseChannel::Stable
    }
}
pub fn configured_url(app: &AppHandle, key: &str) -> Option<reqwest::Url> {
    let config = app.config();
    let value = config.plugins.0.get("jackalope")?.get(key)?.as_str()?;
    let url = reqwest::Url::parse(value).ok()?;
    (url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && url.query().is_none())
    .then_some(url)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityStatus {
    #[serde(flatten)]
    prefs: Preferences,
    configured: bool,
    build_channel: ReleaseChannel,
}
#[tauri::command]
pub fn app_community_settings(
    app: AppHandle,
    state: State<'_, Community>,
) -> Result<CommunityStatus, String> {
    Ok(CommunityStatus {
        prefs: state.preferences()?,
        configured: configured_url(&app, "serviceUrl").is_some(),
        build_channel: build_channel(&app),
    })
}
#[tauri::command]
pub fn app_community_configure(
    app: AppHandle,
    state: State<'_, Community>,
    telemetry: bool,
    errors: bool,
) -> Result<CommunityStatus, String> {
    state.update(|p| {
        p.reviewed = true;
        p.telemetry = telemetry;
        p.errors = errors;
    })?;
    app_community_settings(app, state)
}
#[tauri::command]
pub fn app_release_channel(
    app: AppHandle,
    state: State<'_, Community>,
    channel: ReleaseChannel,
) -> Result<(), String> {
    let _guard = super::integration::execution_guard()?;
    if super::release::installing() {
        return Err("Wait for the update to finish before changing channels.".into());
    }
    if configured_url(&app, "stableEndpoint").is_none()
        || configured_url(&app, "betaEndpoint").is_none()
    {
        return Err("This build does not support switching update channels.".into());
    }
    state.update(|p| p.channel = Some(channel))
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "name", rename_all = "snake_case", deny_unknown_fields)]
pub enum Metric {
    AppOpened { id: String },
    TaskState { id: String, state: TaskState },
    FeatureUsed { id: String, feature: Feature },
    AppError { id: String, code: ErrorCode },
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Starting,
    Running,
    Review,
    Reviewed,
    Failed,
    Stopped,
    Interrupted,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Feature {
    Tasks,
    Worktrees,
    Agents,
    Usage,
    Codebase,
    Settings,
    Connections,
    Schedules,
    Browser,
    Queue,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    HistorySaveFailed,
    VerificationFailed,
    UpdateFailed,
    UiError,
    TaskFailed,
}
fn valid_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|id| id.get_version_num() == 4)
}
impl Metric {
    fn id(&self) -> &str {
        match self {
            Self::AppOpened { id }
            | Self::TaskState { id, .. }
            | Self::FeatureUsed { id, .. }
            | Self::AppError { id, .. } => id,
        }
    }
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Service connection unavailable.".into())
}
async fn post(app: &AppHandle, path: &str, body: serde_json::Value) -> Result<(), String> {
    let base = configured_url(app, "serviceUrl")
        .ok_or("This build has no configured feedback service.")?;
    let url = base
        .join(path)
        .map_err(|_| "Invalid service configuration.")?;
    let response = client()?
        .post(url)
        .header("content-type", "application/json")
        .body(serde_json::to_vec(&body).map_err(|_| "Could not encode report.")?)
        .send()
        .await
        .map_err(|_| {
            "Could not reach Jackalope. Your report has not been confirmed; retry when connected."
        })?;
    match response.status().as_u16() {
        202 => Ok(()),
        429 => Err("Too many requests. Wait a minute before retrying.".into()),
        503 => {
            Err("The feedback service is temporarily unavailable. Please try again later.".into())
        }
        _ => Err(
            "The service did not accept this report. Check for an app update before retrying."
                .into(),
        ),
    }
}
#[tauri::command]
pub async fn app_telemetry(
    app: AppHandle,
    state: State<'_, Community>,
    events: Vec<Metric>,
) -> Result<(), String> {
    let mut canceled = state.cancel.subscribe();
    let prefs = state.preferences()?;
    if !prefs.reviewed || !prefs.telemetry {
        return Ok(());
    }
    if events.is_empty() || events.len() > 50 || events.iter().any(|e| !valid_id(e.id())) {
        return Err("Invalid telemetry batch.".into());
    }
    let events: Vec<_> = events
        .into_iter()
        .filter(|e| prefs.errors || !matches!(e, Metric::AppError { .. }))
        .map(|e| {
            let mut event = serde_json::to_value(e).expect("metric serializes");
            event["appVersion"] = env!("CARGO_PKG_VERSION").into();
            event["os"] = std::env::consts::OS.into();
            event["channel"] = build_channel(&app).label().into();
            event
        })
        .collect();
    if events.is_empty() {
        return Ok(());
    }
    tokio::select! { result=post(&app,"/v2/telemetry",serde_json::json!({"schemaVersion":2,"events":events}))=>result, _=canceled.changed()=>Ok(()) }
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FeedbackKind {
    Bug,
    Feature,
    Idea,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FeedbackCounts {
    attempts: u32,
    reviewed: u32,
    failed: u32,
    history_save_failures: u32,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FeedbackRequest {
    id: String,
    kind: FeedbackKind,
    message: String,
    diagnostics: Option<FeedbackCounts>,
}
#[tauri::command]
pub async fn app_submit_feedback(
    app: AppHandle,
    request: FeedbackRequest,
) -> Result<String, String> {
    if !valid_id(&request.id)
        || request.message.trim().is_empty()
        || request.message.encode_utf16().count() > 8000
    {
        return Err("Enter a report of 1–8,000 characters.".into());
    }
    let id = request.id.clone();
    let mut body = serde_json::to_value(request).map_err(|_| "Could not encode report.")?;
    if body["diagnostics"].is_null() {
        body.as_object_mut().unwrap().remove("diagnostics");
    }
    body["schemaVersion"] = 2.into();
    body["appVersion"] = env!("CARGO_PKG_VERSION").into();
    body["os"] = std::env::consts::OS.into();
    body["channel"] = build_channel(&app).label().into();
    post(&app, "/v2/feedback", body).await?;
    Ok(id)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metrics_reject_content_and_unknown_dimensions() {
        assert!(serde_json::from_value::<Metric>(
            serde_json::json!({"name":"app_error","id":"x","code":"/private/source.ts"})
        )
        .is_err());
        assert!(serde_json::from_value::<Metric>(
            serde_json::json!({"name":"app_opened","id":"x","prompt":"secret"})
        )
        .is_err());
    }
    #[test]
    fn preference_defaults_require_disclosure_and_save_selection() {
        let dir =
            std::env::temp_dir().join(format!("jackalope-community-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let state = Community::load(path.clone());
        assert!(!state.preferences().unwrap().reviewed);
        state
            .update(|p| {
                p.reviewed = true;
                p.telemetry = false;
                p.channel = Some(ReleaseChannel::Beta)
            })
            .unwrap();
        let loaded = Community::load(path);
        assert!(!loaded.preferences().unwrap().telemetry);
        assert_eq!(
            loaded.preferences().unwrap().channel,
            Some(ReleaseChannel::Beta)
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
