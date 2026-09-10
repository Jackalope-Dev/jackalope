use super::*;
use crate::commands::tasks::TaskRun;
use rmcp::schemars;
use serde::Serialize;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agreement {
    #[serde(default)]
    pub rejected_by: Option<String>,
    #[serde(default)]
    pub resolution_run: Option<String>,
    pub id: String,
    pub project_id: String,
    pub task_id: String,
    pub kind: String,
    pub resource: String,
    pub paths: Vec<String>,
    pub text: String,
    pub participants: Vec<String>,
    pub accepted_by: Vec<String>,
    pub status: String,
    pub revision: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Claim,
    Propose,
    Transfer,
    Accept,
    Reject,
    Release,
}

#[derive(Clone, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AgreementInput {
    pub action: Action,
    #[schemars(description = "A fresh UUID for claim/propose; otherwise the saved agreement ID.")]
    pub id: String,
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub resource: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub participants: Vec<String>,
}

fn live(a: &Agreement) -> bool {
    !["released", "canceled"].contains(&a.status.as_str())
}

pub(super) fn effective_scopes(ledger: &Ledger, item: &QueueItem) -> Vec<String> {
    let mut result = item.scopes.clone();
    for a in &ledger.agreements {
        if a.project_id == item.project_id
            && a.task_id == item.id
            && a.kind == "ownership"
            && live(a)
        {
            result.extend(a.paths.clone());
        }
    }
    result
}

pub(super) fn owner_id<'a>(ledger: &'a Ledger, runs: &[TaskRun], run: &'a TaskRun) -> &'a str {
    ledger
        .items
        .iter()
        .find(|i| {
            runs.iter()
                .any(|r| Some(&r.id) == i.run_id.as_ref() && r.task_id == run.task_id)
        })
        .map_or(run.task_id.as_str(), |i| i.id.as_str())
}

fn known_task(ledger: &Ledger, runs: &[TaskRun], project: &str, id: &str) -> bool {
    ledger
        .items
        .iter()
        .any(|i| i.project_id == project && i.id == id && !i.canceled)
        || runs.iter().any(|r| {
            r.project_id == project
                && r.task_id == id
                && !ledger
                    .items
                    .iter()
                    .any(|i| i.canceled && i.run_id.as_ref() == Some(&r.id))
        })
}

fn validate_claim(
    ledger: &Ledger,
    project: &str,
    owner: &str,
    resource: &str,
    paths: &[String],
    except: &str,
    merged: &[String],
) -> Result<(), String> {
    if let Some(other) = ledger.agreements.iter().find(|a| {
        a.project_id == project
            && a.kind == "ownership"
            && live(a)
            && a.id != except
            && (a.resource == resource || overlaps(&a.paths, paths))
    }) {
        return Err(format!(
            "Already claimed by task {} (agreement {}). Request a handoff from that owner.",
            other.task_id, other.id
        ));
    }
    if let Some(other) = ledger.items.iter().find(|i| {
        i.project_id == project
            && i.id != owner
            && !i.canceled
            && i.run_id.as_ref().is_none_or(|id| !merged.contains(id))
            && overlaps(&i.scopes, paths)
    }) {
        return Err(format!("These paths belong to {}. Keep the existing assignment or revise the plan with the user.", other.title));
    }
    Ok(())
}

pub(super) fn require_clean_paths(
    ledger: &Ledger,
    runs: &[TaskRun],
    a: &Agreement,
    merged: &[String],
) -> Result<(), String> {
    if a.paths.is_empty() {
        return Ok(());
    }
    for run in runs
        .iter()
        .filter(|r| r.project_id == a.project_id && owner_id(ledger, runs, r) == a.task_id)
    {
        if runs
            .iter()
            .any(|new| new.task_id == run.task_id && new.started_at > run.started_at)
        {
            continue;
        }
        if merged.contains(&run.id) {
            continue;
        }
        let (_, paths) = super::scope_audit::changed_paths(run)?;
        if overlaps(&a.paths, &paths) {
            return Err("The owner still has changes in these paths. Preserve or integrate that work before transferring or releasing ownership.".into());
        }
    }
    Ok(())
}

