use serde::{Deserialize, Serialize};

pub use crate::cli_protocol::{RunStatus, WorkspaceMode};

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub parent_tool_use_id: Option<String>,
    pub model: Option<String>,
    pub input: u64,
    pub output: u64,
}

/// Where an attempt's agent ran when a project computer ran it.
#[derive(Clone, Serialize, Deserialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteExecution {
    pub computer_id: String,
    pub computer_name: String,
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
    pub codex_speed: Option<super::speed::CodexSpeed>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub requested_service_tier: Option<String>,
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
    /// The agent's own restatement of the task, reported once at the start.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub understanding: Option<crate::commands::outcomes::GoalRestatement>,
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
    /// The computer the agent ran on, when it did not run on this device.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote: Option<RemoteExecution>,
    /// The execution host chosen for the attempt and why, from the capacity
    /// pool. Attempts saved before it existed have none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<crate::commands::computers::pool::RunHost>,
    #[serde(default)]
    pub verify_command: Option<String>,
    #[serde(default)]
    pub prepare_command: Option<String>,
    #[serde(default)]
    pub setup_files: Vec<String>,
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
    pub status: RunStatus,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub session_id: Option<String>,
    pub result: String,
    /// Text the model is still writing, from partial messages. Kept in memory only and
    /// cleared when the message completes into activity or `result`.
    #[serde(skip)]
    pub streaming: String,
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
    /// Append-only decision trail the agent reported for this attempt.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub decisions: Vec<crate::commands::decision_trail::DecisionEntry>,
    #[serde(default)]
    pub screenshots: Vec<crate::commands::harness::ScreenshotArtifact>,
    /// Desktop-control actions for the Screen view, newest last and bounded.
    #[serde(default)]
    pub desktop_actions: Vec<crate::commands::desktop_control::DesktopActionRecord>,
    /// Local preview paths the agent opened in its task browser, newest last.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub visited_pages: Vec<String>,
    /// Before/after screenshots Jackalope captured for review.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_captures: Option<crate::commands::previews::review::ReviewCaptures>,
    /// Review screenshots are being captured after the attempt finished.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub review_capturing: bool,
    /// The result this attempt challenges, when it is a Challenge reviewer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub challenge_of: Option<crate::commands::challenge_review::ChallengeSource>,
    /// Secret values the agent was given, which the record never shows. Kept
    /// in memory only, for as long as the attempt can still produce output.
    #[serde(skip)]
    pub(crate) secrets: Option<std::sync::Arc<crate::commands::redaction::KnownSecrets>>,
}

impl TaskRun {
    pub fn mark_stopped(&mut self) {
        self.status = RunStatus::Stopped;
        self.ended_at = Some(chrono::Utc::now().to_rfc3339());
    }

    pub fn mark_failed(&mut self, error: String) {
        self.status = RunStatus::Failed;
        self.error = Some(error);
        self.ended_at = Some(chrono::Utc::now().to_rfc3339());
        self.progress = None;
    }

    /// Adds `values` to the secrets this attempt's record never shows, and
    /// redacts what it already holds.
    pub(in crate::commands) fn protect(&mut self, values: Vec<String>) {
        if let Some(secrets) =
            crate::commands::redaction::KnownSecrets::with(self.secrets.as_deref(), values)
        {
            self.secrets = Some(std::sync::Arc::new(secrets));
            self.redact_secrets();
        }
    }

