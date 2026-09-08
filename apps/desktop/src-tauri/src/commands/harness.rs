use chrono::Utc;
use rmcp::schemars;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
#[cfg(unix)]
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingUserPrompt {
    pub id: String,
    #[serde(alias = "run_id")]
    pub run_id: String,
    pub question: String,
    #[serde(default = "default_input_type")]
    #[serde(alias = "input_type")]
    pub input_type: String, // "text" | "choice" | "confirmation"
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    #[serde(alias = "default_value")]
    pub default_value: Option<String>,
    pub status: String, // "pending" | "answered"
    pub answer: Option<String>,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "answered_at")]
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
#[serde(rename_all = "camelCase")]
pub struct ScreenshotArtifact {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(alias = "file_path")]
    pub file_path: String,
    pub width: u32,
    pub height: u32,
    pub timestamp: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct BrowserNavigateRequest {
    #[schemars(
        description = "The target URL to navigate to (e.g. http://localhost:5173/onboarding)"
    )]
    pub url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct BrowserScreenshotRequest {
    #[schemars(
        description = "Optional label or filename for the screenshot, e.g. 'onboarding_step_1'"
    )]
    pub name: Option<String>,
    #[schemars(
        description = "The URL to capture. If omitted, uses the last selected URL; an explicit URL is required when none is selected"
    )]
    pub url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct BrowserInteractRequest {
    #[schemars(
        description = "click, dblclick, type (append), fill (replace), scroll (into view), select, hover, focus, check, uncheck, press or wait"
    )]
    pub action: String,
    #[schemars(
        description = "CSS selector or @e reference from the latest snapshot. For press, optional element to focus; for wait, use a CSS selector or text."
    )]
    #[serde(default)]
    pub selector: String,
    #[schemars(
        description = "Text to type/fill/wait for, option value, or key chord (Tab, Enter, Control+a). Never enter secrets into tool arguments."
    )]
    pub text: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct BrowserSnapshotRequest {
    pub url: Option<String>,
    #[serde(default = "accessibility_mode")]
    #[schemars(
        description = "accessibility (default, readable page with @e references) or html (bounded rendered source)"
    )]
    pub mode: String,
    #[schemars(description = "Optional CSS selector to scope a large snapshot")]
    pub selector: Option<String>,
    #[serde(default)]
    #[schemars(
        description = "Only interactive controls; omit when checking page content or result messages"
    )]
    pub interactive: bool,
}

fn accessibility_mode() -> String {
    "accessibility".into()
}

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct BrowserConfigureRequest {
    pub width: Option<u32>,
    pub height: Option<u32>,
    #[serde(alias = "colorScheme")]
    pub color_scheme: Option<String>,
    #[serde(alias = "reducedMotion")]
    pub reduced_motion: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct BrowserInspectRequest {
    #[schemars(description = "text, value, visible, enabled, checked, console or errors")]
    pub kind: String,
    pub selector: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct BrowserTabsRequest {
    #[schemars(
        description = "list, new, switch or close; new needs url; switch/close need a tab ID from list"
    )]
    pub action: String,
    pub url: Option<String>,
    pub tab: Option<String>,
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
    #[schemars(
        description = "Title or description of the validation checkpoint, e.g. 'Step 2: Submit profile form'"
    )]
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
    #[schemars(
        description = "Arguments to pass to the verification command, e.g. ['test'] or ['build']"
    )]
    #[serde(default)]
    pub args: Vec<String>,
}

pub struct HarnessState {
    pending_prompt_senders: Mutex<HashMap<String, tokio::sync::oneshot::Sender<String>>>,
}

