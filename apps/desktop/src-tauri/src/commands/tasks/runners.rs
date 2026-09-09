use super::*;

pub(in crate::commands) const BUILTIN_AGENTS: &[&str] = &[
    "codex",
    "claude",
    "grok",
    "opencode",
    "antigravity",
    "gemini",
    "aider",
    "goose",
];

pub(super) fn discover_runner(
    policy: &crate::commands::agent_policy::AgentPolicy,
    id: &str,
    profiles_root: &std::path::Path,
) -> Runner {
    let mut runner = Runner {
        desktop_installed: id == "antigravity" && antigravity_desktop_installed(),
        id: id.to_string(),
        name: match id {
            "codex" => "Codex",
            "claude" => "Claude Code",
            "grok" => "Grok",
            "opencode" => "OpenCode",
            "antigravity" => "Antigravity",
            "gemini" => "Gemini CLI",
            "aider" => "Aider",
            "goose" => "Goose",
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
        Err(error) => {
            runner.detail = if runner.desktop_installed {
                "Antigravity desktop app found. Install the separate agy CLI to run tasks in Jackalope, then open agy to sign in and check agents again.".into()
            } else {
                error
            };
        }
        Ok((adapter, path)) => {
            runner.available = true;
            if adapter == "antigravity" {
                runner.account = "Current Antigravity CLI account (identity not reported)".into();
                runner.detail = "Uses agy and its existing CLI sign-in and permission settings. Access is checked when a task starts. Sign in with agy, then refresh. Separate Jackalope accounts are unavailable; changing the CLI account also affects continuations.".into();
                return runner;
            }
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
            if adapter == "gemini" {
                runner.detail = "Installed. Gemini CLI validates credentials on launch. Sign in with gemini login or set GEMINI_API_KEY.".into();
                return runner;
            }
            if adapter == "aider" {
                runner.detail = "Installed. Aider pair programming uses configured provider keys (e.g. OPENAI_API_KEY or ANTHROPIC_API_KEY).".into();
                return runner;
            }
            if adapter == "goose" {
                runner.detail = "Installed. Goose developer agent with local automation and extension capabilities.".into();
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
    let binary = if agent == "antigravity" { "agy" } else { agent };
    let candidates: Vec<String> = if cfg!(windows) {
        vec![
            format!("{binary}.exe"),
            format!("{binary}.cmd"),
            format!("{binary}.bat"),
            binary.to_string(),
        ]
    } else {
        vec![binary.to_string()]
    };
    let mut dirs: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        let home_path = PathBuf::from(&home);
        dirs.push(home_path.join(".local/bin"));
        dirs.push(home_path.join(".grok/bin"));
        dirs.push(home_path.join(".opencode/bin"));
        dirs.push(home_path.join(".cargo/bin"));
        dirs.push(home_path.join(".npm-global/bin"));
        if cfg!(windows) {
            dirs.push(home_path.join("scoop/shims"));
            dirs.push(home_path.join(".pipx/venvs"));
        }
    }
    if let Some(roaming) = std::env::var_os("APPDATA") {
        let roaming_path = PathBuf::from(&roaming);
        dirs.push(roaming_path.join("npm"));
        dirs.push(roaming_path.join("npm/node_modules/opencode-ai/bin"));
        dirs.push(roaming_path.join("Python/Python310/Scripts"));
        dirs.push(roaming_path.join("Python/Python311/Scripts"));
        dirs.push(roaming_path.join("Python/Python312/Scripts"));
        dirs.push(roaming_path.join("Python/Python313/Scripts"));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let local_path = PathBuf::from(&local);
        dirs.push(local_path.join("agy/bin"));
        dirs.push(local_path.join("pnpm"));
        dirs.push(local_path.join("Yarn/bin"));
        dirs.push(local_path.join("Microsoft/WinGet/Links"));
        dirs.push(local_path.join("Programs/Python/Python310/Scripts"));
        dirs.push(local_path.join("Programs/Python/Python311/Scripts"));
        dirs.push(local_path.join("Programs/Python/Python312/Scripts"));
        dirs.push(local_path.join("Programs/Python/Python313/Scripts"));
        dirs.push(local_path.join("pipx/venvs"));
        dirs.push(local_path.join("Jackalope/agent-tools/node_modules/opencode-ai/bin"));
        if agent == "codex" {
            if let Ok(entries) = std::fs::read_dir(local_path.join("OpenAI/Codex/bin")) {
                let mut versions: Vec<_> = entries.flatten().map(|e| e.path()).collect();
                versions.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
                versions.reverse();
                dirs.extend(versions);
            }
        }
    }
    if !cfg!(windows) {
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
    }
    for dir in &dirs {
        for candidate in &candidates {
            let target = dir.join(candidate);
            if target.is_file() {
                return Ok(target);
            }
        }
    }
    Err(format!(
        "Install {agent} and make its executable available on PATH, then refresh."
    ))
}

fn antigravity_desktop_installed() -> bool {
    if cfg!(windows) {
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
        let programs = std::env::var_os("ProgramFiles").map(PathBuf::from);
        antigravity_desktop_at(local.as_deref(), programs.as_deref())
    } else {
        false
    }
}

fn antigravity_desktop_at(
    local: Option<&std::path::Path>,
    programs: Option<&std::path::Path>,
) -> bool {
    local
        .map(|root| root.join("Programs/Antigravity/Antigravity.exe").is_file())
        .unwrap_or(false)
        || programs
            .map(|root| root.join("Antigravity/Antigravity.exe").is_file())
            .unwrap_or(false)
}

#[cfg(test)]
mod desktop_detection_tests {
    use super::*;

    #[test]
    fn antigravity_desktop_detection_requires_an_app_executable() {
        let root = std::env::temp_dir()
            .join(format!("jackalope-antigravity-detection-{}", uuid::Uuid::new_v4()));
        let local = root.join("local");
        let programs = root.join("programs");
        let gui = local.join("Programs/Antigravity/Antigravity.exe");
        std::fs::create_dir_all(gui.parent().unwrap()).unwrap();
        assert!(!antigravity_desktop_at(Some(&local), Some(&programs)));
        std::fs::write(&gui, b"fixture").unwrap();
        assert!(antigravity_desktop_at(Some(&local), None));
        assert!(!antigravity_desktop_at(None, None));
        let system_gui = programs.join("Antigravity/Antigravity.exe");
        std::fs::create_dir_all(system_gui.parent().unwrap()).unwrap();
        std::fs::write(&system_gui, b"fixture").unwrap();
        assert!(antigravity_desktop_at(None, Some(&programs)));
        let _ = std::fs::remove_dir_all(&root);
    }
}
