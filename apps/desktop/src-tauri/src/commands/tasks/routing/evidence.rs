use super::*;
use std::collections::BTreeMap;

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
    let mut groups = BTreeMap::<(&str, Option<&str>), (usize, usize, usize)>::new();
    for run in latest
        .values()
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
            .entry((&run.agent, run.model.as_deref()))
            .or_default();
        group.0 += usize::from(accepted);
        group.1 += usize::from(corrections);
        group.2 += 1;
    }
    serde_json::json!({"scope":"Latest loaded task per project/model; historical human decisions, not current-file verification or causal comparisons. Task difficulty differs. Fewer than five decided tasks is insufficient evidence of a specialty. Never infer model ability from brand names.",
        "groups":groups.into_iter().map(|((agent, model),(accepted, corrections,total))| serde_json::json!({"agent":agent,"model":model,"accepted":accepted,"corrections":corrections,"total":total,"decided":accepted+corrections,"sufficientSample":accepted+corrections>=5})).collect::<Vec<_>>()})
}

#[cfg(test)]
mod tests {
    use super::*;
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
