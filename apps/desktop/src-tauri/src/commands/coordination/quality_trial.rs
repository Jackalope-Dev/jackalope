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
    let mut spec: Value = serde_json::from_slice(&std::fs::read(&spec_path)?)?;
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
    let direct = spec["variant"] == "direct";
    let project_id = Uuid::new_v4().to_string();
    let fixture_scope = format!("project:{project_id}");
    let has_fixture = spec["toolFixture"].is_object();
    if has_fixture {
        let source = root.join("tool-data.json");
        std::fs::write(&source, serde_json::to_vec(&spec["toolFixture"])?)?;
        let server_path = root.join("tool-server.cjs");
        let counter = root.join("tool-calls.txt");
        std::fs::write(
            &server_path,
            r#"const fs=require('node:fs'), data=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));let calls=0;require('readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);const send=result=>console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));if(q.method==='initialize')send({protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'result-fixture',version:'1'}});if(q.method==='tools/list')send({tools:[{name:'fixture_report',description:'Return a report keyed by record ID in structuredContent.report.',annotations:{readOnlyHint:true,destructiveHint:false},inputSchema:{type:'object',properties:{}}}]});if(q.method==='tools/call'){fs.writeFileSync(process.argv[3],String(++calls));send({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError:false});}});"#,
        )?;
        let config = json!({"command":"node","args":[server_path,source,counter]});
        spec["fixtureMcp"] = json!({"quality_fixture":config});
        if !direct {
            crate::commands::mcp::mcp_save_server(serde_json::from_value(json!({
                "id":"quality_fixture","name":"Disposable tool-result fixture","scope":fixture_scope,"transport":"stdio",
                "command":"node","args":config["args"],"discovery":true
            }))?).await?;
        }
    }
    if !direct {
        service.launch();
    }
    let id = Uuid::new_v4().to_string();
    let deadline = Instant::now() + Duration::from_secs(15);
    while !direct && service.view()?.bridge_url.is_none() {
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
    let direct_result = if direct {
        Some(super::quality_direct::run(&runtime, &repo, &spec))
    } else {
        None
    };
    let direct_run = direct_result
        .as_ref()
        .and_then(|r| r.as_ref().ok())
        .map(|r| &r.0);
    let launch_error = if direct {
        direct_result
            .as_ref()
            .and_then(|r| r.as_ref().err())
            .cloned()
    } else {
        service
            .start_manual(serde_json::from_value(json!({
                "id":id,"projectId":project_id,"projectName":"Quality benchmark",
                "projectPath":repo,"agent":spec["agent"],"model":spec["model"],
                "isolated":true,"targetBranch":"main","connectionIds":if has_fixture {vec!["quality_fixture"]} else {vec![]},
                "contextSelection":{"memoryOff":true},"prompt":spec["prompt"],
                "verifyCommand":spec["check"],"autoVerify":true,"effort":spec["effort"],"codexSpeed":spec["codexSpeed"]
            }))?)
            .err()
    };
    let mut stopped = direct_result
        .as_ref()
        .and_then(|r| r.as_ref().ok())
        .is_some_and(|r| r.1);
    let mut stop_at = None;
    if !direct && launch_error.is_none() {
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
    let run = direct_run.or_else(|| runs.iter().find(|r| r.id == id));
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
    let agent_verification: Vec<Value> =
        std::fs::read_to_string(spec_path.with_extension("verification.jsonl"))
            .unwrap_or_default()
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect();
    let tool_calls = has_fixture.then(|| {
        std::fs::read_to_string(root.join("tool-calls.txt"))
            .ok()
            .and_then(|text| text.parse::<u64>().ok())
    });
    let report = json!({"version":1,"case":spec["id"],"variant":spec["variant"],"fixtureToolCalls":tool_calls,
        "agent":spec["agent"],"model":spec["model"],"elapsedMs":elapsed,
        "budgetStopped":stopped,"launchError":launch_error,"oracle":oracle,
        "promptBytes":if direct { spec["prompt"].as_str().map(str::len) } else { input.as_ref().map(Vec::len) },"run":run,"agentVerification":agent_verification,
        "accepted":null,"humanReviewMinutes":null,
        "limitations":"Disposable native execution, not installed-app acceptance. Budgets use delayed reported usage; all unsuccessful trials remain in comparisons."});
    let receipt = root.join("quality.json");
    std::fs::write(&receipt, serde_json::to_vec_pretty(&report)?)?;
    println!("Quality receipt: {}", receipt.display());
    if has_fixture && !direct {
        crate::commands::mcp::mcp_delete_server("quality_fixture".into(), fixture_scope).await?;
    }
    Ok(())
}

struct Owner(TaskRuntime, Coordinator);
impl Drop for Owner {
    fn drop(&mut self) {
        self.0.stop_all();
        self.1.shutdown();
    }
}
