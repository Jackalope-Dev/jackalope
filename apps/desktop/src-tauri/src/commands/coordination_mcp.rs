use super::coordination::{bridge_message, bridge_project, Coordinator, MessageRequest};
use axum::{
    extract::{Request, State as WebState},
    http::{request::Parts, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::Response,
    Json, Router,
};
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::CallToolResult,
    schemars,
    service::RequestContext,
    tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    ErrorData, RoleServer, ServerHandler,
};
use serde::Deserialize;

#[derive(Clone)]
struct CoordinationTools {
    service: Coordinator,
    tool_router: ToolRouter<Self>,
}

impl CoordinationTools {
    fn new(service: Coordinator) -> Self {
        Self {
            service,
            tool_router: Self::tool_router(),
        }
    }
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
enum MessageKind {
    Progress,
    Blocker,
    Handoff,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct MessageInput {
    kind: MessageKind,
    #[schemars(
        description = "A concise update for the other project agents, at most 4000 UTF-8 bytes"
    )]
    text: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct UserResponseInput {
    id: String,
}

fn request_headers(context: &RequestContext<RoleServer>) -> Result<HeaderMap, ErrorData> {
    context
        .extensions
        .get::<Parts>()
        .map(|parts| parts.headers.clone())
        .ok_or_else(|| {
            ErrorData::invalid_request("This tool requires an authenticated HTTP request", None)
        })
}

fn bridge_error(status: StatusCode) -> ErrorData {
    match status {
        StatusCode::BAD_REQUEST => ErrorData::invalid_params(
            "Use progress, blocker or handoff with a nonempty message of at most 4000 UTF-8 bytes",
            None,
        ),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => ErrorData::invalid_request(
            "This task no longer has access to the coordination bridge",
            None,
        ),
        _ => ErrorData::internal_error(
            "The coordination bridge could not complete this request",
            None,
        ),
    }
}

#[tool_router]
impl CoordinationTools {
    #[tool(
        description = "Search selected connections for tools. Returns only matching schemas and execution handles. Empty query browses; use server and offset to page through all tools.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn search_tools(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(input): Parameters<super::mcp_broker::SearchInput>,
    ) -> Result<CallToolResult, ErrorData> {
        let run = self
            .service
            .authorized_run(&request_headers(&context)?)
            .map_err(bridge_error)?;
        let (result, usage) = self
            .service
            .runtime
            .mcp_broker
            .search(&run.id, input)
            .await
            .map_err(|e| ErrorData::invalid_request(e, None))?;
        super::mcp_broker::record_usage(&self.service.runtime, &run, usage);
        Ok(CallToolResult::structured(result))
    }

