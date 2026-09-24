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
    pub automatic_quota_handoff: Option<bool>,
    pub enabled_agents: HashMap<String, bool>,
    pub disabled_accounts: HashMap<String, Vec<String>>,
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
    pub disabled_accounts: HashMap<String, Vec<String>>,
    pub agent_accounts: HashMap<String, String>,
    pub preferred_runner: Option<String>,
}

impl AgentPolicy {
    pub fn agent_allowed(&self, project: &str, agent: &str) -> bool {
        self.enabled_agents.get(agent) != Some(&false)
            && self.projects.get(project).is_none_or(|project| {
                project
                    .allowed_agents
                    .as_ref()
                    .is_none_or(|agents| agents.iter().any(|id| id == agent))
            })
    }

    pub fn default_agent(&self, project: &str) -> &str {
        self.projects
            .get(project)
            .and_then(|project| project.preferred_runner.as_deref())
            .filter(|agent| !agent.is_empty())
            .unwrap_or(&self.default_meta_agent)
    }

    pub fn routing_agent(&self, project: &str) -> Result<&str, String> {
        let project_policy = self.projects.get(project);
        let candidates = std::iter::once(self.default_agent(project))
            .chain(std::iter::once(self.default_meta_agent.as_str()))
            .chain(
                project_policy
                    .and_then(|project| project.allowed_agents.as_ref())
                    .into_iter()
                    .flatten()
                    .map(String::as_str),
            );
        for agent in candidates {
            let adapter = self
                .custom_agents
                .iter()
                .find(|custom| custom.id == agent)
                .and_then(|custom| custom.adapter.as_deref())
                .unwrap_or(agent);
            if self.agent_allowed(project, agent)
                && matches!(adapter, "codex" | "claude" | "grok" | "opencode" | "kimi")
            {
                return Ok(agent);
            }
        }
        Err("Choose an enabled Codex, Claude, Grok, OpenCode or Kimi Code agent for this project in Settings → Agents.".into())
    }

    pub(super) fn model_for_account(
        &self,
        agent: &str,
        requested: Option<&str>,
        binding: &super::agent_profiles::AccountBinding,
    ) -> Result<Option<String>, String> {
        if let Some(model) = super::agent_profiles::local_model(binding)? {
            let id = format!("{}/{model}", super::local_ai::PROVIDER);
            if requested.is_some_and(|requested| requested != id) {
                return Err("This local account uses its verified model. Clear the task model override or choose another account.".into());
            }
            self.model(agent, Some(&id))
        } else {
            let preferred = super::agent_profiles::preferred_model(binding)?;
            let model = self.model(
                agent,
                requested
                    .filter(|value| !value.is_empty())
                    .or(preferred.as_deref()),
            )?;
            if model
                .as_ref()
                .is_some_and(|id| id.starts_with("jackalope-local/"))
            {
                return Err("Choose the matching local account to use this model.".into());
            }
            Ok(model)
        }
    }

    pub fn account_allowed(
        &self,
        project: &str,
        agent: &str,
        binding: &super::agent_profiles::AccountBinding,
    ) -> bool {
        let id = binding.profile_id.as_deref().unwrap_or("__default");
        let blocked = |accounts: &HashMap<String, Vec<String>>| {
            [agent, binding.adapter.as_str()].iter().any(|key| {
                accounts
                    .get(*key)
                    .is_some_and(|ids| ids.iter().any(|value| value == id))
            })
        };
        !blocked(&self.disabled_accounts)
            && !self
                .projects
                .get(project)
                .is_some_and(|project| blocked(&project.disabled_accounts))
    }

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
                if !path.is_absolute() || !super::platform::is_executable(&path) {
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
            let agent = policy.routing_agent(&request.project_id)?;
            let (adapter, _) = policy.resolve(agent)?;
            if !matches!(
                adapter.as_str(),
                "codex" | "claude" | "grok" | "opencode" | "kimi"
            ) {
                return Err("Choose Codex, Claude, Grok, OpenCode or Kimi Code as the default orchestrator in Settings → Agents. Antigravity is available as a worker.".into());
            }
            if adapter != "opencode" {
                policy.model(agent, None)?;
            }
            return Ok(());
        }
        if request.agent == "default" {
            if policy.default_agent(&request.project_id).is_empty() {
                return Err("Choose a default agent in Agents first.".into());
            }
            request.agent = policy.default_agent(&request.project_id).into();
        }
        let (adapter, _) = policy.resolve(&request.agent)?;
        if let Some(project) = policy.projects.get(&request.project_id) {
            if project
                .allowed_agents
                .as_ref()
                .is_some_and(|agents| !agents.contains(&request.agent))
            {
                return Err("This agent is disabled for this project in Settings.".into());
            }
            if let Some(account) = project
                .agent_accounts
                .get(&adapter)
                .or_else(|| project.agent_accounts.get(&request.agent))
                .filter(|_| request.previous_run_id.is_none())
            {
                if request
                    .agent_profile_id
                    .as_ref()
                    .is_some_and(|id| id != account)
                {
                    return Err("Choose the account assigned to this project in Settings.".into());
                }
                request.agent_profile_id = Some(account.clone());
            }
        }
        if adapter != "opencode" {
            request.model = policy.model(&request.agent, request.model.as_deref())?;
        }
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
    fn project_defaults_and_routing_never_escape_the_project_agent_list() {
        let mut policy: AgentPolicy = serde_json::from_value(serde_json::json!({
            "defaultMetaAgent": "codex",
            "projects": {
                "work": {"allowedAgents": ["claude"], "preferredRunner": "claude"},
                "personal": {"allowedAgents": ["codex"], "preferredRunner": "codex"},
                "empty": {"allowedAgents": []},
                "legacy": {"allowedAgents": ["claude"]}
            }
        }))
        .unwrap();
        assert_eq!(policy.default_agent("work"), "claude");
        assert_eq!(policy.default_agent("personal"), "codex");
        assert_eq!(policy.default_agent("unknown"), "codex");
        assert_eq!(policy.routing_agent("work").unwrap(), "claude");
        assert_eq!(policy.routing_agent("personal").unwrap(), "codex");
        assert_eq!(policy.routing_agent("legacy").unwrap(), "claude");
        assert!(policy.routing_agent("empty").is_err());
        assert!(!policy.agent_allowed("work", "codex"));
        policy.enabled_agents.insert("claude".into(), false);
        assert!(policy.routing_agent("work").is_err());
        assert_eq!(policy.routing_agent("personal").unwrap(), "codex");
    }

