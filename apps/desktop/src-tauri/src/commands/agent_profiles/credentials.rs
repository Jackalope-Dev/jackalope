use super::{AccountBinding, TaskRuntime};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

#[derive(Serialize, Deserialize)]
pub(super) struct ApiKey {
    pub name: String,
    pub value: String,
}

fn allowed(agent: &str, name: &str) -> bool {
    match agent {
        "antigravity" => name == "GEMINI_API_KEY",
        "opencode" => provider(name).is_some() || name == "JACKALOPE_ENDPOINT_KEY",
        _ => false,
    }
}

/// A key imported from this device's environment for the agent it belongs to.
fn imported(agent: &str, name: &str) -> bool {
    crate::commands::local_detection::key_provider_info(name)
        .is_some_and(|(_, target)| target == agent)
}

fn valid_value(value: &str) -> bool {
    !value.is_empty() && value.len() <= 8192 && !value.chars().any(char::is_control)
}

pub(super) fn provider(name: &str) -> Option<&'static str> {
    match name {
        "OPENAI_API_KEY" => Some("openai"),
        "ANTHROPIC_API_KEY" => Some("anthropic"),
        "GEMINI_API_KEY" => Some("google"),
        "OPENROUTER_API_KEY" => Some("openrouter"),
        "DEEPSEEK_API_KEY" => Some("deepseek"),
        "XAI_API_KEY" => Some("xai"),
        "GROQ_API_KEY" => Some("groq"),
        "MISTRAL_API_KEY" => Some("mistral"),
        _ => None,
    }
}

pub(super) fn read(binding: &AccountBinding) -> Result<Option<ApiKey>, String> {
    let path = binding.directory.join("api-key.bin");
    // Older versions saved the key as plaintext JSON.
    let bytes = crate::commands::account_storage::read_or_migrate(&path, |bytes| {
        bytes.len() <= 16384 && serde_json::from_slice::<ApiKey>(bytes).is_ok()
    })?;
    let Some(bytes) = bytes else { return Ok(None) };
    let key: ApiKey = serde_json::from_slice(&bytes).map_err(|_| {
        "This account's saved API key is unreadable. Reconnect it before running tasks."
    })?;
    if !(allowed(&binding.adapter, &key.name) || imported(&binding.adapter, &key.name))
        || !valid_value(&key.value)
    {
        return Err(
            "This account's saved API key is invalid. Reconnect it before running tasks.".into(),
        );
    }
    Ok(Some(key))
}

pub(super) fn write_endpoint_key(directory: &Path, value: Option<&str>) -> Result<(), String> {
    let path = directory.join("api-key.bin");
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        None => crate::commands::account_storage::remove(&path),
        Some(value) => crate::commands::account_storage::write_json(
            &path,
            &ApiKey {
                name: "JACKALOPE_ENDPOINT_KEY".into(),
                value: value.to_string(),
            },
        ),
    }
}

#[tauri::command]
pub async fn agent_profile_save_key(
    app: tauri::AppHandle,
    agent: String,
    id: String,
    name: String,
    value: String,
) -> Result<(), String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || save_key(app.state(), agent, id, name, value))
        .await
        .map_err(|e| e.to_string())?
}

/// Waits for the shared execution lock, so commands run it off the main thread.
pub(in crate::commands) fn save_key(
    runtime: State<'_, TaskRuntime>,
    agent: String,
    id: String,
    name: String,
    value: String,
) -> Result<(), String> {
    if !allowed(&agent, &name) {
        return Err("Choose a supported provider and enter a valid API key.".into());
    }
    store_key(runtime, agent, id, name, value)
}

/// Saves a key found in this device's environment to the account created for
/// the agent it belongs to.
pub(in crate::commands) fn save_imported_key(
    runtime: State<'_, TaskRuntime>,
    agent: String,
    id: String,
    name: String,
    value: String,
) -> Result<(), String> {
    if !allowed(&agent, &name) && !imported(&agent, &name) {
        return Err("Choose a supported provider and enter a valid API key.".into());
    }
    store_key(runtime, agent, id, name, value)
}

fn store_key(
    runtime: State<'_, TaskRuntime>,
    agent: String,
    id: String,
    name: String,
    value: String,
) -> Result<(), String> {
    runtime.access.ensure()?;
    if !valid_value(value.trim()) {
        return Err("Choose a supported provider and enter a valid API key.".into());
    }
    let _guard = crate::commands::integration::execution_guard()?;
    let _profiles = super::PROFILE_LOCK
        .lock()
        .map_err(|_| "Account settings are unavailable.")?;
    let binding = super::bind_account(&runtime.profiles_root(), &agent, Some(&id))?;
    crate::commands::agent_sign_in::ensure_idle(&binding)?;
    if runtime.integration_runs()?.iter().any(|run| {
        run.status.is_active()
            && run
                .account_binding
                .as_ref()
                .is_some_and(|account| account.directory == binding.directory)
    }) {
        return Err("Stop tasks using this account before changing its API key.".into());
    }
    crate::commands::account_storage::write_json(
        &binding.directory.join("api-key.bin"),
        &ApiKey {
            name,
            value: value.trim().to_owned(),
        },
    )?;
    runtime.invalidate_account_helpers(&binding.directory);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opencode_accepts_supported_provider_keys_without_accepting_runtime_overrides() {
        assert!(allowed("opencode", "DEEPSEEK_API_KEY"));
        assert!(allowed("opencode", "OPENAI_API_KEY"));
        assert!(!allowed("opencode", "OPENCODE_CONFIG_CONTENT"));
        assert!(!allowed("claude", "DEEPSEEK_API_KEY"));
        assert!(!allowed("antigravity", "DEEPSEEK_API_KEY"));
    }

    #[cfg(windows)]
    #[test]
    fn protected_deepseek_key_reaches_only_the_bound_opencode_process() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-deepseek-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let binding = AccountBinding {
            adapter: "opencode".into(),
            profile_id: Some("fixture".into()),
            label: "Fixture".into(),
            directory: directory.clone(),
        };
        let path = directory.join("api-key.bin");
        let key = ApiKey {
            name: "DEEPSEEK_API_KEY".into(),
            value: "fixture-not-a-real-provider-key".into(),
        };
        crate::commands::account_storage::write(&path, &serde_json::to_vec(&key).unwrap()).unwrap();
        let saved = std::fs::read(&path).unwrap();
        assert!(!saved
            .windows(key.value.len())
            .any(|window| window == key.value.as_bytes()));
        let mut command = std::process::Command::new("not-executed");
        super::super::apply_binding(&mut command, &binding).unwrap();
        assert_eq!(
            command
                .get_envs()
                .find(|(name, _)| *name == "DEEPSEEK_API_KEY")
                .unwrap()
                .1
                .unwrap(),
            key.value.as_str()
        );
        assert_eq!(
            super::super::api_key_name(&binding).unwrap().as_deref(),
            Some("DEEPSEEK_API_KEY")
        );
        assert!(!directory.join(".env").exists());
        assert_eq!(
            super::super::api_provider(&binding).unwrap(),
            Some("deepseek")
        );
        assert_eq!(
            command
                .get_envs()
                .find(|(name, _)| *name == "GOOGLE_GENERATIVE_AI_API_KEY")
                .unwrap()
                .1,
            None
        );
        crate::commands::account_storage::remove(&path).unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }
}
