use super::*;

fn fixture() -> (PathBuf, Coordinator) {
    let root = std::env::temp_dir().join(format!("jackalope-followups-{}", Uuid::new_v4()));
    let history = root.join("history");
    std::fs::create_dir_all(&history).unwrap();
    let run = TaskRun {
        id: "source-run".into(),
        task_id: "task".into(),
        project_id: "project".into(),
        project_name: "Fixture".into(),
        project_path: root.to_string_lossy().into(),
        workspace: root.to_string_lossy().into(),
        agent: "codex".into(),
        status: "review".into(),
        session_id: Some("bound-session".into()),
        started_at: "2026-09-17T00:00:00Z".into(),
        ..Default::default()
    };
    std::fs::write(
        history.join("source-run.json"),
        serde_json::to_vec(&run).unwrap(),
    )
    .unwrap();
    let runtime = TaskRuntime::with_test_access(history).unwrap();
    let service = Coordinator::new(root.join("coordination"), runtime).unwrap();
    service.inner.lock().unwrap().url = Some("http://127.0.0.1:1".into());
    (root, service)
}

fn enqueue(service: &Coordinator, text: &str) -> String {
    let id = Uuid::new_v4().to_string();
    service
        .enqueue_followup(id.clone(), "source-run", text.into(), None, false)
        .unwrap();
    id
}

#[test]
fn saves_in_order_deduplicates_and_preserves_queue_on_failed_write() {
    let (root, service) = fixture();
    let id = enqueue(&service, "First");
    service
        .enqueue_followup(id.clone(), "source-run", "First".into(), None, false)
        .unwrap();
    assert!(service
        .enqueue_followup(id, "source-run", "Changed".into(), None, false)
        .is_err());
    enqueue(&service, "Second");
    assert_eq!(
        service
            .followups("task")
            .unwrap()
            .iter()
            .map(|item| item.prompt.as_str())
            .collect::<Vec<_>>(),
        vec!["First", "Second"]
    );
    let path = root.join("coordination/queue.json");
    let saved = std::fs::read(&path).unwrap();
    std::fs::rename(&path, root.join("saved-queue.json")).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert!(service
        .enqueue_followup(
            Uuid::new_v4().to_string(),
            "source-run",
            "Not saved".into(),
            None,
            false
        )
        .is_err());
    assert_eq!(service.followups("task").unwrap().len(), 2);
    assert_eq!(std::fs::read(root.join("saved-queue.json")).unwrap(), saved);
}

#[test]
fn waits_for_running_and_finishing_work_and_pauses_after_failure() {
    let (_, service) = fixture();
    let id = enqueue(&service, "Next");
    service
        .runtime
        .update("source-run", |run| run.status = "running".into());
    service.dispatch_followups().unwrap();
    assert!(service.followups("task").unwrap()[0].run_id.is_none());
    service.runtime.update("source-run", |run| {
        run.status = "review".into();
        run.finishing = true;
    });
    service.dispatch_followups().unwrap();
    assert!(!service.followups("task").unwrap()[0].paused);
    service.runtime.update("source-run", |run| {
        run.finishing = false;
        run.status = "failed".into();
    });
    service.dispatch_followups().unwrap();
    assert!(service.followups("task").unwrap()[0].paused);
    assert!(service.followups("task").unwrap()[0].error.is_some());
    service.followup_action(&id, "resume").unwrap();
    assert!(!service.followups("task").unwrap()[0].paused);
    assert_eq!(
        service.followups("task").unwrap()[0]
            .allow_failure
            .as_deref(),
        Some("source-run")
    );
    service
        .runtime
        .update("source-run", |run| run.status = "interrupted".into());
    assert!(service.followup_action(&id, "resume").is_err());
    service.followup_action(&id, "cancel").unwrap();
    assert!(service.followups("task").unwrap().is_empty());
}

