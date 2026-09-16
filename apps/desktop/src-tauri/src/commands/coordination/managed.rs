use super::*;
use crate::commands::{task_strategy, tasks::TaskRun};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedTask {
    #[serde(default)]
    pub delivery: Option<super::managed_delivery::Delivery>,
    pub id: String,
    pub title: String,
    pub request: RunRequest,
    pub assessment: task_strategy::Assessment,
    pub planner_run_id: String,
    #[serde(default)]
    pub run_ids: Vec<String>,
    pub created_at: String,
    pub started: bool,
    pub error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProposedStep {
    key: String,
    title: String,
    prompt: String,
    scopes: Vec<String>,
    #[serde(default)]
    depends_on: Vec<String>,
    #[serde(default)]
    outcomes: Vec<String>,
}

pub(super) fn dispatch_key(id: &str) -> String {
    format!("managed:{id}")
}

pub(super) fn owns_run(ledger: &Ledger, runs: &[TaskRun], run: &TaskRun) -> bool {
    ledger.managed_tasks.iter().any(|task| {
        runs.iter().any(|root| {
            root.task_id == run.task_id
                && (root.id == task.planner_run_id || task.run_ids.contains(&root.id))
        })
    })
}

pub(super) fn reconcile_attempts(ledger: &mut Ledger, runs: &[TaskRun]) -> bool {
    let mut changed = false;
    for task in &mut ledger.managed_tasks {
        let roots: HashSet<_> = task
            .run_ids
            .iter()
            .chain(std::iter::once(&task.planner_run_id))
            .chain(
                ledger
                    .items
                    .iter()
                    .filter(|item| item.feature_id.as_ref() == Some(&task.id))
                    .filter_map(|item| item.run_id.as_ref()),
            )
            .collect();
        let tasks: HashSet<_> = runs
            .iter()
            .filter(|run| roots.contains(&run.id))
            .map(|run| &run.task_id)
            .collect();
        for run in runs.iter().filter(|run| tasks.contains(&run.task_id)) {
            if !task.run_ids.contains(&run.id) {
                task.run_ids.push(run.id.clone());
                changed = true;
            }
        }
        for item in ledger
            .items
            .iter_mut()
            .filter(|item| item.feature_id.as_ref() == Some(&task.id))
        {
            if let Some(original) = runs
                .iter()
                .find(|run| Some(&run.id) == item.run_id.as_ref())
            {
                if let Some(latest) = runs
                    .iter()
                    .filter(|run| run.task_id == original.task_id)
                    .max_by_key(|run| &run.started_at)
                {
                    if item.run_id.as_ref() != Some(&latest.id) {
                        item.run_id = Some(latest.id.clone());
                        changed = true;
                    }
                }
            }
        }
    }
    changed
}

fn planning_prompt(request: &str) -> String {
    format!("Plan this complete request using the repository and its instructions. Read only: do not edit files, install dependencies, commit, launch other agents or implement changes. Return ONLY a JSON array of 1–4 assignments with key, title, prompt, scopes (actual relative repository files/folders), dependsOn (other assignment keys), and outcomes (reviewable requirements). Preserve the complete request and its constraints. Minimize total implementation, integration and human review effort, not just worker duration. Keep tightly coupled work together and tests with implementation. Inspect imports, API contracts, schemas, generated files, manifests and lockfiles: different files do not imply independent work. Give each shared contract and dependency change one owner; put it in a prerequisite and name the contract in consumer instructions. Independent assignments must have non-overlapping ownership. Use parallel investigation or review only when it helps the requested result. Use one assignment when splitting creates more integration work than it saves. Jackalope combines finished work, checks dependencies and appends final review and verification; do not add your own integration assignments. No agent names or model changes. Each prompt must be self-contained and identify its exact responsibility.\n\nComplete request:\n{request}")
}

pub(super) fn prepare_followup(
    ledger: &Ledger,
    runs: &[TaskRun],
    request: &mut RunRequest,
) -> Result<(), String> {
    let Some(previous) = runs.iter().find(|run| {
        Some(&run.id)
            == request
                .previous_run_id
                .as_ref()
                .or(request.retry_of.as_ref())
    }) else {
        return Ok(());
    };
    let Some(task) = ledger.managed_tasks.iter().find(|task| {
        runs.iter().any(|run| {
            run.task_id == previous.task_id
                && (run.id == task.planner_run_id || task.run_ids.contains(&run.id))
        })
    }) else {
        return Ok(());
    };
    task_strategy::validate_source(&task.request, &task.assessment.source_head)?;
    request.effort = task.request.effort;
    request.connection_ids = task.request.connection_ids.clone();
    if runs
        .iter()
        .any(|run| run.id == task.planner_run_id && run.task_id == previous.task_id)
    {
        if task.started {
            return Err(
                "The reviewed plan is already running. Follow up on an implementation assignment."
                    .into(),
            );
        }
        request.prompt = format!(
            "{}\n\nPlanning correction from user:\n{}",
            planning_prompt(&task.request.prompt),
            request.prompt
        );
        request.auto_verify = false;
        request.prepare_command = None;
        request.verify_command = None;
        request.context_selection.outcomes.clear();
    } else if !ledger.items.iter().any(|item| {
        item.feature_id.as_ref() == Some(&task.id)
            && runs
                .iter()
                .any(|run| Some(&run.id) == item.run_id.as_ref() && run.task_id == previous.task_id)
    }) {
        return Err(
            "This attempt was superseded. Open the current assignment to follow up.".into(),
        );
    }
    Ok(())
}

fn parse_plan(text: &str, request: &RunRequest) -> Result<Vec<PlanEntry>, String> {
    let text = text.trim();
    let text = if text.starts_with("```") {
        text.split_once('\n')
            .and_then(|(_, value)| value.strip_suffix("```"))
            .ok_or("The planning response is incomplete.")?
            .trim()
    } else {
        text
    };
    if text.len() > 48_000 {
        return Err("The proposed plan is too large.".into());
    }
    let proposed: Vec<ProposedStep> = serde_json::from_str(text).map_err(|_| "The agent did not return a valid task plan. Open its result and request a corrected JSON plan.")?;
    if proposed.is_empty() || proposed.len() > 4 {
        return Err("A managed task needs between one and four implementation assignments.".into());
    }
    let mut items = Vec::new();
    for step in proposed {
        if step.key == "combined-review"
            || step.key.starts_with("integration-")
            || step.title.trim().is_empty()
            || step.title.len() > 160
            || step.prompt.trim().is_empty()
            || step.prompt.len() > 20_000
        {
            return Err(
                "Every assignment needs a unique key, short title and concrete instructions."
                    .into(),
            );
        }
        let scopes = scopes(step.scopes)?;
        let mut context_selection = request.context_selection.clone();
        context_selection.outcomes.extend(step.outcomes);
        context_selection.outcomes.sort();
        context_selection.outcomes.dedup();
        crate::commands::outcomes::ProcessTemplate {
            outcomes: context_selection.outcomes.clone(),
            ..Default::default()
        }
        .validate()?;
        items.push(PlanEntry {
            key: step.key,
            title: step.title,
            prompt: format!("{}\n\nJackalope owns this task's worker count. Do not delegate or launch other agents.\n\nComplete request (shared context; perform only your assigned work):\n{}", step.prompt, request.prompt),
            agent: request.agent.clone(),
            scopes,
            depends_on: step.depends_on,
            context_selection,
        });
    }
    let mut items = ordered_plan(items)?;
    let mut ancestors: HashMap<String, HashSet<String>> = HashMap::new();
    for item in &items {
        let mut all: HashSet<String> = item.depends_on.iter().cloned().collect();
        for dependency in &item.depends_on {
            all.extend(ancestors.get(dependency).into_iter().flatten().cloned());
        }
        for prior in &items {
            if prior.key != item.key
                && !all.contains(&prior.key)
                && !ancestors
                    .get(&prior.key)
                    .is_some_and(|set| set.contains(&item.key))
                && ancestors.contains_key(&prior.key)
                && overlaps(&prior.scopes, &item.scopes)
            {
                return Err("Independent assignments overlap. Ask the planner to give shared files one owner and make dependent work sequential.".into());
            }
        }
        ancestors.insert(item.key.clone(), all);
    }
    if items.len() == 1 {
        return Ok(items);
    }
    let mut combined_context = request.context_selection.clone();
    for item in &mut items {
        combined_context
            .outcomes
            .append(&mut item.context_selection.outcomes);
    }
    combined_context.outcomes.sort();
    combined_context.outcomes.dedup();
    crate::commands::outcomes::ProcessTemplate {
        outcomes: combined_context.outcomes.clone(),
        ..Default::default()
    }
    .validate()?;
    items.push(PlanEntry {
        key: "combined-review".into(),
        title: "Review and verify the combined result".into(),
        prompt: super::managed_delivery::integration_prompt(&request.prompt, true),
        agent: request.agent.clone(),
        scopes: vec![".".into()],
        depends_on: items.iter().map(|item| item.key.clone()).collect(),
        context_selection: combined_context,
    });
    Ok(items)
}

fn latest_planner<'a>(task: &ManagedTask, runs: &'a [TaskRun]) -> Option<&'a TaskRun> {
    let original = runs.iter().find(|run| run.id == task.planner_run_id)?;
    runs.iter()
        .filter(|run| run.task_id == original.task_id)
        .max_by_key(|run| &run.started_at)
}

