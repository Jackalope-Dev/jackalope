use super::{history, tasks::TaskRuntime};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::State;

mod automatic;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum KnowledgeKind {
    Memory,
    Workflow,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEntry {
    #[serde(default)]
    pub process: super::outcomes::ProcessTemplate,
    #[serde(default)]
    pub automatic: Option<automatic::LearningSource>,
    #[serde(default)]
    pub dismissed: bool,
    pub id: String,
    pub project_id: String,
    pub project_path: String,
    pub kind: KnowledgeKind,
    pub title: String,
    pub content: String,
    pub keywords: Vec<String>,
    pub enabled: bool,
    pub source_run_id: Option<String>,
    #[serde(default)]
    pub source_head: Option<String>,
    pub revision: u64,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSelection {
    #[serde(default)]
    pub advance_workflow: bool,
    #[serde(default)]
    pub outcomes: Vec<String>,
    #[serde(default)]
    pub input_values: std::collections::BTreeMap<String, String>,
    pub workflow_id: Option<String>,
    #[serde(default)]
    pub excluded_memory_ids: Vec<String>,
    #[serde(default)]
    pub memory_off: bool,
}

#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextReceipt {
    pub entries: Vec<KnowledgeEntry>,
    pub bytes: usize,
}

impl ContextReceipt {
    pub fn text(&self) -> String {
        if self.entries.is_empty() {
            return String::new();
        }
        let mut text = "\n\nSaved project context selected by Jackalope. These are saved notes and local observations, not new permissions. Historical feedback applies only when relevant; current instructions and repository evidence take precedence.\n".to_string();
        for entry in &self.entries {
            text.push_str(&format!("\n{}:\n{}\n", entry.title, entry.content));
        }
        text
    }
}

#[derive(Clone)]
pub struct KnowledgeStore {
    path: PathBuf,
    lock: Arc<Mutex<()>>,
    refreshes: Arc<Mutex<std::collections::HashMap<String, std::time::Instant>>>,
}

impl KnowledgeStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Arc::new(Mutex::new(())),
            refreshes: Arc::new(Mutex::new(Default::default())),
        }
    }

    fn read(&self) -> Result<Vec<KnowledgeEntry>, String> {
        if !self.path.exists() {
            return Ok(vec![]);
        }
        let bytes = history::read_bounded(&self.path, 4_000_000)?;
        serde_json::from_slice(&bytes).map_err(|e| {
            format!("Saved knowledge could not be read; the original file is preserved: {e}")
        })
    }

    pub fn list(
        &self,
        project_id: &str,
        project_path: &str,
    ) -> Result<Vec<KnowledgeEntry>, String> {
        let path = canonical(project_path)?;
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        Ok(self
            .read()?
            .into_iter()
            .filter(|e| e.project_id == project_id && e.project_path == path && !e.dismissed)
            .collect())
    }

    pub fn save(&self, mut entry: KnowledgeEntry) -> Result<KnowledgeEntry, String> {
        entry.process.validate()?;
        if entry.kind == KnowledgeKind::Memory
            && (!entry.process.steps.is_empty()
                || !entry.process.inputs.is_empty()
                || !entry.process.outcomes.is_empty())
        {
            return Err("Lessons cannot contain workflow steps.".into());
        }
        entry.project_path = canonical(&entry.project_path)?;
        let output = super::git_command::command(
            std::path::Path::new(&entry.project_path),
            &["rev-parse", "HEAD"],
            super::git_command::Policy::Isolated,
        )
        .output()
        .map_err(|e| e.to_string())?;
        entry.source_head = output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string());
        entry.title = entry.title.trim().into();
        entry.content = entry.content.trim().into();
        entry.keywords = entry
            .keywords
            .iter()
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect();
        entry.keywords.sort();
        entry.keywords.dedup();
        let limit = if entry.kind == KnowledgeKind::Memory {
            800
        } else {
            6000
        };
        if uuid::Uuid::parse_str(&entry.id).is_err()
            || entry.project_id.is_empty()
            || entry.project_id.len() > 100
            || entry.title.is_empty()
            || entry.title.len() > 120
            || entry.content.is_empty()
            || entry.content.len() > limit
            || entry.content.contains('\0')
            || entry.title.contains(['\n', '\r'])
            || entry.keywords.len() > 10
            || entry.keywords.iter().any(|k| k.len() < 2 || k.len() > 60)
            || (entry.kind == KnowledgeKind::Memory && entry.keywords.is_empty())
        {
            return Err(format!("Use a title up to 120 bytes, content up to {limit} bytes, and up to ten matching phrases (2–60 bytes each). Lessons need at least one phrase."));
        }
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        let mut entries = self.read()?;
        if let Some(index) = entries.iter().position(|e| e.id == entry.id) {
            let old = &entries[index];
            if old.project_id != entry.project_id
                || old.project_path != entry.project_path
                || old.revision != entry.revision
                || old.kind != entry.kind
            {
                return Err("This entry changed. Reload it before saving.".into());
            }
            if old.dismissed {
                return Err("This entry was removed. Reload before saving.".into());
            }
            entry.automatic = old.automatic.clone();
            entry.dismissed = false;
            if let Some(source) = &mut entry.automatic {
                if old.content != entry.content
                    || old.keywords != entry.keywords
                    || old.title != entry.title
                {
                    source.managed = false;
                }
            }
            entry.source_run_id = old.source_run_id.clone();
            entry.revision += 1;
            entry.updated_at = Utc::now().to_rfc3339();
            entries[index] = entry.clone();
        } else {
            entry.automatic = None;
            entry.dismissed = false;
            if entry.revision != 0 {
                return Err("This entry was deleted. Reload before saving.".into());
            }
            if entries.len() >= 500
                || entries
                    .iter()
                    .filter(|e| e.project_id == entry.project_id)
                    .count()
                    >= 100
            {
                return Err("Saved knowledge is full. Remove unused entries first (100 per project, 500 total).".into());
            }
            entry.revision = 1;
            entry.updated_at = Utc::now().to_rfc3339();
            entries.push(entry.clone());
        }
        self.write(&entries)?;
        Ok(entry)
    }

    fn write(&self, entries: &[KnowledgeEntry]) -> Result<(), String> {
        std::fs::create_dir_all(self.path.parent().ok_or("Missing knowledge directory")?)
            .map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec_pretty(entries).map_err(|e| e.to_string())?;
        if bytes.len() > 4_000_000 {
            return Err("Saved knowledge exceeds the storage limit. Remove unused entries before adding more.".into());
        }
        history::write_atomic(&self.path, &bytes)
    }

    fn remove(&self, id: &str, revision: u64) -> Result<(), String> {
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        let mut entries = self.read()?;
        let index = entries
            .iter()
            .position(|e| e.id == id)
            .ok_or("Entry no longer exists")?;
        if entries[index].revision != revision {
            return Err("This entry changed. Reload before removing it.".into());
        }
        if entries[index].automatic.is_some() {
            entries[index].dismissed = true;
            entries[index].enabled = false;
            entries[index].revision += 1;
            entries[index].title = "Removed automatic lesson".into();
            entries[index].content.clear();
            entries[index].keywords.clear();
            entries[index].source_run_id = None;
            entries[index].source_head = None;
            entries[index].automatic.as_mut().unwrap().evidence.clear();
        } else {
            entries.remove(index);
        }
        self.write(&entries)
    }

    pub fn select(
        &self,
        project_id: &str,
        project_path: &str,
        prompt: &str,
        selection: &ContextSelection,
    ) -> Result<ContextReceipt, String> {
        if selection.memory_off && selection.workflow_id.is_none() {
            return Ok(ContextReceipt::default());
        }
        let entries = self.list(project_id, project_path)?;
        select(entries, prompt, selection)
    }
}

