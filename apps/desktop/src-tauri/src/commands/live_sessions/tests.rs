use super::*;
use std::process::Command;

fn fixture() -> (PathBuf, LiveSessions, String) {
    let root = std::env::temp_dir().join(format!("jackalope-live-{}", Uuid::new_v4()));
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    for args in [
        vec!["init", "-b", "main"],
        vec![
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "Fixture",
        ],
    ] {
        assert!(Command::new("git")
            .current_dir(&repo)
            .args(args)
            .output()
            .unwrap()
            .status
            .success());
    }
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
    let coordinator = Coordinator::new(root.join("coordination"), runtime.clone()).unwrap();
    let service = LiveSessions::new(root.join("sessions/sessions.json"), runtime, coordinator);
    let request: RunRequest = serde_json::from_value(serde_json::json!({"id": Uuid::new_v4().to_string(), "projectId":"fixture", "projectName":"Fixture", "projectPath":repo.to_string_lossy(), "agent":"codex", "model":null, "prompt":"Session", "isolated":true, "previousRunId":null})).unwrap();
    let id = Uuid::new_v4().to_string();
    service
        .create(id.clone(), "Walkthrough".into(), request)
        .unwrap();
    (root, service, id)
}

#[test]
fn messages_are_durable_idempotent_and_keep_order() {
    let (_root, service, id) = fixture();
    let first = Uuid::new_v4().to_string();
    service
        .send(&id, first.clone(), "Move the button".into(), None)
        .unwrap();
    service
        .send(&id, first.clone(), "Move the button".into(), None)
        .unwrap();
    assert!(service
        .send(&id, first, "Different text".into(), None)
        .is_err());
    service
        .send(&id, Uuid::new_v4().to_string(), "Desktop only".into(), None)
        .unwrap();
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
    service
        .draft(&id, "next thought".into(), draft.revision)
        .unwrap();
    service
        .send(
            &id,
            Uuid::new_v4().to_string(),
            "first".into(),
            Some(draft.revision),
        )
        .unwrap();
    assert_eq!(
        service.snapshot(None).unwrap().sessions[0].draft.text,
        "next thought"
    );
}

#[test]
fn restart_pauses_dispatch_and_preserves_unclaimed_messages() {
    let (_root, service, id) = fixture();
    service
        .send(&id, Uuid::new_v4().to_string(), "Fix focus".into(), None)
        .unwrap();
    let restored = LiveSessions::new(
        service.path.clone(),
        service.runtime.clone(),
        service.coordinator.clone(),
    );
    let snapshot = restored.snapshot(None).unwrap();
    assert!(snapshot.sessions[0].paused);
    assert!(snapshot.sessions[0].messages[0].run_id.is_none());
    assert!(!restored.tick().unwrap());
}

#[test]
fn cancel_and_finish_preserve_saved_work() {
    let (_root, service, id) = fixture();
    let message = Uuid::new_v4().to_string();
    service
        .send(&id, message.clone(), "Fix focus".into(), None)
        .unwrap();
    service
        .action(&id, "cancel-message", Some(&message))
        .unwrap();
    assert!(service.snapshot(None).unwrap().sessions[0].messages[0].canceled);
    service.action(&id, "finish", None).unwrap();
    assert!(service
        .send(&id, Uuid::new_v4().to_string(), "More".into(), None)
        .is_err());
    service.action(&id, "resume", None).unwrap();
    service
        .send(&id, Uuid::new_v4().to_string(), "More".into(), None)
        .unwrap();
}

#[test]
fn corrupt_storage_is_not_replaced() {
    let (_root, service, id) = fixture();
    std::fs::write(&service.path, b"broken").unwrap();
    let restored = LiveSessions::new(
        service.path.clone(),
        service.runtime.clone(),
        service.coordinator.clone(),
    );
    assert!(restored.snapshot(None).unwrap().error.is_some());
    assert!(restored
        .send(&id, Uuid::new_v4().to_string(), "Fix".into(), None)
        .is_err());
    assert_eq!(std::fs::read(&service.path).unwrap(), b"broken");
}

#[test]
fn session_checkpoints_never_create_commits() {
    let run = TaskRun {
        live_session_id: Some(Uuid::new_v4().to_string()),
        ..Default::default()
    };
    assert!(
        super::super::checkpoint::create(&run, std::path::Path::new("missing"))
            .unwrap()
            .is_none()
    );
}

