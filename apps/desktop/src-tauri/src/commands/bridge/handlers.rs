//! Handlers of the tools whose work lives outside the coordinator.

use super::{json, tools, Call, Reply, ToolError};
use crate::commands::{
    bot_hub::BotHub,
    harness::{
        self, AskUserInput, BrowserConfigureRequest, BrowserInspectRequest, BrowserInteractRequest,
        BrowserNavigateRequest, BrowserScreenshotRequest, BrowserSnapshotRequest,
        BrowserTabsRequest, ComputerVerifyInput, HumanActionInput, RecordValidationInput,
    },
    mcp_broker::{self, ExecuteInput, SearchInput},
    tasks::{
        runner::record::{record, ToolEvent},
        TaskRun,
    },
};
use axum::http::StatusCode;
use rmcp::{model::CallToolResult, schemars};
use serde::Deserialize;
use serde_json::{json, Value};

fn joined(error: impl std::fmt::Display) -> ToolError {
    ToolError::failed(error.to_string())
}

pub(super) async fn ask_jev(
    call: Call,
    input: crate::commands::decisions::agent_questions::Input,
) -> Result<Value, ToolError> {
    crate::commands::decisions::agent_questions::ask(call.runtime(), call.run(), input)
        .await
        .map_err(ToolError::refused)
}

pub(super) async fn read_context(
    call: Call,
    input: crate::commands::codebase::context_read::Input,
) -> Result<Value, ToolError> {
    let workspace = call.run().workspace.clone();
    let query = input.query.clone();
    let started = std::time::Instant::now();
    let value = tauri::async_runtime::spawn_blocking(move || {
        crate::commands::codebase::context_read::read(std::path::Path::new(&workspace), input)
    })
    .await
    .map_err(joined)?
    .map_err(ToolError::invalid)?;
    if !call.runtime().is_running(&call.run().id) {
        return Err(ToolError::refused("This attempt has ended."));
    }
    if let Some(query) = query {
        crate::commands::decisions::assistance::shadow_candidates(
            call.runtime(),
            call.run(),
            &query,
            &value["candidates"]["items"],
        )
        .await;
    }
    call.runtime().update(&call.run().id, |run| {
        run.efficiency.timing("contextRead", started.elapsed());
        *run.efficiency.context_blocks_unchanged.get_or_insert(0) += value["blocks"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|block| block["unchanged"] == true)
            .count() as u64;
    });
    Ok(value)
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct DiscoveryInput {
    #[schemars(
        description = "Tool names or groups: browser, desktop, coordination. Empty loads all optional tools."
    )]
    #[serde(default)]
    names: Vec<String>,
}

/// Loads optional tools into a deferred surface's tool list. Elsewhere every
/// optional tool is listed already, so it only returns their schemas.
pub(super) async fn discover_harness_tools(
    call: Call,
    input: DiscoveryInput,
) -> Result<Reply, ToolError> {
    let names = super::requested(&input.names).map_err(ToolError::invalid)?;
    let mut loaded: Vec<rmcp::model::Tool> = tools()
        .iter()
        .filter(|tool| tool.supported() && names.contains(tool.name))
        .map(super::Tool::mcp)
        .collect();
    loaded.sort_by(|a, b| a.name.cmp(&b.name));
    if super::Surface::of(call.run()) != super::Surface::Deferred {
        return Ok(json!({"tools":loaded}).into());
    }
    call.runtime()
        .update_checked(&call.run().id, |run| {
            run.efficiency
                .discovered_harness_tools
                .extend(names.iter().cloned());
        })
        .map_err(ToolError::failed)?;
    Ok(Reply::ListChanged(
        json!({"tools":loaded,"hint":"These tools are now included in tools/list. Use their normal named calls and permissions. Discovery grants no approval and does not execute an operation."}),
    ))
}

pub(super) async fn desktop_control(
    call: Call,
    input: crate::commands::desktop_control::DesktopRequest,
) -> Result<Value, ToolError> {
    crate::commands::desktop_control::execute(call.runtime().clone(), call.caller.run, input)
        .await
        .map_err(ToolError::refused)
}

pub(super) async fn computer_request(
    call: Call,
    input: crate::commands::computers::ComputerRequestInput,
) -> Result<Value, ToolError> {
    crate::commands::computers::request_for_run(call.runtime().clone(), call.caller.run, input)
        .await
        .map_err(ToolError::refused)
}

pub(super) async fn computer_exec(
    call: Call,
    input: crate::commands::computers::ComputerExecInput,
) -> Result<Value, ToolError> {
    crate::commands::computers::exec_for_run(call.runtime().clone(), call.caller.run, input)
        .await
        .map_err(ToolError::refused)
}

