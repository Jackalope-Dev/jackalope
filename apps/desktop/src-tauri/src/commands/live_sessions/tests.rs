use super::*;
use std::process::Command;

#[test]
fn topic_grouping_is_durable_revision_checked_and_does_not_dispatch() {
    let (_root, service, id) = fixture();
    let message_id = Uuid::new_v4().to_string();
    service
        .send(
            &id,
            message_id.clone(),
            "Keep the original instructions".into(),
            None,
        )
        .unwrap();
    let topic = SessionTopic {
        id: Uuid::new_v4().to_string(),
        title: "UI".into(),
        message_ids: vec![message_id],
    };
    service.save_topics(&id, 0, vec![topic.clone()]).unwrap();
    assert!(service.save_topics(&id, 0, vec![]).is_err());
    let saved: Ledger = serde_json::from_slice(&std::fs::read(&service.path).unwrap()).unwrap();
    assert_eq!(saved.sessions[0].topics[0].id, topic.id);
    assert_eq!(saved.sessions[0].messages.len(), 1);
    assert!(saved.sessions[0].batches.is_empty());
    service.save_topics(&id, 1, vec![]).unwrap();
    let session = service.snapshot(None).unwrap().sessions.remove(0);
    assert_eq!(session.topics_revision, 2);
    assert!(session.topics.is_empty());
    assert_eq!(session.messages[0].text, "Keep the original instructions");
}

fn fixture() -> (PathBuf, LiveSessions, String) {
    let root = std::env::temp_dir().join(format!("jackalope-live-{}", Uuid::new_v4()));
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    for args in [
        vec!["init", "-b", "main"],
        vec!["config", "core.autocrlf", "false"],
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
        .create(id.clone(), "Walkthrough".into(), request, None)
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
fn first_message_starts_and_names_the_session_atomically() {
    let (_root, service, existing) = fixture();
    let request = service.snapshot(None).unwrap().sessions[0].request.clone();
    let id = Uuid::new_v4().to_string();
    let message_id = Uuid::new_v4().to_string();
    for _ in 0..2 {
        service
            .create(
                id.clone(),
                String::new(),
                request.clone(),
                Some(FirstMessage {
                    id: message_id.clone(),
                    text: "  Fix the search\n spacing  ".into(),
                }),
            )
            .unwrap();
    }
    let snapshot = service.snapshot(Some(&id)).unwrap();
    let session = snapshot
        .sessions
        .iter()
        .find(|session| session.id == id)
        .unwrap();
    assert_eq!(session.title, "Fix the search spacing");
    assert_eq!(session.messages.len(), 1);
    assert_eq!(session.messages[0].text, "Fix the search\n spacing");
    assert!(!session.paused);
    assert!(snapshot
        .sessions
        .iter()
        .any(|session| session.id == existing));
    assert!(service
        .create(
            Uuid::new_v4().to_string(),
            String::new(),
            request,
            Some(FirstMessage {
                id: message_id,
                text: " ".into()
            })
        )
        .is_err());
    assert_eq!(service.snapshot(None).unwrap().sessions.len(), 2);
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
fn missing_attempts_require_recovery_instead_of_silent_replay() {
    let (_root, service, id) = fixture();
    let run_id = Uuid::new_v4().to_string();
    service
        .update(|ledger| {
            LiveSessions::session(ledger, &id)?
                .batches
                .push(SessionBatch {
                    run_id: run_id.clone(),
                    message_ids: vec![],
                    prompt: "Pending".into(),
                    previous_run_id: None,
                    error: None,
                    settled: false,
                });
            Ok(())
        })
        .unwrap();
    let restored = LiveSessions::new(
        service.path.clone(),
        service.runtime.clone(),
        service.coordinator.clone(),
    );
    assert!(restored.action(&id, "resume", None).is_err());
    assert!(!restored.tick().unwrap());
    restored.action(&id, "retry", None).unwrap();
    assert_eq!(
        restored.snapshot(None).unwrap().sessions[0].batches[0].run_id,
        run_id
    );
    restored
        .update(|ledger| {
            LiveSessions::session(ledger, &id)?.batches[0].settled = true;
            Ok(())
        })
        .unwrap();
    assert!(restored.tick().unwrap());
    assert!(restored.snapshot(None).unwrap().sessions[0].paused);
    assert!(!restored.tick().unwrap());
    assert!(restored.runtime.integration_runs().unwrap().is_empty());
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
        task_id: Uuid::new_v4().to_string(),
        live_session_id: Some(id.clone()),
        status: "review".into(),
        workspace: repo.to_string_lossy().into_owned(),
        project_path: repo.to_string_lossy().into_owned(),
        base_head: base.clone(),
        branch: "main".into(),
        ..Default::default()
    };
    let run_id = run.id.clone();
    let task_id = run.task_id.clone();
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
            "--config",
            "core.autocrlf=false",
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
    let first =
        crate::commands::review_progress::progress(&service.runtime, &run_id, None).unwrap();
    let first: serde_json::Value = serde_json::to_value(first).unwrap();
    assert!(first["diff"].as_str().unwrap().contains("+final"));
    let tree = first["tree"].as_str().unwrap();
    crate::commands::review_progress::progress(&service.runtime, &run_id, Some(tree)).unwrap();
    std::fs::write(repo.join("tracked.txt"), b"corrected\n").unwrap();
    let next = serde_json::to_value(
        crate::commands::review_progress::progress(&service.runtime, &run_id, None).unwrap(),
    )
    .unwrap();
    assert_eq!(next["files"], serde_json::json!(["tracked.txt"]));
    assert!(next["diff"].as_str().unwrap().contains("+corrected"));
    assert!(
        crate::commands::review_progress::progress(&service.runtime, &run_id, Some(tree)).is_err()
    );
    let position = service
        .runtime
        .integration_directory()
        .join("review-progress")
        .join(format!("{task_id}.json"));
    let mut saved: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&position).unwrap()).unwrap();
    saved["tree"] = serde_json::json!("0000000000000000000000000000000000000000");
    std::fs::write(&position, serde_json::to_vec(&saved).unwrap()).unwrap();
    let recovered = serde_json::to_value(
        crate::commands::review_progress::progress(&service.runtime, &run_id, None).unwrap(),
    )
    .unwrap();
    assert!(recovered["viewedAt"].is_null());
    assert!(recovered["note"]
        .as_str()
        .unwrap()
        .contains("no longer available"));
    assert!(recovered["diff"].as_str().unwrap().contains("+corrected"));
    crate::commands::review_progress::progress(
        &service.runtime,
        &run_id,
        recovered["tree"].as_str(),
    )
    .unwrap();
    assert_eq!(git(&repo, &["rev-parse", "HEAD"]), base);
    assert_eq!(std::fs::read(repo.join(".git/index")).unwrap(), index);
}

