//! Plan mode: an explicit, read-only planning interview that produces one
//! self-contained plan document, an approval gate, and hand-off to a single
//! agent, planned subtasks or a swarm through the managed-task queue.

pub mod artifact;
pub mod cli;
#[cfg(test)]
mod fixture_tests;
pub mod handoff;
pub mod interview;
mod learning;
pub mod session;
pub mod store;
#[cfg(test)]
mod tests;

use super::{
    coordination::Coordinator,
    harness::AskUserInput,
    tasks::{RunRequest, TaskRun},
};
use axum::{
    extract::State as WebState,
    http::{HeaderMap, StatusCode},
    Json,
};
use rmcp::schemars;
use serde::Deserialize;
use std::{collections::HashMap, sync::Mutex};
use tauri::State;

#[derive(Clone, Debug, PartialEq)]
struct PlanningRun {
    plan_id: String,
    cap: usize,
    /// Questions forwarded in earlier attempts of the same plan.
    asked_before: usize,
}

static RUNS: Mutex<Option<HashMap<String, PlanningRun>>> = Mutex::new(None);

pub(super) fn register_run(run_id: &str, plan_id: &str, cap: usize, asked_before: usize) {
    if let Ok(mut runs) = RUNS.lock() {
        runs.get_or_insert_with(HashMap::new).insert(
            run_id.into(),
            PlanningRun {
                plan_id: plan_id.into(),
                cap,
                asked_before,
            },
        );
    }
}

fn planning_run(run_id: &str) -> Option<PlanningRun> {
    RUNS.lock().ok()?.as_ref()?.get(run_id).cloned()
}

/// Planning attempts explore without editing; adapters that can enforce it do.
pub fn read_only(run_id: &str) -> bool {
    planning_run(run_id).is_some()
}

/// Applies the interview limits to a question from a planning attempt. Returns
/// the reply the planner gets instead when the question must not be asked:
/// `closed` once the interview is over, `not_asked` for a question that does
/// not say why checking cannot answer it. Otherwise adds the options that let
/// the person end the interview.
pub(super) fn question_gate(run: &TaskRun, input: &mut AskUserInput) -> Option<serde_json::Value> {
    let planning = planning_run(&run.id)?;
    let answers: Vec<String> = run
        .prompts
        .iter()
        .filter_map(|prompt| prompt.answer.clone())
        .collect();
    let asked = planning.asked_before + run.prompts.len();
    match interview::gate(asked, planning.cap, &answers) {
        interview::Gate::Closed(reason) => {
            Some(serde_json::json!({"status": "closed", "message": reason}))
        }
        interview::Gate::Ask
            if input
                .presentation
                .why_ask
                .as_deref()
                .is_none_or(|why| why.trim().is_empty()) =>
        {
            Some(serde_json::json!({"status": "not_asked", "message": interview::NEEDS_WHY_ASK}))
        }
        interview::Gate::Ask => {
            if !input.options.is_empty() && !input.presentation.multi_select {
                for stop in [interview::USE_RECOMMENDATIONS, interview::DONE] {
                    if !input.options.iter().any(|option| option == stop) {
                        input.options.push(stop.into());
                    }
                }
                if input.input_type == "text" {
                    input.input_type = "choice".into();
                }
            }
            None
        }
    }
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeviationInput {
    #[schemars(
        description = "What you must do differently from the approved plan and why, up to 2,000 characters"
    )]
    pub summary: String,
    #[schemars(
        description = "Optional proposed amendment to the plan text, up to 4,000 characters"
    )]
    #[serde(default)]
    pub amendment: String,
}

