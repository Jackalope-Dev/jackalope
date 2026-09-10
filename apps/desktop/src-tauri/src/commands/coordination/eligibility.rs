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
        if value.is_empty() || value.len() > 500 || value.starts_with('/') || value.contains(':') || value.contains('*') || value.split('/').any(|p| p == ".." || (p == "." && value != ".") || p.is_empty()) {
            return Err("Scopes must be relative file or folder paths, without wildcards or parent traversal.".into());
        }
        Ok(value)
    }).collect()
}

pub(super) fn ready_items(
    inner: &Inner,
    runs: &[crate::commands::tasks::TaskRun],
    merged: &[String],
) -> Vec<QueueItem> {
    let active_runs: Vec<_> = runs.iter().filter(|r| active(&r.status)).collect();
    let slots = inner.concurrency.saturating_sub(active_runs.len());
    let mut reserved = Vec::new();
    let mut pending: Vec<_> = inner.ledger.items.iter().collect();
    let mut counts: HashMap<String, usize> = HashMap::new();
    for run in &active_runs {
        *counts.entry(run.project_id.clone()).or_default() += 1;
    }
    while !pending.is_empty() {
        pending.sort_by_key(|item| {
            (
                counts.get(&item.project_id).copied().unwrap_or(0),
                std::cmp::Reverse(downstream(&inner.ledger.items, &item.id).len()),
                item.created_at.clone(),
                item.id.clone(),
            )
        });
        let item = pending.remove(0);
        if reserved.len() >= slots {
            break;
        }
        if !inner.enabled.contains(&item.project_id)
            || item.canceled
            || item.run_id.is_some()
            || item.error.is_some()
        {
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
        let pending_overlap = inner.ledger.items.iter().any(|other| {
            other.id != item.id
                && other.project_id == item.project_id
                && other.run_id.as_ref().is_some_and(|id| !merged.contains(id))
                && !other.canceled
                && !(item.staged_dependencies
                    && ancestors(&inner.ledger.items, item).contains(&other.id))
                && overlaps(&item.scopes, &other.scopes)
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
                other.project_id == item.project_id && overlaps(&other.scopes, &item.scopes)
            })
        {
            continue;
        }
        *counts.entry(item.project_id.clone()).or_default() += 1;
        reserved.push(item);
    }
    reserved.into_iter().cloned().collect()
}

fn downstream(items: &[QueueItem], id: &str) -> HashSet<String> {
    let mut found = HashSet::new();
    let mut pending = vec![id.to_string()];
    while let Some(id) = pending.pop() {
        for child in items
            .iter()
            .filter(|item| !item.canceled && item.dependencies.contains(&id))
        {
            if found.insert(child.id.clone()) {
                pending.push(child.id.clone());
            }
        }
    }
    found
}

fn ancestors(items: &[QueueItem], item: &QueueItem) -> HashSet<String> {
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
