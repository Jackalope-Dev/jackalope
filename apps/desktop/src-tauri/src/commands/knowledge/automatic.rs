use super::*;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearningSource {
    pub kind: String,
    pub evidence: Vec<String>,
    pub managed: bool,
}

impl TaskRuntime {
    pub(in crate::commands) fn refresh_knowledge(
        &self,
        project_id: &str,
        project_path: &str,
        force: bool,
    ) -> Result<(), String> {
        let key = format!("{project_id}\0{project_path}");
        let mut refreshes = self.knowledge.refreshes.lock().map_err(|e| e.to_string())?;
        if !force
            && refreshes
                .get(&key)
                .is_some_and(|time| time.elapsed().as_secs() < 30)
        {
            return Ok(());
        }
        let mut runs = self.integration_runs()?;
        runs.extend(self.archived_full(100));
        self.knowledge.learn(project_id, project_path, &runs)?;
        refreshes.insert(key, std::time::Instant::now());
        Ok(())
    }
}

fn phrases(text: &str) -> Vec<String> {
    let stop = [
        "always", "never", "prefer", "please", "should", "would", "could", "these", "those",
        "their", "there", "before", "after", "about", "using", "ensure", "instead", "without",
        "with", "from", "this", "that", "have", "only", "when", "must", "still", "work", "works",
        "next", "just", "then", "already", "continue", "thanks",
    ];
    let mut seen = HashSet::new();
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() >= 4 && w.len() <= 60 && !stop.contains(w))
        .filter(|w| seen.insert(w.to_string()))
        .take(8)
        .map(str::to_string)
        .collect()
}

fn candidate(
    project_id: &str,
    path: &str,
    key: &str,
    title: &str,
    content: String,
    mut keywords: Vec<String>,
    kind: &str,
    evidence: String,
    run: Option<&super::super::tasks::TaskRun>,
) -> KnowledgeEntry {
    keywords.sort();
    keywords.dedup();
    let hash = Sha256::digest(format!("learning-v1\0{project_id}\0{path}\0{key}"));
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&hash[..16]);
    KnowledgeEntry {
        id: uuid::Uuid::from_bytes(bytes).to_string(),
        project_id: project_id.into(),
        project_path: path.into(),
        kind: KnowledgeKind::Memory,
        title: title.chars().take(100).collect(),
        content,
        keywords,
        enabled: true,
        dismissed: false,
        process: Default::default(),
        automatic: Some(LearningSource {
            kind: kind.into(),
            evidence: vec![evidence],
            managed: true,
        }),
        source_run_id: run.map(|r| r.id.clone()),
        source_head: run.map(|r| r.base_head.clone()).filter(|s| !s.is_empty()),
        revision: 1,
        updated_at: Utc::now().to_rfc3339(),
    }
}

fn reusable(text: &str) -> bool {
    let text = text.trim();
    let lower = text.to_lowercase();
    text.len() >= 15
        && text.len() <= 500
        && !text.contains(['\0', '\n', '\r'])
        && ![
            "password",
            "secret",
            "token",
            "credential",
            "api key",
            "api_key",
            "bearer",
            "-----begin",
            "://",
            "permission",
            "authorization",
        ]
        .iter()
        .any(|s| lower.contains(s))
}

fn objective(prompt: &str) -> &str {
    prompt
        .strip_prefix("### 🎯 Objective\n")
        .map(|text| text.split("\n\n### ").next().unwrap_or(text))
        .unwrap_or(prompt)
        .trim()
}

