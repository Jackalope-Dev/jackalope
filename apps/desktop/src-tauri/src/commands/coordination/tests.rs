use super::*;

#[test]
fn unreadable_queue_keeps_the_app_available_without_overwriting_assignments() {
    let folder = std::env::temp_dir().join(format!("jackalope-queue-recovery-{}", Uuid::new_v4()));
    let runtime = TaskRuntime::with_test_access(folder.join("history")).unwrap();
    let queue = folder.join("coordination");
    std::fs::create_dir_all(&queue).unwrap();
    let path = queue.join("queue.json");
    std::fs::write(&path, b"{incomplete queue").unwrap();
    let service = Coordinator::new(queue.clone(), runtime.clone()).unwrap();
    assert!(service.view().err().unwrap().contains("original remains"));
    assert!(service.save(&Ledger::default()).is_err());
    assert!(service.tick().is_err());
    assert!(service.ensure_storage_loaded().is_err());
    assert!(service.inner.lock().unwrap().enabled.is_empty());
    assert_eq!(std::fs::read(&path).unwrap(), b"{incomplete queue");
    drop(service);
    std::fs::write(&path, serde_json::to_vec(&Ledger::default()).unwrap()).unwrap();
    let restored = Coordinator::new(queue, runtime.clone()).unwrap();
    assert!(restored.view().unwrap().items.is_empty());
    assert!(restored.inner.lock().unwrap().enabled.is_empty());
    drop(restored);
    drop(runtime);
    std::fs::remove_dir_all(folder).unwrap();
}
fn entry(key: &str, dependencies: &[&str]) -> PlanEntry {
    PlanEntry {
        context_selection: Default::default(),
        key: key.into(),
        title: key.into(),
        prompt: "Do a task".into(),
        agent: "codex".into(),
        scopes: vec![format!("docs/{key}.md")],
        depends_on: dependencies.iter().map(|s| s.to_string()).collect(),
    }
}
#[test]
fn queue_dispatched_tasks_also_learn_about_the_harness_bridge() {
    // Codex and Grok never get the --mcp-config/--allowedTools wiring
    // execute() sets up for Claude - the plain-HTTP instructions here
    // are the *only* way they can discover the browser/user-prompt/
    // validation-step/computer-verify endpoints exist. Before this fix,
    // instructions() (used by both automatic queue dispatch and a
    // continuation of a queued task) never mentioned them at all - only
    // a manually-started standalone task did, via a separate, unshared
    // copy of this same text.
    let item = QueueItem {
        staged_dependencies: false,
        feature: None,
        feature_id: None,
        context_selection: Default::default(),
        id: "task-1".into(),
        project_id: "project".into(),
        project_name: "Project".into(),
        project_path: "/tmp/project".into(),
        target_branch: None,
        agent_profile_id: None,
        verify_command: None,
        prepare_command: None,
        auto_verify: false,
        title: "Do a thing".into(),
        prompt: "Do a thing".into(),
        agent: "codex".into(),
        scopes: vec!["docs".into()],
        dependencies: vec![],
        created_at: Utc::now().to_rfc3339(),
        run_id: None,
        error: None,
        canceled: false,
    };
    let text = instructions(&item);
    assert!(
        text.contains("/v1/project"),
        "parallel coordination endpoint missing"
    );
    assert!(
        text.contains("/v1/browser/navigate"),
        "browser harness endpoint missing"
    );
    assert!(
        text.contains("/v1/user-prompt"),
        "user prompt endpoint missing"
    );
    assert!(
        text.contains("/v1/validation-step"),
        "validation step endpoint missing"
    );
}

