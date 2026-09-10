use serde::{Deserialize, Serialize};
use std::{path::Path, process::Command};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Attribution {
    Agent,
    CoAuthor,
    #[default]
    User,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitPolicy {
    pub attribution: Attribution,
    pub name: String,
    pub email: String,
    pub cleanup_after_merge: bool,
    #[serde(default = "enabled")]
    pub auto_checkpoint: bool,
}

fn enabled() -> bool {
    true
}

fn git(path: &Path, args: &[&str]) -> Result<String, String> {
    let output = super::git_command::command(path, args, super::git_command::Policy::Inspection)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}

pub(super) fn read(path: &Path) -> Result<CommitPolicy, String> {
    let output = super::git_command::command(
        path,
        &["config", "--local", "--get", "jackalope.commitPolicy"],
        super::git_command::Policy::Inspection,
    )
    .output()
    .map_err(|e| e.to_string())?;
    if output.status.success() {
        return serde_json::from_slice(&output.stdout)
            .map_err(|_| "Repair the project's commit settings before continuing.".into());
    }
    if output.status.code() != Some(1) {
        return Err("Cannot read this repository's commit settings.".into());
    }
    Ok(CommitPolicy {
        attribution: Attribution::User,
        name: git(path, &["config", "user.name"]).unwrap_or_default(),
        email: git(path, &["config", "user.email"]).unwrap_or_default(),
        cleanup_after_merge: true,
        auto_checkpoint: true,
    })
}

impl CommitPolicy {
    pub(super) fn validate(&self) -> Result<(), String> {
        if self.attribution == Attribution::Agent {
            return Ok(());
        }
        if self.name.trim().is_empty()
            || !self.email.contains('@')
            || self.name.len() > 200
            || self.email.len() > 254
            || [&self.name, &self.email]
                .iter()
                .any(|v| v.chars().any(|c| c.is_control() || matches!(c, '<' | '>')))
        {
            return Err(
                "Set your commit name and email in Project settings → Commits and cleanup.".into(),
            );
        }
        Ok(())
    }

    pub(super) fn identity(&self, agents: &[String]) -> (String, String) {
        if self.attribution == Attribution::Agent {
            if agents.len() == 1 {
                agent_identity(&agents[0])
            } else {
                ("Jackalope agents".into(), "agents@jackalope.invalid".into())
            }
        } else {
            (self.name.clone(), self.email.clone())
        }
    }

    pub(super) fn message(&self, message: &str, agents: &[String]) -> String {
        let mut message = message.trim().to_string();
        if self.attribution == Attribution::CoAuthor
            || (self.attribution == Attribution::Agent && agents.len() > 1)
        {
            message.push('\n');
            for agent in agents {
                let (name, email) = agent_identity(agent);
                message.push_str(&format!("\nCo-authored-by: {name} <{email}>"));
            }
        }
        message
    }

    pub(super) fn environment(&self, cmd: &mut Command, agents: &[String]) {
        let (name, email) = self.identity(agents);
        cmd.env("GIT_AUTHOR_NAME", &name)
            .env("GIT_AUTHOR_EMAIL", &email)
            .env("GIT_COMMITTER_NAME", &name)
            .env("GIT_COMMITTER_EMAIL", &email);
    }
}

fn agent_identity(agent: &str) -> (String, String) {
    let id: String = agent
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(80)
        .collect();
    let name = match id.as_str() {
        "codex" => "Codex",
        "claude" => "Claude",
        "grok" => "Grok",
        "opencode" => "OpenCode",
        "kimi" => "Kimi Code",
        "antigravity" => "Antigravity",
        _ => "Jackalope agent",
    };
    (
        name.into(),
        format!(
            "{}@agents.jackalope.invalid",
            if id.is_empty() { "agent" } else { &id }
        ),
    )
}

#[tauri::command]
pub async fn project_git_policy(
    project_path: String,
    policy: Option<CommitPolicy>,
) -> Result<CommitPolicy, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = super::integration::execution_guard()?;
        let path = Path::new(&project_path);
        if let Some(policy) = policy {
            policy.validate()?;
            git(
                path,
                &[
                    "config",
                    "--local",
                    "jackalope.commitPolicy",
                    &serde_json::to_string(&policy).map_err(|e| e.to_string())?,
                ],
            )?;
        }
        read(path)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(super) fn contributors(run: &super::tasks::TaskRun) -> Vec<String> {
    let mut agents = vec![run.agent.clone()];
    if let Some(routing) = &run.routing {
        agents.extend(routing.attempts.iter().map(|attempt| attempt.agent.clone()));
    }
    agents.sort();
    agents.dedup();
    agents
}
