//! Starting and following the managed task an approved plan becomes. Plan
//! mode lives in `commands::planning`; this is its narrow way into the queue.

use super::*;
use crate::commands::{decisions, task_strategy, tasks::Usage};
use serde::Serialize;

pub struct PlanLaunch {
    /// Carries the self-contained plan as its prompt.
    pub request: RunRequest,
    pub title: String,
    pub link: managed::PlanLink,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub item_id: String,
    pub title: String,
    pub run_id: Option<String>,
    pub error: Option<String>,
    pub canceled: bool,
    /// Changed files outside the task's declared scopes, not yet accepted.
    pub outside: Vec<String>,
    pub review: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDelivery {
    pub started: bool,
    pub dispatching: bool,
    pub error: Option<String>,
    pub repairs: usize,
    pub repair_limit: usize,
    pub ready_at: Option<String>,
    pub applied_at: Option<String>,
    pub items: Vec<PlanItem>,
}

impl Coordinator {
    pub(crate) fn launch_plan(&self, launch: PlanLaunch) -> Result<String, String> {
        self.runtime.access.ensure()?;
        self.ensure_storage_loaded()?;
        let request = launch.request;
        if Uuid::parse_str(&request.id).is_err() {
            return Err("Provide a valid task identifier.".into());
        }
        let source_head = task_strategy::source_head(&request)?;
        let assessment = task_strategy::Assessment {
            id: format!("plan-{}-{}", launch.link.plan_id, launch.link.revision),
            source_head,
            strategy: decisions::StrategyChoice::Parallel,
            parallel_available: true,
            reason: format!("Approved plan revision {}", launch.link.revision),
            decision: decisions::DecisionReceipt {
                evidence: None,
                version: 1,
                kind: decisions::DecisionKind::TaskStrategy,
                requested_mode: decisions::DecisionMode::Deterministic,
                provider: decisions::DecisionProvider::LocalRules,
                policy_revision: 0,
                model_call_attempted: false,
                attempts: vec![],
                concentration: None,
                fallback_reason: None,
                usage: Usage {
                    reported: true,
                    estimated_cost_usd: Some(0.0),
                    ..Default::default()
                },
            },
            created_at: Utc::now().to_rfc3339(),
            cached: false,
            auto_plan: false,
        };
        let task = managed::ManagedTask {
            delivery: Some(Default::default()),
            id: request.id.clone(),
            title: launch.title.chars().take(160).collect(),
            request,
            assessment,
            // No planner attempt: the plan session is its own conversation.
            planner_run_id: Uuid::new_v4().to_string(),
            run_ids: vec![],
            created_at: Utc::now().to_rfc3339(),
            started: false,
            error: None,
            auto_start: false,
            max_assignments: crate::commands::planning::artifact::MAX_TASKS,
            plan: Some(launch.link),
        };
        // Validate before saving so a rejected plan leaves no task behind.
        managed::plan_entries(task.plan.as_ref().unwrap(), &task)?;
        {
            let mut inner = self.inner.lock().unwrap();
            if inner.url.is_none() {
                return Err(
                    "The coordination bridge is unavailable. Retry when it is ready.".into(),
                );
            }
            if inner.ledger.managed_tasks.len() >= 500 {
                return Err("The managed task history limit has been reached.".into());
            }
            let mut ledger = inner.ledger.clone();
            ledger.managed_tasks.push(task.clone());
            self.save(&ledger)?;
            inner.ledger = ledger;
        }
        if let Err(error) = self.start_managed(&task.id, &task.planner_run_id) {
            let mut inner = self.inner.lock().unwrap();
            let mut ledger = inner.ledger.clone();
            ledger
                .managed_tasks
                .retain(|saved| saved.id != task.id || saved.started);
            self.save(&ledger)?;
            inner.ledger = ledger;
            return Err(error);
        }
        Ok(task.id)
    }

    pub(crate) fn plan_delivery(&self, id: &str) -> Result<PlanDelivery, String> {
        self.ensure_storage_loaded()?;
        let inner = self.inner.lock().unwrap();
        let task = inner
            .ledger
            .managed_tasks
            .iter()
            .find(|task| task.id == id)
            .ok_or("The plan's task is no longer in the queue.")?;
        let delivery = task.delivery.clone().unwrap_or_default();
        let items = inner
            .ledger
            .items
            .iter()
            .filter(|item| item.feature_id.as_deref() == Some(id))
            .map(|item| PlanItem {
                item_id: item.id.clone(),
                title: item.title.clone(),
                run_id: item.run_id.clone(),
                error: item.error.clone(),
                canceled: item.canceled,
                outside: inner
                    .ledger
                    .scope_audits
                    .iter()
                    .filter(|audit| audit.task_id == item.id && audit.blocked())
                    .flat_map(|audit| audit.outside.clone())
                    .collect(),
                review: delivery.integration_items.contains(&item.id),
            })
            .collect();
        Ok(PlanDelivery {
            started: task.started,
            dispatching: inner.enabled.contains(&managed::dispatch_key(id)),
            error: task.error.clone(),
            repairs: delivery.repairs.len(),
            repair_limit: delivery.repair_limit,
            ready_at: delivery.ready_at,
            applied_at: delivery.applied_at,
            items,
        })
    }

    /// `pause`, `resume` or `stop` the plan's remaining work. Pausing stops
    /// dispatch of dependent work; running assignments continue.
    pub(crate) fn plan_dispatch(&self, id: &str, action: &str) -> Result<(), String> {
        if !["pause", "resume", "stop"].contains(&action) {
            return Err("Choose pause, resume or stop.".into());
        }
        self.managed_action(id, action)
    }

    /// The managed task a running attempt works for, when it belongs to a plan.
    pub(crate) fn plan_of_run(&self, run_id: &str) -> Option<(String, String)> {
        let runs = self.runtime.integration_runs().ok()?;
        let run = runs.iter().find(|run| run.id == run_id)?;
        let inner = self.inner.lock().ok()?;
        inner.ledger.managed_tasks.iter().find_map(|task| {
            let link = task.plan.as_ref()?;
            let owned = task.run_ids.contains(&run.id)
                || inner.ledger.items.iter().any(|item| {
                    item.feature_id.as_ref() == Some(&task.id)
                        && runs.iter().any(|root| {
                            Some(&root.id) == item.run_id.as_ref() && root.task_id == run.task_id
                        })
                });
            owned.then(|| (link.plan_id.clone(), task.id.clone()))
        })
    }

    pub(crate) fn swarm_connected(&self) -> bool {
        cloud::configured(&self.runtime)
    }
}
