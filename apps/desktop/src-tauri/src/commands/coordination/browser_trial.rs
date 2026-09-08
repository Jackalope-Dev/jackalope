use crate::commands::{
    coordination::Coordinator,
    tasks::{RunRequest, TaskRuntime},
};
use serde_json::json;
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

#[tokio::test]
#[ignore = "Runs installed agents through Jackalope against a disposable local browser fixture"]
async fn installed_agents_verify_browser_flow() {
    let repo = PathBuf::from(
        std::env::var("JACKALOPE_BROWSER_TRIAL_REPO")
            .expect("Set a disposable absolute repository path"),
    );
    let profile = PathBuf::from(
        std::env::var("JACKALOPE_BROWSER_TRIAL_PROFILE")
            .expect("Set a new absolute native profile path"),
    );
    assert!(repo.is_absolute() && profile.is_absolute() && !profile.exists());
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let page = format!(
        r#"<!doctype html><html><head><title>Browser acceptance</title><style>{}</style></head><body><h1>Browser acceptance</h1><form onsubmit="event.preventDefault();document.querySelector('output').textContent='Verified '+document.querySelector('input').value+' {}'"><label>Display name<input value="Old"></label><button>Save profile</button></form><output role="status"></output></body></html>"#,
        "/* application bundle */".repeat(2400),
        nonce
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            axum::Router::new().route(
                "/",
                axum::routing::get(move || {
                    let page = page.clone();
                    async move { axum::response::Html(page) }
                }),
            ),
        )
        .await
        .unwrap();
    });
    let runtime = TaskRuntime::new(profile.join("history")).unwrap();
    let coordinator = Coordinator::new(profile.join("coordination"), runtime.clone()).unwrap();
    coordinator.launch();
    for _ in 0..100 {
        if coordinator.view().unwrap().bridge_url.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let mut failures = Vec::new();
    for agent in std::env::var("JACKALOPE_BROWSER_TRIAL_AGENTS")
        .unwrap_or("codex,claude".into())
        .split(',')
    {
        let id = uuid::Uuid::new_v4().to_string();
        let prompt = format!("Test the local fixture at {url} using only Jackalope browser tools supplied through native MCP. Do not use shell, other browser tools, inspect repository files, or modify files. Navigate, take browser_snapshot, identify Display name by its @e reference and fill it with Jackalope trial (replace Old). Click Save profile, wait for Verified text, then take a fresh snapshot and report the entire Verified message including its unknown code. Configure the viewport to 960x640 with dark scheme and reduced motion. Capture a screenshot named Browser acceptance using browser_screenshot. Inspect page errors using browser_inspect. Record a passed validation step named Browser acceptance only if the observed message and screenshot succeeded. Briefly report actual results and stop. This is an authorized local fixture with no real account, payment or messages.");
        let request: RunRequest = serde_json::from_value(json!({"id":id,"projectId":uuid::Uuid::new_v4().to_string(),"projectName":"Browser acceptance","projectPath":repo,"agent":agent,"isolated":false,"autoVerify":false,"connectionIds":[],"prompt":prompt})).unwrap();
        if let Err(error) = coordinator.start_manual(request) {
            failures.push(format!("{agent}: {error}"));
            continue;
        }
        let start = Instant::now();
        loop {
            let run = runtime
                .integration_runs()
                .unwrap()
                .into_iter()
                .find(|r| r.id == id)
                .unwrap();
            if !["starting", "running", "stopping"].contains(&run.status.as_str()) {
                println!(
                    "{agent}: {}, screenshots={}, validations={}, result={}",
                    run.status,
                    run.screenshots.len(),
                    run.validation_steps.len(),
                    run.result
                );
                if run.status != "review"
                    || !run.result.contains(&nonce)
                    || run.screenshots.is_empty()
                    || !run.validation_steps.iter().any(|s| s.status == "passed")
                {
                    failures.push(format!(
                        "{agent}: browser evidence incomplete; inspect retained profile"
                    ));
                }
                break;
            }
            if start.elapsed() > Duration::from_secs(180) {
                let _ = runtime.stop(&id);
                failures.push(format!("{agent}: timed out"));
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }
    runtime.stop_all();
    coordinator.shutdown();
    server.abort();
    println!("Native browser trial profile: {}", profile.display());
    assert!(failures.is_empty(), "{}", failures.join("; "));
}
