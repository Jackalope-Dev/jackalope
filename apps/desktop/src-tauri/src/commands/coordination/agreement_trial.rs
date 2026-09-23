use super::*;
use serde_json::json;
use std::time::Instant;

#[tokio::test]
#[ignore = "Runs installed Grok and Claude in disposable worktrees using their existing sign-ins"]
async fn installed_grok_and_claude_negotiate_ownership_and_interfaces() {
    let repo = PathBuf::from(
        std::env::var("JACKALOPE_AGREEMENT_TRIAL_REPO").expect("Use a disposable repository"),
    );
    let profile = PathBuf::from(
        std::env::var("JACKALOPE_AGREEMENT_TRIAL_PROFILE").expect("Use a new isolated profile"),
    );
    assert!(repo.is_absolute() && profile.is_absolute() && !profile.exists());
    let runtime = TaskRuntime::with_test_access(profile.join("history")).unwrap();
    let coordinator = Coordinator::new(profile.join("coordination"), runtime.clone()).unwrap();
    coordinator.launch();
    for _ in 0..100 {
        if coordinator.bridge_ready() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let grok = Uuid::new_v4().to_string();
    let claude = Uuid::new_v4().to_string();
    let claim = Uuid::new_v4().to_string();
    let interface = Uuid::new_v4().to_string();
    let project = Uuid::new_v4().to_string();
    let common = "This is an authorized disposable Jackalope coordination trial. Use only the supplied Jackalope bridge for coordination. Never print credentials or bypass denied tools. Do not commit. Do not invoke Git or create worktrees. Inspect project and use inbox wait_ms at checkpoints. Tool errors are evidence: report them, do not fabricate success. The other worker runs concurrently in its separate worktree. Do not call ask_user; no human input is needed. Stop after the requested steps.";
    let prompts = [
        ("grok", &grok, format!("{common} Use permitted HTTP /v1/agreements and /v1/project. Wait until task {claude} appears in project. Claim responsibility 'trial parser' with id {claim}, text 'Implement the one shared parser', paths [\"parser.txt\"]. Propose interface with id {interface}, resource 'trial parser interface', text 'parser.txt must contain agreed-parser-v1', participants [\"{claude}\"]. Offer transfer of the claim to {claude} using action transfer, its id and current revision. Do not edit parser.txt. Wait until project shows the interface agreed and the claim owned by {claude}. Then write only grok.txt containing coordination-complete. Send a completion message and finish.")),
        ("claude", &claude, format!("{common} Use native MCP project, agreement and inbox tools. Wait for ownership claim {claim} and interface {interface} from {grok}. Attempt a separate claim for resource 'trial parser', using a fresh UUID id and text 'Duplicate trial'; it MUST be rejected. Send message kind progress with exact text duplicate-claim-rejected only after observing that rejection. Accept interface {interface} using its current revision. Accept the pending ownership transfer {claim} using its current revision. Then write only parser.txt with agreed-parser-v1. Send completion and finish.")),
    ];
    let mut failures = Vec::new();
    for (agent, id, prompt) in prompts {
        let request: RunRequest = serde_json::from_value(json!({"id":id,"projectId":project,"projectName":"Cross-provider agreement trial","projectPath":repo,"agent":agent,"isolated":true,"prompt":prompt})).unwrap();
        if let Err(error) = coordinator.start_manual(request) {
            failures.push(format!("{agent} launch: {error}"));
        }
    }
    let timeout = std::env::var("JACKALOPE_AGREEMENT_TRIAL_TIMEOUT_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(600)
        .clamp(30, 1200);
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(timeout) {
        let runs = runtime.integration_runs().unwrap();
        if runs
            .iter()
            .filter(|r| r.id == grok || r.id == claude)
            .count()
            == 2
            && runs
                .iter()
                .filter(|r| r.id == grok || r.id == claude)
                .all(|r| !active(&r.status))
        {
            break;
        }
        if !failures.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    runtime.stop_all();
    for _ in 0..100 {
        if runtime
            .integration_runs()
            .unwrap()
            .iter()
            .all(|r| !active(&r.status))
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    coordinator.shutdown();
    let view = coordinator.view().unwrap();
    if !view
        .agreements
        .iter()
        .any(|a| a.id == claim && a.task_id == claude && a.status == "owned")
    {
        failures.push("No accepted Grok-to-Claude ownership transfer".into());
    }
    if !view
        .agreements
        .iter()
        .any(|a| a.id == interface && a.status == "agreed")
    {
        failures.push("No explicit interface agreement".into());
    }
    if !view
        .messages
        .iter()
        .any(|m| m.task_id == claude && m.text == "duplicate-claim-rejected")
    {
        failures.push("Claude did not report the rejected duplicate claim".into());
    }
    let runs = runtime.integration_runs().unwrap();
    for (id, file, expected) in [
        (&grok, "grok.txt", "coordination-complete"),
        (&claude, "parser.txt", "agreed-parser-v1"),
    ] {
        match runs.iter().find(|r| &r.id == id) {
            Some(run)
                if run.status == "review"
                    && std::fs::read_to_string(PathBuf::from(&run.workspace).join(file))
                        .is_ok_and(|s| s.trim() == expected) => {}
            Some(run) => failures.push(format!("{file} oracle failed; status {}", run.status)),
            None => failures.push(format!("Missing {file} attempt")),
        }
    }
    std::fs::write(profile.join("result.json"), serde_json::to_vec_pretty(&json!({"passed":failures.is_empty(),"failures":failures,"elapsedSeconds":started.elapsed().as_secs(),"scope":"Installed provider transport, claims, handoff and interface agreement; no installed GUI or speed claim"})).unwrap()).unwrap();
    println!(
        "Trial result retained at {}",
        profile.join("result.json").display()
    );
    assert!(failures.is_empty(), "{}", failures.join("; "));
}
