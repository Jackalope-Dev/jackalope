use super::*;

#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencySnapshot {
    #[serde(default)]
    pub reconciles: bool,
    #[serde(default)]
    pub target_head: Option<String>,
    pub base: String,
    pub sources: Vec<IntegrationSource>,
}

pub fn validate_dependencies(
    directory: &Path,
    runs: &[TaskRun],
    run: &TaskRun,
) -> Result<(), String> {
    if run.dependency_invalidated {
        return Err(
            "A predecessor was retried. Preserve this work and create a fresh feature plan.".into(),
        );
    }
    for source in &run.dependency_snapshot.sources {
        let current = runs.iter().find(|r| r.id == source.run_id).ok_or(
            "A feature predecessor is unavailable. Restore its history before continuing.",
        )?;
        selected_runs(runs, &[current.id.clone()])?;
        let now = snapshot(current, directory)?;
        if now.tree != source.tree || now.head != source.head || now.status != source.status {
            return Err("A feature predecessor changed. Preserve this work and create a new plan from the updated sources before continuing or integrating.".into());
        }
        verified(current, &now.tree)?;
    }
    Ok(())
}

pub(in crate::commands) fn verified(run: &TaskRun, tree: &str) -> Result<(), String> {
    super::super::verification::ensure_idle(&run.workspace)?;
    super::super::previews::ensure_idle(&run.workspace)?;
    let check = run
        .verification
        .as_ref()
        .ok_or("Verify the predecessor before continuing the feature.")?;
    if !check.result.success
        || check.tree.as_deref() != Some(tree)
        || run.verify_command.as_deref() != Some(check.command.as_str())
    {
        return Err("The predecessor needs successful verification for its current files.".into());
    }
    Ok(())
}

// This creates retained Git objects only; it never changes a source or the target branch.
pub fn prepare_dependencies(
    directory: &Path,
    runs: &[TaskRun],
    ids: &[String],
    id: &str,
) -> Result<DependencySnapshot, String> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let selected = selected_runs(runs, ids)?;
    let project = canonical(&selected[0].project_path)?;
    let target = selected[0].target_branch.as_deref().unwrap_or("master");
    let mut combined = git(&project, &["rev-parse", &format!("refs/heads/{target}")])?;
    let mut sources = Vec::<IntegrationSource>::new();
    for run in &selected {
        if run.target_branch.as_deref().unwrap_or("master") != target {
            return Err("Feature predecessors must use the same target branch.".into());
        }
        validate_dependencies(directory, runs, run)?;
        let source = snapshot(run, directory)?;
        verified(run, &source.tree)?;
        for ancestor in &run.dependency_snapshot.sources {
            if !sources.iter().any(|s| s.run_id == ancestor.run_id) {
                sources.push(ancestor.clone());
            }
        }
        let commit = commit_tree(
            &project,
            &source.tree,
            &[&run.base_head],
            &format!("feat: integrate completed task {}", run.id),
        )?;
        let output = command(
            &project,
            &["merge-tree", "--write-tree", &combined, &commit],
        )
        .output()
        .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err("Feature predecessor snapshots conflict. Review and correct the sources before retrying.".into());
        }
        let tree = String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .unwrap_or("")
            .to_string();
        combined = commit_tree(
            &project,
            &tree,
            &[&combined, &commit],
            "Jackalope feature dependency base",
        )?;
        if !sources.iter().any(|s| s.run_id == source.run_id) {
            sources.push(source);
        }
    }
    git(
        &project,
        &[
            "update-ref",
            &format!("refs/jackalope/dependencies/{id}"),
            &combined,
        ],
    )?;
    Ok(DependencySnapshot {
        base: combined,
        sources,
        ..Default::default()
    })
}

pub(in crate::commands) fn reconciliation_input(
    directory: &Path,
    runs: &[TaskRun],
    ids: &[String],
    id: &str,
) -> Result<DependencySnapshot, String> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let selected = selected_runs(runs, ids)?;
    let project = canonical(&selected[0].project_path)?;
    let target = selected[0].target_branch.as_deref().unwrap_or("master");
    let target_head = git(&project, &["rev-parse", &format!("refs/heads/{target}")])?;
    let mut combined = target_head.clone();
    let mut sources = Vec::new();
    for run in &selected {
        if run.target_branch.as_deref().unwrap_or("master") != target {
            return Err("Reconcile tasks with the same target branch.".into());
        }
        validate_dependencies(directory, runs, run)?;
        if run
            .dependency_snapshot
            .sources
            .iter()
            .any(|s| !ids.contains(&s.run_id))
        {
            return Err("Include all predecessors in reconciliation.".into());
        }
        let source = snapshot(run, directory)?;
        verified(run, &source.tree)?;
        let commit = commit_tree(
            &project,
            &source.tree,
            &[&run.base_head],
            "Jackalope reconciliation input",
        )?;
        let output = command(
            &project,
            &["merge-tree", "--write-tree", &combined, &commit],
        )
        .output()
        .map_err(|e| e.to_string())?;
        if !output.status.success() && output.status.code() != Some(1) {
            return Err("Git could not construct a reconciliation input.".into());
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let tree = text
            .lines()
            .next()
            .filter(|s| !s.is_empty())
            .ok_or("Missing reconciliation tree.")?;
        combined = commit_tree(
            &project,
            tree,
            &[&combined, &commit],
            "Jackalope reconciliation workspace",
        )?;
        sources.push(source);
    }
    git(
        &project,
        &[
            "update-ref",
            &format!("refs/jackalope/dependencies/{id}"),
            &combined,
        ],
    )?;
    Ok(DependencySnapshot {
        base: combined,
        sources,
        reconciles: true,
        target_head: Some(target_head),
    })
}
