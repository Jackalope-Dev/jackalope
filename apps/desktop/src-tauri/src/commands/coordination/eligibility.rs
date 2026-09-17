use super::*;

pub(super) fn ordered_plan(items: Vec<PlanEntry>) -> Result<Vec<PlanEntry>, String> {
    if items.is_empty() || items.len() > 100 {
        return Err("Import between 1 and 100 tasks at a time.".into());
    }
    let keys: HashSet<_> = items.iter().map(|i| i.key.clone()).collect();
    if keys.len() != items.len()
        || keys.iter().any(|k| {
            k.is_empty()
                || k.len() > 80
                || !k
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        })
    {
        return Err(
            "Plan keys must be unique, 1–80 letters, digits, hyphens or underscores.".into(),
        );
    }
    if items
        .iter()
        .any(|i| i.depends_on.iter().any(|key| !keys.contains(key)))
    {
        return Err("A dependency refers to a task missing from this plan.".into());
    }
    let mut ordered = Vec::new();
    let mut added = HashSet::new();
    while ordered.len() < items.len() {
        let before = ordered.len();
        for item in &items {
            if !added.contains(&item.key) && item.depends_on.iter().all(|key| added.contains(key)) {
                ordered.push(item.clone());
                added.insert(item.key.clone());
            }
        }
        if ordered.len() == before {
            return Err("This plan has a dependency cycle. No tasks were added.".into());
        }
    }
    Ok(ordered)
}

pub(super) fn active(status: &str) -> bool {
    ["starting", "running", "stopping"].contains(&status)
}

pub(super) fn overlaps(a: &[String], b: &[String]) -> bool {
    a.iter().any(|a| {
        b.iter().any(|b| {
            a == "."
                || b == "."
                || a == b
                || a.starts_with(&format!("{b}/"))
                || b.starts_with(&format!("{a}/"))
        })
    })
}

pub(super) fn scopes(values: Vec<String>) -> Result<Vec<String>, String> {
    if values.is_empty() || values.len() > 30 {
        return Err(
            "Name the files or folders this task owns (use . for the whole project).".into(),
        );
    }
    values.into_iter().map(|value| {
        let value = value.trim().replace('\\', "/").trim_end_matches('/').to_lowercase();
        if value.is_empty() || value.chars().any(char::is_control) || value.len() > 500 || value.starts_with('/') || value.contains(':') || value.contains('*') || value.split('/').any(|p| p == ".." || (p == "." && value != ".") || p.is_empty()) {
            return Err("Scopes must be relative file or folder paths, without wildcards or parent traversal.".into());
        }
        Ok(value)
    }).collect()
}

fn dependency_priority(items: &[QueueItem]) -> HashMap<String, usize> {
    fn depth(
        id: &str,
        children: &HashMap<&str, Vec<&str>>,
        visiting: &mut HashSet<String>,
        memo: &mut HashMap<String, usize>,
    ) -> usize {
        if let Some(value) = memo.get(id) {
            return *value;
        }
        if !visiting.insert(id.into()) {
            return 0;
        }
        let value = children
            .get(id)
            .into_iter()
            .flatten()
            .map(|child| 1 + depth(child, children, visiting, memo))
            .max()
            .unwrap_or(0);
        visiting.remove(id);
        memo.insert(id.into(), value);
        value
    }
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    for item in items
        .iter()
        .filter(|item| !item.canceled && item.error.is_none() && item.run_id.is_none())
    {
        for parent in &item.dependencies {
            children.entry(parent).or_default().push(&item.id);
        }
    }
    let mut memo = HashMap::new();
    for item in items {
        depth(&item.id, &children, &mut HashSet::new(), &mut memo);
    }
    memo
}