    #[test]
    fn project_policy_applies_to_new_work_and_keeps_continuation_account_binding() {
        let root =
            std::env::temp_dir().join(format!("jackalope-project-policy-{}", uuid::Uuid::new_v4()));
        let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
        let policy: AgentPolicy = serde_json::from_value(serde_json::json!({
            "defaultMetaAgent": "codex",
            "runnerOptions": {"claude": {"command": std::env::current_exe().unwrap()}},
            "projects": {"work": {
                "allowedAgents": ["claude"], "preferredRunner": "claude",
                "agentAccounts": {"claude": "work-login"},
                "disabledAccounts": {"claude": ["personal-login"]}
            }}
        }))
        .unwrap();
        std::fs::create_dir_all(runtime.policy_path().parent().unwrap()).unwrap();
        std::fs::write(runtime.policy_path(), serde_json::to_vec(&policy).unwrap()).unwrap();
        let request = || {
            serde_json::from_value::<RunRequest>(serde_json::json!({
                "id": "policy-fixture", "projectId": "work", "projectName": "Work",
                "projectPath": root, "agent": "default", "prompt": "Fixture", "isolated": true
            }))
            .unwrap()
        };
        let mut fresh = request();
        runtime.apply_policy(&mut fresh).unwrap();
        assert_eq!(fresh.agent, "claude");
        assert_eq!(fresh.agent_profile_id.as_deref(), Some("work-login"));
        let mut explicit = request();
        explicit.agent_profile_id = Some("personal-login".into());
        assert!(runtime
            .apply_policy(&mut explicit)
            .unwrap_err()
            .contains("assigned"));
        let mut continuation = request();
        continuation.agent = "claude".into();
        continuation.previous_run_id = Some("original".into());
        continuation.agent_profile_id = Some("original-login".into());
        runtime.apply_policy(&mut continuation).unwrap();
        assert_eq!(
            continuation.agent_profile_id.as_deref(),
            Some("original-login")
        );
        let mut automatic = request();
        automatic.agent = "auto".into();
        runtime.apply_policy(&mut automatic).unwrap();
        let binding = super::super::agent_profiles::AccountBinding {
            adapter: "claude".into(),
            profile_id: Some("personal-login".into()),
            directory: root.clone(),
            label: "Fixture".into(),
        };
        assert!(!policy.account_allowed("work", "claude", &binding));
        assert!(policy.account_allowed("personal", "claude", &binding));
    }

    #[test]
    fn account_restrictions_apply_to_app_project_and_custom_adapters() {
        let mut policy = AgentPolicy::default();
        let mut binding = super::super::agent_profiles::AccountBinding {
            adapter: "codex".into(),
            profile_id: Some("work".into()),
            directory: PathBuf::new(),
            label: "fixture".into(),
        };
        assert!(policy.account_allowed("project", "custom", &binding));
        policy
            .disabled_accounts
            .insert("codex".into(), vec!["work".into()]);
        assert!(!policy.account_allowed("project", "custom", &binding));
        policy.disabled_accounts.clear();
        let mut project = ProjectAgentPolicy::default();
        project
            .disabled_accounts
            .insert("codex".into(), vec!["work".into(), "__default".into()]);
        policy.projects.insert("project".into(), project);
        assert!(!policy.account_allowed("project", "codex", &binding));
        assert!(policy.account_allowed("other", "codex", &binding));
        binding.profile_id = None;
        assert!(!policy.account_allowed("project", "codex", &binding));
        let legacy: AgentPolicy = serde_json::from_str("{}").unwrap();
        assert!(legacy.account_allowed("project", "codex", &binding));
    }
    #[test]
    fn older_policy_keeps_quota_handoff_enabled() {
        let policy: AgentPolicy = serde_json::from_str("{}").unwrap();
        assert_ne!(policy.automatic_quota_handoff, Some(false));
        let disabled: AgentPolicy =
            serde_json::from_str(r#"{"automaticQuotaHandoff":false}"#).unwrap();
        assert_eq!(disabled.automatic_quota_handoff, Some(false));
    }
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
