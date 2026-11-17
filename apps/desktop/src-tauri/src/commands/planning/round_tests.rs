use super::rounds::{self, Outcome, RoundAssignment, Step, Verdict};
use super::session;
use super::store::{AreaReview, Execution, PlanRecord, Round, RoundCheck};
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
    let prompt = rounds::review_prompt(&doc, &second, &rounds_list, 5, Some("pnpm test"), None);
    assert!(prompt.contains("round 2 of at most 5"));
    assert!(prompt.contains("computer_verify") && prompt.contains("pnpm test"));
    assert!(prompt.contains("Round 1: next — Button missing Next: Add the button."));
    assert!(prompt.contains("was not accepted"));
    assert!(prompt.contains(".jackalope"));
    assert!(prompt.contains("AC-2"));
}

fn saved_plan(execution: serde_json::Value) -> PlanRecord {
    serde_json::from_value(serde_json::json!({
        "id": "plan", "projectId": "p", "projectName": "P", "projectPath": ".",
        "title": "T", "goal": "G", "createdAt": "now", "updatedAt": "now",
        "request": {"id":"r","projectId":"p","projectName":"P","projectPath":".","agent":"codex","prompt":"","isolated":true},
        "execution": execution
    }))
    .unwrap()
}

fn assignment(key: &str, title: &str, scopes: &[&str]) -> RoundAssignment {
    RoundAssignment {
        key: key.into(),
        title: title.into(),
        prompt: format!("Do {title}."),
        scopes: scopes.iter().map(|scope| scope.to_string()).collect(),
        ..Default::default()
    }
}

#[test]
fn a_proposed_round_waits_for_approval_and_survives_restart() {
    let mut round = Round {
        number: 1,
        managed_task_id: "task".into(),
        review_run_ids: vec!["o1".into()],
        handled: vec!["o1".into()],
        proposal: Some(vec![assignment("button", "Add the button", &["src/ui"])]),
        ..Default::default()
    };
    let runs = [run("o1", "review", NEXT)];
    // Nothing reviews or dispatches while the proposal waits, enabled or not.
    assert_eq!(rounds::step(&round, true, true, &runs), Step::Wait);
    assert_eq!(rounds::step(&round, true, false, &runs), Step::Wait);
    // Saved before a restart, the proposal loads back and still waits on the person.
    let saved = saved_plan(serde_json::json!({
        "shape": "swarm", "revision": 1, "managedTaskId": "task", "startedAt": "now",
        "maxRounds": 5, "askBeforeRounds": true,
        "rounds": [serde_json::to_value(&round).unwrap()]
    }));
    assert!(rounds::awaiting(&saved));
    assert!(session::summary(&saved).needs_you);
    let reloaded: PlanRecord =
        serde_json::from_value(serde_json::to_value(&saved).unwrap()).unwrap();
    let execution = reloaded.execution.as_ref().unwrap();
    assert!(execution.ask_before_rounds);
    assert_eq!(
        execution.rounds[0].proposal.as_ref().unwrap()[0].title,
        "Add the button"
    );
    assert_eq!(
        rounds::step(&execution.rounds[0], true, false, &runs),
        Step::Wait
    );
    // Declined, the round reviews again once resumed.
    round.proposal = None;
    assert_eq!(rounds::step(&round, true, true, &runs), Step::Review);
}

#[test]
fn saved_rounds_without_approval_or_areas_start_rounds_automatically() {
    let saved = saved_plan(serde_json::json!({
        "shape": "swarm", "revision": 1, "managedTaskId": "task", "startedAt": "now",
        "maxRounds": 5,
        "rounds": [{"number": 1, "managedTaskId": "task", "startedAt": "now"}]
    }));
    let execution = saved.execution.as_ref().unwrap();
    assert!(!execution.ask_before_rounds);
    assert_eq!(execution.orchestrators, 0);
    assert!(execution.rounds[0].proposal.is_none() && execution.rounds[0].areas.is_empty());
    assert!(!rounds::awaiting(&saved));
}

