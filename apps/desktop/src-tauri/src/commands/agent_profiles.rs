use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};
use tauri::State;

use super::tasks::TaskRuntime;

mod credentials;
pub use credentials::agent_profile_save_key;

pub(super) fn has_api_key(binding: &AccountBinding) -> Result<bool, String> {
    credentials::read(binding).map(|key| key.is_some())
}

static PROFILE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AgentProfile {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct AgentEntry {
    #[serde(default)]
    profiles: Vec<AgentProfile>,
    #[serde(default)]
    active: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    default_group: Option<String>,
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
    pub default_group: Option<String>,
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
        "gemini" => Some("GEMINI_CLI_HOME"),
        "aider" | "antigravity" => Some(if cfg!(windows) { "USERPROFILE" } else { "HOME" }),
        "goose" => Some("GOOSE_PATH_ROOT"),
        _ => None,
    }
}

pub(super) fn login_args(adapter: &str) -> &'static [&'static str] {
    match adapter {
        "codex" => &["login"],
        "grok" => &["login"],
        "opencode" => &["auth", "login"],
        "claude" => &["auth", "login"],
        "goose" => &["configure"],
        _ => &[],
    }
}

fn manifest_path(root: &Path) -> PathBuf {
    root.join("manifest.json")
}

#[cfg(test)]
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

