const CORE: &str = "Jackalope task context: Use the assigned workspace; preserve user intent, existing work and repository instructions. Leave changes uncommitted; do not merge, push or delete the workspace. Permission denials prohibit retries or bypasses; continue independent authorized work. Use the supplied question tool for blocking decisions and retrieve the answer. Report the outcome, changed files, checks actually performed and unresolved issues. End with: Commit message: <imperative summary of actual changes>.\n";

pub(super) const SCOPE_GUIDANCE: &str = "\nSeparate required outcomes from suggested implementation options. Choose the smallest complete change that meets the requirements and preserves existing contracts. Add persistence, new abstractions, dependency changes or unrelated defaults only when the task requires them. Inspect existing regression coverage; do not weaken tests to fit a patch. Read relevant symbols/ranges first, expanding to callers and full files when needed. Select checks that cover the changed behavior and its dependents, plus every user/repository-required check. A necessary early reproduction is useful; repeated unchanged full builds are not. Before finishing, inspect the final diff for scope and compatibility regressions and state any unverified requirements.\n";

pub(super) fn lean_preamble() -> String {
    format!("{CORE}Use supplied context, batch independent reads, and expand investigation when needed. Complete implementation before batching required checks, except when repository instructions or a necessary diagnostic require an earlier check. Recheck changed code or failed checks; preserve successful unchanged evidence. Keep small or coupled tasks with one agent; delegate only permitted independent work whose benefit exceeds coordination and duplicate context costs.\n")
}

pub(super) fn preamble() -> String {
    format!("Jackalope task context: Work in the current workspace. Preserve the user's intent and follow repository instructions. Do not commit, merge, push, or delete the workspace. In your final response explain the outcome, changed files, verification actually performed, and anything unresolved. For clarification use the supplied Jackalope question tool and retrieve the answer. Respect permission denials: do not repeat or bypass the denied action. Continue independent authorized work when useful and report what remains blocked.\n{}{}\nJackalope manages commits and attribution. Leave changes uncommitted. End your result with: Commit message: <imperative summary of the actual changes>.\n", super::efficiency::INSTRUCTIONS, super::delegation::INSTRUCTIONS)
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
