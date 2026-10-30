use super::*;

fn fixture() -> (PathBuf, KnowledgeStore, String) {
    let root = std::env::temp_dir().join(format!("jackalope-enforce-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("scripts")).unwrap();
    std::fs::write(root.join("scripts/check-routes.mjs"), "// check\n").unwrap();
    std::fs::write(
        root.join("package.json"),
        r#"{"scripts":{"lint:routes":"node scripts/check-routes.mjs"}}"#,
    )
    .unwrap();
    let store = KnowledgeStore::new(root.join("knowledge/entries.json"));
    let path = canonical(root.to_str().unwrap()).unwrap();
    (root, store, path)
}

fn said(text: &str) -> Observation {
    Observation {
        kind: ObservationKind::Statement,
        text: text.into(),
        reference: "Task a".into(),
        run_id: None,
    }
}

fn learned(store: &KnowledgeStore, path: &str, statement: &str) -> KnowledgeEntry {
    let existing = store.list("p", path).unwrap();
    let report = store
        .promote(
            "p",
            path,
            reflect(&[said(statement)], &existing),
            "reflection",
        )
        .unwrap();
    assert!(report.rejected.is_empty(), "{report:?}");
    find(store, path, statement)
}

fn written(store: &KnowledgeStore, path: &str, content: &str) -> KnowledgeEntry {
    store
        .save(KnowledgeEntry {
            automatic: None,
            dismissed: false,
            process: Default::default(),
            stale: None,
            enforced: None,
            id: uuid::Uuid::new_v4().to_string(),
            project_id: "p".into(),
            project_path: path.into(),
            kind: KnowledgeKind::Memory,
            title: "Route tables".into(),
            content: content.into(),
            keywords: vec!["routes".into()],
            enabled: true,
            source_run_id: None,
            source_head: None,
            revision: 0,
            updated_at: String::new(),
        })
        .unwrap()
}

fn find(store: &KnowledgeStore, path: &str, needle: &str) -> KnowledgeEntry {
    store
        .list("p", path)
        .unwrap()
        .into_iter()
        .find(|entry| entry.content.contains(needle))
        .unwrap()
}

fn accepted(id: &str) -> TaskRun {
    TaskRun {
        id: id.into(),
        task_id: format!("task-{id}"),
        ..Default::default()
    }
}

#[test]
fn the_reported_enforcer_is_the_last_enforced_by_line() {
    assert_eq!(
        reported_enforcer("Done.\nEnforced by: `pnpm lint:routes`\n").as_deref(),
        Some("pnpm lint:routes")
    );
    assert_eq!(
        reported_enforcer("Enforced by: old\n- **Enforced by:** scripts/check-routes.mjs.")
            .as_deref(),
        Some("scripts/check-routes.mjs")
    );
    assert_eq!(
        reported_enforcer("enforced BY: cargo test routes").as_deref(),
        Some("cargo test routes")
    );
    // The template placeholder and prose are not a report.
    assert!(reported_enforcer("Enforced by: <command or file path>").is_none());
    assert!(reported_enforcer("This is enforced by a test now.").is_none());
    assert!(reported_enforcer("Enforced by:   ").is_none());
}

#[test]
fn the_draft_quotes_redacted_instances_and_is_never_learned_back() {
    let (_root, store, path) = fixture();
    let lesson = learned(
        &store,
        &path,
        "Always register new routes in src/routes/table.ts first.",
    );
    store
        .record_outcomes(
            "p",
            &path,
            "run-2",
            &[Outcome {
                entry_id: lesson.id.clone(),
                contradicted: false,
                reference: "Task run-2".into(),
                excerpt: "register the route in the table, ask me@example.com".into(),
            }],
            &THRESHOLDS,
        )
        .unwrap();
    let draft = store.check_draft("p", &path, &lesson.id).unwrap();
    assert!(draft.contains(&lesson.content), "{draft}");
    // Restatements come first, redacted as the history stores them.
    let missed = draft.find("Task run-2: register the route").unwrap();
    let born = draft.find("Task a: Always register").unwrap();
    assert!(missed < born, "{draft}");
    assert!(!draft.contains("me@example.com"), "{draft}");
    assert!(
        draft.contains("Architecture") && draft.contains("Enforced by: <command or file path>")
    );
    // Starting the draft as a task never teaches Jackalope a new lesson.
    let existing = store.list("p", &path).unwrap();
    assert!(reflect(&[said(&draft)], &existing).is_empty(), "{draft}");
    assert!(reflect(&[said(&draft)], &[]).is_empty(), "{draft}");

    let manual = written(&store, &path, "Route tables live in one module.");
    let draft = store.check_draft("p", &path, &manual.id).unwrap();
    assert!(
        draft.contains("No past instance of the mistake is recorded"),
        "{draft}"
    );
    assert!(store.check_draft("p", &path, "missing").is_err());
}

#[test]
fn an_accepted_check_retires_a_learned_lesson_and_marks_a_written_one() {
    let (_root, store, path) = fixture();
    let lesson = learned(
        &store,
        &path,
        "Always register new routes in the shared table module.",
    );
    let applied = store
        .mark_enforced("p", &path, &lesson.id, "pnpm lint:routes", &accepted("r1"))
        .unwrap();
    assert_eq!(applied.len(), 2, "{applied:?}");
    let saved = find(&store, &path, "shared table module");
    let state = lifecycle(&saved).unwrap();
    assert_eq!(
        (state.archived(), state.archived_reason.as_deref()),
        (true, Some(ENFORCED))
    );
    let enforcement = saved.enforced.as_ref().unwrap();
    assert_eq!(
        (
            enforcement.by.as_str(),
            enforcement.run_id.as_str(),
            enforcement.task_id.as_str()
        ),
        ("pnpm lint:routes", "r1", "task-r1")
    );
    let actions: Vec<_> = store
        .history("p", &saved.id, 10)
        .into_iter()
        .map(|record| record.action)
        .collect();
    assert!(
        actions.ends_with(&["enforced".into(), "retired".into()]),
        "{actions:?}"
    );
    // Accepting the same attempt again changes nothing.
    assert!(store
        .mark_enforced("p", &path, &lesson.id, "pnpm lint:routes", &accepted("r1"))
        .unwrap()
        .is_empty());
    assert_eq!(store.metrics("p", &path).unwrap().enforced, 1);

    // A lesson the person wrote is only marked; they decide to retire it.
    let manual = written(&store, &path, "Route tables live in one module.");
    store
        .mark_enforced(
            "p",
            &path,
            &manual.id,
            "scripts/check-routes.mjs",
            &accepted("r2"),
        )
        .unwrap();
    let marked = find(&store, &path, "one module");
    assert!(marked.enabled && marked.revision == manual.revision);
    assert!(marked.enforced.is_some());
    // Editing keeps the mark; the client cannot clear or forge it.
    let edited = store
        .save(KnowledgeEntry {
            content: "Route tables live in exactly one module.".into(),
            enforced: None,
            ..marked.clone()
        })
        .unwrap();
    assert_eq!(edited.enforced, marked.enforced);
    let retired = store.retire_enforced(&edited.id, edited.revision).unwrap();
    assert!(!retired.enabled && retired.enforced.is_some());
    assert_eq!(
        store.history("p", &retired.id, 10).last().unwrap().action,
        "retired"
    );
    assert!(store.retire_enforced(&lesson.id, 1).is_err());
}

#[test]
fn a_missing_enforcer_unmarks_a_learned_lesson_and_flags_a_written_one() {
    let (root, store, path) = fixture();
    let lesson = learned(
        &store,
        &path,
        "Always register new routes in the shared table module.",
    );
    store
        .mark_enforced(
            "p",
            &path,
            &lesson.id,
            "pnpm run lint:routes",
            &accepted("r1"),
        )
        .unwrap();
    let manual = written(&store, &path, "Route tables live in one module.");
    store
        .mark_enforced(
            "p",
            &path,
            &manual.id,
            "scripts/check-routes.mjs",
            &accepted("r2"),
        )
        .unwrap();
    let unknown = written(&store, &path, "Handlers stay small and focused.");
    store
        .mark_enforced(
            "p",
            &path,
            &unknown.id,
            "cargo test handlers",
            &accepted("r3"),
        )
        .unwrap();
    assert!(store
        .check_enforcers("p", &path, &THRESHOLDS)
        .unwrap()
        .is_empty());

    std::fs::remove_file(root.join("scripts/check-routes.mjs")).unwrap();
    std::fs::write(root.join("package.json"), r#"{"scripts":{}}"#).unwrap();
    let applied = store.check_enforcers("p", &path, &THRESHOLDS).unwrap();
    assert_eq!(applied.len(), 2, "{applied:?}");

    // Jackalope retired its lesson for the check, so it supplies it again.
    let restored = find(&store, &path, "shared table module");
    assert!(restored.enforced.is_none() && restored.enabled);
    assert!(!lifecycle(&restored).unwrap().archived());
    assert_eq!(
        store.history("p", &restored.id, 10).last().unwrap().action,
        "unenforced"
    );

    let flagged = find(&store, &path, "one module");
    assert_eq!(
        flagged.enforced.as_ref().unwrap().missing.as_deref(),
        Some("scripts/check-routes.mjs")
    );
    assert!(attention(&flagged)
        .unwrap()
        .contains("scripts/check-routes.mjs"));
    assert!(store
        .retire_enforced(&flagged.id, flagged.revision)
        .is_err());
    // Anything the check cannot tell counts as present.
    assert!(find(&store, &path, "small and focused")
        .enforced
        .unwrap()
        .missing
        .is_none());

    // Flagging again changes nothing; the file returning clears the flag.
    assert!(store
        .check_enforcers("p", &path, &THRESHOLDS)
        .unwrap()
        .is_empty());
    std::fs::write(root.join("scripts/check-routes.mjs"), "// check\n").unwrap();
    store.check_enforcers("p", &path, &THRESHOLDS).unwrap();
    assert!(find(&store, &path, "one module")
        .enforced
        .unwrap()
        .missing
        .is_none());
}

#[test]
fn the_receipt_carries_the_lesson_a_task_enforces() {
    let (_root, store, path) = fixture();
    let manual = written(&store, &path, "Route tables live in one module.");
    let selection = ContextSelection {
        memory_off: true,
        enforces_lesson_id: Some(manual.id.clone()),
        ..Default::default()
    };
    let receipt = store
        .select("p", &path, "Make it a check", &selection)
        .unwrap();
    assert!(receipt.entries.is_empty());
    assert_eq!(
        receipt.enforces_lesson_id.as_deref(),
        Some(manual.id.as_str())
    );
    let gone = ContextSelection {
        enforces_lesson_id: Some("missing".into()),
        ..Default::default()
    };
    let receipt = store.select("p", &path, "routes", &gone).unwrap();
    assert!(receipt.enforces_lesson_id.is_none());
    assert_eq!(receipt.entries.len(), 1);
}

#[test]
fn accepting_the_task_reads_the_newest_reported_enforcer() {
    let (root, _store, path) = fixture();
    let runtime = TaskRuntime::new(root.join("history")).unwrap();
    let store = &runtime.knowledge;
    let manual = written(store, &path, "Route tables live in one module.");
    let attempt = |id: &str, started: &str, result: &str| TaskRun {
        id: id.into(),
        task_id: "task".into(),
        project_id: "p".into(),
        project_path: path.clone(),
        started_at: started.into(),
        result: result.into(),
        context_receipt: ContextReceipt {
            enforces_lesson_id: Some(manual.id.clone()),
            ..Default::default()
        },
        ..Default::default()
    };
    let first = attempt("a1", "2026-10-01", "Enforced by: pnpm run lint:routes");
    let second = attempt("a2", "2026-10-02", "Enforced by: scripts/check-routes.mjs");
    let latest = attempt("a3", "2026-10-03", "Tightened the error message.");
    accept(&runtime, &latest, &[first, second, latest.clone()]);
    let marked = find(store, &path, "one module");
    let enforcement = marked.enforced.unwrap();
    assert_eq!(
        (enforcement.by.as_str(), enforcement.run_id.as_str()),
        ("scripts/check-routes.mjs", "a3")
    );

    // Without any report the lesson stays unmarked and its history says why.
    let other = written(store, &path, "Handlers stay small and focused.");
    let mut silent = attempt("b1", "2026-10-04", "Done.");
    silent.task_id = "other".into();
    silent.context_receipt.enforces_lesson_id = Some(other.id.clone());
    accept(&runtime, &silent, std::slice::from_ref(&silent));
    assert!(find(store, &path, "small and focused").enforced.is_none());
    assert_eq!(
        store.history("p", &other.id, 5).last().unwrap().action,
        "unreported"
    );
}
