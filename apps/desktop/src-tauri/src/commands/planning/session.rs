//! Plan sessions: the interview run, revisions, approval and hand-off, and
//! reading progress back. Every coordinator call happens outside the plan
//! store's lock.

use super::{
    artifact::{self, PlanDocument},
    handoff, interview,
    store::{Approval, Deviation, Execution, PlanRecord, PlanSettings, Session, Store},
};
use crate::commands::{
    coordination::{managed::PlanLink, planned::PlanLaunch, Coordinator},
    harness::PendingUserPrompt,
    tasks::{RunRequest, TaskRun, WorkspaceMode},
};
use chrono::Utc;
use serde::Serialize;
use uuid::Uuid;

pub fn store(coordinator: &Coordinator) -> Store {
    store_for(&coordinator.runtime)
}

/// The plan store for a task runtime, for callers without a coordinator.
pub fn store_for(runtime: &crate::commands::tasks::TaskRuntime) -> Store {
    Store::new(runtime.integration_directory().with_file_name("plans"))
}

fn active(status: &str) -> bool {
    ["starting", "running", "stopping", "routing", "queued"].contains(&status)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgress {
    pub key: String,
    pub title: String,
    /// `waiting`, `running`, `checked`, `needs-attention`, `merged` or `done`.
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub outside: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub managed_task_id: String,
    pub dispatching: bool,
    pub error: Option<String>,
    pub repairs: usize,
    pub repair_limit: usize,
    pub ready: bool,
    pub merged: bool,
    pub tasks: Vec<TaskProgress>,
    pub review: Option<TaskProgress>,
    pub gaps: Vec<handoff::Gap>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanView {
    pub id: String,
    pub project_id: String,
    pub project_path: String,
    pub title: String,
    pub goal: String,
    pub status: String,
    pub planning: bool,
    pub error: Option<String>,
    pub revision: Option<u32>,
    pub hash: Option<String>,
    pub markdown: Option<String>,
    pub document: Option<PlanDocument>,
    pub revisions: Vec<RevisionSummary>,
    /// Section changes from the previous revision.
    pub changes: Vec<artifact::SectionChange>,
    pub questions: Vec<PendingUserPrompt>,
    pub planner_run_id: Option<String>,
    pub approval: Option<Approval>,
    pub shape: String,
    pub swarm_connected: bool,
    pub progress: Option<Progress>,
    pub criteria: Vec<handoff::CriterionState>,
    pub deviations: Vec<Deviation>,
    /// How approving now would verify the work.
    pub verification: Verification,
    /// The check assembled from the plan's command and test criteria, used
    /// when the project has no saved check.
    pub criteria_check: Option<String>,
}

/// How an approved plan's work is verified.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verification {
    /// `project` (the saved check), `criteria` (the plan's command and test
    /// criteria) or `review` (no automatic check; reviewed, not test-verified).
    pub source: &'static str,
    pub command: Option<String>,
}

/// Picks the check for an approved plan: the project's saved check, else the
/// exact commands of the plan's command and test criteria, else none.
pub fn verification(checks: &PlanChecks, doc: &PlanDocument) -> Verification {
    if let Some(command) = checks
        .verify_command
        .as_deref()
        .map(str::trim)
        .filter(|command| !command.is_empty())
    {
        return Verification {
            source: "project",
            command: Some(command.into()),
        };
    }
    let mut commands: Vec<&str> = vec![];
    for criterion in &doc.criteria {
        let check = criterion.check.trim();
        if matches!(
            criterion.verify,
            artifact::VerifyKind::Command | artifact::VerifyKind::Test
        ) && !check.is_empty()
            && !commands.contains(&check)
        {
            commands.push(check);
        }
    }
    let mut command = String::new();
    for check in commands {
        let next = if command.is_empty() {
            check.to_string()
        } else {
            format!("{command} && {check}")
        };
        if next.len() > CRITERIA_CHECK_LIMIT {
            break;
        }
        command = next;
    }
    if command.is_empty() {
        Verification {
            source: "review",
            command: None,
        }
    } else {
        Verification {
            source: "criteria",
            command: Some(command),
        }
    }
}

/// The longest check assembled from criteria commands.
const CRITERIA_CHECK_LIMIT: usize = 4000;

/// The project's checks as the app last mirrored them to the native registry.
pub fn project_checks(
    runtime: &crate::commands::tasks::TaskRuntime,
    project_id: &str,
) -> PlanChecks {
    crate::commands::project_registry::record(runtime, project_id)
        .map(|project| PlanChecks {
            verify_command: project.verify_command,
            prepare_command: project.prepare_command,
            setup_files: project.setup_files,
        })
        .unwrap_or_default()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionSummary {
    pub number: u32,
    pub author: String,
    pub note: String,
    pub created_at: String,
    pub hash: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSummary {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub status: String,
    pub revision: Option<u32>,
    pub updated_at: String,
    /// A deviation is waiting on the person's decision.
    pub needs_you: bool,
}

pub fn summary(record: &PlanRecord) -> PlanSummary {
    PlanSummary {
        id: record.id.clone(),
        project_id: record.project_id.clone(),
        title: record.title.clone(),
        status: record.status(),
        revision: record.latest().map(|revision| revision.number),
        updated_at: record.updated_at.clone(),
        needs_you: pending_deviation(record).is_some(),
    }
}

/// The oldest deviation still waiting on the person.
pub fn pending_deviation(record: &PlanRecord) -> Option<&Deviation> {
    record
        .deviations
        .iter()
        .find(|deviation| deviation.status == "pending")
}

/// A planning request: read-only, isolated, unchecked and without outcomes.
fn planning_request(template: &RunRequest, settings: &PlanSettings, prompt: String) -> RunRequest {
    let mut request = template.clone();
    request.id = Uuid::new_v4().to_string();
    request.prompt = prompt;
    request.isolated = true;
    request.workspace_mode = Some(WorkspaceMode::Worktree);
    request.auto_verify = false;
    request.verify_command = None;
    request.prepare_command = None;
    request.previous_run_id = None;
    request.retry_of = None;
    request.context_selection.outcomes.clear();
    if let Some(agent) = settings.planner_agent.as_ref().filter(|a| !a.is_empty()) {
        request.agent = agent.clone();
        request.agent_profile_id = None;
        request.model = settings.planner_model.clone();
    }
    request
}

/// Titles, assumptions and surprises from earlier plans in the project.
fn history(store: &Store, project_id: &str) -> String {
    let Ok((plans, _)) = store.list(Some(project_id)) else {
        return String::new();
    };
    let mut text = String::new();
    for doc in plans
        .iter()
        .filter(|plan| ["running", "done"].contains(&plan.status().as_str()))
        .filter_map(PlanRecord::document)
        .take(3)
    {
        let line = format!(
            "- {}. Assumptions: {}. Surprises: {}.\n",
            doc.title,
            doc.assumptions.join("; "),
            doc.surprises.join("; ")
        );
        if text.len() + line.len() > 3000 {
            break;
        }
        text.push_str(&line);
    }
    text
}

pub fn start(
    coordinator: &Coordinator,
    template: RunRequest,
    goal: String,
) -> Result<PlanRecord, String> {
    let goal = goal.trim().to_string();
    if goal.is_empty() || goal.len() > 20_000 {
        return Err("Describe what to plan in up to 20,000 characters.".into());
    }
    let store = store(coordinator);
    let settings = store.settings(&template.project_id);
    let prompt = interview::interview_prompt(
        &goal,
        settings.question_cap,
        &history(&store, &template.project_id),
    );
    let request = planning_request(&template, &settings, prompt);
    let now = Utc::now().to_rfc3339();
    let record = PlanRecord {
        id: Uuid::new_v4().to_string(),
        project_id: template.project_id.clone(),
        project_name: template.project_name.clone(),
        project_path: template.project_path.clone(),
        title: goal
            .lines()
            .next()
            .unwrap_or("Plan")
            .chars()
            .take(80)
            .collect(),
        goal,
        created_at: now.clone(),
        updated_at: now,
        request: template,
        session: Session {
            run_ids: vec![request.id.clone()],
            ingested: vec![],
            question_cap: settings.question_cap,
            asked_before: 0,
        },
        revisions: vec![],
        approval: None,
        execution: None,
        deviations: vec![],
        error: None,
        reflected: false,
        archived: false,
    };
    store.create(&record)?;
    super::register_run(&request.id, &record.id, settings.question_cap, 0);
    if let Err(error) = coordinator.start_manual(request) {
        let (record, _) = store.update(&record.id, |saved| {
            saved.error = Some(error.clone());
            Ok(())
        })?;
        return Ok(record);
    }
    Ok(record)
}

/// A plan the person wrote: tasks with their instructions and the outcomes
/// each must meet.
#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualPlan {
    pub goal: String,
    pub tasks: Vec<ManualTask>,
}

#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualTask {
    pub title: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub scopes: Vec<String>,
    /// Indexes of earlier tasks in `tasks`.
    #[serde(default)]
    pub depends_on: Vec<usize>,
    #[serde(default)]
    pub outcomes: Vec<String>,
}

/// The plan document for a written plan: each task becomes a plan task and
/// each outcome a manual acceptance criterion the task covers. A plan without
/// outcomes gets one criterion from its goal, covered by every task.
pub fn manual_document(plan: &ManualPlan) -> Result<PlanDocument, String> {
    let goal = plan.goal.trim();
    if goal.is_empty() || goal.len() > 20_000 {
        return Err("Describe what the plan should accomplish in up to 20,000 characters.".into());
    }
    let title: String = goal
        .lines()
        .next()
        .unwrap_or("Plan")
        .trim()
        .chars()
        .take(160)
        .collect();
    let mut doc = PlanDocument {
        title,
        goal: goal.into(),
        ..Default::default()
    };
    for (index, task) in plan.tasks.iter().enumerate() {
        let key = format!("task-{}", index + 1);
        let mut covers = vec![];
        for outcome in task
            .outcomes
            .iter()
            .map(|o| o.trim())
            .filter(|o| !o.is_empty())
        {
            let id = format!("AC-{}", doc.criteria.len() + 1);
            doc.criteria.push(artifact::Criterion {
                id: id.clone(),
                verify: artifact::VerifyKind::Manual,
                check: String::new(),
                text: outcome.replace('\n', " "),
            });
            covers.push(id);
        }
        let mut scopes: Vec<String> = task
            .scopes
            .iter()
            .map(|scope| scope.trim().to_string())
            .filter(|scope| !scope.is_empty())
            .collect();
        if scopes.is_empty() {
            scopes.push(".".into());
        }
        let depends_on = task
            .depends_on
            .iter()
            .map(|earlier| {
                if *earlier >= plan.tasks.len() || *earlier == index {
                    Err(format!(
                        "Task {} depends on a task that is not in the plan.",
                        index + 1
                    ))
                } else {
                    Ok(format!("task-{}", earlier + 1))
                }
            })
            .collect::<Result<Vec<_>, _>>()?;
        doc.tasks.push(artifact::PlanTask {
            key,
            title: task.title.trim().replace('\n', " "),
            scopes,
            depends_on,
            parallel: false,
            covers,
            briefing: task.instructions.trim().into(),
            status: String::new(),
        });
    }
    if let Some(task) = doc.tasks.iter().find(|task| task.title.is_empty()) {
        return Err(format!(
            "Give {} a title.",
            task.key.replace("task-", "task ")
        ));
    }
    if doc.criteria.is_empty() {
        doc.criteria.push(artifact::Criterion {
            id: "AC-1".into(),
            verify: artifact::VerifyKind::Manual,
            check: String::new(),
            text: doc.title.chars().take(480).collect(),
        });
        for task in &mut doc.tasks {
            task.covers.push("AC-1".into());
        }
    }
    doc.front.status = "draft".into();
    doc.validate()?;
    Ok(doc)
}

/// Saves a plan the person wrote as revision 1, ready for review and
/// approval like any drafted plan. No planner runs.
pub fn create_manual(
    coordinator: &Coordinator,
    template: RunRequest,
    plan: ManualPlan,
) -> Result<PlanRecord, String> {
    let doc = manual_document(&plan)?;
    let store = store(coordinator);
    let settings = store.settings(&template.project_id);
    let now = Utc::now().to_rfc3339();
    let mut record = PlanRecord {
        id: Uuid::new_v4().to_string(),
        project_id: template.project_id.clone(),
        project_name: template.project_name.clone(),
        project_path: template.project_path.clone(),
        title: doc.title.clone(),
        goal: plan.goal.trim().into(),
        created_at: now.clone(),
        updated_at: now,
        request: template,
        session: Session {
            question_cap: settings.question_cap,
            ..Default::default()
        },
        revisions: vec![],
        approval: None,
        execution: None,
        deviations: vec![],
        error: None,
        reflected: false,
        archived: false,
    };
    record.push_revision(doc, "you", "Written by you", None)?;
    store.create(&record)?;
    Ok(record)
}

fn planning_run<'a>(record: &PlanRecord, runs: &'a [TaskRun]) -> Option<&'a TaskRun> {
    let id = record.session.run_ids.last()?;
    runs.iter().find(|run| &run.id == id)
}

