use super::*;
use std::collections::BTreeMap;

#[derive(Default)]
struct Group {
    accepted: usize,
    corrections: usize,
    tasks: usize,
    observed: usize,
    tokens: u64,
    attempts: usize,
    dollars: f64,
    cost_observed: usize,
    matched: usize,
    latest: String,
    fresh: usize,
}

fn task_usage(runs: &[&TaskRun]) -> Option<u64> {
    let mut total = 0u64;
    for run in runs {
        let history = run.routing.as_ref();
        let mut usages = Vec::new();
        if history.is_none_or(|h| h.decisions.len() > h.handoffs.len()) {
            usages.push(&run.usage);
        }
        if let Some(h) = history {
            usages.extend(h.attempts.iter().map(|a| &a.usage));
            usages.extend(h.handoffs.iter().map(|a| &a.usage));
            if h.attempts.is_empty() {
                usages.extend(
                    h.decisions
                        .iter()
                        .filter(|d| d.usage.reported)
                        .map(|d| &d.usage),
                );
            }
        }
        for usage in usages {
            if !usage.reported {
                return None;
            }
            total = total
                .saturating_add(usage.input)
                .saturating_add(usage.output);
        }
    }
    Some(total)
}

fn task_cost(runs: &[&TaskRun]) -> Option<f64> {
    let mut total = 0.0;
    for run in runs {
        let history = run.routing.as_ref();
        let mut usages = Vec::new();
        if history.is_none_or(|h| h.decisions.len() > h.handoffs.len()) {
            usages.push(&run.usage);
        }
        if let Some(h) = history {
            usages.extend(h.attempts.iter().map(|a| &a.usage));
            usages.extend(h.handoffs.iter().map(|a| &a.usage));
            if h.attempts.is_empty() {
                usages.extend(
                    h.decisions
                        .iter()
                        .filter(|d| d.usage.reported)
                        .map(|d| &d.usage),
                );
            }
        }
        for usage in usages {
            if !usage.reported {
                return None;
            }
            let dollars = usage
                .estimated_cost_usd
                .filter(|n| n.is_finite() && *n >= 0.0)?;
            total += dollars;
        }
    }
    Some(total)
}

fn success_lower_bound(accepted: usize, decided: usize) -> f64 {
    if decided == 0 {
        return 0.0;
    }
    let n = decided as f64;
    let p = accepted as f64 / n;
    let z = 1.96_f64;
    (p + z * z / (2.0 * n) - z * ((p * (1.0 - p) + z * z / (4.0 * n)) / n).sqrt())
        / (1.0 + z * z / n)
}

fn matched(prompt: &str, request: &str) -> bool {
    let terms = |text: &str| {
        crate::commands::retrieval::terms(text)
            .into_iter()
            .filter(|t| t.len() >= 4)
            .collect::<std::collections::HashSet<_>>()
    };
    let left = terms(prompt);
    let right = terms(request);
    let common = left.intersection(&right).count();
    common >= 3 && common as f64 / left.union(&right).count().max(1) as f64 >= 0.2
}

