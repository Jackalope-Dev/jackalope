//! The capacity pool from the coordinator's side: refreshing it each dispatch
//! tick, working out what each waiting planned fork needs from its host, and
//! retrying once on another host a fork whose host was lost.

use super::*;
use crate::commands::computers::{
    credentials,
    pool::{self, Decision, Needs},
};
use crate::commands::project_secrets::{self, Availability, Place};
use crate::commands::tasks::TaskRun;

impl Coordinator {
    /// Reloads the pool's computers, health and project choices, and the
    /// needs of planned forks that are waiting to start.
    pub(super) fn refresh_pool_locked(&self, inner: &mut Inner) {
        let mut fresh = pool::Pool::load(&self.runtime.computers_root());
        inner.remote_projects = fresh
            .computers
            .iter()
            .filter_map(|computer| computer.pinned_by.clone())
            .collect();
        let waiting: Vec<QueueItem> = inner
            .ledger
            .items
            .iter()
            .filter(|item| {
                item.feature_id.is_some()
                    && item.run_id.is_none()
                    && !item.canceled
                    && item.error.is_none()
            })
            .cloned()
            .collect();
        for item in waiting {
            let needs = match inner.pool.needs.get(&item.id) {
                Some(needs) => needs.clone(),
                None => self.needs(&inner.ledger, &item),
            };
            fresh.needs.insert(item.id, needs);
        }
        inner.pool = fresh;
    }

    /// What a planned fork needs from its host, from what it declares: an
    /// agent that cannot run on a computer, project secrets its instructions
    /// name that only this device or only computers hold, connections
    /// selected for its plan that cannot reach a computer, and criteria
    /// checked in a browser.
    pub(super) fn needs(&self, ledger: &Ledger, item: &QueueItem) -> Needs {
        let mut needs =
            Needs {
                browser: item.context_selection.outcomes.iter().any(|outcome| {
                    outcome.contains(crate::commands::planning::handoff::BROWSER_TAG)
                }),
                ..Default::default()
            };
        let adapter = self
            .runtime
            .policy()
            .ok()
            .and_then(|policy| policy.adapter(&item.agent).ok());
        if let Some(adapter) = adapter.as_deref() {
            if item.agent != "auto" && !credentials::REMOTE_ADAPTERS.contains(&adapter) {
                needs.device_only = Some(format!("{} cannot run on a computer", item.agent));
            }
        }
        let named = pool::named_variables(&item.prompt);
        if !named.is_empty() {
            let secrets =
                project_secrets::list(&self.runtime.project_secrets_root(), &item.project_id)
                    .unwrap_or_default();
            for secret in secrets
                .iter()
                .filter(|secret| named.contains(secret.name.as_str()))
            {
                match secret.available_to {
                    Availability::Local => {
                        needs.device_only.get_or_insert_with(|| {
                            format!("it names {}, available only to this device", secret.name)
                        });
                    }
                    Availability::Computers => {
                        needs.computer_only.get_or_insert_with(|| {
                            format!("it names {}, available only to computers", secret.name)
                        });
                    }
                    Availability::Both => {}
                }
            }
        }
        let selected = ledger
            .managed_tasks
            .iter()
            .find(|task| Some(&task.id) == item.feature_id.as_ref())
            .and_then(|task| task.request.connection_ids.clone())
            .filter(|ids| !ids.is_empty());
        if let (None, Some(ids), Some(adapter)) = (&needs.device_only, selected, adapter) {
            if let Ok((direct, on_demand)) =
                crate::commands::mcp::project_delivery(&item.project_id, Some(&ids), &adapter)
            {
                let secrets = project_secrets::environment(
                    &self.runtime.project_secrets_root(),
                    &item.project_id,
                    Place::Computer,
                )
                .unwrap_or_default();
                let roots = [std::path::Path::new(&item.project_path)];
                let delivery = crate::commands::mcp::remote_delivery(
                    &direct,
                    on_demand,
                    &crate::commands::mcp::RemoteContext {
                        read_only: false,
                        roots: &roots,
                        secrets: &secrets,
                    },
                );
                if !delivery.withheld.is_empty() {
                    needs.device_only = Some(format!(
                        "selected connections cannot reach a computer: {}",
                        crate::commands::mcp::withheld_summary(&delivery.withheld)
                    ));
                }
            }
        }
        needs
    }