fn questions_asked(record: &PlanRecord, runs: &[TaskRun]) -> usize {
    runs.iter()
        .filter(|run| record.session.run_ids.contains(&run.id))
        .map(|run| run.prompts.len())
        .sum()
}

/// Reads finished planning attempts into revisions, notes failures, and
/// re-registers live attempts after a restart.
fn ingest(store: &Store, record: &PlanRecord, runs: &[TaskRun]) -> Result<PlanRecord, String> {
    let pending: Vec<&TaskRun> = runs
        .iter()
        .filter(|run| {
            record.session.run_ids.contains(&run.id) && !record.session.ingested.contains(&run.id)
        })
        .collect();
    for run in &pending {
        if active(&run.status) || run.finishing {
            super::register_run(
                &run.id,
                &record.id,
                record.session.question_cap,
                record.session.asked_before,
            );
        }
    }
    let finished: Vec<&TaskRun> = pending
        .into_iter()
        .filter(|run| !active(&run.status) && !run.finishing)
        .collect();
    if finished.is_empty() {
        return Ok(record.clone());
    }
    let (record, _) = store.update(&record.id, |saved| {
        for run in finished {
            saved.session.ingested.push(run.id.clone());
            if !matches!(run.status.as_str(), "review" | "reviewed") || run.error.is_some() {
                saved.error = Some(format!(
                    "Planning ended without a plan ({}). Keep planning to try again.",
                    run.error.as_deref().unwrap_or(&run.status)
                ));
                continue;
            }
            match artifact::parse(&run.result).and_then(|mut doc| {
                doc.front.status = "draft".into();
                doc.front.source_head = run.base_head.clone();
                doc.front.approved_by.clear();
                doc.front.approved_at.clear();
                doc.front.shape.clear();
                let note = if saved.revisions.is_empty() {
                    "First draft"
                } else {
                    "Revised by the planner"
                };
                saved.push_revision(doc, "planner", note, Some(run.id.clone()))
            }) {
                Ok(_) => saved.error = None,
                Err(error) => {
                    saved.error = Some(format!(
                        "The planner's answer is not a complete plan: {error} Keep planning to ask for a corrected plan."
                    ))
                }
            }
        }
        Ok(())
    })?;
    Ok(record)
}