fn task_candidates(
    project_id: &str,
    path: &str,
    runs: &[super::super::tasks::TaskRun],
) -> Vec<KnowledgeEntry> {
    let mut values = Vec::new();
    let mut ordered: Vec<_> = runs
        .iter()
        .filter(|r| {
            r.project_id == project_id && !r.details_omitted && r.persistence_error.is_none()
        })
        .collect();
    ordered.sort_by(|a, b| b.started_at.cmp(&a.started_at).then(a.id.cmp(&b.id)));
    let mut seen = HashSet::new();
    for run in ordered
        .into_iter()
        .filter(|r| seen.insert(r.id.clone()))
        .take(200)
    {
        if canonical(&run.project_path).ok().as_deref() != Some(path) {
            continue;
        }
        let answers = run
            .prompts
            .iter()
            .filter(|p| p.status == "answered" && p.input_type == "text")
            .filter_map(|p| p.answer.as_deref());
        let instruction = objective(&run.prompt);
        let before_preferences = values.len();
        let mut in_code = false;
        for line in instruction.lines().chain(answers).take(100) {
            if line.trim_start().starts_with("```") {
                in_code = !in_code;
                continue;
            }
            if in_code {
                continue;
            }
            let line = line.trim().trim_start_matches(['-', '*', ' ']);
            let lower = line.to_lowercase();
            if !["always ", "never ", "prefer "]
                .iter()
                .any(|s| lower.starts_with(s))
                || !reusable(line)
            {
                continue;
            }
            let keywords = phrases(line);
            if keywords.is_empty() {
                continue;
            }
            values.push(candidate(project_id, path, &format!("preference:{}", words(line)), "User preference", format!("Previously requested by the user: {line}\nApply only when relevant to the current task; newer instructions take precedence."), keywords, "preference", format!("Task {}: {}", run.id, line), Some(run)));
        }
        if run.task_id != run.id
            && run.status == "reviewed"
            && values.len() == before_preferences
            && runs.iter().any(|original| {
                original.id == run.task_id
                    && original.project_id == run.project_id
                    && objective(&original.prompt) != instruction
            })
        {
            let adjustment = instruction;
            let keywords = phrases(adjustment);
            if reusable(adjustment) && keywords.len() >= 2 {
                values.push(candidate(project_id, path, &format!("adjustment:{}:{}", run.task_id, words(adjustment)), "Reviewed task adjustment",
                    format!("In a reviewed follow-up, the user requested: {adjustment}\nConsult the source for similar work. This was a task-specific adjustment, not a standing requirement or an instruction to repeat the old task."),
                    keywords, "adjustment", format!("Task {} · reviewed follow-up for task {}", run.id, run.task_id), Some(run)));
            }
        }
        for requirement in &run.contract.requirements {
            let Some(receipt) = &requirement.receipt else {
                continue;
            };
            if receipt.accepted || !reusable(&receipt.note) || requirement.title.len() > 150 {
                continue;
            }
            let keywords = phrases(&requirement.title);
            if keywords.is_empty() {
                continue;
            }
            values.push(candidate(project_id, path, &format!("feedback:{}:{}", run.id, requirement.id), "Review correction", format!("Past review of \"{}\": {}\nCheck this issue when working on the same outcome; this is historical feedback, not proof of a current defect.", requirement.title, receipt.note), keywords, "review", format!("Task {} · review {} · {}", run.id, receipt.recorded_at, requirement.title), Some(run)));
        }
    }
    values
}

fn verified_checks(
    project_id: &str,
    path: &str,
    runs: &[super::super::tasks::TaskRun],
) -> Vec<KnowledgeEntry> {
    let mut commands: BTreeMap<String, BTreeMap<String, &super::super::tasks::TaskRun>> =
        BTreeMap::new();
    for run in runs {
        if run.project_id != project_id
            || run.status != "reviewed"
            || run.persistence_error.is_some()
            || canonical(&run.project_path).ok().as_deref() != Some(path)
        {
            continue;
        }
        if let Some(check) = &run.verification {
            if check.result.success
                && check.tree.is_some()
                && reusable(&format!("Saved verification: {}", check.command))
            {
                commands
                    .entry(check.command.clone())
                    .or_default()
                    .entry(run.task_id.clone())
                    .and_modify(|previous| {
                        if (&run.started_at, &run.id) > (&previous.started_at, &previous.id) {
                            *previous = run;
                        }
                    })
                    .or_insert(run);
            }
        }
    }
    commands.into_iter().filter(|(_, tasks)| tasks.len() >= 2).map(|(command, tasks)| {
        let run = tasks.values().next().unwrap();
        let mut entry = candidate(project_id, path, &format!("check:{command}"), "Repeated successful verification",
            format!("The command {command} passed saved checks in {} distinct reviewed tasks. Consider it for similar changes after inspecting its current definition and scope; past checks do not verify new files.", tasks.len()),
            vec!["test".into(), "tests".into(), "verify".into(), "verification".into(), "check".into()],
            "verification", format!("Task {} · saved verification", run.id), Some(run));
        entry.automatic.as_mut().unwrap().evidence = tasks.values().take(10).map(|r| format!("Task {} · {}", r.id, r.verification.as_ref().unwrap().checked_at)).collect();
        entry
    }).collect()
}

