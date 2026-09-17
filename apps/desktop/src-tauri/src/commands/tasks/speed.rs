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
    if speed == Some(CodexSpeed::Fast) {
        command.args(["-c", "features.fast_mode=true"]);
    }
    Some(tier.into())
}

#[cfg(test)]
mod tests {
    use super::*;

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
