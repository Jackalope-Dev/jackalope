use super::*;
use crate::commands::tasks::TaskRun;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeAudit {
    pub project_id: String,
    pub task_id: String,
    pub run_id: String,
    pub tree: Option<String>,
    pub outside: Vec<String>,
    pub overlaps: Vec<String>,
    pub error: Option<String>,
    pub accepted_tree: Option<String>,
}

impl ScopeAudit {
    pub fn blocked(&self) -> bool {
        self.error.is_some()
            || !self.overlaps.is_empty()
            || (!self.outside.is_empty()
                && (self.tree.is_none() || self.tree != self.accepted_tree))
    }
}

pub(super) fn changed_paths(run: &TaskRun) -> Result<(String, Vec<String>), String> {
    if run.base_head.is_empty() || run.workspace == run.project_path {
        return Err("This attempt has no isolated baseline for a scope check.".into());
    }
    let directory = std::env::temp_dir().join(format!("jackalope-scope-{}", Uuid::new_v4()));
    std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
    let result = (|| {
        let tree = crate::commands::integration::workspace_tree(run, &directory)?;
        let output = crate::commands::git_command::command(
            std::path::Path::new(&run.workspace),
            &[
                "diff",
                "--name-only",
                "--no-renames",
                "-z",
                &run.base_head,
                &tree,
                "--",
            ],
            crate::commands::git_command::Policy::Isolated,
        )
        .output()
        .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err("Cannot compare this worktree to its saved baseline.".into());
        }
        let text = String::from_utf8(output.stdout)
            .map_err(|_| "A changed path is not valid UTF-8. Review the worktree manually.")?;
        let paths = text
            .split('\0')
            .filter(|p| !p.is_empty())
            .map(|p| p.to_lowercase())
            .collect::<Vec<_>>();
        if paths.len() > 10_000 {
            return Err(
                "Too many changed paths for a scope check. Split the task before integration."
                    .into(),
            );
        }
        Ok((tree, paths))
    })();
    let _ = std::fs::remove_dir(&directory);
    result
}

fn contains(scopes: &[String], path: &str) -> bool {
    scopes
        .iter()
        .any(|s| s == "." || s == path || path.starts_with(&format!("{s}/")))
}

pub(super) fn audit(ledger: &Ledger, runs: &[TaskRun], merged: &[String]) -> Vec<ScopeAudit> {
    let mut scans = Vec::new();
    for run in runs {
        if runs
            .iter()
            .any(|other| other.task_id == run.task_id && other.started_at > run.started_at)
        {
            continue;
        }
        let owner = agreements::owner_id(ledger, runs, run);
        let item = ledger.items.iter().find(|i| i.id == owner);
        if item.is_none() && !active(&run.status) && !std::path::Path::new(&run.workspace).is_dir()
        {
            continue;
        }
        if item.is_some_and(|i| i.canceled)
            || merged.contains(&run.id)
            || item.is_some_and(|i| i.run_id.as_ref().is_some_and(|id| merged.contains(id)))
            || run.workspace.is_empty()
            || (run.workspace == run.project_path && item.is_none())
        {
            continue;
        }
        let previous = ledger.scope_audits.iter().find(|a| a.run_id == run.id);
        let mut a = ScopeAudit {
            project_id: run.project_id.clone(),
            task_id: owner.into(),
            run_id: run.id.clone(),
            tree: None,
            outside: vec![],
            overlaps: vec![],
            error: None,
            accepted_tree: previous.and_then(|a| a.accepted_tree.clone()),
        };
        let paths = match changed_paths(run) {
            Ok((tree, paths)) => {
                if let Some(item) = item {
                    a.outside = paths
                        .iter()
                        .filter(|p| !contains(&agreements::effective_scopes(ledger, item), p))
                        .cloned()
                        .collect();
                }
                a.tree = Some(tree);
                paths
            }
            Err(error) => {
                a.error = Some(error);
                vec![]
            }
        };
        scans.push((a, paths));
    }
    for index in 0..scans.len() {
        let (left, right) = scans.split_at_mut(index + 1);
        let (a, paths) = &mut left[index];
        for (b, other_paths) in right
            .iter_mut()
            .filter(|(b, _)| b.project_id == a.project_id)
        {
            let overlap = paths
                .iter()
                .filter(|p| other_paths.contains(p))
                .cloned()
                .collect::<Vec<_>>();
            // A staged descendant intentionally contains its recorded predecessor changes.
            let staged_pair = runs.iter().any(|r| {
                (r.id == a.run_id
                    && r.dependency_snapshot
                        .sources
                        .iter()
                        .any(|s| s.run_id == b.run_id))
                    || (r.id == b.run_id
                        && r.dependency_snapshot
                            .sources
                            .iter()
                            .any(|s| s.run_id == a.run_id))
            });
            if !staged_pair {
                a.overlaps.extend(overlap.clone());
                b.overlaps.extend(overlap);
            }
        }
    }
    scans
        .into_iter()
        .map(|(mut a, _)| {
            a.overlaps.sort();
            a.overlaps.dedup();
            a
        })
        .collect()
}

