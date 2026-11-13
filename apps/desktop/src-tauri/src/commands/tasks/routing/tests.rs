use super::*;

#[test]
fn equivalent_workers_require_the_same_explicit_model_and_agent() {
    let a = candidate("a", "codex", "model", Some(80.0));
    let mut b = candidate("b", "codex", "model", Some(60.0));
    b.binding.directory = PathBuf::from("/another-account");
    assert!(equivalent_workers(&[a.clone(), b.clone()]));
    b.model = None;
    assert!(!equivalent_workers(&[b.clone(), b.clone()]));
    b.model = Some("different".into());
    assert!(!equivalent_workers(&[a.clone(), b.clone()]));
    b.model = a.model.clone();
    b.agent = "custom-codex".into();
    assert!(!equivalent_workers(&[a, b]));
    assert!(!equivalent_workers(&[]));
}

pub(super) fn candidate(id: &str, adapter: &str, model: &str, left: Option<f64>) -> Candidate {
    Candidate {
        id: id.into(),
        agent: adapter.into(),
        adapter: adapter.into(),
        model: Some(model.into()),
        account: "Fixture".into(),
        profile_id: None,
        remaining_percent: left,
        quota_status: "reported".into(),
        quota_windows: vec![],
        quota_observed_at: None,
        active_tasks: 0,
        preferred: false,
        quota_pools: vec![format!("{adapter}:fixture:weekly")],
        binding: AccountBinding {
            adapter: adapter.into(),
            profile_id: None,
            directory: PathBuf::from(format!("/{adapter}")),
            label: "Fixture".into(),
        },
    }
}

