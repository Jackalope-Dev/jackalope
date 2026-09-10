use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TaskEffort {
    Quick,
    Balanced,
    Thorough,
}

impl TaskEffort {
    pub fn level(self) -> &'static str {
        match self {
            Self::Quick => "low",
            Self::Balanced => "medium",
            Self::Thorough => "high",
        }
    }
}

pub(in crate::commands) fn configure(
    command: &mut Command,
    adapter: &str,
    effort: Option<TaskEffort>,
) -> Option<String> {
    let level = effort?.level();
    match adapter {
        "codex" => {
            command.args(["-c", &format!("model_reasoning_effort=\"{level}\"")]);
        }
        "claude" => {
            command.args(["--effort", level]);
        }
        _ => return None,
    }
    Some(level.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_exact_provider_arguments_without_global_configuration() {
        let mut codex = Command::new("fixture");
        configure(&mut codex, "codex", Some(TaskEffort::Thorough));
        assert_eq!(
            codex
                .get_args()
                .map(|s| s.to_string_lossy().into_owned())
                .collect::<Vec<_>>(),
            ["-c", "model_reasoning_effort=\"high\""]
        );
        let mut claude = Command::new("fixture");
        configure(&mut claude, "claude", Some(TaskEffort::Balanced));
        assert_eq!(
            claude
                .get_args()
                .map(|s| s.to_string_lossy().into_owned())
                .collect::<Vec<_>>(),
            ["--effort", "medium"]
        );
    }
    #[test]
    fn effort_is_scoped_to_supported_adapters_and_missing_values_preserve_defaults() {
        for adapter in ["codex", "claude", "kimi", "opencode", "grok", "antigravity"] {
            let mut command = Command::new("fixture");
            assert_eq!(configure(&mut command, adapter, None), None);
            assert_eq!(command.get_args().count(), 0);
            let level = configure(&mut command, adapter, Some(TaskEffort::Quick));
            assert_eq!(level.is_some(), ["codex", "claude"].contains(&adapter));
            assert_eq!(command.get_envs().count(), 0);
        }
        assert!(serde_json::from_str::<TaskEffort>("\"unlimited\"").is_err());
        assert_eq!(TaskEffort::Balanced.level(), "medium");
        assert_eq!(TaskEffort::Thorough.level(), "high");
    }
}
