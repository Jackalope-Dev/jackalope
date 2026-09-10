use super::*;

fn fixture() -> (PathBuf, TaskRuntime, String) {
    let directory =
        std::env::temp_dir().join(format!("jackalope-journal-{}", uuid::Uuid::new_v4()));
    let runtime = TaskRuntime::new(directory.clone()).unwrap();
    let mut run = tests::sample("codex");
    run.result = "baseline".into();
    let id = run.id.clone();
    runtime.save(&run).unwrap();
    runtime.inner.lock().unwrap().runs.insert(id.clone(), run);
    (directory, runtime, id)
}

#[test]
fn writer_shutdown_releases_history_ownership_after_pending_writes() {
    let (directory, runtime, id) = fixture();
    assert_eq!(Arc::strong_count(&runtime._owner), 1);
    let mut run = runtime.inner.lock().unwrap().runs[&id].clone();
    run.result = "queued before shutdown".into();
    let pending = runtime.writer.submit(run, false).unwrap();
    drop(runtime);
    journal::Writer::wait(pending).unwrap();
    let restored = TaskRuntime::new(directory.clone()).unwrap();
    assert_eq!(
        restored.inner.lock().unwrap().runs[&id].result,
        "queued before shutdown"
    );
    drop(restored);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn output_journal_recovers_unicode_and_compacts_at_a_checkpoint() {
    let (directory, runtime, id) = fixture();
    for _ in 0..20 {
        runtime
            .update_output(&id, |run| run.result.push_str(" Unicode: 🦀\n"))
            .unwrap();
    }
    let path = directory.join(format!("{id}.json"));
    assert_eq!(
        serde_json::from_slice::<TaskRun>(&std::fs::read(&path).unwrap())
            .unwrap()
            .result,
        "baseline"
    );
    let recovered: TaskRun = serde_json::from_slice(&journal::read(&path).unwrap()).unwrap();
    assert_eq!(
        recovered.result,
        runtime.inner.lock().unwrap().runs[&id].result
    );
    runtime
        .update_checked(&id, |run| run.status = "review".into())
        .unwrap();
    assert!(!path.with_extension("journal").exists());
    drop(runtime);
    let runtime = TaskRuntime::new(directory.clone()).unwrap();
    assert_eq!(
        runtime.inner.lock().unwrap().runs[&id].result,
        recovered.result
    );
    drop(runtime);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn partial_journal_preserves_acknowledged_output_and_original_bytes() {
    let (directory, runtime, id) = fixture();
    runtime
        .update_output(&id, |run| run.result.push_str(" saved"))
        .unwrap();
    drop(runtime);
    let path = directory.join(format!("{id}.journal"));
    std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(b"{\"sequence\":")
        .unwrap();
    let original = std::fs::read(&path).unwrap();
    let runtime = TaskRuntime::new(directory.clone()).unwrap();
    let inner = runtime.inner.lock().unwrap();
    assert_eq!(inner.runs[&id].result, "baseline saved");
    assert!(matches!(
        inner.runs[&id].status.as_str(),
        "interrupted" | "stopped"
    ));
    assert!(!inner.recovery.is_empty());
    drop(inner);
    assert!(std::fs::read_dir(&directory)
        .unwrap()
        .flatten()
        .any(
            |entry| entry.path().extension().is_some_and(|ext| ext == "corrupt")
                && std::fs::read(entry.path()).unwrap() == original
        ));
    drop(runtime);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn output_failure_is_visible_and_a_checkpoint_can_retry() {
    let (directory, runtime, id) = fixture();
    let journal = directory.join(format!("{id}.journal"));
    std::fs::create_dir(&journal).unwrap();
    assert!(runtime
        .update_output(&id, |run| run.result = "newest output".into())
        .is_err());
    assert!(runtime.ensure_history_saved().is_err());
    std::fs::remove_dir(&journal).unwrap();
    runtime.update_checked(&id, |_| {}).unwrap();
    runtime.ensure_history_saved().unwrap();
    let saved: TaskRun =
        serde_json::from_slice(&journal::read(&directory.join(format!("{id}.json"))).unwrap())
            .unwrap();
    assert_eq!(saved.result, "newest output");
    drop(runtime);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn changes_omit_unchanged_runs_and_restore_selected_details() {
    let (directory, runtime, id) = fixture();
    let initial = runtime.changes(None, None, None);
    let revision = runtime
        .writer
        .revision
        .load(std::sync::atomic::Ordering::SeqCst);
    let json = serde_json::to_value(initial).unwrap();
    assert_eq!(json["runs"][0]["result"], "");
    assert_eq!(
        serde_json::to_value(runtime.changes(Some(revision), None, None)).unwrap()["runs"],
        serde_json::json!([])
    );
    let selected = serde_json::to_value(runtime.changes(Some(revision), Some(&id), None)).unwrap();
    assert_eq!(selected["runs"][0]["result"], "baseline");
    runtime
        .update_output(&id, |run| run.result.push('!'))
        .unwrap();
    assert_eq!(
        serde_json::to_value(runtime.changes(Some(revision), Some(&id), Some(&id))).unwrap()
            ["runs"][0]["result"],
        "baseline!"
    );
    drop(runtime);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn admission_waits_for_pending_writes_and_observes_failures_before_ui_updates() {
    let (directory, runtime, id) = fixture();
    std::fs::create_dir(directory.join(format!("{id}.journal"))).unwrap();
    let run = runtime.inner.lock().unwrap().runs[&id].clone();
    let pending = runtime.writer.submit(run, false).unwrap();
    assert!(runtime.ensure_history_saved().is_err());
    assert!(journal::Writer::wait(pending).is_err());
    drop(runtime);
    std::fs::remove_dir_all(directory).unwrap();
}
