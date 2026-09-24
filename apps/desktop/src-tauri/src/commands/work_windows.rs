use super::tasks::TaskRuntime;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::ShellExt;

#[tauri::command]
pub async fn task_open_editor(
    app: AppHandle,
    state: State<'_, TaskRuntime>,
    id: String,
    editor: String,
) -> Result<(), String> {
    if !["vscode", "cursor"].contains(&editor.as_str()) {
        return Err("Choose VS Code or Cursor.".into());
    }
    let run = state
        .integration_runs()?
        .into_iter()
        .find(|run| run.id == id)
        .ok_or("Task not found")?;
    let workspace = dunce::canonicalize(run.workspace).map_err(|e| e.to_string())?;
    let mut url = reqwest::Url::parse(&format!("{editor}://file/")).map_err(|e| e.to_string())?;
    url.set_path(&workspace.to_string_lossy().replace('\\', "/"));
    #[allow(deprecated)]
    app.shell()
        .open(url.as_str(), None)
        .map_err(|e| format!("Could not open the editor. Check that it is installed: {e}"))
}

#[tauri::command]
pub async fn task_work_window(
    app: AppHandle,
    state: State<'_, TaskRuntime>,
    id: String,
    pane: String,
    action: String,
) -> Result<(), String> {
    uuid::Uuid::parse_str(&id).map_err(|_| "Invalid task identifier")?;
    if !["result", "changes", "preview", "terminal"].contains(&pane.as_str()) {
        return Err("Unknown task view".into());
    }
    let label = format!("work-pane-{id}-{pane}");
    match action.as_str() {
        "open" => {
            let run = state
                .integration_runs()?
                .into_iter()
                .find(|run| run.id == id)
                .ok_or("Task not found")?;
            if let Some(window) = app.get_webview_window(&label) {
                window.show().map_err(|e| e.to_string())?;
                window.set_focus().map_err(|e| e.to_string())?;
            } else {
                let mut builder = WebviewWindowBuilder::new(
                    &app,
                    &label,
                    WebviewUrl::App(format!("index.html?workPane={id}&pane={pane}").into()),
                )
                .title(format!("{} · {pane} · Jackalope", run.project_name))
                .inner_size(960.0, 720.0)
                .min_inner_size(480.0, 360.0);
                if let Some(profile) = std::env::var_os("JACKALOPE_PROFILE_DIR") {
                    builder =
                        builder.data_directory(std::path::PathBuf::from(profile).join("webview"));
                }
                builder.build().map_err(|e| e.to_string())?;
            }
        }
        "dock" => {
            let main = app
                .get_webview_window("main")
                .ok_or("Main window unavailable")?;
            main.show().map_err(|e| e.to_string())?;
            main.set_focus().map_err(|e| e.to_string())?;
            if let Some(run) = state
                .integration_runs()?
                .into_iter()
                .find(|run| run.id == id)
            {
                main.emit(
                    "work-pane-open",
                    serde_json::json!({ "id": id, "pane": pane, "sessionId": run.live_session_id }),
                )
                .map_err(|e| e.to_string())?;
            }
        }
        _ => return Err("Unknown window action".into()),
    }
    Ok(())
}
