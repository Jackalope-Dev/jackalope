use super::*;

fn entry(id: usize, kind: KnowledgeKind, phrase: &str) -> KnowledgeEntry {
    KnowledgeEntry {
        process: Default::default(),
        id: format!("00000000-0000-4000-8000-{id:012}"),
        project_id: "project".into(),
        project_path: std::env::temp_dir().to_string_lossy().into(),
        kind,
        title: format!("Lesson {id}"),
        content: format!("Use saved project check {id}."),
        keywords: vec![phrase.into()],
        enabled: true,
        source_run_id: None,
        source_head: None,
        revision: 0,
        updated_at: String::new(),
    }
}

#[test]
fn selection_is_bounded_deterministic_and_respects_opt_out() {
    let entries: Vec<_> = (1..8)
        .map(|id| entry(id, KnowledgeKind::Memory, "release"))
        .collect();
    let receipt = select(
        entries.clone(),
        "Prepare RELEASE checks",
        &ContextSelection::default(),
    )
    .unwrap();
    assert_eq!(receipt.entries.len(), 3);
    assert_eq!(receipt.entries[0].id, entries[0].id);
    assert_eq!(receipt.bytes, receipt.text().len());
    assert!(
        select(entries.clone(), "prerelease", &ContextSelection::default())
            .unwrap()
            .entries
            .is_empty()
    );
    let selection = ContextSelection {
        excluded_memory_ids: vec![entries[0].id.clone()],
        ..Default::default()
    };
    assert_eq!(
        select(entries.clone(), "release", &selection)
            .unwrap()
            .entries[0]
            .id,
        entries[1].id
    );
    assert!(select(
        entries,
        "release",
        &ContextSelection {
            memory_off: true,
            ..Default::default()
        }
    )
    .unwrap()
    .entries
    .is_empty());
}

#[test]
fn workflows_are_explicit_and_unavailable_selection_fails() {
    let workflow = entry(1, KnowledgeKind::Workflow, "release");
    assert!(select(
        vec![workflow.clone()],
        "release",
        &ContextSelection::default()
    )
    .unwrap()
    .entries
    .is_empty());
    let selection = ContextSelection {
        workflow_id: Some(workflow.id.clone()),
        ..Default::default()
    };
    assert_eq!(
        select(vec![workflow.clone()], "unrelated", &selection)
            .unwrap()
            .entries
            .len(),
        1
    );
    assert!(select(vec![], "release", &selection).is_err());
    assert!(select(
        vec![KnowledgeEntry {
            enabled: false,
            ..workflow
        }],
        "release",
        &selection
    )
    .is_err());
}

#[test]
fn matching_does_not_repeat_supplied_or_duplicate_lessons() {
    let first = entry(1, KnowledgeKind::Memory, "release");
    let mut duplicate = entry(2, KnowledgeKind::Memory, "release");
    duplicate.content = first.content.clone();
    let receipt = select(
        vec![first.clone(), duplicate],
        "release",
        &ContextSelection::default(),
    )
    .unwrap();
    assert_eq!(receipt.entries.len(), 1);
    assert!(select(
        vec![first.clone()],
        &format!("release {}", first.content),
        &ContextSelection::default()
    )
    .unwrap()
    .entries
    .is_empty());
}

#[test]
fn persistence_preserves_revisions_scopes_and_corrupt_data() {
    let folder = std::env::temp_dir().join(format!("jackalope-knowledge-{}", uuid::Uuid::new_v4()));
    let path = folder.join("entries.json");
    let store = KnowledgeStore::new(path.clone());
    let original = store
        .save(entry(1, KnowledgeKind::Memory, "release"))
        .unwrap();
    assert!(store
        .save(entry(1, KnowledgeKind::Memory, "release"))
        .is_err());
    assert!(store
        .list("another", &original.project_path)
        .unwrap()
        .is_empty());
    let frozen = store
        .select(
            "project",
            &original.project_path,
            "release",
            &ContextSelection::default(),
        )
        .unwrap();
    let mut changed = original.clone();
    changed.content = "Updated lesson".into();
    let changed = store.save(changed).unwrap();
    assert_eq!(changed.revision, 2);
    assert_eq!(frozen.entries[0].content, original.content);
    assert!(store.remove(&changed.id, 1).is_err());
    store.remove(&changed.id, 2).unwrap();
    assert!(store.save(changed).is_err());
    std::fs::write(&path, "invalid").unwrap();
    assert!(store
        .save(entry(2, KnowledgeKind::Memory, "release"))
        .is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "invalid");
    assert!(store
        .select(
            "project",
            &original.project_path,
            "release",
            &ContextSelection {
                memory_off: true,
                ..Default::default()
            },
        )
        .unwrap()
        .entries
        .is_empty());
    std::fs::remove_file(&path).unwrap();
    std::fs::remove_dir(folder).unwrap();
}

#[test]
fn content_limits_count_bytes_and_memory_requires_phrases() {
    let folder = std::env::temp_dir().join(format!("jackalope-knowledge-{}", uuid::Uuid::new_v4()));
    let store = KnowledgeStore::new(folder.join("entries.json"));
    let mut value = entry(1, KnowledgeKind::Memory, "release");
    value.content = "é".repeat(401);
    assert!(store.save(value.clone()).is_err());
    value.content = "Concise lesson".into();
    value.keywords.clear();
    assert!(store.save(value).is_err());
    assert!(!folder.exists());
}
