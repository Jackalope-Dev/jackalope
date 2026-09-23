use super::*;
use crate::commands::tasks::TaskRun;
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
    pub decision_versions: HashMap<String, Vec<(String, u64)>>,
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
            decision_versions: HashMap::new(),
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
    format!("{purpose} This isolated workspace combines frozen source snapshots and may contain Git conflict markers. Inspect source receipts and their diffs, preserve intended behavior, reconcile interfaces and remove duplicate implementations. Source ownership stays with its original workers: do not claim or transfer their paths. Respect the original scope and repository guidance. Edit only this workspace; never change source worktrees or the target checkout, commit, merge, push or launch other agents. Resolve implementation problems yourself and run the saved project verification command after your changes. Passing Git merges and individual checks do not prove the combined behavior. If an intent decision is required, ask_user with the concrete choices and wait for the answer. Report actual checks and unresolved requirements; never silently discard one assignment to pass checks. Publish a completion report with completed (including interface decisions), remaining and artifacts.\n\nComplete request:\n{request}")
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
    ledger
        .items
        .iter()
        .filter(|other| ancestors.contains(&other.id))
        .filter_map(|other| other.run_id.clone())
        .collect()
}

pub(super) fn interfaces_blocked(ledger: &Ledger, item: &QueueItem) -> bool {
    let owners = super::eligibility::ancestors(&ledger.items, item);
    ledger.agreements.iter().any(|agreement| {
        agreement.project_id == item.project_id
            && agreement.kind == "interface"
            && ["pending", "rejected"].contains(&agreement.status.as_str())
            && (owners.contains(&agreement.task_id)
                || agreement.participants.iter().any(|id| owners.contains(id)))
            && (!is_integration(ledger, item)
                || !owners.contains(&agreement.task_id)
                || agreement.participants.iter().any(|id| !owners.contains(id)))
    })
}

pub(super) fn capture_interfaces(ledger: &mut Ledger, item: &QueueItem, run_id: &str) {
    if !is_integration(ledger, item) {
        return;
    }
    let owners = super::eligibility::ancestors(&ledger.items, item);
    let versions = ledger
        .agreements
        .iter()
        .filter(|agreement| {
            agreement.project_id == item.project_id
                && agreement.kind == "interface"
                && ["pending", "rejected"].contains(&agreement.status.as_str())
                && owners.contains(&agreement.task_id)
                && agreement.participants.iter().all(|id| owners.contains(id))
        })
        .map(|agreement| (agreement.id.clone(), agreement.revision))
        .collect();
    if let Some(delivery) = ledger
        .managed_tasks
        .iter_mut()
        .find(|task| Some(&task.id) == item.feature_id.as_ref())
        .and_then(|task| task.delivery.as_mut())
    {
        delivery.decision_versions.insert(run_id.into(), versions);
    }
}

fn report_complete(ledger: &Ledger, run: &TaskRun) -> bool {
    ledger.messages.iter().any(|message| {
        message.run_id.as_ref() == Some(&run.id)
            && message.kind == "completion"
            && message.source_tree.is_some()
            && message.source_tree.as_ref()
                == run
                    .verification
                    .as_ref()
                    .and_then(|check| check.tree.as_ref())
            && message
                .report
                .as_ref()
                .is_some_and(|report| !report.completed.is_empty() && report.remaining.is_empty())
    })
}

fn pending_resolution(ledger: &Ledger, task: &managed::ManagedTask, run: &TaskRun) -> bool {
    task.delivery
        .as_ref()
        .and_then(|delivery| delivery.decision_versions.get(&run.id))
        .is_some_and(|versions| {
            versions.iter().any(|(id, _)| {
                ledger
                    .agreements
                    .iter()
                    .any(|a| &a.id == id && ["pending", "rejected"].contains(&a.status.as_str()))
            })
        })
}

