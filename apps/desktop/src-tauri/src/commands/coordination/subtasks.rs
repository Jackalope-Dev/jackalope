//! Agent-initiated splitting of work that turns out to be separable.
//!
//! A running task may hand whole files or folders it owns, and has not
//! changed yet, to a new subtask. The spawning task keeps the rest; handed
//! paths join its `excluded_scopes`, so later edits there fail its scope audit.
//! Planned tasks add the subtask to the same parent and its combined review.
//! Standalone tasks get ordinary queue tasks that dispatch on their own key.
//! Spawning requires the user's consent: an automatic plan, or Split this task.

use super::*;
use crate::commands::tasks::TaskRun;
use rmcp::schemars;

const MAX_PER_TASK: usize = 3;
const MAX_PER_PLAN: usize = 8;

pub(super) fn dispatch_key(parent_task_id: &str) -> String {
    format!("subtasks:{parent_task_id}")
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SubtaskInput {
    #[schemars(description = "Short objective, at most 160 bytes")]
    pub title: String,
    #[schemars(
        description = "Self-contained instructions for the new worker, including the contract it must honor"
    )]
    pub prompt: String,
    #[schemars(
        description = "Files or folders handed to the subtask. They must be inside your own paths and unchanged by you."
    )]
    pub scopes: Vec<String>,
    #[schemars(
        description = "Start the subtask from your checked result instead of now. Planned tasks only."
    )]
    #[serde(default, alias = "after_me")]
    pub after_me: bool,
}

fn within(scope: &str, owned: &[String]) -> bool {
    owned
        .iter()
        .any(|o| o == "." || o == scope || scope.starts_with(&format!("{o}/")))
}