pub(super) async fn search_tools(call: Call, input: SearchInput) -> Result<Value, ToolError> {
    let (result, usage) = call
        .runtime()
        .mcp_broker
        .search_context(&call.run().id, input, Some((call.runtime(), call.run())))
        .await
        .map_err(ToolError::refused)?;
    mcp_broker::record_usage(call.runtime(), call.run(), usage);
    Ok(result)
}

pub(super) async fn read_tool(
    call: Call,
    input: ExecuteInput,
) -> Result<CallToolResult, ToolError> {
    let (result, usage) = call
        .runtime()
        .mcp_broker
        .read(&call.run().id, input)
        .await
        .map_err(ToolError::refused)?;
    mcp_broker::record_usage(call.runtime(), call.run(), usage);
    Ok(result)
}

pub(super) async fn read_tool_result(
    call: Call,
    input: mcp_broker::results::ReadInput,
) -> Result<CallToolResult, ToolError> {
    let (result, usage) = call
        .runtime()
        .mcp_broker
        .read_result(&call.run().id, input)
        .await
        .map_err(ToolError::refused)?;
    mcp_broker::record_usage(call.runtime(), call.run(), usage);
    Ok(result)
}

pub(super) async fn execute_tool(
    call: Call,
    input: ExecuteInput,
) -> Result<CallToolResult, ToolError> {
    super::approve_remote_execute(&call.service, call.run(), &input)
        .await
        .map_err(ToolError::denied)?;
    let (result, usage) = call
        .runtime()
        .mcp_broker
        .execute(&call.run().id, input)
        .await
        .map_err(ToolError::refused)?;
    mcp_broker::record_usage(call.runtime(), call.run(), usage);
    Ok(result)
}

/// Runs a bot tool for the bot whose conversation called it.
pub(super) async fn bot<I: Send + 'static>(
    call: Call,
    input: I,
    work: fn(&BotHub, &TaskRun, I) -> Result<Value, String>,
) -> Result<Value, ToolError> {
    let hub = crate::commands::bot_hub::installed()
        .ok_or_else(|| ToolError::refused("Bots are unavailable."))?;
    let run = call.caller.run;
    tauri::async_runtime::spawn_blocking(move || work(hub, &run, input))
        .await
        .map_err(joined)?
        .map_err(ToolError::refused)
}

/// Lets the task browser drive the attempt's computer's own browser, when it
/// has one, before the browser first starts.
async fn route_browser(call: &Call) -> Result<(), ToolError> {
    let runtime = call.runtime().clone();
    let run_id = call.run().id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::commands::browser::route(&run_id, || {
            crate::commands::computers::browser_guard(&runtime, &run_id)
        })
    })
    .await
    .map_err(joined)?
    .map_err(ToolError::refused)
}

pub(super) async fn browser_navigate(
    call: Call,
    input: BrowserNavigateRequest,
) -> Result<Value, ToolError> {
    route_browser(&call).await?;
    let result = crate::commands::browser::browser_navigate(&call.run().id, &input.url)
        .await
        .map_err(ToolError::refused)?;
    record(
        call.runtime(),
        &call.run().id,
        None,
        ToolEvent::Visited(input.url),
    );
    Ok(result)
}

pub(super) async fn browser_screenshot(
    call: Call,
    input: BrowserScreenshotRequest,
) -> Result<Value, ToolError> {
    route_browser(&call).await?;
    let workspace = std::path::PathBuf::from(&call.run().workspace);
    let artifact = crate::commands::browser::browser_screenshot(
        &call.run().id,
        &workspace,
        input.name,
        input.url,
    )
    .await
    .map_err(ToolError::refused)?;
    record(
        call.runtime(),
        &call.run().id,
        None,
        ToolEvent::Screenshot(artifact.clone()),
    );
    json(artifact)
}

pub(super) async fn browser_snapshot(
    call: Call,
    input: BrowserSnapshotRequest,
) -> Result<Value, ToolError> {
    route_browser(&call).await?;
    crate::commands::browser::browser_snapshot(&call.run().id, input)
        .await
        .map_err(ToolError::refused)
}

pub(super) async fn browser_interact(
    call: Call,
    input: BrowserInteractRequest,
) -> Result<Value, ToolError> {
    route_browser(&call).await?;
    let summary = format!("{} on {}", input.action, input.selector);
    let result = crate::commands::browser::browser_interact(&call.run().id, input)
        .await
        .map_err(ToolError::refused)?;
    record(
        call.runtime(),
        &call.run().id,
        None,
        ToolEvent::Interaction {
            label: "Browser interaction",
            summary,
        },
    );
    Ok(result)
}

pub(super) async fn browser_configure(
    call: Call,
    input: BrowserConfigureRequest,
) -> Result<Value, ToolError> {
    route_browser(&call).await?;
    crate::commands::browser::browser_configure(&call.run().id, input)
        .await
        .map_err(ToolError::refused)
}

