//! Project secrets: environment variables a project's task agents receive.
//!
//! Values are kept in protected storage (`account_storage`: DPAPI on Windows,
//! the Keychain on macOS, Secret Service on Linux), one record per project,
//! never in project JSON. They leave native code only as the environment of
//! the project's agent processes, on this device or on its computer; the app
//! only ever sees names, where each is available and when it was saved.
//!
//! A file secret, such as an App Store Connect `.p8` key, reaches a local agent
//! as a private file instead: written for one attempt outside the workspace,
//! its variable holds the path, and the file is deleted when the attempt ends.
//! File secrets are never sent to computers.

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
/// A file secret's contents. An App Store Connect key is about 250 bytes.
pub(crate) const MAX_FILE_BYTES: usize = 64 * 1024;
/// The whole record, which must fit one protected-storage entry.
const MAX_RECORD_BYTES: usize = 512 * 1024;
const MAX_FILE_NAME_CHARS: usize = 120;

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

/// How an agent receives a secret.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    /// The value itself, as an environment variable.
    #[default]
    Variable,
    /// The value written to a private file; the variable holds its path.
    File,
}

impl Kind {
    fn is_variable(&self) -> bool {
        *self == Self::Variable
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    value: String,
    #[serde(default)]
    available_to: Availability,
    #[serde(default, skip_serializing_if = "Kind::is_variable")]
    kind: Kind,
    /// The name the file keeps, such as `AuthKey_ABC123.p8`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
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
    pub kind: Kind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    pub updated_at: String,
}

/// A new value for a secret.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Value<'a> {
    pub text: &'a str,
    pub kind: Kind,
    pub file_name: Option<&'a str>,
}

#[cfg(test)]
impl<'a> Value<'a> {
    pub(crate) fn variable(text: &'a str) -> Self {
        Self {
            text,
            kind: Kind::Variable,
            file_name: None,
        }
    }
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
    Ok(account_storage::read_json(
        &path(root, project_id)?,
        "This project's saved secrets could not be read.",
    )?
    .unwrap_or_default())
}

fn store(root: &Path, project_id: &str, saved: &Saved) -> Result<(), String> {
    let path = path(root, project_id)?;
    if saved.secrets.is_empty() {
        return account_storage::remove(&path);
    }
    let size = serde_json::to_vec(saved).map_or(usize::MAX, |bytes| bytes.len());
    if size > MAX_RECORD_BYTES {
        return Err(
            "This project's secrets are too large to save together. Remove a file secret first."
                .into(),
        );
    }
    std::fs::create_dir_all(root).map_err(|_| "Project secrets could not be saved.")?;
    account_storage::write_json(&path, saved)
}