/// Validates and appends a subtask for `caller`, returning the new item's ID.
pub(super) fn propose(
    ledger: &mut Ledger,
    merged: &[String],
    caller_item: &QueueItem,
    caller: &TaskRun,
    changed: &[String],
    input: SubtaskInput,
) -> Result<String, String> {
    if input.title.trim().is_empty()
        || input.title.len() > 160
        || input.prompt.trim().is_empty()
        || input.prompt.len() > 20_000
    {
        return Err("Give the subtask a short title and concrete instructions.".into());
    }
    let scopes = scopes(input.scopes)?;
    if scopes.iter().any(|scope| scope == ".") {
        return Err("Hand specific files or folders to the subtask, not the whole project.".into());
    }
    let saved = ledger
        .items
        .iter()
        .find(|item| item.id == caller_item.id)
        .cloned();
    let task = saved
        .as_ref()
        .and_then(|item| item.feature_id.as_ref())
        .and_then(|id| ledger.managed_tasks.iter().find(|task| &task.id == id))
        .cloned();
    let allowed = ledger.subtask_grants.contains(&caller.task_id)
        || saved
            .as_ref()
            .is_some_and(|item| ledger.subtask_grants.contains(&item.id))
        || task.as_ref().is_some_and(|task| task.auto_start);
    if !allowed {
        return Err("Splitting work needs the user's permission. Report the separable work in your completion report, or ask the user to choose Split this task.".into());
    }
    let parent_id = saved
        .as_ref()
        .map_or(caller.task_id.clone(), |item| item.id.clone());
    if ledger
        .items
        .iter()
        .filter(|item| item.parent_task_id.as_deref() == Some(&parent_id) && !item.canceled)
        .count()
        >= MAX_PER_TASK
    {
        return Err(format!("A task can spawn at most {MAX_PER_TASK} subtasks."));
    }
    if let Some(item) = &saved {
        let owned = agreements::effective_scopes(ledger, item);
        if let Some(outside) = scopes.iter().find(|scope| !within(scope, &owned)) {
            return Err(format!(
                "{outside} is outside your assignment, so you cannot hand it on."
            ));
        }
        if let Some(handed) = scopes
            .iter()
            .find(|scope| within(scope, &item.excluded_scopes))
        {
            return Err(format!("{handed} was already handed to another subtask."));
        }
    }
    if let Some(path) = changed.iter().find(|path| within(path, &scopes)) {
        return Err(format!(
            "You already changed {path}. Hand on only files and folders you have not edited."
        ));
    }
    let probe = QueueItem {
        scopes: scopes.clone(),
        excluded_scopes: vec![],
        id: String::new(),
        ..caller_item.clone()
    };
    if let Some(other) = ledger.items.iter().find(|other| {
        other.id != caller_item.id
            && other.project_id == caller_item.project_id
            && !other.canceled
            && !other.run_id.as_ref().is_some_and(|id| merged.contains(id))
            && !super::managed_delivery::is_integration(ledger, other)
            && item_overlap(ledger, &probe, other)
    }) {
        return Err(format!(
            "Those paths overlap task {} ({}). Coordinate with its owner instead.",
            other.id, other.title
        ));
    }
    if input.after_me && task.is_none() {
        return Err("Starting after your result is available only in planned tasks.".into());
    }
    let (root_prompt, feature, feature_id) = match &task {
        Some(task) => {
            let workers = ledger
                .items
                .iter()
                .filter(|item| {
                    item.feature_id.as_ref() == Some(&task.id)
                        && !super::managed_delivery::is_integration(ledger, item)
                        && !item.canceled
                })
                .count();
            if workers >= task.max_assignments.max(MAX_PER_PLAN) {
                return Err("This task already has as many assignments as it can run.".into());
            }
            (
                task.request.prompt.clone(),
                Some(task.title.clone()),
                Some(task.id.clone()),
            )
        }
        None => (caller.prompt.clone(), None, None),
    };
    let final_item = task
        .as_ref()
        .and_then(|task| task.delivery.as_ref())
        .and_then(|delivery| delivery.final_item.clone())
        .and_then(|id| ledger.items.iter().find(|item| item.id == id).cloned());
    if final_item
        .as_ref()
        .is_some_and(|item| item.run_id.is_some() && item.id != caller_item.id)
    {
        return Err(
            "The combined review already started, so no more work can join this task.".into(),
        );
    }
    let caller_title = saved.as_ref().map_or_else(
        || caller.prompt.chars().take(80).collect::<String>(),
        |item| item.title.clone(),
    );
    let agent = saved.as_ref().map_or_else(
        || {
            if caller.routing.is_some() {
                "auto".to_string()
            } else {
                caller.agent.clone()
            }
        },
        |item| item.agent.clone(),
    );
    let id = Coordinator::append(
        ledger,
        QueueRequest {
            staged_dependencies: task.is_some(),
            feature,
            feature_id,
            context_selection: saved
                .as_ref()
                .map(|item| item.context_selection.clone())
                .unwrap_or_default(),
            project_id: caller_item.project_id.clone(),
            project_name: caller_item.project_name.clone(),
            project_path: caller_item.project_path.clone(),
            target_branch: caller_item.target_branch.clone().or(caller.target_branch.clone()),
            agent_profile_id: saved.as_ref().and_then(|item| item.agent_profile_id.clone()),
            verify_command: caller_item.verify_command.clone(),
            prepare_command: caller_item.prepare_command.clone(),
            setup_files: caller_item.setup_files.clone(),
            auto_verify: caller_item.auto_verify,
            title: input.title.trim().into(),
            prompt: format!(
                "{}\n\nSpawned by task {} ({}) to own: {}. Jackalope owns this task's worker count. Do not launch other agents; propose_subtask is the only way to split off work.\n\nComplete request (shared context; perform only your assigned work):\n{}",
                input.prompt.trim(),
                caller_title,
                parent_id,
                scopes.join(", "),
                root_prompt
            ),
            agent,
            scopes: scopes.clone(),
            dependencies: if input.after_me {
                vec![parent_id.clone()]
            } else {
                vec![]
            },
        },
    )?;
    ledger
        .items
        .iter_mut()
        .find(|item| item.id == id)
        .unwrap()
        .parent_task_id = Some(parent_id.clone());
    if let Some(item) = ledger.items.iter_mut().find(|item| item.id == parent_id) {
        item.excluded_scopes.extend(scopes.iter().cloned());
    }
    if let Some(task) = &task {
        attach_to_review(ledger, task, final_item.as_ref(), &id)?;
    }
    ledger.messages.push(CoordinationMessage {
        id: Uuid::new_v4().to_string(),
        project_id: caller_item.project_id.clone(),
        task_id: "jackalope".into(),
        kind: "handoff".into(),
        text: format!(
            "Task {parent_id} spawned subtask {id} ({}) owning {}. Those paths are no longer part of task {parent_id}.",
            input.title.trim(),
            scopes.join(", ")
        ),
        created_at: Utc::now().to_rfc3339(),
        recipient_task_id: None,
        acknowledged_by: vec![],
        report: None,
        run_id: Some(caller.id.clone()),
        source_tree: None,
        resolved_by: None,
    });
    Ok(id)
}

