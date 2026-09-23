use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CodexSpeed {
    Standard,
    Fast,
}

pub(in crate::commands) fn configure(
    command: &mut Command,
    adapter: &str,
    speed: Option<CodexSpeed>,
) -> Option<String> {
    if adapter != "codex" {
        return None;
    }
    let tier = match speed? {
        CodexSpeed::Standard => "default",
        CodexSpeed::Fast => "fast",
    };
    command.args(["-c", &format!("service_tier=\"{tier}\"")]);
    command.args([
        "-c",
        &format!("features.fast_mode={}", speed == Some(CodexSpeed::Fast)),
    ]);
    Some(tier.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_history_stays_unknown_and_summaries_preserve_explicit_speed() {
        let mut saved = serde_json::to_value(super::super::tests::sample("codex")).unwrap();
        saved.as_object_mut().unwrap().remove("codexSpeed");
        saved
            .as_object_mut()
            .unwrap()
            .remove("requestedServiceTier");
        let mut run: super::super::TaskRun = serde_json::from_value(saved).unwrap();
        assert_eq!(run.codex_speed, None);
        assert_eq!(run.requested_service_tier, None);
        run.codex_speed = Some(CodexSpeed::Fast);
        run.requested_service_tier = Some("fast".into());
        let summary = run.summary();
        assert_eq!(summary.codex_speed, run.codex_speed);
        assert_eq!(summary.requested_service_tier, run.requested_service_tier);
        let metrics: super::super::efficiency::Efficiency = serde_json::from_str("{}").unwrap();
        assert_eq!(metrics.verification_reuses, None);
    }

    #[test]
    fn speed_is_explicit_and_does_not_change_model_or_effort() {
        for (adapter, speed, expected) in [
            ("codex", None, None),
            ("claude", Some(CodexSpeed::Fast), None),
            ("codex", Some(CodexSpeed::Standard), Some("default")),
            ("codex", Some(CodexSpeed::Fast), Some("fast")),
        ] {
            let mut command = Command::new("fixture");
            assert_eq!(configure(&mut command, adapter, speed).as_deref(), expected);
            let args: Vec<_> = command
                .get_args()
                .map(|arg| arg.to_string_lossy())
                .collect();
            if let Some(tier) = expected {
                assert!(args.contains(&format!("service_tier=\"{tier}\"").into()));
                assert!(!args.iter().any(|arg| arg.contains("model")));
                assert_eq!(
                    args.iter().any(|arg| arg == "features.fast_mode=true"),
                    tier == "fast"
                );
            } else {
                assert!(args.is_empty());
            }
        }
    }
}