#[cfg(test)]
fn active_profile_dir(root: &Path, agent: &str) -> Option<PathBuf> {
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

pub(in crate::commands) fn routing_accounts(
    root: &Path,
    adapter: &str,
    explicit: Option<&str>,
) -> Result<Vec<AccountBinding>, String> {
    let _guard = PROFILE_LOCK.lock().map_err(|e| e.to_string())?;
    if explicit.is_some() {
        return Ok(vec![bind_account(root, adapter, explicit)?]);
    }
    let manifest = load_checked(root)?;
    let mut bindings = vec![bind_account(root, adapter, None)?];
    if let Some(entry) = manifest.agents.get(adapter) {
        for profile in &entry.profiles {
            if !bindings
                .iter()
                .any(|binding| binding.profile_id.as_ref() == Some(&profile.id))
            {
                bindings.push(bind_account(root, adapter, Some(&profile.id))?);
            }
        }
    }
    Ok(bindings)
}

pub fn bind_account(
    root: &Path,
    adapter: &str,
    explicit: Option<&str>,
) -> Result<AccountBinding, String> {
    let saved = load_checked(root)?;
    let selected = explicit.or_else(|| {
        saved
            .agents
            .get(adapter)
            .and_then(|entry| entry.active.as_deref())
    });
    if adapter == "antigravity" && selected.is_none() {
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
    let manifest = saved;
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
                    if adapter == "gemini" {
                        return PathBuf::from(home);
                    }
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

pub fn apply_binding(
    command: &mut std::process::Command,
    binding: &AccountBinding,
) -> Result<(), String> {
    if binding.profile_id.is_some() {
        if binding.adapter == "antigravity" {
            let config: serde_json::Value = serde_json::from_slice(&super::history::read_bounded(
                &binding
                    .directory
                    .join(".gemini/antigravity-cli/settings.json"),
                65536,
            )?)
            .map_err(|_| "This Antigravity account has invalid settings.")?;
            if config["modelProvider"] != "gemini" {
                return Err("Managed Antigravity accounts require Gemini API-key mode to keep logins separate.".into());
            }
        }
        for name in credential_env_vars(&binding.adapter) {
            command.env_remove(name);
        }
    }
    if let Some(name) = env_var_for(&binding.adapter).filter(|_| {
        binding.profile_id.is_some()
            || !matches!(binding.adapter.as_str(), "antigravity" | "aider" | "goose")
    }) {
        command.env(name, &binding.directory);
    }
    if binding.profile_id.is_some() {
        if let Ok(content) = fs::read_to_string(binding.directory.join(".env")) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                if let Some((k, v)) = trimmed.split_once('=') {
                    let k = k.trim();
                    let v = v.trim();
                    if !k.is_empty() && !v.is_empty() {
                        command.env(k, v);
                    }
                }
            }
        }
    }
    // Apply owned storage paths after legacy profile settings so they cannot rebind an account.
    if let Some(name) = env_var_for(&binding.adapter).filter(|_| binding.profile_id.is_some()) {
        command.env(name, &binding.directory);
    }
    if binding.profile_id.is_some() {
        match binding.adapter.as_str() {
            "antigravity" | "aider" => {
                command
                    .env("HOME", &binding.directory)
                    .env("USERPROFILE", &binding.directory);
                if binding.adapter == "antigravity" {
                    for name in credential_env_vars("antigravity") {
                        command.env_remove(name);
                    }
                }
                if binding.adapter == "aider" {
                    command.env("AIDER_ENV_FILE", binding.directory.join(".env"));
                    command.env("AIDER_CONFIG", binding.directory.join(".aider.conf.yml"));
                }
            }
            "goose" => {
                command.env("GOOSE_DISABLE_KEYRING", "1");
                command.env_remove("GOOSE_ADDITIONAL_CONFIG_FILES");
            }
            "gemini" => {
                command.env("GEMINI_FORCE_FILE_STORAGE", "true");
            }
            _ => {}
        }
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
    if binding.profile_id.is_some() {
        if let Some(key) = credentials::read(binding)? {
            command.env(&key.name, &key.value);
        } else if binding.adapter == "antigravity" {
            return Err("Add a Gemini API key to this Antigravity account before using it.".into());
        }
    }
    Ok(())
}

pub fn validate_binding(root: &Path, binding: &AccountBinding) -> Result<(), String> {
    super::agent_sign_in::ensure_idle(binding)?;
    if binding.adapter == "antigravity" && binding.profile_id.is_none() {
        let current = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .map(|home| PathBuf::from(home).join(".gemini"));
        if current.as_ref() != Some(&binding.directory) {
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
    let manifest = load_checked(&runtime.profiles_root())?;
    let entry = manifest.agents.get(&agent).cloned().unwrap_or_default();
    Ok(AgentProfilesView {
        profiles: entry.profiles,
        active_id: entry.active,
        default_group: entry.default_group,
        env_var: env_var_for(&agent).map(str::to_string),
    })
}

#[tauri::command]
pub fn agent_profile_create(
    runtime: State<'_, TaskRuntime>,
    agent: String,
    name: String,
    group: Option<String>,
) -> Result<AgentProfile, String> {
    validate_group(group.as_deref())?;
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
        group,
        tag: None,
    };
    entry.profiles.push(profile.clone());
    let directory = dir_for(&root, &agent, &id);
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    if agent == "antigravity" {
        let config = directory.join(".gemini/antigravity-cli");
        fs::create_dir_all(&config).map_err(|e| e.to_string())?;
        fs::write(
            config.join("settings.json"),
            br#"{"modelProvider":"gemini"}"#,
        )
        .map_err(|e| e.to_string())?;
    } else if agent == "aider" {
        fs::write(directory.join(".aider.conf.yml"), "{}\n").map_err(|e| e.to_string())?;
        fs::write(directory.join(".env"), "").map_err(|e| e.to_string())?;
    }
    save(&root, &manifest)?;
    Ok(profile)
}

fn validate_group(group: Option<&str>) -> Result<(), String> {
    if group.is_some_and(|g| !["work", "personal"].contains(&g)) {
        return Err("Choose Work, Personal or Ungrouped.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn agent_profile_set_group(
    runtime: State<'_, TaskRuntime>,
    agent: String,
    id: Option<String>,
    group: Option<String>,
) -> Result<(), String> {
    validate_group(group.as_deref())?;
    let _profiles = PROFILE_LOCK.lock().map_err(|e| e.to_string())?;
    let root = runtime.profiles_root();
    let mut manifest = load_checked(&root)?;
    let Some(id) = id else {
        env_var_for(&agent).ok_or("Unknown agent")?;
        manifest.agents.entry(agent).or_default().default_group = group;
        return save(&root, &manifest);
    };
    let entry = manifest.agents.get_mut(&agent).ok_or("Unknown account")?;
    let profile = entry
        .profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("Unknown account")?;
    profile.group = group;
    save(&root, &manifest)
}

#[tauri::command]
pub fn agent_profile_set_tag(
    runtime: State<'_, TaskRuntime>,
    agent: String,
    id: String,
    tag: Option<String>,
) -> Result<(), String> {
    let _profiles = PROFILE_LOCK.lock().map_err(|e| e.to_string())?;
    let root = runtime.profiles_root();
    let mut manifest = load_checked(&root)?;
    let entry = manifest.agents.get_mut(&agent).ok_or("Unknown account")?;
    let profile = entry
        .profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("Unknown account")?;
    profile.tag = tag.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    save(&root, &manifest)
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
    super::agent_sign_in::ensure_idle(&bind_account(&root, &agent, Some(&id))?)?;
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
    super::agent_sign_in::ensure_idle(&bind_account(&root, &agent, Some(&id))?)?;
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

pub fn credential_env_vars(adapter: &str) -> &'static [&'static str] {
    match adapter {
        "codex" => &["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"],
        "claude" => &[
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_TOKEN",
        ],
        "grok" => &["XAI_API_KEY", "GROK_API_KEY", "GROK_DEPLOYMENT_KEY"],
        "gemini" | "antigravity" => &[
            "GEMINI_API_KEY",
            "GOOGLE_API_KEY",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "GOOGLE_GENAI_USE_VERTEXAI",
            "GOOGLE_GENAI_USE_GCA",
            "AGY_ADC_AUTH",
        ],
        "opencode" | "aider" | "goose" => &[
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "GEMINI_API_KEY",
            "GOOGLE_API_KEY",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "XAI_API_KEY",
            "GROK_API_KEY",
            "OPENROUTER_API_KEY",
            "DEEPSEEK_API_KEY",
            "GROQ_API_KEY",
            "MISTRAL_API_KEY",
            "AZURE_API_KEY",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_SESSION_TOKEN",
            "AWS_PROFILE",
        ],
        _ => &[],
    }
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
    fn legacy_profiles_keep_their_identity_when_grouping_is_added() {
        let manifest: Manifest =
            serde_json::from_str(r#"{"agents":{"grok":{"profiles":[],"active":null}}}"#).unwrap();
        assert_eq!(manifest.agents["grok"].default_group, None);
        assert_eq!(manifest.agents["grok"].active, None);
        let profile: AgentProfile =
            serde_json::from_str(r#"{"id":"old-id","name":"Work"}"#).unwrap();
        assert_eq!(profile.group, None);
        let grouped = AgentProfile {
            group: Some("work".into()),
            ..profile
        };
        assert_eq!(grouped.id, "old-id");
        assert_eq!(serde_json::to_value(&grouped).unwrap()["group"], "work");
        assert!(validate_group(Some("personal")).is_ok());
        assert!(validate_group(Some("invalid")).is_err());
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
        apply_binding(&mut command, &binding).unwrap();
        let vars: HashMap<_, _> = command
            .get_envs()
            .filter_map(|(key, value)| {
                value.map(|value| (key.to_string_lossy().to_string(), value.to_os_string()))
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
        apply_binding(&mut default, &binding).unwrap();
        assert_eq!(default.get_envs().count(), 1);
    }

    #[test]
    fn managed_provider_storage_cannot_be_redirected_by_legacy_settings() {
        let directory = temp_root();
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join(".env"), "GEMINI_CLI_HOME=elsewhere\nGEMINI_FORCE_FILE_STORAGE=false\nGOOSE_PATH_ROOT=elsewhere\nGOOSE_DISABLE_KEYRING=0\nHOME=elsewhere\nAIDER_CONFIG=elsewhere\n").unwrap();
        for (adapter, variable) in [
            ("gemini", "GEMINI_CLI_HOME"),
            ("goose", "GOOSE_PATH_ROOT"),
            ("aider", "HOME"),
        ] {
            let binding = AccountBinding {
                adapter: adapter.into(),
                profile_id: Some("work".into()),
                directory: directory.clone(),
                label: "Work".into(),
            };
            let mut command = std::process::Command::new(adapter);
            apply_binding(&mut command, &binding).unwrap();
            let vars: HashMap<_, _> = command
                .get_envs()
                .map(|(key, value)| {
                    (
                        key.to_string_lossy().to_string(),
                        value.map(|v| v.to_string_lossy().to_string()),
                    )
                })
                .collect();
            assert_eq!(vars[variable].as_deref(), directory.to_str());
            match adapter {
                "gemini" => assert_eq!(vars["GEMINI_FORCE_FILE_STORAGE"].as_deref(), Some("true")),
                "goose" => assert_eq!(vars["GOOSE_DISABLE_KEYRING"].as_deref(), Some("1")),
                "aider" => assert_eq!(
                    vars["AIDER_CONFIG"].as_deref(),
                    directory.join(".aider.conf.yml").to_str()
                ),
                _ => unreachable!(),
            }
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn antigravity_managed_accounts_require_api_mode_and_never_fall_back_to_cli_login() {
        let directory = temp_root();
        fs::create_dir_all(directory.join(".gemini/antigravity-cli")).unwrap();
        let binding = AccountBinding {
            adapter: "antigravity".into(),
            profile_id: Some("work".into()),
            directory: directory.clone(),
            label: "Work".into(),
        };
        let settings = directory.join(".gemini/antigravity-cli/settings.json");
        fs::write(&settings, r#"{"modelProvider":"antigravity"}"#).unwrap();
        assert!(
            apply_binding(&mut std::process::Command::new("agy"), &binding)
                .unwrap_err()
                .contains("API-key mode")
        );
        fs::write(&settings, r#"{"modelProvider":"gemini"}"#).unwrap();
        assert!(
            apply_binding(&mut std::process::Command::new("agy"), &binding)
                .unwrap_err()
                .contains("Add a Gemini API key")
        );
        let mut default = std::process::Command::new("agy");
        apply_binding(
            &mut default,
            &AccountBinding {
                profile_id: None,
                ..binding
            },
        )
        .unwrap();
        assert_eq!(default.get_envs().count(), 0);
        fs::remove_dir_all(directory).unwrap();
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
            group: None,
            tag: None,
        });
        entry.profiles.push(AgentProfile {
            id: "personal".into(),
            name: "Personal".into(),
            group: None,
            tag: None,
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
                        group: None,
                        tag: None,
                    },
                    AgentProfile {
                        id: "personal".into(),
                        name: "Personal".into(),
                        group: None,
                        tag: None,
                    },
                ],
                active: Some("work".into()),
                default_group: None,
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
    fn deleting_the_active_profile_falls_back() {
        let root = temp_root();
        let mut manifest = Manifest::default();
        let entry = manifest.agents.entry("codex".into()).or_default();
        entry.profiles.push(AgentProfile {
            id: "a".into(),
            name: "Work".into(),
            group: None,
            tag: None,
        });
        entry.profiles.push(AgentProfile {
            id: "b".into(),
            name: "Personal".into(),
            group: None,
            tag: None,
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
