use super::*;
use crate::commands::{agent_profiles, capacity::client::Client};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "Connects installed Claude to a disposable native MCP bridge without model inference"]
async fn installed_claude_connects_without_inference() {
    let fixture = Fixture::new();
    fixture.running("reader-run");
    fixture
        .runtime
        .update("reader-run", |run| run.agent = "claude".into());
    let router = crate::commands::coordination_mcp::router(fixture.service.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/mcp", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let config = json!({"mcpServers":{"jackalope":{"type":"http","url":endpoint,
        "headers":{"Authorization":"Bearer reader-run"}}}})
    .to_string();
    let binding =
        agent_profiles::bind_account(&fixture.runtime.profiles_root(), "claude", None).unwrap();
    let debug = fixture.root.join("claude-debug.log");
    println!("Claude protocol fixture: {}", fixture.root.display());
    let mut client = Client::spawn_bound(
        &binding,
        &[
            "--print",
            "--verbose",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--no-session-persistence",
            "--strict-mcp-config",
            "--mcp-config",
            &config,
            "--debug-file",
            debug.to_str().unwrap(),
        ],
    )
    .unwrap();
    let result = tokio::time::timeout(Duration::from_secs(30), async {
        client.request(json!({"type":"control_request","request_id":"init",
            "request":{"subtype":"initialize","hooks":{}}})).await?;
        for attempt in 0..20 {
            let value = client.request(json!({"type":"control_request","request_id":format!("status-{attempt}"),
                "request":{"subtype":"mcp_status"}})).await?;
            let bridge = value["mcpServers"].as_array().and_then(|servers| servers.iter().find(|s| s["name"] == "jackalope"))
                .ok_or("Claude did not load the Jackalope bridge")?;
            if bridge["status"] != "pending" && bridge["status"] != "connecting" {
                return Ok::<_, String>(json!({"status":bridge["status"],"tools":bridge["tools"],"error":bridge["error"]}));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        Err("Claude MCP connection remained pending".into())
    }).await;
    client.close().await;
    server.abort();
    let status = result.expect("Claude control protocol timed out").unwrap();
    assert_eq!(status["status"], "connected", "{status}");
    assert!(
        status["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["name"] == "project"),
        "{status}"
    );
    println!(
        "Installed Claude connected to the native bridge without inference; {} tools",
        status["tools"].as_array().unwrap().len()
    );
}
