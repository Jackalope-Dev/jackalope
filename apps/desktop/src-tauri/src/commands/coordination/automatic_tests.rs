use super::automatic::*;
use super::*;
use serde_json::{json, Value};

struct Fixture {
    root: PathBuf,
    runtime: TaskRuntime,
    service: Coordinator,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("jackalope-automatic-{}", Uuid::new_v4()));
        let history = root.join("history");
        std::fs::create_dir_all(&history).unwrap();
        for (id, project) in [
            ("reader-run", "p"),
            ("writer-run", "p"),
            ("foreign-run", "other"),
        ] {
            let value = json!({"id":id,"taskId":format!("{id}-task"),"projectId":project,"projectName":"Fixture","projectPath":"","workspace":"","branch":"","baseHead":"","agent":"codex","account":"fixture","model":null,"prompt":format!("{id} work"),"status":"review","startedAt":"2026-09-08T00:00:00Z","endedAt":null,"sessionId":null,"result":"","activity":[],"error":null,"persistenceError":null,"exitCode":null,"usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"reported":false,"estimatedCostUsd":null}});
            std::fs::write(history.join(format!("{id}.json")), value.to_string()).unwrap();
        }
        let runtime = TaskRuntime::with_test_access(history).unwrap();
        let service = Coordinator::new(root.join("coordination"), runtime.clone()).unwrap();
        Self {
            root,
            runtime,
            service,
        }
    }

    fn running(&self, id: &str) {
        self.runtime.update(id, |run| run.status = "running".into());
        let mut inner = self.service.inner.lock().unwrap();
        inner.grants.insert(id.into(), (id.into(), id.into()));
        inner.ledger.lifecycle.as_mut().unwrap().remove(id);
        self.service.register_launch(&mut inner, id).unwrap();
        self.service.reconcile_locked(&mut inner).unwrap();
    }

    async fn message(&self, text: &str, recipient: Option<&str>) -> CoordinationMessage {
        bridge_message(
            WebState(self.service.clone()),
            headers("writer-run"),
            Json(MessageRequest {
                report: None,
                resolves: None,
                kind: "blocker".into(),
                text: text.into(),
                recipient_task_id: recipient.map(str::to_string),
            }),
        )
        .await
        .unwrap()
        .0
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.service.shutdown();
    }
}

fn headers(id: &str) -> HeaderMap {
    let mut value = HeaderMap::new();
    value.insert("authorization", format!("Bearer {id}").parse().unwrap());
    value
}