fn statuses(saved: &Saved) -> Vec<SecretStatus> {
    saved
        .secrets
        .iter()
        .map(|(name, entry)| SecretStatus {
            name: name.clone(),
            available_to: entry.available_to,
            kind: entry.kind,
            file_name: entry.file_name.clone(),
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

/// A file secret's contents: text up to [`MAX_FILE_BYTES`], kept as given
/// apart from surrounding blank space.
fn validate_file(value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err("Choose a file or paste its contents.".into());
    }
    if value.len() > MAX_FILE_BYTES {
        return Err("Files are limited to 64 KB.".into());
    }
    if value.contains('\0') {
        return Err("Files must be text, such as a .p8 or .pem key.".into());
    }
    Ok(())
}

/// The name a file secret's file keeps: a plain file name, or none.
fn file_name(name: Option<&str>) -> Result<Option<String>, String> {
    let Some(name) = name.map(str::trim).filter(|name| !name.is_empty()) else {
        return Ok(None);
    };
    let plain = name.chars().count() <= MAX_FILE_NAME_CHARS
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    if !plain {
        return Err("Use a file name of letters, digits, dots, dashes and underscores.".into());
    }
    Ok(Some(name.to_string()))
}

pub(crate) fn list(root: &Path, project_id: &str) -> Result<Vec<SecretStatus>, String> {
    let _guard = LOCK
        .lock()
        .map_err(|_| "Project secrets are unavailable.")?;
    Ok(statuses(&load(root, project_id)?))
}

/// Adds or replaces a secret. Without a value, only where it is available
/// changes, and the secret must already exist. File secrets reach agents on
/// this device only.
pub(crate) fn set(
    root: &Path,
    project_id: &str,
    name: &str,
    value: Option<Value<'_>>,
    available_to: Availability,
) -> Result<Vec<SecretStatus>, String> {
    validate_name(name)?;
    let value = match value {
        Some(value) if value.kind == Kind::File => {
            validate_file(value.text)?;
            Some((
                value.text.trim().to_string(),
                Kind::File,
                file_name(value.file_name)?,
            ))
        }
        Some(value) => {
            let text = value.text.trim();
            validate_value(text)?;
            Some((text.to_string(), Kind::Variable, None))
        }
        None => None,
    };
    let _guard = LOCK
        .lock()
        .map_err(|_| "Project secrets are unavailable.")?;
    let mut saved = load(root, project_id)?;
    let kind = value
        .as_ref()
        .map(|(_, kind, _)| *kind)
        .or_else(|| saved.secrets.get(name).map(|entry| entry.kind));
    if kind == Some(Kind::File) && available_to != Availability::Local {
        return Err("File secrets are available to agents on this device only.".into());
    }
    let updated_at = Utc::now().to_rfc3339();
    match (value, saved.secrets.get_mut(name)) {
        (Some((value, kind, file_name)), _) => {
            if !saved.secrets.contains_key(name) && saved.secrets.len() >= MAX_SECRETS {
                return Err(format!(
                    "A project can have at most {MAX_SECRETS} secrets. Remove one first."
                ));
            }
            saved.secrets.insert(
                name.to_string(),
                Entry {
                    value,
                    available_to,
                    kind,
                    file_name,
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

/// The environment variables for a project's agent process running at
/// `place`, as name and value; file secrets are left to [`files`]. Names are
/// checked again, so a record from an older build cannot set a name Jackalope
/// now owns.
pub(crate) fn environment(
    root: &Path,
    project_id: &str,
    place: Place,
) -> Result<Vec<(String, String)>, String> {
    Ok(saved_secrets(root, project_id)?
        .into_iter()
        .filter(|(name, entry)| {
            entry.kind == Kind::Variable
                && entry.available_to.includes(place)
                && validate_name(name).is_ok()
        })
        .map(|(name, entry)| (name, entry.value))
        .collect())
}

/// A file secret for an agent on this device.
pub(crate) struct SecretFile {
    pub name: String,
    pub file_name: Option<String>,
    pub contents: String,
}

/// The project's file secrets, which only agents on this device receive.
pub(crate) fn files(root: &Path, project_id: &str) -> Result<Vec<SecretFile>, String> {
    Ok(saved_secrets(root, project_id)?
        .into_iter()
        .filter(|(name, entry)| {
            entry.kind == Kind::File
                && entry.available_to == Availability::Local
                && validate_name(name).is_ok()
        })
        .map(|(name, entry)| SecretFile {
            name,
            file_name: entry.file_name,
            contents: entry.value,
        })
        .collect())
}

fn saved_secrets(root: &Path, project_id: &str) -> Result<BTreeMap<String, Entry>, String> {
    if project_id.is_empty() {
        return Ok(BTreeMap::new());
    }
    let _guard = LOCK
        .lock()
        .map_err(|_| "Project secrets are unavailable.")?;
    // A missing record needs no protected-storage access.
    if !path(root, project_id)?.exists() {
        return Ok(BTreeMap::new());
    }
    Ok(load(root, project_id)?.secrets)
}

/// The folder of one attempt's secret files under `base`.
fn attempt_folder(base: &Path, attempt: &str) -> Result<PathBuf, String> {
    let plain = !attempt.is_empty()
        && attempt.len() <= 120
        && attempt
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if !plain {
        return Err("This attempt cannot receive secret files.".into());
    }
    Ok(base.join(attempt))
}

/// Writes an attempt's file secrets under `base`, readable by this user only,
/// and returns each variable with the path it names. Replaces whatever an
/// earlier start of the same attempt left.
pub(crate) fn materialize(
    base: &Path,
    attempt: &str,
    files: &[SecretFile],
) -> Result<Vec<(String, PathBuf)>, String> {
    let folder = attempt_folder(base, attempt)?;
    release(base, attempt);
    if files.is_empty() {
        return Ok(Vec::new());
    }
    let failed = |_| "Secret files could not be prepared for the agent.".to_string();
    private_dir(base).map_err(failed)?;
    private_dir(&folder).map_err(failed)?;
    let mut written = Vec::new();
    for file in files {
        let own = folder.join(&file.name);
        private_dir(&own).map_err(failed)?;
        let path = own.join(file.file_name.as_deref().unwrap_or(&file.name));
        write_private(&path, file.contents.as_bytes()).map_err(failed)?;
        written.push((file.name.clone(), path));
    }
    Ok(written)
}

/// Deletes an attempt's secret files. Safe to call when there are none.
pub(crate) fn release(base: &Path, attempt: &str) {
    if let Ok(folder) = attempt_folder(base, attempt) {
        let _ = std::fs::remove_dir_all(folder);
    }
}

/// Deletes every attempt's secret files. Only for startup, when no attempt runs.
pub(crate) fn sweep(base: &Path) {
    let _ = std::fs::remove_dir_all(base);
}

fn private_dir(path: &Path) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(path)
}

/// Writes `bytes` to a new file only this user can read.
pub(crate) fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
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

macro_rules! tauri_commands {
    ($next:ident $finish:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!($finish [$($done)*
            commands::project_secrets::project_secrets,
            commands::project_secrets::project_secret_set,
            commands::project_secrets::project_secret_remove,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

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
/// `value` is absent. `kind` defaults to a variable; a file secret's `value`
/// is the file's text. Returns the project's secrets without values.
#[tauri::command]
pub async fn project_secret_set(
    project_id: String,
    name: String,
    value: Option<String>,
    available_to: Availability,
    kind: Option<Kind>,
    file_name: Option<String>,
    state: tauri::State<'_, TaskRuntime>,
) -> Result<Vec<SecretStatus>, String> {
    let root = root(&state);
    blocking(move || {
        let value = value.filter(|value| !value.trim().is_empty());
        let value = value.as_deref().map(|text| Value {
            text,
            kind: kind.unwrap_or_default(),
            file_name: file_name.as_deref(),
        });
        set(&root, &project_id, &name, value, available_to)
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

    /// A PEM private key around `body`, spelled so secret scanners do not
    /// take the fixture for a real key.
    fn armored(body: &str) -> String {
        let kind = ["PRIVATE", "KEY"].join(" ");
        format!("-----BEGIN {kind}-----\n{body}\n-----END {kind}-----\n")
    }

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

    #[test]
    fn older_records_read_as_variables_and_variables_save_as_before() {
        let entry: Entry =
            serde_json::from_str(r#"{"value":"v","availableTo":"local","updatedAt":"t"}"#).unwrap();
        assert_eq!(entry.kind, Kind::Variable);
        assert_eq!(entry.file_name, None);
        assert_eq!(
            serde_json::to_string(&entry).unwrap(),
            r#"{"value":"v","availableTo":"local","updatedAt":"t"}"#
        );
    }

    #[test]
    fn file_contents_and_names_are_checked() {
        assert!(validate_file("   \n").is_err());
        assert!(validate_file("a\0b").is_err());
        assert!(validate_file(&"k".repeat(MAX_FILE_BYTES)).is_ok());
        assert!(validate_file(&"k".repeat(MAX_FILE_BYTES + 1)).is_err());
        assert_eq!(
            file_name(Some(" AuthKey_ABC123.p8 ")).unwrap().as_deref(),
            Some("AuthKey_ABC123.p8")
        );
        assert_eq!(file_name(Some("")).unwrap(), None);
        for bad in ["../x.p8", "a/b.p8", ".hidden", "key file.p8", "ключ.p8"] {
            assert!(file_name(Some(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn secret_files_are_private_outside_the_workspace_and_removed_with_the_attempt() {
        let dir = scratch();
        let base = dir.0.join("secret-files");
        let key = armored("MIGTAgEAMBMGByqGSM49AgEGCCqGSM49");
        let key = key.trim_end();
        let files = [
            SecretFile {
                name: "ASC_KEY".into(),
                file_name: Some("AuthKey_ABC123.p8".into()),
                contents: key.into(),
            },
            SecretFile {
                name: "SERVICE_ACCOUNT".into(),
                file_name: None,
                contents: "{}".into(),
            },
        ];
        let written = materialize(&base, "run-1", &files).unwrap();
        assert_eq!(written.len(), 2);
        let (name, path) = &written[0];
        assert_eq!(name, "ASC_KEY");
        assert_eq!(path, &base.join("run-1/ASC_KEY/AuthKey_ABC123.p8"));
        assert!(!path.to_string_lossy().contains("MIGT"));
        assert_eq!(std::fs::read_to_string(path).unwrap(), key);
        assert_eq!(
            written[1].1,
            base.join("run-1/SERVICE_ACCOUNT/SERVICE_ACCOUNT")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(path), 0o600);
            assert_eq!(mode(&base.join("run-1")), 0o700);
            assert_eq!(mode(&base.join("run-1/ASC_KEY")), 0o700);
        }
        // A restarted attempt replaces its files; other attempts keep theirs.
        materialize(&base, "run-2", &files[..1]).unwrap();
        let again = materialize(&base, "run-1", &files[..1]).unwrap();
        assert_eq!(again.len(), 1);
        assert!(!base.join("run-1/SERVICE_ACCOUNT").exists());
        release(&base, "run-1");
        assert!(!base.join("run-1").exists());
        assert!(base.join("run-2/ASC_KEY/AuthKey_ABC123.p8").exists());
        release(&base, "run-1");
        assert!(materialize(&base, "../escape", &files).is_err());
        assert!(materialize(&base, "run-3", &[]).unwrap().is_empty());
        assert!(!base.join("run-3").exists());
        sweep(&base);
        assert!(!base.exists());
    }

    // Linux CI has no Secret Service keyring to hold the record.
    #[cfg(not(target_os = "linux"))]
    #[test]
    fn file_secrets_stay_on_this_device_and_out_of_the_environment() {
        let dir = scratch();
        let root = dir.0.as_path();
        let key = armored("MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg");
        let key = key.as_str();
        let file = |available_to| {
            set(
                root,
                "project-f",
                "ASC_KEY",
                Some(Value {
                    text: key,
                    kind: Kind::File,
                    file_name: Some("AuthKey_ABC123.p8"),
                }),
                available_to,
            )
        };
        for place in [Availability::Both, Availability::Computers] {
            let error = file(place).unwrap_err();
            assert!(error.contains("this device only"), "{error}");
        }
        let saved = file(Availability::Local).unwrap();
        assert_eq!(saved[0].kind, Kind::File);
        assert_eq!(saved[0].file_name.as_deref(), Some("AuthKey_ABC123.p8"));
        let serialized = serde_json::to_string(&saved).unwrap();
        assert!(serialized.contains("\"kind\":\"file\""), "{serialized}");
        assert!(!serialized.contains("MIGT"));
        // Changing only availability keeps the file on this device.
        assert!(set(root, "project-f", "ASC_KEY", None, Availability::Both).is_err());
        set(
            root,
            "project-f",
            "PLAIN",
            Some(Value::variable("plain-value-1234")),
            Availability::Both,
        )
        .unwrap();
        for place in [Place::Local, Place::Computer] {
            let env = environment(root, "project-f", place).unwrap();
            assert_eq!(env, [("PLAIN".to_string(), "plain-value-1234".to_string())]);
        }
        let files = files(root, "project-f").unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "ASC_KEY");
        assert_eq!(files[0].contents, key.trim());
        assert!(files_for_missing_projects_are_empty(root));
        remove(root, "project-f", "ASC_KEY").unwrap();
        remove(root, "project-f", "PLAIN").unwrap();
        assert!(!path(root, "project-f").unwrap().exists());
    }

    #[cfg(not(target_os = "linux"))]
    fn files_for_missing_projects_are_empty(root: &Path) -> bool {
        files(root, "never-saved").unwrap().is_empty() && files(root, "").unwrap().is_empty()
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
            Some(Value::variable(&format!("  {value}\n"))),
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
            Some(Value::variable("el-fixture")),
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
        assert!(set(
            root,
            "project-1",
            "PATH",
            Some(Value::variable("x")),
            Availability::Both
        )
        .is_err());

        for index in 0..62 {
            set(
                root,
                "project-1",
                &format!("KEY_{index}"),
                Some(Value::variable("v")),
                Availability::Both,
            )
            .unwrap();
        }
        assert!(set(
            root,
            "project-1",
            "ONE_TOO_MANY",
            Some(Value::variable("v")),
            Availability::Both
        )
        .is_err());
        assert!(set(
            root,
            "project-1",
            "KEY_0",
            Some(Value::variable("replaced")),
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