#[test]
fn import_orders_dependencies_and_rejects_cycles_and_missing_keys() {
    let ordered = ordered_plan(vec![entry("after", &["first"]), entry("first", &[])]).unwrap();
    assert_eq!(ordered[0].key, "first");
    assert!(ordered_plan(vec![entry("a", &["b"]), entry("b", &["a"])]).is_err());
    assert!(ordered_plan(vec![entry("a", &["missing"])]).is_err());
    assert!(ordered_plan(vec![entry("a", &[]), entry("a", &[])]).is_err());
}
#[test]
fn scopes_detect_shared_ownership_without_sibling_false_positives() {
    assert!(overlaps(
        &scopes(vec!["apps\\desktop/".into()]).unwrap(),
        &vec!["apps/desktop/src/main.ts".into()]
    ));
    assert!(!overlaps(
        &vec!["docs/a.md".into()],
        &vec!["docs/b.md".into()]
    ));
    assert!(overlaps(&vec![".".into()], &vec!["anything".into()]));
    assert!(scopes(vec!["../outside".into()]).is_err());
    assert!(scopes(vec!["C:/outside".into()]).is_err());
}
#[test]
fn queue_is_durable_exclusively_owned_and_paused_after_restart() {
    let dir = std::env::temp_dir().join(format!("jackalope-queue-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    assert!(std::process::Command::new("git")
        .args(["init", "-b", "main"])
        .current_dir(&dir)
        .output()
        .unwrap()
        .status
        .success());
    assert!(std::process::Command::new("git")
        .args([
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "Fixture"
        ])
        .current_dir(&dir)
        .output()
        .unwrap()
        .status
        .success());
    let runtime = TaskRuntime::with_test_access(dir.join("runs")).unwrap();
    let service = Coordinator::new(dir.join("queue"), runtime.clone()).unwrap();
    assert!(Coordinator::new(dir.join("queue"), runtime.clone()).is_err());
    let id = service
        .add(QueueRequest {
            staged_dependencies: false,
            feature: None,
            feature_id: None,
            context_selection: Default::default(),
            project_id: "project".into(),
            project_name: "Project".into(),
            project_path: dir.to_string_lossy().into(),
            target_branch: None,
            agent_profile_id: None,
            verify_command: None,
            prepare_command: None,
            auto_verify: false,
            title: "Test".into(),
            prompt: "Implement test".into(),
            agent: "codex".into(),
            scopes: vec!["docs".into()],
            dependencies: vec![],
        })
        .unwrap();
    service
        .inner
        .lock()
        .unwrap()
        .enabled
        .insert("project".into());
    drop(service);
    let restored = Coordinator::new(dir.join("queue"), runtime).unwrap();
    assert!(restored.inner.lock().unwrap().enabled.is_empty());
    assert_eq!(restored.inner.lock().unwrap().ledger.items[0].id, id);
    assert!(restored.authorized(&HeaderMap::new()).is_err());
    drop(restored);
    assert!(dir.starts_with(std::env::temp_dir()));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn plan_import_is_atomic_and_dispatch_waits_for_integrated_dependencies_and_scopes() {
    let dir = std::env::temp_dir().join(format!("jackalope-plan-test-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    assert!(std::process::Command::new("git")
        .args(["init", "-b", "main"])
        .current_dir(&dir)
        .output()
        .unwrap()
        .status
        .success());
    assert!(std::process::Command::new("git")
        .args([
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "Fixture"
        ])
        .current_dir(&dir)
        .output()
        .unwrap()
        .status
        .success());
    let runtime = TaskRuntime::with_test_access(dir.join("runs")).unwrap();
    let service = Coordinator::new(dir.join("queue"), runtime).unwrap();
    let feature_id = Uuid::new_v4().to_string();
    let request = |items| PlanRequest {
        staged_dependencies: false,
        feature: Some("Feature".into()),
        feature_id: Some(feature_id.clone()),
        project_id: "project".into(),
        project_name: "Project".into(),
        project_path: dir.to_string_lossy().into(),
        target_branch: None,
        agent_accounts: HashMap::new(),
        verify_command: None,
        prepare_command: None,
        auto_verify: false,
        items,
    };
    let mut invalid = entry("invalid", &[]);
    invalid.scopes = vec!["docs/./file".into()];
    assert!(service
        .import(request(vec![entry("first", &[]), invalid]))
        .is_err());
    assert!(service.inner.lock().unwrap().ledger.items.is_empty());
    let mut shared = entry("shared", &[]);
    shared.scopes = vec!["docs/first.md".into()];
    service
        .import(request(vec![
            entry("first", &[]),
            entry("independent", &[]),
            shared,
            entry("after", &["first"]),
        ]))
        .unwrap();
    let mut shared = entry("shared", &[]);
    shared.scopes = vec!["docs/first.md".into()];
    let retry_ids = service
        .import(request(vec![
            entry("first", &[]),
            entry("independent", &[]),
            shared.clone(),
            entry("after", &["first"]),
        ]))
        .unwrap();
    assert_eq!(retry_ids.len(), 4);
    assert_eq!(service.inner.lock().unwrap().ledger.items.len(), 4);
    shared.scopes = vec!["different".into()];
    assert!(service
        .import(request(vec![
            entry("first", &[]),
            entry("independent", &[]),
            shared,
            entry("after", &["first"])
        ]))
        .is_err());
    let mut inner = service.inner.lock().unwrap();
    inner.enabled.insert("project".into());
    let first = ready_items(&inner, &[], &[]);
    assert_eq!(first.len(), 2);
    assert_eq!(first[0].title, "first");
    assert_eq!(first[1].title, "independent");
    inner.ledger.items[0].run_id = Some("first-run".into());
    inner.ledger.items[1].run_id = Some("second-run".into());
    assert!(ready_items(&inner, &[], &[]).is_empty());
    let next = ready_items(&inner, &[], &["first-run".into()]);
    assert_eq!(next.len(), 2);
    assert_eq!(next[0].title, "shared");
    assert_eq!(next[1].title, "after");
    inner.enabled.clear();
    assert!(ready_items(&inner, &[], &["first-run".into()]).is_empty());
    drop(inner);
    drop(service);
    assert!(dir.starts_with(std::env::temp_dir()));
    std::fs::remove_dir_all(dir).unwrap();
}

#[cfg(windows)]
fn process_is_alive(pid: u32) -> bool {
    let output = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
        .expect("failed to run tasklist");
    String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
}
#[cfg(not(windows))]
fn process_is_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .is_ok_and(|status| status.success())
}

#[tokio::test]
async fn computer_verify_command_execution_is_bounded_and_non_blocking() {
    // Exercises the exact mechanism bridge_computer_verify uses (tokio::
    // process::Command wrapped in tokio::time::timeout, kill_on_drop),
    // the fix for a real bug: it used to run std::process::Command's
    // blocking output() directly inside an async handler with no
    // timeout at all, so a command that hangs (waits on stdin, starts a
    // long-lived server) would permanently occupy a tokio worker thread
    // - and even with a timeout, without kill_on_drop the process would
    // keep running as an undetected orphan instead of actually stopping.
    // Testing through the full authorized HTTP path would need a
    // running agent process to produce an "active" TaskRun; this
    // isolates the part that actually changed.
    #[cfg(windows)]
    let (quick_program, quick_args, hang_program, hang_args): (_, Vec<&str>, _, Vec<&str>) = (
        "cmd.exe",
        vec!["/C", "exit", "0"],
        "ping",
        vec!["-n", "30", "127.0.0.1"],
    );
    #[cfg(not(windows))]
    let (quick_program, quick_args, hang_program, hang_args): (_, Vec<&str>, _, Vec<&str>) =
        ("sh", vec!["-c", "exit 0"], "sleep", vec!["30"]);

    let mut quick = tokio::process::Command::new(quick_program);
    quick.args(&quick_args);
    let result = tokio::time::timeout(Duration::from_millis(2000), quick.output()).await;
    assert!(
        result.is_ok(),
        "a quick command must not be affected by the bound"
    );

    // Spawned directly (not through a shell) so kill_on_drop's
    // direct-child termination actually stops the real long-running
    // process being measured, not an intermediate shell wrapper.
    let mut hang = tokio::process::Command::new(hang_program);
    hang.args(&hang_args)
        .kill_on_drop(true)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    let mut child = hang.spawn().expect("failed to spawn hang command");
    let pid = child.id().expect("spawned child has no pid");
    assert!(
        process_is_alive(pid),
        "process should be running before the timeout"
    );

    let started = std::time::Instant::now();
    // Moved into the awaited future (mirroring cmd.output()'s own
    // internal Child ownership) so dropping it on timeout drops the
    // Child too, which is what actually triggers kill_on_drop.
    let result = tokio::time::timeout(
        Duration::from_millis(200),
        async move { child.wait().await },
    )
    .await;
    assert!(
        result.is_err(),
        "a command that never exits must time out rather than hang forever"
    );
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "the timeout must actually bound wall-clock time, not just the return type"
    );

    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while process_is_alive(pid) && std::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(
        !process_is_alive(pid),
        "kill_on_drop should terminate the process once we give up waiting on it, not leave it orphaned"
    );
}