fn reconcile_interfaces(
    ledger: &mut Ledger,
    task: &managed::ManagedTask,
    run: &TaskRun,
) -> Result<bool, String> {
    if !passed(run) || !report_complete(ledger, run) {
        return Ok(false);
    }
    let Some(versions) = task
        .delivery
        .as_ref()
        .and_then(|delivery| delivery.decision_versions.get(&run.id))
    else {
        return Ok(false);
    };
    if versions.is_empty()
        || versions.iter().all(|(id, _)| {
            ledger
                .agreements
                .iter()
                .any(|a| &a.id == id && a.resolution_run.as_ref() == Some(&run.id))
        })
    {
        return Ok(false);
    }
    for (id, revision) in versions {
        if ledger
            .agreements
            .iter()
            .find(|agreement| &agreement.id == id)
            .is_none_or(|agreement| agreement.revision != *revision)
        {
            return Err("An interface decision changed while this result was being checked. Review the decision and update the combined result.".into());
        }
    }
    for (id, _) in versions {
        let agreement = ledger
            .agreements
            .iter_mut()
            .find(|agreement| &agreement.id == id)
            .unwrap();
        agreement.status = "reconciled".into();
        agreement.resolution_run = Some(run.id.clone());
        agreement.revision += 1;
        agreement.updated_at = Utc::now().to_rfc3339();
        let copy = agreement.clone();
        agreements::announce(ledger, &copy, "jackalope");
    }
    Ok(true)
}

pub(super) fn validate_review(ledger: &Ledger, ids: &[String]) -> Result<(), String> {
    for task in ledger
        .managed_tasks
        .iter()
        .filter(|task| task.delivery.is_some())
    {
        let items: Vec<_> = ledger
            .items
            .iter()
            .filter(|item| item.feature_id.as_ref() == Some(&task.id))
            .collect();
        if items
            .iter()
            .any(|item| item.run_id.as_ref().is_some_and(|id| ids.contains(id)))
            && (task.error.is_some()
                || items.iter().any(|item| {
                    item.canceled
                        || item.error.is_some()
                        || item.run_id.as_ref().is_none_or(|id| !ids.contains(id))
                }))
        {
            let reason = task
                .error
                .as_deref()
                .or_else(|| items.iter().find_map(|item| item.error.as_deref()));
            return Err(match reason {
                Some(reason) => format!("This task needs attention before merging: {reason}"),
                None if items.iter().any(|item| item.canceled) =>
                    "An assignment was canceled. Resolve it in the task overview before merging.".into(),
                None => "Some assignments are missing from this merge. Open the parent task to review and merge its complete result.".into(),
            });
        }
    }
    Ok(())
}

fn passed(run: &TaskRun) -> bool {
    !run.finishing
        && matches!(run.status.as_str(), "review" | "reviewed")
        && run.error.is_none()
        && run.persistence_error.is_none()
        && !run.dependency_invalidated
        && run.verification_error.is_none()
        && run
            .verification
            .as_ref()
            .is_some_and(|check| check.result.success && check.tree.is_some())
}

pub(super) fn scope_blocked(ledger: &Ledger, item: &QueueItem, runs: &[TaskRun]) -> bool {
    let sources = source_ids(ledger, item);
    let mut covered = HashSet::new();
    if is_integration(ledger, item) {
        covered.extend(sources.iter().cloned());
    } else {
        for run in runs.iter().filter(|run| {
            sources.contains(&run.id) && passed(run) && run.dependency_snapshot.reconciles
        }) {
            covered.extend(
                run.dependency_snapshot
                    .sources
                    .iter()
                    .filter(|source| {
                        ledger.scope_audits.iter().any(|audit| {
                            audit.run_id == source.run_id
                                && audit.tree.as_ref() == Some(&source.tree)
                        })
                    })
                    .map(|source| source.run_id.clone()),
            );
        }
    }
    ledger.scope_audits.iter().any(|audit| {
        audit.project_id == item.project_id
            && audit.blocked()
            && (audit.error.is_some()
                || !covered.contains(&audit.run_id)
                || ledger.scope_audits.iter().any(|other| {
                    other.project_id == audit.project_id
                        && other.run_id != audit.run_id
                        && !covered.contains(&other.run_id)
                        && other
                            .overlaps
                            .iter()
                            .any(|path| audit.overlaps.contains(path))
                }))
    })
}