#[test]
fn restart_pauses_saved_intent_and_interrupted_claims_never_replay() {
    let (root, service) = fixture();
    let first = enqueue(&service, "Next");
    let runtime = service.runtime.clone();
    drop(service);
    let restored = Coordinator::new(root.join("coordination"), runtime).unwrap();
    assert!(restored.followups("task").unwrap()[0].paused);
    restored.followup_action(&first, "resume").unwrap();
    {
        let mut inner = restored.inner.lock().unwrap();
        inner.url = Some("http://127.0.0.1:1".into());
        restored
            .update_followup(&mut inner, &first, |item| {
                item.run_id = Some("missing-claim".into())
            })
            .unwrap();
    }
    restored.dispatch_followups().unwrap();
    let queued = restored.followups("task").unwrap();
    assert!(queued[0].paused);
    assert!(queued[0].error.as_ref().unwrap().contains("interrupted"));
    assert!(restored.followup_action(&first, "resume").is_err());
    assert_eq!(restored.runtime.integration_runs().unwrap().len(), 1);
}

#[test]
fn queued_intent_blocks_merge_and_competing_manual_continuations() {
    let (_, service) = fixture();
    let id = enqueue(&service, "Next");
    let runs = service.runtime.integration_runs().unwrap();
    let request: RunRequest = serde_json::from_value(serde_json::json!({
        "id":"other","previousRunId":"source-run","projectId":"project","projectName":"Fixture",
        "projectPath":"unused","agent":"codex","prompt":"Competing","isolated":false
    }))
    .unwrap();
    {
        let inner = service.inner.lock().unwrap();
        assert!(service
            .validate_followup_launch(&inner.ledger, &request)
            .is_err());
        assert!(service
            .validate_integration_locked(&inner.ledger, &runs, &["source-run".into()])
            .unwrap_err()
            .contains("queued follow-ups"));
    }
    service.followup_action(&id, "cancel").unwrap();
    assert!(service
        .validate_followup_launch(&service.inner.lock().unwrap().ledger, &request)
        .is_ok());
}

#[test]
fn stop_and_send_precedes_queued_work_without_duplicating_or_relaxing_later_failures() {
    let (_, service) = fixture();
    enqueue(&service, "Later");
    service
        .runtime
        .update("source-run", |run| run.status = "running".into());
    let id = Uuid::new_v4().to_string();
    for _ in 0..2 {
        service
            .enqueue_followup(id.clone(), "source-run", "Now".into(), None, true)
            .unwrap();
    }
    let queued = service.followups("task").unwrap();
    assert_eq!(queued.len(), 2);
    assert_eq!(queued[0].prompt, "Now");
    assert_eq!(queued[0].allow_failure.as_deref(), Some("source-run"));
    assert_eq!(queued[1].prompt, "Later");
    assert!(queued[1].allow_failure.is_none());
    assert_eq!(
        service.runtime.integration_runs().unwrap()[0].status,
        "stopping"
    );
    assert!(service
        .enqueue_followup(id, "source-run", "Now".into(), None, false)
        .is_err());
    service.dispatch_followups().unwrap();
    assert!(service
        .followups("task")
        .unwrap()
        .iter()
        .all(|item| item.run_id.is_none()));
}

