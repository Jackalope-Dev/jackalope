use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};
use tauri::State;

use super::tasks::TaskRuntime;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AgentProfile {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct AgentEntry {
    #[serde(default)]
    profiles: Vec<AgentProfile>,
    #[serde(default)]
    active: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct Manifest {
    #[serde(default)]
    agents: HashMap<String, AgentEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfilesView {
    pub profiles: Vec<AgentProfile>,
    pub active_id: Option<String>,
    /// The environment variable Jackalope sets to redirect this agent's sign-in
    /// to a profile directory, or None when this agent has no known override
    /// (accounts are unsupported for it — e.g. a manually added custom agent).
    pub env_var: Option<String>,
}

/// The environment variable each supported agent's CLI honors to redirect its
/// entire config/credential directory to an isolated location. Confirmed
/// empirically (2026-09-06) by pointing each installed CLI at an empty
/// directory: all three started a fresh signed-out state there instead of
/// touching the real signed-in profile, rather than assumed from docs.
pub fn env_var_for(adapter: &str) -> Option<&'static str> {
    match adapter {
        "codex" => Some("CODEX_HOME"),
        "claude" => Some("CLAUDE_CONFIG_DIR"),
        "grok" => Some("GROK_HOME"),
        _ => None,
    }
}

fn login_args(adapter: &str) -> &'static [&'static str] {
    match adapter {
        "codex" => &["login"],
        "grok" => &["login"],
        // Claude Code has no separate login subcommand; launching it plain
        // prompts sign-in interactively when its redirected profile is empty.
        _ => &[],
    }
}

fn manifest_path(root: &Path) -> PathBuf {
    root.join("manifest.json")
}

fn load(root: &Path) -> Manifest {
    fs::read_to_string(manifest_path(root))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save(root: &Path, manifest: &Manifest) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    fs::write(manifest_path(root), text).map_err(|e| e.to_string())
}

fn dir_for(root: &Path, agent: &str, id: &str) -> PathBuf {
    root.join(agent).join(id)
}

/// The active profile directory for `agent`, if the user configured one.
/// Callers pass this to the agent's `env_var_for` variable before spawning it.
/// None means unconfigured: fall back to the CLI's own default location,
/// which is today's (and every existing user's) unchanged behavior.
pub fn active_profile_dir(root: &Path, agent: &str) -> Option<PathBuf> {
    let manifest = load(root);
    let entry = manifest.agents.get(agent)?;
    let active = entry.active.as_ref()?;
    entry
        .profiles
        .iter()
        .any(|p| &p.id == active)
        .then(|| dir_for(root, agent, active))
}

/// The profile directory to run `agent` under for one task: `explicit_id`
/// (a project's chosen account for this agent) when it names a real profile,
/// otherwise the agent's globally active profile. Returns None when neither
/// applies, meaning the CLI's own default, unconfigured location should be
/// used — unchanged behavior for every project that hasn't picked an account.
pub fn resolve_profile_dir(root: &Path, agent: &str, explicit_id: Option<&str>) -> Option<PathBuf> {
    if let Some(id) = explicit_id {
        let manifest = load(root);
        if let Some(entry) = manifest.agents.get(agent) {
            if entry.profiles.iter().any(|p| p.id == id) {
                return Some(dir_for(root, agent, id));
            }
        }
        // A stale/removed id falls through to the active profile rather than
        // silently running under the CLI's default (mismatched-account risk).
    }
    active_profile_dir(root, agent)
}

#[tauri::command]
pub fn agent_profile_list(
    runtime: State<'_, TaskRuntime>,
    agent: String,
) -> Result<AgentProfilesView, String> {
    let manifest = load(&runtime.profiles_root());
    let entry = manifest.agents.get(&agent).cloned().unwrap_or_default();
    Ok(AgentProfilesView {
        profiles: entry.profiles,
        active_id: entry.active,
        env_var: env_var_for(&agent).map(str::to_string),
    })
}

#[tauri::command]
pub fn agent_profile_create(
    runtime: State<'_, TaskRuntime>,
    agent: String,
    name: String,
) -> Result<AgentProfile, String> {
    env_var_for(&agent).ok_or(
        "This agent has no known config-directory override; Jackalope cannot isolate its sign-in.",
    )?;
    let name = name.trim();
    if name.is_empty() {
        return Err("Give the account a name.".into());
    }
    let root = runtime.profiles_root();
    let mut manifest = load(&root);
    let entry = manifest.agents.entry(agent.clone()).or_default();
    let id = uuid::Uuid::new_v4().to_string();
    let profile = AgentProfile {
        id: id.clone(),
        name: name.to_string(),
    };
    entry.profiles.push(profile.clone());
    if entry.active.is_none() {
        entry.active = Some(id.clone());
    }
    fs::create_dir_all(dir_for(&root, &agent, &id)).map_err(|e| e.to_string())?;
    save(&root, &manifest)?;
    Ok(profile)
}

#[tauri::command]
pub fn agent_profile_rename(
    runtime: State<'_, TaskRuntime>,
    agent: String,
    id: String,
    name: String,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Give the account a name.".into());
    }
    let root = runtime.profiles_root();
    let mut manifest = load(&root);
    let entry = manifest.agents.get_mut(&agent).ok_or("Unknown account")?;
    let profile = entry
        .profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("Unknown account")?;
    profile.name = name.to_string();
    save(&root, &manifest)
}

