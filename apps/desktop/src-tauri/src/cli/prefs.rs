//! The command's files in the profile's preferences, and the environment
//! switches it reads.

use crate::protocol::profile_root;
use std::path::PathBuf;

/// `task-runs-v1/preferences/<name>` in the active profile.
pub fn path(name: &str) -> Option<PathBuf> {
    Some(profile_root()?.join("task-runs-v1/preferences").join(name))
}

pub fn read_json<T: serde::de::DeserializeOwned>(name: &str) -> Option<T> {
    let bytes = std::fs::read(path(name)?).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Writes beside the file, then renames, so a crash never leaves half of it.
pub fn write_json<T: serde::Serialize>(name: &str, value: &T) -> Result<(), String> {
    let path = path(name).ok_or("Could not locate the Jackalope profile.")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let encoded = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let partial = path.with_extension("partial");
    std::fs::write(&partial, encoded).map_err(|error| error.to_string())?;
    std::fs::rename(partial, path).map_err(|error| error.to_string())
}

pub fn remove(name: &str) {
    if let Some(path) = path(name) {
        let _ = std::fs::remove_file(path);
    }
}

/// An on/off environment switch: `1`, `true`, `yes` or `on` turn it on;
/// `0`, `false`, `no`, `off` or an empty value turn it off. `None` when unset
/// or unrecognised, so callers keep their default.
pub fn env_flag(name: &str) -> Option<bool> {
    flag(&std::env::var(name).ok()?)
}

fn flag(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "" | "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn switches_read_common_spellings() {
        assert_eq!(flag("1"), Some(true));
        assert_eq!(flag(" TRUE "), Some(true));
        assert_eq!(flag("0"), Some(false));
        assert_eq!(flag(""), Some(false));
        assert_eq!(flag("off"), Some(false));
        assert_eq!(flag("maybe"), None);
    }
}
