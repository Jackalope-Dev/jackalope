//! A project's settings as the registry saves them, the protocol sends them
//! and the terminal changes them, with what an absent value means.

use serde::{Deserialize, Serialize};

/// Accepted `learning_cadence` values.
pub const LEARNING_CADENCES: std::ops::RangeInclusive<u32> = 10..=1000;
/// Reported tool calls between background reflections when none is saved.
pub const DEFAULT_LEARNING_CADENCE: u32 = 50;

/// Where new work in a Git project runs.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceMode {
    /// A separate worktree on a new `jackalope/<name>` branch named after the request.
    #[default]
    Worktree,
    /// A new `jackalope/<name>` branch checked out in the project checkout.
    Branch,
    /// The project checkout on its current branch.
    Current,
    /// Ask the person when the task starts.
    Ask,
}

impl WorkspaceMode {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "worktree" => Some(Self::Worktree),
            "branch" => Some(Self::Branch),
            "current" => Some(Self::Current),
            "ask" => Some(Self::Ask),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Worktree => "worktree",
            Self::Branch => "branch",
            Self::Current => "current",
            Self::Ask => "ask",
        }
    }

    /// The mode after this one when a terminal steps through them.
    pub fn next(self) -> Self {
        match self {
            Self::Worktree => Self::Branch,
            Self::Branch => Self::Current,
            Self::Current => Self::Ask,
            Self::Ask => Self::Worktree,
        }
    }
}

/// A project's settings with every absent value replaced by its default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProjectSettings {
    /// Approve routine agent requests without asking, escalating only
    /// high-risk ones.
    pub auto_approve: bool,
    pub workspace_mode: WorkspaceMode,
    /// Reflect on work in the background and keep learned lessons tidy.
    pub learn_automatically: bool,
    /// Reported tool calls between background reflections of a running task.
    pub learning_cadence: u32,
    /// Include learned lessons in account lesson sync when it is on for this
    /// desktop.
    pub sync_lessons: bool,
    /// Also reflect on finished work with the default agent, which spends that
    /// account's quota.
    pub agent_reflection: bool,
    /// Mirror active learned lessons into the project's AGENTS.md and a Claude
    /// Code skill.
    pub export_lessons: bool,
    /// Take before/after review screenshots of finished work with changes,
    /// once a preview command is saved.
    pub review_captures: bool,
}

impl Default for ProjectSettings {
    fn default() -> Self {
        Self {
            auto_approve: true,
            workspace_mode: WorkspaceMode::Worktree,
            learn_automatically: true,
            learning_cadence: DEFAULT_LEARNING_CADENCE,
            sync_lessons: true,
            agent_reflection: false,
            export_lessons: false,
            review_captures: true,
        }
    }
}

/// Settings as saved or sent: an absent value means the default, and in a
/// change it keeps the saved value.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettingsPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_approve: Option<bool>,
    /// Kept as text so a mode from a newer app cannot make saved data
    /// unreadable; an unknown mode reads as the default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub learn_automatically: Option<bool>,
    /// An out-of-range cadence reads as the default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub learning_cadence: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync_lessons: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_reflection: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub export_lessons: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_captures: Option<bool>,
}

impl ProjectSettingsPatch {
    pub fn resolve(&self) -> ProjectSettings {
        let default = ProjectSettings::default();
        ProjectSettings {
            auto_approve: self.auto_approve.unwrap_or(default.auto_approve),
            workspace_mode: self
                .workspace_mode
                .as_deref()
                .and_then(WorkspaceMode::parse)
                .unwrap_or(default.workspace_mode),
            learn_automatically: self
                .learn_automatically
                .unwrap_or(default.learn_automatically),
            learning_cadence: self
                .learning_cadence
                .filter(|cadence| LEARNING_CADENCES.contains(cadence))
                .unwrap_or(default.learning_cadence),
            sync_lessons: self.sync_lessons.unwrap_or(default.sync_lessons),
            agent_reflection: self.agent_reflection.unwrap_or(default.agent_reflection),
            export_lessons: self.export_lessons.unwrap_or(default.export_lessons),
            review_captures: self.review_captures.unwrap_or(default.review_captures),
        }
    }

    /// Refuses a change that sets a value the settings cannot hold.
    pub fn validate(&self) -> Result<(), String> {
        if let Some(mode) = &self.workspace_mode {
            if WorkspaceMode::parse(mode).is_none() {
                return Err("Choose worktree, branch, current or ask.".into());
            }
        }
        if let Some(cadence) = self.learning_cadence {
            if !LEARNING_CADENCES.contains(&cadence) {
                return Err(format!(
                    "Choose a learning cadence from {} to {} tool calls.",
                    LEARNING_CADENCES.start(),
                    LEARNING_CADENCES.end()
                ));
            }
        }
        Ok(())
    }

    /// Takes every value `change` sets and keeps the rest.
    pub fn apply(&mut self, change: &Self) {
        fn take<T: Clone>(saved: &mut Option<T>, changed: &Option<T>) {
            if changed.is_some() {
                saved.clone_from(changed);
            }
        }
        take(&mut self.auto_approve, &change.auto_approve);
        take(&mut self.workspace_mode, &change.workspace_mode);
        take(&mut self.learn_automatically, &change.learn_automatically);
        take(&mut self.learning_cadence, &change.learning_cadence);
        take(&mut self.sync_lessons, &change.sync_lessons);
        take(&mut self.agent_reflection, &change.agent_reflection);
        take(&mut self.export_lessons, &change.export_lessons);
        take(&mut self.review_captures, &change.review_captures);
    }
}

impl From<ProjectSettings> for ProjectSettingsPatch {
    fn from(settings: ProjectSettings) -> Self {
        Self {
            auto_approve: Some(settings.auto_approve),
            workspace_mode: Some(settings.workspace_mode.as_str().into()),
            learn_automatically: Some(settings.learn_automatically),
            learning_cadence: Some(settings.learning_cadence),
            sync_lessons: Some(settings.sync_lessons),
            agent_reflection: Some(settings.agent_reflection),
            export_lessons: Some(settings.export_lessons),
            review_captures: Some(settings.review_captures),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_and_unusable_values_read_as_the_defaults() {
        assert_eq!(
            ProjectSettingsPatch::default().resolve(),
            ProjectSettings::default()
        );
        let saved = ProjectSettingsPatch {
            workspace_mode: Some("cloud".into()),
            learning_cadence: Some(5),
            auto_approve: Some(false),
            ..Default::default()
        };
        let settings = saved.resolve();
        assert_eq!(settings.workspace_mode, WorkspaceMode::Worktree);
        assert_eq!(settings.learning_cadence, DEFAULT_LEARNING_CADENCE);
        assert!(!settings.auto_approve);
        assert!(saved.validate().is_err());
    }

    #[test]
    fn a_change_overwrites_only_what_it_sets() {
        let mut saved = ProjectSettingsPatch {
            auto_approve: Some(false),
            sync_lessons: Some(false),
            ..Default::default()
        };
        saved.apply(&ProjectSettingsPatch {
            sync_lessons: Some(true),
            review_captures: Some(false),
            ..Default::default()
        });
        assert_eq!(saved.auto_approve, Some(false));
        assert_eq!(saved.sync_lessons, Some(true));
        assert_eq!(saved.review_captures, Some(false));
        assert_eq!(saved.workspace_mode, None);
        let sent = ProjectSettingsPatch::from(saved.resolve());
        assert_eq!(sent.resolve(), saved.resolve());
        assert_eq!(sent.workspace_mode.as_deref(), Some("worktree"));
    }
}