impl Coordinator {
    fn create_managed(
        &self,
        request: RunRequest,
        assessment_id: String,
        title: String,
    ) -> Result<String, String> {
        self.runtime.access.ensure()?;
        self.ensure_storage_loaded()?;
        let assessment =
            task_strategy::validated_assessment(&self.runtime, &assessment_id, &request)?;
        if !assessment.parallel_available {
            return Err(
                "Parallel planning is unavailable for this request. Start with one agent.".into(),
            );
        }
        if title.trim().is_empty() || title.len() > 160 || Uuid::parse_str(&request.id).is_err() {
            return Err("Provide a valid task identifier and a title up to 160 bytes.".into());
        }
        let task = ManagedTask {
            delivery: Some(Default::default()),
            id: request.id.clone(),
            title: title.trim().into(),
            request: request.clone(),
            assessment,
            planner_run_id: Uuid::new_v4().to_string(),
            run_ids: vec![],
            created_at: Utc::now().to_rfc3339(),
            started: false,
            error: None,
        };
        {
            let mut inner = self.inner.lock().unwrap();
            if let Some(saved) = inner
                .ledger
                .managed_tasks
                .iter()
                .find(|saved| saved.id == task.id)
            {
                if serde_json::to_value(&saved.request).ok() != serde_json::to_value(&request).ok()
                {
                    return Err("This task was already saved with a different request.".into());
                }
                return Ok(saved.id.clone());
            }
            if inner.ledger.managed_tasks.len() >= 500 {
                return Err("The managed task history limit has been reached.".into());
            }
            let mut ledger = inner.ledger.clone();
            ledger.managed_tasks.push(task.clone());
            self.save(&ledger)?;
            inner.ledger = ledger;
        }
        self.launch_planner(&task)?;
        Ok(task.id)
    }

