use super::*;
use std::process::Command;

fn fixture() -> (PathBuf, LiveSessions, String) {
    let root = std::env::temp_dir().join(format!("jackalope-live-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    for args in [vec!["init", "-b", "main"], vec!["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "Fixture"]] {
        assert!(Command::new("git").current_dir(&root).args(args).output().unwrap().status.success());
    }
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
    let coordinator = Coordinator::new(root.join("coordination"), runtime.clone()).unwrap();
    let service = LiveSessions::new(root.join("sessions/sessions.json"), runtime, coordinator);
    let request: RunRequest = serde_json::from_value(serde_json::json!({"id": Uuid::new_v4().to_string(), "projectId":"fixture", "projectName":"Fixture", "projectPath":root.to_string_lossy(), "agent":"codex", "model":null, "prompt":"Session", "isolated":true, "previousRunId":null})).unwrap();
    let id = Uuid::new_v4().to_string();
    service.create(id.clone(), "Walkthrough".into(), request).unwrap();
    (root, service, id)
}

#[test]
fn messages_are_durable_idempotent_and_keep_order() {
    let (_root, service, id) = fixture();
    let first = Uuid::new_v4().to_string();
    service.send(&id, first.clone(), "Move the button".into(), None).unwrap();
    service.send(&id, first.clone(), "Move the button".into(), None).unwrap();
    assert!(service.send(&id, first, "Different text".into(), None).is_err());
    service.send(&id, Uuid::new_v4().to_string(), "Desktop only".into(), None).unwrap();
    let saved: Ledger = serde_json::from_slice(&std::fs::read(&service.path).unwrap()).unwrap();
    assert_eq!(saved.sessions[0].messages.len(), 2);
    let messages = saved.sessions[0].messages.iter().collect::<Vec<_>>();
    let prompt = batch_prompt(&saved.sessions[0], &messages);
    assert!(prompt.find("Move the button").unwrap() < prompt.find("Desktop only").unwrap());
    assert!(prompt.contains("Do not commit"));
}

#[test]
fn stale_drafts_do_not_overwrite_other_windows_or_new_typing() {
    let (_root, service, id) = fixture();
    let draft = service.draft(&id, "first".into(), 0).unwrap();
    assert!(service.draft(&id, "stale".into(), 0).is_err());
    service.draft(&id, "next thought".into(), draft.revision).unwrap();
    service.send(&id, Uuid::new_v4().to_string(), "first".into(), Some(draft.revision)).unwrap();
    assert_eq!(service.snapshot(None).unwrap().sessions[0].draft.text, "next thought");
}

#[test]
fn restart_pauses_dispatch_and_preserves_unclaimed_messages() {
    let (_root, service, id) = fixture();
    service.send(&id, Uuid::new_v4().to_string(), "Fix focus".into(), None).unwrap();
    let restored = LiveSessions::new(service.path.clone(), service.runtime.clone(), service.coordinator.clone());
    let snapshot = restored.snapshot(None).unwrap();
    assert!(snapshot.sessions[0].paused);
    assert!(snapshot.sessions[0].messages[0].run_id.is_none());
    assert!(!restored.tick().unwrap());
}

#[test]
fn cancel_and_finish_preserve_saved_work() {
    let (_root, service, id) = fixture();
    let message = Uuid::new_v4().to_string();
    service.send(&id, message.clone(), "Fix focus".into(), None).unwrap();
    service.action(&id, "cancel-message", Some(&message)).unwrap();
    assert!(service.snapshot(None).unwrap().sessions[0].messages[0].canceled);
    service.action(&id, "finish", None).unwrap();
    assert!(service.send(&id, Uuid::new_v4().to_string(), "More".into(), None).is_err());
    service.action(&id, "resume", None).unwrap();
    service.send(&id, Uuid::new_v4().to_string(), "More".into(), None).unwrap();
}

#[test]
fn corrupt_storage_is_not_replaced() {
    let (_root, service, id) = fixture();
    std::fs::write(&service.path, b"broken").unwrap();
    let restored = LiveSessions::new(service.path.clone(), service.runtime.clone(), service.coordinator.clone());
    assert!(restored.snapshot(None).unwrap().error.is_some());
    assert!(restored.send(&id, Uuid::new_v4().to_string(), "Fix".into(), None).is_err());
    assert_eq!(std::fs::read(&service.path).unwrap(), b"broken");
}

#[test]
fn session_checkpoints_never_create_commits() {
    let run = TaskRun {live_session_id: Some(Uuid::new_v4().to_string()), ..Default::default()};
    assert!(super::super::checkpoint::create(&run, std::path::Path::new("missing")).unwrap().is_none());
}
