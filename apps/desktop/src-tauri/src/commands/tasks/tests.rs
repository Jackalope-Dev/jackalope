use super::*;

fn sample(agent: &str) -> TaskRun {
    TaskRun {
        id: "test-attempt-123".into(),
        task_id: "task-123".into(),
        project_id: "project-123".into(),
        project_name: "Test".into(),
        project_path: String::new(),
        workspace: String::new(),
        branch: String::new(),
        base_head: String::new(),
        agent: agent.into(),
        account_binding: None,
        target_branch: None,
        process_contained: false,
        verify_command: None,
        verification: None,
        account: "test".into(),
        connection_ids: None,
        model: None,
        prompt: "Example".into(),
        status: "running".into(),
        started_at: Utc::now().to_rfc3339(),
        ended_at: None,
        session_id: None,
        result: String::new(),
        details_omitted: false,
        activity: vec![],
        diagnostics: vec![],
        error: None,
        persistence_error: None,
        exit_code: None,
        usage: Usage::default(),
        usage_observations: vec![],
        prompts: vec![],
        validation_steps: vec![],
        screenshots: vec![],
    }
}

#[test]
fn saved_user_answers_are_scoped_idempotent_and_not_overwritten_by_a_timeout() {
    let folder = std::env::temp_dir().join(format!("jackalope-answer-{}", uuid::Uuid::new_v4()));
    let runtime = TaskRuntime::new(folder.clone()).unwrap();
    let run = sample("codex");
    runtime
        .inner
        .lock()
        .unwrap()
        .runs
        .insert(run.id.clone(), run.clone());
    let prompt = super::super::harness::PendingUserPrompt {
        id: "question-1".into(),
        run_id: run.id.clone(),
        question: "Choose".into(),
        input_type: "choice".into(),
        options: vec!["A".into(), "B".into()],
        default_value: None,
        status: "pending".into(),
        answer: None,
        created_at: Utc::now().to_rfc3339(),
        answered_at: None,
    };
    runtime.record_prompt(&prompt);
    assert!(runtime
        .respond_prompt("another-attempt", &prompt.id, "A")
        .is_err());
    assert!(runtime.respond_prompt(&run.id, &prompt.id, "A").unwrap());
    assert!(runtime.respond_prompt(&run.id, &prompt.id, "B").is_err());
    runtime.record_prompt(&prompt);
    let stored: TaskRun =
        serde_json::from_slice(&std::fs::read(folder.join(format!("{}.json", run.id))).unwrap())
            .unwrap();
    assert_eq!(stored.prompts[0].answer.as_deref(), Some("A"));
    assert_eq!(stored.prompts[0].status, "answered");
    drop(runtime);
    let _ = std::fs::remove_dir_all(folder);
}

#[test]
fn child_usage_is_deduplicated_without_overwriting_parent_result_or_totals() {
    let mut run = sample("claude");
    run.result = "Parent result".into();
    run.model = Some("parent-model".into());
    let event = r#"{"type":"assistant","parent_tool_use_id":"child-1","message":{"id":"message-1","model":"child-model","usage":{"input_tokens":10,"cache_read_input_tokens":5,"output_tokens":3}}}"#;
    consume_event(&mut run, event);
    consume_event(&mut run, event);
    consume_event(
        &mut run,
        r#"{"type":"result","parent_tool_use_id":"child-1","result":"Child result","usage":{"input_tokens":10,"output_tokens":3}}"#,
    );
    assert_eq!(run.usage_observations.len(), 1);
    assert_eq!(run.usage_observations[0].input, 15);
    assert_eq!(run.result, "Parent result");
    assert_eq!(run.model.as_deref(), Some("parent-model"));
    assert!(!run.usage.reported);
}

#[test]
fn final_usage_replaces_replayed_totals_and_cache_is_counted_once() {
    let mut codex = sample("codex");
    let event = r#"{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":80,"output_tokens":15}}"#;
    consume_event(&mut codex, event);
    consume_event(&mut codex, event);
    assert_eq!(codex.usage.input + codex.usage.output, 135);
    assert_eq!(codex.usage.cache_read, 80);
    for agent in ["claude", "grok"] {
        let mut run = sample(agent);
        let event = r#"{"type":"result","result":"Done","usage":{"input_tokens":20,"cache_read_input_tokens":80,"cache_creation_input_tokens":20,"output_tokens":15},"total_cost_usd":0.012}"#;
        consume_event(&mut run, event);
        consume_event(&mut run, event);
        assert_eq!(run.usage.input + run.usage.output, 135);
        assert_eq!(run.usage.estimated_cost_usd, Some(0.012));
    }
}