impl Coordinator {
    pub(super) fn refresh_scopes_locked(&self, inner: &mut Inner) -> Result<(), String> {
        self.ensure_storage_loaded()?;
        let runs = self.runtime.integration_runs()?;
        let merged = crate::commands::integration::applied_run_ids(&self.runtime)?;
        let next = audit(&inner.ledger, &runs, &merged);
        if next != inner.ledger.scope_audits {
            let mut ledger = inner.ledger.clone();
            for a in next.iter().filter(|a| a.blocked()) {
                let previous = ledger
                    .scope_audits
                    .iter()
                    .find(|old| old.run_id == a.run_id);
                if previous.is_some_and(|old| {
                    old.blocked()
                        && old.outside == a.outside
                        && old.overlaps == a.overlaps
                        && old.error == a.error
                }) {
                    continue;
                }
                ledger.messages.push(CoordinationMessage { id: Uuid::new_v4().to_string(), project_id: a.project_id.clone(), task_id: "jackalope".into(),
                    kind: "blocker".into(), text: format!("Scope check needs attention for task {}. Outside assignment: {}. Overlapping edits: {}. {} Review Coordination & handoffs before depending on or integrating this work.",
                        a.task_id, a.outside.iter().take(10).cloned().collect::<Vec<_>>().join(", "), a.overlaps.iter().take(10).cloned().collect::<Vec<_>>().join(", "), a.error.as_deref().unwrap_or("")),
                    created_at: Utc::now().to_rfc3339(), recipient_task_id: Some(a.task_id.clone()), acknowledged_by: vec![], report: None, run_id: Some(a.run_id.clone()), source_tree: a.tree.clone(), resolved_by: None });
            }
            ledger.scope_audits = next;
            let excess = ledger.messages.len().saturating_sub(2000);
            ledger.messages.drain(..excess);
            self.save(&ledger)?;
            inner.ledger = ledger;
        }
        Ok(())
    }

    pub(in crate::commands) fn guarded_integration<T>(
        &self,
        ids: &[String],
        operation: impl FnOnce(&[ScopeAudit]) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        let _guard = crate::commands::integration::execution_guard()?;
        self.refresh_scopes_locked(&mut inner)?;
        let runs = self.runtime.integration_runs()?;
        self.validate_integration_locked(&inner.ledger, &runs, ids)?;
        operation(&inner.ledger.scope_audits)
    }

