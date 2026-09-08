use super::tasks::{RunRequest, TaskRuntime};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};
use tauri::State;
static POLICY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RunnerOptions {
    pub command: Option<String>,
    pub models: Vec<String>,
    pub restrict_models: bool,
    pub default_model: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgent {
    pub id: String,
    pub name: String,
    pub command: String,
    pub adapter: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentPolicy {
    pub enabled_agents: HashMap<String, bool>,
    pub allowed_models: HashMap<String, bool>,
    pub default_meta_agent: String,
    pub custom_agents: Vec<CustomAgent>,
    pub runner_options: HashMap<String, RunnerOptions>,
    pub projects: HashMap<String, ProjectAgentPolicy>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectAgentPolicy {
    pub allowed_agents: Option<Vec<String>>,
    pub agent_accounts: HashMap<String, String>,
    pub preferred_runner: Option<String>,
}

impl AgentPolicy {
    pub fn load(path: &Path) -> Result<Self, String> {
        let _guard = POLICY_LOCK.lock().map_err(|e| e.to_string())?;
        match std::fs::read(path) {
            Ok(data) => serde_json::from_slice(&data)
                .map_err(|e| format!("Agent settings could not be read: {e}")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn resolve(&self, agent: &str) -> Result<(String, PathBuf), String> {
        if self.enabled_agents.get(agent) == Some(&false) {
            return Err(format!(
                "{agent} is disabled in Agents. Enable it or choose another agent."
            ));
        }
        let custom = self.custom_agents.iter().find(|a| a.id == agent);
        let adapter = custom.and_then(|a| a.adapter.as_deref()).unwrap_or(agent);
        if !super::tasks::BUILTIN_AGENTS.contains(&adapter) {
            return Err("Choose a supported CLI adapter for this manually added agent.".into());
        }
        let configured = self
            .runner_options
            .get(agent)
            .and_then(|o| o.command.as_deref())
            .filter(|c| !c.trim().is_empty())
            .or(custom.map(|a| a.command.as_str()));
        let path = match configured {
            Some(value) => {
                let path = PathBuf::from(value);
                if !path.is_absolute() || !path.is_file() {
                    return Err(format!("Set an absolute executable path for {agent}."));
                }
                path
            }
            None => super::tasks::executable(adapter)?,
        };
        Ok((adapter.to_string(), path))
    }

    pub fn model(&self, agent: &str, requested: Option<&str>) -> Result<Option<String>, String> {
        let options = self.runner_options.get(agent).cloned().unwrap_or_default();
        let model = requested
            .filter(|m| !m.is_empty())
            .map(str::to_string)
            .or_else(|| (!options.default_model.is_empty()).then(|| options.default_model.clone()))
            .or_else(|| {
                options
                    .restrict_models
                    .then(|| options.models.first().cloned())
                    .flatten()
            });
        if options.restrict_models && model.as_ref().is_none_or(|m| !options.models.contains(m)) {
            return Err(format!(
                "Choose an allowed model for {agent} in Agents before running work."
            ));
        }
        if let Some(ref model) = model {
            if model.starts_with('-') || model.chars().any(char::is_control) || model.len() > 160 {
                return Err("Invalid model identifier.".into());
            }
            if self.allowed_models.get(model) == Some(&false)
                || self.allowed_models.get(&format!("{agent}:{model}")) == Some(&false)
            {
                return Err(format!("Model {model} is restricted in Agents."));
            }
        } else if self.allowed_models.iter().any(|(key, allowed)| {
            !allowed && (!key.contains(':') || key.starts_with(&format!("{agent}:")))
        }) {
            // Only a restriction that actually applies to this agent - a bare
            // model name (global, every agent) or an "agent:model" key
            // scoped to this one - should force an explicit choice here.
            // Checking `.values()` alone (the previous code) ignored the key
            // entirely, so restricting one model for e.g. Codex specifically
            // would also block Claude/Grok tasks with no model requested,
            // even though that restriction had nothing to do with them.
            return Err("Choose an explicit allowed model in Agents before launching with model restrictions.".into());
        }
        Ok(model)
    }
}

impl TaskRuntime {
    pub(super) fn policy_path(&self) -> PathBuf {
        self.integration_directory()
            .with_file_name("settings")
            .join("agents.json")
    }
    pub(super) fn policy(&self) -> Result<AgentPolicy, String> {
        AgentPolicy::load(&self.policy_path())
    }
    pub(super) fn apply_policy(&self, request: &mut RunRequest) -> Result<(), String> {
        let policy = self.policy()?;
        if request.agent == "auto" {
            if request.previous_run_id.is_some()
                || request.agent_profile_id.is_some()
                || request.model.is_some()
            {
                return Err("Automatic routing cannot override a pinned account, model or existing session.".into());
            }
            let (adapter, _) = policy.resolve(&policy.default_meta_agent)?;
            if !matches!(adapter.as_str(), "codex" | "claude" | "grok" | "opencode") {
                return Err("Choose Codex, Claude, Grok or OpenCode as the default orchestrator in Settings → Agents. Antigravity is available as a worker.".into());
            }
            policy.model(&policy.default_meta_agent, None)?;
            return Ok(());
        }
        if request.agent == "default" {
            if policy.default_meta_agent.is_empty() {
                return Err("Choose a default agent in Agents first.".into());
            }
            request.agent = policy.default_meta_agent.clone();
        }
        policy.resolve(&request.agent)?;
        request.model = policy.model(&request.agent, request.model.as_deref())?;
        Ok(())
    }
}

#[tauri::command]
pub async fn agent_save_policy(
    policy: AgentPolicy,
    runtime: State<'_, TaskRuntime>,
) -> Result<(), String> {
    let _guard = POLICY_LOCK.lock().map_err(|e| e.to_string())?;
    let mut ids = std::collections::HashSet::new();
    for agent in &policy.custom_agents {
        if agent.id.is_empty()
            || super::tasks::BUILTIN_AGENTS.contains(&agent.id.as_str())
            || agent.id == "default"
            || agent.id == "auto"
            || !ids.insert(&agent.id)
        {
            return Err("Custom agents need unique IDs distinct from built-in agents.".into());
        }
    }
    let path = runtime.policy_path();
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    std::fs::write(
        &temp,
        serde_json::to_vec_pretty(&policy).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(temp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_policy_is_scoped_and_fails_closed() {
        let mut policy = AgentPolicy::default();
        policy.runner_options.insert(
            "codex".into(),
            RunnerOptions {
                models: vec!["allowed".into()],
                restrict_models: true,
                ..Default::default()
            },
        );
        assert_eq!(policy.model("codex", None).unwrap(), Some("allowed".into()));
        assert!(policy.model("codex", Some("other")).is_err());
        assert_eq!(
            policy.model("claude", Some("other")).unwrap(),
            Some("other".into())
        );
        policy
            .runner_options
            .get_mut("codex")
            .unwrap()
            .models
            .clear();
        assert!(policy.model("codex", None).is_err());
        policy.enabled_agents.insert("claude".into(), false);
        assert!(policy.resolve("claude").unwrap_err().contains("disabled"));
    }

    #[test]
    fn agent_scoped_model_restriction_does_not_leak_to_other_agents() {
        let mut policy = AgentPolicy::default();
        // Restrict a model only for codex; grok has no restrictions at all.
        policy.allowed_models.insert("codex:gpt-3.5".into(), false);
        assert!(policy.model("grok", None).unwrap().is_none());
        assert!(policy
            .model("codex", None)
            .unwrap_err()
            .contains("explicit"));
        // A bare (unscoped) restriction is genuinely global and must still
        // require an explicit choice everywhere.
        let mut global = AgentPolicy::default();
        global.allowed_models.insert("gpt-3.5".into(), false);
        assert!(global.model("grok", None).is_err());
    }
}
