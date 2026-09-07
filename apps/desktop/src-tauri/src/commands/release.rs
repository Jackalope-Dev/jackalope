use super::{
    community::{self, Community, ReleaseChannel},
    tasks::TaskRuntime,
};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, State};
use tauri_plugin_updater::UpdaterExt;

static INSTALLING: AtomicBool = AtomicBool::new(false);
pub fn installing() -> bool {
    INSTALLING.load(Ordering::SeqCst)
}
struct InstallGuard;
impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::SeqCst);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseStatus {
    current_version: String,
    channel: ReleaseChannel,
    beta_available: bool,
    configured: bool,
    available_version: Option<String>,
    notes: Option<String>,
}

fn configured(app: &AppHandle) -> bool {
    let config = app.config();
    let Some(updater) = config.plugins.0.get("updater") else {
        return false;
    };
    updater["pubkey"]
        .as_str()
        .is_some_and(|key| !key.trim().is_empty())
        && updater["endpoints"].as_array().is_some_and(|urls| {
            !urls.is_empty()
                && urls
                    .iter()
                    .all(|url| url.as_str().is_some_and(|url| url.starts_with("https://")))
        })
}

fn channel_endpoint(app: &AppHandle, channel: ReleaseChannel) -> Option<reqwest::Url> {
    community::configured_url(
        app,
        match channel {
            ReleaseChannel::Stable => "stableEndpoint",
            ReleaseChannel::Beta => "betaEndpoint",
        },
    )
}
fn updater(
    app: &AppHandle,
    channel: ReleaseChannel,
    seconds: u64,
) -> Result<tauri_plugin_updater::Updater, String> {
    let mut builder = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(seconds));
    if let Some(endpoint) = channel_endpoint(app, channel) {
        builder = builder
            .endpoints(vec![endpoint])
            .map_err(|_| "Invalid update channel.")?;
    } else if channel != community::build_channel(app) {
        return Err("This build has no trusted source for that channel.".into());
    }
    builder
        .build()
        .map_err(|_| "Update settings unavailable.".into())
}
#[tauri::command]
pub async fn app_release_status(
    app: AppHandle,
    state: State<'_, Community>,
    check: bool,
) -> Result<ReleaseStatus, String> {
    let channel = state
        .preferences()?
        .channel
        .unwrap_or_else(|| community::build_channel(&app));
    let mut status = ReleaseStatus {
        channel,
        beta_available: channel_endpoint(&app, ReleaseChannel::Beta).is_some()
            && channel_endpoint(&app, ReleaseChannel::Stable).is_some(),
        current_version: env!("CARGO_PKG_VERSION").into(),
        configured: configured(&app),
        available_version: None,
        notes: None,
    };
    if check && status.configured {
        let updater = updater(&app, channel, 30)?;
        if let Some(update) = updater.check().await.map_err(|_| {
            "Could not reach the update service. Check your connection and try again.".to_string()
        })? {
            status.available_version = Some(update.version);
            status.notes = update.body;
        }
    }
    Ok(status)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    phase: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

#[tauri::command]
pub async fn app_install_update(
    app: AppHandle,
    version: String,
    channel: ReleaseChannel,
    state: State<'_, Community>,
    progress: tauri::ipc::Channel<UpdateProgress>,
    runtime: State<'_, TaskRuntime>,
) -> Result<(), String> {
    if !configured(&app) {
        return Err("This build has no trusted update source.".into());
    }
    {
        let _guard = super::integration::execution_guard()?;
        runtime.ensure_history_saved()?;
        if state
            .preferences()?
            .channel
            .unwrap_or_else(|| community::build_channel(&app))
            != channel
        {
            return Err("The update channel changed. Check again before installing.".into());
        }
        if installing() {
            return Err("An update is already being installed.".into());
        }
        if runtime.integration_runs()?.iter().any(|r| {
            ["starting", "running", "stopping", "interrupted"].contains(&r.status.as_str())
        }) {
            return Err(
                "Finish active tasks and resolve interrupted work before installing an update."
                    .into(),
            );
        }
        INSTALLING.store(true, Ordering::SeqCst);
    }
    let _install = InstallGuard;
    let updater = updater(&app, channel, 60)?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("The selected update is no longer available. Check again.")?;
    if update.version != version {
        return Err(
            "The available version changed. Review the new update before installing.".into(),
        );
    }
    let mut downloaded = 0u64;
    let mut last_progress = std::time::Instant::now();
    update.download_and_install(|chunk, total| {
        downloaded = downloaded.saturating_add(chunk as u64);
        if last_progress.elapsed() >= std::time::Duration::from_millis(100) || total == Some(downloaded) {
            let _ = progress.send(UpdateProgress { phase: "downloading", downloaded, total });
            last_progress = std::time::Instant::now();
        }
    }, || {
        let _ = progress.send(UpdateProgress { phase: "installing", downloaded: 0, total: None });
    }).await.map_err(|_| "Update could not be completed. Reopen Jackalope and check the installed version before retrying.".to_string())?;
    app.restart();
}

#[tauri::command]
pub fn app_diagnostics(runtime: State<'_, TaskRuntime>) -> Result<serde_json::Value, String> {
    Ok(diagnostics(&runtime.integration_runs()?))
}

fn diagnostics(runs: &[super::tasks::TaskRun]) -> serde_json::Value {
    let count = |states: &[&str]| {
        runs.iter()
            .filter(|r| states.contains(&r.status.as_str()))
            .count()
    };
    let checks = runs.iter().filter(|r| r.verification.is_some()).count();
    serde_json::json!({
        "schemaVersion": 1, "appVersion": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS, "architecture": std::env::consts::ARCH,
        "attempts": runs.len(), "active": count(&["starting", "running", "stopping"]),
        "readyToReview": count(&["review"]), "reviewed": count(&["reviewed"]),
        "failed": count(&["failed"]), "stopped": count(&["stopped"]), "interrupted": count(&["interrupted"]),
        "historySaveFailures": runs.iter().filter(|r| r.persistence_error.is_some()).count(),
        "checksRecorded": checks, "checksPassed": runs.iter().filter(|r| r.verification.as_ref().is_some_and(|v| v.result.success && v.tree.is_some())).count(),
        "coverage": "Local retained attempts only. Counts are not user satisfaction or accepted-change measurements."
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostics_contain_only_allowlisted_summary_fields() {
        let report = diagnostics(&[]);
        let keys: std::collections::HashSet<_> = report
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys.len(), 15);
        assert!(!report.to_string().contains("projectPath"));
        assert_eq!(report["attempts"], 0);
    }
}
