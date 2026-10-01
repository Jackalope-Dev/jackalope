use super::*;
use serde_json::json;
use std::{path::Path, time::Instant};

/// Two installed agents share live work and split off a subtask in a disposable repository.
/// Oracles read worktrees and the ledger, never agent claims. `result.json` in the profile
/// records each check; this is provider acceptance evidence, not a speed or quality measurement.
#[tokio::test]
#[ignore = "Runs two installed agents and one spawned subtask using their existing sign-ins"]
async fn installed_agents_share_live_work_and_split_off_subtasks() {
    let repo = PathBuf::from(
        std::env::var("JACKALOPE_SWARM_TRIAL_REPO").expect("Use a disposable repository"),
    );
    let profile = PathBuf::from(
        std::env::var("JACKALOPE_SWARM_TRIAL_PROFILE").expect("Use a new isolated profile"),
    );
    assert!(repo.is_absolute() && profile.is_absolute() && !profile.exists());
    let agents = std::env::var("JACKALOPE_SWARM_TRIAL_AGENTS").unwrap_or("claude,codex".into());
    let agents: Vec<&str> = agents.split(',').collect();
    assert_eq!(agents.len(), 2, "Name two agents, such as claude,codex");
    let runtime = TaskRuntime::with_test_access(profile.join("history")).unwrap();
    let coordinator = Coordinator::new(profile.join("coordination"), runtime.clone()).unwrap();
    coordinator.launch();
    for _ in 0..100 {
        if coordinator.bridge_ready() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let api = Uuid::new_v4().to_string();
    let ui = Uuid::new_v4().to_string();
    let project = Uuid::new_v4().to_string();
    {
        // The user's Split this task consent, granted up front for the UI worker.
        let mut inner = coordinator.inner.lock().unwrap();
        let mut ledger = inner.ledger.clone();
        ledger.subtask_grants.push(ui.clone());
        coordinator.save(&ledger).unwrap();
        inner.ledger = ledger;
    }
    let common = "This is an authorized disposable Jackalope coordination trial. Use only Jackalope tools for coordination. Never print credentials or bypass denied tools. Do not commit, invoke Git or create worktrees. Do not call ask_user. Tool errors are evidence: report them, do not fabricate success. Another worker runs concurrently in its own worktree.";
    let prompts = [
        (agents[0], &api, format!("{common} Write only src/api.ts containing exactly: export type User = {{ id: string; name: string }};\n Then wait 60 seconds using inbox with wait_ms so the other worker can read your work, send a completion message and finish.")),
        (agents[1], &ui, format!("{common} Task {api} is writing src/api.ts. Call peers repeatedly (use inbox wait_ms 15000 between calls) until its files include src/api.ts. Read it with peer_read, then call peer_adopt for src/api.ts. Write only src/ui.ts containing: import type {{ User }} from './api'; export const label = (user: User) => user.name; Then call propose_subtask with title 'Trial docs', scopes [\"docs\"] and a prompt asking the worker to write docs/README.md containing swarm-trial-docs. Send a completion message naming each tool result and finish.")),
    ];
    let mut failures = Vec::new();
    for (agent, id, prompt) in prompts {
        let request: RunRequest = serde_json::from_value(json!({"id":id,"projectId":project,"projectName":"Swarm trial","projectPath":repo,"agent":agent,"isolated":true,"prompt":prompt})).unwrap();
        if let Err(error) = coordinator.start_manual(request) {
            failures.push(format!("{agent} launch: {error}"));
        }
    }
    let timeout = std::env::var("JACKALOPE_SWARM_TRIAL_TIMEOUT_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(900)
        .clamp(60, 1800);
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(timeout) {
        let runs = runtime.integration_runs().unwrap();
        let pair = runs.iter().filter(|r| r.id == api || r.id == ui);
        if pair.clone().count() == 2 && pair.clone().all(|r| !active(&r.status)) {
            break;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    let runs = runtime.integration_runs().unwrap();
    let ledger = coordinator.inner.lock().unwrap().ledger.clone();
    let read = |id: &str, path: &str| {
        runs.iter()
            .find(|r| r.id == id)
            .and_then(|r| std::fs::read_to_string(Path::new(&r.workspace).join(path)).ok())
            .unwrap_or_default()
    };
    let api_file = read(&api, "src/api.ts");
    let checks = json!({
        "apiWritten": api_file.contains("export type User"),
        "uiWritten": read(&ui, "src/ui.ts").contains("from './api'"),
        "adoptedIdentical": !api_file.is_empty() && read(&ui, "src/api.ts") == api_file,
        "adoptionRecorded": ledger.adoptions.iter().any(|a| a.run_id == ui && a.paths == vec!["src/api.ts".to_string()]),
        "subtaskSpawned": ledger.items.iter().any(|i| i.parent_task_id.as_deref() == Some(ui.as_str()) && i.scopes == vec!["docs".to_string()]),
        "uiUsedPeers": runs.iter().find(|r| r.id == ui).is_some_and(|r| serde_json::to_string(&r.activity).unwrap_or_default().contains("peers")),
    });
    runtime.stop_all();
    coordinator.shutdown();
    let passed = checks.as_object().unwrap().values().all(|v| v == true) && failures.is_empty();
    std::fs::write(
        profile.join("result.json"),
        serde_json::to_vec_pretty(&json!({"passed":passed,"checks":checks,"failures":failures,"agents":agents,"elapsedSeconds":started.elapsed().as_secs()})).unwrap(),
    )
    .unwrap();
    assert!(passed, "Swarm trial failed: {checks} {failures:?}");
}
