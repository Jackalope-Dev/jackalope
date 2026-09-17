use sha2::{Digest, Sha256};

const CORE: &str = "Jackalope task context: Use the assigned workspace; preserve user intent, existing work and repository instructions. Leave changes uncommitted; do not merge, push or delete the workspace. Permission denials prohibit retries or bypasses; continue independent authorized work. Use the supplied question tool for blocking decisions and retrieve the answer. Report the outcome, changed files, checks actually performed and unresolved issues. End with: Commit message: <imperative summary of actual changes>.\n";

pub(super) fn policy_hash() -> String {
    Sha256::digest(format!(
        "{}:{}",
        compact_enabled(),
        compact_preamble(None, "")
    ))
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect()
}

pub(super) fn preamble(previous: Option<&super::TaskRun>, adapter: &str) -> String {
    if compact_enabled() {
        compact_preamble(previous, adapter)
    } else {
        format!("Jackalope task context: Work in the current workspace. Preserve the user's intent and follow repository instructions. Do not commit, merge, push, or delete the workspace. In your final response explain the outcome, changed files, verification actually performed, and anything unresolved. For clarification use the supplied Jackalope question tool and retrieve the answer. Respect permission denials: do not repeat or bypass the denied action. Continue independent authorized work when useful and report what remains blocked.\n{}{}\nJackalope manages commits and attribution. Leave changes uncommitted. End your result with: Commit message: <imperative summary of the actual changes>.\n", super::efficiency::INSTRUCTIONS, super::delegation::INSTRUCTIONS)
    }
}

fn compact_enabled() -> bool {
    std::env::var("JACKALOPE_CONTEXT_EXPERIMENT").is_ok_and(|value| value == "compact")
}

fn compact_preamble(previous: Option<&super::TaskRun>, adapter: &str) -> String {
    let resumed = matches!(adapter, "codex" | "claude" | "opencode" | "grok")
        && previous.is_some_and(|run| {
            run.session_id.is_some()
                && run.efficiency.prompt_policy_hash.as_deref() == Some(policy_hash().as_str())
        });
    let mut text = CORE.to_owned();
    if resumed {
        text.push_str("Continue this native session using its established workflow and evidence. Apply the current task, contract and workspace facts below.\n");
    } else {
        text.push_str(super::efficiency::INSTRUCTIONS);
        text.push_str(super::delegation::COMPACT);
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_native_sessions_with_the_same_policy_receive_delta_guidance() {
        let mut old = super::super::TaskRun::default();
        let full = compact_preamble(None, "codex");
        assert_eq!(compact_preamble(Some(&old), "codex"), full);
        old.session_id = Some("native-session".into());
        assert_eq!(compact_preamble(Some(&old), "codex"), full);
        old.efficiency.prompt_policy_hash = Some(policy_hash());
        let delta = compact_preamble(Some(&old), "codex");
        assert!(delta.len() < full.len());
        assert!(delta.contains("Leave changes uncommitted"));
        assert!(delta.contains("Permission denials"));
        assert_eq!(compact_preamble(Some(&old), "kimi"), full);
        old.efficiency.prompt_policy_hash = Some("older-policy".into());
        assert_eq!(compact_preamble(Some(&old), "codex"), full);
    }
}