pub(super) fn evidence(runs: &[TaskRun], request: &RunRequest) -> Value {
    let mut latest = BTreeMap::<&str, &TaskRun>::new();
    for run in runs
        .iter()
        .filter(|r| r.project_id == request.project_id && r.project_path == request.project_path)
    {
        let old = latest.entry(&run.task_id).or_insert(run);
        if (&run.started_at, &run.id) > (&old.started_at, &old.id) {
            *old = run;
        }
    }
    let mut groups = BTreeMap::<(&str, Option<&str>, Option<&str>, Option<&str>), Group>::new();
    for run in latest
        .values()
        .filter(|r| ["review", "reviewed", "failed", "stopped"].contains(&r.status.as_str()))
        .filter(|r| r.routing.as_ref().is_none_or(|h| h.handoffs.is_empty()))
    {
        let requirements: Vec<_> = run
            .contract
            .requirements
            .iter()
            .filter(|r| !r.checkpoint)
            .collect();
        let accepted = !requirements.is_empty()
            && requirements.iter().all(|r| {
                r.receipt.as_ref().is_some_and(|receipt| {
                    receipt.accepted
                        && requirements[0]
                            .receipt
                            .as_ref()
                            .is_some_and(|first| first.tree == receipt.tree)
                })
            });
        let corrections = requirements
            .iter()
            .any(|r| r.receipt.as_ref().is_some_and(|receipt| !receipt.accepted));
        let group = groups
            .entry((
                &run.agent,
                run.model.as_deref(),
                run.account_binding
                    .as_ref()
                    .and_then(|b| b.profile_id.as_deref()),
                run.reasoning_effort.as_deref(),
            ))
            .or_default();
        group.accepted += usize::from(accepted);
        group.corrections += usize::from(corrections);
        group.tasks += 1;
        group.fresh += usize::from(
            chrono::DateTime::parse_from_rfc3339(&run.started_at).is_ok_and(|at| {
                (0..=90).contains(&Utc::now().signed_duration_since(at).num_days())
            }),
        );
        group.matched += usize::from(matched(&run.prompt, &request.prompt));
        if run.started_at > group.latest {
            group.latest = run.started_at.clone();
        }
        let attempts: Vec<_> = runs
            .iter()
            .filter(|r| {
                r.project_id == request.project_id
                    && r.project_path == request.project_path
                    && r.task_id == run.task_id
            })
            .collect();
        group.attempts += attempts.len();
        if let Some(dollars) = task_cost(&attempts) {
            group.dollars += dollars;
            group.cost_observed += 1;
        }
        if let Some(tokens) = task_usage(&attempts) {
            group.tokens = group.tokens.saturating_add(tokens);
            group.observed += 1;
        }
    }
    serde_json::json!({"scope":"Latest loaded task outcome by final agent/model/account/requested effort. Costs include all loaded attempts, routing and quota retries. Historical human decisions are not current-file verification or causal comparisons; difficulty and earlier configurations differ. Unknown effort is the inherited CLI default. Fewer than ten decided tasks is insufficient evidence. Never infer model ability from brand names.",
        "requestedEffort":request.effort.map(|effort|effort.level()),"groups":groups.into_iter().map(|((agent, model, profile, effort),g)| serde_json::json!({"agent":agent,"model":model,"profileId":profile,"reasoningEffort":effort,"accepted":g.accepted,"corrections":g.corrections,"total":g.tasks,"attempts":g.attempts,"usageCoverage":g.observed,"totalTokens":(g.observed==g.tasks).then_some(g.tokens),"tokensPerAcceptedTask":if g.accepted>0 && g.observed==g.tasks {Some(g.tokens as f64/g.accepted as f64)} else {None},"decided":g.accepted+g.corrections,"sufficientSample":g.accepted+g.corrections>=10,"matchedTaskEvidence":g.matched==g.tasks && g.tasks>=10,"freshEvidence":g.fresh==g.tasks,"successLowerBound":success_lower_bound(g.accepted,g.accepted+g.corrections),
            "matchMethod":"Lexical task overlap; observational evidence, not matched trials", "latestObservedAt":g.latest,
            "usdPerAcceptedTask":if g.accepted>0 && g.cost_observed==g.tasks {Some(g.dollars/g.accepted as f64)} else {None}})).collect::<Vec<_>>()})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn costs_include_previous_attempts_and_preserve_missing_usage() {
        let mut first = crate::commands::tasks::tests::sample("codex");
        first.usage = Usage {
            input: 100,
            output: 20,
            reported: true,
            ..Default::default()
        };
        let mut second = first.clone();
        second.usage.input = 50;
        assert_eq!(task_usage(&[&first, &second]), Some(190));
        second.usage.reported = false;
        assert_eq!(task_usage(&[&first, &second]), None);
    }
    #[test]
    fn evidence_never_labels_process_exit_as_acceptance() {
        let mut run = crate::commands::tasks::tests::sample("codex");
        run.status = "review".into();
        let request: RunRequest = serde_json::from_value(serde_json::json!({"id":"request","projectId":run.project_id,"projectName":"Fixture","projectPath":run.project_path,"agent":"auto","prompt":"Work","isolated":true})).unwrap();
        let report = evidence(&[run], &request);
        assert_eq!(report["groups"][0]["accepted"], 0);
        assert_eq!(report["groups"][0]["sufficientSample"], false);
    }
}
