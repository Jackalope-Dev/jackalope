//! Plans for the `jackalope` terminal: the same sessions the app uses,
//! shaped into the terminal protocol.

use super::{handoff::CriterionState, session};
use crate::cli_protocol as protocol;
use crate::commands::{coordination::Coordinator, harness::PendingUserPrompt};

pub fn question(prompt: &PendingUserPrompt) -> protocol::Question {
    protocol::Question {
        id: prompt.id.clone(),
        run_id: prompt.run_id.clone(),
        question: prompt.question.clone(),
        options: prompt.options.clone(),
        header: prompt.presentation.header.clone(),
        recommended: prompt.presentation.recommended.clone(),
        multi_select: prompt.input_type == "multiChoice",
        rationale: prompt.presentation.rationale.clone(),
    }
}

fn state_of(states: &[CriterionState], id: &str) -> String {
    states
        .iter()
        .find(|state| state.id == id)
        .map(|state| state.state.to_string())
        .unwrap_or_else(|| "unassessed".into())
}

pub fn view(plan: &session::PlanView) -> protocol::PlanView {
    let doc = plan.document.as_ref();
    let progress = plan.progress.as_ref();
    protocol::PlanView {
        id: plan.id.clone(),
        title: plan.title.clone(),
        status: plan.status.clone(),
        planning: plan.planning,
        error: plan.error.clone(),
        revision: plan.revision,
        hash: plan.hash.clone(),
        markdown: plan.markdown.clone(),
        shape: plan.shape.clone(),
        shape_reason: doc
            .map(|doc| doc.front.shape_reason.clone())
            .unwrap_or_default(),
        workers: doc.map(|doc| doc.front.workers).unwrap_or_default(),
        swarm_connected: plan.swarm_connected,
        assumptions: doc.map(|doc| doc.assumptions.clone()).unwrap_or_default(),
        tasks: doc
            .map(|doc| {
                doc.tasks
                    .iter()
                    .map(|task| protocol::PlanTask {
                        key: task.key.clone(),
                        title: task.title.clone(),
                        depends_on: task.depends_on.clone(),
                        parallel: task.parallel,
                        covers: task.covers.clone(),
                        state: progress
                            .and_then(|progress| {
                                progress
                                    .tasks
                                    .iter()
                                    .find(|item| item.key == task.key || item.key == "plan")
                            })
                            .map(|item| item.state.clone())
                            .unwrap_or_else(|| task.status.clone()),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        criteria: doc
            .map(|doc| {
                doc.criteria
                    .iter()
                    .map(|criterion| protocol::PlanCriterion {
                        id: criterion.id.clone(),
                        verify: criterion.verify.as_str().into(),
                        text: criterion.text.clone(),
                        state: state_of(&plan.criteria, &criterion.id),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        questions: plan.questions.iter().map(question).collect(),
        deviations: plan
            .deviations
            .iter()
            .map(|deviation| protocol::PlanDeviation {
                id: deviation.id.clone(),
                kind: deviation.kind.clone(),
                summary: deviation.summary.clone(),
                status: deviation.status.clone(),
                amendment: deviation.amendment.clone(),
            })
            .collect(),
        changed: plan
            .changes
            .iter()
            .map(|change| change.section.clone())
            .collect(),
        progress: progress.map(|progress| {
            let checked = progress
                .tasks
                .iter()
                .filter(|task| ["checked", "merged"].contains(&task.state.as_str()))
                .count();
            let mut line = format!("{checked}/{} tasks checked", progress.tasks.len());
            if let Some(review) = &progress.review {
                line.push_str(&format!(" · review {}", review.state));
            }
            if progress.repairs > 0 {
                line.push_str(&format!(
                    " · repairs {}/{}",
                    progress.repairs, progress.repair_limit
                ));
            }
            if !progress.dispatching && !progress.merged {
                line.push_str(" · paused");
            }
            if let Some(error) = &progress.error {
                line.push_str(&format!(" · {error}"));
            }
            line
        }),
        verification: Some(plan.verification.source.into()),
        check: plan.verification.command.clone(),
    }
}

fn detail(coordinator: &Coordinator, id: &str) -> Result<protocol::Response, String> {
    Ok(protocol::Response::Plan {
        plan: Box::new(view(&session::view(coordinator, id)?)),
    })
}

pub fn list(coordinator: &Coordinator, project_id: &str) -> Result<protocol::Response, String> {
    Ok(protocol::Response::Plans {
        plans: super::list(coordinator, Some(project_id))?
            .plans
            .into_iter()
            .map(|plan| protocol::PlanSummary {
                id: plan.id,
                title: plan.title,
                status: plan.status,
                revision: plan.revision,
                updated_at: plan.updated_at,
                needs_you: plan.needs_you,
            })
            .collect(),
    })
}

pub fn start(
    coordinator: &Coordinator,
    template: crate::commands::tasks::RunRequest,
    goal: String,
) -> Result<protocol::Response, String> {
    let record = session::start(coordinator, template, goal)?;
    detail(coordinator, &record.id)
}

pub fn get(coordinator: &Coordinator, id: &str) -> Result<protocol::Response, String> {
    detail(coordinator, id)
}

pub fn action(
    coordinator: &Coordinator,
    id: &str,
    action: &str,
    text: String,
    revision: Option<u32>,
    hash: Option<String>,
) -> Result<protocol::Response, String> {
    match action {
        "keep" => session::keep_planning(coordinator, id, &text)?,
        "replan" => session::replan(coordinator, id, &text)?,
        "approve" => session::approve(
            coordinator,
            id,
            revision.ok_or("Approve the revision you reviewed.")?,
            hash.as_deref()
                .ok_or("Approve the revision you reviewed.")?,
            &text,
            "terminal",
            None,
        )?,
        "save" => {
            session::save_edit(
                coordinator,
                id,
                &text,
                revision.ok_or("Save against the revision you edited.")?,
            )?;
        }
        "export" => {
            let path = session::export(coordinator, id, Some(text).filter(|t| !t.is_empty()))?;
            return Ok(protocol::Response::Exported { path });
        }
        "accept" | "redo" => {
            session::resolve_deviation(coordinator, id, &text, action, "terminal")?
        }
        "replan-deviation" => {
            session::resolve_deviation(coordinator, id, &text, "replan", "terminal")?
        }
        _ => return Err("Unknown plan action.".into()),
    }
    detail(coordinator, id)
}