fn enqueue_checkpoint(ledger: &mut Ledger, task_id: &str, runs: &[TaskRun]) -> bool {
    let Some(task) = ledger
        .managed_tasks
        .iter()
        .find(|task| task.id == task_id)
        .cloned()
    else {
        return false;
    };
    let Some(delivery) = &task.delivery else {
        return false;
    };
    let Some(final_item) = ledger
        .items
        .iter()
        .find(|item| Some(&item.id) == delivery.final_item.as_ref())
        .cloned()
    else {
        return false;
    };
    if final_item.run_id.is_some() || !delivery.integration_items.contains(&final_item.id) {
        return false;
    }
    let items: Vec<_> = ledger
        .items
        .iter()
        .filter(|item| item.feature_id.as_deref() == Some(task_id))
        .collect();
    if items
        .iter()
        .any(|item| item.error.is_some() || item.canceled)
    {
        return false;
    }
    let complete = |item: &&QueueItem| {
        item.run_id
            .as_ref()
            .is_some_and(|id| runs.iter().any(|run| &run.id == id && passed(run)))
    };
    if items.iter().any(|item| {
        item.id != final_item.id && delivery.integration_items.contains(&item.id) && !complete(item)
    }) {
        return false;
    }
    let workers: Vec<_> = items
        .iter()
        .copied()
        .filter(|item| !delivery.integration_items.contains(&item.id))
        .collect();
    let completed: Vec<_> = workers
        .iter()
        .copied()
        .filter(complete)
        .map(|item| item.id.clone())
        .collect();
    if completed.len() < 2
        || completed.len() == workers.len()
        || completed == delivery.checked_items
    {
        return false;
    }
    let dependencies: Vec<_> = items
        .into_iter()
        .filter(complete)
        .map(|item| item.id.clone())
        .collect();
    let mut checkpoint = final_item.clone();
    checkpoint.id = Uuid::new_v4().to_string();
    checkpoint.title = "Combine and check completed work".into();
    checkpoint.prompt = integration_prompt(&task.request.prompt, false);
    checkpoint.dependencies = dependencies;
    checkpoint.created_at = Utc::now().to_rfc3339();
    checkpoint.context_selection.outcomes.clear();
    let checkpoint_id = checkpoint.id.clone();
    for item in ledger
        .items
        .iter_mut()
        .filter(|item| item.feature_id.as_deref() == Some(task_id) && item.run_id.is_none())
    {
        if item.id == final_item.id
            || (!item.dependencies.is_empty()
                && item
                    .dependencies
                    .iter()
                    .all(|id| checkpoint.dependencies.contains(id)))
        {
            item.dependencies.push(checkpoint_id.clone());
        }
    }
    let index = ledger
        .items
        .iter()
        .position(|item| item.id == final_item.id)
        .unwrap();
    ledger.items.insert(index, checkpoint);
    let saved = ledger
        .managed_tasks
        .iter_mut()
        .find(|task| task.id == task_id)
        .unwrap()
        .delivery
        .as_mut()
        .unwrap();
    saved.integration_items.push(checkpoint_id);
    saved.checked_items = completed;
    true
}

fn repair_candidate<'a>(
    ledger: &Ledger,
    task: &managed::ManagedTask,
    runs: &'a [TaskRun],
) -> Option<(QueueItem, &'a TaskRun)> {
    ledger
        .items
        .iter()
        .filter(|item| {
            item.feature_id.as_ref() == Some(&task.id) && !item.canceled && item.error.is_none()
        })
        .find_map(|item| {
            let run = runs
                .iter()
                .find(|run| Some(&run.id) == item.run_id.as_ref())?;
            if !run.finishing
                && matches!(run.status.as_str(), "review" | "reviewed")
                && run.error.is_none()
                && run.persistence_error.is_none()
                && !run.dependency_invalidated
                && run.verification.as_ref().is_some_and(|check| {
                    !check.result.success
                        || (pending_resolution(ledger, task, run) && !report_complete(ledger, run))
                })
                && !ledger
                    .items
                    .iter()
                    .any(|child| child.dependencies.contains(&item.id) && child.run_id.is_some())
                && !runs.iter().any(|other| {
                    other
                        .dependency_snapshot
                        .sources
                        .iter()
                        .any(|source| source.run_id == run.id)
                })
            {
                Some((item.clone(), run))
            } else {
                None
            }
        })
}

