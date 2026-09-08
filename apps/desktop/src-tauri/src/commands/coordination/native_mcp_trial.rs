use crate::commands::{
    coordination::Coordinator,
    mcp::{mcp_delete_server, mcp_save_server, McpServerConfig},
    tasks::{RunRequest, TaskRuntime},
};
use serde_json::json;
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

async fn trial() -> Result<(), Box<dyn std::error::Error>> {
    let repo = PathBuf::from(std::env::var("JACKALOPE_MCP_TRIAL_REPO")?);
    let profile = PathBuf::from(std::env::var("JACKALOPE_MCP_TRIAL_PROFILE")?);
    if !repo.is_absolute() || !profile.is_absolute() || profile.exists() {
        return Err(
            "Use an absolute disposable repository and a new absolute profile directory.".into(),
        );
    }
    let project = uuid::Uuid::new_v4().to_string();
    let scope = format!("project:{project}");
    let server: McpServerConfig = serde_json::from_value(json!({
        "id":"trial", "name":"Local verification fixture", "scope":scope, "transport":"stdio", "command":"node", "discovery":true,
        "args":["-e",r#"require('readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);const send=result=>console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));if(q.method==='initialize')send({protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'trial',version:'1'}});if(q.method==='tools/list')send({tools:[{name:'jackalope_echo',annotations:{readOnlyHint:true,destructiveHint:false},description:'Echo the supplied value for local verification',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']}},...Array.from({length:100},(_,i)=>({name:'unrelated_'+i,description:'Unrelated fixture operation',inputSchema:{type:'object'}}))]});if(q.method==='tools/call')send({content:[{type:'text',text:'Verified through Jackalope: '+q.params.arguments.value}],structuredContent:{value:q.params.arguments.value}});});"#]
    }))?;
    mcp_save_server(server).await?;
    let runtime = TaskRuntime::new(profile.join("history"))?;
    let coordinator = Coordinator::new(profile.join("coordination"), runtime.clone())?;
    coordinator.launch();
    for _ in 0..100 {
        if coordinator.view()?.bridge_url.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let endpoint = coordinator
        .view()?
        .bridge_url
        .ok_or("Bridge did not start")?;
    for path in [
        "/v1/tools/search",
        "/v1/tools/read",
        "/v1/tools/execute",
        "/mcp",
    ] {
        let client = reqwest::Client::new();
        let input = if path == "/v1/tools/search" {
            json!({"query":""})
        } else {
            json!({"handle":"invalid"})
        };
        let response = client
            .post(format!("{endpoint}{path}"))
            .json(&input)
            .send()
            .await?;
        assert_eq!(response.status().as_u16(), 401);
        let response = client
            .post(format!("{endpoint}{path}"))
            .header("Origin", "https://example.invalid")
            .json(&input)
            .send()
            .await?;
        assert_eq!(response.status().as_u16(), 403);
    }
    let mut failures = Vec::new();
    for agent in std::env::var("JACKALOPE_MCP_TRIAL_AGENTS")
        .unwrap_or("codex,grok".into())
        .split(',')
    {
        let id = uuid::Uuid::new_v4().to_string();
        let transport = if ["grok", "antigravity"].contains(&agent) {
            "Use the authenticated HTTP bridge described below: POST /v1/tools/search, then POST /v1/tools/read. HTTP is explicitly authorized for this local echo verification. This adapter does not receive the selected connection through native MCP; do not search its other MCP servers."
        } else {
            "Use native MCP search_tools and read_tool. Do not use shell HTTP."
        };
        let mut prompt = format!("Verify Jackalope's selected local MCP connection. {transport} Search for jackalope_echo, then call the returned read operation with value jackalope-native-trial. Do not inspect files or use other connections. Do not bypass any denied permission. Report the actual tool response, or report the permission or connection failure.");
        if agent == "antigravity" {
            prompt.push_str(" Also verify the local Jackalope harness with authenticated HTTP: GET /v1/project; POST /v1/messages with kind progress and text antigravity-bridge-trial; POST /v1/user-prompt with question 'Confirm this automated fixture' and input_type text. A test harness will answer automatically. If pending, GET /v1/user-prompt/poll?id=<returned-question-id> until answered. Include the exact answer in your final response. POST /v1/validation-step with step 'Antigravity bridge round trip', status passed and notes describing the actual echo and answer. Use these HTTP endpoints, not your built-in ask_question tool. This is an authorized local fixture; never print the bearer token.");
        }
        let request: RunRequest = serde_json::from_value(
            json!({"id":id,"projectId":project,"projectName":"MCP verification","projectPath":repo,"agent":agent,"isolated":false,"connectionIds":["trial"],"prompt":prompt}),
        )?;
        if let Err(error) = coordinator.start_manual(request) {
            failures.push(format!("{agent}: {error}"));
            continue;
        }
        let started = Instant::now();
        loop {
            let run = runtime
                .integration_runs()?
                .into_iter()
                .find(|run| run.id == id)
                .ok_or("Missing attempt")?;
            if agent == "antigravity" {
                for question in run
                    .prompts
                    .iter()
                    .filter(|question| question.status == "pending")
                {
                    runtime.respond_prompt(&run.id, &question.id, "fixture-ack-731")?;
                }
            }
            if !["starting", "running", "stopping"].contains(&run.status.as_str()) {
                println!(
                    "{agent}: status={}, MCP={:?}, result={}",
                    run.status, run.mcp_usage, run.result
                );
                if run.status != "review"
                    || run
                        .mcp_usage
                        .as_ref()
                        .is_none_or(|usage| usage.calls == 0 || usage.failures > 0)
                {
                    failures.push(format!(
                        "{agent}: no successful broker call; inspect {}",
                        profile.display()
                    ));
                }
                if agent == "antigravity"
                    && (!run.result.contains("fixture-ack-731")
                        || !run
                            .prompts
                            .iter()
                            .any(|question| question.answer.as_deref() == Some("fixture-ack-731"))
                        || !run
                            .validation_steps
                            .iter()
                            .any(|step| step.status == "passed")
                        || !coordinator
                            .view()?
                            .messages
                            .iter()
                            .any(|message| message.text.contains("antigravity-bridge-trial")))
                {
                    failures.push("Antigravity did not complete the question, validation and messaging round trip".into());
                }
                break;
            }
            if started.elapsed() > Duration::from_secs(150) {
                runtime.stop_all();
                failures.push(format!("{agent}: timed out"));
                break;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }
    runtime.stop_all();
    coordinator.shutdown();
    mcp_delete_server("trial".into(), scope).await?;
    if !failures.is_empty() {
        return Err(failures.join("; ").into());
    }
    println!(
        "Native runtime verification passed. Profile: {}",
        profile.display()
    );
    Ok(())
}

#[tokio::test]
#[ignore = "Runs installed agents using their existing sign-ins against a disposable repository and local fixture"]
async fn installed_agents_use_native_discovery() {
    trial().await.unwrap();
}