pub(super) fn ready_items(
    inner: &Inner,
    runs: &[crate::commands::tasks::TaskRun],
    merged: &[String],
) -> Vec<QueueItem> {
    let active_runs: Vec<_> = runs.iter().filter(|r| active(&r.status)).collect();
    let slots = inner
        .concurrency
        .saturating_sub(active_runs.iter().filter(|r| !r.finishing).count());
    let mut reserved = Vec::new();
    let priority = dependency_priority(&inner.ledger.items);
    let mut pending: Vec<_> = inner
        .ledger
        .items
        .iter()
        .filter(|item| {
            (if let Some(task) = inner
                .ledger
                .managed_tasks
                .iter()
                .find(|task| Some(&task.id) == item.feature_id.as_ref())
            {
                inner
                    .enabled
                    .contains(&super::managed::dispatch_key(&task.id))
                    && task.error.is_none()
                    && !inner
                        .ledger
                        .items
                        .iter()
                        .filter(|other| other.feature_id == item.feature_id)
                        .any(|other| {
                            other.error.is_some()
                                || other.canceled
                                || other.run_id.as_ref().is_some_and(|id| {
                                    runs.iter().find(|run| &run.id == id).is_none_or(|run| {
                                        !active(&run.status)
                                            && (!matches!(
                                                run.status.as_str(),
                                                "review" | "reviewed"
                                            ) || run.error.is_some()
                                                || run.persistence_error.is_some()
                                                || run.dependency_invalidated
                                                || run.verification_error.is_some()
                                                || run.verification.as_ref().is_none_or(|check| {
                                                    !check.result.success || check.tree.is_none()
                                                }))
                                    })
                                })
                        })
            } else {
                inner.enabled.contains(&item.project_id)
            }) && !item.canceled
                && item.run_id.is_none()
                && item.error.is_none()
        })
        .collect();
    let mut counts: HashMap<String, usize> = HashMap::new();
    for run in &active_runs {
        *counts.entry(run.project_id.clone()).or_default() += 1;
    }
    let mut reorder = true;
    while !pending.is_empty() && reserved.len() < slots {
        if reorder {
            pending.sort_by_key(|item| {
                std::cmp::Reverse((
                    counts.get(&item.project_id).copied().unwrap_or(0),
                    std::cmp::Reverse(priority.get(&item.id).copied().unwrap_or(0)),
                    item.created_at.clone(),
                    item.id.clone(),
                ))
            });
            reorder = false;
        }
        let item = pending.pop().unwrap();
        if super::managed_delivery::scope_blocked(&inner.ledger, item, runs) {
            continue;
        }
        if super::managed_delivery::interfaces_blocked(&inner.ledger, item) {
            continue;
        }
        if !item.dependencies.iter().all(|id| {
            inner
                .ledger
                .items
                .iter()
                .find(|i| &i.id == id)
                .and_then(|i| i.run_id.as_ref())
                .is_some_and(|id| {
                    merged.contains(id)
                        || (item.staged_dependencies
                            && runs.iter().any(|run| {
                                &run.id == id
                                    && ["review", "reviewed"].contains(&run.status.as_str())
                                    && run
                                        .verification
                                        .as_ref()
                                        .is_some_and(|v| v.result.success && v.tree.is_some())
                            }))
                })
        }) {
            continue;
        }
        let predecessors = if item.staged_dependencies {
            ancestors(&inner.ledger.items, item)
        } else {
            HashSet::new()
        };
        let pending_overlap = inner.ledger.items.iter().any(|other| {
            other.id != item.id
                && other.project_id == item.project_id
                && other.run_id.as_ref().is_some_and(|id| !merged.contains(id))
                && !other.canceled
                && !(item.feature_id.is_some()
                    && item.feature_id == other.feature_id
                    && (super::managed_delivery::is_integration(&inner.ledger, item)
                        || super::managed_delivery::is_integration(&inner.ledger, other)))
                && !(item.staged_dependencies && predecessors.contains(&other.id))
                && overlaps(
                    &agreements::effective_scopes(&inner.ledger, item),
                    &agreements::effective_scopes(&inner.ledger, other),
                )
        });
        let active_overlap = active_runs.iter().any(|run| {
            run.project_id == item.project_id
                && !inner
                    .ledger
                    .items
                    .iter()
                    .any(|i| i.run_id.as_ref() == Some(&run.id))
        });
        if pending_overlap
            || active_overlap
            || reserved.iter().any(|other: &&QueueItem| {
                other.project_id == item.project_id
                    && overlaps(
                        &agreements::effective_scopes(&inner.ledger, other),
                        &agreements::effective_scopes(&inner.ledger, item),
                    )
            })
        {
            continue;
        }
        *counts.entry(item.project_id.clone()).or_default() += 1;
        reserved.push(item);
        reorder = true;
    }
    reserved.into_iter().cloned().collect()
}

pub(super) fn ancestors(items: &[QueueItem], item: &QueueItem) -> HashSet<String> {
    let mut found = HashSet::new();
    let mut pending = item.dependencies.clone();
    while let Some(id) = pending.pop() {
        if found.insert(id.clone()) {
            if let Some(parent) = items.iter().find(|i| i.id == id) {
                pending.extend(parent.dependencies.clone());
            }
        }
    }
    found
}

#[cfg(test)]
mod scheduling_tests {
    use super::*;
    fn item(id: &str, project: &str, deps: &[&str]) -> QueueItem {
        serde_json::from_value(serde_json::json!({"id":id,"projectId":project,"projectName":project,"projectPath":"fixture","title":id,"prompt":id,"agent":"codex","scopes":[id],"dependencies":deps,"createdAt":"now","runId":null,"error":null,"canceled":false})).unwrap()
    }
    #[test]
    fn critical_path_is_independent_of_saved_order_and_ignores_retired_work() {
        let mut items = vec![
            item("leaf", "a", &["middle"]),
            item("root", "a", &[]),
            item("middle", "a", &["root"]),
        ];
        assert_eq!(dependency_priority(&items)["root"], 2);
        items.reverse();
        assert_eq!(dependency_priority(&items)["root"], 2);
        items
            .iter_mut()
            .find(|item| item.id == "leaf")
            .unwrap()
            .canceled = true;
        assert_eq!(dependency_priority(&items)["root"], 1);
        items
            .iter_mut()
            .find(|item| item.id == "middle")
            .unwrap()
            .run_id = Some("finished".into());
        assert_eq!(dependency_priority(&items)["root"], 0);
    }
    #[test]
    fn scheduling_prioritizes_the_critical_path_and_fair_projects() {
        let inner = Inner {
            ledger: Ledger {
                items: vec![
                    item("unrelated", "a", &[]),
                    item("root", "a", &[]),
                    item("child", "a", &["root"]),
                    item("peer", "b", &[]),
                ],
                ..Default::default()
            },
            enabled: ["a".into(), "b".into()].into(),
            concurrency: 2,
            grants: HashMap::new(),
            url: None,
            error: None,
            delivered: HashMap::new(),
        };
        let ready = ready_items(&inner, &[], &[]);
        assert_eq!(
            ready.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
            ["root", "peer"]
        );
        assert!(!ready.iter().any(|i| i.id == "child"));
    }
}
