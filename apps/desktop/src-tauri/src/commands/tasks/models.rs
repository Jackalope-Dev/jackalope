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

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskRun {
    #[serde(default)]
    pub archived_at: Option<String>,
    #[serde(default)]
    pub live_session_id: Option<String>,
    #[serde(default)]
    pub effort: Option<super::effort::TaskEffort>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub efficiency: super::efficiency::Efficiency,
    #[serde(default)]
    pub dependency_invalidated: bool,
    #[serde(default)]
    pub stages: Vec<super::timing::ExecutionStage>,
    /// The step running right now. Cleared when the run reaches a terminal status.
    #[serde(default)]
    pub progress: Option<super::preparation::StepProgress>,
    /// Outcome of the project setup command for this attempt.
    #[serde(default)]
    pub preparation: Option<super::preparation::PreparationRecord>,
    /// The attempt this run retried, linking a retry back to what it replaced.
    #[serde(default)]
    pub retry_of: Option<String>,
    #[serde(default)]
    pub dependency_snapshot: crate::commands::integration::DependencySnapshot,
    #[serde(default)]
    pub checkpoint: Option<crate::commands::checkpoint::Checkpoint>,
    #[serde(default)]
    pub checkpoint_error: Option<String>,
    #[serde(default)]
    pub routing: Option<super::routing::RoutingHistory>,
    #[serde(default)]
    pub quota_failure: Option<super::routing::QuotaFailure>,
    #[serde(default)]
    pub contract: crate::commands::outcomes::TaskContract,
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
    pub live_session_id: Option<String>,
    #[serde(default)]
    pub effort: Option<super::effort::TaskEffort>,
    #[serde(skip)]
    pub dependency_snapshot: crate::commands::integration::DependencySnapshot,
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
    /// The failed attempt this run replaces. Unlike `previous_run_id` it resumes no agent
    /// session: it is a fresh attempt that may reuse the earlier attempt's prepared workspace.
    #[serde(default)]
    pub retry_of: Option<String>,
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

/// Lightweight summary of a run that retention moved out of the loaded history
/// into the `archive/` folder. Enough to recognise and restore it; the full
/// record stays on disk until restored.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedRun {
    pub id: String,
    pub task_id: String,
    pub project_name: String,
    pub agent: String,
    pub prompt: String,
    pub status: String,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Runner {
    pub desktop_installed: bool,
    pub id: String,
    pub name: String,
    pub available: bool,
    pub signed_in: bool,
    pub account: String,
    pub detail: String,
}

impl TaskRun {
    pub(in crate::commands) fn summary(&self) -> Self {
        let mut context_receipt = self.context_receipt.clone();
        for entry in &mut context_receipt.entries {
            entry.content.clear();
            if let Some(source) = &mut entry.automatic {
                source.evidence.clear();
            }
        }
        let verification = self.verification.as_ref().map(|check| {
            let mut check = check.clone();
            check.result.stdout.clear();
            check.result.stderr.clear();
            check
        });
        Self {
            archived_at: self.archived_at.clone(),
            live_session_id: self.live_session_id.clone(),
            effort: self.effort,
            reasoning_effort: self.reasoning_effort.clone(),
            efficiency: self.efficiency.clone(),
            dependency_invalidated: self.dependency_invalidated,
            stages: self.stages.clone(),
            progress: self.progress.clone(),
            preparation: self.preparation.clone(),
            retry_of: self.retry_of.clone(),
            dependency_snapshot: self.dependency_snapshot.clone(),
            checkpoint: self.checkpoint.clone(),
            checkpoint_error: self.checkpoint_error.clone(),
            routing: self.routing.clone(),
            quota_failure: self.quota_failure.clone(),
            contract: self.contract.clone(),
            monitor_change: self.monitor_change.clone(),
            context_receipt: context_receipt,
            id: self.id.clone(),
            task_id: self.task_id.clone(),
            project_id: self.project_id.clone(),
            project_name: self.project_name.clone(),
            project_path: self.project_path.clone(),
            workspace: self.workspace.clone(),
            branch: self.branch.clone(),
            base_head: self.base_head.clone(),
            agent: self.agent.clone(),
            account: self.account.clone(),
            connection_ids: self.connection_ids.clone(),
            account_binding: self.account_binding.clone(),
            target_branch: self.target_branch.clone(),
            process_contained: self.process_contained.clone(),
            verify_command: self.verify_command.clone(),
            prepare_command: self.prepare_command.clone(),
            auto_verify: self.auto_verify.clone(),
            verification: verification,
            finishing: self.finishing.clone(),
            verification_error: self.verification_error.clone(),
            model: self.model.clone(),
            prompt: self.prompt.chars().take(500).collect(),
            status: self.status.clone(),
            started_at: self.started_at.clone(),
            ended_at: self.ended_at.clone(),
            session_id: self.session_id.clone(),
            result: Default::default(),
            details_omitted: true,
            activity: Default::default(),
            diagnostics: Default::default(),
            error: self.error.clone(),
            persistence_error: self.persistence_error.clone(),
            exit_code: self.exit_code.clone(),
            usage: self.usage.clone(),
            mcp_usage: self.mcp_usage.clone(),
            usage_observations: self.usage_observations.clone(),
            prompts: self.prompts.clone(),
            validation_steps: self.validation_steps.clone(),
            screenshots: self.screenshots.clone(),
        }
    }
}
