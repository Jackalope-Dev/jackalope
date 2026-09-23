use super::*;

fn helper() -> Helper {
    let directory =
        std::env::temp_dir().join(format!("jackalope-helper-test-{}", uuid::Uuid::new_v4()));
    let runtime = TaskRuntime::with_test_access(directory.clone()).unwrap();
    Helper::new(directory, runtime)
}

#[test]
fn tools_require_fresh_shared_context_and_only_propose_valid_changes() {
    let helper = helper();
    assert!(
        helper
            .call("search_docs", json!({"query":"appearance"}), "test")
            .unwrap()["results"]
            .as_array()
            .unwrap()
            .len()
            > 0
    );
    assert!(helper.call("get_preferences", json!({}), "test").is_err());
    {
        let mut inner = helper.inner.lock().unwrap();
        inner.context_at = Some(Instant::now());
        inner.context = json!({"app":{"version":"0.1.0"},"preferences":{"notifications":"all"},"projects":[{"id":"project-a","name":"Test"}],"activeProjectId":"project-a"});
    }
    for (name, arguments) in [
        ("set_preferences", json!({"telemetryEnabled":true})),
        ("set_preferences", json!({"notifications":"loud"})),
        (
            "set_theme",
            json!({"scope":"app","accent":"javascript:bad"}),
        ),
        ("set_theme", json!({"scope":"app","atmosphere":65})),
        (
            "prepare_task",
            json!({"project_id":"unshared","prompt":"Do work"}),
        ),
        ("navigate", json!({"destination":"https://example.com"})),
        ("execute_shell", json!({})),
    ] {
        assert!(helper.call(name, arguments, "test").is_err(), "{name}");
    }
    let result = helper
        .call("set_preferences", json!({"notifications":"none"}), "test")
        .unwrap();
    assert_eq!(result["status"], "proposed");
    assert_eq!(
        helper.inner.lock().unwrap().context["preferences"]["notifications"],
        "all"
    );
    assert_eq!(
        helper
            .call("get_action", json!({"id":result["id"]}), "test")
            .unwrap()["status"],
        "proposed"
    );
    helper.inner.lock().unwrap().context_at = Some(Instant::now() - Duration::from_secs(16));
    assert!(helper.call("get_app_context", json!({}), "test").is_err());
}

#[test]
fn history_restart_preserves_conversation_and_expires_unapplied_actions() {
    let helper = helper();
    {
        let mut inner = helper.inner.lock().unwrap();
        inner.view.turns.push(Turn {
            prompt: "Question".into(),
            status: "working".into(),
            ..Default::default()
        });
        inner.view.actions.push(Action {
            id: "proposal".into(),
            operation: "navigate".into(),
            arguments: json!({"destination":"settings"}),
            source: "test".into(),
            status: "proposed".into(),
            created_at: 0,
            result: None,
        });
        inner.connection = Some((
            "secret-connection-token".into(),
            Instant::now() + Duration::from_secs(60),
        ));
        helper.save(&mut inner).unwrap();
    }
    let text = std::fs::read_to_string(&helper.path).unwrap();
    assert!(!text.contains("secret-connection-token"));
    let root = helper
        .path
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();
    let loaded = Helper::new(root, helper.runtime.clone());
    let view = loaded.snapshot();
    assert_eq!(view.turns[0].status, "interrupted");
    assert_eq!(view.actions[0].status, "expired");
    assert!(!view.connected);
    assert!(helper.runtime.integration_runs().unwrap().is_empty());
}