#[test]
fn routing_rejects_unavailable_and_injected_selections_and_uses_ranked_headroom() {
    let candidates = vec![
        candidate("low", "codex", "small", Some(15.0)),
        candidate("room", "claude", "sonnet", Some(70.0)),
    ];
    for value in [
        r#"{"candidateId":"missing","reason":"invented"}"#,
        r#"{"candidateId":"room","reason":"ok","command":"evil"}"#,
        r#"{"candidateId":"room","reason":"ok","alternatives":["room"]}"#,
        r#"{"candidateId":"room","reason":"ok","expectedUsagePercent":-5}"#,
    ] {
        assert!(choose(value, &candidates).is_err());
    }
    let (chosen, _) = choose(r#"{"candidateId":"low","reason":"Task fit","expectedUsagePercent":10,"alternatives":["room"]}"#, &candidates).unwrap();
    assert_eq!(chosen.id, "room");
    assert!(choose(
        r#"{"candidateId":"low","reason":"Task fit","expectedUsagePercent":10}"#,
        &candidates
    )
    .is_err());
}

#[test]
fn routing_unknown_stale_and_model_scoped_quota_remain_distinct() {
    let now = Utc::now().timestamp();
    let mut record = CapacityRecord {
        agent: "claude".into(),
        status: "reported".into(),
        account: "Fixture".into(),
        source: "Fixture".into(),
        observed_at: Some(Utc::now().to_rfc3339()),
        detail: String::new(),
        windows: vec![capacity::CapacityWindow {
            pool_id: "account:opus".into(),
            pool_name: "Claude Opus".into(),
            window: "weekly".into(),
            used_percent: Some(100.0),
            remaining_percent: Some(0.0),
            duration_minutes: Some(10080),
            resets_at: Some(now + 3600),
        }],
    };
    assert_eq!(remaining(&record, Some("opus"), now), Some(0.0));
    assert_eq!(remaining(&record, Some("sonnet"), now), None);
    assert_eq!(remaining(&record, None, now), Some(0.0));
    record.status = "stale".into();
    assert_eq!(remaining(&record, Some("opus"), now), None);
    record.status = "reported".into();
    assert_eq!(remaining(&record, Some("opus"), now + 61), None);
    record.agent = "antigravity".into();
    record.windows[0].pool_name = "Claude and GPT models".into();
    let mut gemini = record.windows[0].clone();
    gemini.pool_name = "Gemini Models".into();
    gemini.remaining_percent = Some(75.0);
    record.windows.push(gemini);
    assert_eq!(remaining(&record, Some("gemini-pro"), now), Some(75.0));
    assert_eq!(remaining(&record, Some("claude-opus"), now), Some(0.0));
    assert_eq!(remaining(&record, Some("gpt-model"), now), Some(0.0));
    assert_eq!(remaining(&record, Some("unknown-model"), now), None);
    assert_eq!(remaining(&record, None, now), None);
}

#[test]
fn routing_excludes_shared_exhausted_accounts_but_preserves_other_model_pools() {
    let first = candidate("first", "claude", "opus", Some(70.0));
    let mut alias = candidate("alias", "claude", "sonnet", Some(70.0));
    alias.binding.directory = PathBuf::from("/other-profile-same-account");
    let mut old = Handoff {
        quota_pools: first.quota_pools.clone(),
        agent: first.agent.clone(),
        model: first.model.clone(),
        binding: first.binding.clone(),
        session_id: None,
        result: String::new(),
        usage: Usage::default(),
        failure: QuotaFailure {
            model_only: false,
            message: "Quota".into(),
        },
        recorded_at: Utc::now().to_rfc3339(),
    };
    assert!(!eligible(&alias, &[old.clone()]));
    old.failure.model_only = true;
    assert!(eligible(&alias, &[old.clone()]));
    assert!(!eligible(&first, &[old]));
    assert!(!eligible(
        &candidate("empty", "codex", "small", Some(0.0)),
        &[]
    ));
    assert!(eligible(&candidate("unknown", "codex", "small", None), &[]));
}

#[test]
fn routing_owned_process_handoff_preserves_workspace_and_restart_history() {
    exercise_quota_handoff(true);
}

#[test]
fn routing_disabled_handoff_preserves_partial_work_without_starting_a_backup() {
    exercise_quota_handoff(false);
}

fn exercise_quota_handoff(enabled: bool) {
    let root = std::env::temp_dir().join(format!(
        "jackalope-routing-fixture-{}",
        uuid::Uuid::new_v4()
    ));
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    let source = root.join("fixture.rs");
    std::fs::write(&source, r##"
use std::io::{Read,Write};
fn main() {
  let mut input=String::new(); std::io::stdin().read_to_string(&mut input).unwrap();
  if input.contains("cancel fixture") { std::thread::sleep(std::time::Duration::from_secs(30)); }
  if input.starts_with("You are Jackalope's routing coordinator.") {
    println!(r#"{{"type":"item.completed","item":{{"type":"agent_message","text":"{{\"candidateId\":\"option-0\",\"reason\":\"Fixture task fit\",\"expectedUsagePercent\":null,\"alternatives\":[\"option-1\"]}}"}}}}"#);
  } else if std::env::args().any(|arg|arg=="--json") {
    std::fs::write("partial.txt","preserved progress").unwrap();
    println!(r#"{{"type":"turn.failed","error":{{"code":"insufficient_quota","message":"usage limit reached"}}}}"#);
    std::io::stdout().flush().unwrap();
  } else {
    assert_eq!(std::fs::read_to_string("partial.txt").unwrap(),"preserved progress");
    assert!(input.contains("quota handoff"));
    std::fs::write("completed.txt","handoff completed").unwrap();
    println!(r#"{{"type":"result","is_error":false,"result":"Completed the task from preserved progress.","usage":{{"input_tokens":4,"output_tokens":5}}}}"#);
  }
}
"##).unwrap();
    let executable = root.join(if cfg!(windows) {
        "fixture.exe"
    } else {
        "fixture"
    });
    let built = command("rustc")
        .arg(&source)
        .arg("-o")
        .arg(&executable)
        .output()
        .unwrap();
    assert!(
        built.status.success(),
        "{}",
        String::from_utf8_lossy(&built.stderr)
    );
    let repo = repo.to_str().unwrap();
    git(repo, &["init", "-b", "main"]).unwrap();
    std::fs::write(Path::new(repo).join("README.md"), "Routing fixture").unwrap();
    git(repo, &["add", "README.md"]).unwrap();
    git(
        repo,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "Fixture",
        ],
    )
    .unwrap();
    let history = root.join("history");
    let runtime = TaskRuntime::with_test_access(history.clone()).unwrap();
    let mut policy = AgentPolicy::default();
    policy.automatic_quota_handoff = Some(enabled);
    for id in crate::commands::agents::builtin_ids() {
        policy.enabled_agents.insert(id.into(), false);
    }
    policy.default_meta_agent = "fixture-a".into();
    for (id, adapter) in [("fixture-a", "codex"), ("fixture-b", "claude")] {
        policy
            .custom_agents
            .push(crate::commands::agent_policy::CustomAgent {
                id: id.into(),
                name: id.into(),
                command: executable.to_string_lossy().into_owned(),
                adapter: Some(adapter.into()),
                args: Vec::new(),
            });
    }
    let policy_path = runtime.policy_path();
    std::fs::create_dir_all(policy_path.parent().unwrap()).unwrap();
    std::fs::write(policy_path, serde_json::to_vec(&policy).unwrap()).unwrap();
    // The Claude fixture answers one prompt and exits, as a one-shot launch expects.
    crate::commands::tasks::claude_session::set_test_settings(
        "routing-fixture",
        Default::default(),
    );
    let id = uuid::Uuid::new_v4().to_string();
    let request: RunRequest = serde_json::from_value(serde_json::json!({"id":id,"projectId":"routing-fixture","projectName":"Routing fixture","projectPath":repo,"agent":"auto","prompt":"Complete the fixture while preserving progress.","isolated":true,"connectionIds":[]})).unwrap();
    runtime.start(request.clone()).unwrap();
    assert_eq!(runtime.start(request).unwrap(), id);
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    let settled = loop {
        let run = runtime.inner.lock().unwrap().runs[&id].clone();
        if !run.status.is_active() {
            break run;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "Routing fixture timed out at {}",
            root.display()
        );
        std::thread::sleep(Duration::from_millis(50));
    };
    if !enabled {
        assert_eq!(settled.status, RunStatus::Failed);
        assert!(settled
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("handoff is turned off"));
        assert!(settled.quota_failure.is_some());
        assert!(settled.routing.as_ref().unwrap().handoffs.is_empty());
        assert_eq!(settled.routing.as_ref().unwrap().decisions.len(), 1);
        assert!(Path::new(&settled.workspace).join("partial.txt").is_file());
        assert!(!Path::new(&settled.workspace).join("completed.txt").exists());
        assert!(runtime.inner.lock().unwrap().processes.is_empty());
        return;
    }
    assert_eq!(
        settled.status,
        RunStatus::Review,
        "{:?} / {:?} at {}",
        settled.error,
        settled.activity,
        root.display()
    );
    assert_eq!(settled.agent, "fixture-b");
    assert_eq!(settled.routing.as_ref().unwrap().handoffs.len(), 1);
    assert_eq!(settled.routing.as_ref().unwrap().decisions.len(), 2);
    assert!(Path::new(&settled.workspace).join("completed.txt").exists());
    assert!(runtime.inner.lock().unwrap().processes.is_empty());
    while Arc::strong_count(&runtime._owner) > 1 {
        std::thread::sleep(Duration::from_millis(10));
    }
    drop(runtime);
    let restored = TaskRuntime::with_test_access(history).unwrap();
    let run = restored.inner.lock().unwrap().runs[&id].clone();
    assert_eq!(run.workspace, settled.workspace);
    assert_eq!(run.routing.unwrap().handoffs.len(), 1);
    let cancel_id = uuid::Uuid::new_v4().to_string();
    let request: RunRequest = serde_json::from_value(serde_json::json!({"id":cancel_id,"projectId":"routing-cancel-fixture","projectName":"Cancellation fixture","projectPath":repo,"agent":"auto","prompt":"cancel fixture","isolated":true,"connectionIds":[]})).unwrap();
    restored.start(request).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    while !restored
        .inner
        .lock()
        .unwrap()
        .processes
        .contains_key(&cancel_id)
    {
        assert!(std::time::Instant::now() < deadline, "Router never started");
        std::thread::sleep(Duration::from_millis(20));
    }
    restored.stop(&cancel_id).unwrap();
    while restored.inner.lock().unwrap().runs[&cancel_id].status != RunStatus::Stopped {
        assert!(std::time::Instant::now() < deadline, "Router did not stop");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(restored.inner.lock().unwrap().processes.is_empty());
    let canceled = restored.inner.lock().unwrap().runs[&cancel_id].clone();
    assert!(canceled.routing.as_ref().unwrap().decisions.is_empty());
    assert!(!Path::new(&canceled.workspace).join("partial.txt").exists());
}

#[test]
fn claude_rejecting_requests_names_the_used_up_window_and_when_it_resets() {
    // Field names as the Claude Agent SDK types SDKRateLimitInfo; resetsAt is Unix seconds.
    let event = |info: serde_json::Value| {
        quota_failure(&serde_json::json!({"type":"rate_limit_event","rate_limit_info":info,"uuid":"0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f","session_id":"5f0e1d2c-3b4a-4958-a6b7-c8d9e0f1a2b3"}))
            .unwrap()
    };
    let resets = chrono::TimeZone::timestamp_opt(&chrono::Local, 1_794_520_800, 0)
        .unwrap()
        .format("%b %-d at %-I:%M %p")
        .to_string();
    let weekly = event(
        serde_json::json!({"status":"rejected","resetsAt":1_794_520_800,"rateLimitType":"seven_day","utilization":1.0}),
    );
    assert_eq!(
        weekly.message,
        format!("Claude's weekly usage limit is used up. It resets {resets}.")
    );
    assert!(!weekly.model_only);
    assert_eq!(
        event(serde_json::json!({"status":"rejected","rateLimitType":"five_hour"})).message,
        "Claude's five-hour usage limit is used up until it resets."
    );
    assert_eq!(
        event(
            serde_json::json!({"status":"rejected","rateLimitType":"seven_day_opus","resetsAt":0})
        )
        .message,
        "Claude's weekly Opus usage limit is used up until it resets."
    );
    assert_eq!(
        event(serde_json::json!({"status":"rejected"})).message,
        "Claude's usage limit is used up until it resets."
    );
}

#[test]
fn quota_detection_requires_provider_errors_not_task_text() {
    assert!(quota_failure(
        &serde_json::json!({"type":"rate_limit_event","rate_limit_info":{"status":"rejected"}})
    )
    .is_some());
    assert!(quota_failure(&serde_json::json!({"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning"}})).is_none());
    assert!(quota_failure(
        &serde_json::json!({"type":"error","error":{"data":{"message":"quota exceeded"}}})
    )
    .is_some());
    assert!(
        quota_failure(&serde_json::json!({"type":"assistant","message":"quota exceeded"}))
            .is_none()
    );
    assert!(quota_failure(&serde_json::json!({"type":"result","is_error":false,"result":"Test quota_exceeded handling"})).is_none());
    assert!(
        quota_failure(&serde_json::json!({"type":"error","message":"Permission denied"})).is_none()
    );
    assert!(quota_failure(
        &serde_json::json!({"type":"error","error":{"code":"insufficient_quota"}})
    )
    .is_some());
    assert!(quota_failure(
        &serde_json::json!({"type":"turn.failed","error":{"message":"usage limit reached"}})
    )
    .is_some());
    assert!(quota_failure(
        &serde_json::json!({"type":"result","is_error":true,"result":"You've hit your limit · resets 10pm","errors":null})
    )
    .is_some());
    assert!(quota_failure(
        &serde_json::json!({"type":"result","is_error":true,"result":"You have reached your limit"})
    )
    .is_some());
    assert!(quota_failure(
        &serde_json::json!({"type":"result","is_error":true,"result":"Claude was at limit"})
    )
    .is_some());
    assert!(quota_failure(
        &serde_json::json!({"type":"result","is_error":true,"result":"The limit was hit"})
    )
    .is_some());
    assert!(quota_failure(
        &serde_json::json!({"type":"result","is_error":true,"subtype":"error_limit_reached","result":""})
    )
    .is_some());
}

#[test]
fn routing_reserves_active_account_headroom_and_releases_finished_work() {
    let mut option = candidate("option", "codex", "small", Some(50.0));
    let mut run = super::super::tests::sample("codex");
    run.account_binding = Some(option.binding.clone());
    reserve_active_headroom(&mut option, &[run.clone(), run.clone()], "new-task");
    assert_eq!(option.remaining_percent, Some(30.0));
    run.status = RunStatus::Review;
    reserve_active_headroom(&mut option, &[run], "new-task");
    assert_eq!(option.remaining_percent, Some(30.0));
}

#[test]
#[ignore = "Uses the locally signed-in Codex account for one routing call and one disposable task"]
fn routing_installed_codex_selects_and_executes_in_disposable_repository() {
    let root =
        std::env::temp_dir().join(format!("jackalope-routing-native-{}", uuid::Uuid::new_v4()));
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    let path = repo.to_str().unwrap();
    git(path, &["init", "-b", "main"]).unwrap();
    std::fs::write(repo.join("README.md"), "Disposable routing trial").unwrap();
    git(path, &["add", "README.md"]).unwrap();
    git(
        path,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "Fixture",
        ],
    )
    .unwrap();
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
    let mut policy = AgentPolicy::default();
    policy.default_meta_agent = "codex".into();
    for id in crate::commands::agents::builtin_ids() {
        policy.enabled_agents.insert(id.into(), id == "codex");
    }
    let policy_path = runtime.policy_path();
    std::fs::create_dir_all(policy_path.parent().unwrap()).unwrap();
    std::fs::write(policy_path, serde_json::to_vec(&policy).unwrap()).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let request: RunRequest = serde_json::from_value(serde_json::json!({"id":id,"projectId":uuid::Uuid::new_v4().to_string(),"projectName":"Native routing trial","projectPath":path,"agent":"auto","prompt":"Create ROUTING_OK.txt containing exactly routing verified followed by a newline. Do not access the network, install dependencies or commit. Finish with a brief completion message.","isolated":true,"connectionIds":[]})).unwrap();
    runtime.start(request).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(180);
    let settled = loop {
        let run = runtime.inner.lock().unwrap().runs[&id].clone();
        if !run.status.is_active() {
            break run;
        }
        if std::time::Instant::now() >= deadline {
            runtime.stop(&id).unwrap();
            panic!("Native routing trial timed out: {}", root.display());
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    assert_eq!(
        settled.status,
        RunStatus::Review,
        "{:?} / {:?} at {}",
        settled.error,
        settled.activity,
        root.display()
    );
    assert_eq!(
        std::fs::read_to_string(Path::new(&settled.workspace).join("ROUTING_OK.txt"))
            .unwrap()
            .trim(),
        "routing verified"
    );
    let routing = settled.routing.unwrap();
    assert_eq!(routing.decisions.len(), 1);
    assert_eq!(routing.attempts.len(), 1);
    assert!(routing.attempts[0].usage.reported);
    assert!(settled.usage.reported);
    assert!(runtime.inner.lock().unwrap().processes.is_empty());
    println!("Native routing and worker trial passed: {}", root.display());
}

#[test]
fn routing_fallback_keeps_the_remaining_rank_for_admission_changes() {
    let candidates = vec![
        candidate("first", "codex", "small", Some(30.0)),
        candidate("second", "claude", "sonnet", Some(80.0)),
    ];
    let history = RoutingHistory {
        fallbacks: candidates
            .iter()
            .map(|candidate| RoutingAlternative {
                agent: candidate.agent.clone(),
                model: candidate.model.clone(),
                binding: candidate.binding.clone(),
            })
            .collect(),
        ..Default::default()
    };
    let (_, decision) = ranked_fallback(&history, &candidates).unwrap();
    let mut changed = candidates.clone();
    changed[0].remaining_percent = Some(0.0);
    assert_eq!(
        choose(&serde_json::to_string(&decision).unwrap(), &changed)
            .unwrap()
            .0
            .id,
        "second"
    );
}

#[test]
fn a_routing_agent_routes_on_a_fast_model_at_its_lowest_effort() {
    use super::process::{routing_effort, routing_model};
    assert_eq!(routing_model("claude", None).as_deref(), Some("sonnet"));
    assert_eq!(
        routing_model("claude", Some("claude-opus-5-5")).as_deref(),
        Some("sonnet")
    );
    assert_eq!(
        routing_model("claude", Some("claude-sonnet-5")).as_deref(),
        Some("claude-sonnet-5")
    );
    assert_eq!(
        routing_model("codex", Some("gpt-5")).as_deref(),
        Some("gpt-5")
    );
    assert_eq!(routing_model("codex", None), None);
    let args = |adapter: &str| {
        let mut command = Command::new("fixture");
        routing_effort(
            &mut command,
            adapter,
            routing_model(adapter, None).as_deref(),
        );
        command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
    };
    assert_eq!(args("claude"), ["--effort", "low"]);
    assert_eq!(args("codex"), ["-c", "model_reasoning_effort=\"low\""]);
    assert!(args("opencode").is_empty());
}

#[test]
fn a_routing_agent_that_does_not_answer_in_time_leaves_the_choice_to_local_rules() {
    let root =
        std::env::temp_dir().join(format!("jackalope-routing-budget-{}", uuid::Uuid::new_v4()));
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    let source = root.join("fixture.rs");
    std::fs::write(&source, r##"
use std::io::Read;
fn main() {
  let mut input=String::new(); std::io::stdin().read_to_string(&mut input).unwrap();
  if input.starts_with("You are Jackalope's routing coordinator.") {
    std::thread::sleep(std::time::Duration::from_secs(30));
    return;
  }
  println!(r#"{{"type":"result","is_error":false,"result":"Completed the fixture.","usage":{{"input_tokens":4,"output_tokens":5}}}}"#);
}
"##).unwrap();
    let executable = root.join(if cfg!(windows) {
        "fixture.exe"
    } else {
        "fixture"
    });
    let built = command("rustc")
        .arg(&source)
        .arg("-o")
        .arg(&executable)
        .output()
        .unwrap();
    assert!(
        built.status.success(),
        "{}",
        String::from_utf8_lossy(&built.stderr)
    );
    let repo = repo.to_str().unwrap();
    git(repo, &["init", "-b", "main"]).unwrap();
    std::fs::write(Path::new(repo).join("README.md"), "Routing fixture").unwrap();
    git(repo, &["add", "README.md"]).unwrap();
    git(
        repo,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "Fixture",
        ],
    )
    .unwrap();
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
    let mut policy = AgentPolicy::default();
    for id in crate::commands::agents::builtin_ids() {
        policy.enabled_agents.insert(id.into(), false);
    }
    policy.default_meta_agent = "fixture-a".into();
    for id in ["fixture-a", "fixture-b"] {
        policy
            .custom_agents
            .push(crate::commands::agent_policy::CustomAgent {
                id: id.into(),
                name: id.into(),
                command: executable.to_string_lossy().into_owned(),
                adapter: Some("claude".into()),
                args: Vec::new(),
            });
    }
    let policy_path = runtime.policy_path();
    std::fs::create_dir_all(policy_path.parent().unwrap()).unwrap();
    std::fs::write(policy_path, serde_json::to_vec(&policy).unwrap()).unwrap();
    crate::commands::tasks::claude_session::set_test_settings(
        "routing-budget-fixture",
        Default::default(),
    );
    let id = uuid::Uuid::new_v4().to_string();
    let request: RunRequest = serde_json::from_value(serde_json::json!({"id":id,"projectId":"routing-budget-fixture","projectName":"Routing budget","projectPath":repo,"agent":"auto","prompt":"Complete the fixture.","isolated":true,"connectionIds":[]})).unwrap();
    let started = std::time::Instant::now();
    runtime.start(request).unwrap();
    let deadline = started + Duration::from_secs(25);
    let settled = loop {
        let run = runtime.inner.lock().unwrap().runs[&id].clone();
        if !run.status.is_active() {
            break run;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the run never settled at {}",
            root.display()
        );
        std::thread::sleep(Duration::from_millis(50));
    };
    assert_eq!(
        settled.status,
        RunStatus::Review,
        "{:?} / {:?}",
        settled.error,
        settled.activity
    );
    let routing = settled.routing.as_ref().unwrap();
    let decision = routing.decisions.last().unwrap();
    assert_eq!(decision.orchestrator, "local rules");
    let reason = decision
        .assessment
        .as_ref()
        .and_then(|receipt| receipt.fallback_reason.clone())
        .unwrap_or_default();
    assert!(
        reason.contains(&format!(
            "did not answer within {} seconds",
            super::process::ROUTING_BUDGET.as_secs()
        )),
        "{reason}"
    );
    assert!(routing
        .attempts
        .iter()
        .any(|attempt| attempt.error.is_some()));
    let routed = settled
        .stages
        .iter()
        .find(|stage| stage.stage == "routing")
        .and_then(|stage| stage.duration_ms)
        .unwrap();
    assert!(routed < 12_000, "routing took {routed} ms");
    assert!(runtime.inner.lock().unwrap().processes.is_empty());
}

#[test]
fn computers_only_routing_offers_only_agents_that_run_on_computers() {
    let mut offered = 0;
    for agent in crate::commands::agents::all() {
        let id = agent.id.as_str();
        if routable(id, true) {
            offered += 1;
            assert!(routable(id, false), "{id}");
            assert!(crate::commands::agents::runs_on_computers(id), "{id}");
        }
    }
    assert!(offered > 0);
    assert!(!routable("unknown", false));
}
