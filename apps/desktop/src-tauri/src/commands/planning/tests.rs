use super::artifact::{self, Criterion, PlanDocument, PlanTask, VerifyKind};
use super::store::{PlanRecord, PlanSettings, Session, Store};
use super::{handoff, interview, session};
use crate::commands::harness::ValidationStep;

pub(super) fn sample() -> PlanDocument {
    PlanDocument {
        title: "Add export button".into(),
        goal: "Let people export the report as CSV.".into(),
        context: "Reports render in src/report.ts.".into(),
        coverage: vec![
            ("Scope".into(), "Clear".into()),
            ("Edge & failure cases".into(), "Partial".into()),
        ],
        clarifications: vec![artifact::Clarification {
            question: "Which delimiter?".into(),
            answer: "Comma".into(),
        }],
        assumptions: vec!["Exports stay under 10,000 rows.".into()],
        out_of_scope: vec!["Excel files.".into()],
        approach: "Add a serializer and a button.".into(),
        tasks: vec![
            PlanTask {
                key: "csv".into(),
                title: "Serialize reports".into(),
                scopes: vec!["src/csv.ts".into()],
                covers: vec!["AC-1".into()],
                briefing: "Follow src/json.ts.".into(),
                ..Default::default()
            },
            PlanTask {
                key: "button".into(),
                title: "Export button".into(),
                scopes: vec!["src/ui".into()],
                depends_on: vec!["csv".into()],
                parallel: true,
                covers: vec!["AC-2".into()],
                ..Default::default()
            },
        ],
        criteria: vec![
            Criterion {
                id: "AC-1".into(),
                verify: VerifyKind::Test,
                check: "pnpm test csv".into(),
                text: "WHEN a report has quotes THEN the CSV escapes them".into(),
            },
            Criterion {
                id: "AC-2".into(),
                verify: VerifyKind::Manual,
                check: String::new(),
                text: "The button downloads a file".into(),
            },
        ],
        risks: vec![],
        decision_log: vec!["Use the existing serializer pattern.".into()],
        surprises: vec![],
        ..Default::default()
    }
}

#[test]
fn documents_round_trip_through_markdown() {
    let mut doc = sample();
    doc.front.status = "draft".into();
    doc.front.id = "plan".into();
    doc.front.revision = 3;
    doc.front.recommended_shape = "subtasks".into();
    doc.front.shape_reason = "Two independent files".into();
    doc.front.workers = 2;
    let parsed = artifact::parse(&doc.render()).unwrap();
    assert_eq!(parsed, doc);
    assert_eq!(parsed.content_hash(), doc.content_hash());
    doc.front.status = "approved".into();
    doc.front.approved_by = "Someone (app)".into();
    assert_eq!(
        parsed.content_hash(),
        doc.content_hash(),
        "approval metadata does not change the approved hash"
    );
    doc.goal.push_str(" Quickly.");
    assert_ne!(parsed.content_hash(), doc.content_hash());
}

#[test]
fn planner_output_with_a_preamble_and_fence_still_parses() {
    let body = sample().render();
    let wrapped = format!("Here is the plan.\n\n```markdown\n{body}```\n");
    assert_eq!(artifact::parse(&wrapped).unwrap().tasks.len(), 2);
    let without_front = body.split_once("\n---\n\n").unwrap().1;
    let parsed = artifact::parse(without_front).unwrap();
    assert_eq!(parsed.title, "Add export button");
    assert_eq!(parsed.front.status, "draft");
    assert!(artifact::parse("no plan here").is_err());
    let bad_tag = body.replace("[manual]", "[vibes]");
    assert!(artifact::parse(&bad_tag).unwrap_err().contains("AC-2"));
}

#[test]
fn validation_rejects_unknown_references_and_limits() {
    let mut doc = sample();
    doc.tasks[1].depends_on = vec!["missing".into()];
    assert!(doc.validate().unwrap_err().contains("unknown task"));
    let mut doc = sample();
    doc.tasks[0].covers = vec!["AC-9".into()];
    assert!(doc.validate().unwrap_err().contains("unknown criterion"));
    let mut doc = sample();
    doc.tasks[1].key = "csv".into();
    assert!(doc.validate().is_err());
    let mut doc = sample();
    doc.tasks = (0..9)
        .map(|i| PlanTask {
            key: format!("t{i}"),
            title: "T".into(),
            scopes: vec![format!("s{i}")],
            ..Default::default()
        })
        .collect();
    assert!(doc.validate().is_err());
    assert!(sample().validate().is_ok());
}

