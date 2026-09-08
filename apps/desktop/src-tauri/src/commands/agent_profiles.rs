use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};
use tauri::State;

use super::tasks::TaskRuntime;

static PROFILE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

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

pub fn env_var_for(adapter: &str) -> Option<&'static str> {
    match adapter {
        "codex" => Some("CODEX_HOME"),
        "claude" => Some("CLAUDE_CONFIG_DIR"),
        "grok" => Some("GROK_HOME"),
        "opencode" => Some("XDG_DATA_HOME"),
        _ => None,
    }
}

fn login_args(adapter: &str) -> &'static [&'static str] {
    match adapter {
        "codex" => &["login"],
        "grok" => &["login"],
        "opencode" => &["auth", "login"],
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

fn load_checked(root: &Path) -> Result<Manifest, String> {
    if !manifest_path(root).exists() {
        return Ok(Manifest::default());
    }
    serde_json::from_slice(&fs::read(manifest_path(root)).map_err(|e| e.to_string())?).map_err(
        |_| {
            "Account settings are unreadable. Restore the manifest before changing accounts.".into()
        },
    )
}

fn save(root: &Path, manifest: &Manifest) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    use std::io::Write;
    let temporary = root.join("manifest.tmp");
    let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())?)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    fs::rename(temporary, manifest_path(root)).map_err(|e| e.to_string())
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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountBinding {
    pub adapter: String,
    pub profile_id: Option<String>,
    pub directory: PathBuf,
    pub label: String,
}

pub fn bind_account(
    root: &Path,
    adapter: &str,
    explicit: Option<&str>,
) -> Result<AccountBinding, String> {
    if adapter == "antigravity" {
        if explicit.is_some() {
            return Err("Antigravity uses its current CLI sign-in; separate Jackalope accounts are not supported.".into());
        }
        let directory = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .map(|home| PathBuf::from(home).join(".gemini"))
            .filter(|path| path.is_absolute())
            .ok_or("Cannot locate Antigravity's CLI data directory.")?;
        return Ok(AccountBinding {
            adapter: adapter.into(),
            profile_id: None,
            directory,
            label: "Current Antigravity CLI account (identity not pinned)".into(),
        });
    }
    let env_name = env_var_for(adapter).ok_or("This agent does not support account isolation.")?;
    let manifest = if manifest_path(root).exists() {
        serde_json::from_slice::<Manifest>(
            &fs::read(manifest_path(root)).map_err(|e| e.to_string())?,
        )
        .map_err(|_| {
            "Account settings cannot be read. Restore them before running work.".to_string()
        })?
    } else {
        Manifest::default()
    };
    let entry = manifest.agents.get(adapter);
    let id = explicit.or_else(|| entry.and_then(|e| e.active.as_deref()));
    let (profile_id, directory, label) = if let Some(id) = id {
        if id.is_empty() || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') {
            return Err("Invalid account selection.".into());
        }
        let profile = entry
            .and_then(|e| e.profiles.iter().find(|p| p.id == id))
            .ok_or(
                "The selected account was removed. Choose another account before running work.",
            )?;
        (
            Some(id.to_string()),
            dir_for(root, adapter, id),
            profile.name.clone(),
        )
    } else {
        let directory = std::env::var_os(env_name)
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(|home| {
                    PathBuf::from(home).join(if adapter == "opencode" {
                        ".local/share".to_string()
                    } else {
                        format!(".{adapter}")
                    })
                })
            })
            .ok_or("Cannot locate the agent's default account directory.")?;
        (
            None,
            directory,
            "CLI default profile (identity not reported)".to_string(),
        )
    };
    if !directory.is_absolute() {
        return Err("The agent account directory must be an absolute path.".into());
    }
    Ok(AccountBinding {
        adapter: adapter.into(),
        profile_id,
        directory,
        label,
    })
}

pub fn apply_binding(command: &mut std::process::Command, binding: &AccountBinding) {
    if let Some(name) = env_var_for(&binding.adapter) {
        command.env(name, &binding.directory);
    }
    if binding.adapter == "opencode" && binding.profile_id.is_some() {
        for (name, folder) in [
            ("XDG_CONFIG_HOME", "config"),
            ("XDG_CACHE_HOME", "cache"),
            ("XDG_STATE_HOME", "state"),
        ] {
            command.env(name, binding.directory.join(folder));
        }
    }
}