/// Updates the latest revision's front matter in place; the content hash,
/// which excludes front matter, is unchanged.
fn set_front(
    record: &mut PlanRecord,
    change: impl FnOnce(&mut artifact::FrontMatter),
) -> Result<(), String> {
    let revision = record
        .revisions
        .last_mut()
        .ok_or("This plan has no revision yet.")?;
    let mut doc = artifact::parse(&revision.markdown)?;
    change(&mut doc.front);
    revision.markdown = doc.render();
    Ok(())
}

fn task_state(run: Option<&TaskRun>, merged: bool, error: bool) -> &'static str {
    match run {
        _ if merged => "merged",
        _ if error => "needs-attention",
        None => "waiting",
        Some(run) if active(&run.status) || run.finishing => "running",
        Some(run)
            if matches!(run.status.as_str(), "review" | "reviewed")
                && run.error.is_none()
                && run
                    .verification
                    .as_ref()
                    .is_none_or(|check| check.result.success) =>
        {
            "checked"
        }
        Some(_) => "needs-attention",
    }
}

fn progress(
    coordinator: &Coordinator,
    record: &PlanRecord,
    doc: &PlanDocument,
    runs: &[TaskRun],
) -> Option<(Progress, Vec<handoff::Evidence>)> {
    let execution = record.execution.as_ref()?;
    let id = execution.managed_task_id.as_ref()?;
    let delivery = coordinator.plan_delivery(id).ok()?;
    let merged = delivery.applied_at.is_some();
    let mut evidence = vec![];
    let mut tasks = vec![];
    let mut review = None;
    let mut gaps = vec![];
    for item in &delivery.items {
        let run = item
            .run_id
            .as_ref()
            .and_then(|id| runs.iter().find(|run| &run.id == id));
        if let Some(run) = run {
            evidence.push(handoff::Evidence {
                steps: run.validation_steps.clone(),
                requirements: run
                    .contract
                    .requirements
                    .iter()
                    .map(|requirement| {
                        (
                            requirement.id.clone(),
                            requirement.title.clone(),
                            requirement
                                .receipt
                                .as_ref()
                                .is_some_and(|receipt| receipt.accepted),
                        )
                    })
                    .collect(),
            });
        }
        let key = if item.review {
            "review".to_string()
        } else if execution.shape == "single" {
            "plan".to_string()
        } else {
            doc.tasks
                .iter()
                .find(|task| task.title.chars().take(160).collect::<String>() == item.title)
                .map(|task| task.key.clone())
                .unwrap_or_else(|| item.title.clone())
        };
        let entry = TaskProgress {
            key,
            title: item.title.clone(),
            state: task_state(run, merged, item.error.is_some() || item.canceled).into(),
            run_id: item.run_id.clone(),
            outside: item.outside.clone(),
        };
        if item.review {
            if let Some((_, found)) = run.and_then(|run| handoff::review(&run.validation_steps)) {
                gaps = found;
            }
            review = Some(entry);
        } else {
            tasks.push(entry);
        }
    }
    Some((
        Progress {
            managed_task_id: id.clone(),
            dispatching: delivery.dispatching,
            error: delivery.error,
            repairs: delivery.repairs,
            repair_limit: delivery.repair_limit,
            ready: delivery.ready_at.is_some(),
            merged,
            tasks,
            review,
            gaps,
        },
        evidence,
    ))
}