#[test]
fn revision_diff_reports_changed_sections_only() {
    let before = sample().render();
    let mut changed = sample();
    changed.assumptions.push("CSV uses UTF-8.".into());
    changed.criteria[1].text = "The button downloads report.csv".into();
    let changes = artifact::diff(&before, &changed.render());
    let sections: Vec<_> = changes.iter().map(|c| c.section.as_str()).collect();
    assert_eq!(sections, ["Assumptions", "Acceptance criteria"]);
    assert!(changes.iter().all(|c| c.change == "changed"));
    assert!(artifact::diff(&before, &before).is_empty());
}

#[test]
fn interview_stops_at_the_cap_or_when_the_person_says_so() {
    assert_eq!(interview::gate(0, 5, &[]), interview::Gate::Ask);
    assert_eq!(
        interview::gate(4, 5, &["Comma".into()]),
        interview::Gate::Ask
    );
    assert!(
        matches!(interview::gate(5, 5, &[]), interview::Gate::Closed(reason) if reason.contains("5-question"))
    );
    assert!(matches!(
        interview::gate(1, 5, &[interview::USE_RECOMMENDATIONS.into()]),
        interview::Gate::Closed(reason) if reason.contains("recommendations")
    ));
    assert!(matches!(
        interview::gate(1, 5, &["done".into()]),
        interview::Gate::Closed(reason) if reason.contains("ended")
    ));
    // A multi-select answer containing the stop option also counts.
    assert!(matches!(
        interview::gate(1, 5, &[format!("[\"{}\"]", interview::DONE)]),
        interview::Gate::Closed(_)
    ));
    assert_eq!(
        interview::gate(1, 5, &["Done with tests first".into()]),
        interview::Gate::Ask
    );
    // A cap of zero means no questions: everything becomes an assumption.
    assert!(matches!(
        interview::gate(0, 0, &[]),
        interview::Gate::Closed(_)
    ));
}

#[test]
fn unanswered_questions_never_answer_or_approve() {
    // Pending prompts have no answer; only answers the person gave count.
    let prompt: crate::commands::harness::PendingUserPrompt =
        serde_json::from_value(serde_json::json!({
            "id": "q", "runId": "plan-run", "question": "Which?", "options": ["A", interview::DONE],
            "status": "pending", "answer": null, "createdAt": "now", "answeredAt": null
        }))
        .unwrap();
    let answers: Vec<String> = [prompt].iter().filter_map(|p| p.answer.clone()).collect();
    assert_eq!(interview::gate(1, 5, &answers), interview::Gate::Ask);
}

#[test]
fn planning_questions_offer_ways_to_end_the_interview() {
    super::register_run("planning-gate-run", "plan", 2, 1);
    assert!(super::read_only("planning-gate-run"));
    assert!(!super::read_only("ordinary-run"));
    let run = crate::commands::tasks::TaskRun {
        id: "planning-gate-run".into(),
        ..Default::default()
    };
    let mut input: crate::commands::harness::AskUserInput = serde_json::from_value(
        serde_json::json!({"question": "Delimiter?", "input_type": "choice", "options": ["Comma", "Tab"]}),
    )
    .unwrap();
    assert_eq!(super::question_gate(&run, &mut input), None);
    assert_eq!(
        input.options,
        [
            "Comma",
            "Tab",
            interview::USE_RECOMMENDATIONS,
            interview::DONE
        ]
    );
    let mut asked = run.clone();
    asked.prompts = vec![serde_json::from_value(serde_json::json!({
        "id": "q", "runId": "planning-gate-run", "question": "Which?", "status": "answered",
        "answer": "Comma", "createdAt": "now"
    }))
    .unwrap()];
    assert!(super::question_gate(&asked, &mut input)
        .unwrap()
        .contains("2-question"));
}

#[test]
fn approved_plans_map_to_managed_assignments() {
    let doc = sample();
    let subtasks: serde_json::Value =
        serde_json::from_str(&handoff::assignments(&doc, "subtasks").unwrap()).unwrap();
    assert_eq!(subtasks.as_array().unwrap().len(), 2);
    assert_eq!(subtasks[1]["dependsOn"], serde_json::json!(["csv"]));
    assert_eq!(
        subtasks[0]["outcomes"],
        serde_json::json!(["AC-1: WHEN a report has quotes THEN the CSV escapes them"])
    );
    assert_eq!(subtasks[0]["briefing"], "Follow src/json.ts.");
    let single: serde_json::Value =
        serde_json::from_str(&handoff::assignments(&doc, "single").unwrap()).unwrap();
    assert_eq!(single.as_array().unwrap().len(), 1);
    assert_eq!(
        single[0]["scopes"],
        serde_json::json!(["src/csv.ts", "src/ui"])
    );
    assert_eq!(single[0]["outcomes"].as_array().unwrap().len(), 2);
    // Finished tasks are preserved by a re-plan and not assigned again.
    let mut replanned = doc.clone();
    replanned.tasks[0].status = "done".into();
    let remaining: serde_json::Value =
        serde_json::from_str(&handoff::assignments(&replanned, "subtasks").unwrap()).unwrap();
    assert_eq!(remaining.as_array().unwrap().len(), 1);
    assert_eq!(remaining[0]["key"], "button");
    assert_eq!(remaining[0]["dependsOn"], serde_json::json!([]));
    replanned.tasks[1].status = "done".into();
    assert!(handoff::assignments(&replanned, "single").is_err());
}

