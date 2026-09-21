use super::*;

#[test]
fn continuation_configuration_preserves_provider_and_permission_settings() {
    let mut command = Command::new("opencode");
    let original = json!({
        "model":"custom/worker",
        "permission":{"external_directory":"deny"},
        "experimental":{"batch_tool":true},
        "provider":{"custom":{"options":{"baseURL":"https://example.invalid"}}}
    });
    command.env("OPENCODE_CONFIG_CONTENT", original.to_string());
    let _connection = Connection::configure(&mut command).unwrap();
    let config: Value = serde_json::from_str(
        command
            .get_envs()
            .find(|(key, _)| *key == "OPENCODE_CONFIG_CONTENT")
            .unwrap()
            .1
            .unwrap()
            .to_str()
            .unwrap(),
    )
    .unwrap();
    for key in ["model", "permission", "provider"] {
        assert_eq!(config[key], original[key]);
    }
    assert_eq!(config["experimental"]["batch_tool"], true);
    assert_eq!(config["experimental"]["continue_loop_on_deny"], true);
    command.env("OPENCODE_CONFIG_CONTENT", r#"{"experimental":false}"#);
    assert!(Connection::configure(&mut command).is_err());
}

#[test]
fn sse_frames_preserve_fragmented_unicode_and_reject_oversized_events() {
    let mut frames = Frames::default();
    let source = "data: {\"type\":\"message\",\"text\":\"雪\"}\r\n\r\n: ping\n\ndata: {\"type\":\"idle\"}\n\n";
    let mut events = Vec::new();
    for chunk in source.as_bytes().chunks(3) {
        events.extend(frames.push(chunk).unwrap());
    }
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["text"], "雪");
    assert_eq!(events[1]["type"], "idle");
    assert!(Frames::default()
        .push(&vec![b'a'; MAX_RESPONSE + 1])
        .is_err());
    assert!(Frames::default().push(b"data: malformed\n\n").is_err());
    assert_eq!(Frames::default().push(source.as_bytes()).unwrap().len(), 2);
}

fn message(session: &str, id: &str) -> Value {
    json!({"id":id,"sessionID":session,"role":"assistant","time":{"completed":1},"finish":"stop","providerID":"fixture","modelID":"worker","tokens":{"input":10,"output":3,"reasoning":2,"cache":{"read":4,"write":1}},"cost":0.01})
}

#[test]
fn ignored_deltas_and_foreign_events_never_reach_the_history_writer() {
    let mut stream = Stream::new("root");
    for kind in ["message.part.delta", "server.heartbeat", "session.updated"] {
        assert!(!stream
            .relevant(&json!({"type":kind,"properties":{"sessionID":"root","delta":"token"}})));
    }
    let foreign = json!({"type":"message.updated","properties":{"info":message("foreign","msg")}});
    assert!(!stream.relevant(&foreign));
    let completed = json!({"type":"message.updated","properties":{"info":message("root","msg")}});
    assert!(stream.relevant(&completed));
    let tool = json!({"type":"message.part.updated","properties":{"part":{"id":"tool_id","messageID":"msg","sessionID":"root","type":"tool","state":{"status":"running"}}}});
    assert!(stream.relevant(&tool));
    stream.consume(&mut TaskRun::default(), &tool).unwrap();
    assert!(!stream.relevant(&tool));
    let mut done = tool.clone();
    done["properties"]["part"]["state"]["status"] = json!("completed");
    assert!(stream.relevant(&done));
}