    pub(super) fn validate_integration_locked(
        &self,
        ledger: &Ledger,
        runs: &[TaskRun],
        ids: &[String],
    ) -> Result<(), String> {
        let mut reconciled = HashSet::new();
        for resolver in runs
            .iter()
            .filter(|r| ids.contains(&r.id) && r.dependency_snapshot.reconciles)
        {
            crate::commands::integration::validate_dependencies(
                &self.runtime.integration_directory(),
                runs,
                resolver,
            )?;
            let tree = crate::commands::integration::workspace_tree(
                resolver,
                &self.runtime.integration_directory(),
            )?;
            crate::commands::integration::dependencies::verified(resolver, &tree)?;
            if resolver
                .dependency_snapshot
                .sources
                .iter()
                .all(|s| ids.contains(&s.run_id))
            {
                reconciled.extend(
                    resolver
                        .dependency_snapshot
                        .sources
                        .iter()
                        .map(|s| s.run_id.clone()),
                );
            }
        }
        for id in ids {
            let run = runs
                .iter()
                .find(|r| &r.id == id)
                .ok_or("Task history is unavailable.")?;
            let task = agreements::owner_id(ledger, runs, run);
            if let Some(reason) = agreements::interface_block(ledger, &run.project_id, task) {
                return Err(reason);
            }
            if ledger.agreements.iter().any(|a| {
                a.project_id == run.project_id
                    && (a.task_id == task || a.participants.iter().any(|p| p == task))
                    && a.resolution_run
                        .as_ref()
                        .is_some_and(|resolved| !ids.contains(resolved))
            }) {
                return Err(
                    "Select the recorded reconciliation result with its source tasks.".into(),
                );
            }
            if ledger.scope_audits.iter().any(|a| {
                a.run_id == *id
                    && a.blocked()
                    && (!reconciled.contains(id)
                        || a.error.is_some()
                        || ledger.scope_audits.iter().any(|other| {
                            other.project_id == a.project_id
                                && other.run_id != a.run_id
                                && !reconciled.contains(&other.run_id)
                                && other.overlaps.iter().any(|p| a.overlaps.contains(p))
                        }))
            }) {
                return Err("Resolve the changed-file scope check in Coordination & handoffs before integration.".into());
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn queue_reconcile_scope(
    state: State<'_, Coordinator>,
    run_id: String,
    tree: String,
) -> Result<(), String> {
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut inner = service.inner.lock().map_err(|e| e.to_string())?;
        let _guard = crate::commands::integration::execution_guard()?;
        service.refresh_scopes_locked(&mut inner)?;
        let runs = service.runtime.integration_runs()?;
        if runs.iter().any(|r| r.id == run_id && (active(&r.status) || r.status == "interrupted")) { return Err("Stop the task and resolve interrupted process ownership before accepting its scope.".into()); }
        let mut ledger = inner.ledger.clone();
        let a = ledger.scope_audits.iter_mut().find(|a| a.run_id == run_id).ok_or("Scope check not found.")?;
        if a.error.is_some() || !a.overlaps.is_empty() || a.tree.as_deref() != Some(&tree) { return Err("Files changed or overlap another task. Resolve the overlap and review the current scope check.".into()); }
        a.accepted_tree = Some(tree);
        service.save(&ledger)?; inner.ledger = ledger;
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn queue_cancel_agreement(
    state: State<'_, Coordinator>,
    id: String,
    revision: u64,
) -> Result<(), String> {
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut inner = service.inner.lock().map_err(|e| e.to_string())?;
        let _guard = crate::commands::integration::execution_guard()?;
        let mut ledger = inner.ledger.clone();
        let index = ledger.agreements.iter().position(|a| a.id == id).ok_or("Agreement not found.")?;
        let mut a = ledger.agreements[index].clone();
        if a.revision != revision {
            return Err("The agreement changed. Review it again before canceling.".into());
        }
        if a.kind == "ownership" {
            let runs = service.runtime.integration_runs()?;
            if runs.iter().any(|r| agreements::owner_id(&ledger, &runs, r) == a.task_id && (active(&r.status) || r.status == "interrupted")) {
                return Err("Stop the owner and resolve interrupted process ownership before releasing this claim.".into());
            }
            let merged = crate::commands::integration::applied_run_ids(&service.runtime)?;
            agreements::require_clean_paths(&ledger, &runs, &a, &merged)?;
            a.status = "released".into();
        } else {
            a.status = "canceled".into();
        }
        a.revision += 1;
        a.updated_at = Utc::now().to_rfc3339();
        ledger.agreements[index] = a.clone();
        agreements::announce(&mut ledger, &a, "user");
        service.save(&ledger)?;
        inner.ledger = ledger;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