fn test_conventions(project_id: &str, path: &str) -> Vec<KnowledgeEntry> {
    let mut styles: BTreeMap<&str, Vec<String>> = BTreeMap::new();
    let walker = ignore::WalkBuilder::new(path)
        .max_depth(Some(8))
        .follow_links(false)
        .sort_by_file_path(|a, b| a.cmp(b))
        .filter_entry(|entry| {
            !matches!(
                entry.file_name().to_str(),
                Some("node_modules" | "target" | "dist" | "build" | "vendor" | ".worktrees")
            )
        })
        .build();
    for entry in walker.take(2000).flatten() {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        let suffix = [
            ".test.ts",
            ".test.tsx",
            ".spec.ts",
            ".spec.tsx",
            ".test.mjs",
            "_test.py",
            "_test.go",
        ]
        .into_iter()
        .find(|suffix| name.ends_with(suffix));
        if let Some(suffix) = suffix {
            if let Ok(relative) = entry.path().strip_prefix(path) {
                let relative = relative.to_string_lossy().replace('\\', "/");
                if relative.len() <= 200 {
                    styles.entry(suffix).or_default().push(relative);
                }
            }
        }
    }
    styles.into_iter().filter(|(_, files)| files.len() >= 3).map(|(suffix, mut files)| {
        files.sort();
        let mut entry = candidate(project_id, path, &format!("repo:tests:{suffix}"), &format!("Observed {suffix} tests"),
            format!("A bounded repository scan found {} files ending in {suffix}. Inspect nearby tests and their configured runner when adding coverage; this is an observed naming pattern, not a rule for every directory.", files.len()),
            vec!["test".into(), "tests".into(), "testing".into(), "coverage".into()], "repository", files[0].clone(), None);
        entry.automatic.as_mut().unwrap().evidence = files.into_iter().take(10).collect();
        entry
    }).collect()
}