#[tokio::test]
async fn mcp_requires_connection_token_and_rejects_browser_origins_and_revocation() {
    let helper = helper();
    helper.launch();
    let mut url = None;
    for _ in 0..100 {
        url = helper.inner.lock().unwrap().url.clone();
        if url.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let url = format!("{}/mcp", url.unwrap());
    let client = reqwest::Client::new();
    let body = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"helper-test","version":"1"}}});
    let send = |token: &str| {
        client
            .post(&url)
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/json, text/event-stream")
            .json(&body)
    };
    assert_eq!(send("invalid").send().await.unwrap().status().as_u16(), 401);
    helper.inner.lock().unwrap().connection = Some((
        "test-token".into(),
        Instant::now() + Duration::from_secs(60),
    ));
    assert_eq!(
        send("test-token")
            .header("Origin", "https://example.invalid")
            .send()
            .await
            .unwrap()
            .status()
            .as_u16(),
        401
    );
    assert_eq!(
        send("test-token")
            .header("Host", "attacker.invalid")
            .send()
            .await
            .unwrap()
            .status()
            .as_u16(),
        401
    );
    let response = send("test-token").send().await.unwrap();
    assert!(response.status().is_success(), "{}", response.status());
    let result: Value = response.json().await.unwrap();
    assert!(result["result"]["capabilities"]["tools"].is_object());
    let list = client
        .post(&url)
        .header("Authorization", "Bearer test-token")
        .header("Accept", "application/json, text/event-stream")
        .json(&json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
        .send()
        .await
        .unwrap();
    assert!(list.status().is_success());
    let list: Value = list.json().await.unwrap();
    assert!(list["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["name"] == "get_action"));
    helper.inner.lock().unwrap().connection = None;
    assert_eq!(
        send("test-token").send().await.unwrap().status().as_u16(),
        401
    );
}

#[test]
#[ignore = "Uses an installed signed-in agent and its quota; set JACKALOPE_HELPER_TRIAL_AGENT"]
fn installed_helper_agent_answers_with_document_tools() {
    let agent = std::env::var("JACKALOPE_HELPER_TRIAL_AGENT").expect("Set the intended agent");
    let helper = helper();
    let binding =
        agent_profiles::bind_account(&helper.runtime.profiles_root(), &agent, None).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    {
        let mut inner = helper.inner.lock().unwrap();
        inner.view.turns.push(Turn { id:id.clone(), prompt:"Search the official docs for Ask Jackalope, read that guide, and explain in one sentence whether a proposed action has already changed settings. Include the source URL. Do not propose any changes.".into(), agent, account:binding.label.clone(), status:"working".into(), ..Default::default() });
    }
    let result = helper
        .answer(&id, binding, Arc::new(AtomicBool::new(false)))
        .unwrap();
    assert!(
        result.contains("https://jackalope.dev/knowledge/ask-jackalope/"),
        "Missing citation: {result}"
    );
    let inner = helper.inner.lock().unwrap();
    assert!(inner.view.turns[0].steps.iter().any(|s| s == "search_docs"));
    assert!(inner.view.turns[0].steps.iter().any(|s| s == "read_doc"));
    assert!(inner.view.actions.is_empty());
    println!(
        "Installed helper trial passed with {} documentation calls; citation returned.",
        inner.view.turns[0].steps.len()
    );
}

#[test]
fn response_protocol_rejects_ambiguous_or_extra_operations() {
    assert!(parse_response(r#"{"answer":"Ready"}"#).is_ok());
    assert!(
        parse_response("```json\n{\"tool\":\"get_preferences\",\"arguments\":{}}\n```").is_ok()
    );
    for text in [
        r#"{"answer":"Done","tool":"set_theme","arguments":{}}"#,
        r#"{"tool":"navigate","arguments":"settings"}"#,
        "Run this command",
        "[]",
    ] {
        assert!(parse_response(text).is_err(), "{text}");
    }
}

#[test]
fn documentation_and_capability_catalog_are_bounded_and_valid() {
    let docs: Vec<Value> = serde_json::from_str(include_str!(
        "../../../../../../packages/knowledge/catalog.json"
    ))
    .unwrap();
    assert!(!docs.is_empty());
    for doc in docs {
        assert!(doc["url"]
            .as_str()
            .unwrap()
            .starts_with("https://jackalope.dev/knowledge/"));
    }
    let catalog = tools::catalog();
    let names: Vec<_> = catalog
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"set_theme"));
    assert!(names.contains(&"prepare_task"));
    assert!(!names.contains(&"execute_shell"));
}
