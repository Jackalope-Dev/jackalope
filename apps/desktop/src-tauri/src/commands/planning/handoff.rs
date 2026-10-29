//! Turning an approved plan into work, and reading results back against it.

use super::artifact::{PlanDocument, PlanTask};
use crate::commands::harness::ValidationStep;
use serde::Serialize;

/// Marks a requirement whose criterion is verified in a browser, after the ID,
/// so review screenshots can attach to it.
pub const BROWSER_TAG: &str = "[browser]";

/// Each criterion as a task requirement title. Requirements keep the ID first
/// so results can be mapped back to the plan.
pub fn outcomes(doc: &PlanDocument, ids: &[String]) -> Vec<String> {
    doc.criteria
        .iter()
        .filter(|criterion| ids.is_empty() || ids.contains(&criterion.id))
        .map(|criterion| {
            if criterion.verify == super::artifact::VerifyKind::Browser {
                format!("{}: {BROWSER_TAG} {}", criterion.id, criterion.text)
            } else {
                format!("{}: {}", criterion.id, criterion.text)
            }
        })
        .collect()
}

fn remaining(doc: &PlanDocument) -> Vec<&PlanTask> {
    doc.tasks
        .iter()
        .filter(|task| !task.status.eq_ignore_ascii_case("done"))
        .collect()
}

