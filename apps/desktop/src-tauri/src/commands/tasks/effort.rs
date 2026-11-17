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

/// Provider levels from least to most thinking.
const LEVELS: [&str; 6] = ["none", "minimal", "low", "medium", "high", "xhigh"];
const ANY: &[&str] = &["none", "low", "medium", "high", "xhigh"];
const ALWAYS_ON: &[&str] = &["low", "medium", "high", "xhigh"];

/// The levels `model` accepts through `adapter`'s effort flag: `None` when
/// unmeasured, so the requested level is sent as before, and empty when the
/// CLI drops the flag for that model.
///
/// Model levels are HarnessRouter's measurements (runner/reasoning.py,
/// Apache-2.0, measured 2026-10-05): a level a model lacks is refused rather
/// than ignored, and Codex rejects an unsupported `model_reasoning_effort`.
/// Claude Code (2.1.282) sends no effort for the older Claude models listed
/// here, whatever `--effort` says.
fn accepted(adapter: &str, model: &str) -> Option<&'static [&'static str]> {
    let model = bare(model);
    match adapter {
        "codex" => {
            if model.starts_with("gpt-6.1-sol") || model.starts_with("gpt-6-astra") {
                return Some(ALWAYS_ON);
            }
            let version = model.strip_prefix("gpt-")?.split('-').next()?;
            ["5.2", "5.3", "5.4", "5.5", "5.6", "6"]
                .contains(&version)
                .then_some(ANY)
        }
        "claude" => {
            let model = model.replace('.', "-");
            let starts = |prefixes: &[&str]| prefixes.iter().any(|p| model.starts_with(p));
            if model.starts_with("claude-3")
                || [
                    "claude-opus-4",
                    "claude-opus-4-0",
                    "claude-opus-4-1",
                    "claude-sonnet-4",
                    "claude-sonnet-4-0",
                    "claude-sonnet-4-5",
                    "claude-haiku-4-5",
                ]
                .contains(&model.as_str())
            {
                Some(&[])
            } else if starts(&["claude-fable-5"]) {
                Some(ALWAYS_ON)
            } else if starts(&[
                "claude-haiku-5-5",
                "claude-sonnet-4-6",
                "claude-opus-4-7",
                "claude-opus-4-8",
                "claude-sonnet-5",
                "claude-opus-5",
            ]) {
                Some(ANY)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// A model ID without its provider path, Bedrock/Vertex decoration, context
/// suffix or release date, lower case.
fn bare(model: &str) -> String {
    let lower = model.trim().to_ascii_lowercase();
    let mut id = lower.rsplit('/').next().unwrap_or_default();
    if let Some(start) = id.find("claude-") {
        id = &id[start..];
    }
    id = id.split(['[', '@', ':']).next().unwrap_or_default();
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if let Some((head, version)) = id.rsplit_once("-v") {
        if digits(version) {
            id = head;
        }
    }
    if let Some((head, date)) = id.rsplit_once('-') {
        if date.len() == 8 && date.starts_with("20") && digits(date) {
            id = head;
        }
    }
    let bytes = id.as_bytes();
    if bytes.len() > 11
        && bytes[bytes.len() - 11..].iter().enumerate().all(|(i, b)| {
            if [0, 5, 8].contains(&i) {
                *b == b'-'
            } else {
                b.is_ascii_digit()
            }
        })
    {
        id = &id[..id.len() - 11];
    }
    id.to_string()
}

/// The accepted level nearest to `asked`. Never turns thinking off for a
/// request that asked for some; ties go to the lower level.
fn nearest(asked: &'static str, have: &[&'static str]) -> Option<&'static str> {
    if have.contains(&asked) {
        return Some(asked);
    }
    let rank = |level: &str| LEVELS.iter().position(|l| *l == level).unwrap_or_default();
    have.iter()
        .copied()
        .filter(|level| *level != "none")
        .min_by_key(|level| (rank(level).abs_diff(rank(asked)), rank(level)))
}

/// Adds the effort flag for `model` and returns the level sent, or `None`
/// when the agent keeps its own default.
pub(in crate::commands) fn configure(
    command: &mut Command,
    adapter: &str,
    model: Option<&str>,
    effort: Option<TaskEffort>,
) -> Option<String> {
    if !matches!(adapter, "codex" | "claude") {
        return None;
    }
    let asked = effort?.level();
    let level = match model.and_then(|model| accepted(adapter, model)) {
        Some(have) => nearest(asked, have)?,
        None => asked,
    };
    if adapter == "codex" {
        command.args(["-c", &format!("model_reasoning_effort=\"{level}\"")]);
    } else {
        command.args(["--effort", level]);
    }
    Some(level.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(
        adapter: &str,
        model: Option<&str>,
        effort: TaskEffort,
    ) -> (Vec<String>, Option<String>) {
        let mut command = Command::new("fixture");
        let level = configure(&mut command, adapter, model, Some(effort));
        let args = command
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        (args, level)
    }

    #[test]
    fn builds_exact_provider_arguments_without_global_configuration() {
        assert_eq!(
            args("codex", None, TaskEffort::Thorough).0,
            ["-c", "model_reasoning_effort=\"high\""]
        );
        assert_eq!(
            args("claude", None, TaskEffort::Balanced).0,
            ["--effort", "medium"]
        );
    }

    #[test]
    fn effort_is_scoped_to_supported_adapters_and_missing_values_preserve_defaults() {
        for adapter in crate::commands::agents::all()
            .iter()
            .map(|agent| agent.id.as_str())
        {
            let mut command = Command::new("fixture");
            assert_eq!(configure(&mut command, adapter, None, None), None);
            assert_eq!(command.get_args().count(), 0);
            let level = configure(&mut command, adapter, None, Some(TaskEffort::Quick));
            assert_eq!(level.is_some(), ["codex", "claude"].contains(&adapter));
            assert_eq!(command.get_envs().count(), 0);
        }
        assert_eq!(args("gemini", None, TaskEffort::Thorough), (vec![], None));
        assert!(serde_json::from_str::<TaskEffort>("\"unlimited\"").is_err());
    }

    #[test]
    fn a_model_that_ignores_the_flag_gets_nothing_and_records_the_default() {
        for model in [
            "claude-haiku-4-5",
            "claude-haiku-4-5-20251001",
            "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
            "claude-opus-4-1@20250805",
            "claude-3-7-sonnet-latest",
        ] {
            assert_eq!(
                args("claude", Some(model), TaskEffort::Thorough),
                (vec![], None),
                "{model}"
            );
        }
    }

    #[test]
    fn measured_models_receive_the_requested_level_and_unmeasured_ones_are_unchanged() {
        for (adapter, model) in [
            ("codex", "gpt-6.1-sol"),
            ("codex", "openai/gpt-5.4-2026-03-05"),
            ("claude", "claude-opus-5-5[1m]"),
            ("claude", "claude-fable-5"),
            ("codex", "gpt-6.1-terra"),
            ("claude", "opus"),
        ] {
            for effort in [
                TaskEffort::Quick,
                TaskEffort::Balanced,
                TaskEffort::Thorough,
            ] {
                assert_eq!(
                    args(adapter, Some(model), effort).1.as_deref(),
                    Some(effort.level()),
                    "{model}"
                );
            }
        }
    }

    #[test]
    fn a_missing_level_clamps_to_the_nearest_without_turning_thinking_off() {
        assert_eq!(nearest("medium", &["none", "high"]), Some("high"));
        assert_eq!(nearest("low", &["none", "high"]), Some("high"));
        assert_eq!(nearest("medium", &["low", "high"]), Some("low"));
        assert_eq!(
            nearest("low", &["minimal", "medium", "high"]),
            Some("minimal")
        );
        assert_eq!(nearest("high", &["low", "medium", "high"]), Some("high"));
        assert_eq!(nearest("low", &["none"]), None);
        assert_eq!(nearest("low", &[]), None);
    }
}
