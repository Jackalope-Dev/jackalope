//! Project secrets: environment variables a project's task agents receive.
//!
//! Values are kept in protected storage (`account_storage`: DPAPI on Windows,
//! the Keychain on macOS, Secret Service on Linux), one record per project,
//! never in project JSON. They leave native code only as the environment of
//! the project's agent processes, on this device or on its computer; the app
//! only ever sees names, where each is available and when it was saved.

use super::account_storage;
use super::tasks::TaskRuntime;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

/// Serializes read-modify-write of a project's record.
static LOCK: Mutex<()> = Mutex::new(());

const MAX_SECRETS: usize = 64;
const MAX_VALUE_CHARS: usize = 16_000;
const MAX_NAME_CHARS: usize = 128;

/// Names Jackalope, agent sign-ins and the operating system own, besides each
/// agent's account variable. A secret with one of these would change how the
/// agent signs in or starts.
const RESERVED: &[&str] = &[
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "CODEX_API_KEY",
    "KIMI_SHARE_DIR",
    "GEMINI_FORCE_FILE_STORAGE",
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_DISABLE_PROJECT_CONFIG",
    "PATH",
    "PATHEXT",
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "TMPDIR",
    "SHELL",
    "USER",
    "USERNAME",
    "LOGNAME",
    "PWD",
    "TERM",
    "LANG",
    "NODE_OPTIONS",
    "BASH_ENV",
    "ENV",
    "ZDOTDIR",
    "PROMPT_COMMAND",
    "IFS",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "XDG_RUNTIME_DIR",
];
const RESERVED_PREFIXES: &[&str] = &["JACKALOPE_", "GIT_", "LD_", "DYLD_"];

/// Where a secret's agents run.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Availability {
    /// Agents running on this device.
    Local,
    /// Agents running on the project's computer.
    Computers,
    #[default]
    Both,
}

impl Availability {
    fn includes(self, place: Place) -> bool {
        matches!(
            (self, place),
            (Self::Both, _) | (Self::Local, Place::Local) | (Self::Computers, Place::Computer)
        )
    }
}

/// Where an agent process runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Place {
    Local,
    Computer,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    value: String,
    #[serde(default)]
    available_to: Availability,
    updated_at: String,
}

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    #[serde(default)]
    secrets: BTreeMap<String, Entry>,
}

/// What the app sees of a secret: never its value.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub name: String,
    pub available_to: Availability,
    pub updated_at: String,
}

fn path(root: &Path, project_id: &str) -> Result<PathBuf, String> {
    if project_id.is_empty()
        || project_id.len() > 120
        || !project_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Choose a saved project.".into());
    }
    Ok(root.join(format!("{project_id}.bin")))
}

fn load(root: &Path, project_id: &str) -> Result<Saved, String> {
    match account_storage::read(&path(root, project_id)?)? {
        Some(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "This project's saved secrets could not be read.".into()),
        None => Ok(Saved::default()),
    }
}

fn store(root: &Path, project_id: &str, saved: &Saved) -> Result<(), String> {
    let path = path(root, project_id)?;
    if saved.secrets.is_empty() {
        return account_storage::remove(&path);
    }
    std::fs::create_dir_all(root).map_err(|_| "Project secrets could not be saved.")?;
    let bytes = serde_json::to_vec(saved).map_err(|_| "Project secrets could not be saved.")?;
    account_storage::write(&path, &bytes)
}

fn statuses(saved: &Saved) -> Vec<SecretStatus> {
    saved
        .secrets
        .iter()
        .map(|(name, entry)| SecretStatus {
            name: name.clone(),
            available_to: entry.available_to,
            updated_at: entry.updated_at.clone(),
        })
        .collect()
}

