use super::rounds::{self, Outcome, Step, Verdict};
use super::store::{Execution, PlanRecord, Round};
use super::tests::sample;
use crate::commands::tasks::TaskRun;

fn run(id: &str, status: &str, result: &str) -> TaskRun {
    TaskRun {
        id: id.into(),
        status: status.into(),
        result: result.into(),
        ..Default::default()
    }
}

fn checked(mut run: TaskRun, command: &str, success: bool) -> TaskRun {
    run.verification = Some(
        serde_json::from_value(serde_json::json!({
            "command": command, "checkedAt": "now", "tree": "tree",
            "result": {"exitCode": if success { 0 } else { 1 }, "success": success, "timedOut": false,
                "stdout": "", "stderr": "", "truncated": false, "durationMs": 1}
        }))
        .unwrap(),
    );
    run
}

const DONE: &str = r#"{"verdict":"done","summary":"All met.","evidence":["AC-1: tests pass","AC-2: button downloads"]}"#;
const NEXT: &str = r#"Reviewed.
```json
{"verdict":"next","summary":"The button is missing.","evidence":["AC-1: passes"],"assignments":[{"key":"button","title":"Add the button","prompt":"Add the export button.","scopes":["src/ui"],"covers":["AC-2","AC-9"]}]}
```"#;

#[test]
fn verdicts_parse_done_and_next_and_reject_incomplete_answers() {
    assert!(matches!(
        rounds::parse_verdict(DONE).unwrap(),
        Verdict::Done { evidence, .. } if evidence.len() == 2
    ));
    let Verdict::Next { assignments, .. } = rounds::parse_verdict(NEXT).unwrap() else {
        panic!("a fenced next verdict after prose parses");
    };
    assert_eq!(assignments[0].key, "button");
    for bad in [
        "no json here",
        r#"{"verdict":"done","summary":"Trust me"}"#,
        r#"{"verdict":"next","summary":"More","assignments":[]}"#,
        r#"{"verdict":"maybe","evidence":["x"]}"#,
        r#"{"verdict":"next","assignments":[{"key":"a","title":"A","prompt":"P","scopes":["s"],"owner":"me"}]}"#,
    ] {
        assert!(rounds::parse_verdict(bad).is_err(), "{bad}");
    }
}

#[test]
fn next_assignments_keep_criteria_and_never_own_the_policy() {
    let doc = sample();
    let Verdict::Next { assignments, .. } = rounds::parse_verdict(NEXT).unwrap() else {
        unreachable!()
    };
    let json: serde_json::Value =
        serde_json::from_str(&rounds::assignments(&doc, 2, &assignments).unwrap()).unwrap();
    assert_eq!(
        json[0]["outcomes"],
        serde_json::json!(["AC-2: The button downloads a file"])
    );
    assert!(json[0]["prompt"]
        .as_str()
        .unwrap()
        .starts_with("Swarm round 2:"));
    let mut protected = assignments.clone();
    protected[0].scopes = vec![".jackalope/autonomy.json".into()];
    assert!(rounds::assignments(&doc, 2, &protected).is_err());
    protected[0].scopes = vec!["./.Jackalope".into()];
    assert!(rounds::assignments(&doc, 2, &protected).is_err());
    // Without known criteria an assignment gets no requirements, not every criterion.
    let mut bare = assignments;
    bare[0].covers.clear();
    let json: serde_json::Value =
        serde_json::from_str(&rounds::assignments(&doc, 2, &bare).unwrap()).unwrap();
    assert_eq!(json[0]["outcomes"], serde_json::json!([]));
}

#[test]
fn done_stands_only_with_a_passing_check_on_the_integrated_tree() {
    let doc = sample();
    assert!(matches!(
        rounds::decide(&doc, 1, &run("r", "review", DONE), None),
        Outcome::Done { check: None, .. }
    ));
    let check = Some("pnpm test");
    let unchecked = rounds::decide(&doc, 1, &run("r", "review", DONE), check);
    assert!(matches!(unchecked, Outcome::Retry(reason) if reason.contains("computer_verify")));
    let failed = rounds::decide(
        &doc,
        1,
        &checked(run("r", "review", DONE), "pnpm test", false),
        check,
    );
    assert!(matches!(failed, Outcome::Retry(reason) if reason.contains("check failed")));
    let other = rounds::decide(
        &doc,
        1,
        &checked(run("r", "review", DONE), "other", true),
        check,
    );
    assert!(matches!(other, Outcome::Retry(_)));
    let passed = rounds::decide(
        &doc,
        1,
        &checked(run("r", "review", DONE), "pnpm test", true),
        check,
    );
    assert!(matches!(passed, Outcome::Done { check: Some(check), .. } if check.passed));
    let next = rounds::decide(&doc, 1, &run("r", "reviewed", NEXT), check);
    assert!(matches!(next, Outcome::Next { titles, .. } if titles == ["Add the button"]));
    let mut crashed = run("r", "review", DONE);
    crashed.error = Some("boom".into());
    assert!(matches!(
        rounds::decide(&doc, 1, &crashed, None),
        Outcome::Retry(_)
    ));
    assert!(matches!(
        rounds::decide(&doc, 1, &run("r", "interrupted", ""), None),
        Outcome::Retry(_)
    ));
}

