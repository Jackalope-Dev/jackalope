//! The workspace as a terminal sees it: domain records mapped onto the
//! terminal protocol.

use crate::cli_protocol::{self as protocol, AgentState};
use crate::commands::agent_policy::AgentPolicy;
use crate::commands::live_sessions::LiveSession;
use crate::commands::project_registry::ProjectRecord;
use crate::commands::tasks::{events::ACTIVITY_KEPT, Runner, TaskRun, TaskRuntime};

pub fn project_summary(runtime: &TaskRuntime, record: ProjectRecord) -> protocol::Project {
    let planning = crate::commands::planning::session::store_for(runtime).settings(&record.id);
    protocol::Project {
        settings: record.settings.resolve().into(),
        id: record.id,
        name: record.name,
        path: record.path,
        accent: record.accent,
        verify_command: record
            .verify_command
            .filter(|command| !command.trim().is_empty()),
        auto_verify: record.auto_verify,
        question_cap: Some(planning.question_cap as u32),
        planner_agent: planning.planner_agent.filter(|agent| !agent.is_empty()),
        preview_command: record
            .preview_command
            .filter(|command| !command.trim().is_empty()),
    }
}

pub fn learning_summary(
    entry: &crate::commands::knowledge::KnowledgeEntry,
) -> Option<protocol::Learning> {
    let source = entry.automatic.as_ref()?;
    let state = source.lifecycle.as_ref()?;
    Some(protocol::Learning {
        id: entry.id.clone(),
        title: entry.title.clone(),
        content: entry.content.clone(),
        status: state.status.clone(),
        kind: source.kind.clone(),
        uses: state.deliveries,
        managed: source.managed,
        updated_at: entry.updated_at.clone(),
        archived_reason: state.archived_reason.clone(),
        misses: (state.misses > 0).then_some(state.misses),
        attention: crate::commands::knowledge::learning::attention(entry),
        enforced: entry
            .enforced
            .as_ref()
            .map(|enforcement| enforcement.by.clone()),
    })
}

/// The conversation's most recently started run.
pub fn latest_run<'a>(session_id: &str, runs: &'a [TaskRun]) -> Option<&'a TaskRun> {
    runs.iter()
        .filter(|run| run.live_session_id.as_deref() == Some(session_id))
        .max_by(|left, right| left.started_at.cmp(&right.started_at))
}

pub fn session_summary(session: &LiveSession, runs: &[TaskRun]) -> protocol::SessionSummary {
    let run = latest_run(&session.id, runs);
    protocol::SessionSummary {
        id: session.id.clone(),
        title: session.title.clone(),
        project_id: session.request.project_id.clone(),
        paused: session.paused,
        pending: session
            .messages
            .iter()
            .filter(|message| !message.canceled && message.run_id.is_none())
            .count(),
        error: protocol::present(session.error.as_deref()).map(str::to_string),
        updated_at: session.updated_at.clone(),
        status: run.map(|run| run.status.clone()),
        asking: run.is_some_and(|run| run.prompts.iter().any(|prompt| prompt.status == "pending")),
        agent: run.map(|run| run.agent.clone()),
        step: run
            .and_then(|run| run.progress.as_ref())
            .map(|progress| progress.label.clone()),
    }
}

/// The conversation as turns: each batch of messages, then what the agent
/// produced for it, then anything still waiting to be sent.
fn transcript(session: &LiveSession, runs: &[TaskRun]) -> Vec<protocol::Message> {
    let mut messages = Vec::new();
    let visible: Vec<_> = session
        .messages
        .iter()
        .filter(|message| !message.canceled)
        .collect();
    for (index, message) in visible.iter().enumerate() {
        messages.push(protocol::Message {
            role: "you".into(),
            text: message.text.clone(),
            sent: message.run_id.is_some(),
            attempt: None,
            id: Some(message.id.clone()),
        });
        // A reply follows the last message its run carried.
        let Some(run_id) = &message.run_id else {
            continue;
        };
        let last_of_batch = visible
            .get(index + 1)
            .is_none_or(|next| next.run_id.as_ref() != Some(run_id));
        if !last_of_batch {
            continue;
        }
        let attempts = attempts(run_id, runs);
        let numbered = attempts.len() > 1;
        for (number, run) in (1..).zip(&attempts) {
            if !run.result.trim().is_empty() {
                messages.push(protocol::Message {
                    role: "agent".into(),
                    text: run.result.clone(),
                    sent: true,
                    attempt: numbered.then_some(number),
                    id: None,
                });
            }
        }
    }
    messages
}