/// Makes the plan's final combined review wait for the new subtask, creating
/// one when the plan had a single assignment.
fn attach_to_review(
    ledger: &mut Ledger,
    task: &managed::ManagedTask,
    final_item: Option<&QueueItem>,
    id: &str,
) -> Result<(), String> {
    let integration =
        final_item.is_some_and(|item| super::managed_delivery::is_integration(ledger, item));
    if let (true, Some(final_item)) = (integration, final_item) {
        let saved = ledger
            .items
            .iter_mut()
            .find(|item| item.id == final_item.id)
            .unwrap();
        saved.dependencies.push(id.into());
    } else {
        let mut dependencies = final_item
            .map(|item| vec![item.id.clone()])
            .unwrap_or_default();
        dependencies.push(id.into());
        let template = ledger
            .items
            .iter()
            .find(|item| item.id == id)
            .cloned()
            .unwrap();
        let review = Coordinator::append(
            ledger,
            QueueRequest {
                staged_dependencies: true,
                feature: Some(task.title.clone()),
                feature_id: Some(task.id.clone()),
                context_selection: task.request.context_selection.clone(),
                project_id: template.project_id,
                project_name: template.project_name,
                project_path: template.project_path,
                target_branch: template.target_branch,
                agent_profile_id: template.agent_profile_id,
                verify_command: template.verify_command,
                prepare_command: template.prepare_command,
                setup_files: template.setup_files,
                auto_verify: true,
                title: "Review and verify the combined result".into(),
                prompt: super::managed_delivery::integration_prompt(&task.request.prompt, true),
                agent: task.request.agent.clone(),
                scopes: vec![".".into()],
                dependencies,
            },
        )?;
        let delivery = ledger
            .managed_tasks
            .iter_mut()
            .find(|saved| saved.id == task.id)
            .and_then(|saved| saved.delivery.as_mut())
            .ok_or("This task uses the earlier review flow, which cannot add subtasks.")?;
        delivery.final_item = Some(review.clone());
        delivery.integration_items.push(review);
    }
    if let Some(delivery) = ledger
        .managed_tasks
        .iter_mut()
        .find(|saved| saved.id == task.id)
        .and_then(|saved| saved.delivery.as_mut())
    {
        delivery.spawned_subtasks += 1;
    }
    Ok(())
}

pub(in crate::commands) async fn bridge_propose_subtask(
    WebState(service): WebState<Coordinator>,
    headers: HeaderMap,
    Json(input): Json<SubtaskInput>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let item = service
        .authorized(&headers)
        .map_err(|status| (status, "Unauthorized".into()))?;
    let caller = service
        .authorized_run(&headers)
        .map_err(|status| (status, "Unauthorized".into()))?;
    let worker = service.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut inner = worker.inner.lock().unwrap();
        let _guard = crate::commands::integration::execution_guard()?;
        let (_, changed) = scope_audit::changed_paths(&caller)?;
        let merged = crate::commands::integration::applied_run_ids(&worker.runtime)?;
        let mut ledger = inner.ledger.clone();
        let id = propose(&mut ledger, &merged, &item, &caller, &changed, input)?;
        worker.save(&ledger)?;
        inner.ledger = ledger;
        if !inner
            .ledger
            .items
            .iter()
            .any(|saved| saved.id == id && saved.feature_id.is_some())
        {
            let parent = inner
                .ledger
                .items
                .iter()
                .find(|saved| saved.id == id)
                .and_then(|saved| saved.parent_task_id.clone())
                .unwrap_or_default();
            inner.enabled.insert(dispatch_key(&parent));
        }
        Ok::<_, String>(serde_json::json!({
            "taskId": id,
            "note": "The subtask is queued and starts when capacity allows. Do not edit the paths you handed on; read its progress with peers.",
        }))
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map(Json)
    .map_err(|error| (StatusCode::BAD_REQUEST, error))
}