impl Default for HarnessState {
    fn default() -> Self {
        Self {
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
        for binary in [
            "google-chrome",
            "chromium",
            "microsoft-edge",
            "chromium-browser",
        ] {
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

pub(super) fn png_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return Err("Browser did not produce a PNG screenshot".into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if width == 0 || height == 0 {
        return Err("Browser produced an empty screenshot".into());
    }
    Ok((width, height))
}

/// Registers a pending user prompt and awaits resolution or returns pending prompt record
pub async fn ask_user_async(
    run_id: &str,
    input: AskUserInput,
    wait_duration: Duration,
    registered: impl FnOnce(&PendingUserPrompt),
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
    registered(&prompt);

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

    // Timed out (or wait_duration was zero) without an answer: `rx` was
    // just dropped, so nothing is listening on `tx` anymore. Leaving the
    // sender registered only leaks memory for any prompt nobody answers in
    // time, and makes a later resolve_user_prompt call for this ID return
    // `true` (a stale entry found and removed) even though the send it
    // performs silently fails - a false "delivered" signal. The real
    // answer, whenever it arrives, is still recorded correctly via the
    // persisted TaskRun.prompts entry (task_respond_prompt), independent
    // of this channel, so removing it here changes no observable behavior
    // besides making that later return value honest.
    harness()
        .pending_prompt_senders
        .lock()
        .unwrap()
        .remove(&prompt_id);
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
        tx.send(answer.to_string()).is_ok()
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_prompt_and_screenshot_records_serialize_for_the_ui() {
        let prompt: PendingUserPrompt = serde_json::from_value(serde_json::json!({
            "id": "question", "run_id": "attempt", "question": "Choose", "input_type": "choice", "options": ["A", "B"],
            "default_value": "A", "status": "pending", "answer": null, "created_at": "now", "answered_at": null
        })).unwrap();
        let value = serde_json::to_value(prompt).unwrap();
        assert_eq!(value["inputType"], "choice");
        assert_eq!(value["createdAt"], "now");
        let screenshot: ScreenshotArtifact = serde_json::from_value(serde_json::json!({
            "id": "image", "name": "Check", "url": "http://localhost", "file_path": "evidence.png", "width": 960, "height": 640, "timestamp": "now"
        })).unwrap();
        assert_eq!(
            serde_json::to_value(screenshot).unwrap()["filePath"],
            "evidence.png"
        );
    }

    #[test]
    fn browser_urls_reject_executable_schemes() {
        assert!(super::super::browser::validate_url("javascript:alert(1)").is_err());
        assert!(super::super::browser::validate_url("http://localhost:5173").is_ok());
    }

    // Both scenarios share one test function rather than running as separate
    // #[tokio::test]s: `harness()` is a process-wide global static, and Rust
    // runs tests in parallel by default, so two tests independently reading
    // `pending_prompt_senders` (a shared map with no per-test isolation)
    // could race and pick up each other's entries. Sequential steps in one
    // test sidestep that entirely.
    #[tokio::test]
    async fn pending_prompt_lifecycle_is_cleaned_up_on_timeout_and_delivered_on_answer() {
        let question = || AskUserInput {
            question: "Continue?".into(),
            input_type: default_input_type(),
            options: vec![],
            default_value: None,
        };

        // Times out with no answer: cleaned up, so a later resolve for the
        // same ID is honest (finds nothing, doesn't falsely report success).
        let timed_out =
            ask_user_async("run-a", question(), Duration::from_millis(20), |_| {}).await;
        assert_eq!(timed_out.status, "pending");
        assert!(!resolve_user_prompt(&timed_out.id, "too late"));

        // Answered within the wait window: delivered through the channel.
        let (registered, observed) = tokio::sync::oneshot::channel();
        let wait = tokio::spawn(ask_user_async(
            "run-b",
            question(),
            Duration::from_secs(5),
            move |prompt| {
                let _ = registered.send(prompt.clone());
            },
        ));
        let visible = observed.await.unwrap();
        assert_eq!(visible.status, "pending");
        assert!(resolve_user_prompt(&visible.id, "yes"));
        let answered = wait.await.unwrap();
        assert_eq!(answered.status, "answered");
        assert_eq!(answered.answer.as_deref(), Some("yes"));
    }

    #[test]
    fn screenshot_dimensions_come_from_file() {
        assert!(png_dimensions(b"not an image").is_err());
        let mut header = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        header.extend_from_slice(&960_u32.to_be_bytes());
        header.extend_from_slice(&640_u32.to_be_bytes());
        assert_eq!(png_dimensions(&header).unwrap(), (960, 640));
        header[16..20].fill(0);
        assert!(png_dimensions(&header).is_err());
    }
}