/// The run a batch started followed by each retry of it, oldest first.
fn attempts<'a>(run_id: &str, runs: &'a [TaskRun]) -> Vec<&'a TaskRun> {
    let mut chain = Vec::new();
    let mut next = runs.iter().find(|run| run.id == run_id);
    while let Some(run) = next {
        // A malformed history must not loop forever.
        if chain.iter().any(|seen: &&TaskRun| seen.id == run.id) {
            break;
        }
        chain.push(run);
        next = runs
            .iter()
            .filter(|candidate| candidate.retry_of.as_deref() == Some(run.id.as_str()))
            .min_by(|left, right| left.started_at.cmp(&right.started_at));
    }
    chain
}

/// Activity entries a terminal receives, enough to show what work is doing.
const ACTIVITY_TAIL: usize = 12;
/// Steps a run card lists.
const STEPS_SHOWN: usize = 6;

/// The stage a recorded execution stage belongs to on a run card. The
/// checkpoint saved after the work is bookkeeping and stays off the card.
fn card_stage(stage: &str) -> Option<&'static str> {
    match stage {
        "routing" => Some("route"),
        "preparation" => Some("prepare"),
        "execution" => Some("work"),
        "verification_wait" | "verification" => Some("check"),
        _ => None,
    }
}

fn millis_between(start: &str, end: &str) -> Option<u64> {
    let start = chrono::DateTime::parse_from_rfc3339(start).ok()?;
    let end = chrono::DateTime::parse_from_rfc3339(end).ok()?;
    u64::try_from((end - start).num_milliseconds()).ok()
}

/// The run's recorded stages, steps and check as figures for a run card.
fn run_summary(run: &TaskRun) -> protocol::RunSummary {
    use crate::commands::tasks::tool_activity::{counts_as_step, kind, preview, step_text};
    let mut stages: Vec<protocol::RunStage> = Vec::new();
    for stage in &run.stages {
        let Some(name) = card_stage(&stage.stage) else {
            continue;
        };
        let duration = stage
            .duration_ms
            .and_then(|ms| u64::try_from(ms).ok())
            .filter(|_| stage.ended_at.is_some());
        match stages.last_mut() {
            Some(last) if last.name == name => {
                last.duration_ms = last.duration_ms.zip(duration).map(|(a, b)| a + b);
            }
            _ => stages.push(protocol::RunStage {
                name: name.into(),
                duration_ms: duration,
            }),
        }
    }
    let previews: Vec<String> = run.activity.iter().map(|entry| preview(entry)).collect();
    let mut summary = protocol::RunSummary {
        stages,
        duration_ms: run
            .ended_at
            .as_deref()
            .and_then(|end| millis_between(&run.started_at, end)),
        trimmed: run.activity.len() >= ACTIVITY_KEPT,
        check: run.verification.as_ref().map(|check| protocol::RunCheck {
            command: check.command.chars().take(80).collect(),
            passed: check.result.success,
            duration_ms: check.result.duration_ms,
        }),
        ..Default::default()
    };
    for preview in previews.iter().filter(|preview| counts_as_step(preview)) {
        match kind(preview) {
            "read" => summary.reads += 1,
            "search" => summary.searches += 1,
            "command" => summary.commands += 1,
            "failure" => summary.failures += 1,
            _ => {}
        }
    }
    let mut steps: Vec<protocol::RunStep> = Vec::new();
    for preview in &previews {
        let text = step_text(preview).trim();
        if text.is_empty() || steps.last().is_some_and(|last| last.text == text) {
            continue;
        }
        steps.push(protocol::RunStep {
            kind: kind(preview).into(),
            text: text.into(),
        });
    }
    let skip = steps.len().saturating_sub(STEPS_SHOWN);
    summary.steps = steps.split_off(skip);
    summary
}

