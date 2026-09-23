use super::*;
use serde_json::json;
use std::time::Instant;

async fn trial() -> Result<(), Box<dyn std::error::Error>> {
    let repo = PathBuf::from(std::env::var("JACKALOPE_AUTOMATIC_TRIAL_REPO")?);
    let profile = PathBuf::from(std::env::var("JACKALOPE_AUTOMATIC_TRIAL_PROFILE")?);
    if !repo.is_absolute() || !profile.is_absolute() || profile.exists() {
        return Err("Use an absolute disposable repository and a new absolute profile.".into());
    }
    let runtime = TaskRuntime::with_test_access(profile.join("history"))?;
    let service = Coordinator::new(profile.join("coordination"), runtime.clone())?;
    service.launch();
    let result = exercise(&service, &runtime, &repo).await;
    runtime.stop_all();
    service.shutdown();
    println!(
        "Automatic coordination trial profile: {}",
        profile.display()
    );
    result
}

async fn exercise(
    service: &Coordinator,
    runtime: &TaskRuntime,
    repo: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error>> {
    for _ in 0..100 {
        if service.view()?.bridge_url.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let project = Uuid::new_v4().to_string();
    let writer = Uuid::new_v4().to_string();
    let reader = Uuid::new_v4().to_string();
    let launch = |id: &str, prompt: &str| -> Result<(), Box<dyn std::error::Error>> {
        let request: RunRequest = serde_json::from_value(
            json!({"id":id,"projectId":project,"projectName":"Automatic coordination trial","projectPath":repo,"agent":"codex","isolated":true,"connectionIds":[],"prompt":prompt}),
        )?;
        service.start_manual(request)?;
        Ok(())
    };
    launch(&writer, "coordination-peer-731\nThis is a disposable native coordination trial. Do not edit files, commit, inspect repository contents or call external connections. Use only Jackalope ask_user and user_response tools. Ask the user 'Writer ready' with input_type text, then read the saved answer with user_response until answered. After the answer, finish with 'Writer finished'. The test harness answers automatically. Do not call project, inbox or message; Jackalope supplies coordination automatically.")?;
    wait_for(runtime, &writer, true).await?;
    launch(&reader, "This is a disposable native coordination trial. Do not edit files, commit or inspect repository contents. Use only Jackalope ask_user and user_response tools. From your automatically supplied startup project snapshot, remember the first line of the other active task's title. Ask the user 'Reader ready' with input_type text. Use user_response until answered. Inspect coordinationUpdates attached to these normal tool results. After the answer, report the remembered peer title and the peer's finish state from the automatic update. Do not call project, inbox, message or shell; this verifies automatic delivery without explicit coordination calls.")?;
    wait_for(runtime, &reader, true).await?;
    answer(runtime, &writer)?;
    wait_for(runtime, &writer, false).await?;
    service.reconcile()?;
    answer(runtime, &reader)?;
    wait_for(runtime, &reader, false).await?;
    service.reconcile()?;
    let runs = runtime.integration_runs()?;
    let read = runs
        .iter()
        .find(|r| r.id == reader)
        .ok_or("Missing reader")?;
    println!("Reader result: {}", read.result);
    if read.status != "review"
        || !read.result.contains("coordination-peer-731")
        || !read.result.to_lowercase().contains("review")
    {
        return Err(
            "Reader did not report both the startup snapshot and automatic completion update"
                .into(),
        );
    }
    let messages = service.view()?.messages;
    for id in [&reader, &writer] {
        for phase in ["active", "review"] {
            if messages
                .iter()
                .filter(|m| m.id == format!("lifecycle:{id}:{phase}"))
                .count()
                != 1
            {
                return Err("Expected one automatic start and finish for each real attempt".into());
            }
        }
    }
    Ok(())
}

fn answer(runtime: &TaskRuntime, id: &str) -> Result<(), Box<dyn std::error::Error>> {
    let run = runtime
        .integration_runs()?
        .into_iter()
        .find(|r| r.id == id)
        .ok_or("Missing attempt")?;
    for prompt in run.prompts.iter().filter(|p| p.status == "pending") {
        runtime.respond_prompt(id, &prompt.id, "Proceed with the trial now.")?;
    }
    Ok(())
}

async fn wait_for(
    runtime: &TaskRuntime,
    id: &str,
    question: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let started = Instant::now();
    loop {
        let run = runtime
            .integration_runs()?
            .into_iter()
            .find(|r| r.id == id)
            .ok_or("Missing attempt")?;
        if question && run.prompts.iter().any(|p| p.status == "pending") {
            return Ok(());
        }
        if !active(&run.status) {
            if !question && run.status == "review" {
                return Ok(());
            }
            return Err(format!(
                "Attempt ended before expected checkpoint: {} {:?}",
                run.status, run.error
            )
            .into());
        }
        if started.elapsed() > Duration::from_secs(180) {
            return Err("Native coordination trial timed out".into());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "Runs two installed Codex agents in disposable worktrees with an isolated profile"]
async fn installed_agents_receive_startup_and_completion_automatically() {
    trial().await.unwrap();
}