#[test]
fn session_integration_requires_paused_latest_work_and_survives_restart() {
    let (root, mut service, id) = fixture();
    let repo = root.join("repo");
    let git = |args: &[&str]| {
        let result = Command::new("git")
            .current_dir(&repo)
            .args(args)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        String::from_utf8_lossy(&result.stdout).trim().to_string()
    };
    git(&["config", "user.name", "Fixture"]);
    git(&["config", "user.email", "fixture@example.invalid"]);
    let base = git(&["rev-parse", "HEAD"]);
    let workspace = root.join("work");
    git(&[
        "worktree",
        "add",
        "-b",
        "session-work",
        workspace.to_str().unwrap(),
        &base,
    ]);
    std::fs::write(workspace.join("result.txt"), "first result\n").unwrap();
    let run = TaskRun {
        id: Uuid::new_v4().to_string(),
        task_id: Uuid::new_v4().to_string(),
        project_id: "fixture".into(),
        project_name: "Fixture".into(),
        project_path: repo.to_string_lossy().into_owned(),
        workspace: workspace.to_string_lossy().into_owned(),
        live_session_id: Some(id.clone()),
        base_head: base.clone(),
        branch: "session-work".into(),
        target_branch: Some("main".into()),
        status: "review".into(),
        prompt: "A useful result".into(),
        started_at: Utc::now().to_rfc3339(),
        ..Default::default()
    };
    let run_id = run.id.clone();
    attach_run(&root, &mut service, &id, run);
    let ids = vec![run_id.clone()];
    service.action(&id, "resume", None).unwrap();
    assert!(service.integration_guard(&ids).is_err());
    service.action(&id, "pause", None).unwrap();
    let message = Uuid::new_v4().to_string();
    service
        .send(&id, message.clone(), "Another change".into(), None)
        .unwrap();
    assert!(service.integration_guard(&ids).is_err());
    service
        .action(&id, "cancel-message", Some(&message))
        .unwrap();
    {
        let _sessions = service.integration_guard(&ids).unwrap();
        let _guard = crate::commands::integration::execution_guard().unwrap();
        let directory = service.runtime.integration_directory();
        let runs = service.runtime.integration_runs().unwrap();
        let plan =
            crate::commands::integration::prepare_with_message(&directory, &runs, &ids, None)
                .unwrap();
        std::fs::write(workspace.join("result.txt"), "corrected result\n").unwrap();
        assert!(crate::commands::integration::apply(&directory, &runs, &plan.id).is_err());
        let plan =
            crate::commands::integration::prepare_with_message(&directory, &runs, &ids, None)
                .unwrap();
        crate::commands::integration::apply(&directory, &runs, &plan.id).unwrap();
    }
    assert_eq!(
        std::fs::read_to_string(repo.join("result.txt")).unwrap(),
        "corrected result\n"
    );
    assert!(service.action(&id, "resume", None).is_err());
    assert!(service
        .send(&id, Uuid::new_v4().to_string(), "Must not run".into(), None)
        .is_err());
    let restored = LiveSessions::new(
        service.path.clone(),
        service.runtime.clone(),
        service.coordinator.clone(),
    );
    let session = restored.snapshot(None).unwrap().sessions.remove(0);
    assert!(session.closed && session.paused);
    assert_eq!(session.integrated_run_id, Some(run_id));
}

#[test]
fn limits_pause_new_batches_and_do_not_infer_missing_cost() {
    let (_root, service, _id) = fixture();
    let mut session = service.snapshot(None).unwrap().sessions.remove(0);
    session.limits = SessionLimits {
        max_batches: Some(1),
        pause_at_estimated_usd: Some(1.0),
    };
    assert!(limit_reason(&session, &[]).is_none());
    session.batches.push(SessionBatch {
        run_id: "run".into(),
        message_ids: vec![],
        prompt: String::new(),
        previous_run_id: None,
        error: None,
        settled: true,
    });
    let mut run = TaskRun {
        id: "run".into(),
        ..Default::default()
    };
    assert!(limit_reason(&session, &[run.clone()])
        .unwrap()
        .contains("batch limit"));
    session.limits.max_batches = None;
    assert!(limit_reason(&session, &[run.clone()])
        .unwrap()
        .contains("unavailable"));
    run.usage.reported = true;
    run.usage.estimated_cost_usd = Some(0.5);
    assert!(limit_reason(&session, &[run.clone()]).is_none());
    run.usage.estimated_cost_usd = Some(1.1);
    assert!(limit_reason(&session, &[run])
        .unwrap()
        .contains("threshold"));
    assert!(SessionLimits {
        max_batches: Some(0),
        ..Default::default()
    }
    .validate()
    .is_err());
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