#[test]
fn custom_adapter_decodes_events_without_losing_agent_identity() {
    let mut run = sample("custom-codex");
    consume_adapter_event(
        &mut run,
        r#"{"type":"item.completed","item":{"type":"agent_message","text":"Completed"}}"#,
        "codex",
    );
    assert_eq!(run.result, "Completed");
    assert_eq!(run.agent, "custom-codex");
}

#[test]
#[cfg(windows)]
fn configured_default_agent_launches_with_allowed_model_and_records_output() {
    use super::super::agent_policy::{AgentPolicy, CustomAgent, RunnerOptions};
    let folder =
        std::env::temp_dir().join(format!("jackalope-policy-run-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&folder).unwrap();
    let root = folder.to_str().unwrap();
    git(root, &["init", "-b", "master"]).unwrap();
    git(
        root,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "Fixture",
        ],
    )
    .unwrap();
    let executable = folder.join("fixture.cmd");
    std::fs::write(&executable, "@echo off\r\nset /p TASK_INPUT=\r\necho %*>args.txt\r\necho {\"type\":\"thread.started\",\"thread_id\":\"fixture-session\"}\r\necho {\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"Fixture complete\"}}\r\n").unwrap();
    let runtime = TaskRuntime::new(folder.join("history")).unwrap();
    let mut policy = AgentPolicy::default();
    policy.default_meta_agent = "custom-fixture".into();
    policy.custom_agents.push(CustomAgent {
        id: "custom-fixture".into(),
        name: "Fixture".into(),
        command: executable.to_string_lossy().into(),
        adapter: Some("codex".into()),
    });
    policy.runner_options.insert(
        "custom-fixture".into(),
        RunnerOptions {
            models: vec!["test-model".into()],
            restrict_models: true,
            ..Default::default()
        },
    );
    std::fs::create_dir_all(runtime.policy_path().parent().unwrap()).unwrap();
    std::fs::write(runtime.policy_path(), serde_json::to_vec(&policy).unwrap()).unwrap();
    let request = RunRequest {
        id: "fixture-run-123".into(),
        project_id: "fixture".into(),
        project_name: "Fixture".into(),
        project_path: root.into(),
        agent: "default".into(),
        agent_profile_id: None,
        verify_command: None,
        target_branch: None,
        account_binding: None,
        model: None,
        prompt: "Fixture only".into(),
        isolated: false,
        previous_run_id: None,
        coordination: None,
        connection_ids: None,
    };
    runtime.start(request.clone()).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        let run = runtime.integration_runs().unwrap().pop().unwrap();
        if !["starting", "running"].contains(&run.status.as_str()) {
            assert_eq!(run.status, "review", "{:?}", run.error);
            assert_eq!(run.agent, "custom-fixture");
            assert_eq!(run.model.as_deref(), Some("test-model"));
            assert_eq!(run.result, "Fixture complete");
            break;
        }
        if std::time::Instant::now() > deadline {
            runtime.stop_all();
            panic!("Fixture did not exit");
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    assert!(std::fs::read_to_string(folder.join("args.txt"))
        .unwrap()
        .contains("--model test-model"));
    policy.enabled_agents.insert("custom-fixture".into(), false);
    std::fs::write(runtime.policy_path(), serde_json::to_vec(&policy).unwrap()).unwrap();
    let mut blocked = request;
    blocked.id = "fixture-run-456".into();
    assert!(runtime.start(blocked).unwrap_err().contains("disabled"));
    drop(runtime);
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn missing_measurements_remain_unknown_and_failures_remain_failures() {
    let mut run = sample("claude");
    consume_event(
        &mut run,
        r#"{"type":"result","is_error":true,"errors":["Not signed in"]}"#,
    );
    assert!(!run.usage.reported);
    assert!(run.error.unwrap().contains("Not signed in"));
    assert!(run.result.is_empty());
}

#[test]
fn session_and_unicode_output_survive_journal_reload_without_rerunning() {
    let folder = std::env::temp_dir().join(format!(
        "jackalope-test-{}-{}",
        std::process::id(),
        Utc::now().timestamp_nanos_opt().unwrap()
    ));
    let runtime = TaskRuntime::new(folder.clone()).unwrap();
    let mut run = sample("codex");
    consume_event(
        &mut run,
        r#"{"type":"thread.started","thread_id":"session-1"}"#,
    );
    consume_event(
        &mut run,
        r#"{"type":"item.completed","item":{"type":"agent_message","text":"🐇 café"}}"#,
    );
    runtime.save(&run).unwrap();
    drop(runtime);
    let loaded = TaskRuntime::new(folder.clone()).unwrap();
    let inner = loaded.inner.lock().unwrap();
    let restored = &inner.runs[&run.id];
    assert_eq!(restored.status, "interrupted");
    assert_eq!(restored.result, "🐇 café");
    assert_eq!(restored.session_id.as_deref(), Some("session-1"));
    assert!(inner.processes.is_empty());
    drop(inner);
    assert!(folder.starts_with(std::env::temp_dir()));
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn journal_identifiers_cannot_escape_the_storage_directory() {
    for id in ["../../other", "a/bbbbbbb", "C:\\test-file", "short"] {
        assert!(!valid_id(id));
    }
    assert!(valid_id("f22457f4-32ca-421c-9782-075f244004a9"));
}

#[test]
fn failed_save_can_be_exported_and_retried_without_losing_the_latest_state() {
    let folder = std::env::temp_dir().join(format!("jackalope-retry-{}", uuid::Uuid::new_v4()));
    let directory = folder.join("history");
    let runtime = TaskRuntime::new(directory.clone()).unwrap();
    let mut run = sample("codex");
    run.status = "review".into();
    run.result = "last saved output".into();
    runtime.save(&run).unwrap();
    runtime
        .inner
        .lock()
        .unwrap()
        .runs
        .insert(run.id.clone(), run.clone());
    let path = directory.join(format!("{}.json", run.id));
    let prior = folder.join("prior.json");
    std::fs::rename(&path, &prior).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert!(runtime
        .update_checked(&run.id, |r| r.result = "latest unsaved output".into())
        .is_err());
    assert!(runtime.ensure_history_saved().is_err());
    let exported = folder.join("recovery.json");
    runtime.export_recovery(&run.id, &exported).unwrap();
    let recovery: Value = serde_json::from_slice(&std::fs::read(&exported).unwrap()).unwrap();
    assert_eq!(recovery["task"]["result"], "latest unsaved output");
    assert_eq!(recovery["format"], "jackalope-task-recovery");
    assert!(
        runtime.ensure_history_saved().is_err(),
        "export must not claim the main record was saved"
    );
    assert!(runtime
        .export_recovery(&run.id, &directory.join("overwrite.json"))
        .is_err());
    let old: TaskRun = serde_json::from_slice(&std::fs::read(&prior).unwrap()).unwrap();
    assert_eq!(old.result, "last saved output");
    std::fs::remove_dir(&path).unwrap();
    std::fs::rename(&prior, &path).unwrap();
    runtime.update_checked(&run.id, |_| {}).unwrap();
    runtime.ensure_history_saved().unwrap();
    drop(runtime);
    let restarted = TaskRuntime::new(directory).unwrap();
    let saved = restarted.integration_runs().unwrap().pop().unwrap();
    assert_eq!(saved.result, "latest unsaved output");
    assert!(saved.persistence_error.is_none());
    assert_eq!(saved.status, "review");
    drop(restarted);
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
#[cfg(windows)]
fn startup_keeps_readable_tasks_available_when_the_recovered_state_cannot_be_written() {
    let folder =
        std::env::temp_dir().join(format!("jackalope-startup-save-{}", uuid::Uuid::new_v4()));
    let runtime = TaskRuntime::new(folder.clone()).unwrap();
    let mut run = sample("codex");
    run.process_contained = true;
    runtime.save(&run).unwrap();
    drop(runtime);
    let path = folder.join(format!("{}.json", run.id));
    let original = std::fs::metadata(&path).unwrap().permissions();
    let mut readonly = original.clone();
    readonly.set_readonly(true);
    std::fs::set_permissions(&path, readonly).unwrap();
    let runtime = TaskRuntime::new(folder.clone())
        .expect("a failed checkpoint must not prevent reading other history");
    let recovered = runtime.integration_runs().unwrap().pop().unwrap();
    assert_eq!(recovered.status, "stopped");
    assert!(recovered.persistence_error.is_some());
    assert!(runtime.inner.lock().unwrap().processes.is_empty());
    let saved: TaskRun = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(
        saved.status, "running",
        "failed replacement must keep the checkpoint intact"
    );
    std::fs::set_permissions(&path, original).unwrap();
    runtime.update_checked(&run.id, |_| {}).unwrap();
    assert!(runtime.integration_runs().unwrap()[0]
        .persistence_error
        .is_none());
    drop(runtime);
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn mismatched_identifiers_and_unfinished_saves_cannot_replace_another_task() {
    let folder =
        std::env::temp_dir().join(format!("jackalope-history-id-{}", uuid::Uuid::new_v4()));
    let runtime = TaskRuntime::new(folder.clone()).unwrap();
    let mut good = sample("codex");
    good.status = "review".into();
    good.result = "keep this result".into();
    runtime.save(&good).unwrap();
    let mut mismatch = good.clone();
    mismatch.result = "wrong record".into();
    let wrong = folder.join("another-attempt.json");
    std::fs::write(&wrong, serde_json::to_vec(&mismatch).unwrap()).unwrap();
    let unfinished = folder.join(format!("{}.tmp", good.id));
    std::fs::write(&unfinished, b"partial JSON").unwrap();
    drop(runtime);
    let loaded = TaskRuntime::new(folder.clone()).unwrap();
    assert_eq!(loaded.integration_runs().unwrap().len(), 1);
    assert_eq!(
        loaded.integration_runs().unwrap()[0].result,
        "keep this result"
    );
    assert_eq!(loaded.inner.lock().unwrap().recovery.len(), 2);
    assert_eq!(std::fs::read(&unfinished).unwrap(), b"partial JSON");
    assert!(wrong.with_extension("json.corrupt").exists());
    drop(loaded);
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn oversized_or_summary_records_do_not_overwrite_complete_history() {
    let folder =
        std::env::temp_dir().join(format!("jackalope-history-limit-{}", uuid::Uuid::new_v4()));
    let runtime = TaskRuntime::new(folder.clone()).unwrap();
    let mut run = sample("codex");
    runtime.save(&run).unwrap();
    let path = folder.join(format!("{}.json", run.id));
    let original = std::fs::read(&path).unwrap();
    run.details_omitted = true;
    assert!(runtime.save(&run).is_err());
    run.details_omitted = false;
    run.result = "x".repeat(8_000_001);
    assert!(runtime.save(&run).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), original);
    drop(runtime);
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn corrupt_or_invalid_history_entries_are_quarantined_not_fatal() {
    let folder = std::env::temp_dir().join(format!(
        "jackalope-corrupt-test-{}-{}",
        std::process::id(),
        Utc::now().timestamp_nanos_opt().unwrap()
    ));
    std::fs::create_dir_all(&folder).unwrap();

    let good = sample("codex");
    std::fs::write(
        folder.join(format!("{}.json", good.id)),
        serde_json::to_vec(&good).unwrap(),
    )
    .unwrap();
    std::fs::write(folder.join("garbled-not-json.json"), b"{not json").unwrap();
    let mut bad_id_run = sample("codex");
    bad_id_run.id = "bad".into();
    std::fs::write(
        folder.join("bad-id-file.json"),
        serde_json::to_vec(&bad_id_run).unwrap(),
    )
    .unwrap();

    let runtime = TaskRuntime::new(folder.clone())
        .expect("a corrupted or invalid history entry must not prevent app startup");
    let inner = runtime.inner.lock().unwrap();
    assert_eq!(inner.runs.len(), 1, "only the valid entry should load");
    assert!(inner.runs.contains_key(&good.id));
    assert_eq!(inner.recovery.len(), 2);
    assert!(inner.recovery.iter().all(|entry| entry.quarantined));
    assert!(inner
        .recovery
        .iter()
        .any(|entry| entry.reason == "invalid task identifier"));
    drop(inner);
    drop(runtime);

    assert!(folder.join("garbled-not-json.json.corrupt").exists());
    assert!(!folder.join("garbled-not-json.json").exists());
    assert!(folder.join("bad-id-file.json.corrupt").exists());
    assert!(!folder.join("bad-id-file.json").exists());

    let restarted = TaskRuntime::new(folder.clone()).unwrap();
    let inner = restarted.inner.lock().unwrap();
    assert_eq!(inner.runs.len(), 1);
    assert_eq!(
        inner.recovery.len(),
        2,
        "backups remain visible after restart"
    );
    assert!(inner
        .recovery
        .iter()
        .all(|entry| Path::new(&entry.path).exists()));
    drop(inner);
    drop(restarted);

    assert!(folder.starts_with(std::env::temp_dir()));
    std::fs::remove_dir_all(folder).unwrap();
}

#[tokio::test]
async fn per_agent_discovery_runs_concurrently_not_sequentially() {
    // task_runners() used to run every agent's discover_runner() inside
    // one sequential closure, so a slow probe_auth call (up to its own
    // 10s timeout) added its full duration to the wait for every OTHER
    // agent too. Proves the fix's actual shape - one spawn_blocking per
    // item, collect the handles, then await them - genuinely overlaps
    // rather than only appearing to, using a synthetic blocking delay in
    // place of a real CLI probe (which needs an installed executable).
    let started = std::time::Instant::now();
    let delay = Duration::from_millis(150);
    let handles: Vec<_> = (0..4)
        .map(|_| tauri::async_runtime::spawn_blocking(move || std::thread::sleep(delay)))
        .collect();
    for handle in handles {
        handle.await.unwrap();
    }
    assert!(
        started.elapsed() < delay * 3,
        "four 150ms blocking tasks should overlap (~150ms total), not sum to ~600ms; took {:?}",
        started.elapsed()
    );
}