impl Coordinator {
    pub(super) fn deliver_managed_locked(
        &self,
        inner: &mut Inner,
        runs: &[TaskRun],
        merged: &[String],
        url: &str,
    ) -> Result<bool, String> {
        let mut ledger = inner.ledger.clone();
        let mut changed = false;
        for task in &mut ledger.managed_tasks {
            let Some(delivery) = &mut task.delivery else {
                continue;
            };
            if !task.started {
                continue;
            }
            let items: Vec<_> = ledger
                .items
                .iter()
                .filter(|item| item.feature_id.as_ref() == Some(&task.id))
                .collect();
            let workers: Vec<_> = items
                .iter()
                .filter(|item| !delivery.integration_items.contains(&item.id))
                .collect();
            if !workers.is_empty()
                && workers.iter().all(|item| {
                    item.run_id.as_ref().is_some_and(|id| {
                        runs.iter()
                            .any(|run| &run.id == id && !active(&run.status) && !run.finishing)
                    })
                })
                && delivery.workers_finished_at.is_none()
            {
                delivery.workers_finished_at = workers
                    .iter()
                    .filter_map(|item| {
                        runs.iter()
                            .find(|run| Some(&run.id) == item.run_id.as_ref())
                            .and_then(|run| run.ended_at.clone())
                    })
                    .max();
                changed = true;
            }
            let final_run = items
                .iter()
                .find(|item| Some(&item.id) == delivery.final_item.as_ref())
                .and_then(|item| {
                    runs.iter()
                        .find(|run| Some(&run.id) == item.run_id.as_ref())
                });
            let ready = final_run.is_some_and(passed)
                && task.error.is_none()
                && items.iter().all(|item| {
                    !item.canceled
                        && item.error.is_none()
                        && runs
                            .iter()
                            .any(|run| Some(&run.id) == item.run_id.as_ref() && passed(run))
                })
                && !ledger.agreements.iter().any(|agreement| {
                    agreement.kind == "interface"
                        && ["pending", "rejected"].contains(&agreement.status.as_str())
                        && items.iter().any(|item| {
                            agreement.task_id == item.id
                                || agreement.participants.contains(&item.id)
                        })
                });
            if ready && delivery.ready_at.is_none() {
                delivery.ready_at = Some(Utc::now().to_rfc3339());
                changed = true;
            } else if !ready && delivery.ready_at.is_some() && delivery.applied_at.is_none() {
                delivery.ready_at = None;
                changed = true;
            }
            if !items.is_empty()
                && items
                    .iter()
                    .all(|item| item.run_id.as_ref().is_some_and(|id| merged.contains(id)))
                && delivery.applied_at.is_none()
            {
                delivery.applied_at = Some(Utc::now().to_rfc3339());
                changed = true;
            }
        }
        let tasks = ledger.managed_tasks.clone();
        for task in &tasks {
            if task.error.is_some() || !inner.enabled.contains(&managed::dispatch_key(&task.id)) {
                continue;
            }
            let completed: Vec<_> = runs
                .iter()
                .filter(|run| {
                    task.run_ids.contains(&run.id)
                        && passed(run)
                        && pending_resolution(&ledger, task, run)
                        && report_complete(&ledger, run)
                })
                .collect();
            for run in completed {
                let directory = self.runtime.integration_directory();
                let checked = (|| {
                    crate::commands::integration::validate_dependencies(&directory, runs, run)?;
                    let tree = crate::commands::integration::workspace_tree(run, &directory)?;
                    crate::commands::integration::dependencies::verified(run, &tree)?;
                    reconcile_interfaces(&mut ledger, task, run)
                })();
                match checked {
                    Ok(updated) => changed |= updated,
                    Err(error) => {
                        ledger
                            .managed_tasks
                            .iter_mut()
                            .find(|saved| saved.id == task.id)
                            .unwrap()
                            .error = Some(error);
                        inner.enabled.remove(&managed::dispatch_key(&task.id));
                        changed = true;
                    }
                }
            }
        }
        for task in tasks.iter().filter(|task| {
            task.started
                && task.delivery.is_some()
                && task.error.is_none()
                && inner.enabled.contains(&managed::dispatch_key(&task.id))
        }) {
            changed |= enqueue_checkpoint(&mut ledger, &task.id, runs);
        }
        if changed {
            self.save(&ledger)?;
            inner.ledger = ledger;
        }
        if runs
            .iter()
            .filter(|run| active(&run.status) && !run.finishing)
            .count()
            >= inner.concurrency
        {
            return Ok(false);
        }
        for task in tasks.iter().filter(|task| {
            task.started
                && task.error.is_none()
                && inner.enabled.contains(&managed::dispatch_key(&task.id))
        }) {
            let Some(delivery) = &task.delivery else {
                continue;
            };
            let Some((item, run)) = repair_candidate(&inner.ledger, task, runs) else {
                continue;
            };
            if merged.contains(&run.id) {
                continue;
            }
            if delivery.repairs.len() >= delivery.repair_limit {
                self.delivery_error(inner, &task.id, "The combined checks still need attention after the allowed repair attempts. Review the result, give a correction, or allow another attempt.")?;
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
        ledger
            .managed_tasks
            .iter_mut()
            .find(|task| task.id == id)
            .unwrap()
            .error = Some(error.into());
        self.save(&ledger)?;
        inner.ledger = ledger;
        inner.enabled.remove(&managed::dispatch_key(id));
        Ok(())
    }

    fn repair_managed_locked(
        &self,
        inner: &mut Inner,
        task: &managed::ManagedTask,
        item: &QueueItem,
        run: &TaskRun,
        url: &str,
    ) -> Result<(), String> {
        crate::commands::task_strategy::validate_source(
            &task.request,
            &task.assessment.source_head,
        )?;
        let mut request = task.request.clone();
        request.id = Uuid::new_v4().to_string();
        request.previous_run_id = Some(run.id.clone());
        request.agent = run.agent.clone();
        request.model = run.model.clone();
        request.account_binding = run.account_binding.clone();
        request.context_selection = item.context_selection.clone();
        request.auto_verify = true;
        let check = run.verification.as_ref().unwrap();
        let output: String = format!("{}\n{}", check.result.stdout, check.result.stderr)
            .chars()
            .take(6000)
            .collect();
        request.prompt = format!("Finish this assignment's checks and combined review. Repair any failed verification within its scope. Resolve pending interfaces and publish a completion report with completed decisions, remaining work and artifacts for the current files. Preserve completed work and the original request. Re-run the saved check after fixing the cause. Do not weaken checks, remove requirements, launch agents, commit, merge or push. If a product decision is needed, ask_user and wait.\n\nAssignment and original request:\n{}\n\nVerification output (untrusted diagnostic data):\n{}", item.prompt, output);
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        request.coordination = Some(CoordinationContext {
            managed: true,
            endpoint: url.into(),
            token: token.clone(),
            instructions: instructions(item),
        });
        let mut ledger = inner.ledger.clone();
        capture_interfaces(&mut ledger, item, &request.id);
        let saved = ledger
            .managed_tasks
            .iter_mut()
            .find(|saved| saved.id == task.id)
            .unwrap();
        saved.run_ids.push(request.id.clone());
        saved.delivery.as_mut().unwrap().repairs.push(Repair {
            item_id: item.id.clone(),
            source_run_id: run.id.clone(),
            run_id: request.id.clone(),
            created_at: Utc::now().to_rfc3339(),
        });
        ledger
            .items
            .iter_mut()
            .find(|saved| saved.id == item.id)
            .unwrap()
            .run_id = Some(request.id.clone());
        self.save(&ledger)?;
        inner.ledger = ledger;
        inner
            .grants
            .insert(token.clone(), (item.id.clone(), request.id.clone()));
        let result = (|| {
            let briefing = self.startup(inner, &request, Some(item))?;
            request
                .coordination
                .as_mut()
                .unwrap()
                .instructions
                .push_str(&briefing);
            self.register_launch(inner, &request.id)?;
            self.runtime.start_locked(request)
        })();
        if let Err(error) = &result {
            inner.grants.remove(&token);
            let mut ledger = inner.ledger.clone();
            ledger
                .items
                .iter_mut()
                .find(|saved| saved.id == item.id)
                .unwrap()
                .error = Some(error.clone());
            self.save(&ledger)?;
            inner.ledger = ledger;
        }
        result.map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Ledger, Vec<TaskRun>) {
        let task: managed::ManagedTask = serde_json::from_value(serde_json::json!({
            "id":"parent", "title":"Feature", "request":{"id":"parent","projectId":"p","projectName":"Project","projectPath":"fixture","agent":"codex","prompt":"Preserve the requested behavior","isolated":true},
            "assessment":{"id":"assessment","sourceHead":"head","strategy":"parallel","parallelAvailable":true,"reason":"independent","createdAt":"now","cached":false,"decision":{"version":1,"kind":"task_strategy","requestedMode":"deterministic","provider":"local_rules","policyRevision":0,"usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"reported":true}}},
            "plannerRunId":"planner", "runIds":["a","b","c"],"createdAt":"now","started":true,"error":null,
            "delivery":{"finalItem":"final","integrationItems":["final"]}
        })).unwrap();
        let items = ["a","b","c","final"].into_iter().map(|id| serde_json::from_value(serde_json::json!({
            "id":id,"featureId":"parent","projectId":"p","projectName":"Project","projectPath":"fixture",
            "title":id,"prompt":"Complete request","agent":"codex","scopes":if id == "final" { vec!["."] } else { vec![id] },
            "dependencies":if id == "final" { vec!["a","b","c"] } else { vec![] },
            "createdAt":"now","runId":if id == "final" { None } else { Some(id) },"error":null,"canceled":false,"stagedDependencies":true
        })).unwrap()).collect();
        let runs = ["a","b","c"].into_iter().map(|id| serde_json::from_value(serde_json::json!({
            "id":id,"taskId":id,"projectId":"p","projectName":"Project","projectPath":"fixture","workspace":format!("fixture/{id}"),
            "branch":id,"baseHead":"base","agent":"codex","account":"fixture","model":null,"prompt":"Original request","status":if id == "c" { "running" } else { "review" },
            "startedAt":"2026-09-16T00:00:00Z","endedAt":"2026-09-16T00:01:00Z","sessionId":null,"result":"Done","activity":[],"diagnostics":[],"error":null,"persistenceError":null,"exitCode":0,
            "usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"reported":false},"verifyCommand":"check",
            "verification":{"command":"check","checkedAt":"now","tree":id,"result":{"success":true,"exitCode":0,"stdout":"","stderr":"","durationMs":1,"timedOut":false,"truncated":false}}
        })).unwrap()).collect();
        (
            Ledger {
                managed_tasks: vec![task],
                items,
                ..Default::default()
            },
            runs,
        )
    }

    #[test]
    fn merge_blockers_explain_task_errors_and_incomplete_selections() {
        let (mut ledger, _) = fixture();
        let ids = vec!["a".into(), "b".into(), "c".into(), "final".into()];
        ledger.items.last_mut().unwrap().run_id = Some("final".into());
        assert!(validate_review(&ledger, &ids).is_ok());
        ledger.managed_tasks[0].error = Some("The target branch changed.".into());
        assert_eq!(
            validate_review(&ledger, &ids).unwrap_err(),
            "This task needs attention before merging: The target branch changed."
        );
        ledger.managed_tasks[0].error = None;
        ledger.items[0].error = Some("Required check failed.".into());
        assert!(validate_review(&ledger, &ids)
            .unwrap_err()
            .contains("Required check failed."));
        ledger.items[0].error = None;
        ledger.items[0].canceled = true;
        assert!(validate_review(&ledger, &ids)
            .unwrap_err()
            .contains("canceled"));
        ledger.items[0].canceled = false;
        assert!(validate_review(&ledger, &ids[..2])
            .unwrap_err()
            .contains("assignments are missing"));
        assert!(validate_review(&ledger, &["unrelated".into()]).is_ok());
    }

    #[test]
    fn finished_work_is_combined_while_independent_work_continues_once_per_group() {
        let (mut ledger, runs) = fixture();
        assert!(enqueue_checkpoint(&mut ledger, "parent", &runs));
        let checkpoint = ledger
            .items
            .iter()
            .find(|item| item.title == "Combine and check completed work")
            .unwrap();
        assert_eq!(checkpoint.dependencies, ["a", "b"]);
        assert!(ledger
            .items
            .last()
            .unwrap()
            .dependencies
            .contains(&checkpoint.id));
        assert!(!ledger
            .items
            .iter()
            .find(|item| item.id == "c")
            .unwrap()
            .dependencies
            .contains(&checkpoint.id));
        assert!(!enqueue_checkpoint(&mut ledger, "parent", &runs));
        let inner = Inner {
            ledger,
            enabled: ["managed:parent".into()].into(),
            concurrency: 3,
            grants: HashMap::new(),
            url: Some("fixture".into()),
            error: None,
            delivered: HashMap::new(),
        };
        let ready = ready_items(&inner, &runs, &[]);
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].title, "Combine and check completed work");
    }

    #[test]
    fn pending_consumers_receive_the_checked_combination_and_final_review_keeps_all_sources() {
        let (mut ledger, mut runs) = fixture();
        ledger.items[2].run_id = None;
        ledger.items[2].dependencies = vec!["a".into(), "b".into()];
        runs.pop();
        assert!(enqueue_checkpoint(&mut ledger, "parent", &runs));
        let checkpoint = &ledger.items[3];
        assert!(ledger.items[2].dependencies.contains(&checkpoint.id));
        assert!(source_ids(&ledger, ledger.items.last().unwrap()).contains(&"a".into()));
        assert!(validate_review(&ledger, &["a".into(), "b".into()]).is_err());
        assert_eq!(ledger.items.last().unwrap().id, "final");
    }

    #[test]
    fn single_finished_assignment_waits_without_launching_an_extra_agent() {
        let (mut ledger, mut runs) = fixture();
        runs[1].status = "running".into();
        assert!(!enqueue_checkpoint(&mut ledger, "parent", &runs));
        runs[1].status = "review".into();
        runs[2].status = "review".into();
        assert!(!enqueue_checkpoint(&mut ledger, "parent", &runs));
    }

    #[test]
    fn repair_only_continues_finished_checks_without_consumers_or_lost_process_ownership() {
        let (mut ledger, mut runs) = fixture();
        runs[0].verification.as_mut().unwrap().result.success = false;
        assert_eq!(
            repair_candidate(&ledger, &ledger.managed_tasks[0], &runs)
                .unwrap()
                .1
                .id,
            "a"
        );
        for status in ["running", "stopped", "interrupted", "failed"] {
            runs[0].status = status.into();
            assert!(repair_candidate(&ledger, &ledger.managed_tasks[0], &runs).is_none());
        }
        runs[0].status = "review".into();
        ledger.items[2].dependencies.push("a".into());
        assert!(repair_candidate(&ledger, &ledger.managed_tasks[0], &runs).is_none());
        let saved: Ledger = serde_json::from_value(serde_json::to_value(&ledger).unwrap()).unwrap();
        assert_eq!(
            saved.managed_tasks[0]
                .delivery
                .as_ref()
                .unwrap()
                .repair_limit,
            2
        );
    }

    #[test]
    fn exhausted_repairs_pause_durably_without_replaying_work_after_restart() {
        let repo = super::super::agreement_tests::Repo::new();
        let history = repo.root.join("history");
        std::fs::create_dir(&history).unwrap();
        let runtime = TaskRuntime::with_test_access(history.clone()).unwrap();
        let directory = repo.root.join("queue");
        let service = Coordinator::new(directory.clone(), runtime).unwrap();
        let (mut ledger, mut runs) = fixture();
        ledger.managed_tasks[0]
            .delivery
            .as_mut()
            .unwrap()
            .repair_limit = 0;
        runs[0].verification.as_mut().unwrap().result.success = false;
        let mut inner = service.inner.lock().unwrap();
        inner.ledger = ledger;
        inner.enabled.insert("managed:parent".into());
        assert!(service
            .deliver_managed_locked(&mut inner, &runs, &[], "http://fixture")
            .unwrap());
        assert!(!inner.enabled.contains("managed:parent"));
        assert!(inner.ledger.managed_tasks[0].error.is_some());
        assert_eq!(inner.ledger.items[0].run_id.as_deref(), Some("a"));
        assert!(!service
            .deliver_managed_locked(&mut inner, &runs, &[], "http://fixture")
            .unwrap());
        drop(inner);
        drop(service);
        let restarted =
            Coordinator::new(directory, TaskRuntime::with_test_access(history).unwrap()).unwrap();
        let inner = restarted.inner.lock().unwrap();
        assert!(inner.enabled.is_empty());
        assert!(inner.ledger.managed_tasks[0].error.is_some());
        assert!(inner.ledger.managed_tasks[0]
            .delivery
            .as_ref()
            .unwrap()
            .repairs
            .is_empty());
    }

    #[test]
    fn interface_reconciliation_requires_current_decisions_and_a_snapshot_bound_report() {
        let (mut ledger, mut runs) = fixture();
        ledger.agreements.push(serde_json::from_value(serde_json::json!({
            "id":"api", "projectId":"p", "taskId":"a", "kind":"interface", "resource":"API response", "paths":["api.ts"],
            "text":"Use the agreed response", "participants":["b"], "acceptedBy":["a"], "status":"rejected", "revision":2,
            "createdAt":"now", "updatedAt":"now"
        })).unwrap());
        let item = ledger.items[3].clone();
        assert!(!interfaces_blocked(&ledger, &item));
        let mut resolver = runs[0].clone();
        resolver.id = "combined".into();
        resolver.task_id = "combined".into();
        capture_interfaces(&mut ledger, &item, &resolver.id);
        ledger.items[3].run_id = Some(resolver.id.clone());
        let task = ledger.managed_tasks[0].clone();
        assert!(!reconcile_interfaces(&mut ledger, &task, &resolver).unwrap());
        runs.push(resolver.clone());
        assert_eq!(
            repair_candidate(&ledger, &task, &runs).unwrap().1.id,
            "combined"
        );
        ledger.messages.push(CoordinationMessage {
            id: "report".into(),
            task_id: "final".into(),
            project_id: "p".into(),
            kind: "completion".into(),
            text: "Resolved".into(),
            created_at: "now".into(),
            recipient_task_id: None,
            acknowledged_by: vec![],
            run_id: Some(resolver.id.clone()),
            source_tree: Some("stale".into()),
            resolved_by: None,
            report: Some(WorkReport {
                completed: vec!["Response contract reconciled".into()],
                remaining: vec![],
                artifacts: vec![],
            }),
        });
        assert!(!reconcile_interfaces(&mut ledger, &task, &resolver).unwrap());
        ledger.messages[0].source_tree = resolver.verification.as_ref().unwrap().tree.clone();
        ledger.agreements[0].revision += 1;
        assert!(reconcile_interfaces(&mut ledger, &task, &resolver).is_err());
        assert_eq!(ledger.agreements[0].status, "rejected");
        ledger.agreements[0].revision -= 1;
        assert!(reconcile_interfaces(&mut ledger, &task, &resolver).unwrap());
        assert_eq!(ledger.agreements[0].status, "reconciled");
        assert_eq!(ledger.agreements[0].accepted_by, ["a"]);
        assert_eq!(
            ledger.agreements[0].resolution_run.as_deref(),
            Some("combined")
        );
        assert!(!reconcile_interfaces(&mut ledger, &task, &resolver).unwrap());
        ledger.agreements[0].status = "pending".into();
        ledger.agreements[0]
            .participants
            .push("outside-task".into());
        assert!(interfaces_blocked(&ledger, &item));
    }

    #[test]
    fn integration_can_reconcile_its_sources_but_never_bypass_unrelated_scope_errors() {
        let (mut ledger, runs) = fixture();
        for id in ["a", "b"] {
            ledger
                .scope_audits
                .push(super::super::scope_audit::ScopeAudit {
                    project_id: "p".into(),
                    task_id: id.into(),
                    run_id: id.into(),
                    tree: Some(id.into()),
                    outside: vec![],
                    overlaps: vec!["shared.ts".into()],
                    error: None,
                    accepted_tree: None,
                });
        }
        assert!(!scope_blocked(&ledger, &ledger.items[3], &runs));
        assert!(scope_blocked(&ledger, &ledger.items[2], &runs));
        let mut external = ledger.scope_audits[0].clone();
        external.run_id = "external".into();
        ledger.scope_audits.push(external);
        assert!(scope_blocked(&ledger, &ledger.items[3], &runs));
        ledger.scope_audits.pop();
        ledger.scope_audits[0].error = Some("Cannot read current files".into());
        assert!(scope_blocked(&ledger, &ledger.items[3], &runs));
    }
}