    /// Retries planned work whose attempt failed because its host was lost,
    /// once, as a new attempt on another host the fork may use. A fork with
    /// no such host keeps its failed attempt and says why. Returns whether it
    /// started or settled one.
    pub(super) fn retry_lost_hosts_locked(
        &self,
        inner: &mut Inner,
        runs: &[TaskRun],
        merged: &[String],
        url: &str,
    ) -> Result<bool, String> {
        for (item, run) in host_retries(&inner.ledger, runs, merged) {
            let Some(task) = inner
                .ledger
                .managed_tasks
                .iter()
                .find(|task| Some(&task.id) == item.feature_id.as_ref())
                .cloned()
            else {
                continue;
            };
            if task.error.is_some() || !inner.enabled.contains(&managed::dispatch_key(&task.id)) {
                continue;
            }
            let lost = run.host.clone().unwrap_or_default();
            let decision = retry_decision(inner, runs, &item, &lost, |item| {
                inner
                    .pool
                    .needs
                    .get(&item.id)
                    .cloned()
                    .unwrap_or_else(|| self.needs(&inner.ledger, item))
            });
            let host = match decision {
                Decision::Wait(_) => continue,
                Decision::Refuse(reason) => {
                    let note = format!("Not retried on another host: {reason}");
                    self.runtime.update(&run.id, |saved| {
                        if let Some(host) = &mut saved.host {
                            host.retry = Some(note.clone());
                        }
                        crate::commands::tasks::events::activity(saved, &note);
                    });
                    return Ok(true);
                }
                Decision::Place(host) => host,
            };
            self.start_host_retry(inner, &task, &item, &run, host, runs, url)?;
            return Ok(true);
        }
        Ok(false)
    }

    #[allow(clippy::too_many_arguments)]
    fn start_host_retry(
        &self,
        inner: &mut Inner,
        task: &managed::ManagedTask,
        item: &QueueItem,
        run: &TaskRun,
        host: pool::RunHost,
        runs: &[TaskRun],
        url: &str,
    ) -> Result<(), String> {
        let mut request = self.runtime.retry_request(&run.id)?;
        managed::prepare_followup(&inner.ledger, runs, &mut request)?;
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        request.coordination = Some(CoordinationContext {
            managed: true,
            endpoint: url.into(),
            token: token.clone(),
            instructions: instructions(item),
        });
        let note = format!("Retried on {} as a new attempt.", host.name);
        self.runtime.update(&run.id, |saved| {
            if let Some(lost) = &mut saved.host {
                lost.retry = Some(note.clone());
            }
            crate::commands::tasks::events::activity(saved, &note);
        });
        let mut ledger = inner.ledger.clone();
        managed_delivery::capture_interfaces(&mut ledger, item, &request.id);
        if let Some(saved) = ledger
            .managed_tasks
            .iter_mut()
            .find(|saved| saved.id == task.id)
        {
            saved.run_ids.push(request.id.clone());
        }
        if let Some(saved) = ledger.items.iter_mut().find(|saved| saved.id == item.id) {
            saved.run_id = Some(request.id.clone());
        }
        self.save(&ledger)?;
        inner.ledger = ledger;
        inner
            .grants
            .insert(token.clone(), (item.id.clone(), request.id.clone()));
        let id = request.id.clone();
        pool::assign(&id, host);
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
        if let Err(error) = result {
            pool::take(&id);
            inner.grants.remove(&token);
            let mut ledger = inner.ledger.clone();
            if let Some(saved) = ledger.items.iter_mut().find(|saved| saved.id == item.id) {
                saved.error = Some(error);
            }
            self.save(&ledger)?;
            inner.ledger = ledger;
        }
        Ok(())
    }
}

/// Planned forks whose current attempt failed because its host was lost and
/// that have not been retried for it: the attempt itself is no host retry,
/// nothing later replaced it and it was not merged.
pub(super) fn host_retries(
    ledger: &Ledger,
    runs: &[TaskRun],
    merged: &[String],
) -> Vec<(QueueItem, TaskRun)> {
    ledger
        .items
        .iter()
        .filter(|item| item.feature_id.is_some() && !item.canceled && item.error.is_none())
        .filter_map(|item| {
            let run = runs
                .iter()
                .find(|run| Some(&run.id) == item.run_id.as_ref())?;
            let host = run.host.as_ref()?;
            let eligible = run.status == "failed"
                && host.lost.is_some()
                && host.retried_from.is_none()
                && host.retry.is_none()
                && !merged.contains(&run.id)
                && !runs
                    .iter()
                    .any(|other| other.task_id == run.task_id && other.started_at > run.started_at);
            eligible.then(|| (item.clone(), run.clone()))
        })
        .collect()
}

