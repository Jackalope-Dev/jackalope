use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub reported: bool,
    pub estimated_cost_usd: Option<f64>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UsageObservation {
    pub message_id: String,
    pub parent_tool_use_id: Option<String>,
    pub model: Option<String>,
    pub input: u64,
    pub output: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TaskRun {
    #[serde(default)]
    pub monitor_change: Option<crate::commands::monitors::MonitorChange>,
    #[serde(default)]
    pub context_receipt: crate::commands::knowledge::ContextReceipt,
    pub id: String,
    pub task_id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_path: String,
    pub workspace: String,
    pub branch: String,
    pub base_head: String,
    pub agent: String,
    pub account: String,
    #[serde(default)]
    pub connection_ids: Option<Vec<String>>,
    #[serde(default)]
    pub account_binding: Option<crate::commands::agent_profiles::AccountBinding>,
    #[serde(default)]
    pub target_branch: Option<String>,
    #[serde(default)]
    pub process_contained: bool,
    #[serde(default)]
    pub verify_command: Option<String>,
    #[serde(default)]
    pub prepare_command: Option<String>,
    #[serde(default)]
    pub auto_verify: bool,
    #[serde(default)]
    pub verification: Option<crate::commands::verification::Verification>,
    #[serde(default)]
    pub finishing: bool,
    #[serde(default)]
    pub verification_error: Option<String>,
    pub model: Option<String>,
    pub prompt: String,
    pub status: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub session_id: Option<String>,
    pub result: String,
    #[serde(default)]
    pub details_omitted: bool,
    pub activity: Vec<String>,
    #[serde(default)]
    pub diagnostics: Vec<String>,
    pub error: Option<String>,
    pub persistence_error: Option<String>,
    pub exit_code: Option<i32>,
    pub usage: Usage,
    #[serde(default)]
    pub mcp_usage: Option<crate::commands::mcp_broker::BrokerUsage>,
    #[serde(default)]
    pub usage_observations: Vec<UsageObservation>,
    #[serde(default)]
    pub prompts: Vec<crate::commands::harness::PendingUserPrompt>,
    #[serde(default)]
    pub validation_steps: Vec<crate::commands::harness::ValidationStep>,
    #[serde(default)]
    pub screenshots: Vec<crate::commands::harness::ScreenshotArtifact>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    #[serde(skip)]
    pub monitor_change: Option<crate::commands::monitors::MonitorChange>,
    #[serde(default)]
    pub context_selection: crate::commands::knowledge::ContextSelection,
    #[serde(skip)]
    pub context_receipt: crate::commands::knowledge::ContextReceipt,
    pub model: Option<String>,
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_path: String,
    pub agent: String,
    /// Explicit account to run this agent as, overriding whichever profile is
    /// globally active. None means "use the agent's globally active account,"
    /// today's (and every existing caller's) unchanged behavior.
    #[serde(default)]
    pub agent_profile_id: Option<String>,
    #[serde(default)]
    pub verify_command: Option<String>,
    #[serde(default)]
    pub prepare_command: Option<String>,
    #[serde(default)]
    pub auto_verify: bool,
    #[serde(default)]
    pub target_branch: Option<String>,
    #[serde(skip)]
    pub account_binding: Option<crate::commands::agent_profiles::AccountBinding>,
    pub prompt: String,
    pub isolated: bool,
    pub previous_run_id: Option<String>,
    #[serde(default)]
    pub connection_ids: Option<Vec<String>>,
    #[serde(skip)]
    pub coordination: Option<CoordinationContext>,
}

#[derive(Clone)]
pub struct CoordinationContext {
    pub endpoint: String,
    pub token: String,
    pub instructions: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Runner {
    pub id: String,
    pub name: String,
    pub available: bool,
    pub signed_in: bool,
    pub account: String,
    pub detail: String,
}