    fn launch_planner(&self, task: &ManagedTask) -> Result<(), String> {
        let mut planning = task.request.clone();
        planning.id = task.planner_run_id.clone();
        planning.prompt = planning_prompt(&planning.prompt);
        planning.auto_verify = false;
        planning.prepare_command = None;
        planning.verify_command = None;
        planning.context_selection.outcomes.clear();
        if let Err(error) = self.start_manual(planning) {
            let mut inner = self.inner.lock().unwrap();
            let mut ledger = inner.ledger.clone();
            ledger
                .managed_tasks
                .iter_mut()
                .find(|item| item.id == task.id)
                .unwrap()
                .error = Some(error);
            self.save(&ledger)?;
            inner.ledger = ledger;
        }
        Ok(())
    }

    pub(super) fn managed_plan(&self, id: &str) -> Result<Vec<PlanEntry>, String> {
        let task = self
            .inner
            .lock()
            .unwrap()
            .ledger
            .managed_tasks
            .iter()
            .find(|task| task.id == id)
            .cloned()
            .ok_or("Task not found.")?;
        let runs = self.runtime.integration_runs()?;
        let run = latest_planner(&task, &runs)
            .ok_or("The planning attempt is unavailable. Inspect task recovery before retrying.")?;
        if active(&run.status) || run.finishing {
            return Err("The lead is still preparing this plan.".into());
        }
        if !matches!(run.status.as_str(), "review" | "reviewed")
            || run.error.is_some()
            || run.persistence_error.is_some()
        {
            return Err("The planning attempt needs attention before work can start.".into());
        }
        let changed = crate::commands::tasks::git(&run.workspace, &["status", "--porcelain"])?;
        let committed =
            crate::commands::tasks::git(&run.workspace, &["diff", "--name-only", &run.base_head])?;
        if !changed.is_empty() || !committed.is_empty() {
            return Err("The planning agent changed files. Inspect its workspace before starting implementation.".into());
        }
        parse_plan(&run.result, &task.request)
    }