/// Where a host retry goes: any other host the fork may use, this device
/// included, with the lost host named in the reason.
pub(super) fn retry_decision(
    inner: &Inner,
    runs: &[TaskRun],
    item: &QueueItem,
    lost: &pool::RunHost,
    needs: impl Fn(&QueueItem) -> Needs,
) -> Decision {
    let load = host_load(inner, runs);
    let limits = pool::Limits {
        device: inner.concurrency,
        remote: inner.remote_concurrency,
    };
    let remote_running: usize = load
        .iter()
        .filter(|(host, _)| host.as_str() != pool::DEVICE)
        .map(|(_, count)| count)
        .sum();
    let hosts = inner.pool.hosts(
        &item.project_id,
        true,
        inner.remote_projects.contains(&item.project_id),
        limits,
        &load,
    );
    match pool::place(
        inner.pool.policy(&item.project_id),
        &hosts,
        &needs(item),
        inner.remote_concurrency.saturating_sub(remote_running),
        Some(&lost.id),
    ) {
        Decision::Place(mut host) => {
            host.reason = format!(
                "Retried after {} was lost ({}). {}",
                lost.name,
                lost.lost.as_deref().unwrap_or("no contact"),
                host.reason
            );
            host.retried_from = Some(lost.name.clone());
            Decision::Place(host)
        }
        other => other,
    }
}

/// One host of a project's pool, for the app.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStatus {
    pub id: String,
    pub name: String,
    pub device: bool,
    /// The project's own computer.
    pub pinned: bool,
    pub running: usize,
    pub limit: usize,
    pub last_seen: Option<String>,
    /// Why contact was lost, until the computer is reached again.
    pub lost: Option<String>,
}

/// A computer the person can add to the project's pool.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolChoice {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub owner_kind: String,
    pub added: bool,
}

/// Where a project's swarms may run and how busy each host is.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostsView {
    pub swarm_hosts: pool::SwarmHosts,
    /// Whether the person chose; otherwise the default applies.
    pub chosen: bool,
    pub hosts: Vec<HostStatus>,
    pub computers: Vec<PoolChoice>,
}

impl Coordinator {
    fn hosts_view(&self, project_id: &str) -> Result<HostsView, String> {
        let root = self.runtime.computers_root();
        let runs = self.runtime.integration_runs()?;
        let mut inner = self.inner.lock().unwrap();
        if !inner.pool.loaded {
            self.refresh_pool_locked(&mut inner);
        }
        let settings = pool::settings(&root, project_id);
        let load = host_load(&inner, &runs);
        let limits = pool::Limits {
            device: inner.concurrency,
            remote: inner.remote_concurrency,
        };
        let mut pooled = inner.pool.clone();
        pooled
            .projects
            .insert(project_id.to_string(), settings.clone());
        let policy = settings.swarm_hosts.unwrap_or_default();
        let hosts = pooled
            .hosts(
                project_id,
                true,
                inner.remote_projects.contains(project_id),
                limits,
                &load,
            )
            .into_iter()
            .filter(|host| policy.allows(host.device) || host.running > 0)
            .map(|host| {
                let health = pool::health(&host.id);
                HostStatus {
                    last_seen: (!host.device).then_some(health.last_seen).flatten(),
                    lost: (!host.device).then_some(health.lost).flatten(),
                    id: host.id,
                    name: host.name,
                    device: host.device,
                    pinned: host.pinned,
                    running: host.running,
                    limit: host.limit,
                }
            })
            .collect();
        drop(inner);
        let computers = crate::commands::computers::list(&root)
            .unwrap_or_default()
            .into_iter()
            .filter(crate::commands::computers::runs::supports_runs)
            .filter(|computer| {
                !(computer.owner_kind == crate::commands::computers::PROJECT
                    && computer.owner_id == project_id)
            })
            .map(|computer| PoolChoice {
                added: settings.computers.contains(&computer.id),
                id: computer.id,
                name: computer.name,
                provider: computer.provider,
                owner_kind: computer.owner_kind,
            })
            .collect();
        Ok(HostsView {
            swarm_hosts: policy,
            chosen: settings.swarm_hosts.is_some(),
            hosts,
            computers,
        })
    }
}