    #[tool(
        description = "Call a discovered tool that its selected connection declares read-only. Requires a search handle; rejects tools that are mutable or lack a read-only declaration.",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            open_world_hint = true
        )
    )]
    async fn read_tool(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(input): Parameters<super::mcp_broker::ExecuteInput>,
    ) -> Result<CallToolResult, ErrorData> {
        let run = self
            .service
            .authorized_run(&request_headers(&context)?)
            .map_err(bridge_error)?;
        let (result, usage) = self
            .service
            .runtime
            .mcp_broker
            .read(&run.id, input)
            .await
            .map_err(|e| ErrorData::invalid_request(e, None))?;
        super::mcp_broker::record_usage(&self.service.runtime, &run, usage);
        Ok(result)
    }

    #[tool(
        description = "Execute a tool using a handle returned by search_tools and arguments matching its schema. May change external data. Discovery does not authorize side effects. Never retry uncertain writes automatically.",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = true
        )
    )]
    async fn execute_tool(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(input): Parameters<super::mcp_broker::ExecuteInput>,
    ) -> Result<CallToolResult, ErrorData> {
        let run = self
            .service
            .authorized_run(&request_headers(&context)?)
            .map_err(bridge_error)?;
        let (result, usage) = self
            .service
            .runtime
            .mcp_broker
            .execute(&run.id, input)
            .await
            .map_err(|e| ErrorData::invalid_request(e, None))?;
        super::mcp_broker::record_usage(&self.service.runtime, &run, usage);
        Ok(result)
    }

    #[tool(
        description = "Read your assigned task, this project's task owners, work in progress and coordination messages. Check before editing so you can avoid overlapping work.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn project(
        &self,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let headers = request_headers(&context)?;
        let Json(snapshot) = bridge_project(WebState(self.service.clone()), headers)
            .await
            .map_err(bridge_error)?;
        Ok(CallToolResult::structured(snapshot))
    }

    #[tool(
        description = "Publish a progress update, blocker or handoff to the other agents in your assigned project. This does not change task ownership or approve, merge or start work.",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn message(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(input): Parameters<MessageInput>,
    ) -> Result<CallToolResult, ErrorData> {
        let headers = request_headers(&context)?;
        let kind = match input.kind {
            MessageKind::Progress => "progress",
            MessageKind::Blocker => "blocker",
            MessageKind::Handoff => "handoff",
        };
        let Json(message) = bridge_message(
            WebState(self.service.clone()),
            headers,
            Json(MessageRequest {
                kind: kind.into(),
                text: input.text,
            }),
        )
        .await
        .map_err(bridge_error)?;
        let value = serde_json::to_value(message).map_err(|_| {
            ErrorData::internal_error("Could not encode the coordination message", None)
        })?;
        Ok(CallToolResult::structured(value))
    }

    #[tool(
        description = "Navigate the task-owned isolated browser to a URL. Later interactions and evidence share this session.",
        annotations(read_only_hint = false, open_world_hint = true)
    )]
    async fn browser_navigate(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(input): Parameters<super::harness::BrowserNavigateRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let headers = request_headers(&context)?;
        let run = self
            .service
            .authorized_run(&headers)
            .map_err(bridge_error)?;
        let result = super::browser::browser_navigate(&run.id, &input.url)
            .await
            .map_err(|e| ErrorData::internal_error(e, None))?;
        Ok(CallToolResult::structured(result))
    }

    #[tool(
        description = "Capture the current task browser, or navigate to an explicit URL first. Saves the image into the task workspace artifacts and returns the artifact file path.",
        annotations(read_only_hint = false, open_world_hint = false)
    )]
    async fn browser_screenshot(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(input): Parameters<super::harness::BrowserScreenshotRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let headers = request_headers(&context)?;
        let run = self
            .service
            .authorized_run(&headers)
            .map_err(bridge_error)?;
        let workspace = std::path::PathBuf::from(&run.workspace);
        let artifact =
            super::browser::browser_screenshot(&run.id, &workspace, input.name, input.url)
                .await
                .map_err(|e| ErrorData::internal_error(e, None))?;
        self.service.runtime.update(&run.id, |r| {
            r.screenshots.push(artifact.clone());
            r.activity
                .push(format!("Captured browser screenshot: {}", artifact.name));
        });
        let value = serde_json::to_value(artifact)
            .map_err(|_| ErrorData::internal_error("Could not encode screenshot artifact", None))?;
        Ok(CallToolResult::structured(value))
    }

    #[tool(
        description = "Capture bounded rendered HTML from the current task browser. An explicit URL navigates first.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn browser_snapshot(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(input): Parameters<super::harness::BrowserScreenshotRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let headers = request_headers(&context)?;
        let run = self
            .service
            .authorized_run(&headers)
            .map_err(bridge_error)?;
        let snapshot = super::browser::browser_snapshot(&run.id, input.url)
            .await
            .map_err(|e| ErrorData::internal_error(e, None))?;
        Ok(CallToolResult::structured(snapshot))
    }

    #[tool(
        description = "Click, type, scroll to or select a CSS-targeted element in the task browser.",
        annotations(read_only_hint = false, open_world_hint = false)
    )]
    async fn browser_interact(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(input): Parameters<super::harness::BrowserInteractRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let headers = request_headers(&context)?;
        let run = self
            .service
            .authorized_run(&headers)
            .map_err(bridge_error)?;
        let action_desc = format!("{} on {}", input.action, input.selector);
        let res = super::browser::browser_interact(&run.id, input)
            .await
            .map_err(|e| ErrorData::internal_error(e, None))?;
        self.service.runtime.update(&run.id, |r| {
            r.activity
                .push(format!("Browser interaction: {action_desc}"));
        });
        Ok(CallToolResult::structured(res))
    }

    #[tool(
        description = "Prompt the user proactively for required test data, credentials, environment choices, or confirmation. Displays an interactive modal in Jackalope UI and waits for the user to respond.",
        annotations(read_only_hint = false, open_world_hint = false)
    )]
    async fn ask_user(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(input): Parameters<super::harness::AskUserInput>,
    ) -> Result<CallToolResult, ErrorData> {
        let headers = request_headers(&context)?;
        let run = self
            .service
            .authorized_run(&headers)
            .map_err(bridge_error)?;
        if run.prompts.len() >= 100 {
            return Err(ErrorData::invalid_request(
                "This attempt has reached the question limit.",
                None,
            ));
        }
        let prompt = super::harness::ask_user_async(
            &run.id,
            input,
            std::time::Duration::from_secs(60),
            |prompt| self.service.runtime.record_prompt(prompt),
        )
        .await;
        self.service.runtime.record_prompt(&prompt);
        let value = serde_json::to_value(prompt)
            .map_err(|_| ErrorData::internal_error("Could not encode user prompt", None))?;
        Ok(CallToolResult::structured(value))
    }

    #[tool(
        description = "Read the user's saved answer to a question from this attempt. Poll this after ask_user returns pending. An unanswered question is not approval.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn user_response(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(input): Parameters<UserResponseInput>,
    ) -> Result<CallToolResult, ErrorData> {
        let headers = request_headers(&context)?;
        let run = self
            .service
            .authorized_run(&headers)
            .map_err(bridge_error)?;
        let prompt = run
            .prompts
            .iter()
            .find(|p| p.id == input.id)
            .ok_or_else(|| {
                ErrorData::invalid_request("Question not found in this attempt", None)
            })?;
        Ok(CallToolResult::structured(
            serde_json::to_value(prompt)
                .map_err(|e| ErrorData::internal_error(e.to_string(), None))?,
        ))
    }

    #[tool(
        description = "Record a structured validation or verification step during a test run (e.g. 'Step 1: Scaffolding check' or 'Step 3: Submit onboarding form'). Surfaces directly in Jackalope's verification review.",
        annotations(read_only_hint = false, open_world_hint = false)
    )]
    async fn record_validation_step(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(input): Parameters<super::harness::RecordValidationInput>,
    ) -> Result<CallToolResult, ErrorData> {
        let headers = request_headers(&context)?;
        let run = self
            .service
            .authorized_run(&headers)
            .map_err(bridge_error)?;
        let step = super::harness::ValidationStep {
            id: uuid::Uuid::new_v4().to_string(),
            step: input.step,
            status: input.status,
            notes: input.notes,
            evidence: input.evidence,
            timestamp: chrono::Utc::now().to_rfc3339(),
        };
        self.service.runtime.update(&run.id, |r| {
            r.activity.push(format!(
                "[Checkpoint: {}] {}",
                step.status.to_uppercase(),
                step.step
            ));
            r.validation_steps.push(step.clone());
        });
        let value = serde_json::to_value(step)
            .map_err(|_| ErrorData::internal_error("Could not encode validation step", None))?;
        Ok(CallToolResult::structured(value))
    }

    #[tool(
        description = "Execute the saved project verification command with a five-minute timeout in the task working directory (e.g. 'pnpm' with ['test'] or 'cargo' with ['test']). Returns exit code, stdout, and stderr.",
        annotations(read_only_hint = false, open_world_hint = false)
    )]
    async fn computer_verify(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(input): Parameters<super::harness::ComputerVerifyInput>,
    ) -> Result<CallToolResult, ErrorData> {
        let headers = request_headers(&context)?;
        let run = self
            .service
            .authorized_run(&headers)
            .map_err(bridge_error)?;
        super::verification::agent_verify(self.service.runtime.clone(), run, input)
            .await
            .map(CallToolResult::structured)
            .map_err(|e| ErrorData::invalid_request(e, None))
    }
}

