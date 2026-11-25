//! Per-project time limits for setup commands and checks.

use serde::{Deserialize, Serialize};
use std::{ops::RangeInclusive, path::Path, time::Duration};

use super::{CHECK_STALL_SECS, CHECK_TIMEOUT_SECS, PREPARE_STALL_SECS};
use crate::commands::process_control;

/// Accepted silence budgets. Values outside a range are clamped to it.
pub(in crate::commands) const SILENCE_SECS: RangeInclusive<u64> = 60..=3600;
/// Accepted ceilings on one setup command or check.
pub(in crate::commands) const CEILING_SECS: RangeInclusive<u64> = 300..=MAX_CHECK_TIMEOUT_SECS;
pub(in crate::commands) const MAX_CHECK_TIMEOUT_SECS: u64 = 7200;

/// Optional overrides from Project settings; an absent value keeps the default.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeLimits {
    /// How long a setup command may print nothing before it is stopped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prepare_silence_secs: Option<u64>,
    /// How long a check may print nothing before it is stopped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check_silence_secs: Option<u64>,
    /// The longest a setup command or check may run in total.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check_ceiling_secs: Option<u64>,
}

impl TimeLimits {
    /// Larger budgets suggested for Xcode projects, whose builds compile packages and
    /// boot simulators in long silent stretches.
    pub const XCODE: Self = Self {
        prepare_silence_secs: Some(900),
        check_silence_secs: Some(1200),
        check_ceiling_secs: Some(3600),
    };

    pub fn prepare_silence(&self) -> u64 {
        clamp(self.prepare_silence_secs, PREPARE_STALL_SECS, &SILENCE_SECS)
    }

    pub fn check_silence(&self) -> u64 {
        clamp(self.check_silence_secs, CHECK_STALL_SECS, &SILENCE_SECS)
    }

    pub fn ceiling(&self) -> u64 {
        clamp(self.check_ceiling_secs, CHECK_TIMEOUT_SECS, &CEILING_SECS)
    }

    /// Supervision limits for a setup command (`setup`) or a check.
    pub(in crate::commands) fn limits(&self, setup: bool) -> process_control::Limits {
        process_control::Limits::supervised(
            Duration::from_secs(self.ceiling()),
            Duration::from_secs(if setup {
                self.prepare_silence()
            } else {
                self.check_silence()
            }),
        )
    }
}

fn clamp(value: Option<u64>, default: u64, range: &RangeInclusive<u64>) -> u64 {
    value.map_or(default, |value| value.clamp(*range.start(), *range.end()))
}

/// Whether `path` holds an Xcode project or workspace at its top level or one folder down.
pub(in crate::commands) fn xcode_project(path: &Path) -> bool {
    let is_xcode = |entry: &std::fs::DirEntry| {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        (name.ends_with(".xcodeproj") || name.ends_with(".xcworkspace"))
            && entry.file_type().is_ok_and(|kind| kind.is_dir())
    };
    let Ok(entries) = std::fs::read_dir(path) else {
        return false;
    };
    let mut folders = Vec::new();
    for entry in entries.flatten() {
        if is_xcode(&entry) {
            return true;
        }
        let name = entry.file_name();
        if entry.file_type().is_ok_and(|kind| kind.is_dir())
            && !name.to_string_lossy().starts_with('.')
            && !["node_modules", "Pods", "Carthage", "build", "DerivedData"]
                .contains(&name.to_string_lossy().as_ref())
        {
            folders.push(entry.path());
        }
    }
    folders.into_iter().take(64).any(|folder| {
        std::fs::read_dir(folder)
            .is_ok_and(|entries| entries.flatten().any(|entry| is_xcode(&entry)))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_limits_keep_the_defaults_and_saved_ones_are_clamped() {
        let defaults = TimeLimits::default();
        assert_eq!(defaults.prepare_silence(), PREPARE_STALL_SECS);
        assert_eq!(defaults.check_silence(), CHECK_STALL_SECS);
        assert_eq!(defaults.ceiling(), CHECK_TIMEOUT_SECS);
        let saved = TimeLimits {
            prepare_silence_secs: Some(5),
            check_silence_secs: Some(1200),
            check_ceiling_secs: Some(1_000_000),
        };
        assert_eq!(saved.prepare_silence(), 60);
        assert_eq!(saved.check_silence(), 1200);
        assert_eq!(saved.ceiling(), MAX_CHECK_TIMEOUT_SECS);
        assert!(
            super::super::BRIDGE_TIMEOUT_SECS > saved.ceiling() + super::super::QUEUE_TIMEOUT_SECS
        );
        for limits in [TimeLimits::XCODE, defaults] {
            assert!(SILENCE_SECS.contains(&limits.prepare_silence()));
            assert!(SILENCE_SECS.contains(&limits.check_silence()));
            assert!(CEILING_SECS.contains(&limits.ceiling()));
        }
    }

    #[test]
    fn saved_limits_round_trip_and_older_records_read_as_defaults() {
        assert_eq!(
            serde_json::from_str::<TimeLimits>("{}").unwrap(),
            TimeLimits::default()
        );
        assert_eq!(serde_json::to_string(&TimeLimits::default()).unwrap(), "{}");
        let text = serde_json::to_string(&TimeLimits::XCODE).unwrap();
        assert_eq!(
            text,
            r#"{"prepareSilenceSecs":900,"checkSilenceSecs":1200,"checkCeilingSecs":3600}"#
        );
        assert_eq!(
            serde_json::from_str::<TimeLimits>(&text).unwrap(),
            TimeLimits::XCODE
        );
    }

    #[test]
    fn xcode_projects_are_found_at_the_top_or_one_folder_down() {
        let root = std::env::temp_dir().join(format!("jackalope-limits-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("ios")).unwrap();
        assert!(!xcode_project(&root));
        std::fs::write(root.join("Fake.xcodeproj"), "").unwrap();
        assert!(
            !xcode_project(&root),
            "a file with the extension is not a project"
        );
        std::fs::create_dir(root.join("ios/App.xcworkspace")).unwrap();
        assert!(xcode_project(&root));
        std::fs::remove_dir_all(root).unwrap();
    }
}