/// Checks an environment variable name a secret may use.
pub(crate) fn validate_name(name: &str) -> Result<(), String> {
    let mut chars = name.chars();
    let shaped = chars
        .next()
        .is_some_and(|first| first.is_ascii_uppercase() || first == '_')
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && name.len() <= MAX_NAME_CHARS;
    if !shaped {
        return Err("Use capital letters, digits and underscores, starting with a letter or underscore, up to 128 characters.".into());
    }
    let owned = RESERVED.contains(&name)
        || super::agents::all()
            .iter()
            .any(|agent| agent.account_env() == Some(name))
        || RESERVED_PREFIXES
            .iter()
            .any(|prefix| name.starts_with(prefix))
        || super::computers::credentials::KINDS
            .iter()
            .any(|kind| kind.variables.contains(&name));
    if owned {
        return Err(format!(
            "{name} is set by Jackalope, an agent sign-in or the system. Choose another name."
        ));
    }
    Ok(())
}

fn validate_value(value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err("Enter a value.".into());
    }
    if value.chars().count() > MAX_VALUE_CHARS {
        return Err("Values are limited to 16,000 characters.".into());
    }
    if value.contains('\0') {
        return Err("Values cannot contain a null character.".into());
    }
    Ok(())
}

pub(crate) fn list(root: &Path, project_id: &str) -> Result<Vec<SecretStatus>, String> {
    let _guard = LOCK
        .lock()
        .map_err(|_| "Project secrets are unavailable.")?;
    Ok(statuses(&load(root, project_id)?))
}

/// Adds or replaces a secret. Without a value, only where it is available
/// changes, and the secret must already exist.
pub(crate) fn set(
    root: &Path,
    project_id: &str,
    name: &str,
    value: Option<&str>,
    available_to: Availability,
) -> Result<Vec<SecretStatus>, String> {
    validate_name(name)?;
    let value = value.map(|value| value.trim());
    if let Some(value) = value {
        validate_value(value)?;
    }
    let _guard = LOCK
        .lock()
        .map_err(|_| "Project secrets are unavailable.")?;
    let mut saved = load(root, project_id)?;
    let updated_at = Utc::now().to_rfc3339();
    match (value, saved.secrets.get_mut(name)) {
        (Some(value), _) => {
            if !saved.secrets.contains_key(name) && saved.secrets.len() >= MAX_SECRETS {
                return Err(format!(
                    "A project can have at most {MAX_SECRETS} secrets. Remove one first."
                ));
            }
            saved.secrets.insert(
                name.to_string(),
                Entry {
                    value: value.to_string(),
                    available_to,
                    updated_at,
                },
            );
        }
        (None, Some(entry)) => {
            entry.available_to = available_to;
            entry.updated_at = updated_at;
        }
        (None, None) => return Err(format!("{name} is not saved. Enter its value.")),
    }
    store(root, project_id, &saved)?;
    Ok(statuses(&saved))
}

pub(crate) fn remove(
    root: &Path,
    project_id: &str,
    name: &str,
) -> Result<Vec<SecretStatus>, String> {
    let _guard = LOCK
        .lock()
        .map_err(|_| "Project secrets are unavailable.")?;
    let mut saved = load(root, project_id)?;
    if saved.secrets.remove(name).is_some() {
        store(root, project_id, &saved)?;
    }
    Ok(statuses(&saved))
}

/// The environment for a project's agent process running at `place`, as name
/// and value. Names are checked again, so a record from an older build cannot
/// set a name Jackalope now owns.
pub(crate) fn environment(
    root: &Path,
    project_id: &str,
    place: Place,
) -> Result<Vec<(String, String)>, String> {
    if project_id.is_empty() {
        return Ok(Vec::new());
    }
    let _guard = LOCK
        .lock()
        .map_err(|_| "Project secrets are unavailable.")?;
    // A missing record needs no protected-storage access.
    if !path(root, project_id)?.exists() {
        return Ok(Vec::new());
    }
    Ok(load(root, project_id)?
        .secrets
        .into_iter()
        .filter(|(name, entry)| entry.available_to.includes(place) && validate_name(name).is_ok())
        .map(|(name, entry)| (name, entry.value))
        .collect())
}

fn root(state: &TaskRuntime) -> PathBuf {
    state.project_secrets_root()
}

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| e.to_string())?
}