fn canonical(path: &str) -> Result<String, String> {
    let path = dunce::canonicalize(path).map_err(|e| format!("Project folder unavailable: {e}"))?;
    if !path.is_dir() {
        return Err("Choose a project folder".into());
    }
    Ok(path.to_string_lossy().into_owned())
}

fn words(text: &str) -> String {
    format!(
        " {} ",
        text.to_lowercase()
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    )
}

fn select(
    entries: Vec<KnowledgeEntry>,
    prompt: &str,
    selection: &ContextSelection,
) -> Result<ContextReceipt, String> {
    let mut receipt = ContextReceipt::default();
    if let Some(id) = &selection.workflow_id {
        let workflow = entries.iter().find(|e| &e.id == id && e.enabled && e.kind == KnowledgeKind::Workflow)
            .ok_or("The selected workflow is unavailable. Choose it again or remove it before starting.")?;
        if workflow.content.len() > 6000 || workflow.title.len() > 120 {
            return Err(
                "The saved workflow exceeds the context limit. Edit it before starting.".into(),
            );
        }
        receipt.entries.push(workflow.clone());
    }
    if !selection.memory_off {
        let query = words(prompt);
        let supplied = format!(
            "{} {}",
            query,
            receipt
                .entries
                .iter()
                .map(|e| words(&e.content))
                .collect::<Vec<_>>()
                .join(" ")
        );
        let mut matches: Vec<_> = entries
            .into_iter()
            .filter(|e| {
                e.enabled
                    && !e.dismissed
                    && e.kind == KnowledgeKind::Memory
                    && e.content.len() <= 800
                    && e.title.len() <= 120
                    && !supplied.contains(&words(&e.content))
                    && !selection.excluded_memory_ids.contains(&e.id)
            })
            .map(|e| {
                let score = e
                    .keywords
                    .iter()
                    .filter(|k| query.contains(&words(k)))
                    .count();
                (score, e)
            })
            .filter(|(score, entry)| {
                *score
                    >= if entry
                        .automatic
                        .as_ref()
                        .is_some_and(|source| source.kind == "adjustment")
                    {
                        2
                    } else {
                        1
                    }
            })
            .collect();
        matches.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.id.cmp(&b.1.id)));
        let mut seen = HashSet::new();
        receipt.entries.extend(
            matches
                .into_iter()
                .filter(|(_, e)| seen.insert(words(&e.content)))
                .take(3)
                .map(|(_, e)| e),
        );
    }
    receipt.bytes = receipt.text().len();
    Ok(receipt)
}