#[test]
fn events_account_owned_children_once_and_never_replay_old_or_foreign_sessions() {
    let mut run = TaskRun {
        session_id: Some("root".into()),
        ..Default::default()
    };
    let mut stream = Stream::new("root");
    stream
        .exclude_history(&json!([{"info":message("root","old")}]), "root")
        .unwrap();
    for info in [
        message("root", "old"),
        message("foreign", "unrelated"),
        message("child", "too_early"),
    ] {
        stream
            .consume(
                &mut run,
                &json!({"type":"message.updated","properties":{"info":info}}),
            )
            .unwrap();
    }
    assert!(!run.usage.reported);
    assert!(!stream.consume(&mut run, &json!({"type":"session.status","properties":{"sessionID":"root","status":{"type":"idle"}}})).unwrap());
    stream.consume(&mut run, &json!({"type":"session.created","properties":{"info":{"id":"child","parentID":"root"}}})).unwrap();
    for _ in 0..2 {
        for info in [message("root", "new"), message("child", "child_msg")] {
            stream
                .consume(
                    &mut run,
                    &json!({"type":"message.updated","properties":{"info":info}}),
                )
                .unwrap();
        }
    }
    assert_eq!(run.session_id.as_deref(), Some("root"));
    assert_eq!(run.usage.input, 30);
    assert_eq!(run.usage.output, 10);
    assert_eq!(run.usage.cache_read, 8);
    assert_eq!(run.usage_observations.len(), 2);
    assert_eq!(
        run.usage_observations[1].session_id.as_deref(),
        Some("child")
    );
    assert!(stream.consume(&mut run, &json!({"type":"session.status","properties":{"sessionID":"root","status":{"type":"idle"}}})).unwrap());
    let old = json!({"info":message("root","old"),"parts":[{"type":"text","text":"old answer"}]});
    assert!(stream.finish(&json!([old.clone()])).is_err());
    let mut new =
        json!({"info":message("root","new"),"parts":[{"type":"text","text":"new answer"}]});
    assert_eq!(
        stream.finish(&json!([old, new.clone()])).unwrap(),
        "new answer"
    );
    new["info"]["finish"] = json!("tool-calls");
    assert!(stream.finish(&json!([new.clone()])).is_err());
    new["info"]["finish"] = json!("length");
    assert!(stream.finish(&json!([new.clone()])).is_err());
    new["info"]["finish"] = json!("stop");
    new["info"]["error"] = json!({"name":"MessageAbortedError"});
    assert!(stream.finish(&json!([new])).is_err());
}

#[test]
fn effort_uses_only_advertised_enabled_variants_and_preserves_unknown_models() {
    let catalog = json!({"providers":[{"id":"deepseek","models":{"v4":{"variants":{"low":{},"high":{},"medium":{}}}}},{"id":"custom","models":{"reasoner":{"variants":{"low":{"disabled":true},"high":{}}}}}]});
    assert_eq!(
        select_variant(&catalog, "deepseek", "v4", effort::TaskEffort::Quick),
        Some("low")
    );
    assert_eq!(
        select_variant(&catalog, "deepseek", "v4", effort::TaskEffort::Balanced),
        Some("high")
    );
    assert_eq!(
        select_variant(&catalog, "custom", "reasoner", effort::TaskEffort::Quick),
        None
    );
    assert_eq!(
        select_variant(&catalog, "custom", "reasoner", effort::TaskEffort::Balanced),
        None
    );
    assert_eq!(
        select_variant(&catalog, "custom", "reasoner", effort::TaskEffort::Thorough),
        Some("high")
    );
    assert_eq!(
        select_variant(&catalog, "deepseek", "missing", effort::TaskEffort::Quick),
        None
    );
    assert!(valid_id("../../other").is_err());
}

