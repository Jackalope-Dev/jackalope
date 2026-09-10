use super::*;
use serde_json::{json, Value};
use std::{path::Path, time::Instant};

pub(super) fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let output = crate::commands::git_command::command(
        repo,
        args,
        crate::commands::git_command::Policy::Inherited,
    )
    .output()
    .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "Executes installed agents on disposable evaluation cases; requires JACKALOPE_EVAL_CASE and JACKALOPE_EVAL_MODE"]
async fn installed_execution_evaluation() {
    evaluate().await.unwrap();
}

async fn evaluate() -> Result<(), Box<dyn std::error::Error>> {
    let mode = std::env::var("JACKALOPE_EVAL_MODE")?;
    if !["single", "serial", "staged"].contains(&mode.as_str()) {
        return Err("Use single, serial or staged evaluation mode.".into());
    }
    let case_id = std::env::var("JACKALOPE_EVAL_CASE")?;
    let suite: Value = serde_json::from_str(include_str!(
        "../../../../../../scripts/evaluation/cases.json"
    ))?;
    let case = suite["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == case_id)
        .ok_or("Unknown evaluation case")?;
    let seconds = std::env::var("JACKALOPE_EVAL_SECONDS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(300)
        .clamp(30, 1800);
    let tokens = std::env::var("JACKALOPE_EVAL_TOKENS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(1_000_000)
        .clamp(1000, 1_000_000);
    let root = std::env::temp_dir().join(format!("jackalope-evaluation-{}", Uuid::new_v4()));
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo)?;
    for (name, content) in case["files"].as_object().unwrap() {
        std::fs::write(repo.join(name), content.as_str().unwrap())?;
    }
    git(&repo, &["init", "-b", "main"])?;
    git(&repo, &["config", "user.name", "Evaluation fixture"])?;
    git(
        &repo,
        &["config", "user.email", "evaluation@example.invalid"],
    )?;
    git(&repo, &["config", "commit.gpgsign", "false"])?;
    git(&repo, &["add", "."])?;
    git(&repo, &["commit", "-m", "Evaluation fixture"])?;
    let runtime = TaskRuntime::with_test_access(root.join("profile/history"))?;
    let service = Coordinator::new(root.join("profile/coordination"), runtime.clone())?;
    let cleanup = EvaluationOwner {
        runtime: runtime.clone(),
        service: service.clone(),
    };
    service.launch();
    let project = Uuid::new_v4().to_string();
    let goal = case["goal"].as_str().unwrap();
    let mut tasks = if mode == "single" {
        vec![
            json!({"key":"all","title":"Complete request","prompt":goal,"scopes":["."],"dependsOn":[]}),
        ]
    } else {
        case["tasks"].as_array().unwrap().clone()
    };
    let mut previous = None;
    for task in &mut tasks {
        if mode == "serial" {
            task["dependsOn"] = previous
                .clone()
                .map_or(json!([]), |key: Value| json!([key]));
        }
        previous = Some(task["key"].clone());
        task["agent"] = json!("codex");
        task["prompt"] = json!(format!("{}\n\nFull request: {goal}\nWork only on the assigned paths. Do not access the network, install dependencies, edit other worktrees, or commit. Run relevant checks. Report unmet requirements explicitly.",task["prompt"].as_str().unwrap()));
    }
    let ids = service.import(serde_json::from_value(json!({"projectId":project,"projectName":"Execution evaluation","projectPath":repo,"targetBranch":"main","verifyCommand":case["check"],"autoVerify":true,"stagedDependencies":mode=="staged","items":tasks}))?)?;
    service
        .inner
        .lock()
        .unwrap()
        .enabled
        .insert(project.clone());
    let started = Instant::now();
    let mut integrated = HashSet::new();
    let mut budget_stopped = false;
    loop {
        let view = service.view()?;
        let runs = runtime.integration_runs()?;
        let observed: u64 = runs.iter().map(|r| r.usage.input + r.usage.output).sum();
        if started.elapsed().as_secs() >= seconds || observed >= tokens {
            budget_stopped = true;
            break;
        }
        if let Some(error) = &view.bridge_error {
            return Err(error.clone().into());
        }
        if mode == "serial" {
            for item in &view.items {
                if let Some(run) = runs
                    .iter()
                    .find(|r| Some(&r.id) == item.run_id.as_ref() && r.status == "review")
                {
                    if !integrated.contains(&run.id) {
                        crate::commands::integration::evaluation_integrate(
                            &runtime,
                            &[run.id.clone()],
                        )?;
                        integrated.insert(run.id.clone());
                    }
                }
            }
        }
        if view.items.iter().any(|i| i.error.is_some()) || runs.iter().any(|r| r.status == "failed")
        {
            break;
        }
        if ids.iter().all(|id| {
            view.items
                .iter()
                .find(|i| &i.id == id)
                .and_then(|i| i.run_id.as_ref())
                .is_some_and(|id| runs.iter().any(|r| &r.id == id && !active(&r.status)))
        }) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    let elapsed_ms = started.elapsed().as_millis();
    service.shutdown();
    if runtime
        .integration_runs()?
        .iter()
        .any(|run| active(&run.status))
    {
        runtime.stop_all();
        let stopping = Instant::now();
        while runtime
            .integration_runs()?
            .iter()
            .any(|run| active(&run.status))
            && stopping.elapsed().as_secs() < 15
        {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    let runs = runtime.integration_runs()?;
    let view = service.view()?;
    let completed = ids.iter().all(|id| {
        view.items
            .iter()
            .find(|item| &item.id == id)
            .and_then(|item| item.run_id.as_ref())
            .is_some_and(|id| {
                runs.iter().any(|run| {
                    &run.id == id && ["review", "reviewed"].contains(&run.status.as_str())
                })
            })
    });
    let final_run = ids
        .last()
        .and_then(|id| view.items.iter().find(|item| &item.id == id))
        .and_then(|item| item.run_id.as_ref())
        .and_then(|id| runs.iter().find(|run| &run.id == id));
    let queue: Vec<_> = view
        .items
        .iter()
        .map(|item| json!({"id":item.id,"runId":item.run_id,"error":item.error}))
        .collect();
    std::fs::write(root.join("oracle.cjs"), case["oracle"].as_str().unwrap())?;
    let oracle = if let Some(run) = final_run.filter(|_| completed && !budget_stopped) {
        let mut command = std::process::Command::new("node");
        command.arg(root.join("oracle.cjs")).arg(&run.workspace);
        Some(crate::commands::process_control::run_cancellable(
            command,
            Duration::from_secs(15),
            || false,
        )?)
    } else {
        None
    };
    let report = json!({"version":1,"case":case_id,"mode":mode,"elapsedMs":elapsed_ms,"secondsBudget":seconds,"observedTokenBudget":tokens,"budgetStopped":budget_stopped,"completed":completed,"queue":queue,"oracle":oracle,"accepted":null,"humanReviewMinutes":null,"escapedDefects":null,"runs":runs,"limitations":"The automated oracle is not human acceptance. Token stopping uses reported usage and cannot enforce provider spending. Serial mode uses immediate fixture integration, excluding real human review delays. Repeat each mode with the same provider/model and budgets before drawing conclusions."});
    std::fs::write(
        root.join("evaluation.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    drop(cleanup);
    println!(
        "Evaluation receipt: {}",
        root.join("evaluation.json").display()
    );
    Ok(())
}

struct EvaluationOwner {
    runtime: TaskRuntime,
    service: Coordinator,
}
impl Drop for EvaluationOwner {
    fn drop(&mut self) {
        self.runtime.stop_all();
        self.service.shutdown();
    }
}