#[test]
fn shape_defaults_follow_the_recommendation_when_available() {
    let mut doc = sample();
    doc.front.recommended_shape = "swarm".into();
    assert_eq!(handoff::default_shape(&doc, true), "swarm");
    assert_eq!(handoff::default_shape(&doc, false), "subtasks");
    doc.front.recommended_shape = "single".into();
    assert_eq!(handoff::default_shape(&doc, true), "single");
    doc.front.recommended_shape = "subtasks".into();
    doc.tasks.truncate(1);
    doc.tasks[0].covers = vec!["AC-1".into(), "AC-2".into()];
    assert_eq!(handoff::default_shape(&doc, false), "single");
}

fn step(name: &str, status: &str, notes: &str) -> ValidationStep {
    ValidationStep {
        id: name.into(),
        step: name.into(),
        status: status.into(),
        notes: Some(notes.into()),
        evidence: vec![],
        timestamp: "now".into(),
        requirements: vec![],
        finding: None,
    }
}

#[test]
fn criteria_map_to_requirements_and_states_rank_evidence() {
    let doc = sample();
    let none = handoff::criterion_states(&doc, &[]);
    assert!(none.iter().all(|state| state.state == "unassessed"));
    let mut claimed = step("Final", "passed", "");
    claimed.requirements = vec![serde_json::from_value(serde_json::json!({
        "requirementId": "requirement-1", "status": "met", "summary": "Downloads a file"
    }))
    .unwrap()];
    let evidence = handoff::Evidence {
        steps: vec![step("AC-1", "failed", "escaping broke"), claimed],
        requirements: vec![
            (
                "requirement-0".into(),
                "AC-1: WHEN a report...".into(),
                false,
            ),
            (
                "requirement-1".into(),
                "AC-2: The button downloads a file".into(),
                false,
            ),
        ],
    };
    let states = handoff::criterion_states(&doc, std::slice::from_ref(&evidence));
    assert_eq!(states[0].state, "check-failed");
    assert_eq!(states[1].state, "agent-claimed");
    let mut fixed = evidence.clone();
    fixed.steps.push(step("AC-1", "passed", "pnpm test csv"));
    fixed.requirements[1].2 = true;
    let states = handoff::criterion_states(&doc, &[fixed]);
    assert_eq!(states[0].state, "check-passed");
    assert_eq!(states[1].state, "human-accepted");
    assert_eq!(
        handoff::outcomes(&doc, &["AC-2".into()]),
        ["AC-2: The button downloads a file"]
    );
}

#[test]
fn plan_review_gaps_become_repairs_until_it_passes() {
    assert_eq!(handoff::open_gaps(&[]), None);
    let failed = step(
        "Plan review",
        "failed",
        "Critical AC-1: quotes are not escaped\nMinor AC-2: button label",
    );
    let gaps = handoff::open_gaps(std::slice::from_ref(&failed)).unwrap();
    assert!(gaps.contains("critical AC-1") && !gaps.contains("label"));
    let (_, all) = handoff::review(std::slice::from_ref(&failed)).unwrap();
    assert_eq!(all.len(), 2);
    let passed = step("Plan review", "passed", "Minor AC-2: button label");
    assert_eq!(handoff::open_gaps(&[failed, passed]), None);
}

fn record(directory: &std::path::Path) -> PlanRecord {
    PlanRecord {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: "project".into(),
        project_name: "Project".into(),
        project_path: directory.to_string_lossy().into_owned(),
        title: "Plan".into(),
        goal: "Export CSV".into(),
        created_at: "now".into(),
        updated_at: "now".into(),
        request: serde_json::from_value(serde_json::json!({
            "id": "template", "projectId": "project", "projectName": "Project",
            "projectPath": ".", "agent": "codex", "prompt": "", "isolated": true,
            "model": null, "previousRunId": null
        }))
        .unwrap(),
        session: Session::default(),
        revisions: vec![],
        approval: None,
        execution: None,
        deviations: vec![],
        error: None,
        reflected: false,
        archived: false,
    }
}

