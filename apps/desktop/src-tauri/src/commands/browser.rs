use super::harness::{BrowserInteractRequest, ScreenshotArtifact};
use headless_chrome::{
    protocol::cdp::Page::CaptureScreenshotFormatOption, Browser, LaunchOptions, Tab,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

struct Session {
    _browser: Browser,
    tab: Arc<Tab>,
}
static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<Mutex<Option<Session>>>>>> = OnceLock::new();
fn sessions() -> &'static Mutex<HashMap<String, Arc<Mutex<Option<Session>>>>> {
    SESSIONS.get_or_init(Mutex::default)
}

pub fn close(run_id: &str) {
    sessions().lock().unwrap().remove(run_id);
}
pub fn close_all() {
    sessions().lock().unwrap().clear();
}

pub(super) fn validate_url(url: &str) -> Result<(), String> {
    if url.len() > 8000
        || !["http://", "https://", "file://"]
            .iter()
            .any(|prefix| url.starts_with(prefix))
    {
        return Err("Choose an http, https or file URL.".into());
    }
    Ok(())
}

async fn with_session<T: Send + 'static>(
    run_id: String,
    work: impl FnOnce(&Session) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let session = {
        let mut sessions = sessions().lock().map_err(|e| e.to_string())?;
        if !sessions.contains_key(&run_id) && sessions.len() >= 4 {
            return Err(
                "Four tasks already own browsers. Finish one before opening another.".into(),
            );
        }
        sessions.entry(run_id).or_default().clone()
    };
    tauri::async_runtime::spawn_blocking(move || {
        let mut value = session.lock().map_err(|e| e.to_string())?;
        if value.is_none() {
            let executable = super::harness::find_browser_executable()
                .ok_or("Install Edge or Chrome to use browser verification.")?;
            let options = LaunchOptions::default_builder()
                .path(Some(executable))
                .headless(true)
                .sandbox(true)
                .window_size(Some((1280, 800)))
                .idle_browser_timeout(Duration::from_secs(300))
                .build()
                .map_err(|e| e.to_string())?;
            let browser = Browser::new(options).map_err(|e| e.to_string())?;
            let tab = browser.new_tab().map_err(|e| e.to_string())?;
            tab.set_default_timeout(Duration::from_secs(15));
            *value = Some(Session {
                _browser: browser,
                tab,
            });
        }
        work(value.as_ref().unwrap())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn navigate(session: &Session, url: &str) -> Result<(), String> {
    validate_url(url)?;
    session
        .tab
        .navigate_to(url)
        .and_then(|tab| tab.wait_until_navigated())
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn browser_navigate(run_id: &str, url: &str) -> Result<Value, String> {
    validate_url(url)?;
    let url = url.to_string();
    with_session(run_id.to_string(), move |session| {
        navigate(session, &url)?;
        Ok(json!({ "status": "navigated", "url": session.tab.get_url() }))
    })
    .await
}

pub async fn browser_snapshot(run_id: &str, target_url: Option<String>) -> Result<Value, String> {
    with_session(run_id.to_string(), move |session| {
        if let Some(url) = target_url { navigate(session, &url)?; }
        validate_url(&session.tab.get_url())?;
        let result = session.tab.evaluate("JSON.stringify({dom:document.documentElement.outerHTML.slice(0,40000),length:document.documentElement.outerHTML.length})", false).map_err(|e| e.to_string())?;
        let text = result.value.and_then(|v| v.as_str().map(str::to_owned)).ok_or("Could not read the page")?;
        let document: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        Ok(json!({ "status": "success", "url": session.tab.get_url(), "dom_snippet": document["dom"], "length": document["length"] }))
    }).await
}

pub async fn browser_screenshot(
    run_id: &str,
    workspace: &Path,
    name: Option<String>,
    target_url: Option<String>,
) -> Result<ScreenshotArtifact, String> {
    let workspace: PathBuf = workspace.into();
    with_session(run_id.to_string(), move |session| {
        if let Some(url) = target_url {
            navigate(session, &url)?;
        }
        let url = session.tab.get_url();
        validate_url(&url)?;
        let bytes = session
            .tab
            .capture_screenshot(CaptureScreenshotFormatOption::Png, None, None, true)
            .map_err(|e| e.to_string())?;
        let (width, height) = super::harness::png_dimensions(&bytes)?;
        let directory = workspace.join(".jackalope/artifacts/screenshots");
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let path = directory.join(format!("{id}.png"));
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        Ok(ScreenshotArtifact {
            id,
            name: name
                .unwrap_or_else(|| "Browser capture".into())
                .chars()
                .take(160)
                .collect(),
            url,
            file_path: path.to_string_lossy().into_owned(),
            width,
            height,
            timestamp: chrono::Utc::now().to_rfc3339(),
        })
    })
    .await
}

pub async fn browser_interact(
    run_id: &str,
    request: BrowserInteractRequest,
) -> Result<Value, String> {
    if !["click", "type", "scroll", "select"].contains(&request.action.as_str())
        || request.selector.len() > 2000
        || request.text.as_ref().is_some_and(|s| s.len() > 24000)
    {
        return Err(
            "Use click, type, scroll or select with a bounded CSS selector and text.".into(),
        );
    }
    with_session(run_id.to_string(), move |session| {
        validate_url(&session.tab.get_url())?;
        let element = session.tab.wait_for_element(&request.selector).map_err(|e| e.to_string())?;
        match request.action.as_str() {
            "click" => { element.click().map_err(|e| e.to_string())?; }
            "type" => { element.type_into(request.text.as_deref().ok_or("Provide text to type")?).map_err(|e| e.to_string())?; }
            "scroll" => { element.call_js_fn("function(){this.scrollIntoView({block:'center'});return true}", vec![], false).map_err(|e| e.to_string())?; }
            "select" => {
                let result = element.call_js_fn("function(value){if(this.tagName!=='SELECT'||!Array.from(this.options).some(o=>o.value===value))return false;this.value=value;this.dispatchEvent(new Event('input',{bubbles:true}));this.dispatchEvent(new Event('change',{bubbles:true}));return this.value===value}", vec![json!(request.text.ok_or("Provide an option value")?)], false).map_err(|e| e.to_string())?;
                if result.value != Some(json!(true)) { return Err("Select target or option value was not found.".into()); }
            }
            _ => unreachable!(),
        }
        Ok(json!({"status":"performed", "action":request.action, "url":session.tab.get_url()}))
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Launches an installed browser against a disposable local fixture"]
    async fn real_browser_interactions_preserve_task_state() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-browser-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let page = directory.join("index.html");
        std::fs::write(&page, r#"<button id="go" onclick="this.textContent='Clicked'">Click</button><input id="text"><select id="choice"><option value="a">A</option><option value="b">B</option></select>"#).unwrap();
        let url = format!("file:///{}", page.to_string_lossy().replace('\\', "/"));
        let run = uuid::Uuid::new_v4().to_string();
        browser_navigate(&run, &url).await.unwrap();
        for (action, selector, text) in [
            ("click", "#go", None),
            ("type", "#text", Some("Hello")),
            ("select", "#choice", Some("b")),
            ("scroll", "#choice", None),
        ] {
            browser_interact(
                &run,
                BrowserInteractRequest {
                    action: action.into(),
                    selector: selector.into(),
                    text: text.map(str::to_string),
                },
            )
            .await
            .unwrap();
        }
        assert!(browser_snapshot(&run, None).await.unwrap()["dom_snippet"]
            .as_str()
            .unwrap()
            .contains("Clicked"));
        let second = uuid::Uuid::new_v4().to_string();
        browser_navigate(&second, &url).await.unwrap();
        assert!(
            !browser_snapshot(&second, None).await.unwrap()["dom_snippet"]
                .as_str()
                .unwrap()
                .contains(">Clicked<")
        );
        let artifact = browser_screenshot(&run, &directory, None, None)
            .await
            .unwrap();
        assert!(artifact.width > 0 && artifact.height > 0);
        close(&run);
        close(&second);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