/// The user asks a running isolated task to split off separable work.
#[tauri::command]
pub async fn task_request_split(
    run_id: String,
    state: State<'_, Coordinator>,
) -> Result<(), String> {
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let runs = service.runtime.integration_runs()?;
        let run = runs
            .iter()
            .find(|run| run.id == run_id)
            .ok_or("Task not found.")?;
        if !active(&run.status) || run.workspace == run.project_path || run.base_head.is_empty() {
            return Err("Only a running task in its own worktree can be split.".into());
        }
        let mut inner = service.inner.lock().unwrap();
        let owner = inner
            .ledger
            .items
            .iter()
            .find(|item| item.run_id.as_ref() == Some(&run.id))
            .map_or(run.task_id.clone(), |item| item.id.clone());
        let mut ledger = inner.ledger.clone();
        if !ledger.subtask_grants.contains(&owner) {
            ledger.subtask_grants.push(owner.clone());
            let excess = ledger.subtask_grants.len().saturating_sub(500);
            ledger.subtask_grants.drain(..excess);
        }
        ledger.messages.push(CoordinationMessage {
            id: Uuid::new_v4().to_string(),
            project_id: run.project_id.clone(),
            task_id: "jackalope".into(),
            kind: "handoff".into(),
            text: "The user asked you to split this task. Identify remaining work that can proceed independently in files or folders you have not edited, and call propose_subtask for each piece with self-contained instructions and the contract it must honor. Keep tightly coupled work yourself, then continue your own part.".into(),
            created_at: Utc::now().to_rfc3339(),
            recipient_task_id: Some(owner),
            acknowledged_by: vec![],
            report: None,
            run_id: Some(run.id.clone()),
            source_tree: None,
            resolved_by: None,
        });
        service.save(&ledger)?;
        inner.ledger = ledger;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("jackalope-subtasks-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        for args in [
            vec!["init", "--initial-branch=main"],
            vec!["commit", "--allow-empty", "-m", "base"],
        ] {
            let output = std::process::Command::new("git")
                .current_dir(&root)
                .args(&args)
                .env("GIT_AUTHOR_NAME", "t")
                .env("GIT_AUTHOR_EMAIL", "t@t")
                .env("GIT_COMMITTER_NAME", "t")
                .env("GIT_COMMITTER_EMAIL", "t@t")
                .output()
                .unwrap();
            assert!(output.status.success());
        }
        root
    }

    fn item(id: &str, root: &std::path::Path, scopes: &[&str], feature: Option<&str>) -> QueueItem {
        serde_json::from_value(serde_json::json!({
            "id": id, "featureId": feature, "projectId": "project", "projectName": "Project",
            "projectPath": root, "targetBranch": "main", "title": id, "prompt": id, "agent": "codex",
            "scopes": scopes, "dependencies": [], "createdAt": "now", "runId": format!("run-{id}"),
            "error": null, "canceled": false, "verifyCommand": "check", "autoVerify": true
        }))
        .unwrap()
    }

    fn plan(auto_start: bool, final_item: &str, integration: bool) -> managed::ManagedTask {
        let integration_items: Vec<&str> = if integration {
            vec![final_item]
        } else {
            vec![]
        };
        serde_json::from_value(serde_json::json!({
            "id": "parent", "title": "Feature", "plannerRunId": "planner", "runIds": [],
            "createdAt": "now", "started": true, "error": null, "autoStart": auto_start,
            "request": {"id":"parent","projectId":"project","projectName":"Project","projectPath":".","agent":"codex","prompt":"Original request","isolated":true},
            "assessment": {"id":"a","sourceHead":"h","strategy":"parallel","parallelAvailable":true,"reason":"r","createdAt":"now","cached":false,"decision":{"version":1,"kind":"task_strategy","requestedMode":"deterministic","provider":"local_rules","policyRevision":0,"concentration":null,"fallbackReason":null,"usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"estimatedCostUsd":0,"reported":true}}},
            "delivery": {"finalItem": final_item, "integrationItems": integration_items}
        }))
        .unwrap()
    }

    fn run(task_id: &str) -> TaskRun {
        TaskRun {
            id: format!("run-{task_id}"),
            task_id: task_id.into(),
            status: "running".into(),
            prompt: "Standalone request".into(),
            agent: "codex".into(),
            ..Default::default()
        }
    }

    fn input(scopes: &[&str]) -> SubtaskInput {
        SubtaskInput {
            title: "Settings UI".into(),
            prompt: "Build the settings page against the API types.".into(),
            scopes: scopes.iter().map(|s| s.to_string()).collect(),
            after_me: false,
        }
    }

    #[test]
    fn subtasks_need_consent_and_only_take_unedited_paths_the_caller_owns() {
        let root = repo();
        let caller = item("worker", &root, &["src"], Some("parent"));
        let mut ledger = Ledger {
            managed_tasks: vec![plan(false, "review", true)],
            items: vec![caller.clone(), {
                let mut review = item("review", &root, &["."], Some("parent"));
                review.run_id = None;
                review
            }],
            ..Default::default()
        };
        let denied = propose(
            &mut ledger.clone(),
            &[],
            &caller,
            &run("worker"),
            &[],
            input(&["src/ui"]),
        );
        assert!(denied.unwrap_err().contains("permission"));
        ledger.managed_tasks[0].auto_start = true;
        let attempt = |ledger: &mut Ledger, changed: &[&str], scopes: &[&str]| {
            propose(
                ledger,
                &[],
                &caller,
                &run("worker"),
                &changed.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                input(scopes),
            )
        };
        assert!(attempt(&mut ledger.clone(), &[], &["docs"])
            .unwrap_err()
            .contains("outside"));
        assert!(
            attempt(&mut ledger.clone(), &["src/ui/page.ts"], &["src/ui"])
                .unwrap_err()
                .contains("already changed")
        );
        assert!(attempt(&mut ledger.clone(), &[], &["."]).is_err());

        let id = attempt(&mut ledger, &["src/api.ts"], &["src/ui"]).unwrap();
        let spawned = ledger.items.iter().find(|i| i.id == id).unwrap();
        assert_eq!(spawned.parent_task_id.as_deref(), Some("worker"));
        assert_eq!(spawned.feature_id.as_deref(), Some("parent"));
        assert!(spawned.prompt.contains("Original request"));
        assert_eq!(
            ledger
                .items
                .iter()
                .find(|i| i.id == "worker")
                .unwrap()
                .excluded_scopes,
            vec!["src/ui".to_string()]
        );
        assert!(ledger
            .items
            .iter()
            .find(|i| i.id == "review")
            .unwrap()
            .dependencies
            .contains(&id));
        assert_eq!(
            ledger.managed_tasks[0]
                .delivery
                .as_ref()
                .unwrap()
                .spawned_subtasks,
            1
        );
        // The handed-off path cannot be handed on twice, and the subtask does not overlap its parent.
        assert!(attempt(&mut ledger.clone(), &[], &["src/ui/deep"])
            .unwrap_err()
            .contains("already handed"));
        let parent = ledger.items.iter().find(|i| i.id == "worker").unwrap();
        assert!(!item_overlap(&ledger, parent, spawned));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_single_assignment_plan_gains_a_combined_review_and_limits_hold() {
        let root = repo();
        let caller = item("worker", &root, &["src", "docs"], Some("parent"));
        let mut ledger = Ledger {
            managed_tasks: vec![plan(true, "worker", false)],
            items: vec![caller.clone()],
            ..Default::default()
        };
        let id = propose(
            &mut ledger,
            &[],
            &caller,
            &run("worker"),
            &[],
            input(&["docs"]),
        )
        .unwrap();
        let delivery = ledger.managed_tasks[0].delivery.clone().unwrap();
        let review = ledger
            .items
            .iter()
            .find(|i| Some(&i.id) == delivery.final_item.as_ref())
            .unwrap();
        assert_eq!(review.dependencies, vec!["worker".to_string(), id]);
        assert_eq!(delivery.integration_items, vec![review.id.clone()]);
        for index in 0..2 {
            propose(
                &mut ledger,
                &[],
                &caller,
                &run("worker"),
                &[],
                input(&[&format!("src/part{index}")]),
            )
            .unwrap();
        }
        assert!(propose(
            &mut ledger,
            &[],
            &caller,
            &run("worker"),
            &[],
            input(&["src/more"])
        )
        .unwrap_err()
        .contains("at most"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn standalone_tasks_split_only_after_the_user_asks() {
        let root = repo();
        let mut caller = item("solo", &root, &["."], None);
        caller.run_id = Some("run-solo".into());
        let mut ledger = Ledger::default();
        assert!(propose(
            &mut ledger.clone(),
            &[],
            &caller,
            &run("solo"),
            &[],
            input(&["src/ui"])
        )
        .is_err());
        ledger.subtask_grants.push("solo".into());
        let mut after = input(&["src/ui"]);
        after.after_me = true;
        assert!(
            propose(&mut ledger.clone(), &[], &caller, &run("solo"), &[], after)
                .unwrap_err()
                .contains("planned tasks")
        );
        let id = propose(
            &mut ledger,
            &[],
            &caller,
            &run("solo"),
            &[],
            input(&["src/ui"]),
        )
        .unwrap();
        let spawned = ledger.items.iter().find(|i| i.id == id).unwrap();
        assert_eq!(spawned.parent_task_id.as_deref(), Some("solo"));
        assert!(spawned.feature_id.is_none());
        assert!(spawned.prompt.contains("Standalone request"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