#[test]
fn approved_assignments_need_work_scopes_and_distinct_keys() {
    let good = [assignment("a", "A", &["src/a"])];
    assert!(rounds::approvable(&good).is_ok());
    assert!(rounds::approvable(&[]).is_err());
    assert!(rounds::approvable(&[assignment("a", "A", &[" "])]).is_err());
    let mut blank = assignment("a", "A", &["src/a"]);
    blank.prompt = " ".into();
    assert!(rounds::approvable(&[blank]).is_err());
    assert!(rounds::approvable(&[
        assignment("a", "A", &["src/a"]),
        assignment("a", "B", &["src/b"])
    ])
    .is_err());
    // Edited assignments go through the same validation as the orchestrator's.
    let doc = sample();
    assert!(rounds::assignments(&doc, 2, &[assignment("p", "Policy", &[".jackalope/x"])]).is_err());
    let edited: RoundAssignment = serde_json::from_value(serde_json::json!({
        "key": "a", "title": "A", "prompt": "Do A.", "scopes": ["src/a"],
        "dependsOn": [], "covers": ["AC-1"], "briefing": ""
    }))
    .unwrap();
    assert_eq!(edited.covers, ["AC-1"]);
}

#[test]
fn large_plans_split_into_balanced_areas_and_small_ones_stay_whole() {
    let doc = sample();
    assert!(rounds::partition(&doc, 1).is_empty());
    let areas = rounds::partition(&doc, 4);
    assert_eq!(areas.len(), 2, "src/csv.ts and src/ui");
    assert!(areas.iter().all(|area| area.scopes.len() == 1));
    let mut wide = sample();
    wide.tasks[0].scopes = vec![
        "apps/desktop/src".into(),
        "apps/desktop/src-tauri".into(),
        "packages/ui".into(),
        "docs".into(),
    ];
    wide.tasks[1].scopes = vec!["apps/server".into(), "./packages/brand/".into()];
    let areas = rounds::partition(&wide, 2);
    assert_eq!(areas.len(), 2);
    let all: Vec<&String> = areas.iter().flat_map(|area| &area.scopes).collect();
    assert_eq!(all.len(), 6, "every scope lands in one area");
    assert!(all.iter().any(|scope| scope.as_str() == "packages/brand"));
    // The same plan splits the same way every time.
    assert_eq!(rounds::partition(&wide, 2), areas);
    let mut single = sample();
    single.tasks[1].scopes = vec!["src/csv.ts".into()];
    assert!(rounds::partition(&single, 4).is_empty());
}