fn bounded(text: &str, limit: usize) -> String {
    if text.len() <= limit {
        return text.to_string();
    }
    let mut end = limit;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

/// Assignments in the managed-task JSON shape, so the existing plan
/// validation (limits, scopes, overlap and cycles) applies unchanged.
/// `single` folds every remaining task into one assignment.
pub fn assignments(doc: &PlanDocument, shape: &str) -> Result<String, String> {
    let tasks = remaining(doc);
    if tasks.is_empty() {
        return Err("Every task in this plan is already done.".into());
    }
    let open: Vec<&str> = tasks.iter().map(|task| task.key.as_str()).collect();
    let value = if shape == "single" {
        let mut scopes: Vec<String> = tasks.iter().flat_map(|task| task.scopes.clone()).collect();
        scopes.sort();
        scopes.dedup();
        let briefing = tasks
            .iter()
            .filter(|task| !task.briefing.is_empty())
            .map(|task| format!("{}: {}", task.key, task.briefing))
            .collect::<Vec<_>>()
            .join("\n");
        serde_json::json!([{
            "key": "plan",
            "title": bounded(&doc.title, 160),
            "prompt": format!("Implement every remaining task in the approved plan, in dependency order: {}.", open.join(", ")),
            "scopes": scopes,
            "outcomes": outcomes(doc, &[]),
            "briefing": bounded(&briefing, 4000),
        }])
    } else {
        serde_json::Value::Array(
            tasks
                .iter()
                .map(|task| {
                    serde_json::json!({
                        "key": task.key,
                        "title": bounded(&task.title, 160),
                        "prompt": format!(
                            "Implement task {} of the approved plan: {}.{} Other tasks belong to other workers; the plan below is shared context.",
                            task.key,
                            task.title,
                            if task.covers.is_empty() { String::new() } else { format!(" It satisfies {}.", task.covers.join(", ")) }
                        ),
                        "scopes": task.scopes,
                        "dependsOn": task.depends_on.iter().filter(|key| open.contains(&key.as_str())).collect::<Vec<_>>(),
                        "outcomes": outcomes(doc, &task.covers),
                        "briefing": bounded(&task.briefing, 4000),
                    })
                })
                .collect(),
        )
    };
    serde_json::to_string(&value).map_err(|error| error.to_string())
}

/// Picks the shape the planner recommended when it is available.
pub fn default_shape(doc: &PlanDocument, swarm_connected: bool) -> &'static str {
    match doc.front.recommended_shape.trim() {
        "swarm" if swarm_connected => "swarm",
        "subtasks" | "swarm" if remaining(doc).len() > 1 => "subtasks",
        _ => "single",
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionState {
    pub id: String,
    /// `unassessed`, `agent-claimed`, `check-passed`, `check-failed` or
    /// `human-accepted`.
    pub state: &'static str,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub detail: String,
}

/// What one attempt recorded about the plan's criteria.
#[derive(Clone, Debug, Default)]
pub struct Evidence {
    pub steps: Vec<ValidationStep>,
    /// Requirement ID → title, for mapping assessments back to criteria.
    pub requirements: Vec<(String, String, bool)>,
}

fn criterion_of(title: &str) -> Option<&str> {
    let (id, _) = title.split_once(':')?;
    id.starts_with("AC-").then_some(id)
}

/// Criterion states across every attempt that worked on the plan. Human
/// acceptance outranks a passing check, which outranks an agent's claim.
pub fn criterion_states(doc: &PlanDocument, evidence: &[Evidence]) -> Vec<CriterionState> {
    doc.criteria
        .iter()
        .map(|criterion| {
            let mut state = "unassessed";
            let mut detail = String::new();
            for attempt in evidence {
                let requirement = attempt
                    .requirements
                    .iter()
                    .find(|(_, title, _)| criterion_of(title) == Some(criterion.id.as_str()));
                if requirement.is_some_and(|(_, _, accepted)| *accepted) {
                    return CriterionState {
                        id: criterion.id.clone(),
                        state: "human-accepted",
                        detail: String::new(),
                    };
                }
                if let Some(step) = attempt
                    .steps
                    .iter()
                    .rev()
                    .find(|step| step.step.trim() == criterion.id)
                {
                    match step.status.as_str() {
                        "passed" => {
                            state = "check-passed";
                            detail = step.notes.clone().unwrap_or_default();
                        }
                        "failed" if state != "check-passed" => {
                            state = "check-failed";
                            detail = step.notes.clone().unwrap_or_default();
                        }
                        _ => {}
                    }
                }
                if state == "unassessed" {
                    if let Some((id, _, _)) = requirement {
                        if let Some(claim) = attempt
                            .steps
                            .iter()
                            .flat_map(|step| &step.requirements)
                            .rev()
                            .find(|item| &item.requirement_id == id)
                        {
                            if matches!(
                                claim.status,
                                crate::commands::outcomes::AssessmentStatus::Met
                            ) {
                                state = "agent-claimed";
                                detail = claim.summary.clone();
                            }
                        }
                    }
                }
            }
            CriterionState {
                id: criterion.id.clone(),
                state,
                detail,
            }
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gap {
    /// `critical`, `major` or `minor`.
    pub severity: String,
    pub text: String,
}

/// The newest independent plan review, when one was recorded.
pub fn review(steps: &[ValidationStep]) -> Option<(bool, Vec<Gap>)> {
    let step = steps
        .iter()
        .rev()
        .find(|step| step.step.trim().eq_ignore_ascii_case("plan review"))?;
    let gaps = step
        .notes
        .as_deref()
        .unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let line = line.trim().trim_start_matches("- ");
            let (severity, text) = line.split_once(char::is_whitespace)?;
            let severity = severity.trim_end_matches(':').to_ascii_lowercase();
            ["critical", "major", "minor"]
                .contains(&severity.as_str())
                .then(|| Gap {
                    severity,
                    text: text.trim().to_string(),
                })
        })
        .collect();
    Some((step.status == "passed", gaps))
}

/// Whether the combined result may be integrated as far as the plan review is
/// concerned. With a check, only open Critical or Major gaps hold it back;
/// without one the review is the only gate, so it must have passed.
pub fn review_cleared(steps: &[ValidationStep], checked: bool) -> bool {
    if checked {
        open_gaps(steps).is_none()
    } else {
        review(steps).is_some_and(|(passed, _)| passed)
    }
}

/// Notes of a failed plan review: Critical or Major gaps remain and the
/// delivery loop treats them like a failed check within its repair limit.
pub fn open_gaps(steps: &[ValidationStep]) -> Option<String> {
    let (passed, gaps) = review(steps)?;
    if passed {
        return None;
    }
    let blocking: Vec<String> = gaps
        .iter()
        .filter(|gap| gap.severity != "minor")
        .map(|gap| format!("{} {}", gap.severity, gap.text))
        .collect();
    Some(if blocking.is_empty() {
        "The plan review failed without listing gaps.".into()
    } else {
        blocking.join("\n")
    })
}
