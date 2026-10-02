//! Read-only view of what an attempt's agent can see: its task browser and any
//! user-granted desktop window. Viewing never starts a browser, changes a grant
//! or records an artifact; revoking reuses the existing ownership paths.

use super::{browser, desktop_control, tasks::TaskRuntime};
use base64::Engine as _;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserView {
    /// live, busy, stopped or unavailable.
    pub status: &'static str,
    pub url: Option<String>,
    /// Base64 PNG of the visible viewport, when one was captured.
    pub frame: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentScreen {
    pub browser: BrowserView,
    pub desktop: Option<desktop_control::DesktopView>,
    pub captured_at: String,
}

fn ensure_run(state: &TaskRuntime, run_id: &str) -> Result<(), String> {
    if state.has_run(run_id)? {
        Ok(())
    } else {
        Err("Task attempt not found".into())
    }
}

#[tauri::command]
pub async fn task_agent_screen(
    run_id: String,
    capture: Option<bool>,
    state: State<'_, TaskRuntime>,
) -> Result<AgentScreen, String> {
    ensure_run(&state, &run_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let browser = if capture.unwrap_or(true) {
            match browser::peek(&run_id) {
                Ok(browser::Peek::Frame { url, png }) => BrowserView {
                    status: "live",
                    url: Some(url),
                    frame: Some(base64::engine::general_purpose::STANDARD.encode(png)),
                    error: None,
                },
                Ok(browser::Peek::Busy) => view("busy"),
                Ok(browser::Peek::Stopped) => view("stopped"),
                Ok(browser::Peek::Unavailable) => view("unavailable"),
                Err(error) => BrowserView {
                    error: Some(error),
                    ..view("busy")
                },
            }
        } else {
            view("unavailable")
        };
        AgentScreen {
            browser,
            desktop: desktop_control::view(&run_id),
            captured_at: chrono::Utc::now().to_rfc3339(),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

fn view(status: &'static str) -> BrowserView {
    BrowserView {
        status,
        url: None,
        frame: None,
        error: None,
    }
}

/// Revokes the agent's browser or desktop access for this attempt. The agent
/// receives the existing revoked-access errors; a continuation can ask again.
#[tauri::command]
pub async fn task_agent_screen_revoke(
    run_id: String,
    target: String,
    state: State<'_, TaskRuntime>,
) -> Result<(), String> {
    ensure_run(&state, &run_id)?;
    let note = match target.as_str() {
        "browser" => {
            browser::close(&run_id);
            "You stopped this attempt's browser. The agent cannot reopen it until the task continues."
        }
        "desktop" => {
            desktop_control::close(&run_id);
            "You revoked desktop control for this attempt. The agent must ask again to use a window."
        }
        _ => return Err("Choose browser or desktop access to revoke.".into()),
    };
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // A finished attempt keeps its history unchanged; revocation still applied above.
        let _ = runtime.update_checked(&run_id, |run| {
            if ["starting", "running"].contains(&run.status.as_str()) {
                run.activity.push(note.into());
            }
        });
    })
    .await
    .map_err(|e| e.to_string())
}
