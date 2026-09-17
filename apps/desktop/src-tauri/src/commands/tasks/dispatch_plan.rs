use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Worker {
    pub objective: String,
    pub context: String,
    pub owned_paths: Vec<String>,
    pub read_only: bool,
    pub estimated_work_ms: u64,
    pub estimated_tokens: u64,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Input {
    pub workers: Vec<Worker>,
    pub constraints: String,
    pub estimated_startup_ms: u64,
    pub estimated_merge_ms: u64,
    pub token_budget: u64,
    pub objective: Objective,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Objective {
    LowerCost,
    Faster,
}

fn scope(path: &str) -> Option<String> {
    let value = path.replace('\\', "/").trim_end_matches('/').to_lowercase();
    (!value.is_empty()
        && value.len() <= 300
        && !value.contains([':', '*', '?'])
        && value
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != ".."))
    .then_some(value)
}

pub(crate) fn assess(input: Input) -> Result<Value, String> {
    if !(2..=3).contains(&input.workers.len())
        || input.constraints.len() > 4_000
        || input.constraints.trim().is_empty()
        || input.token_budget == 0
        || input.token_budget > 1_000_000
        || input.estimated_startup_ms > 3_600_000
        || input.estimated_merge_ms > 3_600_000
    {
        return Err("Supply two or three bounded workers, applicable constraints, explicit estimates and a token admission budget.".into());
    }
    let mut scopes = Vec::new();
    let mut bytes = 0;
    for worker in &input.workers {
        if worker.objective.trim().is_empty()
            || worker.objective.len() > 1000
            || worker.context.len() > 6000
            || worker.owned_paths.is_empty()
            || worker.owned_paths.len() > 16
            || worker.estimated_work_ms == 0
            || worker.estimated_work_ms > 3_600_000
            || worker.estimated_tokens == 0
            || worker.estimated_tokens > 1_000_000
        {
            return Err("Each worker needs a bounded objective/context, explicit scope and positive work/token estimates.".into());
        }
        let paths: Vec<_> = worker
            .owned_paths
            .iter()
            .map(|path| {
                scope(path).ok_or("Use concrete relative owned paths, without traversal or globs.")
            })
            .collect::<Result<_, _>>()?;
        scopes.push(paths);
        bytes += worker.context.len() + worker.objective.len() + input.constraints.len();
    }
    if bytes > 20_000 {
        return Err("Combined worker briefs exceed 20000 bytes; narrow the assignments without omitting applicable constraints.".into());
    }
    let mut reasons = Vec::new();
    for a in 0..scopes.len() {
        for b in (a + 1)..scopes.len() {
            if !(input.workers[a].read_only && input.workers[b].read_only)
                && scopes[a].iter().any(|left| {
                    scopes[b].iter().any(|right| {
                        left == right
                            || left.starts_with(&format!("{right}/"))
                            || right.starts_with(&format!("{left}/"))
                    })
                })
            {
                reasons
                    .push("Worker scopes overlap with a writer; keep these operations sequential.");
            }
        }
    }
    let tokens: u64 = input.workers.iter().map(|w| w.estimated_tokens).sum();
    let serial: u64 = input.workers.iter().map(|w| w.estimated_work_ms).sum();
    let parallel = input
        .workers
        .iter()
        .map(|w| w.estimated_work_ms)
        .max()
        .unwrap()
        + input.estimated_startup_ms
        + input.estimated_merge_ms;
    if tokens > input.token_budget {
        reasons.push("Estimated aggregate worker usage exceeds the admission budget.");
    }
    if parallel.saturating_mul(10) >= serial.saturating_mul(9) {
        reasons.push("Estimated coordination overhead leaves less than a 10% time advantage.");
    }
    if matches!(input.objective, Objective::LowerCost) {
        reasons.push("Parallel work has no demonstrated cost advantage; retain one worker for the lower-cost objective.");
    }
    let admitted = reasons.is_empty();
    let briefs: Vec<_> = if admitted {
        input.workers.iter().map(|worker| json!({
        "objective":worker.objective,"context":worker.context,"ownedPaths":worker.owned_paths,"readOnly":worker.read_only,"constraints":input.constraints,
        "return":"Return outcome, changed file/artifact paths, checks actually run, unresolved issues and relevant source references. Do not repeat shared project-wide checks; the lead verifies the combined result. No recursive delegation. Preserve account/model/workspace and permissions."
    })).collect()
    } else {
        vec![]
    };
    Ok(
        json!({"admitted":admitted,"reasons":reasons,"briefs":briefs,"estimatedSerialMs":serial,"estimatedParallelMs":parallel,"estimatedWorkerTokens":tokens,"briefBytes":bytes,
        "boundary":"Planning aid using agent-supplied estimates, not measured savings or a provider spending cap. Does not launch workers or grant delegation permission. Use only permitted native subagent tools; actual usage may exceed estimates. The lead retains useful independent work and owns combined verification."}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input(paths: [&str; 2]) -> Input {
        serde_json::from_value(json!({"objective":"faster","constraints":"No commits. Respect user scope.","estimatedStartupMs":1000,"estimatedMergeMs":2000,"tokenBudget":10000,
            "workers":paths.map(|path| json!({"objective":"Investigate","context":"Relevant module only","ownedPaths":[path],"readOnly":false,"estimatedWorkMs":60000,"estimatedTokens":4000}))})).unwrap()
    }
    #[test]
    fn overlap_budgets_and_overhead_block_briefs_without_claiming_authority() {
        assert_eq!(assess(input(["src/a", "src/b"])).unwrap()["admitted"], true);
        assert_eq!(assess(input(["SRC", "src/b"])).unwrap()["admitted"], false);
        assert!(assess(input(["../a", "src/b"])).is_err());
        let mut over = input(["src/a", "src/b"]);
        over.token_budget = 5000;
        assert_eq!(assess(over).unwrap()["admitted"], false);
        let mut slow = input(["src/a", "src/b"]);
        slow.estimated_merge_ms = 100000;
        assert_eq!(assess(slow).unwrap()["admitted"], false);
        let mut cheap = input(["src/a", "src/b"]);
        cheap.objective = Objective::LowerCost;
        assert_eq!(assess(cheap).unwrap()["briefs"], json!([]));
    }
}