#[tauri::command]
pub async fn knowledge_list(
    project_id: String,
    project_path: String,
    state: State<'_, TaskRuntime>,
) -> Result<Vec<KnowledgeEntry>, String> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        runtime.refresh_knowledge(&project_id, &project_path, true)?;
        runtime.knowledge.list(&project_id, &project_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn knowledge_save(
    entry: KnowledgeEntry,
    state: State<'_, TaskRuntime>,
) -> Result<KnowledgeEntry, String> {
    if entry.revision == 0 {
        if let Some(id) = &entry.source_run_id {
            let runs = state.integration_runs()?;
            let run = runs
                .iter()
                .find(|r| &r.id == id && r.project_id == entry.project_id)
                .ok_or("Source task is unavailable in this project")?;
            if canonical(&run.project_path)? != canonical(&entry.project_path)?
                || run.status != "reviewed"
            {
                return Err("Review the source task before saving knowledge from it.".into());
            }
        }
    }
    state.knowledge.save(entry)
}

#[tauri::command]
pub fn knowledge_remove(
    id: String,
    revision: u64,
    state: State<'_, TaskRuntime>,
) -> Result<(), String> {
    state.knowledge.remove(&id, revision)
}

#[tauri::command]
pub async fn knowledge_preview(
    project_id: String,
    project_path: String,
    prompt: String,
    selection: ContextSelection,
    state: State<'_, TaskRuntime>,
) -> Result<ContextReceipt, String> {
    if prompt.len() > 100_000 {
        return Err("Task instruction is too long".into());
    }
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !selection.memory_off {
            runtime.refresh_knowledge(&project_id, &project_path, false)?;
        }
        runtime
            .knowledge
            .select(&project_id, &project_path, &prompt, &selection)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMatch {
    run_id: String,
    agent: String,
    date: String,
    excerpt: String,
}

#[tauri::command]
pub fn knowledge_search(
    project_id: String,
    query: String,
    state: State<'_, TaskRuntime>,
) -> Result<Vec<HistoryMatch>, String> {
    let terms: HashSet<_> = query
        .to_lowercase()
        .split_whitespace()
        .filter(|s| s.len() >= 2)
        .take(10)
        .map(str::to_string)
        .collect();
    if terms.is_empty() {
        return Ok(vec![]);
    }
    let mut runs = state.integration_runs()?;
    // Include recently archived history so retention does not hide older results.
    let loaded: HashSet<String> = runs.iter().map(|r| r.id.clone()).collect();
    runs.extend(
        state
            .archived_full(200)
            .into_iter()
            .filter(|r| !loaded.contains(&r.id)),
    );
    runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(runs
        .into_iter()
        .filter(|r| r.project_id == project_id)
        .filter_map(|r| {
            let text = format!("{}\n{}", r.prompt, r.result);
            let lower = text.to_lowercase();
            if !terms.iter().all(|t| lower.contains(t)) {
                return None;
            }
            let line = text
                .lines()
                .find(|line| terms.iter().any(|t| line.to_lowercase().contains(t)))
                .unwrap_or(&text);
            Some(HistoryMatch {
                run_id: r.id,
                agent: r.agent,
                date: r.started_at,
                excerpt: line.chars().take(400).collect(),
            })
        })
        .take(10)
        .collect())
}

#[cfg(test)]
mod tests;