/// Deviations Jackalope detects on its own: files outside a task's scope and
/// a combined result that still fails after the allowed repairs.
fn detected(progress: &Progress) -> Vec<(String, String)> {
    let mut found = vec![];
    for task in &progress.tasks {
        if !task.outside.is_empty() {
            found.push((
                "scope".to_string(),
                format!(
                    "Task {} changed files outside its scope: {}",
                    task.key,
                    task.outside.join(", ")
                ),
            ));
        }
    }
    if let Some(error) = &progress.error {
        if progress.repairs >= progress.repair_limit && progress.repair_limit > 0 {
            found.push(("criterion".to_string(), error.clone()));
        }
    }
    found
}

pub fn view(coordinator: &Coordinator, id: &str) -> Result<PlanView, String> {
    let store = store(coordinator);
    let runs = coordinator.runtime.integration_runs()?;
    let mut record = ingest(&store, &store.load(id)?, &runs)?;
    let doc = record.document();
    let planner = planning_run(&record, &runs);
    let planning = planner.is_some_and(|run| active(&run.status) || run.finishing);
    let mut progress_view = None;
    let mut criteria = vec![];
    if let Some(doc) = &doc {
        if let Some((progress, evidence)) = progress(coordinator, &record, doc, &runs) {
            criteria = handoff::criterion_states(doc, &evidence);
            let found: Vec<_> = detected(&progress)
                .into_iter()
                .filter(|(_, summary)| {
                    !record
                        .deviations
                        .iter()
                        .any(|deviation| &deviation.summary == summary)
                })
                .collect();
            let finished = progress.merged && doc.front.status != "done";
            if !found.is_empty() || finished {
                record = store
                    .update(id, |saved| {
                        for (kind, summary) in &found {
                            let deviation = Uuid::new_v4().to_string();
                            crate::commands::notifications::plan_decision_needed(
                                &saved.id, &deviation,
                            );
                            saved.deviations.push(Deviation {
                                id: deviation,
                                run_id: None,
                                kind: kind.clone(),
                                summary: summary.clone(),
                                amendment: String::new(),
                                status: "pending".into(),
                                created_at: Utc::now().to_rfc3339(),
                                resolved_at: None,
                            });
                        }
                        if finished {
                            set_front(saved, |front| front.status = "done".into())?;
                        }
                        Ok(())
                    })?
                    .0;
                if finished {
                    super::learning::reflect(coordinator, &store, &record, doc, &criteria);
                }
            }
            progress_view = Some(progress);
        } else {
            criteria = handoff::criterion_states(doc, &[]);
        }
    }
    let doc = record.document();
    let latest = record.latest();
    let previous = record
        .revisions
        .len()
        .checked_sub(2)
        .and_then(|index| record.revisions.get(index));
    Ok(PlanView {
        id: record.id.clone(),
        project_id: record.project_id.clone(),
        project_path: record.project_path.clone(),
        title: record.title.clone(),
        goal: record.goal.clone(),
        status: if planning {
            "planning".into()
        } else {
            record.status()
        },
        planning,
        error: record.error.clone(),
        revision: latest.map(|revision| revision.number),
        hash: latest.map(|revision| revision.hash.clone()),
        markdown: latest.map(|revision| revision.markdown.clone()),
        changes: match (previous, latest) {
            (Some(before), Some(after)) => artifact::diff(&before.markdown, &after.markdown),
            _ => vec![],
        },
        revisions: record
            .revisions
            .iter()
            .map(|revision| RevisionSummary {
                number: revision.number,
                author: revision.author.clone(),
                note: revision.note.clone(),
                created_at: revision.created_at.clone(),
                hash: revision.hash.clone(),
            })
            .collect(),
        questions: planner
            .filter(|_| planning)
            .map(|run| {
                run.prompts
                    .iter()
                    .filter(|prompt| prompt.status == "pending")
                    .cloned()
                    .collect()
            })
            .unwrap_or_default(),
        planner_run_id: planner.map(|run| run.id.clone()),
        approval: record.approval.clone(),
        shape: doc
            .as_ref()
            .map(|doc| handoff::default_shape(doc, coordinator.swarm_connected()).to_string())
            .unwrap_or_else(|| "single".into()),
        swarm_connected: coordinator.swarm_connected(),
        progress: progress_view,
        criteria,
        deviations: record.deviations.clone(),
        criteria_check: doc
            .as_ref()
            .and_then(|doc| verification(&PlanChecks::default(), doc).command),
        verification: match &doc {
            Some(doc) => verification(
                &project_checks(&coordinator.runtime, &record.project_id),
                doc,
            ),
            None => Verification {
                source: "review",
                command: None,
            },
        },
        document: doc,
    })
}

