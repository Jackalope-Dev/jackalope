use sha2::{Digest, Sha256};

const CORE: &str = "Jackalope task context: Use the assigned workspace; preserve user intent, existing work and repository instructions. Leave changes uncommitted; do not merge, push or delete the workspace. Permission denials prohibit retries or bypasses; continue independent authorized work. Use the supplied question tool for blocking decisions and retrieve the answer. Report the outcome, changed files, checks actually performed and unresolved issues. End with: Commit message: <imperative summary of actual changes>.\n";

pub(super) fn policy_hash() -> String {
    Sha256::digest(format!(
        "{}:{}:{}",
        crate::commands::experiments::fingerprint(),
        compact_preamble(None, ""),
        lean_preamble()
    ))
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect()
}

pub(super) fn lean_preamble() -> String {
    format!("{CORE}Use supplied context, batch independent reads, and expand investigation when needed. Complete implementation before batching required checks, except when repository instructions or a necessary diagnostic require an earlier check. Recheck changed code or failed checks; preserve successful unchanged evidence. Keep small or coupled tasks with one agent; delegate only permitted independent work whose benefit exceeds coordination and duplicate context costs.\n")
}

pub(super) fn preamble(previous: Option<&super::TaskRun>, adapter: &str) -> String {
    if reuse_enabled() && can_reuse(previous, adapter, &policy_hash()) {
        return format!("{CORE}Continue this native session using its established workflow and evidence. Apply the current task, contract and workspace facts below.\n");
    }
    if compact_enabled() {
        compact_preamble(previous, adapter)
    } else {
        format!("Jackalope task context: Work in the current workspace. Preserve the user's intent and follow repository instructions. Do not commit, merge, push, or delete the workspace. In your final response explain the outcome, changed files, verification actually performed, and anything unresolved. For clarification use the supplied Jackalope question tool and retrieve the answer. Respect permission denials: do not repeat or bypass the denied action. Continue independent authorized work when useful and report what remains blocked.\n{}{}\nJackalope manages commits and attribution. Leave changes uncommitted. End your result with: Commit message: <imperative summary of the actual changes>.\n", super::efficiency::INSTRUCTIONS, super::delegation::INSTRUCTIONS)
    }
}

fn compact_enabled() -> bool {
    crate::commands::experiments::is("JACKALOPE_CONTEXT_EXPERIMENT", "compact")
}

fn reuse_enabled() -> bool {
    crate::commands::experiments::is("JACKALOPE_CONTEXT_REUSE", "on")
}

fn can_reuse(previous: Option<&super::TaskRun>, adapter: &str, policy: &str) -> bool {
    matches!(adapter, "codex" | "claude" | "opencode" | "grok")
        && previous.is_some_and(|run| {
            run.session_id.is_some() && run.efficiency.prompt_policy_hash.as_deref() == Some(policy)
        })
}

fn compact_preamble(previous: Option<&super::TaskRun>, adapter: &str) -> String {
    let resumed = previous.is_some() && can_reuse(previous, adapter, &policy_hash());
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
    fn initial_tools_require_a_complete_small_successful_catalog() {
        let mut catalog = serde_json::json!({"tools":[{"tool":{"name":"read"},"handle":"a"}],"total":1,"errors":[],"nextOffset":null});
        assert!(small_tool_catalog(&catalog).is_some());
        catalog["total"] = serde_json::json!(2);
        assert!(small_tool_catalog(&catalog).is_none());
        catalog["total"] = serde_json::json!(1);
        catalog["errors"] = serde_json::json!([{"server":"failed"}]);
        assert!(small_tool_catalog(&catalog).is_none());
        catalog["errors"] = serde_json::json!([]);
        catalog["tools"][0]["description"] = serde_json::json!("x".repeat(6000));
        assert!(small_tool_catalog(&catalog).is_none());
    }

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
pub(super) fn small_tool_catalog(catalog: &serde_json::Value) -> Option<String> {
    let tools = catalog["tools"].as_array()?;
    if tools.is_empty()
        || tools.len() > 4
        || catalog["total"].as_u64()? != tools.len() as u64
        || !catalog["errors"].as_array()?.is_empty()
        || !catalog["nextOffset"].is_null()
    {
        return None;
    }
    let text = serde_json::to_string(tools).ok()?;
    (text.len() <= 6000).then_some(text)
}
