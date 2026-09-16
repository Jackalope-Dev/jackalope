use super::{DecisionMode, JevFallback, TaskRuntime};
use crate::commands::history;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub(crate) static LOCK: Mutex<()> = Mutex::new(());

#[derive(Default, Deserialize, Serialize)]
pub(crate) struct Preferences {
    #[serde(default)]
    pub mode: DecisionMode,
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub project_modes: BTreeMap<String, DecisionMode>,
    #[serde(default)]
    pub jev_fallback: JevFallback,
    #[serde(default)]
    pub project_jev_fallbacks: BTreeMap<String, JevFallback>,
}

impl Preferences {
    pub fn effective_fallback(&self, project: Option<&str>) -> JevFallback {
        match project {
            Some(id) if self.project_modes.contains_key(id) => self
                .project_jev_fallbacks
                .get(id)
                .copied()
                .unwrap_or_default(),
            _ => self.jev_fallback,
        }
    }

    pub fn effective(&self, project: Option<&str>) -> DecisionMode {
        project
            .and_then(|id| self.project_modes.get(id))
            .copied()
            .unwrap_or(self.mode)
    }
    pub fn set_mode(
        &mut self,
        project: Option<&str>,
        mode: Option<DecisionMode>,
        fallback: Option<JevFallback>,
    ) -> Result<(), String> {
        validate_project(project)?;
        match (project, mode) {
            (Some(id), Some(mode)) => {
                let fallback = fallback.unwrap_or_else(|| self.effective_fallback(project));
                self.project_modes.insert(id.into(), mode);
                self.project_jev_fallbacks.insert(id.into(), fallback);
            }
            (Some(id), None) => {
                self.project_modes.remove(id);
                self.project_jev_fallbacks.remove(id);
            }
            (None, Some(mode)) => {
                self.mode = mode;
                if let Some(fallback) = fallback {
                    self.jev_fallback = fallback;
                }
            }
            (None, None) => return Err("Choose an app default decision method.".into()),
        }
        Ok(())
    }
}

pub(crate) fn directory(runtime: &TaskRuntime) -> PathBuf {
    runtime.profiles_root().join("jev-routing")
}

pub(crate) fn validate_project(project: Option<&str>) -> Result<(), String> {
    if project.is_some_and(|id| {
        id.is_empty()
            || id.len() > 120
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    }) {
        return Err("Invalid project decision scope.".into());
    }
    Ok(())
}

pub(crate) fn read(path: &Path) -> Result<Preferences, String> {
    let file = path.join("settings.json");
    if !file.exists() {
        return Ok(Preferences::default());
    }
    serde_json::from_slice(&history::read_bounded(&file, 256 * 1024)?).map_err(|_| {
        "Decision settings could not be read. Restore them before changing decisions.".into()
    })
}

pub(crate) fn save(path: &Path, value: &mut Preferences) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|_| "Could not save decision settings.")?;
    value.revision = value
        .revision
        .checked_add(1)
        .ok_or("Decision settings revision limit reached.")?;
    let bytes = serde_json::to_vec(value).map_err(|_| "Could not save decision settings.")?;
    if bytes.len() > 256 * 1024 {
        return Err("Too many project decision overrides. Remove unused overrides first.".into());
    }
    history::write_atomic(&path.join("settings.json"), &bytes)
}

pub(crate) fn check_revision(value: &Preferences, expected: u64) -> Result<(), String> {
    if value.revision != expected {
        return Err(
            "Decision settings changed in another window. Reload them and try again.".into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_project_overrides_never_inherit_a_new_paid_fallback() {
        let mut value: Preferences =
            serde_json::from_str(r#"{"mode":"jev","project_modes":{"existing":"jev"}}"#).unwrap();
        value
            .set_mode(None, Some(DecisionMode::Jev), Some(JevFallback::Agent))
            .unwrap();
        assert_eq!(
            value.effective_fallback(Some("existing")),
            JevFallback::Local
        );
        assert_eq!(value.effective_fallback(Some("new")), JevFallback::Agent);
    }

    #[test]
    fn project_fallback_is_pinned_with_its_method_and_reset_with_inheritance() {
        let mut value = Preferences::default();
        value
            .set_mode(Some("pinned"), Some(DecisionMode::Jev), None)
            .unwrap();
        value
            .set_mode(None, Some(DecisionMode::Jev), Some(JevFallback::Agent))
            .unwrap();
        assert_eq!(value.effective_fallback(Some("new")), JevFallback::Agent);
        assert_eq!(value.effective_fallback(Some("pinned")), JevFallback::Local);
        value.set_mode(Some("pinned"), None, None).unwrap();
        assert_eq!(value.effective_fallback(Some("pinned")), JevFallback::Agent);
    }

    #[test]
    fn project_overrides_are_isolated_and_legacy_defaults_survive() {
        let mut value: Preferences =
            serde_json::from_str(r#"{"mode":"agent","revision":4}"#).unwrap();
        assert_eq!(value.effective(Some("project-a")), DecisionMode::Agent);
        value
            .set_mode(
                Some("project-a"),
                Some(DecisionMode::Jev),
                Some(JevFallback::Agent),
            )
            .unwrap();
        value
            .set_mode(Some("project-b"), Some(DecisionMode::Deterministic), None)
            .unwrap();
        assert_eq!(value.effective(Some("project-a")), DecisionMode::Jev);
        assert_eq!(
            value.effective(Some("project-b")),
            DecisionMode::Deterministic
        );
        assert_eq!(value.effective(Some("other")), DecisionMode::Agent);
        assert_eq!(
            value.effective_fallback(Some("project-a")),
            JevFallback::Agent
        );
        assert_eq!(
            value.effective_fallback(Some("project-b")),
            JevFallback::Local
        );
        let restored: Preferences =
            serde_json::from_slice(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(
            restored.effective_fallback(Some("project-a")),
            JevFallback::Agent
        );
        value.set_mode(Some("project-a"), None, None).unwrap();
        assert_eq!(
            value.effective_fallback(Some("project-a")),
            JevFallback::Local
        );
        assert_eq!(value.effective(Some("project-a")), DecisionMode::Agent);
        assert!(value
            .set_mode(Some("../escape"), Some(DecisionMode::Jev), None)
            .is_err());
        assert!(value.set_mode(None, None, None).is_err());
    }
}