fn guard_idle(record: &PlanRecord, runs: &[TaskRun]) -> Result<(), String> {
    if planning_run(record, runs).is_some_and(|run| active(&run.status) || run.finishing) {
        return Err(
            "The planner is still working. Answer its question or wait for the draft.".into(),
        );
    }
    Ok(())
}

/// Continues the planning conversation with `prompt`.
fn continue_planning(
    coordinator: &Coordinator,
    store: &Store,
    record: &PlanRecord,
    runs: &[TaskRun],
    prompt: String,
) -> Result<(), String> {
    let settings = store.settings(&record.project_id);
    let mut request = planning_request(&record.request, &settings, prompt);
    if let Some(previous) = planning_run(record, runs).filter(|run| run.session_id.is_some()) {
        request.previous_run_id = Some(previous.id.clone());
        request.agent = previous.agent.clone();
        request.model = previous.model.clone();
    }
    let asked = questions_asked(record, runs);
    let cap = record.session.question_cap;
    store.update(&record.id, |saved| {
        saved.session.run_ids.push(request.id.clone());
        saved.session.asked_before = asked;
        saved.error = None;
        Ok(())
    })?;
    super::register_run(&request.id, &record.id, cap, asked);
    if let Err(error) = coordinator.start_manual(request) {
        store.update(&record.id, |saved| {
            saved.error = Some(error.clone());
            Ok(())
        })?;
        return Err(error);
    }
    Ok(())
}

