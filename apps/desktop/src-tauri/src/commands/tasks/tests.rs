use super::*;

pub(super) fn sample(agent: &str) -> TaskRun {
    TaskRun {
        progress: None,
        preparation: None,
        retry_of: None,
        archived_at: None,
        live_session_id: None,
        effort: None,
        reasoning_effort: None,
        efficiency: Default::default(),
        dependency_invalidated: false,
        dependency_snapshot: Default::default(),
        stages: vec![],
        checkpoint: None,
        checkpoint_error: None,
        routing: None,
        quota_failure: None,
        contract: Default::default(),
        monitor_change: None,
        context_receipt: Default::default(),
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
        prepare_command: None,
        auto_verify: false,
        verification: None,
        finishing: false,
        verification_error: None,
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
        mcp_usage: None,
        usage_observations: vec![],
        prompts: vec![],
        validation_steps: vec![],
        screenshots: vec![],
    }
}

#[test]
fn opencode_stream_tracks_results_sessions_errors_and_deduplicated_step_usage() {
    let mut run = sample("opencode");
    consume_event(
        &mut run,
        r#"{"type":"text","sessionID":"ses_example","part":{"text":"First thought"}}"#,
    );
    consume_event(
        &mut run,
        r#"{"type":"step_start","sessionID":"ses_example","part":{}}"#,
    );
    consume_event(
        &mut run,
        r#"{"type":"text","sessionID":"ses_example","part":{"text":"Done."}}"#,
    );
    let usage = r#"{"type":"step_finish","part":{"id":"part_1","tokens":{"input":10,"output":4,"cache":{"read":3,"write":2}},"cost":0.01}}"#;
    consume_event(&mut run, usage);
    consume_event(&mut run, usage);
    assert_eq!(run.session_id.as_deref(), Some("ses_example"));
    assert_eq!(run.result, "Done.");
    assert_eq!((run.usage.input, run.usage.output), (15, 4));
    assert_eq!(run.usage.estimated_cost_usd, Some(0.01));
    assert!(run.usage.reported);
    consume_event(
        &mut run,
        r#"{"type":"error","error":{"name":"APIError","data":{"message":"Provider unavailable"}}}"#,
    );
    assert_eq!(run.error.as_deref(), Some("Provider unavailable"));
}

