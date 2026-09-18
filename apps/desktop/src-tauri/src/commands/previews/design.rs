use crate::commands::{browser, harness::ScreenshotArtifact, integration, tasks::TaskRuntime};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};
use tauri::State;

struct Session {
    browser: String,
    identity: String,
    directory: PathBuf,
    address: String,
    capture: Option<Capture>,
}
impl Drop for Session {
    fn drop(&mut self) {
        browser::close(&self.browser);
        if self.directory.parent() == Some(std::env::temp_dir().as_path())
            && self
                .directory
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("jackalope-design-"))
        {
            let _ = std::fs::remove_dir_all(&self.directory);
        }
    }
}
#[derive(Clone)]
struct Handle {
    browser: String,
    session: Arc<tokio::sync::Mutex<Session>>,
}
type Sessions = HashMap<String, Handle>;
static SESSIONS: OnceLock<Mutex<Sessions>> = OnceLock::new();
fn sessions() -> &'static Mutex<Sessions> {
    SESSIONS.get_or_init(Default::default)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    selection: Value,
    screenshot: ScreenshotArtifact,
    context_path: String,
}

pub(super) fn close(id: &str) {
    let handle = sessions().lock().unwrap().remove(id);
    if let Some(handle) = handle {
        browser::close(&handle.browser);
    }
}
fn close_if(id: &str, browser_id: &str) {
    let handle = {
        let mut sessions = sessions().lock().unwrap();
        if sessions
            .get(id)
            .is_some_and(|handle| handle.browser == browser_id)
        {
            sessions.remove(id)
        } else {
            None
        }
    };
    if let Some(handle) = handle {
        browser::close(&handle.browser);
    }
}
pub(super) fn close_all() {
    let handles = std::mem::take(&mut *sessions().lock().unwrap());
    for handle in handles.values() {
        browser::close(&handle.browser);
    }
}

fn preview(id: &str) -> Result<(u16, String), String> {
    let mut previews = super::sessions().lock().map_err(|e| e.to_string())?;
    let preview = previews.get_mut(id).ok_or("Start the preview first.")?;
    if !super::view(preview)?.running {
        return Err("The preview has stopped. Restart it to inspect the page.".into());
    }
    Ok((preview.view.port, preview.identity.clone()))
}