pub fn keep_planning(coordinator: &Coordinator, id: &str, comments: &str) -> Result<(), String> {
    let comments = comments.trim();
    if comments.is_empty() || comments.len() > 8000 {
        return Err("Add comments for the planner, up to 8,000 characters.".into());
    }
    let store = store(coordinator);
    let runs = coordinator.runtime.integration_runs()?;
    let record = ingest(&store, &store.load(id)?, &runs)?;
    guard_idle(&record, &runs)?;
    let prompt = match record.document() {
        Some(doc) if ["running", "done"].contains(&doc.front.status.as_str()) => {
            return Err("This plan is running. Use Re-plan to revise what is left.".into())
        }
        Some(doc) => interview::revision_prompt(&doc, comments),
        None => format!(
            "{}\n\nComments from the person:\n{comments}",
            interview::interview_prompt(&record.goal, record.session.question_cap, "")
        ),
    };
    continue_planning(coordinator, &store, &record, &runs, prompt)
}

pub fn save_edit(
    coordinator: &Coordinator,
    id: &str,
    markdown: &str,
    base_revision: u32,
) -> Result<u32, String> {
    let store = store(coordinator);
    let runs = coordinator.runtime.integration_runs()?;
    let record = store.load(id)?;
    guard_idle(&record, &runs)?;
    let mut doc = artifact::parse(markdown)?;
    doc.validate()?;
    let (_, number) = store.update(id, |saved| {
        if saved.latest().map(|revision| revision.number) != Some(base_revision) {
            return Err("The plan changed while you edited it. Reopen the latest revision.".into());
        }
        let current = saved.status();
        if current == "running" || current == "done" {
            return Err("This plan is running. Use Re-plan to revise what is left.".into());
        }
        doc.front.status = "draft".into();
        doc.front.approved_by.clear();
        doc.front.approved_at.clear();
        doc.front.shape.clear();
        saved.approval = None;
        saved.push_revision(doc, "you", "Edited directly", None)
    })?;
    Ok(number)
}

fn approver(record: &PlanRecord, surface: &str) -> String {
    let name = crate::commands::tasks::git(&record.project_path, &["config", "user.name"])
        .ok()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "local user".into());
    format!("{name} ({surface})")
}

/// The project's checks at approval time. The app sends its current project
/// settings; the terminal uses the copy the app mirrors to the native project
/// registry.
#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanChecks {
    #[serde(default)]
    pub verify_command: Option<String>,
    #[serde(default)]
    pub prepare_command: Option<String>,
    #[serde(default)]
    pub setup_files: Vec<String>,
}