/// POST /v1/plan-deviation: an agent working on an approved plan reports a
/// material departure. Agents never edit the plan; the person decides.
pub(in crate::commands) async fn bridge_plan_deviation(
    WebState(service): WebState<Coordinator>,
    headers: HeaderMap,
    Json(input): Json<DeviationInput>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let run = service
        .authorized_run(&headers)
        .map_err(|status| (status, "Unauthorized".into()))?;
    let worker = service.clone();
    let deviation = tauri::async_runtime::spawn_blocking(move || {
        session::declare_deviation(&worker, &run, &input.summary, &input.amendment)
    })
    .await
    .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
    .map_err(|error| (StatusCode::BAD_REQUEST, error))?;
    Ok(Json(serde_json::json!({
        "deviationId": deviation,
        "status": "pending",
        "message": "Recorded. Work that depends on this plan is paused until the person accepts the amendment, asks for a redo or re-plans. Finish only work the deviation does not affect, then end with a report; do not edit the plan."
    })))
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanList {
    pub plans: Vec<session::PlanSummary>,
    /// Plans that could not be read; their files were quarantined.
    pub problems: Vec<String>,
}

pub fn list(coordinator: &Coordinator, project_id: Option<&str>) -> Result<PlanList, String> {
    let (plans, problems) = session::store(coordinator).list(project_id)?;
    Ok(PlanList {
        plans: plans
            .iter()
            .filter(|plan| !plan.archived)
            .map(session::summary)
            .collect(),
        problems,
    })
}

#[tauri::command]
pub async fn plan_list(
    project_id: Option<String>,
    state: State<'_, Coordinator>,
) -> Result<PlanList, String> {
    let service = state.inner().clone();
    blocking(move || list(&service, project_id.as_deref())).await
}

#[tauri::command]
pub async fn plan_get(
    id: String,
    state: State<'_, Coordinator>,
) -> Result<session::PlanView, String> {
    let service = state.inner().clone();
    blocking(move || session::view(&service, &id)).await
}

#[tauri::command]
pub async fn plan_start(
    request: RunRequest,
    goal: String,
    state: State<'_, Coordinator>,
) -> Result<session::PlanView, String> {
    let service = state.inner().clone();
    blocking(move || {
        let record = session::start(&service, request, goal)?;
        session::view(&service, &record.id)
    })
    .await
}

/// Saves a plan the person wrote as a draft to review and approve.
#[tauri::command]
pub async fn plan_create(
    request: RunRequest,
    plan: session::ManualPlan,
    state: State<'_, Coordinator>,
) -> Result<session::PlanView, String> {
    let service = state.inner().clone();
    blocking(move || {
        let record = session::create_manual(&service, request, plan)?;
        session::view(&service, &record.id)
    })
    .await
}

#[tauri::command]
pub async fn plan_keep_planning(
    id: String,
    comments: String,
    state: State<'_, Coordinator>,
) -> Result<(), String> {
    let service = state.inner().clone();
    blocking(move || session::keep_planning(&service, &id, &comments)).await
}

#[tauri::command]
pub async fn plan_save(
    id: String,
    markdown: String,
    base_revision: u32,
    state: State<'_, Coordinator>,
) -> Result<u32, String> {
    let service = state.inner().clone();
    blocking(move || session::save_edit(&service, &id, &markdown, base_revision)).await
}

#[tauri::command]
pub async fn plan_approve(
    id: String,
    revision: u32,
    hash: String,
    shape: String,
    checks: Option<session::PlanChecks>,
    state: State<'_, Coordinator>,
) -> Result<(), String> {
    let service = state.inner().clone();
    blocking(move || session::approve(&service, &id, revision, &hash, &shape, "app", checks)).await
}

#[tauri::command]
pub async fn plan_replan(
    id: String,
    comments: String,
    state: State<'_, Coordinator>,
) -> Result<(), String> {
    let service = state.inner().clone();
    blocking(move || session::replan(&service, &id, &comments)).await
}

#[tauri::command]
pub async fn plan_resolve_deviation(
    id: String,
    deviation_id: String,
    action: String,
    state: State<'_, Coordinator>,
) -> Result<(), String> {
    let service = state.inner().clone();
    blocking(move || session::resolve_deviation(&service, &id, &deviation_id, &action, "app")).await
}

#[tauri::command]
pub async fn plan_export(
    id: String,
    path: Option<String>,
    state: State<'_, Coordinator>,
) -> Result<String, String> {
    let service = state.inner().clone();
    blocking(move || session::export(&service, &id, path)).await
}

#[tauri::command]
pub async fn plan_diff(
    id: String,
    from: u32,
    to: u32,
    state: State<'_, Coordinator>,
) -> Result<Vec<artifact::SectionChange>, String> {
    let service = state.inner().clone();
    blocking(move || {
        let record = session::store(&service).load(&id)?;
        let find = |number: u32| {
            record
                .revisions
                .iter()
                .find(|revision| revision.number == number)
                .map(|revision| revision.markdown.clone())
                .ok_or_else(|| format!("Revision {number} does not exist."))
        };
        Ok(artifact::diff(&find(from)?, &find(to)?))
    })
    .await
}

#[tauri::command]
pub async fn plan_revision(
    id: String,
    number: u32,
    state: State<'_, Coordinator>,
) -> Result<String, String> {
    let service = state.inner().clone();
    blocking(move || {
        session::store(&service)
            .load(&id)?
            .revisions
            .into_iter()
            .find(|revision| revision.number == number)
            .map(|revision| revision.markdown)
            .ok_or_else(|| format!("Revision {number} does not exist."))
    })
    .await
}

#[tauri::command]
pub async fn plan_archive(id: String, state: State<'_, Coordinator>) -> Result<(), String> {
    let service = state.inner().clone();
    blocking(move || {
        session::store(&service)
            .update(&id, |saved| {
                saved.archived = true;
                Ok(())
            })
            .map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn plan_settings_get(
    project_id: String,
    state: State<'_, Coordinator>,
) -> Result<store::PlanSettings, String> {
    let service = state.inner().clone();
    blocking(move || Ok(session::store(&service).settings(&project_id))).await
}

#[tauri::command]
pub async fn plan_settings_set(
    project_id: String,
    settings: store::PlanSettings,
    state: State<'_, Coordinator>,
) -> Result<(), String> {
    let service = state.inner().clone();
    blocking(move || session::store(&service).save_settings(&project_id, settings)).await
}
