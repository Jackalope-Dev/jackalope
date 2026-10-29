use super::*;

fn fixture() -> (KnowledgeStore, String) {
    let root = std::env::temp_dir().join(format!("jackalope-curate-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let store = KnowledgeStore::new(root.join("knowledge/entries.json"));
    let path = canonical(root.to_str().unwrap()).unwrap();
    (store, path)
}

fn add(store: &KnowledgeStore, path: &str, statement: &str, reference: &str) -> String {
    let key = format!("preference:{}", words(statement).trim());
    let lesson = Lesson {
        key: key.clone(),
        kind: "preference".into(),
        title: "User preference".into(),
        statement: statement.into(),
        content: format!("Previously requested by the user: {statement}"),
        keywords: reflect::phrases(statement),
        reference: reference.into(),
        excerpt: statement.into(),
        run_id: None,
    };
    store
        .promote("p", path, vec![Proposal::Add(lesson)], "reflection")
        .unwrap();
    learned_id("p", &key)
}

fn entry(store: &KnowledgeStore, path: &str, id: &str) -> KnowledgeEntry {
    store
        .list("p", path)
        .unwrap()
        .into_iter()
        .find(|entry| entry.id == id)
        .unwrap()
}

#[test]
fn near_duplicates_fold_into_the_most_used_lesson_reversibly() {
    let (store, path) = fixture();
    let first = add(
        &store,
        &path,
        "Always run pnpm verify before committing changes.",
        "Task a",
    );
    let second = add(
        &store,
        &path,
        "Always run pnpm verify before committing any changes.",
        "Task b",
    );
    let opposite = add(
        &store,
        &path,
        "Never run pnpm verify before committing changes.",
        "Task c",
    );
    let other = add(
        &store,
        &path,
        "Prefer table driven tests for parsers.",
        "Task d",
    );
    store
        .record_delivery("p", &path, "run-1", std::slice::from_ref(&second), true)
        .unwrap();

    let applied = store.curate("p", &path, &THRESHOLDS).unwrap();
    assert_eq!(applied.len(), 1, "{applied:?}");
    let kept = entry(&store, &path, &second);
    let folded = entry(&store, &path, &first);
    assert!(!lifecycle(&kept).unwrap().archived());
    let state = lifecycle(&folded).unwrap();
    assert!(state.archived());
    assert_eq!(state.archived_reason.as_deref(), Some(FOLDED));
    assert!(kept
        .automatic
        .as_ref()
        .unwrap()
        .evidence
        .contains(&"Task a".to_string()));
    for id in [&opposite, &other] {
        assert!(!lifecycle(&entry(&store, &path, id)).unwrap().archived());
    }
    let last = store.history("p", &first, 10).pop().unwrap();
    assert_eq!(
        (last.action.as_str(), last.origin.as_str()),
        ("curated", "curator")
    );
    assert_eq!(
        store.history("p", &second, 10).pop().unwrap().action,
        "merged"
    );

    // Restoring undoes the fold, and the curator leaves the lesson apart afterwards.
    let restored = store.set_archived(&first, folded.revision, false).unwrap();
    assert!(lifecycle(&restored).unwrap().distinct);
    assert!(store.curate("p", &path, &THRESHOLDS).unwrap().is_empty());
}

#[test]
fn edited_lessons_and_the_per_pass_limit_are_respected() {
    let (store, path) = fixture();
    let first = add(
        &store,
        &path,
        "Always run cargo fmt before committing changes.",
        "Task a",
    );
    add(
        &store,
        &path,
        "Always run cargo fmt before committing any changes.",
        "Task b",
    );
    let mut edited = entry(&store, &path, &first);
    edited.content.push_str(" Mine.");
    store.save(edited).unwrap();
    assert!(store.curate("p", &path, &THRESHOLDS).unwrap().is_empty());

    let limited = Thresholds {
        folds_per_curation: 1,
        ..THRESHOLDS
    };
    for topic in ["alpha", "bravo"] {
        add(
            &store,
            &path,
            &format!("Prefer {topic} widgets for dashboard panels."),
            "Task x",
        );
        add(
            &store,
            &path,
            &format!("Prefer {topic} widgets for dashboard panels always."),
            "Task y",
        );
    }
    assert_eq!(store.curate("p", &path, &limited).unwrap().len(), 1);
    assert_eq!(store.curate("p", &path, &limited).unwrap().len(), 1);
    assert!(store.curate("p", &path, &limited).unwrap().is_empty());
}