#[test]
fn rounds_review_only_after_merge_while_enabled_and_read_each_attempt_once() {
    let mut round = Round {
        number: 1,
        managed_task_id: "task".into(),
        ..Default::default()
    };
    let runs = [run("a", "running", ""), run("b", "review", DONE)];
    assert_eq!(
        rounds::step(&round, false, true, &runs),
        Step::Wait,
        "work still runs"
    );
    assert_eq!(
        rounds::step(&round, true, false, &runs),
        Step::Wait,
        "paused"
    );
    assert_eq!(rounds::step(&round, true, true, &runs), Step::Review);
    round.review_run_ids.push("a".into());
    assert_eq!(
        rounds::step(&round, true, true, &runs),
        Step::Wait,
        "reviewing"
    );
    round.review_run_ids.push("b".into());
    assert_eq!(
        rounds::step(&round, true, true, &runs),
        Step::Read("b".into())
    );
    round.handled.push("b".into());
    assert_eq!(
        rounds::step(&round, true, true, &runs),
        Step::Review,
        "retry"
    );
    round.held = Some("Needs you".into());
    assert_eq!(rounds::step(&round, true, true, &runs), Step::Wait);
    round.held = None;
    round.review_run_ids.push("lost".into());
    assert!(matches!(
        rounds::step(&round, true, true, &runs),
        Step::Hold(_)
    ));
    round.verdict = "done".into();
    assert_eq!(rounds::step(&round, true, true, &runs), Step::Wait);
}

#[test]
fn saved_executions_without_rounds_load_unchanged_and_rounds_survive_restart() {
    let record = |execution: serde_json::Value| -> PlanRecord {
        serde_json::from_value(serde_json::json!({
            "id": "plan", "projectId": "p", "projectName": "P", "projectPath": ".",
            "title": "T", "goal": "G", "createdAt": "now", "updatedAt": "now",
            "request": {"id":"r","projectId":"p","projectName":"P","projectPath":".","agent":"codex","prompt":"","isolated":true},
            "execution": execution
        }))
        .unwrap()
    };
    let legacy = record(serde_json::json!({
        "shape": "swarm", "revision": 1, "managedTaskId": "task", "startedAt": "now"
    }));
    assert!(
        !rounds::in_rounds(&legacy),
        "earlier swarms finish when their result merges"
    );
    let saved = record(serde_json::json!({
        "shape": "swarm", "revision": 1, "managedTaskId": "task-2", "startedAt": "now",
        "maxRounds": 5,
        "rounds": [
            {"number": 1, "managedTaskId": "task", "startedAt": "now", "reviewRunIds": ["o1"],
             "handled": ["o1"], "verdict": "next", "summary": "More", "next": ["Fix"]},
            {"number": 2, "managedTaskId": "task-2", "startedAt": "now", "reviewRunIds": ["o2"]}
        ]
    }));
    assert!(rounds::in_rounds(&saved));
    let execution: &Execution = saved.execution.as_ref().unwrap();
    let current = execution.rounds.last().unwrap();
    // After a restart dispatch is off: an interrupted review waits for resume,
    // then its result is read once and the round is reviewed again.
    let interrupted = [run("o2", "interrupted", "")];
    assert_eq!(rounds::step(current, true, false, &interrupted), Step::Wait);
    assert_eq!(
        rounds::step(current, true, true, &interrupted),
        Step::Read("o2".into())
    );
    let value = serde_json::to_value(&saved).unwrap();
    let reloaded: PlanRecord = serde_json::from_value(value).unwrap();
    assert_eq!(reloaded.execution.unwrap().rounds[0].next, ["Fix"]);
}

#[test]
fn the_orchestrator_brief_names_the_round_limit_check_and_earlier_verdicts() {
    let doc = sample();
    let first = Round {
        number: 1,
        verdict: "next".into(),
        summary: "Button missing".into(),
        next: vec!["Add the button".into()],
        ..Default::default()
    };
    let second = Round {
        number: 2,
        note: "You declared done without running the project's check.".into(),
        ..Default::default()
    };
    let rounds_list = [first, second.clone()];
    let prompt = rounds::review_prompt(&doc, &second, &rounds_list, 5, Some("pnpm test"));
    assert!(prompt.contains("round 2 of at most 5"));
    assert!(prompt.contains("computer_verify") && prompt.contains("pnpm test"));
    assert!(prompt.contains("Round 1: next — Button missing Next: Add the button."));
    assert!(prompt.contains("was not accepted"));
    assert!(prompt.contains(".jackalope"));
    assert!(prompt.contains("AC-2"));
}