#[tokio::test]
#[ignore = "Runs an installed agent in a disposable repository; set JACKALOPE_AGENT_TRIAL"]
async fn installed_agent_queues_and_interrupts_followups_once_in_the_bound_session() {
    let agent =
        std::env::var("JACKALOPE_AGENT_TRIAL").expect("Choose an installed agent explicitly");
    let root = std::env::temp_dir().join(format!("jackalope-followup-trial-{}", Uuid::new_v4()));
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    for args in [
        vec!["init", "-b", "main"],
        vec![
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-m",
            "Fixture baseline",
        ],
    ] {
        let output = crate::commands::git_command::command(
            &repo,
            &args,
            crate::commands::git_command::Policy::Isolated,
        )
        .output()
        .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
    let service = Coordinator::new(root.join("coordination"), runtime.clone()).unwrap();
    struct Shutdown(Coordinator);
    impl Drop for Shutdown {
        fn drop(&mut self) {
            self.0.shutdown();
            self.0.runtime.stop_all();
        }
    }
    let _shutdown = Shutdown(service.clone());
    service.launch();
    for _ in 0..100 {
        if service.bridge_ready() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(service.bridge_ready());
    let id = Uuid::new_v4().to_string();
    let request: RunRequest = serde_json::from_value(serde_json::json!({
        "id":id,"projectId":Uuid::new_v4().to_string(),"projectName":"Follow-up acceptance",
        "projectPath":repo,"agent":agent,"model":std::env::var("JACKALOPE_AGENT_MODEL").ok(),
        "prompt":"Remember the phrase silver-rabbit-482 in this conversation without writing it anywhere. Run one shell command that waits 30 seconds, then reply READY. Do not edit files, install anything, access the network, or commit.",
        "isolated":true,"connectionIds":[],"autoVerify":false
    })).unwrap();
    service.start_manual(request).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(180);
    let first = loop {
        let run = runtime
            .integration_runs()
            .unwrap()
            .into_iter()
            .find(|run| run.id == id)
            .unwrap();
        if run.session_id.is_some() {
            break run;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "No resumable session; retained {}",
            root.display()
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    };
    assert!(
        matches!(first.status.as_str(), "starting" | "running"),
        "First attempt completed before the interruption trial"
    );
    let queued_id = Uuid::new_v4().to_string();
    service
        .enqueue_followup(
            queued_id.clone(),
            &id,
            "Reply with the phrase I asked you to remember and QUEUED. Do not use tools.".into(),
            Some(vec![]),
            false,
        )
        .unwrap();
    let immediate_id = Uuid::new_v4().to_string();
    service.enqueue_followup(immediate_id.clone(), &id, "Cancel the wait. Reply with the phrase I asked you to remember and IMMEDIATE. Do not use tools.".into(), Some(vec![]), true).unwrap();
    let runs = loop {
        let runs = runtime.integration_runs().unwrap();
        if runs.len() == 3
            && runs.iter().all(|run| {
                !run.finishing
                    && !matches!(run.status.as_str(), "starting" | "running" | "stopping")
            })
        {
            break runs;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "Follow-up trial timed out; retained {}",
            root.display()
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    };
    let ledger = service.inner.lock().unwrap().ledger.clone();
    let followup_run = |queued: &str| {
        let entry = ledger
            .followups
            .iter()
            .find(|item| item.id == queued)
            .unwrap();
        assert!(entry.dispatched);
        runs.iter()
            .find(|run| Some(&run.id) == entry.run_id.as_ref())
            .unwrap()
    };
    let immediate = followup_run(&immediate_id);
    let queued = followup_run(&queued_id);
    assert!(immediate.started_at < queued.started_at);
    for (run, marker) in [(immediate, "IMMEDIATE"), (queued, "QUEUED")] {
        assert_eq!(
            run.status,
            "review",
            "{:?}; retained {}",
            run.error,
            root.display()
        );
        assert!(
            run.result.contains("silver-rabbit-482") && run.result.contains(marker),
            "{}; retained {}",
            run.result,
            root.display()
        );
        assert_eq!(run.session_id, first.session_id);
        assert_eq!(run.workspace, first.workspace);
        assert_eq!(
            run.account_binding.as_ref().unwrap().directory,
            first.account_binding.as_ref().unwrap().directory
        );
    }
    service.dispatch_followups().unwrap();
    assert!(service.followups(&first.task_id).unwrap().is_empty());
    assert_eq!(runtime.integration_runs().unwrap().len(), 3);
    println!("Follow-up acceptance retained at {}", root.display());
}