pub(super) fn change(
    ledger: &mut Ledger,
    runs: &[TaskRun],
    actor: &QueueItem,
    input: AgreementInput,
    merged: &[String],
) -> Result<Agreement, String> {
    if Uuid::parse_str(&input.id).is_err() {
        return Err("Use a UUID agreement ID.".into());
    }
    if matches!(input.action, Action::Claim | Action::Propose) {
        let resource = input.resource.trim().to_lowercase();
        if resource.is_empty()
            || resource.len() > 160
            || resource.chars().any(char::is_control)
            || input.text.trim().is_empty()
            || input.text.len() > 4000
            || input.text.contains('\0')
        {
            return Err("Provide a short resource name and a description of the responsibility or proposed interface.".into());
        }
        let paths = if input.paths.is_empty() {
            vec![]
        } else {
            scopes(input.paths)?
        };
        let mut participants = input.participants;
        participants.sort();
        participants.dedup();
        let kind = if matches!(input.action, Action::Claim) {
            "ownership"
        } else {
            "interface"
        };
        if let Some(a) = ledger.agreements.iter().find(|a| a.id == input.id) {
            if a.task_id == actor.id
                && a.project_id == actor.project_id
                && a.kind == kind
                && a.resource == resource
                && a.text == input.text
                && a.paths == paths
                && (kind == "ownership" || a.participants == participants)
            {
                return Ok(a.clone());
            }
            return Err("This agreement ID already represents a different decision.".into());
        }
        if ledger.agreements.len() >= 5000 {
            return Err("The agreement journal is full. Existing decisions were preserved.".into());
        }
        if kind == "ownership" {
            if !participants.is_empty() {
                return Err(
                    "A claim belongs to the calling task. Use transfer for a handoff.".into(),
                );
            }
            validate_claim(
                ledger,
                &actor.project_id,
                &actor.id,
                &resource,
                &paths,
                &input.id,
                merged,
            )?;
        } else if participants.is_empty()
            || participants.len() > 24
            || participants
                .iter()
                .any(|id| id == &actor.id || !known_task(ledger, runs, &actor.project_id, id))
        {
            return Err("Choose 1–24 other task owners from this project's inventory.".into());
        }
        let now = Utc::now().to_rfc3339();
        let a = Agreement {
            rejected_by: None,
            resolution_run: None,
            id: input.id,
            project_id: actor.project_id.clone(),
            task_id: actor.id.clone(),
            kind: kind.into(),
            resource,
            paths,
            text: input.text,
            participants,
            accepted_by: vec![],
            status: if kind == "ownership" {
                "owned"
            } else {
                "pending"
            }
            .into(),
            revision: 1,
            created_at: now.clone(),
            updated_at: now,
        };
        ledger.agreements.push(a.clone());
        return Ok(a);
    }
    let index = ledger
        .agreements
        .iter()
        .position(|a| a.id == input.id && a.project_id == actor.project_id)
        .ok_or("Agreement not found in this project.")?;
    let mut a = ledger.agreements[index].clone();
    if a.revision != input.revision {
        return Err("This agreement changed. Read project and review the current revision before responding.".into());
    }
    if !live(&a) {
        return Err("This agreement is closed.".into());
    }
    match input.action {
        Action::Transfer => {
            if a.kind != "ownership"
                || a.status != "owned"
                || a.task_id != actor.id
                || input.participants.len() != 1
                || input.participants[0] == actor.id
                || !known_task(ledger, runs, &actor.project_id, &input.participants[0])
            {
                return Err(
                    "Only the current owner can offer a claim to one other project task.".into(),
                );
            }
            if ledger
                .items
                .iter()
                .any(|i| i.id == actor.id && overlaps(&i.scopes, &a.paths))
            {
                return Err("This claim includes the original task's declared scope. Revise the plan with the user before transferring those paths.".into());
            }
            require_clean_paths(ledger, runs, &a, merged)?;
            a.participants = input.participants;
            a.accepted_by.clear();
            a.rejected_by = None;
            a.status = "pending".into();
        }
        Action::Accept | Action::Reject => {
            if a.status != "pending" || !a.participants.contains(&actor.id) {
                return Err("Only an invited owner can respond to a pending decision.".into());
            }
            if matches!(input.action, Action::Reject) {
                a.rejected_by = Some(actor.id.clone());
                a.status = if a.kind == "ownership" {
                    "owned"
                } else {
                    "rejected"
                }
                .into();
                if a.kind == "ownership" {
                    a.participants.clear();
                }
            } else if a.kind == "ownership" {
                require_clean_paths(ledger, runs, &a, merged)?;
                validate_claim(
                    ledger,
                    &a.project_id,
                    &actor.id,
                    &a.resource,
                    &a.paths,
                    &a.id,
                    merged,
                )?;
                a.task_id = actor.id.clone();
                a.accepted_by = vec![actor.id.clone()];
                a.status = "owned".into();
                a.participants.clear();
            } else {
                if !a.accepted_by.contains(&actor.id) {
                    a.accepted_by.push(actor.id.clone());
                }
                if a.participants.iter().all(|p| a.accepted_by.contains(p)) {
                    a.status = "agreed".into();
                }
            }
        }
        Action::Release => {
            if a.task_id != actor.id {
                return Err("Only the owner can release a claim. Interface gates require a user decision to cancel.".into());
            }
            if a.kind != "ownership" {
                return Err(
                    "Ask the user to cancel an interface gate that is no longer needed.".into(),
                );
            }
            require_clean_paths(ledger, runs, &a, merged)?;
            a.status = "released".into();
        }
        _ => unreachable!(),
    }
    a.revision += 1;
    a.updated_at = Utc::now().to_rfc3339();
    ledger.agreements[index] = a.clone();
    Ok(a)
}

