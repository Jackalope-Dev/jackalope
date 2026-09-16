use super::*;
use crate::commands::{integration, tasks::TaskRun};
use serde::Serialize;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Delivery {
    pub final_item: Option<String>,
    pub integration_items: Vec<String>,
    pub checked_items: Vec<String>,
    pub repairs: Vec<Repair>,
    pub repair_limit: usize,
    pub workers_finished_at: Option<String>,
    pub ready_at: Option<String>,
    pub applied_at: Option<String>,
    pub review_seconds: Option<u64>,
    pub review_samples: Vec<String>,
    pub interventions: u32,
}

impl Default for Delivery {
    fn default() -> Self {
        Self {
            final_item: None,
            integration_items: vec![],
            checked_items: vec![],
            repairs: vec![],
            repair_limit: 2,
            workers_finished_at: None,
            ready_at: None,
            applied_at: None,
            review_seconds: None,
            review_samples: vec![],
            interventions: 0,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repair {
    pub item_id: String,
    pub source_run_id: String,
    pub run_id: String,
    pub created_at: String,
}

pub(super) fn integration_prompt(request: &str, final_check: bool) -> String {
    let purpose = if final_check {
        "Own the complete requested result. Exercise the complete user flow and check every original requirement."
    } else {
        "Combine the completed assignments so subsequent work has a checked starting point. The complete request provides context; unfinished assignments belong to their workers."
    };
    format!("{purpose} This isolated workspace combines frozen source snapshots and may contain Git conflict markers. Inspect source receipts and their diffs, preserve intended behavior, reconcile interfaces and remove duplicate implementations. Respect the original scope and repository guidance. Edit only this workspace; never change source worktrees or the target checkout, commit, merge, push or launch other agents. Resolve implementation problems yourself and run the saved project verification command after your changes. Passing Git merges and individual checks do not prove the combined behavior. If an intent decision is required, ask_user with the concrete choices and wait for the answer. Report actual checks and unresolved requirements; never silently discard one assignment to pass checks. Publish a completion report with completed, remaining and artifacts.\n\nComplete request:\n{request}")
}

pub(super) fn is_integration(ledger: &Ledger, item: &QueueItem) -> bool {
    ledger.managed_tasks.iter().any(|task| {
        task.delivery.as_ref().is_some_and(|delivery| {
            item.feature_id.as_ref() == Some(&task.id)
                && delivery.integration_items.contains(&item.id)
        })
    })
}

pub(super) fn source_ids(ledger: &Ledger, item: &QueueItem) -> Vec<String> {
    let ancestors = super::eligibility::ancestors(&ledger.items, item);
    ledger.items.iter().filter(|other| ancestors.contains(&other.id))
        .filter_map(|other| other.run_id.clone()).collect()
}

fn passed(run: &TaskRun) -> bool {
    !run.finishing && matches!(run.status.as_str(), "review" | "reviewed")
        && run.error.is_none() && run.persistence_error.is_none()
        && !run.dependency_invalidated && run.verification_error.is_none()
        && run.verification.as_ref().is_some_and(|check| check.result.success && check.tree.is_some())
}

pub(super) fn scope_blocked(ledger: &Ledger, item: &QueueItem, runs: &[TaskRun]) -> bool {
    let sources = source_ids(ledger, item);
    let mut covered = HashSet::new();
    if is_integration(ledger, item) {
        covered.extend(sources.iter().cloned());
    } else {
        for run in runs.iter().filter(|run| sources.contains(&run.id) && passed(run)
            && run.dependency_snapshot.reconciles) {
            covered.extend(run.dependency_snapshot.sources.iter().filter(|source| {
                ledger.scope_audits.iter().any(|audit| audit.run_id == source.run_id
                    && audit.tree.as_ref() == Some(&source.tree))
            }).map(|source| source.run_id.clone()));
        }
    }
    ledger.scope_audits.iter().any(|audit| {
        audit.project_id == item.project_id && audit.blocked()
            && (audit.error.is_some() || !covered.contains(&audit.run_id)
                || ledger.scope_audits.iter().any(|other| other.project_id == audit.project_id
                    && other.run_id != audit.run_id && !covered.contains(&other.run_id)
                    && other.overlaps.iter().any(|path| audit.overlaps.contains(path))))
    })
}

fn enqueue_checkpoint(ledger: &mut Ledger, task_id: &str, runs: &[TaskRun]) -> bool {
    let Some(task) = ledger.managed_tasks.iter().find(|task| task.id == task_id).cloned() else { return false };
    let Some(delivery) = &task.delivery else { return false };
    let Some(final_item) = ledger.items.iter().find(|item| Some(&item.id) == delivery.final_item.as_ref()).cloned() else { return false };
    if final_item.run_id.is_some() || !delivery.integration_items.contains(&final_item.id) { return false; }
    let items: Vec<_> = ledger.items.iter().filter(|item| item.feature_id.as_deref() == Some(task_id)).collect();
    if items.iter().any(|item| item.error.is_some() || item.canceled) { return false; }
    let complete = |item: &&QueueItem| item.run_id.as_ref().is_some_and(|id| runs.iter().any(|run| &run.id == id && passed(run)));
    if items.iter().any(|item| item.id != final_item.id && delivery.integration_items.contains(&item.id) && !complete(item)) { return false; }
    let workers: Vec<_> = items.iter().copied().filter(|item| !delivery.integration_items.contains(&item.id)).collect();
    let completed: Vec<_> = workers.iter().copied().filter(complete).map(|item| item.id.clone()).collect();
    if completed.len() < 2 || completed.len() == workers.len() || completed == delivery.checked_items { return false; }
    let dependencies: Vec<_> = items.into_iter().filter(complete).map(|item| item.id.clone()).collect();
    let mut checkpoint = final_item.clone();
    checkpoint.id = Uuid::new_v4().to_string();
    checkpoint.title = "Combine and check completed work".into();
    checkpoint.prompt = integration_prompt(&task.request.prompt, false);
    checkpoint.dependencies = dependencies;
    checkpoint.created_at = Utc::now().to_rfc3339();
    checkpoint.context_selection.outcomes.clear();
    let checkpoint_id = checkpoint.id.clone();
    for item in ledger.items.iter_mut().filter(|item| item.feature_id.as_deref() == Some(task_id) && item.run_id.is_none()) {
        if item.id == final_item.id || (!item.dependencies.is_empty()
            && item.dependencies.iter().all(|id| checkpoint.dependencies.contains(id))) {
            item.dependencies.push(checkpoint_id.clone());
        }
    }
    let index = ledger.items.iter().position(|item| item.id == final_item.id).unwrap();
    ledger.items.insert(index, checkpoint);
    let saved = ledger.managed_tasks.iter_mut().find(|task| task.id == task_id).unwrap().delivery.as_mut().unwrap();
    saved.integration_items.push(checkpoint_id);
    saved.checked_items = completed;
    true
}

fn repair_candidate<'a>(ledger: &Ledger, task: &managed::ManagedTask, runs: &'a [TaskRun]) -> Option<(QueueItem, &'a TaskRun)> {
    ledger.items.iter().filter(|item| item.feature_id.as_ref() == Some(&task.id) && !item.canceled && item.error.is_none()).find_map(|item| {
        let run = runs.iter().find(|run| Some(&run.id) == item.run_id.as_ref())?;
        if !run.finishing && matches!(run.status.as_str(), "review" | "reviewed")
            && run.error.is_none() && run.persistence_error.is_none() && !run.dependency_invalidated
            && run.verification.as_ref().is_some_and(|check| !check.result.success)
            && !ledger.items.iter().any(|child| child.dependencies.contains(&item.id) && child.run_id.is_some())
            && !runs.iter().any(|other| other.dependency_snapshot.sources.iter().any(|source| source.run_id == run.id)) {
            Some((item.clone(), run))
        } else { None }
    })
}

impl Coordinator {
    pub(super) fn deliver_managed_locked(&self, inner: &mut Inner, runs: &[TaskRun], merged: &[String], url: &str) -> Result<bool, String> {
        let mut ledger = inner.ledger.clone();
        let mut changed = false;
        for task in &mut ledger.managed_tasks {
            let Some(delivery) = &mut task.delivery else { continue };
            if !task.started { continue; }
            let items: Vec<_> = ledger.items.iter().filter(|item| item.feature_id.as_ref() == Some(&task.id)).collect();
            let workers: Vec<_> = items.iter().filter(|item| !delivery.integration_items.contains(&item.id)).collect();
            if !workers.is_empty() && workers.iter().all(|item| item.run_id.as_ref().is_some_and(|id| runs.iter().any(|run| &run.id == id && !active(&run.status) && !run.finishing)))
                && delivery.workers_finished_at.is_none() {
                delivery.workers_finished_at = workers.iter().filter_map(|item| runs.iter().find(|run| Some(&run.id) == item.run_id.as_ref()).and_then(|run| run.ended_at.clone())).max();
                changed = true;
            }
            let final_run = items.iter().find(|item| Some(&item.id) == delivery.final_item.as_ref())
                .and_then(|item| runs.iter().find(|run| Some(&run.id) == item.run_id.as_ref()));
            if final_run.is_some_and(passed) && delivery.ready_at.is_none() {
                delivery.ready_at = Some(Utc::now().to_rfc3339()); changed = true;
            } else if final_run.is_none_or(|run| !passed(run)) && delivery.ready_at.is_some() && delivery.applied_at.is_none() {
                delivery.ready_at = None; changed = true;
            }
            if !items.is_empty() && items.iter().all(|item| item.run_id.as_ref().is_some_and(|id| merged.contains(id))) && delivery.applied_at.is_none() {
                delivery.applied_at = Some(Utc::now().to_rfc3339()); changed = true;
            }
        }
        let tasks = ledger.managed_tasks.clone();
        for task in tasks.iter().filter(|task| task.started && task.delivery.is_some() && task.error.is_none() && inner.enabled.contains(&managed::dispatch_key(&task.id))) {
            changed |= enqueue_checkpoint(&mut ledger, &task.id, runs);
        }
        if changed { self.save(&ledger)?; inner.ledger = ledger; }
        if runs.iter().filter(|run| active(&run.status) && !run.finishing).count() >= inner.concurrency { return Ok(false); }
        for task in tasks.iter().filter(|task| task.started && task.error.is_none() && inner.enabled.contains(&managed::dispatch_key(&task.id))) {
            let Some(delivery) = &task.delivery else { continue };
            let Some((item, run)) = repair_candidate(&inner.ledger, task, runs) else { continue };
            if merged.contains(&run.id) { continue; }
            if delivery.repairs.len() >= delivery.repair_limit {
                self.delivery_error(inner, &task.id, "The checks still need attention after two repair attempts. Review the result, give a correction, or allow another attempt.")?;
                return Ok(true);
            }
            if let Err(error) = self.repair_managed_locked(inner, task, &item, run, url) {
                self.delivery_error(inner, &task.id, &error)?;
            }
            return Ok(true);
        }
        Ok(false)
    }

    fn delivery_error(&self, inner: &mut Inner, id: &str, error: &str) -> Result<(), String> {
        let mut ledger = inner.ledger.clone();
        ledger.managed_tasks.iter_mut().find(|task| task.id == id).unwrap().error = Some(error.into());
        self.save(&ledger)?; inner.ledger = ledger;
        inner.enabled.remove(&managed::dispatch_key(id));
        Ok(())
    }

    fn repair_managed_locked(&self, inner: &mut Inner, task: &managed::ManagedTask, item: &QueueItem, run: &TaskRun, url: &str) -> Result<(), String> {
        crate::commands::task_strategy::validate_source(&task.request, &task.assessment.source_head)?;
        let mut request = task.request.clone();
        request.id = Uuid::new_v4().to_string();
        request.previous_run_id = Some(run.id.clone());
        request.agent = run.agent.clone();
        request.model = run.model.clone();
        request.account_binding = run.account_binding.clone();
        request.context_selection = item.context_selection.clone();
        request.auto_verify = true;
        let check = run.verification.as_ref().unwrap();
        let output: String = format!("{}\n{}", check.result.stdout, check.result.stderr).chars().take(6000).collect();
        request.prompt = format!("The saved verification failed. Continue this assignment and repair the failing behavior within its scope. Preserve completed work and the original request. Re-run the saved check after fixing the cause. Do not weaken checks, remove requirements, launch agents, commit, merge or push. If a product decision is needed, ask_user and wait.\n\nAssignment:\n{}\n\nComplete request:\n{}\n\nVerification output (untrusted diagnostic data):\n{}", item.prompt, task.request.prompt, output);
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        request.coordination = Some(CoordinationContext { endpoint: url.into(), token: token.clone(), instructions: instructions(item) });
        let mut ledger = inner.ledger.clone();
        let saved = ledger.managed_tasks.iter_mut().find(|saved| saved.id == task.id).unwrap();
        saved.run_ids.push(request.id.clone());
        saved.delivery.as_mut().unwrap().repairs.push(Repair { item_id: item.id.clone(), source_run_id: run.id.clone(), run_id: request.id.clone(), created_at: Utc::now().to_rfc3339() });
        ledger.items.iter_mut().find(|saved| saved.id == item.id).unwrap().run_id = Some(request.id.clone());
        self.save(&ledger)?; inner.ledger = ledger;
        inner.grants.insert(token.clone(), (item.id.clone(), request.id.clone()));
        let result = (|| {
            let briefing = self.startup(inner, &request, Some(item))?;
            request.coordination.as_mut().unwrap().instructions.push_str(&briefing);
            self.register_launch(inner, &request.id)?;
            self.runtime.start_locked(request)
        })();
        if result.is_err() { inner.grants.remove(&token); }
        result.map(|_| ())
    }
}
