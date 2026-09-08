use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    #[serde(default)]
    pub feature: Option<String>,
    #[serde(default)]
    pub feature_id: Option<String>,
    #[serde(default)]
    pub context_selection: super::super::knowledge::ContextSelection,
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_path: String,
    #[serde(default)]
    pub target_branch: Option<String>,
    #[serde(default)]
    pub agent_profile_id: Option<String>,
    #[serde(default)]
    pub verify_command: Option<String>,
    #[serde(default)]
    pub prepare_command: Option<String>,
    #[serde(default)]
    pub auto_verify: bool,
    pub title: String,
    pub prompt: String,
    pub agent: String,
    pub scopes: Vec<String>,
    pub dependencies: Vec<String>,
    pub created_at: String,
    pub run_id: Option<String>,
    pub error: Option<String>,
    pub canceled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueRequest {
    #[serde(default)]
    pub feature: Option<String>,
    #[serde(default)]
    pub feature_id: Option<String>,
    #[serde(default)]
    pub context_selection: super::super::knowledge::ContextSelection,
    pub project_id: String,
    pub project_name: String,
    pub project_path: String,
    #[serde(default)]
    pub target_branch: Option<String>,
    #[serde(default)]
    pub agent_profile_id: Option<String>,
    #[serde(default)]
    pub verify_command: Option<String>,
    #[serde(default)]
    pub prepare_command: Option<String>,
    #[serde(default)]
    pub auto_verify: bool,
    pub title: String,
    pub prompt: String,
    pub agent: String,
    pub scopes: Vec<String>,
    pub dependencies: Vec<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanEntry {
    #[serde(default)]
    pub context_selection: super::super::knowledge::ContextSelection,
    pub(super) key: String,
    pub(super) title: String,
    pub(super) prompt: String,
    pub(super) agent: String,
    pub(super) scopes: Vec<String>,
    pub(super) depends_on: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRequest {
    #[serde(default)]
    pub feature: Option<String>,
    #[serde(default)]
    pub feature_id: Option<String>,
    pub(super) project_id: String,
    pub(super) project_name: String,
    pub(super) project_path: String,
    #[serde(default)]
    pub(super) target_branch: Option<String>,
    #[serde(default)]
    pub(super) agent_accounts: HashMap<String, String>,
    #[serde(default)]
    pub(super) verify_command: Option<String>,
    #[serde(default)]
    pub(super) prepare_command: Option<String>,
    #[serde(default)]
    pub(super) auto_verify: bool,
    pub(super) items: Vec<PlanEntry>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinationMessage {
    pub id: String,
    pub task_id: String,
    pub project_id: String,
    pub kind: String,
    pub text: String,
    pub created_at: String,
    #[serde(default)]
    pub recipient_task_id: Option<String>,
    #[serde(default)]
    pub acknowledged_by: Vec<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub(super) struct Ledger {
    pub(super) items: Vec<QueueItem>,
    pub(super) messages: Vec<CoordinationMessage>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueView {
    pub items: Vec<QueueItem>,
    pub messages: Vec<CoordinationMessage>,
    pub enabled_projects: Vec<String>,
    pub concurrency: usize,
    pub bridge_url: Option<String>,
    pub bridge_error: Option<String>,
    pub merged_run_ids: Vec<String>,
}