/// Approval is always an explicit call naming the exact revision and hash
/// shown to the person; nothing else, including elapsed time, approves.
pub fn approve(
    coordinator: &Coordinator,
    id: &str,
    revision: u32,
    hash: &str,
    shape: &str,
    surface: &str,
    checks: Option<PlanChecks>,
) -> Result<(), String> {
    if !["single", "subtasks", "swarm"].contains(&shape) {
        return Err("Choose single, subtasks or swarm.".into());
    }
    if !["app", "terminal"].contains(&surface) {
        return Err("Unknown approval surface.".into());
    }
    let store = store(coordinator);
    let runs = coordinator.runtime.integration_runs()?;
    let record = ingest(&store, &store.load(id)?, &runs)?;
    guard_idle(&record, &runs)?;
    let latest = record.latest().ok_or("There is no plan to approve yet.")?;
    if latest.number != revision || latest.hash != hash {
        return Err("The plan changed. Review the latest revision before approving.".into());
    }
    let doc = record.document().ok_or("The plan could not be read.")?;
    doc.validate()?;
    if doc.front.status == "done" {
        return Err("This plan is done.".into());
    }
    let checks = checks.unwrap_or_else(|| project_checks(&coordinator.runtime, &record.project_id));
    // Without any check the work is reviewed but not test-verified: staged
    // dependencies continue from clean finishes and integration waits for a
    // passing plan review.
    let verified = verification(&checks, &doc);
    if shape == "swarm" && !coordinator.swarm_connected() {
        return Err("Connect a swarm Worker in Settings before running as a swarm.".into());
    }
    if let Some(previous) = record
        .execution
        .as_ref()
        .and_then(|execution| execution.managed_task_id.as_ref())
    {
        let delivery = coordinator.plan_delivery(previous)?;
        if delivery.items.iter().any(|item| {
            item.run_id
                .as_ref()
                .and_then(|id| runs.iter().find(|run| &run.id == id))
                .is_some_and(|run| active(&run.status) || run.finishing)
        }) {
            return Err("Earlier tasks of this plan are still running. Let them finish or stop them before approving the new revision.".into());
        }
    }
    let assignments = handoff::assignments(&doc, shape)?;
    let source_head = crate::commands::task_strategy::source_head(&record.request)?;
    let approved_by = approver(&record, surface);
    let approved_at = Utc::now().to_rfc3339();
    let mut request = record.request.clone();
    request.id = Uuid::new_v4().to_string();
    request.prompt = interview::execution_brief(&doc);
    request.previous_run_id = None;
    request.retry_of = None;
    request.isolated = true;
    request.workspace_mode = Some(WorkspaceMode::Worktree);
    request.context_selection.outcomes.clear();
    request.auto_verify = verified.command.is_some();
    request.verify_command = verified.command.clone();
    request.prepare_command = checks.prepare_command;
    request.setup_files = checks.setup_files;
    let planner_agent = planning_run(&record, &runs).map(|run| run.agent.clone());
    let link = PlanLink {
        plan_id: record.id.clone(),
        revision,
        assignments,
        reviewer_agent: planner_agent.filter(|agent| agent != &request.agent),
        review_brief: interview::review_brief(&doc),
    };
    store.update(id, |saved| {
        saved.approval = Some(Approval {
            revision,
            hash: hash.into(),
            source_head: source_head.clone(),
            approved_by: approved_by.clone(),
            approved_at: approved_at.clone(),
            shape: shape.into(),
            verification: verified.source.into(),
        });
        set_front(saved, |front| {
            front.status = "approved".into();
            front.approved_by = approved_by.clone();
            front.approved_at = approved_at.clone();
            front.shape = shape.into();
            front.source_head = source_head.clone();
        })
    })?;
    if let Some(previous) = record
        .execution
        .as_ref()
        .and_then(|execution| execution.managed_task_id.clone())
    {
        let _ = coordinator.plan_dispatch(&previous, "pause");
    }
    let launched = coordinator.launch_plan(PlanLaunch {
        request,
        title: doc.title.clone(),
        link,
    });
    store.update(id, |saved| {
        match &launched {
            Ok(managed) => {
                saved.execution = Some(Execution {
                    shape: shape.into(),
                    revision,
                    managed_task_id: Some(managed.clone()),
                    items: vec![],
                    started_at: Utc::now().to_rfc3339(),
                });
                saved.error = None;
                set_front(saved, |front| front.status = "running".into())?;
            }
            Err(error) => saved.error = Some(format!("Approved, but work did not start: {error}")),
        }
        Ok(())
    })?;
    launched.map(|_| ())
}

