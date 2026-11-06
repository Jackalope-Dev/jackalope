use super::*;
use crate::commands::coordination::planned::PlanItem;

fn settings(questions: bool, rounds: bool, deviations: bool) -> DecideSettings {
    DecideSettings {
        questions,
        rounds,
        deviations,
        ..Default::default()
    }
}

fn policy(json: &str) -> Result<Option<autonomy::AutonomyPolicy>, String> {
    autonomy::AutonomyPolicy::parse(json.as_bytes()).map(Some)
}

#[test]
fn nothing_is_decided_by_agents_until_the_project_turns_it_on() {
    let off = effective(&DecideSettings::default(), Ok(None));
    assert!(!off.questions && !off.rounds && !off.deviations);
    assert_eq!(off.max, planning::store::DEFAULT_MAX_DECISIONS);
    assert_eq!(off.decider, "auto");
    assert_eq!(off.escalate, question_risk::ALWAYS_ESCALATED.to_vec());
    // A committed policy cannot turn anything on by itself.
    let committed = effective(
        &DecideSettings::default(),
        policy(
            r#"{"version":1,"decide":{"questions":"agent","rounds":"agent","deviations":"agent"}}"#,
        ),
    );
    assert!(!committed.questions && !committed.rounds && !committed.deviations);
}