#[tauri::command]
pub async fn queue_hosts(
    project_id: String,
    state: State<'_, Coordinator>,
) -> Result<HostsView, String> {
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.hosts_view(&project_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn queue_set_hosts(
    project_id: String,
    swarm_hosts: pool::SwarmHosts,
    computers: Vec<String>,
    state: State<'_, Coordinator>,
) -> Result<HostsView, String> {
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        pool::save(
            &service.runtime.computers_root(),
            &project_id,
            pool::ProjectHosts {
                swarm_hosts: Some(swarm_hosts),
                computers,
            },
        )?;
        {
            let mut inner = service.inner.lock().unwrap();
            service.refresh_pool_locked(&mut inner);
        }
        service.hosts_view(&project_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, run: &str) -> QueueItem {
        serde_json::from_value(serde_json::json!({"id":id,"projectId":"p","projectName":"p","projectPath":"fixture","title":id,"prompt":id,"agent":"codex","scopes":[id],"dependencies":[],"createdAt":"now","runId":run,"featureId":"feature","error":null,"canceled":false})).unwrap()
    }

    fn failed(id: &str, task: &str, host: Option<pool::RunHost>) -> TaskRun {
        TaskRun {
            id: id.into(),
            task_id: task.into(),
            project_id: "p".into(),
            status: "failed".into(),
            started_at: "2026-11-01T00:00:00Z".into(),
            host,
            ..Default::default()
        }
    }

    fn lost_box() -> pool::RunHost {
        pool::RunHost {
            id: "Box".into(),
            name: "Box".into(),
            reason: "Placed on Box.".into(),
            lost: Some("connection refused".into()),
            ..Default::default()
        }
    }

    #[test]
    fn a_fork_whose_host_was_lost_is_retried_once_elsewhere() {
        let ledger = Ledger {
            items: vec![item("a", "r1")],
            ..Default::default()
        };
        let lost = failed("r1", "t1", Some(lost_box()));
        let picked = host_retries(&ledger, std::slice::from_ref(&lost), &[]);
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].1.id, "r1");

        // Not for an agent failure, a settled retry, a retry that lost its
        // host too, merged work, or an attempt something later replaced.
        let agent_failure = failed("r1", "t1", Some(pool::RunHost::device("here".into())));
        let settled = failed(
            "r1",
            "t1",
            Some(pool::RunHost {
                retry: Some("Retried on Lab as a new attempt.".into()),
                ..lost_box()
            }),
        );
        let second = failed(
            "r1",
            "t1",
            Some(pool::RunHost {
                retried_from: Some("Lab".into()),
                ..lost_box()
            }),
        );
        for run in [agent_failure, settled, second] {
            assert!(host_retries(&ledger, &[run], &[]).is_empty());
        }
        assert!(host_retries(&ledger, std::slice::from_ref(&lost), &["r1".into()]).is_empty());
        let later = TaskRun {
            id: "r2".into(),
            started_at: "2026-11-02T00:00:00Z".into(),
            ..failed("r2", "t1", None)
        };
        assert!(host_retries(&ledger, &[lost.clone(), later], &[]).is_empty());

        // The retry leaves the lost host and says why.
        let inner = Inner {
            ledger,
            enabled: HashSet::new(),
            concurrency: 2,
            remote_concurrency: 8,
            remote_projects: ["p".to_string()].into(),
            pool: pool::Pool {
                loaded: true,
                computers: vec![pool::PoolComputer {
                    id: "Box".into(),
                    name: "Box".into(),
                    pinned_by: Some("p".into()),
                    health: Default::default(),
                }],
                ..Default::default()
            },
            grants: HashMap::new(),
            url: None,
            error: None,
            delivered: HashMap::new(),
        };
        let fork = item("a", "r1");
        match retry_decision(&inner, &[lost.clone()], &fork, &lost_box(), |_| {
            Needs::default()
        }) {
            Decision::Place(host) => {
                assert!(host.is_device());
                assert_eq!(host.retried_from.as_deref(), Some("Box"));
                assert!(
                    host.reason.starts_with(
                        "Retried after Box was lost (connection refused). Placed on this device"
                    ),
                    "{}",
                    host.reason
                );
            }
            other => panic!("expected a retry host, got {other:?}"),
        }
        // A fork that can only run on a computer has nowhere else to go.
        let remote_only = Needs {
            computer_only: Some("it names DEPLOY_TOKEN, available only to computers".into()),
            ..Default::default()
        };
        assert!(matches!(
            retry_decision(&inner, &[lost], &fork, &lost_box(), |_| remote_only.clone()),
            Decision::Refuse(_)
        ));
    }
}
