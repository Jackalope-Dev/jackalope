use super::*;

fn fixture() -> (KnowledgeStore, SyncProject) {
    let root = std::env::temp_dir().join(format!("jackalope-sync-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let store = KnowledgeStore::new(root.join("knowledge/entries.json"));
    let path = canonical(root.to_str().unwrap()).unwrap();
    let project = SyncProject {
        key: "c".repeat(64),
        project_id: "p".into(),
        path,
    };
    (store, project)
}

fn said(text: &str, reference: &str, run: Option<&str>) -> Observation {
    Observation {
        kind: ObservationKind::Statement,
        text: text.into(),
        reference: reference.into(),
        run_id: run.map(str::to_string),
    }
}

fn learn(store: &KnowledgeStore, project: &SyncProject, text: &str) -> KnowledgeEntry {
    let existing = store.list("p", &project.path).unwrap();
    store
        .promote(
            "p",
            &project.path,
            reflect(
                &[said(text, "Task private-run", Some("private-run"))],
                &existing,
            ),
            "reflection",
        )
        .unwrap();
    store
        .list("p", &project.path)
        .unwrap()
        .into_iter()
        .find(|entry| entry.content.contains(text))
        .unwrap()
}

fn body(statement: &str) -> SyncedBody {
    SyncedBody {
        title: "User preference".into(),
        content: format!("Previously requested by the user: {statement}"),
        keywords: vec!["rebase".into()],
        enabled: true,
        kind: "preference".into(),
        status: PROBATION.into(),
        statement: statement.into(),
        origin: "reflection".into(),
        born_at: "2026-10-01T00:00:00+00:00".into(),
        archived_reason: None,
        managed: true,
        distinct: false,
    }
}

#[test]
fn uploads_carry_only_allowlisted_fields() {
    let (store, project) = fixture();
    let entry = learn(
        &store,
        &project,
        "Always run pnpm verify before committing.",
    );
    store
        .record_delivery(
            "p",
            &project.path,
            "run-1",
            std::slice::from_ref(&entry.id),
            true,
        )
        .unwrap();
    let outgoing = store
        .sync_outgoing(
            std::slice::from_ref(&project),
            "account",
            &SyncState::default(),
        )
        .unwrap();
    assert_eq!(outgoing.lessons.len(), 1);
    let wire = serde_json::to_string(&outgoing.lessons[0]).unwrap();
    for local in [
        "private-run",
        "run-1",
        "deliveries",
        "recentRuns",
        "evidence",
        "opportunities",
        "projectPath",
        "\"p\"",
    ] {
        assert!(!wire.contains(local), "{local} leaked into {wire}");
    }
    assert!(!wire.contains(&project.path.replace('\\', "\\\\")));
    assert_eq!(outgoing.records.len(), 1);
    let history = serde_json::to_string(&outgoing.records).unwrap();
    assert!(!history.contains("private-run"), "{history}");

    // Exchanged lessons are not uploaded again until they change.
    let mut state = SyncState::default();
    let mut account = AccountSync::default();
    account.synced.insert(entry.id.clone(), marker(&entry));
    account
        .records_after
        .insert(project.key.clone(), "9999".into());
    state.accounts.insert("account".into(), account);
    let again = store
        .sync_outgoing(std::slice::from_ref(&project), "account", &state)
        .unwrap();
    assert!(again.lessons.is_empty() && again.records.is_empty());

    // A lesson exchanged with another account is never uploaded to this one.
    let mut state = SyncState::default();
    state.owners.insert(entry.id.clone(), "first".into());
    let other = store.sync_outgoing(&[project], "second", &state).unwrap();
    assert!(other.lessons.is_empty() && other.records.is_empty());
}

#[test]
fn sensitive_edits_stay_local_and_removals_sync_as_tombstones() {
    let (store, project) = fixture();
    let entry = learn(
        &store,
        &project,
        "Prefer small focused commits in this repo.",
    );
    let mut edited = entry.clone();
    edited.content = format!("Ask {} before merging.", ["owner", "@example.com"].concat());
    let edited = store.save(edited).unwrap();
    let outgoing = store
        .sync_outgoing(
            std::slice::from_ref(&project),
            "account",
            &SyncState::default(),
        )
        .unwrap();
    assert!(outgoing.lessons.is_empty());
    assert_eq!(outgoing.kept_local, 1);
    store.remove(&edited.id, edited.revision).unwrap();
    let outgoing = store
        .sync_outgoing(&[project], "account", &SyncState::default())
        .unwrap();
    assert_eq!(outgoing.lessons.len(), 1);
    assert!(outgoing.lessons[0].deleted && outgoing.lessons[0].lesson.is_none());
}

#[test]
fn downloads_merge_by_revision_and_keep_local_counts() {
    let (store, project) = fixture();
    let entry = learn(&store, &project, "Always use pnpm instead of npm here.");
    store
        .record_delivery(
            "p",
            &project.path,
            "run-1",
            std::slice::from_ref(&entry.id),
            true,
        )
        .unwrap();
    let entry = store.list("p", &project.path).unwrap().remove(0);
    let mut remote = outgoing_lesson(&entry, &project.key).unwrap();
    // An older copy changes nothing.
    remote.updated_at = 1;
    remote.lesson.as_mut().unwrap().title = "Older title".into();
    let (shared, changed) = store
        .sync_apply(
            std::slice::from_ref(&project),
            std::slice::from_ref(&remote),
            &[],
        )
        .unwrap();
    assert_eq!(changed, 0);
    assert!(shared.is_empty());
    // A newer copy replaces the synced fields only.
    remote.revision = entry.revision + 1;
    remote.updated_at = millis(&entry.updated_at) + 10;
    remote.lesson.as_mut().unwrap().title = "Newer title".into();
    remote.lesson.as_mut().unwrap().status = ACTIVE.into();
    let (shared, changed) = store
        .sync_apply(
            std::slice::from_ref(&project),
            std::slice::from_ref(&remote),
            &[],
        )
        .unwrap();
    assert_eq!(changed, 1);
    assert_eq!(shared[&entry.id], (remote.revision, remote.updated_at));
    let local = store.list("p", &project.path).unwrap().remove(0);
    assert_eq!(local.title, "Newer title");
    assert_eq!(marker(&local), (remote.revision, remote.updated_at));
    let state = lifecycle(&local).unwrap();
    assert_eq!(state.status, ACTIVE);
    assert_eq!(state.deliveries, 1, "use counts stay local");
    assert_eq!(local.automatic.as_ref().unwrap().evidence.len(), 1);
    // A tombstone removes it and keeps the suppression.
    let removed = SyncedLesson {
        revision: remote.revision + 1,
        deleted: true,
        lesson: None,
        ..remote.clone()
    };
    store
        .sync_apply(std::slice::from_ref(&project), &[removed], &[])
        .unwrap();
    assert!(store.list("p", &project.path).unwrap().is_empty());
    let report = store
        .promote(
            "p",
            &project.path,
            reflect(
                &[said(
                    "Always use pnpm instead of npm here.",
                    "Task again",
                    None,
                )],
                &[],
            ),
            "reflection",
        )
        .unwrap();
    assert!(report.applied.is_empty());
}

#[test]
fn new_lessons_and_history_arrive_once_without_evidence() {
    let (store, project) = fixture();
    let id = learned_id("elsewhere", "preference:x");
    let remote = SyncedLesson {
        id: id.clone(),
        project: project.key.clone(),
        revision: 3,
        updated_at: 5_000,
        deleted: false,
        lesson: Some(body("Prefer rebase merges.")),
    };
    let record = SyncedRecord {
        id: uuid::Uuid::new_v4().to_string(),
        entry_id: id.clone(),
        project: project.key.clone(),
        at: "2026-10-01T00:00:00+00:00".into(),
        action: "born".into(),
        reason: "Learned a preference.".into(),
        revision: 1,
        origin: "reflection".into(),
        title: "User preference".into(),
    };
    let unknown = SyncedLesson {
        id: uuid::Uuid::new_v4().to_string(),
        project: "d".repeat(64),
        ..remote.clone()
    };
    for _ in 0..2 {
        store
            .sync_apply(
                std::slice::from_ref(&project),
                &[remote.clone(), unknown.clone()],
                std::slice::from_ref(&record),
            )
            .unwrap();
    }
    let entries = store.list("p", &project.path).unwrap();
    assert_eq!(entries.len(), 1);
    let entry = &entries[0];
    assert_eq!(entry.id, id);
    assert!(entry.automatic.as_ref().unwrap().evidence.is_empty());
    assert_eq!(lifecycle(entry).unwrap().deliveries, 0);
    let history = store.history("p", &id, 10);
    assert_eq!(history.len(), 1);
    assert!(history[0].evidence.is_empty());
}

#[test]
fn invalid_remote_lessons_are_ignored() {
    let (store, project) = fixture();
    let mut long = body("Prefer rebase merges.");
    long.content = "x".repeat(801);
    let mut status = body("Prefer rebase merges.");
    status.status = "pinned".into();
    for lesson in [Some(long), Some(status), None] {
        let remote = SyncedLesson {
            id: uuid::Uuid::new_v4().to_string(),
            project: project.key.clone(),
            revision: 1,
            updated_at: 1,
            deleted: false,
            lesson,
        };
        let (_, changed) = store
            .sync_apply(std::slice::from_ref(&project), &[remote], &[])
            .unwrap();
        assert_eq!(changed, 0);
    }
}

#[test]
fn uploads_split_under_service_limits() {
    let mut full = body(&"s".repeat(500));
    full.title = "t".repeat(120);
    full.content = "c".repeat(800);
    full.keywords = vec!["k".repeat(60); 10];
    let lesson = SyncedLesson {
        id: uuid::Uuid::new_v4().to_string(),
        project: "c".repeat(64),
        revision: 1,
        updated_at: 1,
        deleted: false,
        lesson: Some(full),
    };
    let outgoing = Outgoing {
        lessons: vec![lesson; 60],
        records: vec![],
        kept_local: 0,
    };
    let batches = batches(outgoing);
    assert!(batches.len() > 3);
    for (lessons, records) in &batches {
        assert!(lessons.len() <= LESSONS_PER_PUSH && records.len() <= RECORDS_PER_PUSH);
        let body = serde_json::json!({ "epoch": 1, "lessons": lessons, "records": records });
        assert!(serde_json::to_vec(&body).unwrap().len() < 32_768);
    }
}

#[test]
fn the_project_key_comes_from_root_commits_not_the_path() {
    let (_, project) = fixture();
    assert_eq!(project_key(&project.path), None);
    let (projects, unavailable) = sync_projects(&[("p".into(), project.path.clone())]);
    assert!(projects.is_empty());
    assert_eq!(unavailable, 1);
}
