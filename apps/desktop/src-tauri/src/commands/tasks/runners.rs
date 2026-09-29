use super::*;

pub(in crate::commands) const BUILTIN_AGENTS: &[&str] = &[
    "codex",
    "claude",
    "grok",
    "opencode",
    "kimi",
    "antigravity",
    "gemini",
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
            "kimi" => "Kimi Code",
            "antigravity" => "Antigravity",
            "gemini" => "Gemini CLI",
            _ => id,
        }
        .into(),
        available: false,
        signed_in: false,
        account: "Current CLI account".into(),
        detail: String::new(),
    };
    if let Some(custom) = policy.custom_agents.iter().find(|agent| agent.id == id) {
        runner.name = custom.name.clone();
    }
    let mut discovery = policy.clone();
    discovery.enabled_agents.clear();
    match discovery.resolve(id) {
        Err(error) => {
            runner.detail = if runner.desktop_installed {
                "Install the agy command-line tool to use Antigravity, then check agents again."
                    .into()
            } else {
                error
            };
        }
        Ok((adapter, path)) => {
            runner.available = true;
            let binding = match crate::commands::agent_profiles::bind_account(
                profiles_root,
                &adapter,
                None,
            ) {
                Ok(binding) => binding,
                Err(error) => {
                    runner.detail = error;
                    return runner;
                }
            };
            runner.account = binding.label.clone();
            if adapter == "acp" {
                runner.detail = "Ready. Sign in with this CLI in a terminal first. Jackalope starts it over ACP.".into();
                return runner;
            }
            if adapter == "antigravity" {
                runner.detail =
                    "Ready. Uses your agy sign-in or a Gemini API key added in Agents.".into();
                return runner;
            }
            if adapter == "kimi" {
                runner.detail =
                    "Ready. Run kimi login once to sign in; access is checked when a task starts."
                        .into();
                return runner;
            }
            if adapter == "grok" {
                runner.detail = "Ready. Access is checked when a task starts.".into();
                return runner;
            }
            if adapter == "opencode" {
                runner.detail = "Ready. Works with local and free models; provider access is checked when a task starts.".into();
                return runner;
            }
            if adapter == "gemini" {
                runner.detail = "Ready. Add and sign in to accounts in Agents; access is checked when a task starts.".into();
                return runner;
            }
            let args = if adapter == "codex" {
                vec!["login", "status"]
            } else {
                vec!["auth", "status"]
            };
            match probe_auth(path, args, Some(&binding)) {
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
                        "Signed in and ready.".into()
                    } else if binding.profile_id.is_some() {
                        // A managed account keeps its own credentials, separate from the
                        // login the CLI uses in a terminal.
                        format!("Sign in to the selected account \"{}\", or switch to your current CLI account.", binding.label)
                    } else {
                        "Sign in using the agent's CLI, then refresh.".into()
                    };
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
    if agent == "opencode" {
        if let Some(path) = crate::commands::managed_runtime::executable()? {
            return Ok(path);
        }
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
            if dir.is_absolute() && crate::commands::platform::is_executable(&target) {
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
        let root = std::env::temp_dir().join(format!(
            "jackalope-antigravity-detection-{}",
            uuid::Uuid::new_v4()
        ));
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