    /// Replaces the attempt's secret values wherever the record keeps what the
    /// agent wrote, asked, decided, checked or showed. The person's prompt and
    /// the record's identifiers, paths and statuses are left as they are.
    pub(in crate::commands) fn redact_secrets(&mut self) {
        let Some(secrets) = self.secrets.clone() else {
            return;
        };
        secrets.text(&mut self.result);
        secrets.streaming(&mut self.streaming);
        for text in self
            .activity
            .iter_mut()
            .chain(&mut self.diagnostics)
            .chain(&mut self.visited_pages)
            .chain(&mut self.error)
            .chain(&mut self.verification_error)
            .chain(&mut self.checkpoint_error)
        {
            secrets.text(text);
        }
        secrets.record(&mut self.prompts);
        secrets.record(&mut self.validation_steps);
        secrets.record(&mut self.decisions);
        secrets.record(&mut self.understanding);
        secrets.record(&mut self.screenshots);
        secrets.record(&mut self.desktop_actions);
        secrets.record(&mut self.quota_failure);
        secrets.record(&mut self.verification);
        secrets.record(&mut self.progress);
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    #[serde(skip)]
    pub live_session_id: Option<String>,
    #[serde(default)]
    pub effort: Option<super::effort::TaskEffort>,
    #[serde(default)]
    pub codex_speed: Option<super::speed::CodexSpeed>,
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
    pub setup_files: Vec<String>,
    #[serde(default)]
    pub auto_verify: bool,
    #[serde(default)]
    pub target_branch: Option<String>,
    #[serde(skip)]
    pub account_binding: Option<crate::commands::agent_profiles::AccountBinding>,
    pub prompt: String,
    pub isolated: bool,
    /// Where a new Git task runs. When present it overrides `isolated`: only
    /// `worktree` isolates, `branch` and `current` edit the project checkout,
    /// and `ask` asks the person when the task starts. Absent keeps the
    /// `isolated` choice, so callers that need worktrees are unaffected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_mode: Option<WorkspaceMode>,
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

impl RunRequest {
    /// A new attempt with a fresh id, in its own worktree, with every option at
    /// its default. Callers set the fields they need with struct update syntax.
    pub(in crate::commands) fn new(
        project_id: &str,
        project_name: &str,
        project_path: &str,
        agent: &str,
        prompt: String,
    ) -> Self {
        Self {
            live_session_id: None,
            effort: None,
            codex_speed: None,
            dependency_snapshot: Default::default(),
            monitor_change: None,
            context_selection: Default::default(),
            context_receipt: Default::default(),
            model: None,
            id: uuid::Uuid::new_v4().to_string(),
            project_id: project_id.into(),
            project_name: project_name.into(),
            project_path: project_path.into(),
            agent: agent.into(),
            agent_profile_id: None,
            verify_command: None,
            prepare_command: None,
            setup_files: Vec::new(),
            auto_verify: false,
            target_branch: None,
            account_binding: None,
            prompt,
            isolated: true,
            workspace_mode: None,
            previous_run_id: None,
            retry_of: None,
            connection_ids: None,
            coordination: None,
        }
    }
}

#[derive(Clone)]
pub struct CoordinationContext {
    pub managed: bool,
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
    pub status: RunStatus,
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
    /// The sign-in check ran and found no signed-in account.
    pub sign_in_needed: bool,
    /// Tasks can start: the account is signed in, or this agent checks access when a task starts.
    pub ready: bool,
}

impl TaskRun {
    pub(in crate::commands) fn summary(&self) -> Self {
        let mut context_receipt = self.context_receipt.clone();
        context_receipt.jev_preparation = None;
        context_receipt.jev_preparation_result = None;
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
            codex_speed: self.codex_speed,
            reasoning_effort: self.reasoning_effort.clone(),
            requested_service_tier: self.requested_service_tier.clone(),
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
            understanding: self.understanding.clone(),
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
            remote: self.remote.clone(),
            host: self.host.clone(),
            verify_command: self.verify_command.clone(),
            prepare_command: self.prepare_command.clone(),
            setup_files: self.setup_files.clone(),
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
            streaming: String::new(),
            details_omitted: true,
            activity: if self.status.is_active() {
                self.activity
                    .iter()
                    .rev()
                    .take(3)
                    .rev()
                    .map(|text| super::tool_activity::preview(text))
                    .collect()
            } else {
                Default::default()
            },
            diagnostics: Default::default(),
            error: self.error.clone(),
            persistence_error: self.persistence_error.clone(),
            exit_code: self.exit_code.clone(),
            usage: self.usage.clone(),
            mcp_usage: self.mcp_usage.clone(),
            usage_observations: self.usage_observations.clone(),
            prompts: self.prompts.clone(),
            validation_steps: self.validation_steps.clone(),
            decisions: self.decisions.clone(),
            screenshots: self.screenshots.clone(),
            desktop_actions: self.desktop_actions[self.desktop_actions.len().saturating_sub(12)..]
                .to_vec(),
            visited_pages: self.visited_pages.clone(),
            review_captures: self.review_captures.clone(),
            review_capturing: self.review_capturing,
            challenge_of: self.challenge_of.clone(),
            secrets: None,
        }
    }
}