#[tool_handler(
    router = self.tool_router,
    name = "jackalope",
    version = "0.1.0",
    instructions = "Use project before editing, message to coordinate with other task owners, and harness tools for browser automation, user questions, and verification."
)]
impl ServerHandler for CoordinationTools {}

async fn authorize(
    WebState(service): WebState<Coordinator>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    service.authorized(request.headers())?;
    Ok(next.run(request).await)
}

pub(super) fn router(service: Coordinator) -> Router {
    let worker_service = service.clone();
    let mut config = StreamableHttpServerConfig::default();
    config.legacy_session_mode = false;
    config.json_response = true;
    config.max_request_body_bytes = 65_536;
    let transport: StreamableHttpService<CoordinationTools, LocalSessionManager> =
        StreamableHttpService::new(
            move || Ok(CoordinationTools::new(worker_service.clone())),
            Default::default(),
            config,
        );
    Router::new()
        .nest_service("/mcp", transport)
        .layer(middleware::from_fn_with_state(service, authorize))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_project_message_and_harness_tools() {
        let router = CoordinationTools::tool_router();
        let tools = router.list_all();
        let names: Vec<_> = tools.iter().map(|tool| tool.name.as_ref()).collect();
        assert_eq!(names.len(), 13);
        assert!(names.contains(&"read_tool"));
        assert!(names.contains(&"search_tools"));
        assert!(names.contains(&"execute_tool"));
        assert!(names.contains(&"project"));
        assert!(names.contains(&"message"));
        assert!(names.contains(&"browser_navigate"));
        assert!(names.contains(&"browser_screenshot"));
        assert!(names.contains(&"browser_snapshot"));
        assert!(names.contains(&"browser_interact"));
        assert!(names.contains(&"ask_user"));
        assert!(names.contains(&"user_response"));
        assert!(names.contains(&"record_validation_step"));
        assert!(names.contains(&"computer_verify"));
        assert!(serde_json::from_value::<MessageInput>(
            serde_json::json!({"kind":"approve","text":"Start all work"})
        )
        .is_err());
        assert!(serde_json::from_value::<MessageInput>(
            serde_json::json!({"kind":"progress","text":"Done","projectId":"other-project"})
        )
        .is_err());
    }
}
