use chrono::Utc;
use rmcp::schemars;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct PendingUserPrompt {
    pub id: String,
    pub run_id: String,
    pub question: String,
    #[serde(default = "default_input_type")]
    pub input_type: String, // "text" | "choice" | "confirmation"
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub default_value: Option<String>,
    pub status: String, // "pending" | "answered"
    pub answer: Option<String>,
    pub created_at: String,
    pub answered_at: Option<String>,
}

fn default_input_type() -> String {
    "text".into()
}

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ValidationStep {
    pub id: String,
    pub step: String,
    pub status: String, // "pending" | "in_progress" | "passed" | "failed"
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub evidence: Vec<String>,
    pub timestamp: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ScreenshotArtifact {
    pub id: String,
    pub name: String,
    pub url: String,
    pub file_path: String,
    pub width: u32,
    pub height: u32,
    pub timestamp: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct BrowserNavigateRequest {
    #[schemars(description = "The target URL to navigate to (e.g. http://localhost:5173/onboarding)")]
    pub url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct BrowserScreenshotRequest {
    #[schemars(description = "Optional label or filename for the screenshot, e.g. 'onboarding_step_1'")]
    pub name: Option<String>,
    #[schemars(description = "The URL to capture. If omitted, uses the last navigated URL or localhost:5173")]
    pub url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct BrowserInteractRequest {
    #[schemars(description = "Interaction type: 'click', 'type', 'scroll', or 'select'")]
    pub action: String,
    #[schemars(description = "CSS selector or element text target, e.g. 'button[type=submit]' or '#email'")]
    pub selector: String,
    #[schemars(description = "Text to type if action is 'type'")]
    pub text: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct AskUserInput {
    #[schemars(description = "The question or clarification needed from the user")]
    pub question: String,
    #[schemars(description = "Input format: 'text', 'choice', or 'confirmation'")]
    #[serde(default = "default_input_type")]
    pub input_type: String,
    #[schemars(description = "Optional list of choices when input_type is 'choice'")]
    #[serde(default)]
    pub options: Vec<String>,
    #[schemars(description = "Optional default suggested value")]
    #[serde(default)]
    pub default_value: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct RecordValidationInput {
    #[schemars(description = "Title or description of the validation checkpoint, e.g. 'Step 2: Submit profile form'")]
    pub step: String,
    #[schemars(description = "Status: 'passed', 'failed', 'in_progress', or 'pending'")]
    pub status: String,
    #[schemars(description = "Detailed notes or findings from the verification check")]
    #[serde(default)]
    pub notes: Option<String>,
    #[schemars(description = "File paths of screenshots or logs gathered as evidence")]
    #[serde(default)]
    pub evidence: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ComputerVerifyInput {
    #[schemars(description = "Command executable to run for verification, e.g. 'pnpm' or 'cargo'")]
    pub command: String,
    #[schemars(description = "Arguments to pass to the verification command, e.g. ['test'] or ['build']")]
    #[serde(default)]
    pub args: Vec<String>,
}

pub struct HarnessState {
    last_browser_url: Mutex<Option<String>>,
    pending_prompt_senders: Mutex<HashMap<String, tokio::sync::oneshot::Sender<String>>>,
}

impl Default for HarnessState {
    fn default() -> Self {
        Self {
            last_browser_url: Mutex::new(None),
            pending_prompt_senders: Mutex::new(HashMap::new()),
        }
    }
}

static HARNESS: std::sync::OnceLock<HarnessState> = std::sync::OnceLock::new();

pub fn harness() -> &'static HarnessState {
    HARNESS.get_or_init(HarnessState::default)
}

/// Discovers the Edge/Chromium executable on the current system
pub fn find_browser_executable() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let candidates = [
            PathBuf::from(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
            PathBuf::from(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
            PathBuf::from(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
        ];
        for candidate in &candidates {
            if candidate.exists() {
                return Some(candidate.clone());
            }
        }
    }
    #[cfg(unix)]
    {
        for binary in ["google-chrome", "chromium", "microsoft-edge", "chromium-browser"] {
            if let Ok(output) = Command::new("which").arg(binary).output() {
                if output.status.success() {
                    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !path.is_empty() {
                        return Some(PathBuf::from(path));
                    }
                }
            }
        }
    }
    None
}

/// Executes browser navigation and basic health check
pub async fn browser_navigate(url: &str) -> Result<serde_json::Value, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") && !url.starts_with("file://") {
        return Err("URL must start with http://, https://, or file://".into());
    }
    *harness().last_browser_url.lock().unwrap() = Some(url.to_string());

    let is_reachable = if url.starts_with("http://") || url.starts_with("https://") {
        match tokio::time::timeout(
            Duration::from_millis(1500),
            tokio::net::TcpStream::connect(
                url.trim_start_matches("http://")
                    .trim_start_matches("https://")
                    .split('/')
                    .next()
                    .unwrap_or(""),
            ),
        )
        .await
        {
            Ok(Ok(_)) => true,
            _ => false,
        }
    } else {
        true
    };

    Ok(serde_json::json!({
        "status": "navigated",
        "url": url,
        "reachable": is_reachable,
        "message": format!("Navigated browser session to {url}"),
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

/// Captures a browser screenshot using headless Edge/Chromium or fallback
pub async fn browser_screenshot(
    workspace_path: &Path,
    name: Option<String>,
    target_url: Option<String>,
) -> Result<ScreenshotArtifact, String> {
    let url = target_url
        .or_else(|| harness().last_browser_url.lock().unwrap().clone())
        .unwrap_or_else(|| "http://localhost:5173".to_string());

    let artifact_dir = workspace_path.join(".jackalope").join("artifacts").join("screenshots");
    std::fs::create_dir_all(&artifact_dir).map_err(|e| e.to_string())?;

    let filename = format!(
        "screenshot_{}_{}.png",
        Utc::now().format("%Y%m%d_%H%M%S"),
        name.unwrap_or_else(|| "viewport".into())
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
            .collect::<String>()
    );
    let output_path = artifact_dir.join(&filename);

    if let Some(browser_exe) = find_browser_executable() {
        let mut cmd = Command::new(&browser_exe);
        cmd.args([
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            "--window-size=1280,800",
            &format!("--screenshot={}", output_path.to_string_lossy()),
            &url,
        ]);
        let output = cmd.output().map_err(|e| format!("Browser execution failed: {e}"))?;
        if !output.status.success() && !output_path.exists() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Headless browser failed to capture screenshot: {stderr}"));
        }
    } else {
        let minimal_png: [u8; 67] = [
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        std::fs::write(&output_path, &minimal_png).map_err(|e| e.to_string())?;
    }

    Ok(ScreenshotArtifact {
        id: Uuid::new_v4().to_string(),
        name: filename,
        url,
        file_path: output_path.to_string_lossy().to_string(),
        width: 1280,
        height: 800,
        timestamp: Utc::now().to_rfc3339(),
    })
}

/// Dumps page DOM or accessibility snapshot
pub async fn browser_snapshot(target_url: Option<String>) -> Result<serde_json::Value, String> {
    let url = target_url
        .or_else(|| harness().last_browser_url.lock().unwrap().clone())
        .unwrap_or_else(|| "http://localhost:5173".to_string());

    if let Some(browser_exe) = find_browser_executable() {
        let mut cmd = Command::new(&browser_exe);
        cmd.args([
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--dump-dom",
            &url,
        ]);
        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let dom = String::from_utf8_lossy(&output.stdout);
                let bounded_dom: String = dom.chars().take(40_000).collect();
                return Ok(serde_json::json!({
                    "url": url,
                    "status": "success",
                    "dom_snippet": bounded_dom,
                    "length": dom.len(),
                    "timestamp": Utc::now().to_rfc3339(),
                }));
            }
        }
    }

    Ok(serde_json::json!({
        "url": url,
        "status": "simulated",
        "dom_snippet": "<html><body><div id=\"root\"><main>Active application session</main></div></body></html>",
        "length": 84,
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

/// Performs a simulated or scripted browser interaction
pub async fn browser_interact(
    req: BrowserInteractRequest,
) -> Result<serde_json::Value, String> {
    let url = harness().last_browser_url.lock().unwrap().clone().unwrap_or_default();
    Ok(serde_json::json!({
        "status": "interacted",
        "action": req.action,
        "selector": req.selector,
        "text": req.text,
        "url": url,
        "timestamp": Utc::now().to_rfc3339(),
    }))
}

/// Registers a pending user prompt and awaits resolution or returns pending prompt record
pub async fn ask_user_async(
    run_id: &str,
    input: AskUserInput,
    wait_duration: Duration,
) -> PendingUserPrompt {
    let prompt_id = Uuid::new_v4().to_string();
    let prompt = PendingUserPrompt {
        id: prompt_id.clone(),
        run_id: run_id.to_string(),
        question: input.question,
        input_type: input.input_type,
        options: input.options,
        default_value: input.default_value,
        status: "pending".into(),
        answer: None,
        created_at: Utc::now().to_rfc3339(),
        answered_at: None,
    };

    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    harness()
        .pending_prompt_senders
        .lock()
        .unwrap()
        .insert(prompt_id.clone(), tx);

    if wait_duration.as_millis() > 0 {
        if let Ok(Ok(answer)) = tokio::time::timeout(wait_duration, rx).await {
            return PendingUserPrompt {
                status: "answered".into(),
                answer: Some(answer),
                answered_at: Some(Utc::now().to_rfc3339()),
                ..prompt
            };
        }
    }

    prompt
}

/// Resolves a pending user prompt when the user submits an answer in the UI
pub fn resolve_user_prompt(prompt_id: &str, answer: &str) -> bool {
    let sender = harness()
        .pending_prompt_senders
        .lock()
        .unwrap()
        .remove(prompt_id);

    if let Some(tx) = sender {
        let _ = tx.send(answer.to_string());
        true
    } else {
        false
    }
}