#[test]
fn the_committed_policy_only_makes_the_project_setting_stricter() {
    let on = settings(true, true, true);
    let unchanged = effective(&on, Ok(None));
    assert!(unchanged.questions && unchanged.rounds && unchanged.deviations);
    let silent = effective(&on, policy(r#"{"version":1}"#));
    assert!(silent.questions && silent.rounds && silent.deviations);
    let strict = effective(
        &on,
        policy(
            r#"{"version":1,"protected":["migrations/**"],"decide":{"rounds":"person","escalate":["payment"],"maxAgentDecisions":5,"decider":"codex"}}"#,
        ),
    );
    assert!(strict.questions && !strict.rounds && strict.deviations);
    assert_eq!(strict.max, 5);
    assert_eq!(strict.decider, "codex");
    assert!(strict.protected.contains(&"migrations/**".to_string()));
    assert!(strict.protected.contains(&".jackalope/**".to_string()));
    // Escalated categories are a union; the defaults cannot be removed.
    assert_eq!(strict.escalate.len(), question_risk::ALWAYS_ESCALATED.len());
    // A higher committed limit does not raise the project's.
    let generous = effective(
        &DecideSettings {
            max_agent_decisions: 10,
            ..on.clone()
        },
        policy(r#"{"version":1,"decide":{"maxAgentDecisions":400}}"#),
    );
    assert_eq!(generous.max, 10);
}

#[test]
fn an_unreadable_policy_stops_every_agent_decision() {
    let blocked = effective(
        &settings(true, true, true),
        Err("autonomy.json could not be read.".into()),
    );
    assert!(!blocked.questions && !blocked.rounds && !blocked.deviations);
    assert!(blocked.blocked.unwrap().contains("could not be read"));
}

#[test]
fn auto_prefers_another_model_family_and_named_deciders_must_be_installed() {
    let all = vec![
        "codex".to_string(),
        "claude".to_string(),
        "grok".to_string(),
    ];
    assert_eq!(pick("auto", "claude", &all).as_deref(), Some("codex"));
    assert_eq!(pick("auto", "codex", &all).as_deref(), Some("claude"));
    assert_eq!(pick("auto", "grok", &all).as_deref(), Some("claude"));
    // With only the asker's family installed, that agent still decides.
    assert_eq!(
        pick("auto", "claude", &["claude".to_string()]).as_deref(),
        Some("claude")
    );
    assert_eq!(pick("auto", "claude", &[]), None);
    assert_eq!(pick("grok", "claude", &all).as_deref(), Some("grok"));
    assert_eq!(pick("kimi", "claude", &all), None);
}

#[test]
fn replies_parse_from_prose_and_fences_with_bounded_fields() {
    let reply = parse_reply(
        "Here is my decision:\n```json\n{\"decision\":\"answer\",\"answer\":\"Card grid\",\"rationale\":\"The plan's UX section asks for cards.\",\"confidence\":0.86,\"evidence\":[\"plan: Approach\", 3]}\n```",
    )
    .unwrap();
    assert!(reply.answer);
    assert_eq!(reply.text, "Card grid");
    assert_eq!(reply.confidence, 0.86);
    assert_eq!(
        reply.evidence,
        vec!["plan: Approach".to_string(), "3".to_string()]
    );
    let percent = parse_reply(
        r#"{"decision":"escalate","rationale":"Needs a product call","confidence":"85%"}"#,
    )
    .unwrap();
    assert!(!percent.answer);
    assert_eq!(percent.confidence, 0.85);
    let array =
        parse_reply(r#"{"decision":"answer","answer":["A","B"],"confidence":0.9}"#).unwrap();
    assert_eq!(array.text, r#"["A","B"]"#);
    for bad in [
        "no json here",
        r#"{"decision":"maybe","confidence":0.9}"#,
        r#"{"decision":"answer","answer":"x"}"#,
        r#"{"decision":"answer","answer":"x","confidence":7}"#,
        r#"{"decision":"answer","answer":"x","confidence":-0.1}"#,
        "{not json}",
    ] {
        assert!(parse_reply(bad).is_err(), "{bad}");
    }
    let huge = format!(
        r#"{{"decision":"answer","answer":"{}","confidence":0.9}}"#,
        "x".repeat(MAX_REPLY_BYTES)
    );
    assert!(parse_reply(&huge).is_err());
}

fn question(input_type: &str, options: &[&str], allow_other: Option<bool>) -> PendingUserPrompt {
    serde_json::from_value(serde_json::json!({
        "id": "q", "runId": "r", "question": "Which layout?", "inputType": input_type,
        "options": options, "status": "deciding", "answer": null, "createdAt": "now",
        "answeredAt": null, "allowOther": allow_other
    }))
    .unwrap()
}

fn reply(decision: &str, answer: &str, confidence: f64) -> Result<Reply, String> {
    Ok(Reply {
        answer: decision == "answer",
        text: answer.into(),
        rationale: "Because the plan says so.".into(),
        confidence,
        evidence: vec![],
    })
}

#[test]
fn only_confident_answers_that_fit_the_question_stand() {
    let choice = question("choice", &["Table", "Card grid"], Some(false));
    assert_eq!(
        judge(reply("answer", "card grid", 0.7), Some(&choice)),
        Verdict::Answer {
            answer: "Card grid".into(),
            rationale: "Because the plan says so.".into(),
            confidence: 0.7,
            evidence: vec![],
        }
    );
    assert!(matches!(
        judge(reply("answer", "Card grid", 0.69), Some(&choice)),
        Verdict::Escalate(reason) if reason.contains("69%")
    ));
    assert!(matches!(
        judge(reply("escalate", "", 0.95), Some(&choice)),
        Verdict::Escalate(reason) if reason.contains("handed this to you")
    ));
    assert!(matches!(
        judge(reply("answer", "A list", 0.9), Some(&choice)),
        Verdict::Escalate(reason) if reason.contains("not an option")
    ));
    assert!(matches!(
        judge(reply("answer", "  ", 0.9), Some(&choice)),
        Verdict::Escalate(_)
    ));
    // Free text is fine when the question allows another answer.
    let open = question("choice", &["Table", "Card grid"], None);
    assert!(matches!(
        judge(reply("answer", "A list", 0.9), Some(&open)),
        Verdict::Answer { answer, .. } if answer == "A list"
    ));
    let multi = question("multiChoice", &["Name", "Date", "Size"], None);
    assert!(matches!(
        judge(reply("answer", r#"["date","Name"]"#, 0.8), Some(&multi)),
        Verdict::Answer { answer, .. } if answer == r#"["Date","Name"]"#
    ));
    assert!(matches!(
        judge(reply("answer", "Size", 0.8), Some(&multi)),
        Verdict::Answer { answer, .. } if answer == r#"["Size"]"#
    ));
    assert!(matches!(
        judge(reply("answer", r#"["Colour"]"#, 0.8), Some(&multi)),
        Verdict::Escalate(_)
    ));
    assert!(matches!(
        judge(Err("broken".into()), Some(&choice)),
        Verdict::Escalate(reason) if reason == "broken"
    ));
    // Rounds and deviations only need the decision itself.
    assert!(matches!(
        judge(reply("answer", "approve", 0.8), None),
        Verdict::Answer { .. }
    ));
}

struct Canned(Result<String, String>);

impl Launcher for Canned {
    fn run(&self, _agent: &str, _prompt: String) -> Result<(String, String), String> {
        self.0.clone().map(|text| (text, "decider-run".into()))
    }
}

#[test]
fn launcher_failures_and_timeouts_escalate_with_their_reason() {
    let text = question("text", &[], None);
    let answered = decide_with(
        &Canned(Ok(r#"{"decision":"answer","answer":"Use 4 seconds","rationale":"Matches other toasts.","confidence":0.9}"#.into())),
        "claude",
        "brief".into(),
        Some(&text),
    );
    assert!(matches!(answered.0, Verdict::Answer { ref answer, .. } if answer == "Use 4 seconds"));
    assert_eq!(answered.1.as_deref(), Some("decider-run"));
    let timed_out = decide_with(
        &Canned(Err(
            "The deciding agent did not decide within 3 minutes.".into()
        )),
        "claude",
        "brief".into(),
        Some(&text),
    );
    assert_eq!(
        timed_out,
        (
            Verdict::Escalate("The deciding agent did not decide within 3 minutes.".into()),
            None
        )
    );
    let rambling = decide_with(
        &Canned(Ok("I think so.".into())),
        "claude",
        "brief".into(),
        Some(&text),
    );
    assert!(matches!(rambling.0, Verdict::Escalate(_)));
}

fn plan(started: &str) -> PlanRecord {
    serde_json::from_value(serde_json::json!({
        "id": Uuid::new_v4().to_string(), "projectId": "p", "projectName": "P", "projectPath": ".",
        "title": "Plan", "goal": "Goal", "createdAt": "now", "updatedAt": "now",
        "request": {"id": "template", "projectId": "p", "projectName": "P", "projectPath": ".",
            "agent": "codex", "prompt": "", "isolated": true, "model": null, "previousRunId": null},
        "execution": {"shape": "swarm", "revision": 1, "startedAt": started}
    }))
    .unwrap()
}

#[test]
fn the_decision_limit_counts_only_this_execution_and_standing_decisions() {
    let mut record = plan("2026-11-05T10:00:00Z");
    let make = |record: &PlanRecord, outcome: &str| entry(record, "question", "Which?", outcome);
    for _ in 0..2 {
        let item = make(&record, "deciding");
        reserve(&mut record, item, 3).unwrap();
    }
    let escalated_item = make(&record, "escalated");
    push(&mut record, escalated_item);
    let mut older = make(&record, "decided");
    older.execution = "2026-11-01T10:00:00Z".into();
    push(&mut record, older);
    assert_eq!(used(&record), 2);
    let third = make(&record, "deciding");
    reserve(&mut record, third, 3).unwrap();
    let fourth = make(&record, "deciding");
    let refused = reserve(&mut record, fourth, 3).unwrap_err();
    assert!(refused.contains("limit"), "{refused}");
    assert_eq!(used(&record), 3);
}

fn delivery(items: Vec<PlanItem>) -> PlanDelivery {
    PlanDelivery {
        ready_at: Some("now".into()),
        applied_at: Some("now".into()),
        items,
        ..Default::default()
    }
}

fn item(run: &str, review: bool) -> PlanItem {
    PlanItem {
        item_id: format!("item-{run}"),
        title: format!("Task {run}"),
        run_id: Some(run.into()),
        review,
        ..Default::default()
    }
}

fn checked(id: &str, command: &str, success: bool) -> TaskRun {
    let mut run = TaskRun {
        id: id.into(),
        ..Default::default()
    };
    run.verification = Some(serde_json::from_value(serde_json::json!({"command":command,"checkedAt":"2026-11-05T12:00:00Z","tree":"tree","result":{"success":success,"exitCode":if success {0} else {1},"stdout":"","stderr":"","durationMs":1,"timedOut":false,"truncated":false}})).unwrap());
    run
}

#[test]
fn agents_approve_a_round_only_after_its_merged_result_passed_the_check() {
    let runs = vec![
        checked("a", "pnpm test", true),
        checked("review", "pnpm test", true),
    ];
    let good = delivery(vec![item("a", false), item("review", true)]);
    assert!(round_checks_passed(Some("pnpm test"), &good, &runs).is_ok());
    assert!(round_checks_passed(None, &good, &runs)
        .unwrap_err()
        .contains("no automatic check"));
    let unmerged = PlanDelivery {
        applied_at: None,
        ..good.clone()
    };
    assert!(round_checks_passed(Some("pnpm test"), &unmerged, &runs).is_err());
    let failing = vec![
        checked("a", "pnpm test", false),
        checked("review", "pnpm test", true),
    ];
    assert!(round_checks_passed(Some("pnpm test"), &good, &failing)
        .unwrap_err()
        .contains("failed"));
    let unchecked_review = vec![checked("a", "pnpm test", true)];
    assert!(round_checks_passed(Some("pnpm test"), &good, &unchecked_review).is_err());
    let mut broken = good.clone();
    broken.items[0].error = Some("Repair limit reached".into());
    assert!(round_checks_passed(Some("pnpm test"), &broken, &runs).is_err());
    let other_check = vec![checked("a", "pnpm lint", true)];
    assert!(round_checks_passed(
        Some("pnpm test"),
        &delivery(vec![item("a", false)]),
        &other_check
    )
    .is_err());
}

#[test]
fn deviations_naming_paths_outside_the_plan_need_the_person() {
    let scopes = vec!["src/export".to_string(), "docs/export.md".to_string()];
    assert_eq!(
        outside_scopes("Rename src/export/csv.ts to tsv.ts", &scopes),
        None
    );
    assert_eq!(
        outside_scopes("Also touch src/auth/session.ts.", &scopes),
        Some("src/auth/session.ts")
    );
    assert_eq!(
        outside_scopes("See https://example.com/docs", &scopes),
        None
    );
}

#[test]
fn agent_answers_reach_the_asker_attributed_and_old_prompts_load_unchanged() {
    assert_eq!(
        attributed("claude", "Card grid"),
        "Answered by Claude on your owner's behalf: Card grid"
    );
    let legacy: PendingUserPrompt = serde_json::from_value(serde_json::json!({
        "id": "q", "runId": "r", "question": "Which?", "inputType": "text", "options": [],
        "status": "answered", "answer": "A", "createdAt": "now", "answeredAt": "now"
    }))
    .unwrap();
    assert_eq!(legacy.autonomy, PromptAutonomy::default());
    let value = serde_json::to_value(&legacy).unwrap();
    for key in ["answeredBy", "escalation", "humanAction"] {
        assert!(value.get(key).is_none(), "{key}");
    }
    let mut decided = legacy.clone();
    decided.autonomy.answered_by = Some(AnsweredBy {
        kind: "agent".into(),
        agent: "claude".into(),
        model: None,
        answer: "A".into(),
        rationale: "Plan says A.".into(),
        confidence: 0.9,
        evidence: vec![],
        run_id: Some("decider".into()),
    });
    decided.autonomy.escalation = None;
    let value = serde_json::to_value(&decided).unwrap();
    assert_eq!(value["answeredBy"]["kind"], "agent");
    assert_eq!(value["answeredBy"]["runId"], "decider");
    let back: PendingUserPrompt = serde_json::from_value(value).unwrap();
    assert_eq!(back.autonomy, decided.autonomy);
}

#[test]
fn human_actions_always_go_to_the_person() {
    let input: super::super::harness::HumanActionInput = serde_json::from_value(serde_json::json!({
        "kind": "secret", "title": "Add the Stripe key",
        "instructions": "1. Open Stripe. 2. Copy the secret key. 3. Add it as STRIPE_SECRET_KEY.",
        "url": "https://dashboard.stripe.com/apikeys", "secretName": "STRIPE_SECRET_KEY"
    }))
    .unwrap();
    let (question, autonomy) = human_action(input).unwrap();
    assert_eq!(question.input_type, "humanAction");
    assert_eq!(
        question.options,
        vec![
            super::super::harness::HUMAN_DONE.to_string(),
            super::super::harness::HUMAN_DECLINED.to_string()
        ]
    );
    let action = autonomy.human_action.unwrap();
    assert_eq!(action.secret_name.as_deref(), Some("STRIPE_SECRET_KEY"));
    assert!(autonomy.answered_by.is_none() && autonomy.escalation.is_none());
    for bad in [
        serde_json::json!({"kind":"payment","title":"","instructions":"Pay"}),
        serde_json::json!({"kind":"sign_in","title":"Sign in","instructions":"Go","url":"http://insecure.example"}),
        serde_json::json!({"kind":"secret","title":"Key","instructions":"Add it","secretName":"MY KEY"}),
    ] {
        let input: super::super::harness::HumanActionInput = serde_json::from_value(bad).unwrap();
        assert!(human_action(input).is_err());
    }
    assert!(
        serde_json::from_value::<super::super::harness::HumanActionInput>(
            serde_json::json!({"kind":"wire_money","title":"x","instructions":"y"})
        )
        .is_err()
    );
}
