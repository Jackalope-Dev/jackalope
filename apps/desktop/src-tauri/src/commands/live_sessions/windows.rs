use super::*;
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[tauri::command]
pub async fn live_session_window(
    app: AppHandle,
    service: State<'_, LiveSessions>,
    id: String,
    action: String,
) -> Result<(), String> {
    Uuid::parse_str(&id).map_err(|_| "Invalid session identifier")?;
    let session = service
        .inner
        .lock()
        .map_err(|e| e.to_string())?
        .ledger
        .sessions
        .iter()
        .find(|s| s.id == id)
        .cloned()
        .ok_or("Session not found")?;
    let label = format!("live-session-{id}");
    match action.as_str() {
        "open" => {
            if let Some(window) = app.get_webview_window(&label) {
                window.show().map_err(|e| e.to_string())?;
                window.set_focus().map_err(|e| e.to_string())?;
            } else {
                let mut builder = WebviewWindowBuilder::new(
                    &app,
                    &label,
                    WebviewUrl::App(format!("index.html?liveSession={id}").into()),
                )
                .title(format!("{} · Jackalope", session.title))
                .inner_size(440.0, 620.0)
                .min_inner_size(320.0, 320.0)
                .decorations(false)
                .always_on_top(session.pinned);
                if let Some(profile) = std::env::var_os("JACKALOPE_PROFILE_DIR") {
                    builder = builder.data_directory(PathBuf::from(profile).join("webview"));
                }
                builder.build().map_err(|e| e.to_string())?;
            }
        }
        "dock" => {
            let main = app
                .get_webview_window("main")
                .ok_or("The main window is unavailable")?;
            main.show().map_err(|e| e.to_string())?;
            main.set_focus().map_err(|e| e.to_string())?;
            main.emit("live-session-open", &id)
                .map_err(|e| e.to_string())?;
            if let Some(window) = app.get_webview_window(&label) {
                window.close().map_err(|e| e.to_string())?;
            }
        }
        _ => return Err("Unknown window action".into()),
    }
    Ok(())
}

#[tauri::command]
pub async fn live_session_window_pin(
    window: WebviewWindow,
    service: State<'_, LiveSessions>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    if window.label() != format!("live-session-{id}") {
        return Err("Pinning is available in the session window.".into());
    }
    let previous = window.is_always_on_top().map_err(|e| e.to_string())?;
    window
        .set_always_on_top(pinned)
        .map_err(|e| e.to_string())?;
    if let Err(error) = service.update(|ledger| {
        LiveSessions::session(ledger, &id)?.pinned = pinned;
        Ok(())
    }) {
        let _ = window.set_always_on_top(previous);
        return Err(error);
    }
    let _ = window.app_handle().emit("live-sessions-changed", ());
    Ok(())
}
