use super::*;
use serde_json::{json, Value};
use std::{path::Component, time::Instant};

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "Runs one installed-agent benchmark in a disposable workspace; requires JACKALOPE_QUALITY_SPEC"]
async fn installed_quality_trial() {
    trial().await.unwrap();
}

async fn trial() -> Result<(), Box<dyn std::error::Error>> {
    let spec_path = PathBuf::from(std::env::var("JACKALOPE_QUALITY_SPEC")?);
    let spec: Value = serde_json::from_slice(&std::fs::read(&spec_path)?)?;
    let root = std::env::temp_dir().join(format!("jackalope-quality-{}", Uuid::new_v4()));
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo)?;
    for (name, content) in spec["files"].as_object().ok_or("Missing fixture files")? {
        let relative = PathBuf::from(name);
        if relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err("Fixture paths must be relative without traversal".into());
        }
        let path = repo.join(relative);
        std::fs::create_dir_all(path.parent().ok_or("Invalid fixture path")?)?;
        std::fs::write(path, content.as_str().ok_or("Invalid fixture content")?)?;
    }
    for args in [
        vec!["init", "-b", "main"],
        vec!["config", "user.name", "Evaluation fixture"],
        vec!["config", "user.email", "evaluation@example.invalid"],
        vec!["config", "commit.gpgsign", "false"],
        vec!["add", "."],
        vec!["commit", "-m", "Evaluation fixture"],
        vec![
            "config",
            "jackalope.commitPolicy",
            r#"{"attribution":"user","name":"Evaluation fixture","email":"evaluation@example.invalid","cleanupAfterMerge":false,"autoCheckpoint":false}"#,
        ],
    ] {
        super::evaluation_trial::git(&repo, &args)?;
    }
    let runtime = TaskRuntime::with_test_access(root.join("profile/history"))?;
    let service = Coordinator::new(root.join("profile/coordination"), runtime.clone())?;
    let _owner = Owner(runtime.clone(), service.clone());
    service.launch();
    let id = Uuid::new_v4().to_string();
    let deadline = Instant::now() + Duration::from_secs(15);
    while service.view()?.bridge_url.is_none() {
        if Instant::now() >= deadline {
            return Err("Bridge did not start".into());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let seconds = spec["seconds"].as_u64().unwrap_or(180).clamp(30, 1800);
    let tokens = spec["tokens"]
        .as_u64()
        .unwrap_or(250_000)
        .clamp(1000, 1_000_000);
    let started = Instant::now();
    let launch_error = service
        .start_manual(serde_json::from_value(json!({
            "id":id,"projectId":Uuid::new_v4().to_string(),"projectName":"Quality benchmark",
            "projectPath":repo,"agent":spec["agent"],"model":spec["model"],
            "isolated":true,"targetBranch":"main","connectionIds":[],
            "contextSelection":{"memoryOff":true},"prompt":spec["prompt"],
            "verifyCommand":spec["check"],"autoVerify":true
        }))?)
        .err();
    let mut stopped = false;
    let mut stop_at = None;
    if launch_error.is_none() {
        loop {
            let runs = runtime.integration_runs()?;
            let run = runs
                .iter()
                .find(|r| r.id == id)
                .ok_or("Missing benchmark attempt")?;
            if !["starting", "running", "stopping"].contains(&run.status.as_str()) {
                break;
            }
            if !stopped
                && (started.elapsed().as_secs() >= seconds
                    || run.usage.input + run.usage.output >= tokens)
            {
                runtime.stop_all();
                stopped = true;
                stop_at = Some(Instant::now());
            }
            if stop_at.is_some_and(|t| t.elapsed().as_secs() > 30) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    let elapsed = started.elapsed().as_millis();
    let runs = runtime.integration_runs()?;
    let run = runs.iter().find(|r| r.id == id);
    std::fs::write(
        root.join("oracle.cjs"),
        spec["oracle"].as_str().ok_or("Missing oracle")?,
    )?;
    let oracle = if let Some(run) = run.filter(|r| {
        !["starting", "running", "stopping", "interrupted"].contains(&r.status.as_str())
    }) {
        let mut command = std::process::Command::new("node");
        command.arg(root.join("oracle.cjs")).arg(&run.workspace);
        Some(crate::commands::process_control::run_cancellable(
            command,
            Duration::from_secs(20),
            || false,
        )?)
    } else {
        None
    };
    let input = std::fs::read(root.join(format!("profile/history/{id}.input"))).ok();
    let report = json!({"version":1,"case":spec["id"],"variant":spec["variant"],
        "agent":spec["agent"],"model":spec["model"],"elapsedMs":elapsed,
        "budgetStopped":stopped,"launchError":launch_error,"oracle":oracle,
        "promptBytes":input.as_ref().map(Vec::len),"run":run,
        "accepted":null,"humanReviewMinutes":null,
        "limitations":"Disposable native execution, not installed-app acceptance. Budgets use delayed reported usage; all unsuccessful trials remain in comparisons."});
    let receipt = root.join("quality.json");
    std::fs::write(&receipt, serde_json::to_vec_pretty(&report)?)?;
    println!("Quality receipt: {}", receipt.display());
    Ok(())
}

struct Owner(TaskRuntime, Coordinator);
impl Drop for Owner {
    fn drop(&mut self) {
        self.0.stop_all();
        self.1.shutdown();
    }
}
