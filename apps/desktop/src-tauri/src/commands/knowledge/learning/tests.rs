use super::*;

fn fixture() -> (PathBuf, KnowledgeStore, String) {
    let root = std::env::temp_dir().join(format!("jackalope-loop-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let store = KnowledgeStore::new(root.join("knowledge/entries.json"));
    let path = canonical(root.to_str().unwrap()).unwrap();
    (root, store, path)
}

fn said(text: &str, reference: &str) -> Observation {
    Observation {
        kind: ObservationKind::Statement,
        text: text.into(),
        reference: reference.into(),
        run_id: None,
    }
}

fn learn(store: &KnowledgeStore, path: &str, observations: &[Observation]) -> Promotion {
    let existing = store.list("p", path).unwrap();
    store
        .promote("p", path, reflect(observations, &existing), "reflection")
        .unwrap()
}

fn learned(store: &KnowledgeStore, path: &str) -> Vec<KnowledgeEntry> {
    store
        .list("p", path)
        .unwrap()
        .into_iter()
        .filter(|entry| lifecycle(entry).is_some())
        .collect()
}

#[test]
fn reflection_proposes_add_merge_patch_and_retire() {
    let (_root, store, path) = fixture();
    let report = learn(
        &store,
        &path,
        &[said(
            "Always run pnpm verify before committing changes.",
            "Task a",
        )],
    );
    assert_eq!(report.applied, ["Added: User preference"]);
    let entry = &learned(&store, &path)[0];
    let state = lifecycle(entry).unwrap();
    assert_eq!(state.status, PROBATION);
    assert_eq!(state.origin, "reflection");
    assert_eq!(entry.automatic.as_ref().unwrap().evidence, ["Task a"]);
    assert_eq!(
        entry.id,
        learned_id(
            "p",
            "preference:always run pnpm verify before committing changes"
        )
    );

    // The same instruction in another task is evidence, not a new lesson.
    let existing = store.list("p", &path).unwrap();
    let proposals = reflect(
        &[said(
            "Always run pnpm verify before committing changes.",
            "Task b",
        )],
        &existing,
    );
    assert!(matches!(&proposals[..], [Proposal::Merge { .. }]));
    let report = store.promote("p", &path, proposals, "reflection").unwrap();
    assert_eq!(report.applied, ["Seen again: User preference"]);
    assert_eq!(learned(&store, &path).len(), 1);
    // Seen from the same reference again changes nothing.
    let report = learn(
        &store,
        &path,
        &[said(
            "Always run pnpm verify before committing changes.",
            "Task b",
        )],
    );
    assert!(report.applied.is_empty());
    assert_eq!(report.known.len(), 1);

    // A contradicting instruction rewrites the older lesson instead of adding a rival.
    let existing = store.list("p", &path).unwrap();
    let proposals = reflect(
        &[said(
            "Never run pnpm verify before committing changes.",
            "Task c",
        )],
        &existing,
    );
    assert!(
        matches!(&proposals[..], [Proposal::Patch { target, .. }] if *target == existing[0].id)
    );
    store.promote("p", &path, proposals, "reflection").unwrap();
    let entries = learned(&store, &path);
    assert_eq!(entries.len(), 1);
    assert!(entries[0].content.contains("Never run pnpm verify"));
    assert_eq!(
        lifecycle(&entries[0]).unwrap().statement,
        "Never run pnpm verify before committing changes."
    );

    // Saying it no longer applies retires (archives) it.
    let existing = store.list("p", &path).unwrap();
    let proposals = reflect(
        &[said(
            "We no longer run pnpm verify before committing changes.",
            "Task d",
        )],
        &existing,
    );
    assert!(matches!(&proposals[..], [Proposal::Retire { .. }]));
    store.promote("p", &path, proposals, "reflection").unwrap();
    let entry = &learned(&store, &path)[0];
    assert!(lifecycle(entry).unwrap().archived());
    assert!(!entry.enabled);
    assert!(store
        .select(
            "p",
            &path,
            "run pnpm verify before committing",
            &Default::default()
        )
        .unwrap()
        .entries
        .is_empty());

    let actions: Vec<_> = store
        .history("p", &entry.id, 50)
        .into_iter()
        .map(|record| record.action)
        .collect();
    assert_eq!(actions, ["born", "merged", "patched", "retired"]);
}

#[test]
fn the_gate_redacts_rejects_secrets_and_never_touches_hand_written_knowledge() {
    let (_root, store, path) = fixture();
    let report = learn(
        &store,
        &path,
        &[
            said(
                "Always use sk-live1234567890abcdefXYZ for the staging API.",
                "Task a",
            ),
            said(
                "Always email deploy reports to ops@example.com after a release.",
                "Task a",
            ),
            said("use", "Task a"),
        ],
    );
    assert!(report.applied.is_empty());
    assert_eq!(report.rejected.len(), 2, "{report:?}");
    assert!(learned(&store, &path).is_empty());

    // Evidence is redacted before it is recorded.
    let lesson = Lesson {
        key: "preference:x".into(),
        kind: "preference".into(),
        title: "User preference".into(),
        statement: "Always prefer small focused commits for reviews.".into(),
        content: "Previously requested: Always prefer small focused commits for reviews.".into(),
        keywords: vec!["commits".into()],
        reference: "Task z".into(),
        excerpt: "mail me at someone@example.com, key=abcd1234 Bearer abc.def".into(),
        run_id: None,
    };
    store
        .promote("p", &path, vec![Proposal::Add(lesson)], "reflection")
        .unwrap();
    let entry = learned(&store, &path).remove(0);
    let evidence = &store.history("p", &entry.id, 5)[0].evidence[0];
    assert!(
        evidence.contains("[email]") && evidence.contains("key=[redacted]"),
        "{evidence}"
    );
    assert!(
        !evidence.contains("example.com")
            && !evidence.contains("abcd1234")
            && !evidence.contains("abc.def")
    );

    // A hand-written lesson is neither a merge, patch nor retire target, and
    // contradicting it is refused rather than fought.
    let manual = store
        .save(KnowledgeEntry {
            automatic: None,
            dismissed: false,
            process: Default::default(),
            id: uuid::Uuid::new_v4().to_string(),
            project_id: "p".into(),
            project_path: path.clone(),
            kind: KnowledgeKind::Memory,
            title: "Deploys".into(),
            content: "Always deploy staging from the release branch.".into(),
            keywords: vec!["deploy".into()],
            enabled: true,
            stale: None,
            enforced: None,
            source_run_id: None,
            source_head: None,
            revision: 0,
            updated_at: String::new(),
        })
        .unwrap();
    let report = learn(
        &store,
        &path,
        &[said(
            "Never deploy staging from the release branch.",
            "Task y",
        )],
    );
    assert!(report.applied.is_empty());
    assert!(
        report.rejected[0].contains("conflicts with \"Deploys\""),
        "{report:?}"
    );
    for proposal in [
        Proposal::Retire {
            target: manual.id.clone(),
            reason: "no".into(),
            reference: String::new(),
            excerpt: String::new(),
        },
        Proposal::Patch {
            target: manual.id.clone(),
            lesson: Lesson {
                key: "x".into(),
                kind: "preference".into(),
                title: "Deploys".into(),
                statement: "Never deploy staging from the release branch.".into(),
                content: "Never deploy staging from the release branch.".into(),
                keywords: vec!["deploy".into()],
                reference: "Task y".into(),
                excerpt: String::new(),
                run_id: None,
            },
        },
    ] {
        let report = store
            .promote("p", &path, vec![proposal], "reflection")
            .unwrap();
        assert_eq!(report.rejected.len(), 1);
    }
    let unchanged = store.list("p", &path).unwrap();
    let manual_now = unchanged.iter().find(|e| e.id == manual.id).unwrap();
    assert_eq!(manual_now.revision, manual.revision);
    assert!(manual_now.enabled);

    // Covered by a hand-written lesson: rejected as a duplicate.
    let report = learn(
        &store,
        &path,
        &[said(
            "Always deploy staging from the release branch.",
            "Task x",
        )],
    );
    assert!(report.rejected[0].contains("already covered"), "{report:?}");
}

#[test]
fn an_edited_or_removed_lesson_is_left_alone() {
    let (_root, store, path) = fixture();
    learn(
        &store,
        &path,
        &[said(
            "Prefer descriptive branch names for features.",
            "Task a",
        )],
    );
    let mut entry = learned(&store, &path).remove(0);
    entry.content = "Prefer descriptive branch names, such as feature/short-topic.".into();
    let edited = store.save(entry).unwrap();
    assert!(!edited.automatic.as_ref().unwrap().managed);
    let report = learn(
        &store,
        &path,
        &[said(
            "Never prefer descriptive branch names for features.",
            "Task b",
        )],
    );
    assert!(
        report
            .applied
            .iter()
            .all(|line| !line.starts_with("Updated")),
        "{report:?}"
    );
    assert_eq!(
        store
            .list("p", &path)
            .unwrap()
            .iter()
            .find(|e| e.id == edited.id)
            .unwrap()
            .revision,
        edited.revision
    );
    let actions: Vec<_> = store
        .history("p", &edited.id, 10)
        .into_iter()
        .map(|r| r.action)
        .collect();
    assert_eq!(actions, ["born", "edited"]);

    let (_root, store, path) = fixture();
    learn(
        &store,
        &path,
        &[said(
            "Prefer descriptive branch names for features.",
            "Task a",
        )],
    );
    let entry = learned(&store, &path).remove(0);
    store.remove(&entry.id, entry.revision).unwrap();
    let report = learn(
        &store,
        &path,
        &[said(
            "Prefer descriptive branch names for features.",
            "Task c",
        )],
    );
    assert!(
        report.rejected[0].contains("removed it earlier"),
        "{report:?}"
    );
    let actions: Vec<_> = store
        .history("p", &entry.id, 10)
        .into_iter()
        .map(|r| r.action)
        .collect();
    assert_eq!(actions, ["born", "deleted"]);
}

#[test]
fn lifecycle_promotes_used_lessons_and_archives_unused_ones() {
    let (_root, store, path) = fixture();
    learn(
        &store,
        &path,
        &[
            said(
                "Always keep migrations reversible in this repository.",
                "Task a",
            ),
            said("Prefer table-driven tests for parsers.", "Task a"),
        ],
    );
    let entries = learned(&store, &path);
    let used = entries
        .iter()
        .find(|e| e.content.contains("migrations"))
        .unwrap()
        .id
        .clone();
    let unused = entries
        .iter()
        .find(|e| e.content.contains("parsers"))
        .unwrap()
        .id
        .clone();
    let revision = entries.iter().find(|e| e.id == used).unwrap().revision;

    store
        .record_delivery("p", &path, "run-1", std::slice::from_ref(&used), true)
        .unwrap();
    // The same run is never counted twice.
    store
        .record_delivery("p", &path, "run-1", std::slice::from_ref(&used), true)
        .unwrap();
    let state = lifecycle(
        &learned(&store, &path)
            .into_iter()
            .find(|e| e.id == used)
            .unwrap(),
    )
    .cloned()
    .unwrap();
    assert_eq!(
        (state.deliveries, state.opportunities, state.status.as_str()),
        (1, 1, PROBATION)
    );
    store
        .record_delivery("p", &path, "run-2", std::slice::from_ref(&used), true)
        .unwrap();
    let promoted = learned(&store, &path)
        .into_iter()
        .find(|e| e.id == used)
        .unwrap();
    assert_eq!(lifecycle(&promoted).unwrap().status, ACTIVE);
    assert_eq!(
        promoted.revision,
        revision + 1,
        "only the status change bumps the revision"
    );

    for run in 3..=PROBATION_OPPORTUNITIES {
        store
            .record_delivery(
                "p",
                &path,
                &format!("run-{run}"),
                std::slice::from_ref(&used),
                true,
            )
            .unwrap();
    }
    let entries = learned(&store, &path);
    let stale = entries.iter().find(|e| e.id == unused).unwrap();
    let state = lifecycle(stale).unwrap();
    assert!(state.archived(), "{state:?}");
    assert_eq!(state.archived_reason.as_deref(), Some("unused"));
    assert!(
        lifecycle(entries.iter().find(|e| e.id == used).unwrap())
            .unwrap()
            .status
            == ACTIVE
    );

    // Restoring is reversible and restarts the count.
    let restored = store.set_archived(&unused, stale.revision, false).unwrap();
    let state = lifecycle(&restored).unwrap();
    assert_eq!((state.status.as_str(), state.opportunities), (PROBATION, 0));
    assert!(restored.enabled);
    let actions: Vec<_> = store
        .history("p", &unused, 10)
        .into_iter()
        .map(|r| r.action)
        .collect();
    assert_eq!(actions, ["born", "archived", "restored"]);

    // With automatic learning off, nothing is archived for lack of use.
    for run in 0..PROBATION_OPPORTUNITIES + 5 {
        store
            .record_delivery("p", &path, &format!("off-{run}"), &[], false)
            .unwrap();
    }
    assert!(!lifecycle(
        &learned(&store, &path)
            .into_iter()
            .find(|e| e.id == unused)
            .unwrap()
    )
    .unwrap()
    .archived());
}

/// Distinct nouns, three per lesson, so generated lessons share no
/// meaningful words.
const WORDS: [&str; 75] = [
    "parser",
    "router",
    "billing",
    "upload",
    "search",
    "cache",
    "ledger",
    "invoice",
    "webhook",
    "schema",
    "migration",
    "fixture",
    "locale",
    "tooltip",
    "sidebar",
    "keyboard",
    "printer",
    "modal",
    "cursor",
    "gradient",
    "thread",
    "socket",
    "queue",
    "worker",
    "cron",
    "bucket",
    "pebble",
    "harbor",
    "meadow",
    "lantern",
    "footer",
    "banner",
    "avatar",
    "badge",
    "chart",
    "legend",
    "axis",
    "toolbar",
    "dialog",
    "drawer",
    "toast",
    "spinner",
    "skeleton",
    "carousel",
    "slider",
    "stepper",
    "wizard",
    "accordion",
    "breadcrumb",
    "pagination",
    "calendar",
    "picker",
    "uploader",
    "dropzone",
    "editor",
    "terminal",
    "console",
    "inspector",
    "profiler",
    "tracer",
    "logger",
    "metric",
    "alert",
    "pager",
    "rota",
    "runbook",
    "playbook",
    "incident",
    "postmortem",
    "canary",
    "rollout",
    "flag",
    "experiment",
    "cohort",
    "funnel",
];

fn distinct_lesson(index: usize) -> String {
    let [a, b, c] = [0, 1, 2].map(|offset| WORDS[(index * 3 + offset) % WORDS.len()]);
    format!("Always review {a} {b} {c} changes.")
}

#[test]
fn near_duplicates_strengthen_the_saved_lesson_instead_of_adding() {
    let (_root, store, path) = fixture();
    let first = learn(
        &store,
        &path,
        &[said(
            "Always run the billing webhook tests before merging.",
            "Task a",
        )],
    );
    assert_eq!(first.applied.len(), 1, "{first:?}");
    let second = learn(
        &store,
        &path,
        &[said(
            "Always run billing webhook tests before merging please.",
            "Task b",
        )],
    );
    assert_eq!(
        learned(&store, &path)
            .into_iter()
            .filter(|e| live(e))
            .count(),
        1,
        "{second:?}"
    );
}

#[test]
fn capacity_archives_the_least_used_lesson_first() {
    let (_root, store, path) = fixture();
    let topics: Vec<String> = (0..PROJECT_CAPACITY).map(distinct_lesson).collect();
    for chunk in topics.chunks(ADDS_PER_REFLECTION) {
        let observations: Vec<_> = chunk.iter().map(|text| said(text, "Task a")).collect();
        let report = learn(&store, &path, &observations);
        assert_eq!(report.applied.len(), chunk.len(), "{report:?}");
    }
    let ids: Vec<String> = learned(&store, &path).into_iter().map(|e| e.id).collect();
    // Every lesson but the first gets a delivery.
    let first = learned(&store, &path)
        .into_iter()
        .find(|e| e.content.contains(WORDS[0]))
        .unwrap()
        .id;
    let others: Vec<String> = ids.into_iter().filter(|id| *id != first).collect();
    store
        .record_delivery("p", &path, "run", &others, false)
        .unwrap();
    let report = learn(
        &store,
        &path,
        &[said(
            "Always quarantine flaky snapshot fixtures overnight.",
            "Task b",
        )],
    );
    assert_eq!(report.applied.len(), 2, "{report:?}");
    let entries = learned(&store, &path);
    let evicted = entries.iter().find(|e| e.id == first).unwrap();
    assert_eq!(
        lifecycle(evicted).unwrap().archived_reason.as_deref(),
        Some("capacity")
    );
    assert_eq!(entries.iter().filter(|e| live(e)).count(), PROJECT_CAPACITY);
}

#[test]
fn one_reflection_adds_a_bounded_number_of_lessons() {
    let (_root, store, path) = fixture();
    let observations: Vec<_> = (0..ADDS_PER_REFLECTION + 3)
        .map(|index| said(&distinct_lesson(index), "Task a"))
        .collect();
    let report = learn(&store, &path, &observations);
    assert_eq!(report.applied.len(), ADDS_PER_REFLECTION);
    assert_eq!(report.rejected.len(), 3);
}

#[test]
fn saved_entries_without_a_lifecycle_load_unchanged() {
    let old = r#"{"id":"00000000-0000-4000-8000-000000000001","projectId":"p","projectPath":"/p","kind":"memory","title":"Lesson","content":"Use pnpm.","keywords":["pnpm"],"enabled":true,"sourceRunId":null,"revision":3,"updatedAt":"2026-01-01T00:00:00Z","automatic":{"kind":"preference","evidence":["Task a"],"managed":true}}"#;
    let entry: KnowledgeEntry = serde_json::from_str(old).unwrap();
    assert!(lifecycle(&entry).is_none());
    assert!(
        !owned(&entry),
        "pre-loop automatic lessons are not loop-owned"
    );
    let saved = serde_json::to_value(&entry).unwrap();
    assert!(saved["automatic"].get("lifecycle").is_none());
    // A status from a newer app still reads.
    let newer: Lifecycle = serde_json::from_str(r#"{"status":"pinned","futureField":1}"#).unwrap();
    assert!(!newer.archived() && !newer.on_probation());
}

#[test]
fn redaction_keeps_identifiers_and_replaces_secrets() {
    let (text, sensitive) = redact::scan(
        "commit 0123456789abcdef0123456789abcdef01234567 ok for 123e4567-e89b-12d3-a456-426614174000",
    );
    assert!(!sensitive, "{text}");
    // The AWS-shaped key is assembled at runtime so secret scanners do not
    // flag this fixture.
    let aws_key = ["AKIA", "ABCDEFGHIJKLMNOP"].concat();
    for secret in [
        "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        "https://user:pass@example.com/repo",
        aws_key.as_str(),
        "aB3dE5gH7jK9mN1pQ3sT5vX7zA9cE1gI3kM5",
        "password=hunter22",
    ] {
        let (text, sensitive) = redact::scan(&format!("use {secret} here"));
        assert!(sensitive, "{secret}");
        assert!(!text.contains(secret), "{text}");
    }
}

#[test]
fn ledger_appends_and_reads_per_entry() {
    let (root, _store, _path) = fixture();
    let directory = root.join("ledger");
    let make = |entry: &str, action: &str| LedgerRecord {
        id: uuid::Uuid::new_v4().to_string(),
        entry_id: entry.into(),
        project_id: "p".into(),
        at: Utc::now().to_rfc3339(),
        action: action.into(),
        reason: String::new(),
        revision: 1,
        origin: "test".into(),
        title: String::new(),
        evidence: vec![],
    };
    ledger::append(&directory, &[make("a", "born"), make("b", "born")]).unwrap();
    ledger::append(&directory, &[make("a", "merged")]).unwrap();
    let file = std::fs::read_dir(&directory)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    // A torn final line does not hide earlier history.
    std::fs::OpenOptions::new()
        .append(true)
        .open(&file)
        .unwrap()
        .write_all(b"{\"id\":")
        .unwrap();
    let actions: Vec<_> = ledger::read(&directory, "p", "a", 10)
        .into_iter()
        .map(|r| r.action)
        .collect();
    assert_eq!(actions, ["born", "merged"]);
    assert_eq!(ledger::read(&directory, "p", "a", 1)[0].action, "merged");
    assert!(ledger::read(&directory, "other", "a", 10).is_empty());
}

#[test]
fn watcher_reflects_on_cadence_and_at_the_end_only() {
    use crate::commands::tasks::RunActivity;
    let activity = |calls: u64, finished: bool| {
        vec![RunActivity {
            id: "r".into(),
            project_id: "p".into(),
            tool_calls: calls,
            finished,
        }]
    };
    let mut progress = vec![];
    // The first pass records history without reflecting on it.
    assert!(watcher::due_for_tests(&mut progress, &activity(120, true), true, true, 50).is_empty());
    assert!(
        watcher::due_for_tests(&mut progress, &activity(120, true), false, true, 50).is_empty()
    );

    let mut progress = vec![];
    assert!(watcher::due_for_tests(&mut progress, &activity(0, false), true, true, 50).is_empty());
    assert!(
        watcher::due_for_tests(&mut progress, &activity(49, false), false, true, 50).is_empty()
    );
    assert_eq!(
        watcher::due_for_tests(&mut progress, &activity(50, false), false, true, 50),
        ["r"]
    );
    assert!(
        watcher::due_for_tests(&mut progress, &activity(60, false), false, true, 50).is_empty()
    );
    assert_eq!(
        watcher::due_for_tests(&mut progress, &activity(61, true), false, true, 50),
        ["r"]
    );
    assert!(watcher::due_for_tests(&mut progress, &activity(61, true), false, true, 50).is_empty());

    let mut progress = vec![];
    watcher::due_for_tests(&mut progress, &activity(0, false), true, false, 50);
    assert!(
        watcher::due_for_tests(&mut progress, &activity(500, true), false, false, 50).is_empty()
    );
}

#[test]
fn observations_come_from_the_persons_words_answers_and_passing_checks() {
    let run: crate::commands::tasks::TaskRun = serde_json::from_value(serde_json::json!({
        "id": "r1", "taskId": "r1", "projectId": "p", "projectName": "Project", "projectPath": "/p",
        "workspace": "/p", "branch": "main", "baseHead": "abc", "agent": "codex", "account": "default",
        "model": null, "prompt": "### 🎯 Objective\nAlways keep focus inside dialogs.\n\n### Notes\nNever mention this.", "status": "review", "startedAt": "2026-09-09T12:00:00Z",
        "endedAt": null, "sessionId": null, "result": "Always trust the agent.",
        "activity": [], "error": null, "persistenceError": null, "exitCode": 0,
        "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "reported": false, "estimatedCostUsd": null}
    }))
    .unwrap();
    let found = watcher::observations(&run, None);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].text, "Always keep focus inside dialogs.");
    assert_eq!(found[0].reference, "Task r1");
    let mut session_run = run.clone();
    session_run.live_session_id = Some("s".into());
    assert!(watcher::observations(&session_run, None).is_empty());
    let found = watcher::observations(&session_run, Some(vec!["Prefer short replies.".into()]));
    assert_eq!(found[0].reference, "Conversation s · task r1");
}

use std::io::Write;

#[test]
fn metrics_count_statuses_deliveries_and_recorded_changes() {
    let (_root, store, path) = fixture();
    learn(
        &store,
        &path,
        &[
            said(
                "Always keep migrations reversible in this repository.",
                "Task a",
            ),
            said("Prefer table-driven tests for parsers.", "Task a"),
        ],
    );
    let entries = learned(&store, &path);
    let used = entries[0].id.clone();
    for run in ["run-1", "run-2"] {
        store
            .record_delivery("p", &path, run, std::slice::from_ref(&used), true)
            .unwrap();
    }
    let other = learned(&store, &path)
        .into_iter()
        .find(|entry| entry.id != used)
        .unwrap();
    let archived = store.set_archived(&other.id, other.revision, true).unwrap();
    store
        .set_archived(&other.id, archived.revision, false)
        .unwrap();
    let metrics = store.metrics("p", &path).unwrap();
    assert_eq!(
        (metrics.probation, metrics.active, metrics.archived),
        (1, 1, 0)
    );
    assert_eq!(metrics.deliveries, 2);
    assert_eq!(
        (
            metrics.learned,
            metrics.promoted,
            metrics.archived_events,
            metrics.restored
        ),
        (2, 1, 1, 1)
    );
    assert!(metrics.since.is_some());
}

#[test]
fn pulled_active_lessons_are_not_archived_for_lack_of_local_use() {
    let (_root, store, path) = fixture();
    learn(
        &store,
        &path,
        &[said(
            "Always keep migrations reversible in this repository.",
            "Task a",
        )],
    );
    let mut entry = learned(&store, &path).remove(0);
    entry
        .automatic
        .as_mut()
        .unwrap()
        .lifecycle
        .as_mut()
        .unwrap()
        .status = ACTIVE.into();
    {
        let _lock = store.lock.lock().unwrap();
        store.write(&[entry.clone()]).unwrap();
    }
    for run in 0..PROBATION_OPPORTUNITIES + 5 {
        store
            .record_delivery("p", &path, &format!("run-{run}"), &[], true)
            .unwrap();
    }
    assert!(!lifecycle(&learned(&store, &path).remove(0))
        .unwrap()
        .archived());
}

fn find(store: &KnowledgeStore, path: &str, needle: &str) -> KnowledgeEntry {
    learned(store, path)
        .into_iter()
        .find(|entry| entry.content.contains(needle))
        .unwrap()
}

fn answered(text: &str) -> Observation {
    Observation {
        kind: ObservationKind::Answer {
            question: "Anything else?".into(),
        },
        text: text.into(),
        reference: "Task a".into(),
        run_id: None,
    }
}

/// Judges what the person said in `run_id` against the lessons supplied.
fn judge(
    store: &KnowledgeStore,
    path: &str,
    run_id: &str,
    delivered: &[KnowledgeEntry],
    observations: &[Observation],
) -> Vec<Outcome> {
    let found = outcomes(observations, delivered, true, &THRESHOLDS);
    store
        .record_outcomes("p", path, run_id, &found, &THRESHOLDS)
        .unwrap();
    found
}

#[test]
fn restating_a_supplied_lesson_counts_as_a_miss_once_per_run() {
    let (_root, store, path) = fixture();
    learn(
        &store,
        &path,
        &[said(
            "Always run pnpm verify before committing changes.",
            "Task a",
        )],
    );
    let lesson = find(&store, &path, "pnpm verify");
    let correction = said(
        "You forgot to run pnpm verify before committing changes.",
        "Task a",
    );
    // The request that selected the lesson is not a correction; a typed
    // answer always comes after delivery.
    assert!(outcomes(
        std::slice::from_ref(&correction),
        std::slice::from_ref(&lesson),
        false,
        &THRESHOLDS
    )
    .is_empty());
    assert_eq!(
        outcomes(
            &[answered(
                "Please run pnpm verify before committing changes."
            )],
            std::slice::from_ref(&lesson),
            false,
            &THRESHOLDS
        )
        .len(),
        1
    );
    // Unrelated words and check commands are never misses.
    assert!(outcomes(
        &[
            said("Rename the sidebar toggle.", "Task a"),
            Observation {
                kind: ObservationKind::Check,
                text: "pnpm verify".into(),
                reference: "Task a".into(),
                run_id: None,
            }
        ],
        std::slice::from_ref(&lesson),
        true,
        &THRESHOLDS
    )
    .is_empty());

    store
        .record_delivery("p", &path, "run-1", std::slice::from_ref(&lesson.id), true)
        .unwrap();
    let found = judge(
        &store,
        &path,
        "run-2",
        std::slice::from_ref(&lesson),
        std::slice::from_ref(&correction),
    );
    assert!(matches!(
        &found[..],
        [Outcome {
            contradicted: false,
            ..
        }]
    ));
    // Reflecting on the same run again does not count it twice.
    judge(
        &store,
        &path,
        "run-2",
        std::slice::from_ref(&lesson),
        std::slice::from_ref(&correction),
    );
    let state = lifecycle(&find(&store, &path, "pnpm verify"))
        .cloned()
        .unwrap();
    assert_eq!((state.misses, state.missed_often), (1, false));
    assert!(state.on_probation());
    let history = store.history("p", &lesson.id, 10);
    assert_eq!(history.last().unwrap().action, "missed");
    assert!(history.last().unwrap().evidence[0].contains("You forgot"));

    // A second miss within the window on a lesson still on probation archives it.
    judge(
        &store,
        &path,
        "run-3",
        std::slice::from_ref(&lesson),
        std::slice::from_ref(&correction),
    );
    let entry = find(&store, &path, "pnpm verify");
    let state = lifecycle(&entry).unwrap();
    assert_eq!(state.misses, 2);
    assert!(state.missed_often);
    assert_eq!(
        (state.archived(), state.archived_reason.as_deref()),
        (true, Some(IGNORED))
    );
    assert!(!entry.enabled);
    assert!(attention(&entry).is_none(), "the archive reason says why");
    let actions: Vec<_> = store
        .history("p", &lesson.id, 10)
        .into_iter()
        .map(|record| record.action)
        .collect();
    assert_eq!(actions, ["born", "missed", "missed", "archived"]);
    let metrics = store.metrics("p", &path).unwrap();
    assert_eq!((metrics.missed, metrics.contradicted), (2, 0));

    // Restoring starts the count again.
    let restored = store
        .set_archived(&entry.id, entry.revision, false)
        .unwrap();
    let state = lifecycle(&restored).unwrap();
    assert!(state.corrections.is_empty() && !state.missed_often);
}

#[test]
fn an_active_lesson_agents_keep_missing_is_flagged_and_supplied_first() {
    let (_root, store, path) = fixture();
    learn(
        &store,
        &path,
        &[
            said(
                "Always keep migrations reversible in this repository.",
                "Task a",
            ),
            said("Prefer table-driven tests for parsers.", "Task a"),
        ],
    );
    let migrations = find(&store, &path, "migrations");
    let parsers = find(&store, &path, "parsers");
    // Miss the lesson that sorts last by id, so the flag decides the order.
    let (missed, other, line) = if migrations.id > parsers.id {
        (
            migrations,
            parsers,
            "Again: keep migrations reversible in this repository, please.",
        )
    } else {
        (
            parsers,
            migrations,
            "Again, use table-driven tests for parsers.",
        )
    };
    for run in ["run-1", "run-2"] {
        store
            .record_delivery(
                "p",
                &path,
                run,
                &[missed.id.clone(), other.id.clone()],
                true,
            )
            .unwrap();
    }
    let order = |store: &KnowledgeStore| -> Vec<String> {
        store
            .select("p", &path, "repository parsers", &Default::default())
            .unwrap()
            .entries
            .into_iter()
            .map(|entry| entry.id)
            .collect()
    };
    assert_eq!(order(&store), [other.id.clone(), missed.id.clone()]);
    for run in ["run-3", "run-4"] {
        judge(
            &store,
            &path,
            run,
            std::slice::from_ref(&missed),
            &[said(line, "Task a")],
        );
    }
    let entry = find(&store, &path, &missed.content);
    let state = lifecycle(&entry).unwrap();
    assert_eq!(state.status, ACTIVE, "an active lesson is kept");
    assert!(state.missed_often && entry.enabled);
    assert_eq!(
        attention(&entry).as_deref(),
        Some("agents keep missing this")
    );
    assert_eq!(order(&store), [missed.id.clone(), other.id.clone()]);

    // The flag clears once the misses fall out of the delivery window.
    for run in 0..THRESHOLDS.miss_window {
        let flagged = lifecycle(&find(&store, &path, &missed.content))
            .unwrap()
            .missed_often;
        assert!(flagged, "still flagged before delivery {run}");
        store
            .record_delivery(
                "p",
                &path,
                &format!("later-{run}"),
                std::slice::from_ref(&missed.id),
                true,
            )
            .unwrap();
    }
    assert!(
        !lifecycle(&find(&store, &path, &missed.content))
            .unwrap()
            .missed_often
    );
}

#[test]
fn a_contradiction_patches_the_lesson_that_was_supplied() {
    let (_root, store, path) = fixture();
    learn(
        &store,
        &path,
        &[
            said(
                "Always run pnpm verify before committing changes.",
                "Task a",
            ),
            said(
                "Always run pnpm verify before pushing release branches.",
                "Task a",
            ),
        ],
    );
    let committing = find(&store, &path, "committing");
    let pushing = find(&store, &path, "pushing");
    let line = said(
        "Never run pnpm verify before committing or pushing release changes.",
        "Task b",
    );
    let existing = store.list("p", &path).unwrap();
    // Without a delivery the closest lesson is the target...
    assert!(matches!(
        &reflect(std::slice::from_ref(&line), &existing)[..],
        [Proposal::Patch { target, .. }] if *target == committing.id
    ));
    // ...but the lesson the agent was given is the one corrected.
    let proposals = reflect_delivered(
        std::slice::from_ref(&line),
        &existing,
        std::slice::from_ref(&pushing.id),
    );
    assert!(matches!(
        &proposals[..],
        [Proposal::Patch { target, .. }] if *target == pushing.id
    ));
    let found = judge(
        &store,
        &path,
        "run-1",
        std::slice::from_ref(&pushing),
        std::slice::from_ref(&line),
    );
    assert_eq!(found.len(), 1);
    assert!(found[0].contradicted);
    assert_eq!(found[0].entry_id, pushing.id);
    store.promote("p", &path, proposals, "reflection").unwrap();
    let patched = learned(&store, &path)
        .into_iter()
        .find(|entry| entry.id == pushing.id)
        .unwrap();
    assert!(patched.content.contains("Never run pnpm verify"));
    assert_eq!(
        lifecycle(&patched).unwrap().misses,
        0,
        "a contradiction is not a miss"
    );
    let actions: Vec<_> = store
        .history("p", &pushing.id, 10)
        .into_iter()
        .map(|record| record.action)
        .collect();
    assert_eq!(actions, ["born", "contradicted", "patched"]);
    let untouched = learned(&store, &path)
        .into_iter()
        .find(|entry| entry.id == committing.id)
        .unwrap();
    assert_eq!(untouched.revision, committing.revision);
    // Reflecting on the run again, against the statement it was given, adds nothing.
    judge(
        &store,
        &path,
        "run-1",
        std::slice::from_ref(&pushing),
        std::slice::from_ref(&line),
    );
    assert_eq!(store.metrics("p", &path).unwrap().contradicted, 1);
}

#[test]
fn saved_lifecycles_from_before_outcomes_load_with_empty_counts() {
    let old = r#"{"id":"00000000-0000-4000-8000-000000000002","projectId":"p","projectPath":"/p","kind":"memory","title":"Lesson","content":"Use pnpm.","keywords":["pnpm"],"enabled":true,"sourceRunId":null,"revision":3,"updatedAt":"2026-01-01T00:00:00Z","automatic":{"kind":"preference","evidence":["Task a"],"managed":true,"lifecycle":{"status":"active","statement":"Always use pnpm for installs here.","origin":"reflection","bornAt":"2026-01-01T00:00:00Z","deliveries":4,"opportunities":9,"idle":2,"recentRuns":["r1"]}}}"#;
    let entry: KnowledgeEntry = serde_json::from_str(old).unwrap();
    assert!(entry.stale.is_none());
    let state = lifecycle(&entry).unwrap();
    assert_eq!(state.misses, 0);
    assert!(state.corrections.is_empty() && !state.missed_often);
    assert!(attention(&entry).is_none());
    // Unset fields stay out of the saved form, so older apps read it as before.
    let saved = serde_json::to_value(&entry).unwrap();
    assert!(saved.get("stale").is_none());
    let lifecycle = &saved["automatic"]["lifecycle"];
    for field in ["misses", "corrections", "missedOften"] {
        assert!(lifecycle.get(field).is_none(), "{field}");
    }
}