#[test]
fn owned_server_permissions_resume_denial_and_stop_preserve_session_and_history() {
    use crate::commands::agent_policy::{AgentPolicy, CustomAgent};
    let folder = std::env::temp_dir().join(format!("jackalope-opencode-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&folder).unwrap();
    let root = folder.to_str().unwrap();
    git(root, &["init", "-b", "master"]).unwrap();
    git(
        root,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "Fixture",
        ],
    )
    .unwrap();
    #[cfg(windows)]
    let executable = {
        let path = folder.join("fixture.cmd");
        std::fs::write(&path, "@echo off\r\nnode \"%~dp0fixture.cjs\" %*\r\n").unwrap();
        path
    };
    #[cfg(unix)]
    let executable = {
        use std::os::unix::fs::PermissionsExt;
        let path = folder.join("fixture");
        std::fs::write(
            &path,
            "#!/bin/sh\nexec node \"$(dirname \"$0\")/fixture.cjs\" \"$@\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        path
    };
    std::fs::write(folder.join("fixture.cjs"), include_str!("fixture.cjs")).unwrap();
    std::fs::write(folder.join("stall-first-health"), "").unwrap();
    let runtime = TaskRuntime::with_test_access(folder.join("history")).unwrap();
    let mut policy = AgentPolicy::default();
    policy.custom_agents.push(CustomAgent {
        id: "opencode-fixture".into(),
        name: "OpenCode fixture".into(),
        command: executable.to_string_lossy().into(),
        adapter: Some("opencode".into()),
    });
    std::fs::create_dir_all(runtime.policy_path().parent().unwrap()).unwrap();
    std::fs::write(runtime.policy_path(), serde_json::to_vec(&policy).unwrap()).unwrap();
    let mut request:RunRequest=serde_json::from_value(json!({"id":"opencode-fixture-first","projectId":"fixture","projectName":"Fixture","projectPath":root,"agent":"opencode-fixture","isolated":false,"prompt":"Fixture task","autoVerify":false,"model":"fixture/worker","effort":"quick"})).unwrap();
    for attempt in 0..8 {
        request.prompt = match attempt {
            2 => "Continue fixture",
            5 => "Question fixture",
            6 => "Repeat fixture",
            7 => "Limit fixture",
            _ => "Fixture task",
        }
        .into();
        runtime.start(request.clone()).unwrap();
        let deadline =
            std::time::Instant::now() + Duration::from_secs(if attempt == 0 { 10 } else { 20 });
        let completed = loop {
            let run = runtime
                .integration_runs()
                .unwrap()
                .into_iter()
                .find(|r| r.id == request.id)
                .unwrap();
            if !["starting", "running", "stopping"].contains(&run.status.as_str()) {
                break run;
            }
            for prompt in run.prompts.iter().filter(|p| p.status == "pending") {
                if attempt == 4 {
                    runtime.stop(&run.id).unwrap();
                } else {
                    runtime
                        .respond_prompt(
                            &run.id,
                            &prompt.id,
                            match attempt {
                                2 | 6 | 7 => "Deny",
                                3 => "yes",
                                _ if prompt.input_type == "multiChoice" => {
                                    assert!(prompt.question.contains("First detail"));
                                    "[\"One\",\"Two\"]"
                                }
                                _ => "Allow once",
                            },
                        )
                        .unwrap();
                }
            }
            if std::time::Instant::now() > deadline {
                runtime.stop_all();
                panic!("OpenCode fixture timed out: {:?}", run.error);
            }
            std::thread::sleep(Duration::from_millis(25));
        };
        assert_eq!(
            completed.status,
            match attempt {
                0 | 1 | 2 | 5 => "review",
                4 => "stopped",
                _ => "failed",
            },
            "{:?}",
            completed.error
        );
        assert_eq!(completed.session_id.as_deref(), Some("ses_fixture"));
        if attempt == 0 {
            assert_eq!(
                std::fs::read_to_string(folder.join("health-probes.txt")).unwrap(),
                "xx"
            );
        }
        if matches!(attempt, 0 | 1 | 2 | 5) {
            assert_eq!(completed.result, "Fixture complete");
            assert_eq!(completed.usage.input, 15);
            assert_eq!(completed.reasoning_effort.as_deref(), Some("low"));
        }
        if attempt == 6 {
            assert_eq!(completed.prompts.len(), 1);
            assert!(completed
                .error
                .as_deref()
                .unwrap()
                .contains("previously denied"));
        }
        if attempt == 7 {
            assert_eq!(completed.prompts.len(), 8);
            assert!(completed
                .error
                .as_deref()
                .unwrap()
                .contains("limit of denied actions"));
        }
        assert!(runtime.inner.lock().unwrap().processes.is_empty());
        request.previous_run_id = Some(request.id.clone());
        request.id = format!("opencode-fixture-next-{attempt}");
    }
    assert_eq!(
        std::fs::read_to_string(folder.join("authorized.txt")).unwrap(),
        "xxx"
    );
    assert_eq!(
        std::fs::read_to_string(folder.join("independent.txt")).unwrap(),
        "x"
    );
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while Arc::strong_count(&runtime._owner) > 1 {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    drop(runtime);
    let runtime = TaskRuntime::new(folder.join("history")).unwrap();
    assert_eq!(runtime.integration_runs().unwrap().len(), 8);
    drop(runtime);
    std::fs::remove_dir_all(folder).unwrap();
}
