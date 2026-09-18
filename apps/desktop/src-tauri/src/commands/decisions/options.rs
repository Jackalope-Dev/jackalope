use super::TaskRuntime;
use crate::commands::history;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Mutex};
use tauri::State;

static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Objective {
    #[default]
    Quality,
    Balanced,
    Economical,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelEvidence {
    pub adapter: String,
    pub model: String,
    pub source: String,
    pub checked_at: String,
    pub capabilities: String,
    pub context_tokens: Option<u64>,
    #[serde(default)]
    pub efforts: Vec<String>,
    pub input_usd_per_million: Option<f64>,
    pub output_usd_per_million: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    pub objective: Objective,
    pub context_selection: bool,
    pub tool_discovery: bool,
    pub agent_questions: bool,
    pub failure_triage: bool,
    pub requirement_coverage: bool,
    pub review_prioritization: bool,
    pub monitor_filtering: bool,
    pub assignment_matching: bool,
    pub models: Vec<ModelEvidence>,
}

impl Options {
    pub fn validate(&self) -> Result<(), String> {
        let mut seen = std::collections::HashSet::new();
        if self.models.len() > 64 {
            return Err("Keep at most 64 model evidence records.".into());
        }
        for model in &self.models {
            if !seen.insert((&model.adapter, &model.model))
                || model.adapter.is_empty()
                || model.adapter.len() > 80
                || model.model.is_empty()
                || model.model.len() > 160
                || model.source.trim().is_empty()
                || model.source.len() > 500
                || model.capabilities.trim().is_empty()
                || model.capabilities.len() > 2000
                || chrono::DateTime::parse_from_rfc3339(&model.checked_at).is_err()
                || model
                    .context_tokens
                    .is_some_and(|n| n == 0 || n > 10_000_000)
                || model.efforts.len() > 8
                || model
                    .efforts
                    .iter()
                    .any(|s| !["low", "medium", "high", "xhigh", "max"].contains(&s.as_str()))
                || [model.input_usd_per_million, model.output_usd_per_million]
                    .into_iter()
                    .flatten()
                    .any(|n| !n.is_finite() || !(0.0..=10000.0).contains(&n))
            {
                return Err("Model evidence needs unique adapter/model IDs, bounded capabilities, a source, an RFC 3339 check date and valid limits/prices.".into());
            }
        }
        Ok(())
    }

    pub fn model(&self, adapter: &str, model: Option<&str>) -> Option<&ModelEvidence> {
        self.models
            .iter()
            .find(|entry| entry.adapter == adapter && Some(entry.model.as_str()) == model)
    }
}

#[derive(Default, Deserialize, Serialize)]
struct Saved {
    #[serde(default)]
    revision: u64,
    #[serde(default)]
    default: Options,
    #[serde(default)]
    projects: BTreeMap<String, Options>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub options: Options,
    pub revision: u64,
    pub inherited: bool,
}

fn read(runtime: &TaskRuntime) -> Result<Saved, String> {
    let path = super::settings::directory(runtime).join("options.json");
    if !path.exists() {
        return Ok(Saved::default());
    }
    serde_json::from_slice(&history::read_bounded(&path, 512_000)?)
        .map_err(|_| "Decision options are unreadable; the original file is preserved.".into())
}

pub fn options(runtime: &TaskRuntime, project: &str) -> Result<Options, String> {
    let _guard = LOCK
        .lock()
        .map_err(|_| "Decision options are unavailable.")?;
    let saved = read(runtime)?;
    Ok(saved
        .projects
        .get(project)
        .unwrap_or(&saved.default)
        .clone())
}

#[tauri::command]
pub fn decision_options(
    runtime: State<'_, TaskRuntime>,
    project_id: Option<String>,
) -> Result<View, String> {
    let _guard = LOCK
        .lock()
        .map_err(|_| "Decision options are unavailable.")?;
    super::settings::validate_project(project_id.as_deref())?;
    let saved = read(&runtime)?;
    let project = project_id.as_ref().and_then(|id| saved.projects.get(id));
    Ok(View {
        options: project.unwrap_or(&saved.default).clone(),
        revision: saved.revision,
        inherited: project_id.is_some() && project.is_none(),
    })
}

#[tauri::command]
pub fn decision_options_save(
    runtime: State<'_, TaskRuntime>,
    project_id: Option<String>,
    revision: u64,
    options: Option<Options>,
) -> Result<View, String> {
    let _guard = LOCK
        .lock()
        .map_err(|_| "Decision options are unavailable.")?;
    super::settings::validate_project(project_id.as_deref())?;
    if let Some(value) = &options {
        value.validate()?;
    }
    let mut saved = read(&runtime)?;
    if revision != saved.revision {
        return Err("Decision options changed. Reload before saving.".into());
    }
    match (&project_id, options) {
        (Some(id), Some(value)) => {
            saved.projects.insert(id.clone(), value);
        }
        (Some(id), None) => {
            saved.projects.remove(id);
        }
        (None, Some(value)) => saved.default = value,
        (None, None) => return Err("Choose default decision options.".into()),
    }
    saved.revision = saved
        .revision
        .checked_add(1)
        .ok_or("Decision revision limit reached.")?;
    let bytes = serde_json::to_vec(&saved).map_err(|e| e.to_string())?;
    if bytes.len() > 512_000 {
        return Err("Too many decision overrides.".into());
    }
    let directory = super::settings::directory(&runtime);
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    history::write_atomic(&directory.join("options.json"), &bytes)?;
    let project = project_id.as_ref().and_then(|id| saved.projects.get(id));
    Ok(View {
        options: project.unwrap_or(&saved.default).clone(),
        revision: saved.revision,
        inherited: project_id.is_some() && project.is_none(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_settings_never_enable_extra_calls_or_change_objective() {
        let options: Options = serde_json::from_str("{}").unwrap();
        assert_eq!(options.objective, Objective::Quality);
        assert!(
            !options.context_selection
                && !options.agent_questions
                && !options.monitor_filtering
                && !options.assignment_matching
        );
        assert!(options.model("codex", Some("unknown")).is_none());
    }
}