    fn start_managed(&self, id: &str, planner_run_id: &str) -> Result<(), String> {
        self.runtime.access.ensure()?;
        let task = self
            .inner
            .lock()
            .unwrap()
            .ledger
            .managed_tasks
            .iter()
            .find(|task| task.id == id)
            .cloned()
            .ok_or("Task not found.")?;
        if task.started {
            return self.managed_action(id, "resume");
        }
        task_strategy::validate_source(&task.request, &task.assessment.source_head)?;
        let runs = self.runtime.integration_runs()?;
        if latest_planner(&task, &runs).is_none_or(|run| run.id != planner_run_id) {
            return Err(
                "The proposed plan changed. Review its latest assignments before starting.".into(),
            );
        }
        let items = self.managed_plan(id)?;
        let agent_accounts = task
            .request
            .agent_profile_id
            .as_ref()
            .map(|account| [(task.request.agent.clone(), account.clone())].into())
            .unwrap_or_default();
        let count = items.len();
        let created = self.import(PlanRequest {
            staged_dependencies: true,
            feature: Some(task.title.clone()),
            feature_id: Some(task.id.clone()),
            project_id: task.request.project_id.clone(),
            project_name: task.request.project_name.clone(),
            project_path: task.request.project_path.clone(),
            target_branch: task.request.target_branch.clone(),
            agent_accounts,
            verify_command: task.request.verify_command.clone(),
            prepare_command: task.request.prepare_command.clone(),
            auto_verify: true,
            items,
        })?;
        let mut inner = self.inner.lock().unwrap();
        if inner.url.is_none() {
            return Err("The coordination bridge is unavailable. Retry when it is ready.".into());
        }
        let mut ledger = inner.ledger.clone();
        let task = ledger
            .managed_tasks
            .iter_mut()
            .find(|task| task.id == id)
            .unwrap();
        task.started = true;
        task.error = None;
        if let Some(delivery) = &mut task.delivery {
            delivery.final_item = created.last().cloned();
            if count > 1 {
                delivery.integration_items = created.last().cloned().into_iter().collect();
            }
        }
        self.save(&ledger)?;
        inner.ledger = ledger;
        inner.enabled.insert(dispatch_key(id));
        Ok(())
    }