#[test]
fn areas_review_in_parallel_and_wait_for_each_other() {
    let mut round = Round {
        number: 1,
        managed_task_id: "task".into(),
        areas: vec![
            AreaReview {
                name: "src".into(),
                ..Default::default()
            },
            AreaReview {
                name: "docs".into(),
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let runs = [run("a1", "running", ""), run("b1", "review", DONE)];
    assert_eq!(
        rounds::area_steps(&round, true, true, &runs),
        [Step::Review, Step::Review]
    );
    assert_eq!(
        rounds::area_steps(&round, true, false, &runs),
        [Step::Wait, Step::Wait],
        "paused"
    );
    round.areas[0].run_ids.push("a1".into());
    round.areas[1].run_ids.push("b1".into());
    assert_eq!(
        rounds::area_steps(&round, true, true, &runs),
        [Step::Wait, Step::Read("b1".into())]
    );
    round.handled.push("b1".into());
    round.areas[1].verdict = "done".into();
    assert_eq!(
        rounds::area_steps(&round, true, true, &runs),
        [Step::Wait, Step::Wait]
    );
    round.areas[0].run_ids.push("lost".into());
    assert!(matches!(
        rounds::area_steps(&round, true, true, &runs)[0],
        Step::Hold(_)
    ));
}

#[test]
fn area_verdicts_merge_into_one_round_verdict() {
    let doc = sample();
    let check = Some(RoundCheck {
        command: "pnpm test".into(),
        passed: true,
    });
    let done = |name: &str| AreaReview {
        name: name.into(),
        verdict: "done".into(),
        summary: format!("{name} is met."),
        evidence: vec!["AC-1: passes".into()],
        check: check.clone(),
        ..Default::default()
    };
    let both = [done("src"), done("docs")];
    let Outcome::Done {
        summary,
        evidence,
        check: merged_check,
    } = rounds::merge(&doc, 1, &both)
    else {
        panic!("every area done means done");
    };
    assert!(summary.contains("src: src is met.") && summary.contains("docs: docs is met."));
    assert_eq!(evidence, ["src · AC-1: passes", "docs · AC-1: passes"]);
    assert_eq!(merged_check, check);

    let next = |name: &str, items: Vec<RoundAssignment>| AreaReview {
        name: name.into(),
        verdict: "next".into(),
        summary: "More".into(),
        assignments: items,
        ..Default::default()
    };
    let mut parser = assignment("fix", "Fix the parser", &["src/parse"]);
    parser.depends_on = vec!["types".into()];
    let areas = [
        next(
            "src",
            vec![
                assignment("types", "Share the types", &["src/types.ts"]),
                assignment("ui", "Add the button", &["src/ui"]),
            ],
        ),
        done("docs"),
        next(
            "api",
            vec![
                // The same work the src area named runs once.
                assignment("button", "add the button", &["src/ui/"]),
                // A colliding key is renamed, and its own dependencies follow it.
                assignment("types", "API types", &["api/types.ts"]),
                parser,
                // Overlapping scope with earlier work runs after it.
                assignment("form", "Wire the form", &["src/ui/form.tsx"]),
            ],
        ),
    ];
    let merged = rounds::merge_assignments(&areas);
    let keys: Vec<&str> = merged.iter().map(|item| item.key.as_str()).collect();
    assert_eq!(keys, ["types", "ui", "types-3", "fix", "form"]);
    assert_eq!(merged[3].depends_on, ["types-3"]);
    assert_eq!(merged[4].depends_on, ["ui"]);
    assert!(merged[2].depends_on.is_empty());
    let Outcome::Next {
        titles,
        assignments,
        ..
    } = rounds::merge(&doc, 1, &areas)
    else {
        panic!("an area with work left means next");
    };
    assert_eq!(titles.len(), 5);
    let json: serde_json::Value = serde_json::from_str(&assignments).unwrap();
    assert_eq!(json[4]["dependsOn"], serde_json::json!(["ui"]));
    // An area that tries to own the policy fails the merge and reviews again.
    let protected = [next(
        "src",
        vec![assignment("gate", "Edit gates", &[".jackalope/gates"])],
    )];
    assert!(matches!(
        rounds::merge(&doc, 1, &protected),
        Outcome::Retry(_)
    ));
}

#[test]
fn scopes_overlap_when_nested_equal_or_the_root() {
    assert!(rounds::overlaps("src/ui", "src/ui/form.tsx"));
    assert!(rounds::overlaps("./Src/UI/", "src/ui"));
    assert!(rounds::overlaps(".", "docs"));
    assert!(!rounds::overlaps("src/ui", "src/uikit"));
    assert!(!rounds::overlaps("src/a", "src/b"));
}

#[test]
fn an_area_reviewer_is_told_its_scope() {
    let doc = sample();
    let round = Round {
        number: 1,
        ..Default::default()
    };
    let area = AreaReview {
        name: "src/ui".into(),
        scopes: vec!["src/ui".into()],
        note: "Your verdict did not parse.".into(),
        ..Default::default()
    };
    let prompt = rounds::review_prompt(&doc, &round, &[], 5, None, Some(&area));
    assert!(prompt.contains("You review one area of this plan: src/ui (src/ui)"));
    assert!(prompt.contains("Your verdict did not parse."));
    let whole = rounds::review_prompt(&doc, &round, &[], 5, None, None);
    assert!(!whole.contains("one area"));
}
