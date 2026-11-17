use super::*;
use crate::commands::scope_path::any_overlap;

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
    assert!(service
        .commit(&mut service.state(), |_| Ok::<_, String>(()))
        .is_err());
    assert!(service.tick().is_err());
    assert!(service.ensure_storage_loaded().is_err());
    assert!(service.state().enabled.is_empty());
    assert_eq!(std::fs::read(&path).unwrap(), b"{incomplete queue");
    drop(service);
    std::fs::write(&path, serde_json::to_vec(&Ledger::default()).unwrap()).unwrap();
    let restored = Coordinator::new(queue, runtime.clone()).unwrap();
    assert!(restored.view().unwrap().items.is_empty());
    assert!(restored.state().enabled.is_empty());
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
    let item = QueueItem {
        excluded_scopes: vec![],
        parent_task_id: None,
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
        setup_files: Vec::new(),
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
    assert!(text.contains("Own only these paths: docs"));
    assert!(text.contains("ask_user"));
    assert!(text.contains("record_decision"));
    assert!(text.len() < 1900);
    assert!(!text.contains("/v1/browser/navigate"));
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
    assert!(any_overlap(
        &scopes(vec!["apps\\desktop/".into()]).unwrap(),
        &vec!["apps/desktop/src/main.ts".into()]
    ));
    assert!(!any_overlap(
        &vec!["docs/a.md".into()],
        &vec!["docs/b.md".into()]
    ));
    assert!(any_overlap(&vec![".".into()], &vec!["anything".into()]));
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
            setup_files: Vec::new(),
            auto_verify: false,
            title: "Test".into(),
            prompt: "Implement test".into(),
            agent: "codex".into(),
            scopes: vec!["docs".into()],
            dependencies: vec![],
        })
        .unwrap();
    service.state().enabled.insert("project".into());
    drop(service);
    let restored = Coordinator::new(dir.join("queue"), runtime).unwrap();
    assert!(restored.state().enabled.is_empty());
    assert_eq!(restored.state().ledger.items[0].id, id);
    assert!(restored.caller(&HeaderMap::new()).is_err());
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
        setup_files: Vec::new(),
        auto_verify: false,
        review_only: false,
        items,
    };
    let mut invalid = entry("invalid", &[]);
    invalid.scopes = vec!["docs/./file".into()];
    assert!(service
        .import(request(vec![entry("first", &[]), invalid]))
        .is_err());
    assert!(service.state().ledger.items.is_empty());
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
    assert_eq!(service.state().ledger.items.len(), 4);
    shared.scopes = vec!["different".into()];
    assert!(service
        .import(request(vec![
            entry("first", &[]),
            entry("independent", &[]),
            shared,
            entry("after", &["first"])
        ]))
        .is_err());
    let mut inner = service.state();
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