#[tauri::command]
pub fn agent_profile_delete(
    runtime: State<'_, TaskRuntime>,
    agent: String,
    id: String,
) -> Result<(), String> {
    let root = runtime.profiles_root();
    let mut manifest = load(&root);
    let entry = manifest.agents.entry(agent.clone()).or_default();
    entry.profiles.retain(|p| p.id != id);
    if entry.active.as_deref() == Some(id.as_str()) {
        entry.active = entry.profiles.first().map(|p| p.id.clone());
    }
    save(&root, &manifest)?;
    // Best-effort: the account row is gone from the manifest either way, which
    // is what makes it disappear from the UI and stop being selectable.
    let _ = fs::remove_dir_all(dir_for(&root, &agent, &id));
    Ok(())
}

#[tauri::command]
pub fn agent_profile_set_active(
    runtime: State<'_, TaskRuntime>,
    agent: String,
    id: Option<String>,
) -> Result<(), String> {
    let root = runtime.profiles_root();
    let mut manifest = load(&root);
    let entry = manifest.agents.entry(agent).or_default();
    if let Some(id) = &id {
        if !entry.profiles.iter().any(|p| &p.id == id) {
            return Err("Unknown account".into());
        }
    }
    entry.active = id;
    save(&root, &manifest)
}

/// Opens a real, visible console window running the agent's own sign-in flow
/// (or, for Claude, the plain interactive session) with its config directory
/// redirected to this profile — so completing the CLI's normal browser/device
/// login there populates only this account, leaving every other profile and
/// the CLI's default location untouched. Jackalope does not read this
/// window's output; it is the same interactive login the user would run
/// themselves, just pointed at an isolated directory.
#[tauri::command]
pub fn agent_profile_sign_in(
    runtime: State<'_, TaskRuntime>,
    agent: String,
    id: String,
) -> Result<(), String> {
    let env_name = env_var_for(&agent).ok_or("This agent has no known config-directory override.")?;
    let root = runtime.profiles_root();
    let manifest = load(&root);
    let entry = manifest.agents.get(&agent).ok_or("Unknown account")?;
    if !entry.profiles.iter().any(|p| p.id == id) {
        return Err("Unknown account".into());
    }
    let dir = dir_for(&root, &agent, &id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let executable = super::tasks::executable(&agent)?;
    let mut command = std::process::Command::new(executable);
    command.args(login_args(&agent)).env(env_name, &dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NEW_CONSOLE: a real, visible window, unlike Jackalope's other
        // background probes which deliberately hide theirs.
        command.creation_flags(0x00000010);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open {agent} to sign in: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!("jackalope-agent-profiles-test-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn env_var_mapping_matches_verified_cli_overrides() {
        assert_eq!(env_var_for("codex"), Some("CODEX_HOME"));
        assert_eq!(env_var_for("claude"), Some("CLAUDE_CONFIG_DIR"));
        assert_eq!(env_var_for("grok"), Some("GROK_HOME"));
        assert_eq!(env_var_for("some-custom-agent"), None);
    }

    #[test]
    fn unconfigured_agent_has_no_active_profile() {
        let root = temp_root();
        assert!(active_profile_dir(&root, "codex").is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn explicit_profile_wins_but_a_stale_id_falls_back_to_active() {
        let root = temp_root();
        let mut manifest = Manifest::default();
        let entry = manifest.agents.entry("codex".into()).or_default();
        entry.profiles.push(AgentProfile {
            id: "work".into(),
            name: "Work".into(),
        });
        entry.profiles.push(AgentProfile {
            id: "personal".into(),
            name: "Personal".into(),
        });
        entry.active = Some("personal".into());
        save(&root, &manifest).unwrap();

        // A project asking for "work" gets it, even though "personal" is active.
        assert_eq!(
            resolve_profile_dir(&root, "codex", Some("work")),
            Some(dir_for(&root, "codex", "work"))
        );
        // No explicit choice falls back to whichever profile is active.
        assert_eq!(
            resolve_profile_dir(&root, "codex", None),
            Some(dir_for(&root, "codex", "personal"))
        );
        // A removed/unknown id doesn't silently drop to the CLI's own default;
        // it falls back to the active profile instead.
        assert_eq!(
            resolve_profile_dir(&root, "codex", Some("deleted-long-ago")),
            Some(dir_for(&root, "codex", "personal"))
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn creating_the_first_profile_activates_it_and_deleting_it_falls_back() {
        let root = temp_root();
        let mut manifest = Manifest::default();
        let entry = manifest.agents.entry("codex".into()).or_default();
        entry.profiles.push(AgentProfile {
            id: "a".into(),
            name: "Work".into(),
        });
        entry.profiles.push(AgentProfile {
            id: "b".into(),
            name: "Personal".into(),
        });
        entry.active = Some("a".into());
        save(&root, &manifest).unwrap();
        assert_eq!(
            active_profile_dir(&root, "codex"),
            Some(dir_for(&root, "codex", "a"))
        );

        let mut manifest = load(&root);
        let entry = manifest.agents.get_mut("codex").unwrap();
        entry.profiles.retain(|p| p.id != "a");
        entry.active = entry.profiles.first().map(|p| p.id.clone());
        save(&root, &manifest).unwrap();
        assert_eq!(
            active_profile_dir(&root, "codex"),
            Some(dir_for(&root, "codex", "b"))
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_active_id_no_longer_present_in_profiles_is_ignored() {
        let root = temp_root();
        let mut manifest = Manifest::default();
        let entry = manifest.agents.entry("claude".into()).or_default();
        entry.active = Some("ghost".into());
        save(&root, &manifest).unwrap();
        assert!(active_profile_dir(&root, "claude").is_none());
        let _ = fs::remove_dir_all(&root);
    }
}
