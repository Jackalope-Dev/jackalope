use sha2::{Digest, Sha256};

const CORE: &str = "Jackalope task context: Use the assigned workspace; preserve user intent, existing work and repository instructions. Leave changes uncommitted; do not merge, push or delete the workspace. Permission denials prohibit retries or bypasses; continue independent authorized work. Use the supplied question tool for blocking decisions and retrieve the answer. Report the outcome, changed files, checks actually performed and unresolved issues. End with: Commit message: <imperative summary of actual changes>.\n";

pub(super) fn policy_hash() -> String {
    format!("{:x}", Sha256::digest(format!("{CORE}{}{}", super::efficiency::INSTRUCTIONS, super::delegation::INSTRUCTIONS)))
}

pub(super) fn preamble(previous: Option<&super::TaskRun>, adapter: &str) -> String {
    let resumed = matches!(adapter, "codex" | "claude" | "opencode" | "grok")
        && previous.is_some_and(|run| run.session_id.is_some() && run.efficiency.prompt_policy_hash.as_deref() == Some(policy_hash().as_str()));
    let mut text = CORE.to_owned();
    if resumed {
        text.push_str("Continue this native session using its established workflow and evidence. Apply the current task, contract and workspace facts below.\n");
    } else {
        text.push_str(super::efficiency::INSTRUCTIONS);
        text.push_str(super::delegation::INSTRUCTIONS);
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_native_sessions_with_the_same_policy_receive_delta_guidance() {
        let mut old = super::super::TaskRun::default();
        let full = preamble(None, "codex");
        assert_eq!(preamble(Some(&old), "codex"), full);
        old.session_id = Some("native-session".into());
        assert_eq!(preamble(Some(&old), "codex"), full);
        old.efficiency.prompt_policy_hash = Some(policy_hash());
        let delta = preamble(Some(&old), "codex");
        assert!(delta.len() < full.len());
        assert!(delta.contains("Leave changes uncommitted"));
        assert!(delta.contains("Permission denials"));
        assert_eq!(preamble(Some(&old), "kimi"), full);
        old.efficiency.prompt_policy_hash = Some("older-policy".into());
        assert_eq!(preamble(Some(&old), "codex"), full);
    }
}
