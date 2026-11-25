//! Which device an agent may use. Nothing reaches a physical device unless the
//! person attached it to the conversation (or the task, for work outside one) or
//! allowed it for the whole project.
//!
//! An attachment lives in memory until the person detaches it or Jackalope quits, and
//! covers every attempt in that conversation. A remembered grant lives in
//! `preferences/device-grants.json`, answers for any work in its project and is
//! removed from Project settings. See only allows the app list and console logs;
//! control also installs, launches and stops apps.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    See,
    Control,
    /// A level written by a newer app; allows nothing.
    #[serde(other)]
    Unknown,
}

impl Level {
    pub fn of(control: bool) -> Self {
        if control {
            Self::Control
        } else {
            Self::See
        }
    }

    fn allows(self, need: Need) -> bool {
        match (self, need) {
            (Self::Control, _) => true,
            (Self::See, Need::See) => true,
            _ => false,
        }
    }
}

/// What an operation needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Need {
    /// The app list and console logs.
    See,
    /// Installing, launching and stopping apps.
    Control,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attached {
    pub device_id: String,
    pub name: String,
    pub level: Level,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RememberedDevice {
    pub id: String,
    pub project_id: String,
    pub device_id: String,
    pub name: String,
    pub level: Level,
    pub created_at: String,
}

/// The device an operation may use, and why.
#[derive(Clone, Debug, PartialEq)]
pub struct Grant {
    pub device_id: String,
    pub name: String,
    pub level: Level,
    /// Allowed for the project rather than attached to this conversation.
    pub remembered: bool,
}

fn attached_map() -> &'static Mutex<HashMap<String, Attached>> {
    static MAP: OnceLock<Mutex<HashMap<String, Attached>>> = OnceLock::new();
    MAP.get_or_init(Mutex::default)
}

pub fn attach(key: &str, attached: Attached) {
    if let Ok(mut map) = attached_map().lock() {
        map.insert(key.to_owned(), attached);
    }
}

pub fn detach(key: &str) -> Option<Attached> {
    attached_map().lock().ok()?.remove(key)
}

pub fn attached(key: &str) -> Option<Attached> {
    attached_map().lock().ok()?.get(key).cloned()
}

/// The refusal an agent reads when no grant covers what it asked for.
pub fn no_device() -> String {
    "No iPhone or iPad is attached to this conversation, and none is allowed for this project. Ask the person with request_human_action to attach one: in the conversation's options menu, iPhone or iPad → Attach, with See and control to install, launch or stop apps. Nothing runs on a physical device without that.".into()
}

/// Picks the device for an operation: the conversation's attached device, else a device
/// allowed for the project. A `named` device must be one of those.
pub fn resolve(
    attached: Option<&Attached>,
    remembered: &[RememberedDevice],
    named: Option<&str>,
    need: Need,
) -> Result<Grant, String> {
    let named = named.map(str::trim).filter(|name| !name.is_empty());
    let matches = |id: &str, name: &str| {
        named.is_none_or(|wanted| {
            id.eq_ignore_ascii_case(wanted) || name.eq_ignore_ascii_case(wanted)
        })
    };
    let grant = if let Some(attached) = attached.filter(|a| matches(&a.device_id, &a.name)) {
        Grant {
            device_id: attached.device_id.clone(),
            name: attached.name.clone(),
            level: attached.level,
            remembered: false,
        }
    } else {
        let candidates: Vec<&RememberedDevice> = remembered
            .iter()
            .filter(|grant| grant.level != Level::Unknown && matches(&grant.device_id, &grant.name))
            .collect();
        match candidates.as_slice() {
            [] if named.is_some() => {
                return Err(format!(
                    "{} is not attached to this conversation or allowed for this project. {}",
                    named.unwrap_or_default(),
                    no_device()
                ))
            }
            [] => return Err(no_device()),
            [one] => Grant {
                device_id: one.device_id.clone(),
                name: one.name.clone(),
                level: one.level,
                remembered: true,
            },
            several => {
                let names: Vec<&str> = several.iter().map(|grant| grant.name.as_str()).collect();
                return Err(format!(
                    "Several devices are allowed in this project ({}). Name one with device.",
                    names.join(", ")
                ));
            }
        }
    };
    if !grant.level.allows(need) {
        return Err(format!(
            "{} is attached for seeing only: the app list and console logs. Ask the person with request_human_action to attach it with See and control to install, launch or stop apps.",
            grant.name
        ));
    }
    Ok(grant)
}

// ---- remembered grants ----

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Store {
    #[serde(default)]
    devices: Vec<RememberedDevice>,
}

pub fn store_path(preferences: &Path) -> PathBuf {
    preferences.join("device-grants.json")
}

fn lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Default::default)
}

fn read(path: &Path) -> Store {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write(path: &Path, store: &Store) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?;
    super::super::history::write_atomic(path, &bytes)
}

pub fn remembered(path: &Path, project_id: &str) -> Vec<RememberedDevice> {
    let _guard = lock().lock();
    read(path)
        .devices
        .into_iter()
        .filter(|grant| grant.project_id == project_id)
        .collect()
}

/// Allows a device for every conversation in a project, replacing its earlier level.
pub fn remember(
    path: &Path,
    project_id: &str,
    device_id: &str,
    name: &str,
    level: Level,
) -> Result<RememberedDevice, String> {
    if project_id.is_empty() || device_id.is_empty() || level == Level::Unknown {
        return Err("A project and device are required to remember a device.".into());
    }
    let _guard = lock().lock();
    let mut store = read(path);
    store
        .devices
        .retain(|grant| !(grant.project_id == project_id && grant.device_id == device_id));
    let grant = RememberedDevice {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: project_id.into(),
        device_id: device_id.into(),
        name: name.chars().take(80).collect(),
        level,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    store.devices.push(grant.clone());
    write(path, &store)?;
    Ok(grant)
}

pub fn forget(path: &Path, project_id: &str, id: &str) -> Result<RememberedDevice, String> {
    let _guard = lock().lock();
    let mut store = read(path);
    let index = store
        .devices
        .iter()
        .position(|grant| grant.project_id == project_id && grant.id == id)
        .ok_or("That device is no longer allowed in this project.")?;
    let removed = store.devices.remove(index);
    write(path, &store)?;
    Ok(removed)
}