/// The conversation and its newest attempt, as a terminal renders them.
pub fn session_view(session: &LiveSession, runs: &[TaskRun]) -> protocol::SessionView {
    let run = latest_run(&session.id, runs);
    let decision = run
        .and_then(|run| run.routing.as_ref())
        .and_then(|routing| routing.decisions.last());
    let run_error = run
        .filter(|run| !run.status.is_done() && !run.status.is_running())
        .and_then(|run| {
            protocol::present(run.error.as_deref())
                .or(protocol::present(run.verification_error.as_deref()))
                .or(run.quota_failure.as_ref().map(|q| q.message.as_str()))
        });
    let error = protocol::present(session.error.as_deref())
        .or(run_error)
        .map(str::to_string);
    protocol::SessionView {
        id: session.id.clone(),
        title: session.title.clone(),
        paused: session.paused,
        error,
        messages: transcript(session, runs),
        run_id: run.map(|run| run.id.clone()),
        merged: run.is_some_and(|run| session.integrated_run_id.as_deref() == Some(&run.id)),
        draft: session.draft.text.clone(),
        draft_revision: session.draft.revision,
        status: run.map(|run| run.status.clone()),
        agent: run.map(|run| run.agent.clone()),
        account: run.map(|run| run.account.clone()),
        model: run.and_then(|run| run.model.clone()),
        routing: decision.map(|decision| decision.reason.clone()),
        step: run
            .and_then(|run| run.progress.as_ref())
            .map(|progress| progress.label.clone()),
        step_detail: run
            .and_then(|run| run.progress.as_ref())
            .map(|progress| progress.detail.clone()),
        attempt: run
            .and_then(|run| run.progress.as_ref())
            .map(|progress| progress.attempt),
        workspace: run.map(|run| run.workspace.clone()),
        branch: run.map(|run| run.branch.clone()),
        // Streamed text stands in for the output until the message completes.
        result: run
            .map(|run| {
                if run.result.is_empty() {
                    run.streaming.clone()
                } else {
                    run.result.clone()
                }
            })
            .unwrap_or_default(),
        activity: run
            .map(|run| {
                let skip = run.activity.len().saturating_sub(ACTIVITY_TAIL);
                run.activity[skip..].to_vec()
            })
            .unwrap_or_default(),
        partial: run
            .filter(|run| run.result.is_empty() && protocol::working(Some(&run.status)))
            .map(|run| run.streaming.clone())
            .unwrap_or_default(),
        review_screenshots: run
            .and_then(|run| run.review_captures.as_ref())
            .map(|captures| captures.image_count() as u32)
            .filter(|count| *count > 0),
        questions: run
            .map(|run| {
                run.prompts
                    .iter()
                    .filter(|prompt| prompt.status == "pending")
                    .map(super::plans::question)
                    .collect()
            })
            .unwrap_or_default(),
        run: run.map(run_summary),
    }
}

pub fn agent_status(runner: Runner, policy: &AgentPolicy) -> protocol::AgentStatus {
    let state = if policy.enabled_agents.get(&runner.id) == Some(&false) {
        AgentState::Disabled
    } else if !runner.available {
        AgentState::Missing
    } else if runner.signed_in {
        AgentState::Ready
    } else if runner.sign_in_needed {
        AgentState::SignIn
    } else {
        AgentState::Installed
    };
    let options = policy.runner_options.get(&runner.id);
    protocol::AgentStatus {
        models: options
            .map(|options| {
                options
                    .models
                    .iter()
                    .map(|model| model.trim().to_string())
                    .filter(|model| !model.is_empty())
                    .collect()
            })
            .unwrap_or_default(),
        default_model: options
            .map(|options| options.default_model.clone())
            .unwrap_or_default(),
        id: runner.id,
        name: runner.name,
        state,
        account: runner.account,
        detail: runner.detail,
    }
}

pub fn usage_account(record: crate::commands::capacity::CapacityRecord) -> protocol::UsageAccount {
    protocol::UsageAccount {
        agent: record.agent,
        account: record.account,
        status: record.status,
        detail: record.detail,
        observed_at: record.observed_at,
        windows: record
            .windows
            .into_iter()
            .map(|window| protocol::UsageWindow {
                name: if window.pool_name.is_empty() {
                    window.window
                } else {
                    format!("{} · {}", window.pool_name, window.window)
                },
                used_percent: window.used_percent,
                resets_at: window.resets_at,
            })
            .collect(),
    }
}

pub fn browser_profile(
    status: crate::commands::browser_profiles::BrowserProfileStatus,
) -> protocol::BrowserProfileView {
    protocol::BrowserProfileView {
        name: status.profile.name,
        sites: status.profile.signed_in_sites,
        size_bytes: status.size_bytes,
        last_used_at: status.profile.last_used_at,
        in_use: status.in_use,
        window_open: status.window_open,
    }
}

pub fn computer(status: crate::commands::computers::ComputerStatus) -> protocol::ComputerView {
    protocol::ComputerView {
        name: status.computer.name,
        provider: status.computer.provider,
        state: status.state,
        phase: status.phase,
        error: status.error,
        usage: status.usage,
        stopped_idle: status.stopped_idle,
    }
}