#[tauri::command]
pub async fn task_preview_design_open(
    id: String,
    path: String,
    theme: Option<Value>,
    state: State<'_, TaskRuntime>,
) -> Result<(), String> {
    state.access.ensure()?;
    if theme
        .as_ref()
        .is_some_and(|theme| theme.to_string().len() > 2000)
    {
        return Err("Preview theme is too large.".into());
    }
    if !path.starts_with('/')
        || path.starts_with("//")
        || path.len() > 2000
        || path.chars().any(|c| c == '\\' || c.is_control())
    {
        return Err("Choose a local preview page beginning with /.".into());
    }
    let runtime = state.inner().clone();
    let reserve_id = id.clone();
    let (port, identity, session) = tauri::async_runtime::spawn_blocking(move || {
        let _guard = integration::execution_guard()?;
        runtime.access.ensure()?;
        let id = reserve_id;
        let (port, identity) = preview(&id)?;
        let mut sessions = sessions().lock().map_err(|e| e.to_string())?;
        let session = if let Some(handle) = sessions.get(&id) {
            handle.session.clone()
        } else {
            let nonce = uuid::Uuid::new_v4();
            let browser = format!("design-{nonce}");
            let directory = std::env::temp_dir().join(format!("jackalope-design-{nonce}"));
            std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
            browser::register_preview(&browser);
            let session = Arc::new(tokio::sync::Mutex::new(Session {
                browser: browser.clone(),
                identity: identity.clone(),
                directory,
                address: String::new(),
                capture: None,
            }));
            sessions.insert(
                id.clone(),
                Handle {
                    browser,
                    session: session.clone(),
                },
            );
            session
        };
        Ok::<_, String>((port, identity, session))
    })
    .await
    .map_err(|error| error.to_string())??;
    let mut session = session.lock().await;
    if session.identity != identity {
        close_if(&id, &session.browser);
        return Err("Restart the preview before selecting another element.".into());
    }
    let address = format!("http://127.0.0.1:{port}{path}");
    if session.address != address {
        if let Err(error) = browser::browser_navigate(&session.browser, &address).await {
            close_if(&id, &session.browser);
            return Err(error);
        }
        session.address = address;
    }
    if let Err(error) = browser::preview_selection(&session.browser, port, theme).await {
        close_if(&id, &session.browser);
        return Err(error);
    }
    if !preview(&id).is_ok_and(|(_, current)| current == identity) {
        close_if(&id, &session.browser);
        return Err(
            "The preview stopped or changed. Start it again before selecting an element.".into(),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn task_preview_design_capture(
    id: String,
    state: State<'_, TaskRuntime>,
) -> Result<Option<Capture>, String> {
    let runtime = state.inner().clone();
    let session = sessions()
        .lock()
        .map_err(|e| e.to_string())?
        .get(&id)
        .map(|h| h.session.clone());
    let Some(session) = session else {
        return Ok(None);
    };
    let mut session = session.lock().await;
    let (port, identity) = match preview(&id) {
        Ok(preview) => preview,
        Err(error) => {
            close_if(&id, &session.browser);
            return Err(error);
        }
    };
    if session.identity != identity {
        close_if(&id, &session.browser);
        return Err("The preview changed. Open its current page again.".into());
    }
    let selection = match browser::preview_selection(&session.browser, port, None).await {
        Ok(selection) => selection,
        Err(error) => {
            close_if(&id, &session.browser);
            return Err(error);
        }
    };
    let Some(selection_id) = selection["id"].as_str() else {
        return Ok(session.capture.clone());
    };
    if session
        .capture
        .as_ref()
        .is_some_and(|capture| capture.selection["id"] == selection_id)
    {
        return Ok(session.capture.clone());
    }
    let screenshot =
        browser::preview_screenshot(&session.browser, &session.directory, selection_id).await?;
    let bytes = std::fs::read(&screenshot.file_path).map_err(|e| e.to_string())?;
    let expected_identity = identity.clone();
    let selected_context = selection.clone();
    let (screenshot, context_path) = tauri::async_runtime::spawn_blocking(move || {
        let _guard = integration::execution_guard()?;
        if preview(&id)?.1 != expected_identity {
            return Err("The preview changed during capture. Select the element again.".into());
        }
        let runs = runtime.integration_runs()?;
        let run = runs
            .iter()
            .find(|run| run.id == id)
            .ok_or("Task not found")?;
        let workspace = dunce::canonicalize(&run.workspace).map_err(|e| e.to_string())?;
        let directory = workspace.join(".jackalope/artifacts/screenshots");
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        if !dunce::canonicalize(&directory)
            .map_err(|e| e.to_string())?
            .starts_with(&workspace)
        {
            return Err("The artifact folder resolves outside this workspace.".into());
        }
        let destination = directory.join(format!("{}.png", screenshot.id));
        std::fs::write(&destination, bytes).map_err(|e| e.to_string())?;
        let context_path = directory.join(format!("{}.selection.json", screenshot.id));
        std::fs::write(
            &context_path,
            serde_json::to_vec_pretty(&selected_context).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let mut screenshot = screenshot;
        screenshot.file_path = destination.to_string_lossy().into_owned();
        runtime.update_checked(&id, |run| run.screenshots.push(screenshot.clone()))?;
        Ok::<_, String>((screenshot, context_path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())??;
    let capture = Capture {
        selection,
        screenshot,
        context_path,
    };
    session.capture = Some(capture.clone());
    Ok(Some(capture))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_preview_cleanup_preserves_a_reopened_browser() {
        let id = uuid::Uuid::new_v4().to_string();
        let browser = format!("design-{}", uuid::Uuid::new_v4());
        let directory =
            std::env::temp_dir().join(format!("jackalope-design-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let session = Arc::new(tokio::sync::Mutex::new(Session {
            browser: browser.clone(),
            identity: "current".into(),
            directory: directory.clone(),
            address: String::new(),
            capture: None,
        }));
        sessions().lock().unwrap().insert(
            id.clone(),
            Handle {
                browser: browser.clone(),
                session: session.clone(),
            },
        );
        close_if(&id, "closed-browser");
        assert_eq!(
            sessions().lock().unwrap().get(&id).unwrap().browser,
            browser
        );
        close_if(&id, &browser);
        assert!(!sessions().lock().unwrap().contains_key(&id));
        drop(session);
        assert!(!directory.exists());
    }
}