pub(super) fn announce(ledger: &mut Ledger, a: &Agreement, actor: &str) {
    let recipients = if a.participants.is_empty() {
        vec![None]
    } else {
        let mut ids = a.participants.clone();
        ids.push(a.task_id.clone());
        ids.sort();
        ids.dedup();
        ids.into_iter().map(Some).collect()
    };
    for recipient in recipients {
        ledger.messages.push(CoordinationMessage { id: Uuid::new_v4().to_string(), project_id: a.project_id.clone(), task_id: actor.into(),
            kind: if a.status == "pending" || a.status == "rejected" { "blocker" } else { "handoff" }.into(),
            text: format!("Jackalope {} decision: {} · {} · owner {}. {} Read project for agreement {} revision {}.", a.kind, a.resource, a.status, a.task_id, a.text, a.id, a.revision),
            created_at: Utc::now().to_rfc3339(), recipient_task_id: recipient, acknowledged_by: vec![], report: None, run_id: None, source_tree: None, resolved_by: None });
    }
    let excess = ledger.messages.len().saturating_sub(2000);
    ledger.messages.drain(..excess);
}

pub(super) fn interface_block(ledger: &Ledger, project: &str, task: &str) -> Option<String> {
    ledger.agreements.iter().find(|a| a.project_id == project && a.kind == "interface"
        && ["pending", "rejected"].contains(&a.status.as_str()) && (a.task_id == task || a.participants.iter().any(|p| p == task)))
        .map(|a| format!("Interface agreement '{}' is {}. Ask its participants to respond, or cancel it explicitly in Coordination & handoffs.", a.resource, a.status))
}

pub(in crate::commands) async fn bridge_agreement(
    WebState(service): WebState<Coordinator>,
    headers: HeaderMap,
    Json(input): Json<AgreementInput>,
) -> Result<Json<Agreement>, (StatusCode, String)> {
    let actor = service
        .authorized(&headers)
        .map_err(|s| (s, "This task cannot access coordination.".into()))?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut inner = service
            .inner
            .lock()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let _guard = crate::commands::integration::execution_guard()
            .map_err(|e| (StatusCode::CONFLICT, e))?;
        service
            .authorized_locked(&inner, &headers)
            .map_err(|s| (s, "This task is no longer active.".into()))?;
        let runs = service
            .runtime
            .integration_runs()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        let mut ledger = inner.ledger.clone();
        let before = serde_json::to_vec(&ledger.agreements).unwrap_or_default();
        let merged = crate::commands::integration::applied_run_ids(&service.runtime)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        let result = change(&mut ledger, &runs, &actor, input, &merged)
            .map_err(|e| (StatusCode::CONFLICT, e))?;
        if before != serde_json::to_vec(&ledger.agreements).unwrap_or_default() {
            announce(&mut ledger, &result, &actor.id);
            service
                .save(&ledger)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            inner.ledger = ledger;
        }
        Ok(Json(result))
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
}

impl Coordinator {
    fn authorized_locked(&self, inner: &Inner, headers: &HeaderMap) -> Result<(), StatusCode> {
        let token = headers
            .get("authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|h| h.strip_prefix("Bearer "))
            .ok_or(StatusCode::UNAUTHORIZED)?;
        let (_, run_id) = inner.grants.get(token).ok_or(StatusCode::UNAUTHORIZED)?;
        if self
            .runtime
            .integration_runs()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .iter()
            .any(|r| &r.id == run_id && active(&r.status) && !r.finishing)
        {
            Ok(())
        } else {
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}