    fn managed_action(&self, id: &str, action: &str) -> Result<(), String> {
        self.ensure_storage_loaded()?;
        let mut inner = self.inner.lock().unwrap();
        let task = inner
            .ledger
            .managed_tasks
            .iter()
            .find(|task| task.id == id)
            .cloned()
            .ok_or("Task not found.")?;
        match action {
            "retry-repair" => {
                self.runtime.access.ensure()?;
                task_strategy::validate_source(&task.request, &task.assessment.source_head)?;
                let mut ledger = inner.ledger.clone();
                let saved = ledger
                    .managed_tasks
                    .iter_mut()
                    .find(|saved| saved.id == id)
                    .unwrap();
                let delivery = saved
                    .delivery
                    .as_mut()
                    .ok_or("This task uses the earlier review flow.")?;
                delivery.repair_limit = delivery.repairs.len() + 1;
                delivery.interventions += 1;
                saved.error = None;
                self.save(&ledger)?;
                inner.ledger = ledger;
                inner.enabled.insert(dispatch_key(id));
            }
            "retry-plan" => {
                if task.started {
                    return Err("Implementation has already started.".into());
                }
                task_strategy::validate_source(&task.request, &task.assessment.source_head)?;
                let runs = self.runtime.integration_runs()?;
                if runs.iter().any(|run| {
                    (run.id == task.planner_run_id || task.run_ids.contains(&run.id))
                        && (active(&run.status) || run.status == "interrupted" || run.finishing)
                }) {
                    return Err(
                        "Resolve active or interrupted planning attempts before retrying.".into(),
                    );
                }
                let mut ledger = inner.ledger.clone();
                let saved = ledger
                    .managed_tasks
                    .iter_mut()
                    .find(|task| task.id == id)
                    .unwrap();
                saved.run_ids.push(saved.planner_run_id.clone());
                saved.planner_run_id = Uuid::new_v4().to_string();
                saved.error = None;
                let next = saved.clone();
                self.save(&ledger)?;
                inner.ledger = ledger;
                drop(inner);
                return self.launch_planner(&next);
            }
            "resume" => {
                self.runtime.access.ensure()?;
                if !task.started {
                    return Err("Review and start the proposed plan first.".into());
                }
                task_strategy::validate_source(&task.request, &task.assessment.source_head)?;
                if inner.url.is_none() {
                    return Err("The coordination bridge is unavailable.".into());
                }
                inner.enabled.insert(dispatch_key(id));
            }
            "pause" | "stop" => {
                inner.enabled.remove(&dispatch_key(id));
                if action == "stop" {
                    let runs = self.runtime.integration_runs()?;
                    let roots: HashSet<_> = inner
                        .ledger
                        .items
                        .iter()
                        .filter(|item| item.feature_id.as_deref() == Some(id))
                        .filter_map(|item| item.run_id.as_deref())
                        .chain(std::iter::once(task.planner_run_id.as_str()))
                        .chain(task.run_ids.iter().map(String::as_str))
                        .collect();
                    let task_ids: HashSet<_> = runs
                        .iter()
                        .filter(|run| roots.contains(run.id.as_str()))
                        .map(|run| &run.task_id)
                        .collect();
                    let active_ids: Vec<_> = runs
                        .iter()
                        .filter(|run| task_ids.contains(&run.task_id) && active(&run.status))
                        .map(|run| run.id.clone())
                        .collect();
                    for run_id in active_ids {
                        self.runtime.stop(&run_id)?;
                    }
                }
            }
            _ => return Err("Choose pause, stop, resume or retry-repair.".into()),
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn task_plan_review_time(
    id: String,
    sample_id: String,
    seconds: u64,
    state: State<'_, Coordinator>,
) -> Result<(), String> {
    if Uuid::parse_str(&sample_id).is_err() || seconds == 0 || seconds > 60 {
        return Err("Provide a review observation between one and sixty seconds.".into());
    }
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.ensure_storage_loaded()?;
        let mut inner = service.inner.lock().map_err(|e| e.to_string())?;
        let mut ledger = inner.ledger.clone();
        let task = ledger
            .managed_tasks
            .iter_mut()
            .find(|task| task.id == id)
            .ok_or("Task not found.")?;
        let delivery = task
            .delivery
            .as_mut()
            .ok_or("This task has no review measurements.")?;
        if delivery.review_samples.contains(&sample_id) {
            return Ok(());
        }
        delivery.review_seconds =
            Some(delivery.review_seconds.unwrap_or(0).saturating_add(seconds));
        delivery.review_samples.push(sample_id);
        let excess = delivery.review_samples.len().saturating_sub(1000);
        delivery.review_samples.drain(..excess);
        service.save(&ledger)?;
        inner.ledger = ledger;
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn task_plan_create(
    request: RunRequest,
    assessment_id: String,
    title: String,
    state: State<'_, Coordinator>,
) -> Result<String, String> {
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.create_managed(request, assessment_id, title)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn task_plan_preview(
    id: String,
    state: State<'_, Coordinator>,
) -> Result<Vec<PlanEntry>, String> {
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.managed_plan(&id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn task_plan_start(
    id: String,
    planner_run_id: String,
    state: State<'_, Coordinator>,
) -> Result<(), String> {
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.start_managed(&id, &planner_run_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn task_plan_action(
    id: String,
    action: String,
    state: State<'_, Coordinator>,
) -> Result<(), String> {
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.managed_action(&id, &action))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> RunRequest {
        serde_json::from_value(serde_json::json!({"id":"fixture-id","projectId":"project","projectName":"Project","projectPath":".","agent":"codex","prompt":"Complete original request. Do not push.","isolated":true,"model":"pinned","connectionIds":[]})).unwrap()
    }
    fn task() -> ManagedTask {
        serde_json::from_value(serde_json::json!({"id":"parent","title":"Feature","request":request(),"plannerRunId":"planner","runIds":["planner","old"],"createdAt":"now","started":true,"error":null,"assessment":{"id":"assessment","sourceHead":"head","strategy":"parallel","parallelAvailable":true,"reason":"independent scopes","createdAt":"now","cached":false,"decision":{"version":1,"kind":"task_strategy","requestedMode":"deterministic","provider":"local_rules","policyRevision":0,"concentration":null,"fallbackReason":null,"usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"estimatedCostUsd":0,"reported":true}}}})).unwrap()
    }
    fn item(id: &str, feature: Option<&str>) -> QueueItem {
        serde_json::from_value(serde_json::json!({"id":id,"featureId":feature,"projectId":"project","projectName":"Project","projectPath":"fixture","title":id,"prompt":id,"agent":"codex","scopes":[id],"dependencies":[],"createdAt":"now","runId":null,"error":null,"canceled":false})).unwrap()
    }
    #[test]
    fn one_assignment_avoids_an_unnecessary_extra_worker() {
        let plan = parse_plan(
            r#"[{"key":"a","title":"A","prompt":"A","scopes":["src"]}]"#,
            &request(),
        )
        .unwrap();
        assert_eq!(plan.len(), 1);
    }
    #[test]
    fn managed_dispatch_is_scoped_pauses_on_restart_and_blocks_missing_attempts() {
        let mut ledger = Ledger {
            managed_tasks: vec![task()],
            items: vec![item("owned", Some("parent")), item("unrelated", None)],
            ..Default::default()
        };
        let mut inner = Inner {
            ledger: ledger.clone(),
            enabled: [dispatch_key("parent")].into(),
            concurrency: 3,
            grants: HashMap::new(),
            url: None,
            error: None,
            delivered: HashMap::new(),
        };
        assert_eq!(
            ready_items(&inner, &[], &[])
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["owned"]
        );
        inner.enabled = ["project".into()].into();
        assert_eq!(
            ready_items(&inner, &[], &[])
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["unrelated"]
        );
        ledger.items[0].run_id = Some("missing".into());
        ledger.items.push(item("dependent", Some("parent")));
        inner.ledger = ledger;
        inner.enabled = [dispatch_key("parent")].into();
        assert!(ready_items(&inner, &[], &[]).is_empty());
        let folder = std::env::temp_dir().join(format!("managed-restart-{}", Uuid::new_v4()));
        let runtime = TaskRuntime::with_test_access(folder.join("history")).unwrap();
        let service = Coordinator::new(folder.join("queue"), runtime.clone()).unwrap();
        service.save(&inner.ledger).unwrap();
        drop(service);
        let restarted = Coordinator::new(folder.join("queue"), runtime.clone()).unwrap();
        assert!(restarted.view().unwrap().enabled_projects.is_empty());
        assert_eq!(
            restarted.view().unwrap().managed_tasks[0].run_ids,
            vec!["planner", "old"]
        );
        drop(restarted);
        drop(runtime);
        std::fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn continuation_replaces_the_dependency_attempt_without_losing_history() {
        let mut step = item("owned", Some("parent"));
        step.run_id = Some("old".into());
        let mut ledger = Ledger {
            managed_tasks: vec![task()],
            items: vec![step],
            ..Default::default()
        };
        let runs = vec![
            TaskRun {
                id: "old".into(),
                task_id: "implementation".into(),
                started_at: "1".into(),
                ..Default::default()
            },
            TaskRun {
                id: "new".into(),
                task_id: "implementation".into(),
                started_at: "2".into(),
                ..Default::default()
            },
        ];
        assert!(reconcile_attempts(&mut ledger, &runs));
        assert_eq!(ledger.items[0].run_id.as_deref(), Some("new"));
        assert_eq!(
            ledger.managed_tasks[0].run_ids,
            vec!["planner", "old", "new"]
        );
        assert!(owns_run(&ledger, &runs, &runs[1]));
        assert!(!reconcile_attempts(&mut ledger, &runs));
        ledger.items[0].run_id = None;
        assert!(!reconcile_attempts(&mut ledger, &runs));
        assert!(ledger.items[0].run_id.is_none());
    }
    #[test]
    fn plan_preserves_request_and_adds_combined_verification() {
        let plan = parse_plan(r#"[{"key":"api","title":"API","prompt":"Implement API","scopes":["api"],"outcomes":["API works"]},{"key":"ui","title":"UI","prompt":"Implement UI","scopes":["ui"]}]"#, &request()).unwrap();
        assert_eq!(plan.len(), 3);
        assert_eq!(plan[2].depends_on, vec!["api", "ui"]);
        assert!(plan
            .iter()
            .all(|item| item.prompt.contains("Do not push.") && item.agent == "codex"));
        assert_eq!(plan[2].scopes, vec!["."]);
        assert_eq!(plan[2].context_selection.outcomes, vec!["API works"]);
        assert!(plan[..2]
            .iter()
            .all(|item| item.context_selection.outcomes.is_empty()));
    }
    #[test]
    fn independent_overlap_and_cycles_are_rejected() {
        assert!(parse_plan(r#"[{"key":"a","title":"A","prompt":"A","scopes":["src"]},{"key":"b","title":"B","prompt":"B","scopes":["src/file.ts"]}]"#, &request()).is_err());
        assert!(parse_plan(r#"[{"key":"a","title":"A","prompt":"A","scopes":["src"],"dependsOn":["b"]},{"key":"b","title":"B","prompt":"B","scopes":["other"],"dependsOn":["a"]}]"#, &request()).is_err());
        assert!(parse_plan(
            r#"[{"key":"a","title":"A","prompt":"A","scopes":["../outside"]}]"#,
            &request()
        )
        .is_err());
    }
    #[test]
    fn dependent_shared_ownership_is_sequential() {
        let plan = parse_plan(r#"[{"key":"a","title":"A","prompt":"A","scopes":["src"]},{"key":"b","title":"B","prompt":"B","scopes":["src/file.ts"],"dependsOn":["a"]}]"#, &request()).unwrap();
        assert_eq!(plan[1].depends_on, vec!["a"]);
    }
}