pub fn replan(coordinator: &Coordinator, id: &str, comments: &str) -> Result<(), String> {
    let comments = comments.trim();
    if comments.len() > 8000 {
        return Err("Keep re-plan notes under 8,000 characters.".into());
    }
    let store = store(coordinator);
    let runs = coordinator.runtime.integration_runs()?;
    let record = ingest(&store, &store.load(id)?, &runs)?;
    guard_idle(&record, &runs)?;
    let doc = record.document().ok_or("There is no plan to revise yet.")?;
    let done = progress(coordinator, &record, &doc, &runs)
        .map(|(progress, _)| {
            progress
                .tasks
                .iter()
                .filter(|task| ["checked", "merged"].contains(&task.state.as_str()))
                .map(|task| format!("- {} ({})", task.key, task.state))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "- Nothing has finished yet.".into());
    let reason = if comments.is_empty() {
        "The person asked to re-plan."
    } else {
        comments
    };
    continue_planning(
        coordinator,
        &store,
        &record,
        &runs,
        interview::replan_prompt(&doc, &done, reason),
    )
}

/// Records a deviation an agent declared and pauses the plan's dependent work.
pub fn declare_deviation(
    coordinator: &Coordinator,
    run: &TaskRun,
    summary: &str,
    amendment: &str,
) -> Result<String, String> {
    let summary = summary.trim();
    if summary.is_empty() || summary.len() > 2000 || amendment.len() > 4000 {
        return Err(
            "Describe the deviation in up to 2,000 characters and the amendment in up to 4,000."
                .into(),
        );
    }
    let (plan_id, managed) = coordinator
        .plan_of_run(&run.id)
        .ok_or("This attempt is not working on an approved plan.")?;
    let store = store(coordinator);
    let (_, deviation) = store.update(&plan_id, |saved| {
        if saved
            .deviations
            .iter()
            .filter(|deviation| deviation.run_id.as_ref() == Some(&run.id))
            .count()
            >= 5
        {
            return Err("This attempt already reported five deviations.".into());
        }
        let deviation = Uuid::new_v4().to_string();
        saved.deviations.push(Deviation {
            id: deviation.clone(),
            run_id: Some(run.id.clone()),
            kind: "declared".into(),
            summary: summary.into(),
            amendment: amendment.trim().into(),
            status: "pending".into(),
            created_at: Utc::now().to_rfc3339(),
            resolved_at: None,
        });
        Ok(deviation)
    })?;
    crate::commands::notifications::plan_decision_needed(&plan_id, &deviation);
    coordinator.plan_dispatch(&managed, "pause")?;
    Ok(deviation)
}

pub fn resolve_deviation(
    coordinator: &Coordinator,
    id: &str,
    deviation_id: &str,
    action: &str,
    surface: &str,
) -> Result<(), String> {
    let store = store(coordinator);
    let record = store.load(id)?;
    let deviation = record
        .deviations
        .iter()
        .find(|deviation| deviation.id == deviation_id && deviation.status == "pending")
        .cloned()
        .ok_or("That deviation is already resolved.")?;
    let managed = record
        .execution
        .as_ref()
        .and_then(|execution| execution.managed_task_id.clone());
    match action {
        "accept" => {
            let surface = approver(&record, surface);
            store.update(id, |saved| {
                let mut doc = saved.document().ok_or("The plan could not be read.")?;
                doc.decision_log.push(format!(
                    "Accepted deviation: {}{}",
                    deviation.summary,
                    if deviation.amendment.is_empty() {
                        String::new()
                    } else {
                        format!(" Amendment: {}", deviation.amendment)
                    }
                ));
                doc.surprises.push(deviation.summary.clone());
                let number = saved.push_revision(doc, "amendment", "Accepted a deviation", None)?;
                let hash = saved.latest().unwrap().hash.clone();
                if let Some(approval) = &mut saved.approval {
                    approval.revision = number;
                    approval.hash = hash;
                    approval.approved_by = surface.clone();
                    approval.approved_at = Utc::now().to_rfc3339();
                }
                mark(saved, deviation_id, "accepted");
                Ok(())
            })?;
            if let Some(managed) = managed {
                coordinator.plan_dispatch(&managed, "resume")?;
            }
        }
        "redo" => {
            store.update(id, |saved| {
                mark(saved, deviation_id, "redo");
                Ok(())
            })?;
            if let Some(run_id) = &deviation.run_id {
                let runs = coordinator.runtime.integration_runs()?;
                if let Some(run) = runs
                    .iter()
                    .find(|run| &run.id == run_id)
                    .filter(|run| !active(&run.status) && !run.finishing)
                {
                    let mut request = record.request.clone();
                    request.id = Uuid::new_v4().to_string();
                    request.previous_run_id = Some(run.id.clone());
                    request.agent = run.agent.clone();
                    request.model = run.model.clone();
                    request.prompt = format!("The person did not accept this deviation from the approved plan: {}\nReturn to the plan as written and redo the affected work. Do not edit the plan.", deviation.summary);
                    coordinator.start_manual(request)?;
                }
            }
            if let Some(managed) = managed {
                coordinator.plan_dispatch(&managed, "resume")?;
            }
        }
        "replan" => {
            store.update(id, |saved| {
                mark(saved, deviation_id, "replan");
                Ok(())
            })?;
            replan(coordinator, id, &deviation.summary)?;
        }
        _ => return Err("Choose accept, redo or replan.".into()),
    }
    Ok(())
}

fn mark(record: &mut PlanRecord, deviation_id: &str, status: &str) {
    if let Some(deviation) = record
        .deviations
        .iter_mut()
        .find(|deviation| deviation.id == deviation_id)
    {
        deviation.status = status.into();
        deviation.resolved_at = Some(Utc::now().to_rfc3339());
    }
}

pub fn export(coordinator: &Coordinator, id: &str, path: Option<String>) -> Result<String, String> {
    let store = store(coordinator);
    let record = store.load(id)?;
    let template = path
        .filter(|path| !path.trim().is_empty())
        .unwrap_or_else(|| store.settings(&record.project_id).export_path);
    let written = super::store::export(&record, &template)?;
    Ok(written.to_string_lossy().replace('\\', "/"))
}
