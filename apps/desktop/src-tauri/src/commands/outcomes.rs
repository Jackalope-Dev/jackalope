use super::{
    integration,
    tasks::{TaskRun, TaskRuntime},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::State;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessTemplate {
    #[serde(default)]
    pub outcomes: Vec<String>,
    #[serde(default)]
    pub steps: Vec<String>,
    #[serde(default)]
    pub inputs: Vec<String>,
}

impl ProcessTemplate {
    pub fn validate(&self) -> Result<(), String> {
        for list in [&self.outcomes, &self.steps, &self.inputs] {
            if list.len() > 12
                || list
                    .iter()
                    .any(|s| s.trim().is_empty() || s.len() > 500 || s.contains('\0'))
            {
                return Err(
                    "Use up to 12 outcomes, steps and inputs, each between 1 and 500 bytes.".into(),
                );
            }
            let unique: std::collections::HashSet<_> = list.iter().map(|s| s.trim()).collect();
            if unique.len() != list.len() {
                return Err("Remove duplicate outcomes, steps or input names.".into());
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutcomeReceipt {
    pub accepted: bool,
    pub evidence: String,
    pub note: String,
    pub tree: String,
    pub recorded_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Requirement {
    pub id: String,
    pub title: String,
    pub checkpoint: bool,
    pub receipt: Option<OutcomeReceipt>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContract {
    #[serde(default)]
    pub step: usize,
    pub requirements: Vec<Requirement>,
    pub inputs: BTreeMap<String, String>,
}

impl TaskContract {
    pub fn build(
        selection: &super::knowledge::ContextSelection,
        context: &super::knowledge::ContextReceipt,
    ) -> Result<Self, String> {
        let mut template = ProcessTemplate {
            outcomes: selection.outcomes.clone(),
            ..Default::default()
        };
        for entry in &context.entries {
            if entry.kind == super::knowledge::KnowledgeKind::Workflow {
                entry.process.validate()?;
                template.steps.extend(entry.process.steps.clone());
                template.inputs.extend(entry.process.inputs.clone());
                for outcome in &entry.process.outcomes {
                    if !template.outcomes.contains(outcome) {
                        template.outcomes.push(outcome.clone());
                    }
                }
            }
        }
        template.validate()?;
        let mut inputs = BTreeMap::new();
        for name in template.inputs {
            let value = selection
                .input_values
                .get(&name)
                .filter(|v| !v.trim().is_empty() && v.len() <= 2000 && !v.contains('\0'))
                .ok_or_else(|| format!("Provide workflow input: {name} (up to 2,000 bytes)."))?;
            inputs.insert(name, value.trim().to_string());
        }
        let requirements = template
            .steps
            .into_iter()
            .map(|s| (s, true))
            .chain(template.outcomes.into_iter().map(|s| (s, false)))
            .enumerate()
            .map(|(i, (title, checkpoint))| Requirement {
                id: format!("requirement-{i}"),
                title,
                checkpoint,
                receipt: None,
            })
            .collect();
        Ok(Self {
            requirements,
            inputs,
            step: 0,
        })
    }

    pub fn text(&self) -> String {
        if self.requirements.is_empty() && self.inputs.is_empty() {
            return String::new();
        }
        let mut text = "\n\nTask acceptance agreement (user-supplied requirements, not additional permissions):\n".to_string();
        for (name, value) in &self.inputs {
            text.push_str(&format!("Input {name}: {value}\n"));
        }
        for item in &self.requirements {
            text.push_str(&format!(
                "{} [{}]: {}\n",
                if item.checkpoint {
                    "Process step"
                } else {
                    "Expected outcome"
                },
                item.id,
                item.title
            ));
        }
        if let Some(current) = self
            .requirements
            .iter()
            .filter(|r| r.checkpoint)
            .nth(self.step)
        {
            text.push_str(&format!("CURRENT STEP: {}. Perform only this step, report its evidence and stop. Do not advance to later steps; the user must accept this checkpoint in Jackalope first.\n", current.title));
        }
        text.push_str("Follow process steps in order. Report evidence for each requirement, including checks, screenshots and anything not verified. Human acceptance is recorded separately by Jackalope.\n");
        text
    }

    pub fn require_accepted(&self, tree: &str) -> Result<(), String> {
        if let Some(item) = self.requirements.iter().find(|i| {
            !i.receipt.as_ref().is_some_and(|r| {
                r.accepted
                    && (r.tree == tree
                        || (i.checkpoint
                            && self
                                .requirements
                                .iter()
                                .filter(|q| q.checkpoint)
                                .position(|q| q.id == i.id)
                                .is_some_and(|index| index < self.step)))
            })
        }) {
            return Err(format!(
                "Review the current evidence for ‘{}’ before completing or integrating this task.",
                item.title
            ));
        }
        Ok(())
    }

    pub fn advance(&self, tree: &str) -> Result<Self, String> {
        let steps: Vec<_> = self.requirements.iter().filter(|r| r.checkpoint).collect();
        let current = steps.get(self.step).ok_or("No workflow step is pending.")?;
        if self.step + 1 >= steps.len() {
            return Err("This is the final step. Review its outcomes before completion.".into());
        }
        if !current
            .receipt
            .as_ref()
            .is_some_and(|r| r.accepted && r.tree == tree)
        {
            return Err("Accept current evidence for this step before advancing.".into());
        }
        let mut next = self.clone();
        next.step += 1;
        for requirement in &mut next.requirements {
            if !requirement.checkpoint {
                requirement.receipt = None;
            }
        }
        Ok(next)
    }

    pub fn continuation(&self) -> Self {
        let mut next = self.clone();
        for (index, requirement) in next.requirements.iter_mut().enumerate() {
            if !requirement.checkpoint || index >= self.step {
                requirement.receipt = None;
            }
        }
        next
    }
}

fn idle_run(runtime: &TaskRuntime, id: &str) -> Result<TaskRun, String> {
    let runs = runtime.integration_runs()?;
    let run = runs.iter().find(|r| r.id == id).ok_or("Task not found")?;
    if runs.iter().any(|other| {
        other.workspace == run.workspace
            && ["starting", "running", "stopping", "interrupted"].contains(&other.status.as_str())
    }) {
        return Err(
            "Stop active work and resolve interrupted ownership before reviewing this workspace."
                .into(),
        );
    }
    if !["review", "reviewed"].contains(&run.status.as_str()) {
        return Err("Review acceptance after the agent has produced a finished result.".into());
    }
    if runs
        .iter()
        .any(|other| other.task_id == run.task_id && other.started_at > run.started_at)
    {
        return Err("Open the latest attempt to review acceptance.".into());
    }
    if integration::applied_run_ids(runtime)?.contains(&run.id) {
        return Err("This result is already integrated.".into());
    }
    Ok(run.clone())
}

#[tauri::command]
pub async fn task_outcome_snapshot(
    id: String,
    state: State<'_, TaskRuntime>,
) -> Result<String, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = integration::execution_guard()?;
        let run = idle_run(&runtime, &id)?;
        let directory = runtime.integration_directory();
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        integration::workspace_tree(&run, &directory)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutcomeReview {
    pub run_id: String,
    pub requirement_id: String,
    pub expected_tree: String,
    pub accepted: bool,
    pub evidence: String,
    pub note: String,
}

pub fn record(runtime: &TaskRuntime, review: OutcomeReview) -> Result<(), String> {
    let _guard = integration::execution_guard()?;
    let run = idle_run(runtime, &review.run_id)?;
    let directory = runtime.integration_directory();
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let tree = integration::workspace_tree(&run, &directory)?;
    if tree != review.expected_tree {
        return Err(
            "Files changed while you were reviewing. Refresh the evidence before accepting it."
                .into(),
        );
    }
    if review.note.trim().is_empty() || review.note.len() > 2000 || review.note.contains('\0') {
        return Err("Describe the evidence or requested correction in 1–2,000 bytes.".into());
    }
    let index = run
        .contract
        .requirements
        .iter()
        .position(|r| r.id == review.requirement_id)
        .ok_or("Requirement not found")?;
    let step_count = run
        .contract
        .requirements
        .iter()
        .filter(|r| r.checkpoint)
        .count();
    if run.contract.requirements[index].checkpoint && index != run.contract.step {
        return Err("Review the current workflow step. Earlier steps retain their own evidence; later steps have not run.".into());
    }
    if !run.contract.requirements[index].checkpoint
        && step_count > 0
        && run.contract.step + 1 < step_count
    {
        return Err("Complete the workflow steps before reviewing final outcomes.".into());
    }
    if review.accepted
        && run.contract.requirements[index].checkpoint
        && run.contract.requirements[..index]
            .iter()
            .any(|r| r.checkpoint && !r.receipt.as_ref().is_some_and(|r| r.accepted))
    {
        return Err("Review the earlier process checkpoints first.".into());
    }
    match review.evidence.as_str() {
        "manual" => {}
        "verification"
            if run
                .verification
                .as_ref()
                .is_some_and(|v| v.tree.as_ref() == Some(&tree) && v.result.success) => {}
        id if id.starts_with("screenshot:")
            && run
                .screenshots
                .iter()
                .any(|s| format!("screenshot:{}", s.id) == id) => {}
        id if id.starts_with("report:")
            && run
                .validation_steps
                .iter()
                .any(|s| format!("report:{}", s.id) == id) => {}
        _ => {
            return Err(
                "Choose recorded evidence. Checks must have passed for the current files.".into(),
            )
        }
    }
    runtime.update_checked(&run.id, |r| {
        r.contract.requirements[index].receipt = Some(OutcomeReceipt {
            accepted: review.accepted,
            evidence: review.evidence,
            note: review.note.trim().into(),
            tree,
            recorded_at: chrono::Utc::now().to_rfc3339(),
        });
        r.status = "review".into();
    })?;
    runtime
        .refresh_knowledge(&run.project_id, &run.project_path, true)
        .map_err(|e| format!("Review saved, but project lessons could not refresh: {e}"))
}

#[tauri::command]
pub async fn task_outcome_review(
    review: OutcomeReview,
    state: State<'_, TaskRuntime>,
) -> Result<(), String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || record(&runtime, review))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn approval_is_bound_to_files_and_cleared_on_continuation() {
        let contract = TaskContract {
            requirements: vec![Requirement {
                id: "a".into(),
                title: "Reset works".into(),
                checkpoint: false,
                receipt: Some(OutcomeReceipt {
                    accepted: true,
                    evidence: "manual".into(),
                    note: "Exercised reset".into(),
                    tree: "before".into(),
                    recorded_at: "now".into(),
                }),
            }],
            ..Default::default()
        };
        assert!(contract.require_accepted("before").is_ok());
        assert!(contract.require_accepted("after").is_err());
        assert!(contract.continuation().require_accepted("before").is_err());
        assert!(TaskContract::default().require_accepted("legacy").is_ok());
    }
    #[test]
    fn workflow_waits_for_accepted_step_and_preserves_prior_stage_evidence() {
        let mut contract = TaskContract {
            requirements: vec![
                Requirement {
                    id: "first".into(),
                    title: "Reproduce".into(),
                    checkpoint: true,
                    receipt: None,
                },
                Requirement {
                    id: "second".into(),
                    title: "Fix and verify".into(),
                    checkpoint: true,
                    receipt: None,
                },
                Requirement {
                    id: "outcome".into(),
                    title: "Regression fixed".into(),
                    checkpoint: false,
                    receipt: None,
                },
            ],
            ..Default::default()
        };
        assert!(contract.advance("before").is_err());
        contract.requirements[0].receipt = Some(OutcomeReceipt {
            accepted: true,
            evidence: "manual".into(),
            note: "Reproduced".into(),
            tree: "before".into(),
            recorded_at: "now".into(),
        });
        assert!(contract.advance("changed").is_err());
        let mut next = contract.advance("before").unwrap();
        assert_eq!(next.step, 1);
        assert!(next.require_accepted("after").is_err());
        assert!(next.continuation().requirements[0].receipt.is_some());
        for index in [1, 2] {
            next.requirements[index].receipt = Some(OutcomeReceipt {
                accepted: true,
                evidence: "manual".into(),
                note: "Passed".into(),
                tree: "after".into(),
                recorded_at: "now".into(),
            });
        }
        assert!(next.require_accepted("after").is_ok());
        assert!(next.require_accepted("later edit").is_err());
        assert!(next.advance("after").is_err());
    }

    #[test]
    fn requirements_are_bounded_and_inputs_are_required() {
        let invalid = ProcessTemplate {
            steps: vec!["same".into(), "same".into()],
            ..Default::default()
        };
        assert!(invalid.validate().is_err());
        let selection = super::super::knowledge::ContextSelection {
            outcomes: vec!["Works".into()],
            ..Default::default()
        };
        let contract = TaskContract::build(&selection, &Default::default()).unwrap();
        assert_eq!(contract.requirements.len(), 1);
        assert!(contract.require_accepted("tree").is_err());
    }
}