#[test]
fn records_keep_every_revision_and_export_without_committing() {
    let folder = std::env::temp_dir().join(format!("plan-store-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&folder).unwrap();
    let store = Store::new(folder.join("plans"));
    let mut plan = record(&folder);
    plan.push_revision(sample(), "planner", "First draft", None)
        .unwrap();
    store.create(&plan).unwrap();
    assert!(store.create(&plan).is_err(), "ids are unique");
    let (saved, number) = store
        .update(&plan.id, |saved| {
            let mut doc = saved.document().unwrap();
            doc.risks.push("Large reports".into());
            saved.push_revision(doc, "you", "Edited directly", None)
        })
        .unwrap();
    assert_eq!(number, 2);
    assert_eq!(saved.revisions.len(), 2);
    assert_eq!(saved.document().unwrap().front.revision, 2);
    assert_ne!(saved.revisions[0].hash, saved.revisions[1].hash);
    assert_eq!(store.list(Some("project")).unwrap().0.len(), 1);
    assert!(store.list(Some("other")).unwrap().0.is_empty());

    let written = super::store::export(&saved, "docs/plans/{slug}.md").unwrap();
    assert_eq!(
        written,
        std::path::Path::new("docs/plans/add-export-button.md")
    );
    let text = std::fs::read_to_string(folder.join(&written)).unwrap();
    assert!(text.starts_with("---\n") && text.contains("## Acceptance criteria"));
    for escape in ["../outside.md", "/abs.md", "notes.txt", "C:/x.md"] {
        assert!(super::store::export(&saved, escape).is_err(), "{escape}");
    }

    // A corrupt record is quarantined and reported, not overwritten.
    let corrupt = uuid::Uuid::new_v4().to_string();
    std::fs::write(folder.join(format!("plans/{corrupt}.json")), b"{").unwrap();
    let (plans, problems) = store.list(None).unwrap();
    assert_eq!((plans.len(), problems.len()), (1, 1));
    assert!(folder
        .join(format!("plans/{corrupt}.json.corrupt"))
        .exists());
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn settings_default_and_reject_paths_outside_the_project() {
    let folder = std::env::temp_dir().join(format!("plan-settings-{}", uuid::Uuid::new_v4()));
    let store = Store::new(folder.clone());
    assert_eq!(store.settings("p"), PlanSettings::default());
    assert_eq!(PlanSettings::default().question_cap, 5);
    let custom = PlanSettings {
        question_cap: 3,
        planner_agent: Some("claude".into()),
        planner_model: None,
        export_path: "plans/{slug}.md".into(),
    };
    store.save_settings("p", custom.clone()).unwrap();
    assert_eq!(store.settings("p"), custom);
    assert_eq!(store.settings("q"), PlanSettings::default());
    let outside = PlanSettings {
        export_path: "../{slug}.md".into(),
        ..Default::default()
    };
    assert!(store.save_settings("p", outside).is_err());
    let chatty = PlanSettings {
        question_cap: 40,
        ..Default::default()
    };
    assert!(store.save_settings("p", chatty).is_err());
    // Saved without newer fields, settings still load.
    std::fs::write(folder.join("settings.json"), br#"{"p":{"questionCap":2}}"#).unwrap();
    assert_eq!(store.settings("p").export_path, "docs/plans/{slug}.md");
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn reflection_turns_accepted_deviations_and_failing_criteria_into_directives() {
    let folder = std::env::temp_dir();
    let mut plan = record(&folder);
    let doc = sample();
    plan.deviations.push(super::store::Deviation {
        id: "d".into(),
        run_id: None,
        kind: "declared".into(),
        summary: "The export also needs the API route".into(),
        amendment: String::new(),
        status: "accepted".into(),
        created_at: "now".into(),
        resolved_at: None,
    });
    let states = vec![handoff::CriterionState {
        id: "AC-1".into(),
        state: "check-failed",
        detail: String::new(),
    }];
    let observations = super::learning::observations(&plan, &doc, &states);
    assert_eq!(observations.len(), 2);
    assert!(observations
        .iter()
        .all(|item| item.text.starts_with("Always ")));
    assert!(observations[1].text.contains("escapes them"));
    plan.deviations[0].status = "pending".into();
    assert_eq!(super::learning::observations(&plan, &doc, &[]).len(), 0);
}

#[test]
fn execution_and_review_briefs_are_self_contained() {
    let doc = sample();
    let brief = interview::execution_brief(&doc);
    assert!(brief.contains("plan_deviation") && brief.contains("## Tasks"));
    assert!(brief.contains("Do not edit the plan"));
    let review = interview::review_brief(&doc);
    assert!(review.contains("Plan review") && review.contains("pnpm test csv"));
    let prompt = interview::interview_prompt("Export CSV", 3, "- Earlier plan");
    assert!(prompt.contains("at most 3 questions") && prompt.contains("Earlier plan"));
    assert!(prompt.contains("read-only") || prompt.contains("Work read-only"));
    for area in interview::COVERAGE {
        assert!(prompt.contains(area), "{area}");
    }
}

#[test]
fn approval_checks_with_the_project_then_criteria_then_review_only() {
    let doc = sample();
    let project = session::PlanChecks {
        verify_command: Some(" pnpm verify ".into()),
        ..Default::default()
    };
    let chosen = session::verification(&project, &doc);
    assert_eq!(
        (chosen.source, chosen.command.as_deref()),
        ("project", Some("pnpm verify"))
    );
    let none = session::PlanChecks::default();
    let mut both = doc.clone();
    both.criteria[1].verify = VerifyKind::Command;
    both.criteria[1].check = "node smoke.js".into();
    let chosen = session::verification(&none, &both);
    assert_eq!(
        (chosen.source, chosen.command.as_deref()),
        ("criteria", Some("pnpm test csv && node smoke.js"))
    );
    let mut manual = doc;
    manual.criteria[0].verify = VerifyKind::Test;
    manual.criteria[0].check.clear();
    let chosen = session::verification(&none, &manual);
    assert_eq!((chosen.source, chosen.command), ("review", None));
}

#[test]
fn review_only_plans_need_a_passing_review_before_integration() {
    assert!(
        handoff::review_cleared(&[], true),
        "a check gates on its own"
    );
    assert!(!handoff::review_cleared(&[], false));
    let failed = step("Plan review", "failed", "Major AC-1: missing");
    assert!(!handoff::review_cleared(
        std::slice::from_ref(&failed),
        false
    ));
    let passed = step("Plan review", "passed", "");
    assert!(handoff::review_cleared(&[failed, passed], false));
}

#[test]
fn written_plans_map_steps_to_tasks_and_outcomes_to_criteria() {
    let plan = session::ManualPlan {
        goal: "Add CSV export\nReports only.".into(),
        tasks: vec![
            session::ManualTask {
                title: "Serialize".into(),
                instructions: "Follow src/json.ts.".into(),
                scopes: vec!["src/csv.ts".into(), " ".into()],
                outcomes: vec!["Quotes are escaped".into(), "Commas are quoted".into()],
                ..Default::default()
            },
            session::ManualTask {
                title: "Button".into(),
                depends_on: vec![0],
                outcomes: vec!["The button downloads a file".into()],
                ..Default::default()
            },
        ],
    };
    let doc = session::manual_document(&plan).unwrap();
    assert_eq!(doc.title, "Add CSV export");
    assert_eq!(doc.front.status, "draft");
    assert_eq!(doc.tasks[0].key, "task-1");
    assert_eq!(doc.tasks[0].scopes, ["src/csv.ts"]);
    assert_eq!(doc.tasks[0].covers, ["AC-1", "AC-2"]);
    assert_eq!(doc.tasks[1].depends_on, ["task-1"]);
    assert_eq!(doc.tasks[1].scopes, ["."]);
    assert_eq!(doc.tasks[1].covers, ["AC-3"]);
    assert_eq!(doc.tasks[0].briefing, "Follow src/json.ts.");
    assert!(doc
        .criteria
        .iter()
        .all(|criterion| criterion.verify == VerifyKind::Manual));
    // It renders and parses like any plan, so it reviews and approves alike.
    assert_eq!(artifact::parse(&doc.render()).unwrap().tasks, doc.tasks);

    let bare = session::manual_document(&session::ManualPlan {
        goal: "Tidy the README".into(),
        tasks: vec![session::ManualTask {
            title: "Edit".into(),
            ..Default::default()
        }],
    })
    .unwrap();
    assert_eq!(bare.criteria[0].text, "Tidy the README");
    assert_eq!(bare.tasks[0].covers, ["AC-1"]);
    let cycle = session::manual_document(&session::ManualPlan {
        goal: "Loop".into(),
        tasks: vec![session::ManualTask {
            title: "Self".into(),
            depends_on: vec![0],
            ..Default::default()
        }],
    });
    assert!(cycle.is_err());
}