#[tokio::test]
async fn help_and_verification_output_require_the_current_attempt_credential() {
    let f = Fixture::new();
    f.running("reader-run");
    f.running("writer-run");
    f.runtime.update("reader-run", |run| {
        run.verification = Some(
            serde_json::from_value(json!({
                "command":"fixture","checkedAt":"check-1","tree":null,
                "result":{"exitCode":0,"success":true,"timedOut":false,"truncated":false,
                    "durationMs":1,"stdout":"reader output","stderr":""}
            }))
            .unwrap(),
        );
    });
    let state = || WebState(f.service.clone());
    let input = || {
        Json(super::super::verification::output::OutputRequest {
            check_id: "check-1".into(),
            stream: "stdout".into(),
            offset: 0,
            limit: None,
        })
    };
    assert!(bridge_help(state(), headers("reader-run")).await.is_ok());
    assert!(bridge_help(state(), headers("invalid")).await.is_err());
    assert_eq!(
        bridge_verification_output(state(), headers("reader-run"), input())
            .await
            .unwrap()
            .0["text"],
        "reader output"
    );
    assert!(
        bridge_verification_output(state(), headers("writer-run"), input())
            .await
            .is_err()
    );
    let mut browser = headers("reader-run");
    browser.insert("origin", "https://example.invalid".parse().unwrap());
    assert!(bridge_help(state(), browser).await.is_err());
    f.runtime
        .update("reader-run", |run| run.status = "review".into());
    assert!(
        bridge_verification_output(state(), headers("reader-run"), input())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn agent_verification_cannot_add_or_replace_a_saved_command() {
    let f = Fixture::new();
    f.running("reader-run");
    let input = || super::super::harness::ComputerVerifyInput {
        command: "node".into(),
        args: vec!["--test".into(), "unexpected-argument".into()],
    };
    let run = || f.service.authorized_run(&headers("reader-run")).unwrap();
    assert!(
        super::super::verification::agent_verify(f.runtime.clone(), run(), input())
            .await
            .unwrap_err()
            .contains("No project verification")
    );
    f.runtime.update("reader-run", |run| {
        run.verify_command = Some("node --test".into())
    });
    assert!(
        super::super::verification::agent_verify(f.runtime.clone(), run(), input())
            .await
            .unwrap_err()
            .contains("saved project verification command")
    );
}

fn request(previous: Option<&str>) -> RunRequest {
    serde_json::from_value(json!({"id":"next","projectId":"p","projectName":"Fixture","projectPath":"","agent":"codex","isolated":false,"prompt":"Next work","previousRunId":previous})).unwrap()
}

#[test]
fn lifecycle_baselines_history_and_persists_one_start_and_outcome() {
    let fixture = Fixture::new();
    assert!(fixture.service.view().unwrap().messages.is_empty());
    fixture.running("writer-run");
    fixture.service.reconcile().unwrap();
    let messages = fixture.service.view().unwrap().messages;
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].task_id, "writer-run-task");
    assert!(messages[0].text.contains("unknown scope"));
    fixture
        .runtime
        .update("writer-run", |run| run.status = "review".into());
    fixture.service.reconcile().unwrap();
    fixture.service.reconcile().unwrap();
    let saved: Ledger = serde_json::from_slice(
        &std::fs::read(fixture.root.join("coordination/queue.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(saved.messages.len(), 2);
    assert_eq!(saved.messages[1].kind, "handoff");
    assert!(saved.messages[1].text.contains("not integrated"));
    assert!(saved.messages.iter().all(|m| m.acknowledged_by.is_empty()));
    fixture
        .runtime
        .update("writer-run", |run| run.status = "reviewed".into());
    fixture.service.reconcile().unwrap();
    assert_eq!(fixture.service.view().unwrap().messages.len(), 2);
}

#[test]
fn queue_snapshot_prioritizes_active_work_and_bounds_large_scopes() {
    let fixture = Fixture::new();
    fixture.running("writer-run");
    let mut inner = fixture.service.inner.lock().unwrap();
    for index in 0..100 {
        let item: QueueItem = serde_json::from_value(json!({"id":format!("queued-{index}"),"projectId":"p","projectName":"Fixture","projectPath":"","title":format!("Queued work {index}"),"prompt":"Work","agent":"codex","scopes":vec!["x".repeat(500); 30],"dependencies":[],"createdAt":"now","runId":null,"error":null,"canceled":false})).unwrap();
        inner.ledger.items.push(item);
    }
    let mut assigned = inner.ledger.items[0].clone();
    assigned.id = "queued-reader".into();
    assigned.run_id = Some("reader-run".into());
    assigned.dependencies = vec!["queued-1".into()];
    inner.ledger.items.push(assigned.clone());
    let text = fixture
        .service
        .startup(&mut inner, &request(Some("reader-run")), Some(&assigned))
        .unwrap();
    let snapshot: Value = serde_json::from_str(text.lines().nth(2).unwrap()).unwrap();
    assert_eq!(snapshot["assignedTaskId"], "queued-reader");
    assert_eq!(snapshot["tasks"][0]["id"], "writer-run-task");
    assert!(snapshot["omittedTasks"].as_u64().unwrap() > 0);
    assert!(snapshot["tasks"].to_string().len() <= 10_100);
    assert!(snapshot["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .all(|t| t["id"] != "queued-reader"));
}

#[test]
fn failed_lifecycle_save_does_not_consume_event_and_retry_is_idempotent() {
    let fixture = Fixture::new();
    fixture.running("writer-run");
    let path = fixture.root.join("coordination/queue.json");
    let backup = fixture.root.join("coordination/queue.saved");
    std::fs::rename(&path, &backup).unwrap();
    std::fs::create_dir(&path).unwrap();
    fixture
        .runtime
        .update("writer-run", |run| run.status = "stopped".into());
    assert!(fixture.service.reconcile().is_err());
    assert_eq!(fixture.service.view().unwrap().messages.len(), 1);
    std::fs::remove_dir(&path).unwrap();
    std::fs::rename(backup, path).unwrap();
    fixture.service.reconcile().unwrap();
    fixture.service.reconcile().unwrap();
    assert_eq!(fixture.service.view().unwrap().messages.len(), 2);
    assert!(fixture.service.view().unwrap().messages[1]
        .text
        .contains("Stopped"));
}

#[test]
fn rejected_launch_does_not_announce_work_or_leave_a_reservation() {
    let fixture = Fixture::new();
    fixture.service.inner.lock().unwrap().url = Some("http://127.0.0.1:1".into());
    let mut input = request(None);
    input.id = Uuid::new_v4().to_string();
    input.prompt.clear();
    let id = input.id.clone();
    assert!(fixture.service.start_manual(input).is_err());
    let inner = fixture.service.inner.lock().unwrap();
    assert!(inner.ledger.messages.is_empty());
    assert!(!inner.ledger.lifecycle.as_ref().unwrap().contains_key(&id));
    assert!(!inner.delivered.contains_key(&id));
    assert!(inner.grants.is_empty());
}

#[tokio::test]
async fn checkpoints_skip_historical_broadcasts_but_keep_unread_direct_messages() {
    let fixture = Fixture::new();
    fixture.running("reader-run");
    fixture.running("writer-run");
    fixture.service.checkpoint(&headers("reader-run")).unwrap();
    fixture.message("historical broadcast", None).await;
    let direct = fixture
        .message("historical direct", Some("reader-run-task"))
        .await;
    {
        let mut inner = fixture.service.inner.lock().unwrap();
        for message in inner
            .ledger
            .messages
            .iter_mut()
            .filter(|m| m.text.starts_with("historical"))
        {
            message.created_at = "2020-01-01T00:00:00Z".into();
        }
    }
    let update = fixture
        .service
        .checkpoint(&headers("reader-run"))
        .unwrap()
        .unwrap();
    assert_eq!(update["messages"].as_array().unwrap().len(), 1);
    assert_eq!(update["messages"][0]["id"], direct.id);
}

#[tokio::test]
async fn duplicate_launch_snapshot_does_not_consume_updates_for_the_running_attempt() {
    let fixture = Fixture::new();
    fixture.running("reader-run");
    fixture.running("writer-run");
    fixture.service.checkpoint(&headers("reader-run")).unwrap();
    let message = fixture
        .message(
            "not delivered by a duplicate launch",
            Some("reader-run-task"),
        )
        .await;
    let mut input = request(None);
    input.id = "reader-run".into();
    {
        let mut inner = fixture.service.inner.lock().unwrap();
        fixture.service.startup(&mut inner, &input, None).unwrap();
    }
    let update = fixture
        .service
        .checkpoint(&headers("reader-run"))
        .unwrap()
        .unwrap();
    assert_eq!(update["messages"][0]["id"], message.id);
}

#[tokio::test]
async fn busy_coordinator_defers_updates_without_blocking_or_consuming_them() {
    let fixture = Fixture::new();
    fixture.running("reader-run");
    fixture.running("writer-run");
    fixture.service.checkpoint(&headers("reader-run")).unwrap();
    let message = fixture
        .message("deliver after launch", Some("reader-run-task"))
        .await;
    {
        let _launch_guard = fixture.service.inner.lock().unwrap();
        assert!(fixture
            .service
            .checkpoint(&headers("reader-run"))
            .unwrap()
            .is_none());
    }
    let update = fixture
        .service
        .checkpoint(&headers("reader-run"))
        .unwrap()
        .unwrap();
    assert_eq!(update["messages"][0]["id"], message.id);
}

#[test]
fn quick_failure_emits_start_and_failure_and_restart_emits_recovery_once() {
    let fixture = Fixture::new();
    {
        let mut inner = fixture.service.inner.lock().unwrap();
        inner
            .ledger
            .lifecycle
            .as_mut()
            .unwrap()
            .remove("writer-run");
        fixture
            .service
            .register_launch(&mut inner, "writer-run")
            .unwrap();
    }
    fixture
        .runtime
        .update("writer-run", |run| run.status = "failed".into());
    fixture.service.reconcile().unwrap();
    let messages = fixture.service.view().unwrap().messages;
    assert_eq!(messages.len(), 2);
    assert!(messages[0].id.ends_with(":active"));
    assert!(messages[1].id.ends_with(":failed"));
    fixture.running("reader-run");
    let root = fixture.root.clone();
    drop(fixture);
    let runtime = TaskRuntime::with_test_access(root.join("history")).unwrap();
    let service = Coordinator::new(root.join("coordination"), runtime).unwrap();
    service.reconcile().unwrap();
    let messages = service.view().unwrap().messages;
    assert_eq!(
        messages
            .iter()
            .filter(|m| m.id == "lifecycle:reader-run:interrupted")
            .count(),
        1
    );
    assert_eq!(
        messages
            .iter()
            .filter(|m| m.id == "lifecycle:writer-run:failed")
            .count(),
        1
    );
}

#[tokio::test]
async fn startup_uses_stable_continuation_identity_and_filters_private_messages() {
    let fixture = Fixture::new();
    fixture.running("writer-run");
    fixture.running("reader-run");
    fixture
        .message("direct-reader-context", Some("reader-run-task"))
        .await;
    fixture
        .message("private-to-writer", Some("writer-run-task"))
        .await;
    let mut inner = fixture.service.inner.lock().unwrap();
    let text = fixture
        .service
        .startup(&mut inner, &request(Some("reader-run")), None)
        .unwrap();
    assert!(text.contains("\"assignedTaskId\":\"reader-run-task\""));
    assert!(text.contains("writer-run work"));
    assert!(text.contains("direct-reader-context"));
    assert!(!text.contains("foreign-run work"));
    assert!(!text.contains("private-to-writer"));
    assert!(text.contains("\"scopeKnown\":false"));
    assert!(!text.contains("reader-run work"));
    assert!(text.contains("untrusted observations"));
}

#[tokio::test]
async fn checkpoint_deduplicates_delivery_without_acknowledging_and_respects_scope() {
    let fixture = Fixture::new();
    fixture.running("reader-run");
    fixture.running("writer-run");
    fixture.running("foreign-run");
    fixture.service.checkpoint(&headers("reader-run")).unwrap();
    let message = fixture
        .message("new-direct-update", Some("reader-run-task"))
        .await;
    let update = fixture
        .service
        .checkpoint(&headers("reader-run"))
        .unwrap()
        .unwrap();
    assert_eq!(update["messages"][0]["id"], message.id);
    assert!(fixture
        .service
        .checkpoint(&headers("reader-run"))
        .unwrap()
        .is_none());
    assert!(fixture
        .service
        .checkpoint(&headers("foreign-run"))
        .unwrap()
        .is_none());
    assert!(fixture
        .service
        .view()
        .unwrap()
        .messages
        .iter()
        .all(|m| m.acknowledged_by.is_empty()));
    let inbox = inbox::bridge_inbox(
        WebState(fixture.service.clone()),
        headers("reader-run"),
        axum::extract::Query(inbox::InboxQuery::default()),
    )
    .await
    .unwrap()
    .0;
    assert!(inbox["messages"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["id"] == message.id));
    let mut origin = headers("reader-run");
    origin.insert("origin", "https://example.invalid".parse().unwrap());
    assert!(fixture.service.checkpoint(&origin).is_err());
    fixture
        .runtime
        .update("reader-run", |run| run.status = "review".into());
    assert!(fixture.service.checkpoint(&headers("reader-run")).is_err());
}

#[tokio::test]
async fn bounded_updates_prioritize_direct_messages_and_page_without_repetition() {
    let fixture = Fixture::new();
    fixture.running("reader-run");
    fixture.running("writer-run");
    fixture.service.checkpoint(&headers("reader-run")).unwrap();
    for _ in 0..20 {
        fixture.message(&"界".repeat(1000), None).await;
    }
    let direct = fixture
        .message("direct first", Some("reader-run-task"))
        .await;
    let first = fixture
        .service
        .checkpoint(&headers("reader-run"))
        .unwrap()
        .unwrap();
    assert_eq!(first["messages"][0]["id"], direct.id);
    assert_eq!(first["moreMessages"], true);
    assert!(first.to_string().len() < 6500);
    let mut ids = HashSet::new();
    let mut page = Some(first);
    while let Some(value) = page {
        for message in value["messages"].as_array().unwrap() {
            assert!(ids.insert(message["id"].as_str().unwrap().to_string()));
        }
        page = fixture.service.checkpoint(&headers("reader-run")).unwrap();
    }
    assert_eq!(ids.len(), 21);
}

#[tokio::test]
async fn http_and_native_mcp_responses_deliver_updates_and_preserve_tool_results() {
    let fixture = Fixture::new();
    fixture.running("reader-run");
    fixture.running("writer-run");
    fixture.service.checkpoint(&headers("reader-run")).unwrap();
    let router = Router::new()
        .route("/v1/validation-step", post(bridge_validation_step))
        .with_state(fixture.service.clone())
        .merge(crate::commands::coordination_mcp::router(
            fixture.service.clone(),
        ))
        .layer(axum::middleware::from_fn_with_state(
            fixture.service.clone(),
            deliver,
        ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let client = reqwest::Client::new();
    let message = fixture
        .message("http-delivery", Some("reader-run-task"))
        .await;
    let response: Value = client
        .post(format!("{endpoint}/v1/validation-step"))
        .bearer_auth("reader-run")
        .json(&json!({"step":"HTTP checkpoint","status":"passed","notes":"fixture"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(response["step"], "HTTP checkpoint");
    assert_eq!(
        response["coordinationUpdates"]["messages"][0]["id"],
        message.id
    );
    let message = fixture
        .message("mcp-delivery", Some("reader-run-task"))
        .await;
    let list: Value = client
        .post(format!("{endpoint}/mcp"))
        .bearer_auth("reader-run")
        .header("accept", "application/json, text/event-stream")
        .json(&json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(list["result"]["tools"].is_array());
    for attempt in 0..2 {
        let response: Value = client.post(format!("{endpoint}/mcp")).bearer_auth("reader-run")
            .header("accept", "application/json, text/event-stream")
            .json(&json!({"jsonrpc":"2.0","id":attempt+2,"method":"tools/call","params":{"name":"record_validation_step","arguments":{"step":"MCP checkpoint","status":"passed","notes":"fixture"}}})).send().await.unwrap().json().await.unwrap();
        assert_eq!(
            response["result"]["structuredContent"]["step"],
            "MCP checkpoint"
        );
        let text = response["result"]["content"].to_string();
        assert_eq!(text.contains(&message.id), attempt == 0, "{response}");
    }
    server.abort();
}
