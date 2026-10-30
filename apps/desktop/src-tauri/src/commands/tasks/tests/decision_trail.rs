use super::*;
use crate::commands::decision_trail::{check_evidence, record, RecordDecisionInput, MISSING};
use serde_json::json;

fn decision(supersedes: Option<&str>, evidence: &[&str]) -> RecordDecisionInput {
    serde_json::from_value(json!({
        "phase": "api", "decision": "Kept the existing route", "why": "Clients depend on it",
        "evidence": evidence, "result": "tests pass", "supersedes": supersedes
    }))
    .unwrap()
}

#[test]
fn decision_trail_is_append_only_checked_at_the_end_and_survives_restart_and_export() {
    let folder = std::env::temp_dir().join(format!("jackalope-trail-{}", uuid::Uuid::new_v4()));
    let directory = folder.join("history");
    let runtime = TaskRuntime::with_test_access(directory.clone()).unwrap();
    let mut run = sample("codex");
    run.status = "running".into();
    run.workspace = folder.to_string_lossy().into();
    runtime.save(&run).unwrap();
    runtime
        .inner
        .lock()
        .unwrap()
        .runs
        .insert(run.id.clone(), run.clone());

    let first = record(&runtime, &run, decision(None, &["src/missing.rs:3"])).unwrap();
    assert!(record(&runtime, &run, decision(Some("invented"), &[])).is_err());
    let second = record(&runtime, &run, decision(Some(&first.id), &[])).unwrap();
    assert_eq!(second.supersedes.as_deref(), Some(first.id.as_str()));

    check_evidence(&runtime, &run.id);
    runtime
        .update_checked(&run.id, |r| r.status = "review".into())
        .unwrap();
    assert!(
        record(&runtime, &run, decision(None, &[])).is_err(),
        "an ended attempt accepts no more entries"
    );

    let saved = runtime.run_snapshot(&run.id).unwrap();
    assert_eq!(saved.decisions.len(), 2);
    assert_eq!(saved.decisions[0].checks[0].state, MISSING);
    assert!(saved
        .activity
        .iter()
        .any(|line| line == "[Decision: api] Kept the existing route"));
    assert_eq!(saved.summary().decisions.len(), 2);

    let exported = folder.join("recovery.json");
    runtime.export_recovery(&run.id, &exported).unwrap();
    let recovery: Value = serde_json::from_slice(&std::fs::read(&exported).unwrap()).unwrap();
    assert_eq!(
        recovery["task"]["decisions"][1]["supersedes"],
        json!(first.id)
    );
    assert_eq!(
        recovery["task"]["decisions"][0]["checks"][0]["state"],
        "missing"
    );

    drop(runtime);
    let restarted = TaskRuntime::with_test_access(directory).unwrap();
    let loaded = restarted.run_snapshot(&run.id).unwrap();
    assert_eq!(loaded.decisions, saved.decisions);
    drop(restarted);
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn attempts_saved_before_the_trail_load_without_one() {
    let mut value = serde_json::to_value(sample("codex")).unwrap();
    value.as_object_mut().unwrap().remove("decisions");
    let run: TaskRun = serde_json::from_value(value).unwrap();
    assert!(run.decisions.is_empty());
    assert!(serde_json::to_value(&run)
        .unwrap()
        .get("decisions")
        .is_none());
}
