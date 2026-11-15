//! Agent sign-ins for agents that run on a computer.
//!
//! Local agent accounts are profile folders on this device and never leave it.
//! An agent running on a computer instead gets one explicit credential per
//! agent, saved in protected storage and passed to the run's environment only.

use super::super::account_storage;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};

/// A credential the person can save, the agent it serves and the environment
/// variables it is passed as.
pub(crate) struct Kind {
    pub id: &'static str,
    pub adapter: &'static str,
    pub label: &'static str,
    pub variables: &'static [&'static str],
}

/// In preference order per agent: the first saved one is used.
pub(crate) const KINDS: &[Kind] = &[
    Kind {
        id: "claude-token",
        adapter: "claude",
        label: "Claude Code sign-in token",
        variables: &["CLAUDE_CODE_OAUTH_TOKEN"],
    },
    Kind {
        id: "anthropic-key",
        adapter: "claude",
        label: "Anthropic API key",
        variables: &["ANTHROPIC_API_KEY"],
    },
    Kind {
        id: "openai-key",
        adapter: "codex",
        label: "OpenAI API key",
        variables: &["CODEX_API_KEY", "OPENAI_API_KEY"],
    },
];

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    #[serde(default)]
    values: BTreeMap<String, String>,
}

fn path(root: &Path) -> std::path::PathBuf {
    root.join("secrets").join("agent-credentials.bin")
}

fn load(root: &Path) -> Result<Saved, String> {
    Ok(account_storage::read(&path(root))?
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub id: String,
    pub agent: String,
    pub label: String,
    pub saved: bool,
}

pub(crate) fn status(root: &Path) -> Result<Vec<CredentialStatus>, String> {
    let saved = load(root)?;
    Ok(KINDS
        .iter()
        .map(|kind| CredentialStatus {
            id: kind.id.into(),
            agent: kind.adapter.into(),
            label: kind.label.into(),
            saved: saved.values.contains_key(kind.id),
        })
        .collect())
}

/// Saves (`Some`) or removes (`None`) one credential.
pub(crate) fn set(root: &Path, id: &str, value: Option<&str>) -> Result<(), String> {
    let kind = KINDS
        .iter()
        .find(|kind| kind.id == id)
        .ok_or("Choose a supported sign-in.")?;
    let mut saved = load(root)?;
    match value.map(str::trim) {
        Some(value) => {
            if value.len() < 20 || value.len() > 4000 || value.chars().any(char::is_whitespace) {
                return Err(format!("That does not look like a {}.", kind.label));
            }
            saved.values.insert(id.into(), value.into());
        }
        None => {
            saved.values.remove(id);
        }
    }
    std::fs::create_dir_all(root.join("secrets")).map_err(|e| e.to_string())?;
    account_storage::write_json(&path(root), &saved)
}

/// The environment for `adapter` on a computer, from its first saved credential.
pub(crate) fn environment(root: &Path, adapter: &str) -> Result<Vec<(String, String)>, String> {
    let saved = load(root)?;
    for kind in KINDS.iter().filter(|kind| kind.adapter == adapter) {
        if let Some(value) = saved.values.get(kind.id) {
            return Ok(kind
                .variables
                .iter()
                .map(|name| ((*name).to_string(), value.clone()))
                .collect());
        }
    }
    let options: Vec<&str> = KINDS
        .iter()
        .filter(|kind| kind.adapter == adapter)
        .map(|kind| kind.label)
        .collect();
    if options.is_empty() {
        return Err(format!("{adapter} cannot run on a computer yet."));
    }
    Err(format!(
        "Add a {} in Settings → Computers so {adapter} can run on a computer.",
        options.join(" or ")
    ))
}