pub fn validate_binding(root: &Path, binding: &AccountBinding) -> Result<(), String> {
    if binding.adapter == "antigravity" {
        let current = bind_account(root, &binding.adapter, binding.profile_id.as_deref())?;
        if current.directory != binding.directory {
            return Err("Antigravity's CLI data location changed. Start a new task.".into());
        }
    }
    if let Some(id) = &binding.profile_id {
        let resolved = bind_account(root, &binding.adapter, Some(id))?;
        if resolved.directory != binding.directory {
            return Err("The account location changed. Start a new task.".into());
        }
    }
    if !binding.directory.is_absolute() {
        return Err("Invalid saved account directory.".into());
    }
    Ok(())
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
    let _profiles = PROFILE_LOCK.lock().map_err(|e| e.to_string())?;
    let root = runtime.profiles_root();
    let mut manifest = load_checked(&root)?;
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
    let _profiles = PROFILE_LOCK.lock().map_err(|e| e.to_string())?;
    let root = runtime.profiles_root();
    let mut manifest = load_checked(&root)?;
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
    let _guard = super::integration::execution_guard()?;
    let _profiles = PROFILE_LOCK.lock().map_err(|e| e.to_string())?;
    env_var_for(&agent).ok_or("Unknown agent")?;
    if id.is_empty() || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') {
        return Err("Invalid account ID".into());
    }
    if runtime.integration_runs()?.iter().any(|run| {
        ["starting", "running", "stopping"].contains(&run.status.as_str())
            && run.account_binding.as_ref().is_some_and(|binding| {
                binding.adapter == agent && binding.profile_id.as_deref() == Some(&id)
            })
    }) {
        return Err("Stop tasks using this account before removing it.".into());
    }
    let root = runtime.profiles_root();
    let mut manifest = load_checked(&root)?;
    let entry = manifest.agents.get_mut(&agent).ok_or("Unknown account")?;
    if !entry.profiles.iter().any(|p| p.id == id) {
        return Err("Unknown account".into());
    }
    let directory = dir_for(&root, &agent, &id);
    if directory.exists() {
        let canonical = fs::canonicalize(&directory).map_err(|e| e.to_string())?;
        let owned_root = fs::canonicalize(&root).map_err(|e| e.to_string())?;
        if !canonical.starts_with(&owned_root)
            || fs::symlink_metadata(&directory)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
        {
            return Err("The account directory resolves outside its managed location.".into());
        }
        fs::remove_dir_all(&directory)
            .map_err(|e| format!("Account files could not be removed: {e}"))?;
    }
    entry.profiles.retain(|p| p.id != id);
    if entry.active.as_deref() == Some(id.as_str()) {
        entry.active = None;
    }
    save(&root, &manifest)
}

#[tauri::command]
pub fn agent_profile_set_active(
    runtime: State<'_, TaskRuntime>,
    agent: String,
    id: Option<String>,
) -> Result<(), String> {
    let _profiles = PROFILE_LOCK.lock().map_err(|e| e.to_string())?;
    let root = runtime.profiles_root();
    let mut manifest = load_checked(&root)?;
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
    let env_name =
        env_var_for(&agent).ok_or("This agent has no known config-directory override.")?;
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
    apply_binding(&mut command, &bind_account(&root, &agent, Some(&id))?);
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
fn resolve_profile_dir(root: &Path, agent: &str, explicit_id: Option<&str>) -> Option<PathBuf> {
    bind_account(root, agent, explicit_id)
        .ok()
        .filter(|b| b.profile_id.is_some())
        .map(|b| b.directory)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "jackalope-agent-profiles-test-{}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn env_var_mapping_matches_verified_cli_overrides() {
        assert_eq!(env_var_for("codex"), Some("CODEX_HOME"));
        assert_eq!(env_var_for("claude"), Some("CLAUDE_CONFIG_DIR"));
        assert_eq!(env_var_for("grok"), Some("GROK_HOME"));
        assert_eq!(env_var_for("opencode"), Some("XDG_DATA_HOME"));
        assert_eq!(env_var_for("some-custom-agent"), None);
    }

    #[test]
    fn opencode_named_profile_redirects_data_config_cache_and_state() {
        let directory = temp_root();
        let mut binding = AccountBinding {
            adapter: "opencode".into(),
            profile_id: Some("work".into()),
            directory: directory.clone(),
            label: "Work".into(),
        };
        let mut command = std::process::Command::new("opencode");
        apply_binding(&mut command, &binding);
        let vars: HashMap<_, _> = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().to_string(),
                    value.unwrap().to_os_string(),
                )
            })
            .collect();
        assert_eq!(vars["XDG_DATA_HOME"], directory.as_os_str());
        assert_eq!(
            vars["XDG_CONFIG_HOME"],
            directory.join("config").as_os_str()
        );
        assert_eq!(vars["XDG_CACHE_HOME"], directory.join("cache").as_os_str());
        assert_eq!(vars["XDG_STATE_HOME"], directory.join("state").as_os_str());
        binding.profile_id = None;
        let mut default = std::process::Command::new("opencode");
        apply_binding(&mut default, &binding);
        assert_eq!(default.get_envs().count(), 1);
    }

    #[test]
    fn unconfigured_agent_has_no_active_profile() {
        let root = temp_root();
        assert!(active_profile_dir(&root, "codex").is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn explicit_profile_wins_and_a_stale_id_is_rejected() {
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
        assert_eq!(
            resolve_profile_dir(&root, "codex", Some("deleted-long-ago")),
            None
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn saved_binding_survives_active_switch_and_rejects_deleted_or_corrupt_profiles() {
        let root = temp_root();
        let mut manifest = Manifest::default();
        manifest.agents.insert(
            "codex".into(),
            AgentEntry {
                profiles: vec![
                    AgentProfile {
                        id: "work".into(),
                        name: "Work".into(),
                    },
                    AgentProfile {
                        id: "personal".into(),
                        name: "Personal".into(),
                    },
                ],
                active: Some("work".into()),
            },
        );
        save(&root, &manifest).unwrap();
        let binding = bind_account(&root, "codex", None).unwrap();
        manifest.agents.get_mut("codex").unwrap().active = Some("personal".into());
        save(&root, &manifest).unwrap();
        validate_binding(&root, &binding).unwrap();
        assert_eq!(binding.profile_id.as_deref(), Some("work"));
        assert!(bind_account(&root, "codex", Some("../outside")).is_err());
        manifest
            .agents
            .get_mut("codex")
            .unwrap()
            .profiles
            .retain(|p| p.id != "work");
        save(&root, &manifest).unwrap();
        assert!(validate_binding(&root, &binding).is_err());
        fs::write(manifest_path(&root), "broken").unwrap();
        assert!(bind_account(&root, "codex", None).is_err());
        let _ = fs::remove_dir_all(root);
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
