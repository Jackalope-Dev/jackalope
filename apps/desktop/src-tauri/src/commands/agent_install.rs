//! Installs a supported agent CLI after the person clicks Install.
//!
//! Only agents with an npm package in the catalog can be installed here, and
//! the command is fixed by agent ID, never taken from the renderer. It runs in
//! an owned terminal served by the sign-in poll, input and stop commands, so the
//! person sees npm's output and can cancel it. OpenCode can instead use the
//! private runner (`managed_runtime_prepare`), which needs no Node.js.

use super::agent_sign_in::{self, SignInService};
use portable_pty::CommandBuilder;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

/// Agent ID → npm package. Keep in step with `installCommand` in
/// src/lib/agent-catalog.ts; a test checks that they match.
const PACKAGES: [(&str, &str); 6] = [
    ("codex", "@openai/codex"),
    ("claude", "@anthropic-ai/claude-code"),
    ("grok", "@xai/grok-cli"),
    ("kimi", "@moonshot-ai/kimi-code"),
    ("opencode", "opencode-ai"),
    ("gemini", "@google/gemini-cli"),
];

const NODE_MISSING: &str = "Installing this agent needs Node.js with npm. Install the Node.js LTS release from nodejs.org, restart Jackalope, then try again.";

fn package(agent: &str) -> Option<&'static str> {
    PACKAGES
        .iter()
        .find(|(id, _)| *id == agent)
        .map(|(_, package)| *package)
}

fn install_args(package: &str) -> [&str; 3] {
    ["install", "-g", package]
}

/// The command shown to the person, exactly as it runs apart from npm's path.
fn display_command(agent: &str) -> Option<String> {
    package(agent).map(|package| format!("npm {}", install_args(package).join(" ")))
}

fn npm_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["npm.cmd", "npm.exe", "npm"]
    } else {
        &["npm"]
    }
}

/// Where npm usually lives when the app was started without it on PATH.
fn npm_directories() -> Vec<PathBuf> {
    let mut directories: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    if cfg!(windows) {
        for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(root) = std::env::var_os(variable) {
                directories.push(PathBuf::from(root).join("nodejs"));
            }
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            directories.push(PathBuf::from(local).join("Programs/nodejs"));
        }
    } else {
        directories.push(PathBuf::from("/usr/local/bin"));
        directories.push(PathBuf::from("/opt/homebrew/bin"));
        directories.push(PathBuf::from("/usr/bin"));
    }
    directories
}

fn find_npm_in(directories: &[PathBuf]) -> Option<PathBuf> {
    directories
        .iter()
        .filter(|directory| directory.is_absolute())
        .flat_map(|directory| npm_names().iter().map(move |name| directory.join(name)))
        .find(|candidate| super::platform::is_executable(candidate))
}

fn find_npm() -> Option<PathBuf> {
    find_npm_in(&npm_directories())
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPlan {
    /// The npm command, or `None` when this agent installs another way.
    command: Option<String>,
    /// Whether npm was found.
    npm: bool,
    /// OpenCode's private runner can be prepared instead, without Node.js.
    managed: bool,
}

fn plan(agent: &str, npm: bool, managed_supported: bool) -> InstallPlan {
    InstallPlan {
        command: display_command(agent),
        npm,
        managed: agent == "opencode" && managed_supported,
    }
}

fn install_command(agent: &str, npm: &Path) -> Result<CommandBuilder, String> {
    let package = package(agent)
        .ok_or("Jackalope cannot install this agent. Follow its install guide instead.")?;
    let mut command = CommandBuilder::new(npm);
    command.args(install_args(package));
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        command.cwd(home);
    }
    command.env("TERM", "xterm-256color");
    command.env("NPM_CONFIG_FUND", "false");
    command.env("NPM_CONFIG_UPDATE_NOTIFIER", "false");
    Ok(command)
}

/// How an agent can be installed from the app.
#[tauri::command]
pub fn agent_install_plan(agent: String) -> InstallPlan {
    plan(
        &agent,
        find_npm().is_some(),
        super::managed_runtime::supported(),
    )
}

/// Starts the agent's npm install in an owned terminal and returns its session,
/// which the `agent_profile_sign_in_*` commands poll and stop.
#[tauri::command]
pub async fn agent_install(
    app: tauri::AppHandle,
    agent: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let runtime: State<'_, super::tasks::TaskRuntime> = app.state();
        runtime.access.ensure()?;
        let service: State<'_, SignInService> = app.state();
        let npm = find_npm().ok_or(NODE_MISSING)?;
        let command = install_command(&agent, &npm)?;
        agent_sign_in::start_terminal(
            &service,
            command,
            cols.unwrap_or(80),
            rows.unwrap_or(16),
            "Could not start npm. Check your Node.js installation and try again.",
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_commands_match_the_catalog() {
        let catalog = include_str!("../../../src/lib/agent-catalog.ts");
        for (agent, _) in PACKAGES {
            let command = display_command(agent).unwrap();
            assert!(
                catalog.contains(&format!("installCommand: '{command}'")),
                "{agent}: {command} is not the catalog's install command"
            );
        }
        assert_eq!(
            display_command("claude").as_deref(),
            Some("npm install -g @anthropic-ai/claude-code")
        );
    }

    #[test]
    fn only_catalog_packages_can_be_installed() {
        assert_eq!(display_command("antigravity"), None);
        assert_eq!(display_command("acp"), None);
        assert_eq!(display_command("codex; rm -rf /"), None);
        assert!(install_command("acp", Path::new("npm")).is_err());
        let command = install_command("gemini", Path::new("npm")).unwrap();
        let argv: Vec<String> = command
            .get_argv()
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(argv, ["npm", "install", "-g", "@google/gemini-cli"]);
    }

    #[test]
    fn opencode_prefers_the_private_runner_where_supported() {
        assert!(plan("opencode", false, true).managed);
        assert!(!plan("opencode", true, false).managed);
        assert!(!plan("codex", true, true).managed);
        assert_eq!(
            plan("codex", false, true),
            InstallPlan {
                command: Some("npm install -g @openai/codex".into()),
                npm: false,
                managed: false,
            }
        );
    }

    #[test]
    fn npm_is_found_only_in_absolute_directories() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-npm-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        assert_eq!(find_npm_in(std::slice::from_ref(&directory)), None);
        let name = npm_names()[0];
        let npm = directory.join(name);
        std::fs::write(&npm, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&npm, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert_eq!(find_npm_in(std::slice::from_ref(&directory)), Some(npm));
        assert_eq!(find_npm_in(&[PathBuf::from("relative")]), None);
        let _ = std::fs::remove_dir_all(&directory);
    }
}
