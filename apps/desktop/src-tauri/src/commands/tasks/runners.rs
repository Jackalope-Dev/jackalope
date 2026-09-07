use super::*;

pub(in crate::commands) const BUILTIN_AGENTS: &[&str] = &["codex", "claude", "grok", "opencode"];

pub(super) fn discover_runner(
    policy: &crate::commands::agent_policy::AgentPolicy,
    id: &str,
    profiles_root: &std::path::Path,
) -> Runner {
    let mut runner = Runner {
        id: id.to_string(),
        name: match id {
            "codex" => "Codex",
            "claude" => "Claude Code",
            "grok" => "Grok",
            "opencode" => "OpenCode",
            _ => id,
        }
        .into(),
        available: false,
        signed_in: false,
        account: "Current CLI account".into(),
        detail: String::new(),
    };
    let mut discovery = policy.clone();
    discovery.enabled_agents.clear();
    match discovery.resolve(id) {
        Err(error) => runner.detail = error,
        Ok((adapter, path)) => {
            runner.available = true;
            let profile_env =
                crate::commands::agent_profiles::env_var_for(&adapter).and_then(|name| {
                    crate::commands::agent_profiles::active_profile_dir(profiles_root, &adapter)
                        .map(|dir| (name, dir))
                });
            if adapter == "grok" {
                runner.detail = "Installed. Grok checks its existing sign-in on launch; this version exposes no separate login-status command.".into();
                return runner;
            }
            if adapter == "opencode" {
                runner.detail = "Installed. OpenCode validates the selected provider on launch; saved credentials do not prove current access. Free and local models may not require sign-in. Managed profiles isolate its saved credentials and sessions.".into();
                return runner;
            }
            let args = if adapter == "codex" {
                vec!["login", "status"]
            } else {
                vec!["auth", "status"]
            };
            match probe_auth(path, args, profile_env) {
                Ok(out) => {
                    if adapter == "claude" {
                        if let Ok(auth) = serde_json::from_slice::<Value>(&out.stdout) {
                            runner.signed_in = auth["loggedIn"] == true;
                            runner.account = auth["email"]
                                .as_str()
                                .unwrap_or("Current CLI account")
                                .into();
                        }
                    } else {
                        runner.signed_in = out.status.success();
                    }
                    runner.detail = if runner.signed_in {
                        "Uses your existing CLI sign-in. Model follows your agent configuration."
                    } else {
                        "Sign in using the agent's CLI, then refresh."
                    }
                    .into();
                }
                Err(error) => runner.detail = error.to_string(),
            }
        }
    }
    if let Some(custom) = policy.custom_agents.iter().find(|a| a.id == id) {
        runner.name = custom.name.clone();
    }
    runner
}

pub(in crate::commands) fn executable(agent: &str) -> Result<PathBuf, String> {
    if !BUILTIN_AGENTS.contains(&agent) {
        return Err("Unsupported agent".into());
    }
    let name = if cfg!(windows) {
        format!("{agent}.exe")
    } else {
        agent.to_string()
    };
    let mut dirs: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        dirs.push(PathBuf::from(&home).join(".local/bin"));
        dirs.push(PathBuf::from(&home).join(".grok/bin"));
        dirs.push(PathBuf::from(home).join(".opencode/bin"));
    }
    if agent == "opencode" {
        if let Some(roaming) = std::env::var_os("APPDATA") {
            dirs.push(PathBuf::from(roaming).join("npm/node_modules/opencode-ai/bin"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(
                PathBuf::from(local).join("Jackalope/agent-tools/node_modules/opencode-ai/bin"),
            );
        }
    }
    if agent == "codex" {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            if let Ok(entries) = std::fs::read_dir(PathBuf::from(local).join("OpenAI/Codex/bin")) {
                let mut versions: Vec<_> = entries.flatten().map(|e| e.path()).collect();
                versions.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
                versions.reverse();
                dirs.extend(versions);
            }
        }
    }
    dirs.into_iter()
        .map(|p| p.join(&name))
        .find(|p| p.is_file())
        .ok_or_else(|| {
            format!("Install {agent} and make its executable available on PATH, then refresh.")
        })
}