#[test]
fn failed_save_retains_the_previous_ledger() {
    let (root, service, id) = fixture();
    service
        .send(&id, Uuid::new_v4().to_string(), "Saved".into(), None)
        .unwrap();
    std::fs::rename(root.join("sessions"), root.join("sessions-backup")).unwrap();
    std::fs::write(root.join("sessions"), b"unwritable parent").unwrap();
    assert!(service
        .send(&id, Uuid::new_v4().to_string(), "Unsaved".into(), None)
        .is_err());
    assert_eq!(
        service.snapshot(None).unwrap().sessions[0].messages.len(),
        1
    );
    let saved: Ledger =
        serde_json::from_slice(&std::fs::read(root.join("sessions-backup/sessions.json")).unwrap())
            .unwrap();
    assert_eq!(saved.sessions[0].messages[0].text, "Saved");
}

fn attach_run(root: &std::path::Path, service: &mut LiveSessions, id: &str, run: TaskRun) {
    let history = root.join(format!("history-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&history).unwrap();
    std::fs::write(
        history.join(format!("{}.json", run.id)),
        serde_json::to_vec(&run).unwrap(),
    )
    .unwrap();
    service.runtime = TaskRuntime::with_test_access(history).unwrap();
    service.coordinator = Coordinator::new(
        root.join(format!("coordination-{}", Uuid::new_v4())),
        service.runtime.clone(),
    )
    .unwrap();
    service
        .update(|ledger| {
            let session = LiveSessions::session(ledger, id)?;
            session.paused = true;
            session.batches.push(SessionBatch {
                run_id: run.id.clone(),
                message_ids: vec![],
                prompt: String::new(),
                previous_run_id: None,
                error: None,
                settled: false,
            });
            Ok(())
        })
        .unwrap();
}

#[test]
fn patch_export_preserves_the_index_and_includes_new_binary_files_without_a_commit() {
    let (root, mut service, id) = fixture();
    let repo = root.join("repo");
    let git = |path: &std::path::Path, args: &[&str]| {
        let output = Command::new("git")
            .current_dir(path)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_string()
    };
    std::fs::write(repo.join("tracked.txt"), b"initial\n").unwrap();
    git(&repo, &["add", "."]);
    git(
        &repo,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-m",
            "Tracked fixture",
        ],
    );
    let base = git(&repo, &["rev-parse", "HEAD"]);
    std::fs::write(repo.join("tracked.txt"), b"staged\n").unwrap();
    git(&repo, &["add", "."]);
    let index = std::fs::read(repo.join(".git/index")).unwrap();
    std::fs::write(repo.join("tracked.txt"), b"final\n").unwrap();
    std::fs::write(repo.join("new.txt"), b"new text\n").unwrap();
    let binary = [0, 1, 255, 128, 0, 42];
    std::fs::write(repo.join("image.bin"), binary).unwrap();
    let run = TaskRun {
        id: Uuid::new_v4().to_string(),
        live_session_id: Some(id.clone()),
        status: "review".into(),
        workspace: repo.to_string_lossy().into_owned(),
        project_path: repo.to_string_lossy().into_owned(),
        base_head: base.clone(),
        branch: "main".into(),
        ..Default::default()
    };
    attach_run(&root, &mut service, &id, run);
    let exported = service.review(&id).unwrap();
    assert_eq!(exported.files.len(), 3);
    assert!(exported.diff.contains("GIT binary patch"));
    assert!(!exported.verified);
    assert_eq!(git(&repo, &["rev-parse", "HEAD"]), base);
    assert_eq!(std::fs::read(repo.join(".git/index")).unwrap(), index);
    let target = root.join("apply");
    git(
        &root,
        &[
            "clone",
            "--no-hardlinks",
            repo.to_str().unwrap(),
            target.to_str().unwrap(),
        ],
    );
    git(&target, &["apply", "--check", &exported.patch_path]);
    git(&target, &["apply", &exported.patch_path]);
    assert_eq!(
        std::fs::read(target.join("tracked.txt")).unwrap(),
        b"final\n"
    );
    assert_eq!(
        std::fs::read(target.join("new.txt")).unwrap(),
        b"new text\n"
    );
    assert_eq!(std::fs::read(target.join("image.bin")).unwrap(), binary);
    assert_eq!(git(&target, &["rev-parse", "HEAD"]), base);
}

#[test]
fn finishing_a_failed_attempt_pauses_dispatch_without_replaying_messages() {
    let (root, mut service, id) = fixture();
    let run = TaskRun {
        id: Uuid::new_v4().to_string(),
        live_session_id: Some(id.clone()),
        status: "failed".into(),
        error: Some("Agent failed".into()),
        ..Default::default()
    };
    attach_run(&root, &mut service, &id, run);
    assert!(service.tick().unwrap());
    let snapshot = service.snapshot(Some(&id)).unwrap();
    assert!(snapshot.sessions[0].paused);
    assert!(snapshot.sessions[0].batches[0].settled);
    assert_eq!(snapshot.sessions[0].error.as_deref(), Some("Agent failed"));
    assert!(!service.tick().unwrap());
}

#[test]
#[cfg(windows)]
fn queued_messages_execute_once_in_the_same_uncommitted_workspace() {
    use crate::commands::agent_policy::{AgentPolicy, CustomAgent};
    let (root, service, id) = fixture();
    let executable = root.join("fixture.cmd");
    std::fs::write(&executable, "@echo off\r\nnode \"%~dp0fixture.cjs\"\r\n").unwrap();
    std::fs::write(root.join("fixture.cjs"), r#"
let prompt='';
process.stdin.on('data',chunk=>prompt+=chunk);
process.stdin.on('end',()=>{
 console.log(JSON.stringify({type:'thread.started',thread_id:'live-fixture-session'}));
 setTimeout(()=>{
  require('fs').appendFileSync('changes.txt','change\n');
  console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Fixture complete'}}));
 },800);
});
"#).unwrap();
    let mut policy = AgentPolicy::default();
    policy.custom_agents.push(CustomAgent {
        id: "live-fixture".into(),
        name: "Live fixture".into(),
        command: executable.to_string_lossy().into_owned(),
        adapter: Some("codex".into()),
    });
    std::fs::create_dir_all(service.runtime.policy_path().parent().unwrap()).unwrap();
    std::fs::write(
        service.runtime.policy_path(),
        serde_json::to_vec(&policy).unwrap(),
    )
    .unwrap();
    service
        .update(|ledger| {
            LiveSessions::session(ledger, &id)?.request.agent = "live-fixture".into();
            Ok(())
        })
        .unwrap();
    service.coordinator.launch();
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    while !service.coordinator.bridge_ready() {
        assert!(
            std::time::Instant::now() < deadline,
            "Coordinator did not start"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
    service
        .send(&id, Uuid::new_v4().to_string(), "First change".into(), None)
        .unwrap();
    let mut sent_followup = false;
    loop {
        service.tick().unwrap();
        let snapshot = service.snapshot(Some(&id)).unwrap();
        let active = snapshot
            .runs
            .iter()
            .filter(|run| ["starting", "running", "stopping"].contains(&run.status.as_str()))
            .count();
        assert!(active <= 1);
        if active == 1 && !sent_followup {
            service
                .send(
                    &id,
                    Uuid::new_v4().to_string(),
                    "Second change".into(),
                    None,
                )
                .unwrap();
            sent_followup = true;
        }
        if snapshot.sessions[0].error.is_some() || std::time::Instant::now() >= deadline {
            service.runtime.stop_all();
            service.coordinator.shutdown();
            panic!("Session failed: {:?}", snapshot.sessions[0].error);
        }
        if snapshot.sessions[0].batches.len() == 2
            && snapshot.sessions[0]
                .batches
                .iter()
                .all(|batch| batch.settled)
        {
            assert_eq!(snapshot.runs.len(), 2);
            let workspace = &snapshot.runs[0].workspace;
            assert!(snapshot.runs.iter().all(|run| &run.workspace == workspace
                && run.status == "review"
                && run.checkpoint.is_none()));
            assert_eq!(
                std::fs::read_to_string(std::path::Path::new(workspace).join("changes.txt"))
                    .unwrap(),
                "change\nchange\n"
            );
            let head = Command::new("git")
                .current_dir(workspace)
                .args(["rev-parse", "HEAD"])
                .output()
                .unwrap();
            assert_eq!(
                String::from_utf8(head.stdout).unwrap().trim(),
                snapshot.runs[0].base_head
            );
            assert!(!service.tick().unwrap());
            break;
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    service.coordinator.shutdown();
}