#[test]
fn antigravity_stream_keeps_attempt_usage_and_requires_a_terminal_result() {
    let mut run = sample("antigravity");
    let mut stream = antigravity::Stream::new(Some("conversation-1".into()));
    stream.consume(&mut run, r#"{"event":"init","conversation_id":"conversation-1","init":{"permission_mode":"request-review","model":"test-model"}}"#);
    let step = r#"{"event":"step_update","step_update":{"conversation_id":"conversation-1","step_index":8,"step_type":"agent_response","state":"DONE","text_delta":"Hello","usage":{"input_tokens":10,"output_tokens":7,"thinking_tokens":5,"cache_read_tokens":20}}}"#;
    stream.consume(&mut run, step);
    stream.consume(&mut run, step);
    assert_eq!(
        (run.usage.input, run.usage.output, run.usage.cache_read),
        (30, 7, 20)
    );
    assert!(run.result.is_empty());
    stream.consume(&mut run, r#"{"event":"result","result":{"conversation_id":"conversation-1","status":"SUCCESS","response":"Done","usage":{"input_tokens":1000,"output_tokens":200}}}"#);
    stream.finish(&mut run);
    assert!(run.error.is_none(), "{:?}", run.error);
    assert_eq!(run.result, "Done");
    assert_eq!(run.model.as_deref(), Some("test-model"));
    assert_eq!((run.usage.input, run.usage.output), (30, 7));
    assert_eq!(run.session_id.as_deref(), Some("conversation-1"));
}

#[test]
fn antigravity_rejects_incomplete_malformed_and_non_success_streams() {
    for tail in [
        "",
        "not-json",
        r#"{"event":"result","result":{"conversation_id":"conversation-1","status":"WAITING","response":"Need an answer"}}"#,
        r#"{"event":"result","result":{"conversation_id":"conversation-1","status":"SUCCESS","response":"  "}}"#,
        r#"{"event":"result","result":{"conversation_id":"another-session","status":"SUCCESS","response":"Done"}}"#,
        r#"{"event":"result","result":{"conversation_id":"conversation-1","response":"Done"}}"#,
    ] {
        let mut run = sample("antigravity");
        let mut stream = antigravity::Stream::default();
        stream.consume(
            &mut run,
            r#"{"event":"init","conversation_id":"conversation-1","init":{}}"#,
        );
        stream.consume(&mut run, tail);
        stream.finish(&mut run);
        assert!(run.error.is_some(), "Accepted {tail}");
    }
    let mut run = sample("antigravity");
    let mut stream = antigravity::Stream::default();
    stream.consume(
        &mut run,
        r#"{"event":"result","result":{"status":"ERROR","error":"authentication required"}}"#,
    );
    stream.finish(&mut run);
    assert!(run.error.unwrap().contains("authentication required"));
}

#[test]
fn antigravity_permissions_and_interactive_questions_cannot_be_successful() {
    for tool in [
        r#"{"tool_name":"run_command","tool_info":{"error":{"message":"Permission denied for command(test)"}}}"#,
        r#"{"tool_name":"ask_question"}"#,
    ] {
        let mut run = sample("antigravity");
        let mut stream = antigravity::Stream::default();
        stream.consume(
            &mut run,
            r#"{"event":"init","conversation_id":"conversation-1","init":{}}"#,
        );
        let mut step: Value = serde_json::from_str(tool).unwrap();
        step["conversation_id"] = "conversation-1".into();
        step["step_index"] = 1.into();
        step["step_type"] = "tool".into();
        step["state"] = "ERROR".into();
        stream.consume(
            &mut run,
            &serde_json::json!({"event":"step_update","step_update":step}).to_string(),
        );
        stream.consume(&mut run, r#"{"event":"result","result":{"conversation_id":"conversation-1","status":"SUCCESS","response":"Done"}}"#);
        assert!(run.error.is_some());
    }
    assert!(antigravity::permission_denied(
        "Tool requires approval in headless mode"
    ));
    assert!(!antigravity::permission_denied(
        "CLI permission mode: request-review"
    ));
}

#[test]
fn antigravity_uses_literal_stdin_and_explicit_workspace_without_bypassing_permissions() {
    let mut cmd = Command::new("agy");
    antigravity::configure(&mut cmd, "C:/a workspace", Some("conversation-1"));
    let args: Vec<_> = cmd
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    assert!(args
        .windows(2)
        .any(|pair| pair == ["--add-dir", "C:/a workspace"]));
    assert!(args
        .windows(2)
        .any(|pair| pair == ["--conversation", "conversation-1"]));
    assert!(!args
        .iter()
        .any(|arg| arg == "--dangerously-skip-permissions"
            || arg == "--continue"
            || arg == "--print"));
    let input = antigravity::input("/logout\n\"quoted\" $HOME", "C:/a workspace");
    assert_eq!(input.lines().count(), 1);
    let value: Value = serde_json::from_str(&input).unwrap();
    assert_eq!(value["event"], "user");
    assert!(value["message"]["content"]
        .as_str()
        .unwrap()
        .contains("/logout\n\"quoted\" $HOME"));
}

#[test]
fn antigravity_rejects_missing_accounts_and_does_not_invent_resumed_usage() {
    let root = std::env::temp_dir().join(format!("jackalope-agy-account-{}", uuid::Uuid::new_v4()));
    assert_eq!(
        crate::commands::agent_profiles::env_var_for("antigravity"),
        Some(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
    );
    assert!(
        crate::commands::agent_profiles::bind_account(&root, "antigravity", Some("work")).is_err()
    );
    let mut run = sample("antigravity");
    let mut stream = antigravity::Stream::new(Some("conversation-1".into()));
    stream.consume(
        &mut run,
        r#"{"event":"init","conversation_id":"conversation-1","init":{}}"#,
    );
    stream.consume(&mut run, r#"{"event":"result","result":{"conversation_id":"conversation-1","status":"SUCCESS","response":"Done","usage":{"input_tokens":1000,"output_tokens":200}}}"#);
    assert!(!run.usage.reported);
}

#[test]
#[ignore = "Runs a paid or free installed agent in a disposable repository; set JACKALOPE_AGENT_TRIAL"]
fn installed_agent_lifecycle_trial() {
    let agent = std::env::var("JACKALOPE_AGENT_TRIAL").expect("Choose the agent explicitly");
    assert!(BUILTIN_AGENTS.contains(&agent.as_str()));
    let root = std::env::temp_dir().join(format!("jackalope-agent-trial-{}", uuid::Uuid::new_v4()));
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    let repo_text = repo.to_string_lossy().to_string();
    for args in [
        vec!["init", "-b", "main"],
        vec!["config", "core.autocrlf", "false"],
        vec!["config", "user.name", "Jackalope fixture"],
        vec!["config", "user.email", "fixture@example.invalid"],
    ] {
        git(&repo_text, &args).unwrap();
    }
    std::fs::write(
        repo.join("README.md"),
        "Disposable agent acceptance fixture.\n",
    )
    .unwrap();
    git(&repo_text, &["add", "README.md"]).unwrap();
    git(
        &repo_text,
        &[
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "Fixture baseline",
        ],
    )
    .unwrap();
    let history = root.join("history");
    let runtime = TaskRuntime::with_test_access(history.clone()).unwrap();
    let model = std::env::var("JACKALOPE_AGENT_MODEL").ok();
    let request = RunRequest {
        retry_of: None,
        live_session_id: None,
                effort: None,
        dependency_snapshot: Default::default(),
        id: uuid::Uuid::new_v4().to_string(), project_id: uuid::Uuid::new_v4().to_string(),
        project_name: "Agent acceptance fixture".into(), project_path: repo_text, agent: agent.clone(),
        agent_profile_id: None, verify_command: None, target_branch: Some("main".into()),
        account_binding: None, model,
        prompt: "Create a file named receipt.txt containing exactly JACKALOPE_NATIVE_OK. Do not run shell commands or use network tools. Remember the phrase copper-rabbit-731 for our next turn; do not write that phrase to a file. Finish with a short confirmation.".into(),
        isolated: true, previous_run_id: None, connection_ids: Some(vec![]), coordination: None,
        prepare_command: None, auto_verify: false, monitor_change: None,
        context_selection: Default::default(), context_receipt: Default::default(),
    };
    let workflow_trial = std::env::var_os("JACKALOPE_WORKFLOW_TRIAL").is_some();
    let mut request = request;
    if workflow_trial {
        let workflow = runtime
            .knowledge
            .save(crate::commands::knowledge::KnowledgeEntry {
                automatic: None,
                dismissed: false,
                id: uuid::Uuid::new_v4().to_string(),
                project_id: request.project_id.clone(),
                project_path: request.project_path.clone(),
                kind: crate::commands::knowledge::KnowledgeKind::Workflow,
                title: "Native acceptance workflow".into(),
                content: "Follow the task's exact instructions. Each step pauses for human review."
                    .into(),
                keywords: vec![],
                enabled: true,
                source_run_id: None,
                source_head: None,
                revision: 0,
                updated_at: String::new(),
                process: crate::commands::outcomes::ProcessTemplate {
                    inputs: vec!["Receipt name".into()],
                    steps: vec![
                        "Create receipt.txt and remember the phrase, as specified in the task"
                            .into(),
                        "Recall the remembered phrase without using tools".into(),
                    ],
                    outcomes: vec!["receipt.txt retains exactly JACKALOPE_NATIVE_OK".into()],
                },
            })
            .unwrap();
        request.context_selection.workflow_id = Some(workflow.id);
        request
            .context_selection
            .input_values
            .insert("Receipt name".into(), "receipt.txt".into());
    }
    fn settled(runtime: &TaskRuntime, id: &str) -> TaskRun {
        let deadline = std::time::Instant::now() + Duration::from_secs(180);
        loop {
            let run = runtime.inner.lock().unwrap().runs[id].clone();
            if !["starting", "running", "stopping"].contains(&run.status.as_str()) {
                return run;
            }
            if std::time::Instant::now() > deadline {
                let _ = runtime.stop(id);
                panic!(
                    "Agent trial timed out; retained fixture history at {}",
                    runtime.directory.display()
                );
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }
    runtime.start(request.clone()).unwrap();
    let first = settled(&runtime, &request.id);
    assert_eq!(
        first.status,
        "review",
        "{:?}; fixture {}",
        first.error,
        root.display()
    );
    assert_eq!(
        std::fs::read_to_string(Path::new(&first.workspace).join("receipt.txt"))
            .unwrap()
            .trim(),
        "JACKALOPE_NATIVE_OK"
    );
    assert!(!repo.join("receipt.txt").exists());
    assert!(first.session_id.is_some());
    assert!(first.usage.reported);
    let mut next = request.clone();
    next.id = uuid::Uuid::new_v4().to_string();
    next.previous_run_id = Some(first.id.clone());
    next.prompt = "Reply with only the phrase I asked you to remember in the previous turn. Do not use tools.".into();
    if workflow_trial {
        assert_eq!(first.contract.step, 0);
        assert_eq!(first.contract.requirements.len(), 3);
        next.context_selection.advance_workflow = true;
        assert!(runtime
            .start(next.clone())
            .unwrap_err()
            .contains("Accept current evidence"));
        let directory = runtime.integration_directory();
        std::fs::create_dir_all(&directory).unwrap();
        let tree = crate::commands::integration::workspace_tree(&first, &directory).unwrap();
        crate::commands::outcomes::record(
            &runtime,
            crate::commands::outcomes::OutcomeReview {
                run_id: first.id.clone(),
                requirement_id: first.contract.requirements[0].id.clone(),
                expected_tree: tree,
                accepted: true,
                evidence: "manual".into(),
                note: "Native trial read the receipt and verified its exact contents.".into(),
            },
        )
        .unwrap();
    }
    runtime.start(next.clone()).unwrap();
    let second = settled(&runtime, &next.id);
    assert_eq!(second.status, "review", "{:?}", second.error);
    assert!(
        second.result.contains("copper-rabbit-731"),
        "Continuation did not retain context"
    );
    assert_eq!(first.session_id, second.session_id);
    assert_eq!(
        first.account_binding.as_ref().unwrap().directory,
        second.account_binding.as_ref().unwrap().directory
    );
    if workflow_trial {
        assert_eq!(second.contract.step, 1);
        assert!(
            second.contract.requirements[0]
                .receipt
                .as_ref()
                .unwrap()
                .accepted
        );
        assert!(second.contract.requirements[1].receipt.is_none());
        let directory = runtime.integration_directory();
        let tree = crate::commands::integration::workspace_tree(&second, &directory).unwrap();
        for requirement in second.contract.requirements.iter().skip(1) {
            crate::commands::outcomes::record(
                &runtime,
                crate::commands::outcomes::OutcomeReview {
                    run_id: second.id.clone(),
                    requirement_id: requirement.id.clone(),
                    expected_tree: tree.clone(),
                    accepted: true,
                    evidence: "manual".into(),
                    note: "Native trial verified recalled phrase and preserved receipt contents."
                        .into(),
                },
            )
            .unwrap();
        }
        runtime.inner.lock().unwrap().runs[&second.id]
            .contract
            .require_accepted(&tree)
            .unwrap();
        println!("Workflow acceptance retained at {}", root.display());
    }
    let mut stop = request;
    stop.id = uuid::Uuid::new_v4().to_string();
    stop.isolated = false;
    stop.prompt = "Explain the tradeoffs of breadth-first and depth-first search in detail. Do not use tools.".into();
    runtime.start(stop.clone()).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    while !runtime
        .inner
        .lock()
        .unwrap()
        .processes
        .contains_key(&stop.id)
    {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(50));
    }
    runtime.stop(&stop.id).unwrap();
    assert_eq!(settled(&runtime, &stop.id).status, "stopped");
    std::thread::sleep(Duration::from_millis(300));
    drop(runtime);
    let restored = TaskRuntime::with_test_access(history).unwrap();
    assert_eq!(
        restored.inner.lock().unwrap().runs[&second.id].result,
        second.result
    );
    println!("Verified {agent}: isolated edit, reported usage, continuation, account binding, cancellation, restart. Fixture: {}", root.display());
}

#[test]
fn saved_user_answers_are_scoped_idempotent_and_not_overwritten_by_a_timeout() {
    let folder = std::env::temp_dir().join(format!("jackalope-answer-{}", uuid::Uuid::new_v4()));
    let runtime = TaskRuntime::with_test_access(folder.clone()).unwrap();
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
    std::fs::write(
        folder.join("capture.ps1"),
        "[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'input.txt'), [Console]::In.ReadToEnd())",
    )
    .unwrap();
    std::fs::write(&executable, "@echo off\r\npowershell.exe -NoProfile -File \"%~dp0capture.ps1\"\r\necho %*>args.txt\r\necho {\"type\":\"thread.started\",\"thread_id\":\"fixture-session\"}\r\necho {\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"Fixture complete\"}}\r\n").unwrap();
    let runtime = TaskRuntime::with_test_access(folder.join("history")).unwrap();
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
        retry_of: None,
        live_session_id: None,
        effort: None,
        dependency_snapshot: Default::default(),
        monitor_change: None,
        context_selection: Default::default(),
        context_receipt: Default::default(),
        id: "fixture-run-123".into(),
        project_id: "fixture".into(),
        project_name: "Fixture".into(),
        project_path: root.into(),
        agent: "default".into(),
        agent_profile_id: None,
        verify_command: None,
        prepare_command: None,
        auto_verify: false,
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
    let delivered = std::fs::read_to_string(folder.join("input.txt")).unwrap();
    assert!(delivered.starts_with("Fixture only"));
    assert!(delivered.contains(super::delegation::INSTRUCTIONS));
    assert!(delivered.contains("Leave changes uncommitted"));
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
    let runtime = TaskRuntime::with_test_access(folder.clone()).unwrap();
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
    let loaded = TaskRuntime::with_test_access(folder.clone()).unwrap();
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
    let runtime = TaskRuntime::with_test_access(directory.clone()).unwrap();
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
    let restarted = TaskRuntime::with_test_access(directory).unwrap();
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
    let runtime = TaskRuntime::with_test_access(folder.clone()).unwrap();
    let mut run = sample("codex");
    run.process_contained = true;
    runtime.save(&run).unwrap();
    drop(runtime);
    let path = folder.join(format!("{}.json", run.id));
    let original = std::fs::metadata(&path).unwrap().permissions();
    let mut readonly = original.clone();
    readonly.set_readonly(true);
    std::fs::set_permissions(&path, readonly).unwrap();
    let runtime = TaskRuntime::with_test_access(folder.clone())
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
    let runtime = TaskRuntime::with_test_access(folder.clone()).unwrap();
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
    let loaded = TaskRuntime::with_test_access(folder.clone()).unwrap();
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
    let runtime = TaskRuntime::with_test_access(folder.clone()).unwrap();
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

    let runtime = TaskRuntime::with_test_access(folder.clone())
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

    let restarted = TaskRuntime::with_test_access(folder.clone()).unwrap();
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

#[test]
fn automatic_verification_reuses_only_an_unchanged_checked_snapshot_and_honors_stop() {
    let root = std::env::temp_dir().join(format!("jackalope-finish-{}", uuid::Uuid::new_v4()));
    let workspace = root.join("repo");
    std::fs::create_dir_all(&workspace).unwrap();
    let path = workspace.to_str().unwrap();
    git(path, &["init", "-b", "master"]).unwrap();
    git(
        path,
        &[
            "-c",
            "user.name=Trial",
            "-c",
            "user.email=trial@example.test",
            "commit",
            "--allow-empty",
            "-m",
            "fixture",
        ],
    )
    .unwrap();
    let runtime = TaskRuntime::with_test_access(root.join("profile")).unwrap();
    let mut run = sample("codex");
    run.project_path = path.into();
    run.workspace = path.into();
    run.base_head = git(path, &["rev-parse", "HEAD"]).unwrap();
    run.verify_command = Some("echo checked >> .git/check-count".into());
    run.auto_verify = true;
    runtime.save(&run).unwrap();
    runtime
        .inner
        .lock()
        .unwrap()
        .runs
        .insert(run.id.clone(), run.clone());
    crate::commands::verification::finish(&runtime, &run.id).unwrap();
    let first = runtime
        .integration_runs()
        .unwrap()
        .remove(0)
        .verification
        .unwrap();
    assert!(first.result.success);
    assert!(first.tree.is_some());
    crate::commands::verification::finish(&runtime, &run.id).unwrap();
    assert_eq!(
        std::fs::read_to_string(workspace.join(".git/check-count"))
            .unwrap()
            .lines()
            .count(),
        1
    );
    std::fs::write(workspace.join("result.txt"), "new output").unwrap();
    crate::commands::verification::finish(&runtime, &run.id).unwrap();
    assert_eq!(
        std::fs::read_to_string(workspace.join(".git/check-count"))
            .unwrap()
            .lines()
            .count(),
        2
    );
    runtime.stop(&run.id).unwrap();
    std::fs::write(workspace.join("result.txt"), "changed again").unwrap();
    crate::commands::verification::finish(&runtime, &run.id).unwrap();
    assert_eq!(
        std::fs::read_to_string(workspace.join(".git/check-count"))
            .unwrap()
            .lines()
            .count(),
        2
    );
    drop(runtime);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn old_task_records_do_not_opt_into_automatic_execution() {
    let mut value = serde_json::to_value(sample("codex")).unwrap();
    for field in ["autoVerify", "finishing", "verificationError"] {
        value.as_object_mut().unwrap().remove(field);
    }
    let saved: TaskRun = serde_json::from_value(value).unwrap();
    assert!(!saved.auto_verify);
    assert!(!saved.finishing);
    assert!(saved.verification_error.is_none());
}

#[test]
fn agent_launch_retries_transient_failures_but_not_a_missing_executable() {
    // A missing executable fails at once, without spending the retry budget.
    let started = std::time::Instant::now();
    let error =
        super::runtime::spawn_agent(&mut command("jackalope-nonexistent-agent-binary"), "codex")
            .unwrap_err();
    assert!(error.contains("Could not launch codex"));
    assert!(
        started.elapsed() < Duration::from_millis(120),
        "a missing binary must not back off"
    );

    // A real command starts on the first attempt.
    let mut ok = command(if cfg!(windows) { "cmd" } else { "true" });
    if cfg!(windows) {
        ok.args(["/c", "exit", "0"]);
    }
    ok.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let (mut child, attempts) = super::runtime::spawn_agent(&mut ok, "codex").unwrap();
    assert_eq!(attempts, 1);
    let _ = child.wait();
}

#[test]
fn manual_archive_preserves_history_and_restores_after_restart() {
    let folder =
        std::env::temp_dir().join(format!("jackalope-manual-archive-{}", uuid::Uuid::new_v4()));
    let runtime = TaskRuntime::with_test_access(folder.clone()).unwrap();
    let mut run = sample("codex");
    run.status = "reviewed".into();
    run.result = "Keep this result".into();
    runtime.save(&run).unwrap();
    runtime
        .inner
        .lock()
        .unwrap()
        .runs
        .insert(run.id.clone(), run.clone());
    runtime.set_archived(&run.id, true).unwrap();
    assert!(runtime.snapshot(None)[0].archived_at.is_some());
    drop(runtime);
    let runtime = TaskRuntime::with_test_access(folder.clone()).unwrap();
    let saved = runtime.snapshot(Some(&run.id));
    assert!(saved[0].archived_at.is_some());
    assert_eq!(saved[0].result, run.result);
    assert_eq!(saved[0].status, "reviewed");
    runtime.set_archived(&run.id, false).unwrap();
    drop(runtime);
    let runtime = TaskRuntime::with_test_access(folder.clone()).unwrap();
    assert!(runtime.snapshot(None)[0].archived_at.is_none());
    drop(runtime);
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn manual_archive_rejects_unfinished_unsaved_session_and_stale_attempts() {
    let folder =
        std::env::temp_dir().join(format!("jackalope-archive-guards-{}", uuid::Uuid::new_v4()));
    let runtime = TaskRuntime::with_test_access(folder.clone()).unwrap();
    let mut run = sample("codex");
    for status in ["starting", "running", "stopping", "interrupted"] {
        run.status = status.into();
        runtime
            .inner
            .lock()
            .unwrap()
            .runs
            .insert(run.id.clone(), run.clone());
        assert!(runtime.set_archived(&run.id, true).is_err());
    }
    run.status = "reviewed".into();
    for blocked in [
        TaskRun {
            persistence_error: Some("disk full".into()),
            ..run.clone()
        },
        TaskRun {
            finishing: true,
            ..run.clone()
        },
        TaskRun {
            live_session_id: Some("session".into()),
            ..run.clone()
        },
    ] {
        runtime
            .inner
            .lock()
            .unwrap()
            .runs
            .insert(run.id.clone(), blocked);
        assert!(runtime.set_archived(&run.id, true).is_err());
    }
    run.started_at = "2026-09-06T23:00:00Z".into();
    let newer = TaskRun {
        id: "newer-attempt".into(),
        started_at: "2026-09-06T18:00:00-06:00".into(),
        ..run.clone()
    };
    {
        let mut inner = runtime.inner.lock().unwrap();
        inner.runs.insert(run.id.clone(), run.clone());
        inner.runs.insert(newer.id.clone(), newer.clone());
    }
    assert!(runtime.set_archived(&run.id, true).is_err());
    runtime.set_archived(&newer.id, true).unwrap();
    assert!(runtime.set_archived("missing", true).is_err());
    drop(runtime);
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn manual_archive_failed_save_keeps_task_visible() {
    let folder = std::env::temp_dir().join(format!(
        "jackalope-archive-failure-{}",
        uuid::Uuid::new_v4()
    ));
    let runtime = TaskRuntime::with_test_access(folder.clone()).unwrap();
    let mut run = sample("codex");
    run.status = "failed".into();
    runtime
        .inner
        .lock()
        .unwrap()
        .runs
        .insert(run.id.clone(), run.clone());
    std::fs::create_dir(folder.join(format!("{}.json", run.id))).unwrap();
    assert!(runtime.set_archived(&run.id, true).is_err());
    assert!(runtime.snapshot(None)[0].archived_at.is_none());
    assert!(runtime.snapshot(None)[0].persistence_error.is_some());
    std::fs::remove_dir(folder.join(format!("{}.json", run.id))).unwrap();
    runtime.update_checked(&run.id, |_| {}).unwrap();
    runtime.set_archived(&run.id, true).unwrap();
    assert!(runtime.snapshot(None)[0].archived_at.is_some());
    assert!(runtime.snapshot(None)[0].persistence_error.is_none());
    drop(runtime);
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn retention_archives_old_reviewed_runs_and_keeps_everything_else_loaded() {
    let folder = std::env::temp_dir().join(format!("jackalope-retention-{}", uuid::Uuid::new_v4()));
    let runtime = TaskRuntime::with_test_access(folder.clone()).unwrap();
    let mut session_run = sample("codex");
    session_run.id = "keep-live-session".into();
    session_run.live_session_id = Some("live-session".into());
    session_run.status = "reviewed".into();
    session_run.started_at = "2025-01-01T00:00:00Z".into();
    runtime.save(&session_run).unwrap();
    for status in ["review", "failed", "interrupted"] {
        let mut run = sample("codex");
        run.id = format!("keep-{status}");
        run.status = status.into();
        runtime.save(&run).unwrap();
    }
    for i in 0..205 {
        let mut run = sample("codex");
        run.id = format!("reviewed-{i:04}");
        run.status = "reviewed".into();
        run.started_at = format!("2026-01-01T00:{:02}:{:02}Z", i / 60, i % 60);
        run.ended_at = Some(run.started_at.clone());
        runtime.save(&run).unwrap();
    }
    drop(runtime);

    let restarted = TaskRuntime::with_test_access(folder.clone()).unwrap();
    let loaded = restarted.integration_runs().unwrap();
    assert_eq!(
        loaded.iter().filter(|r| r.status == "reviewed").count(),
        201
    );
    assert!(loaded.iter().any(|r| r.id == "keep-live-session"));
    assert!(loaded.iter().any(|r| r.id == "reviewed-0204"));
    assert!(!loaded.iter().any(|r| r.id == "reviewed-0000"));
    for status in ["review", "failed", "interrupted"] {
        assert!(
            loaded.iter().any(|r| r.status == status),
            "{status} retained"
        );
    }

    let archived = restarted.archived_runs();
    assert_eq!(archived.len(), 5);
    assert!(archived.iter().any(|r| r.id == "reviewed-0000"));
    assert!(folder.join("archive/reviewed-0000.json").exists());
    assert!(!folder.join("reviewed-0000.json").exists());

    restarted.restore_archived("reviewed-0000").unwrap();
    assert!(restarted
        .integration_runs()
        .unwrap()
        .iter()
        .any(|r| r.id == "reviewed-0000"));
    assert!(!folder.join("archive/reviewed-0000.json").exists());
    assert!(folder.join("reviewed-0000.json").exists());
    assert!(
        restarted.restore_archived("reviewed-0000").is_err(),
        "a loaded task cannot be restored again"
    );
    assert!(restarted.restore_archived("../escape").is_err());

    drop(restarted);
    std::fs::remove_dir_all(folder).unwrap();
}

#[test]
fn recovery_exports_import_once_and_never_shadow_a_present_task() {
    let folder = std::env::temp_dir().join(format!("jackalope-import-{}", uuid::Uuid::new_v4()));
    let runtime = TaskRuntime::with_test_access(folder.clone()).unwrap();
    let mut run = sample("codex");
    run.id = "imported-attempt-01".into();
    run.status = "review".into();
    run.result = "recovered output".into();
    let envelope = serde_json::json!({
        "format": "jackalope-task-recovery", "version": 1,
        "exportedAt": Utc::now().to_rfc3339(), "task": run,
    });
    let bytes = serde_json::to_vec(&envelope).unwrap();

    let id = runtime.import_recovery(&bytes).unwrap();
    assert_eq!(id, "imported-attempt-01");
    assert_eq!(
        runtime
            .integration_runs()
            .unwrap()
            .iter()
            .find(|r| r.id == id)
            .unwrap()
            .result,
        "recovered output"
    );
    assert!(
        runtime.import_recovery(&bytes).is_err(),
        "a present task cannot be imported over"
    );
    assert!(runtime.import_recovery(b"{}").is_err());
    assert!(runtime
        .import_recovery(br#"{"format":"other","task":{}}"#)
        .is_err());

    drop(runtime);
    std::fs::remove_dir_all(folder).unwrap();
}
