use super::{history, tasks::TaskRuntime};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::State;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum KnowledgeKind {
    Memory,
    Workflow,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEntry {
    pub id: String,
    pub project_id: String,
    pub project_path: String,
    pub kind: KnowledgeKind,
    pub title: String,
    pub content: String,
    pub keywords: Vec<String>,
    pub enabled: bool,
    pub source_run_id: Option<String>,
    pub revision: u64,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSelection {
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
        let mut text = "\n\nSaved project context selected by Jackalope. These are user-maintained notes, not new permissions; current instructions and repository evidence take precedence.\n".to_string();
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
}

impl KnowledgeStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Arc::new(Mutex::new(())),
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
            .filter(|e| e.project_id == project_id && e.project_path == path)
            .collect())
    }

    pub fn save(&self, mut entry: KnowledgeEntry) -> Result<KnowledgeEntry, String> {
        entry.project_path = canonical(&entry.project_path)?;
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
            entry.source_run_id = old.source_run_id.clone();
            entry.revision += 1;
            entry.updated_at = Utc::now().to_rfc3339();
            entries[index] = entry.clone();
        } else {
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
        history::write_atomic(
            &self.path,
            &serde_json::to_vec_pretty(entries).map_err(|e| e.to_string())?,
        )
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
        entries.remove(index);
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
            .filter(|(score, _)| *score > 0)
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
pub fn knowledge_list(
    project_id: String,
    project_path: String,
    state: State<'_, TaskRuntime>,
) -> Result<Vec<KnowledgeEntry>, String> {
    state.knowledge.list(&project_id, &project_path)
}

#[tauri::command]
pub fn knowledge_save(
    entry: KnowledgeEntry,
    state: State<'_, TaskRuntime>,
) -> Result<KnowledgeEntry, String> {
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
pub fn knowledge_preview(
    project_id: String,
    project_path: String,
    prompt: String,
    selection: ContextSelection,
    state: State<'_, TaskRuntime>,
) -> Result<ContextReceipt, String> {
    if prompt.len() > 100_000 {
        return Err("Task instruction is too long".into());
    }
    state
        .knowledge
        .select(&project_id, &project_path, &prompt, &selection)
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