/// A project's secrets: names, availability and save times only.
#[tauri::command]
pub async fn project_secrets(
    project_id: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<Vec<SecretStatus>, String> {
    let root = root(&state);
    blocking(move || list(&root, &project_id)).await
}

/// Saves a secret's value and availability, or only its availability when
/// `value` is absent. Returns the project's secrets without values.
#[tauri::command]
pub async fn project_secret_set(
    project_id: String,
    name: String,
    value: Option<String>,
    available_to: Availability,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<Vec<SecretStatus>, String> {
    let root = root(&state);
    blocking(move || {
        let value = value.filter(|value| !value.trim().is_empty());
        set(&root, &project_id, &name, value.as_deref(), available_to)
    })
    .await
}

#[tauri::command]
pub async fn project_secret_remove(
    project_id: String,
    name: String,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<Vec<SecretStatus>, String> {
    let root = root(&state);
    blocking(move || remove(&root, &project_id, &name)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(PathBuf);

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn scratch() -> Scratch {
        Scratch(std::env::temp_dir().join(format!("jackalope-secrets-{}", uuid::Uuid::new_v4())))
    }

    #[test]
    fn names_follow_environment_rules_and_avoid_owned_ones() {
        for name in ["HIGGSFIELD_API_KEY", "ELEVENLABS_API_KEY", "_PRIVATE", "A1"] {
            assert!(validate_name(name).is_ok(), "{name}");
        }
        for name in [
            "",
            "lower_case",
            "1STARTS_WITH_DIGIT",
            "HAS-DASH",
            "HAS SPACE",
            "ÜNICODE",
            &"A".repeat(129),
        ] {
            assert!(validate_name(name).is_err(), "{name}");
        }
        assert!(validate_name(&"A".repeat(128)).is_ok());
        for name in [
            "JACKALOPE_BRIDGE_TOKEN",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "ANTHROPIC_API_KEY",
            "OPENAI_API_KEY",
            "CODEX_API_KEY",
            "CODEX_HOME",
            "CLAUDE_CONFIG_DIR",
            "PATH",
            "HOME",
            "USERPROFILE",
            "GIT_AUTHOR_NAME",
            "LD_PRELOAD",
            "DYLD_INSERT_LIBRARIES",
            "NODE_OPTIONS",
        ] {
            let error = validate_name(name).unwrap_err();
            assert!(error.contains("Choose another name"), "{name}: {error}");
        }
        assert!(validate_value("").is_err());
        assert!(validate_value("a\0b").is_err());
        assert!(validate_value(&"é".repeat(16_000)).is_ok());
        assert!(validate_value(&"é".repeat(16_001)).is_err());
    }

    #[test]
    fn variables_an_account_binding_sets_are_reserved() {
        let root = scratch();
        for agent in super::super::agents::all() {
            let binding = super::super::agent_profiles::AccountBinding {
                adapter: agent.id.clone(),
                profile_id: Some("work".into()),
                directory: root.0.join(&agent.id),
                label: "Work".into(),
            };
            let mut command = std::process::Command::new("fixture");
            // Antigravity accounts need saved settings and a key; its home variables are reserved.
            if super::super::agent_profiles::apply_binding(&mut command, &binding).is_err() {
                continue;
            }
            for (name, value) in command.get_envs() {
                let name = name.to_string_lossy();
                assert!(
                    value.is_none() || validate_name(&name).is_err(),
                    "{}: {name}",
                    agent.id
                );
            }
        }
    }

    #[test]
    fn availability_selects_where_agents_receive_a_secret() {
        assert!(Availability::Both.includes(Place::Local));
        assert!(Availability::Both.includes(Place::Computer));
        assert!(Availability::Local.includes(Place::Local));
        assert!(!Availability::Local.includes(Place::Computer));
        assert!(Availability::Computers.includes(Place::Computer));
        assert!(!Availability::Computers.includes(Place::Local));
        assert_eq!(
            serde_json::from_str::<Availability>("\"computers\"").unwrap(),
            Availability::Computers
        );
        let entry: Entry =
            serde_json::from_str(r#"{"value":"v","updatedAt":"2026-01-01T00:00:00Z"}"#).unwrap();
        assert_eq!(entry.available_to, Availability::Both);
    }

    #[test]
    fn invalid_projects_are_refused_before_storage() {
        let dir = scratch();
        assert!(path(&dir.0, "../escape").is_err());
        assert!(path(&dir.0, "").is_err());
        assert!(list(&dir.0, "a/b").is_err());
        assert!(environment(&dir.0, "", Place::Local).unwrap().is_empty());
        assert!(environment(&dir.0, "never-saved", Place::Local)
            .unwrap()
            .is_empty());
    }

    // Linux CI has no Secret Service keyring to hold the record.
    #[cfg(not(target_os = "linux"))]
    #[test]
    fn secrets_round_trip_through_protected_storage_without_exposing_values() {
        let dir = scratch();
        let root = dir.0.as_path();
        let value = "hf-fixture-value-never-in-plaintext-0123456789";
        let saved = set(
            root,
            "project-1",
            "HIGGSFIELD_API_KEY",
            Some(&format!("  {value}\n")),
            Availability::Both,
        )
        .unwrap();
        assert_eq!(saved.len(), 1);
        let serialized = serde_json::to_string(&saved).unwrap();
        assert!(serialized.contains("\"availableTo\":\"both\""));
        assert!(!serialized.contains(value));
        let on_disk = std::fs::read(path(root, "project-1").unwrap()).unwrap();
        assert!(!on_disk
            .windows(value.len())
            .any(|part| part == value.as_bytes()));

        set(
            root,
            "project-1",
            "ELEVENLABS_API_KEY",
            Some("el-fixture"),
            Availability::Local,
        )
        .unwrap();
        let local = environment(root, "project-1", Place::Local).unwrap();
        assert_eq!(
            local,
            [
                ("ELEVENLABS_API_KEY".to_string(), "el-fixture".to_string()),
                ("HIGGSFIELD_API_KEY".to_string(), value.to_string()),
            ]
        );
        let remote = environment(root, "project-1", Place::Computer).unwrap();
        assert_eq!(
            remote,
            [("HIGGSFIELD_API_KEY".to_string(), value.to_string())]
        );
        assert!(environment(root, "project-2", Place::Local)
            .unwrap()
            .is_empty());

        // Changing availability keeps the value.
        let changed = set(
            root,
            "project-1",
            "ELEVENLABS_API_KEY",
            None,
            Availability::Computers,
        )
        .unwrap();
        assert!(changed
            .iter()
            .any(|s| s.name == "ELEVENLABS_API_KEY" && s.available_to == Availability::Computers));
        assert!(environment(root, "project-1", Place::Computer)
            .unwrap()
            .contains(&("ELEVENLABS_API_KEY".to_string(), "el-fixture".to_string())));
        assert!(set(root, "project-1", "MISSING", None, Availability::Both).is_err());
        assert!(set(root, "project-1", "PATH", Some("x"), Availability::Both).is_err());

        for index in 0..62 {
            set(
                root,
                "project-1",
                &format!("KEY_{index}"),
                Some("v"),
                Availability::Both,
            )
            .unwrap();
        }
        assert!(set(
            root,
            "project-1",
            "ONE_TOO_MANY",
            Some("v"),
            Availability::Both
        )
        .is_err());
        assert!(set(
            root,
            "project-1",
            "KEY_0",
            Some("replaced"),
            Availability::Both
        )
        .is_ok());

        remove(root, "project-1", "HIGGSFIELD_API_KEY").unwrap();
        let names: Vec<String> = list(root, "project-1")
            .unwrap()
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert!(!names.contains(&"HIGGSFIELD_API_KEY".to_string()));
        for name in names {
            remove(root, "project-1", &name).unwrap();
        }
        assert!(list(root, "project-1").unwrap().is_empty());
        assert!(!path(root, "project-1").unwrap().exists());
    }
}