pub fn merge_plan(plan: crate::commands::integration::IntegrationPlan) -> protocol::MergePlan {
    protocol::MergePlan {
        cleanup: plan
            .commit_policy
            .as_ref()
            .is_some_and(|policy| policy.cleanup_after_merge),
        cleanup_errors: plan
            .cleanup_results
            .iter()
            .filter_map(|result| {
                result
                    .error
                    .as_ref()
                    .map(|error| format!("{}: {error}", result.workspace))
            })
            .collect(),
        id: plan.id,
        status: plan.status,
        target_branch: plan.target_branch,
        files: plan.files,
        conflicts: plan.conflicts,
        commit_message: plan.commit_message,
    }
}

pub fn commit_policy(policy: crate::commands::project_git::CommitPolicy) -> protocol::Response {
    protocol::Response::CommitPolicy {
        attribution: policy.attribution,
        name: policy.name,
        email: policy.email,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(id: &str, retry_of: Option<&str>, started_at: &str) -> TaskRun {
        TaskRun {
            id: id.into(),
            retry_of: retry_of.map(String::from),
            started_at: started_at.into(),
            ..TaskRun::default()
        }
    }

    #[test]
    fn a_run_summary_merges_stages_counts_each_step_once_and_hides_commands() {
        let mut task = run("a", None, "2026-01-01T00:00:00Z");
        task.ended_at = Some("2026-01-01T00:03:00Z".into());
        task.stages = serde_json::from_value(serde_json::json!([
            {"stage": "routing", "startedAt": "", "endedAt": "x", "durationMs": 200},
            {"stage": "preparation", "startedAt": "", "endedAt": "x", "durationMs": 3000},
            {"stage": "execution", "startedAt": "", "endedAt": "x", "durationMs": 160000},
            {"stage": "checkpoint", "startedAt": "", "endedAt": "x", "durationMs": 1000},
            {"stage": "verification", "startedAt": "", "endedAt": null, "durationMs": null},
        ]))
        .expect("stages");
        task.activity = [
            "Searching the project",
            "Reading src/a.rs · running",
            "Reading src/a.rs · completed",
            "Running cargo",
            "cargo test --secret-flag\nExit: 0\nok",
            "Running cargo",
            "cargo build\nExit: 101\nerror",
        ]
        .map(String::from)
        .to_vec();
        let summary = run_summary(&task);
        let stages: Vec<(&str, Option<u64>)> = summary
            .stages
            .iter()
            .map(|stage| (stage.name.as_str(), stage.duration_ms))
            .collect();
        assert_eq!(
            stages,
            [
                ("route", Some(200)),
                ("prepare", Some(3000)),
                ("work", Some(160_000)),
                ("check", None)
            ]
        );
        assert_eq!(summary.duration_ms, Some(180_000));
        assert_eq!(
            (
                summary.reads,
                summary.searches,
                summary.commands,
                summary.failures
            ),
            (1, 1, 2, 1)
        );
        let steps: Vec<&str> = summary
            .steps
            .iter()
            .map(|step| step.text.as_str())
            .collect();
        assert!(
            !steps.iter().any(|step| step.contains("secret")),
            "{steps:?}"
        );
        assert_eq!(steps.last(), Some(&"Command failed (exit 101)"));
        assert_eq!(
            summary.steps.last().map(|step| step.kind.as_str()),
            Some("failure")
        );
    }

    #[test]
    fn a_batch_lists_its_run_and_every_retry_in_order() {
        let runs = [
            run("b", Some("a"), "2"),
            run("a", None, "1"),
            run("other", None, "0"),
            run("c", Some("b"), "3"),
        ];
        let ids: Vec<&str> = attempts("a", &runs)
            .iter()
            .map(|run| run.id.as_str())
            .collect();
        assert_eq!(ids, ["a", "b", "c"]);
        assert!(attempts("missing", &runs).is_empty());
        // A cycle in stored history ends rather than looping.
        let looped = [run("x", Some("y"), "1"), run("y", Some("x"), "2")];
        assert_eq!(attempts("x", &looped).len(), 2);
    }

    #[test]
    fn the_latest_run_is_the_conversations_newest_start() {
        let mut runs = [
            run("old", None, "1"),
            run("new", None, "2"),
            run("other", None, "3"),
        ];
        runs[0].live_session_id = Some("s".into());
        runs[1].live_session_id = Some("s".into());
        assert_eq!(
            latest_run("s", &runs).map(|run| run.id.as_str()),
            Some("new")
        );
        assert!(latest_run("missing", &runs).is_none());
    }
}