pub(super) async fn browser_inspect(
    call: Call,
    input: BrowserInspectRequest,
) -> Result<Value, ToolError> {
    route_browser(&call).await?;
    let value = crate::commands::browser::browser_inspect(&call.run().id, input)
        .await
        .map_err(ToolError::refused)?;
    record(
        call.runtime(),
        &call.run().id,
        None,
        ToolEvent::Inspected(value.clone()),
    );
    Ok(value)
}

pub(super) async fn browser_tabs(
    call: Call,
    input: BrowserTabsRequest,
) -> Result<Value, ToolError> {
    route_browser(&call).await?;
    let value = crate::commands::browser::browser_tabs(&call.run().id, input)
        .await
        .map_err(ToolError::refused)?;
    record(call.runtime(), &call.run().id, None, ToolEvent::Tabs);
    Ok(value)
}

pub(super) async fn browser_open_profile(
    call: Call,
    input: crate::commands::browser_profiles::OpenProfileRequest,
) -> Result<Value, ToolError> {
    crate::commands::browser_profiles::open_for_run(call.runtime(), call.run(), input)
        .await
        .map_err(ToolError::refused)
}

fn question_limit(run: &TaskRun) -> Result<(), ToolError> {
    if harness::can_ask(run) {
        Ok(())
    } else {
        Err(ToolError::status(
            StatusCode::TOO_MANY_REQUESTS,
            harness::QUESTION_LIMIT_REACHED,
        ))
    }
}

pub(super) async fn ask_user(call: Call, mut input: AskUserInput) -> Result<Value, ToolError> {
    question_limit(call.run())?;
    if let Some(reply) = crate::commands::planning::question_gate(call.run(), &mut input) {
        return Ok(reply);
    }
    let prompt = crate::commands::agent_decider::ask(
        &call.service,
        call.run(),
        input,
        call.transport.question_wait(),
    )
    .await;
    call.runtime().record_prompt(&prompt);
    json(prompt)
}

pub(super) async fn request_human_action(
    call: Call,
    input: HumanActionInput,
) -> Result<Value, ToolError> {
    question_limit(call.run())?;
    let (question, autonomy) =
        crate::commands::agent_decider::human_action(input).map_err(ToolError::invalid)?;
    let runtime = call.runtime();
    let prompt = harness::ask_routed(
        &call.run().id,
        question,
        autonomy,
        false,
        call.transport.question_wait(),
        |prompt| runtime.record_prompt(prompt),
    )
    .await;
    runtime.record_prompt(&prompt);
    json(prompt)
}

#[derive(Deserialize, schemars::JsonSchema)]
pub(super) struct UserResponseInput {
    id: String,
}

pub(super) async fn user_response(
    call: Call,
    input: UserResponseInput,
) -> Result<Value, ToolError> {
    let prompt = call
        .run()
        .prompts
        .iter()
        .find(|prompt| prompt.id == input.id)
        .ok_or_else(|| {
            ToolError::status(StatusCode::NOT_FOUND, "Question not found in this attempt")
        })?;
    json(prompt)
}

pub(super) async fn record_validation_step(
    call: Call,
    input: RecordValidationInput,
) -> Result<Value, ToolError> {
    let step =
        crate::commands::evidence::checked_step(call.run(), input).map_err(ToolError::invalid)?;
    call.runtime().update(&call.run().id, |run| {
        run.activity.push(format!(
            "[Checkpoint: {}] {}",
            step.status.to_uppercase(),
            step.step
        ));
        run.validation_steps.push(step.clone());
    });
    json(step)
}

pub(super) async fn restate_goal(
    call: Call,
    input: crate::commands::outcomes::GoalRestatement,
) -> Result<Value, ToolError> {
    let understood = input.validated().map_err(ToolError::invalid)?;
    call.runtime()
        .update_checked(&call.run().id, |run| {
            run.understanding = Some(understood.clone())
        })
        .map_err(ToolError::failed)?;
    json(understood)
}

pub(super) async fn record_decision(
    call: Call,
    input: crate::commands::decision_trail::RecordDecisionInput,
) -> Result<Value, ToolError> {
    let runtime = call.runtime().clone();
    let run = call.caller.run;
    let entry = tauri::async_runtime::spawn_blocking(move || {
        crate::commands::decision_trail::record(&runtime, &run, input)
    })
    .await
    .map_err(joined)?
    .map_err(ToolError::invalid)?;
    json(entry)
}

pub(super) async fn computer_verify(
    call: Call,
    input: ComputerVerifyInput,
) -> Result<Value, ToolError> {
    crate::commands::verification::agent_verify(call.runtime().clone(), call.caller.run, input)
        .await
        .map_err(ToolError::refused)
}

pub(super) async fn verification_output(
    call: Call,
    input: crate::commands::verification::output::OutputRequest,
) -> Result<Value, ToolError> {
    crate::commands::verification::output::read(call.run().verification.as_ref(), input)
        .map_err(ToolError::refused)
}