fn repository_candidates(project_id: &str, path: &str) -> Result<Vec<KnowledgeEntry>, String> {
    let root = Path::new(path);
    let mut entries = vec![];
    let manifest = root.join("package.json");
    if manifest.exists() {
        let resolved = dunce::canonicalize(&manifest).map_err(|e| e.to_string())?;
        if !resolved.starts_with(root) {
            return Err("Repository learning skipped a package.json outside this project.".into());
        }
        let bytes = history::read_bounded(&resolved, 256_000)?;
        let json: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|e| format!("Could not inspect package.json for project lessons: {e}"))?;
        if let Some(manager) = json
            .get("packageManager")
            .and_then(|v| v.as_str())
            .filter(|v| reusable(&format!("Package manager {v}")))
        {
            entries.push(candidate(project_id, path, "repo:packageManager", "Repository package manager", format!("package.json declares packageManager = {manager}. Check this declaration before changing dependencies or lockfiles."), vec!["dependencies".into(), "install".into(), "package".into(), "lockfile".into()], "repository", "package.json#packageManager".into(), None));
        }
        if let Some(scripts) = json.get("scripts").and_then(|v| v.as_object()) {
            for name in ["test", "verify", "lint", "format", "typecheck", "build"] {
                let Some(command) = scripts.get(name).and_then(|v| v.as_str()) else {
                    continue;
                };
                if !reusable(&format!("Declared command: {command}")) {
                    continue;
                }
                entries.push(candidate(project_id, path, &format!("repo:script:{name}"), &format!("Repository {name} script"), format!("package.json declares the {name} script as: {command}\nInspect the current script before using it. Discovery does not mean this check has run or passed."), vec![name.into(), "check".into(), "validation".into()], "repository", format!("package.json#scripts.{name}"), None));
            }
        }
    }
    for (name, title, keywords) in [
        ("Cargo.toml", "Rust project manifest", vec!["rust", "cargo"]),
        (
            "pyproject.toml",
            "Python project configuration",
            vec!["python", "dependencies"],
        ),
        (
            ".editorconfig",
            "Repository formatting rules",
            vec!["format", "formatting", "indentation"],
        ),
        (
            "biome.json",
            "Biome configuration",
            vec!["lint", "format", "biome"],
        ),
    ] {
        let file = root.join(name);
        if file.is_file() && dunce::canonicalize(&file).is_ok_and(|p| p.starts_with(root)) {
            entries.push(candidate(project_id, path, &format!("repo:file:{name}"), title, format!("This repository contains {name}. Read its current configuration before changing matching code or tooling."), keywords.into_iter().map(str::to_string).collect(), "repository", name.into(), None));
        }
    }
    Ok(entries)
}

impl KnowledgeStore {
    pub(super) fn learn(
        &self,
        project_id: &str,
        project_path: &str,
        runs: &[super::super::tasks::TaskRun],
    ) -> Result<(), String> {
        let path = canonical(project_path)?;
        // Serialize discovery and reconciliation so an older scan cannot replace newer evidence.
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        let mut entries = self.read()?;
        let mut candidates = repository_candidates(project_id, &path)?;
        candidates.extend(test_conventions(project_id, &path));
        candidates.extend(task_candidates(project_id, &path, runs));
        candidates.extend(verified_checks(project_id, &path, runs));
        let repo_ids: HashSet<_> = candidates
            .iter()
            .filter(|e| e.automatic.as_ref().is_some_and(|a| a.kind == "repository"))
            .map(|e| e.id.clone())
            .collect();
        let mut merged: BTreeMap<String, KnowledgeEntry> = BTreeMap::new();
        for item in candidates
            .into_iter()
            .filter(|e| e.content.len() <= 800 && e.title.len() <= 120)
        {
            if let Some(existing) = merged.get_mut(&item.id) {
                let source = existing.automatic.as_mut().unwrap();
                for evidence in item.automatic.unwrap().evidence {
                    if source.evidence.len() < 10 && !source.evidence.contains(&evidence) {
                        source.evidence.push(evidence);
                    }
                }
            } else {
                merged.insert(item.id.clone(), item);
            }
        }
        let before = serde_json::to_vec(&entries).map_err(|e| e.to_string())?;
        for old in &mut entries {
            if old.project_id == project_id
                && old.project_path == path
                && old
                    .automatic
                    .as_ref()
                    .is_some_and(|a| a.kind == "repository" && a.managed)
                && !repo_ids.contains(&old.id)
                && old.enabled
            {
                old.enabled = false;
                old.revision += 1;
                old.updated_at = Utc::now().to_rfc3339();
            }
        }
        for (_, mut item) in merged {
            if let Some(old) = entries.iter_mut().find(|e| e.id == item.id) {
                if old.dismissed || !old.automatic.as_ref().is_some_and(|a| a.managed) {
                    continue;
                }
                if old.content != item.content || old.automatic != item.automatic {
                    item.enabled = old.enabled;
                    item.revision = old.revision + 1;
                    *old = item;
                }
            } else if entries.len() < 500
                && entries
                    .iter()
                    .filter(|e| e.project_id == project_id)
                    .count()
                    < 100
            {
                entries.push(item);
            }
        }
        if before != serde_json::to_vec(&entries).map_err(|e| e.to_string())? {
            self.write(&entries)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
