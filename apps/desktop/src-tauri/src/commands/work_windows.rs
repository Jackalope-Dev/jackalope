use super::tasks::TaskRuntime;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::work_windows::task_work_window,
            commands::work_windows::task_open_editor,
            commands::work_windows::project_open_editor,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[tauri::command]
pub async fn task_open_editor(
    app: AppHandle,
    state: State<'_, TaskRuntime>,
    id: String,
    editor: String,
) -> Result<(), String> {
    let editor = editor_scheme(&editor)?;
    let run = state
        .integration_runs()?
        .into_iter()
        .find(|run| run.id == id)
        .ok_or("Task not found")?;
    open_folder(&app, editor, &run.workspace)
}

/// Opens a saved project's folder in the editor. The folder comes from the project
/// registry by id, never from a path the webview supplies.
#[tauri::command]
pub async fn project_open_editor(
    app: AppHandle,
    state: State<'_, TaskRuntime>,
    project_id: String,
    editor: String,
) -> Result<(), String> {
    let editor = editor_scheme(&editor)?;
    let project = super::project_registry::record(&state, &project_id)
        .ok_or("That project is not in Jackalope.")?;
    open_folder(&app, editor, &project.path)
}

fn editor_scheme(editor: &str) -> Result<&'static str, String> {
    match editor {
        "vscode" => Ok("vscode"),
        "cursor" => Ok("cursor"),
        _ => Err("Choose VS Code or Cursor.".into()),
    }
}

fn editor_url(scheme: &str, folder: &std::path::Path) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(&format!("{scheme}://file/")).map_err(|e| e.to_string())?;
    url.set_path(&folder.to_string_lossy().replace('\\', "/"));
    Ok(url)
}

fn open_folder(app: &AppHandle, scheme: &str, folder: &str) -> Result<(), String> {
    let folder = dunce::canonicalize(folder)
        .map_err(|e| format!("Could not find the folder {folder}: {e}"))?;
    if !folder.is_dir() {
        return Err(format!("{} is not a folder.", folder.display()));
    }
    app.opener()
        .open_url(editor_url(scheme, &folder)?.as_str(), None::<&str>)
        .map_err(|e| format!("Could not open the editor. Check that it is installed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_editors_open_and_folders_become_file_urls() {
        assert_eq!(editor_scheme("vscode").unwrap(), "vscode");
        assert_eq!(editor_scheme("cursor").unwrap(), "cursor");
        assert!(editor_scheme("javascript").is_err());
        assert!(editor_scheme("vscode://evil").is_err());
        let url = editor_url("vscode", std::path::Path::new("/Users/me/my project")).unwrap();
        assert_eq!(url.as_str(), "vscode://file/Users/me/my%20project");
    }
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
