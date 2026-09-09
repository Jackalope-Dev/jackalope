use super::{AccountBinding, TaskRuntime};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize)]
pub(super) struct ApiKey {
    pub name: String,
    pub value: String,
}

fn allowed(agent: &str, name: &str) -> bool {
    match agent {
        "antigravity" => name == "GEMINI_API_KEY",
        "aider" => [
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "GEMINI_API_KEY",
            "OPENROUTER_API_KEY",
            "DEEPSEEK_API_KEY",
            "XAI_API_KEY",
            "GROQ_API_KEY",
            "MISTRAL_API_KEY",
        ]
        .contains(&name),
        _ => false,
    }
}

pub(super) fn read(binding: &AccountBinding) -> Result<Option<ApiKey>, String> {
    let path = binding.directory.join("api-key.bin");
    #[cfg(windows)]
    let bytes = crate::commands::account_storage::read(&path)?;
    #[cfg(not(windows))]
    let bytes = if path.exists() {
        Some(crate::commands::history::read_bounded(&path, 16384)?)
    } else {
        None
    };
    let Some(bytes) = bytes else { return Ok(None) };
    let key: ApiKey = serde_json::from_slice(&bytes).map_err(|_| {
        "This account's saved API key is unreadable. Reconnect it before running tasks."
    })?;
    if !allowed(&binding.adapter, &key.name)
        || key.value.is_empty()
        || key.value.len() > 8192
        || key.value.chars().any(char::is_control)
    {
        return Err(
            "This account's saved API key is invalid. Reconnect it before running tasks.".into(),
        );
    }
    Ok(Some(key))
}

#[tauri::command]
pub fn agent_profile_save_key(
    runtime: State<'_, TaskRuntime>,
    agent: String,
    id: String,
    name: String,
    value: String,
) -> Result<(), String> {
    runtime.access.ensure()?;
    if !allowed(&agent, &name)
        || value.trim().is_empty()
        || value.len() > 8192
        || value.chars().any(char::is_control)
    {
        return Err("Choose a supported provider and enter a valid API key.".into());
    }
    let _guard = crate::commands::integration::execution_guard()?;
    let _profiles = super::PROFILE_LOCK
        .lock()
        .map_err(|_| "Account settings are unavailable.")?;
    let binding = super::bind_account(&runtime.profiles_root(), &agent, Some(&id))?;
    crate::commands::agent_sign_in::ensure_idle(&binding)?;
    if runtime.integration_runs()?.iter().any(|run| {
        ["starting", "running", "stopping"].contains(&run.status.as_str())
            && run
                .account_binding
                .as_ref()
                .is_some_and(|account| account.directory == binding.directory)
    }) {
        return Err("Stop tasks using this account before changing its API key.".into());
    }
    let bytes = serde_json::to_vec(&ApiKey {
        name,
        value: value.trim().to_owned(),
    })
    .map_err(|_| "Could not prepare the API key.")?;
    let path = binding.directory.join("api-key.bin");
    #[cfg(windows)]
    {
        crate::commands::account_storage::write(&path, &bytes)
    }
    #[cfg(not(windows))]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&temporary, &path)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result.map_err(|_: std::io::Error| "Could not save this account's API key.".into())
    }
}
