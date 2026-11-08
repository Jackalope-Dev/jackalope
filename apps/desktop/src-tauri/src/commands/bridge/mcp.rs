//! The bridge as an MCP server at `/mcp`.

use super::{
    listed, result_queries, run, tools, update_text, updates, Args, Reply, Surface, ToolError,
    Transport,
};
use crate::commands::coordination::Coordinator;
use axum::{
    extract::{Request, State},
    http::{request::Parts, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::Response,
    Router,
};
use rmcp::{
    handler::server::{
        router::tool::{ToolRoute, ToolRouter},
        tool::ToolCallContext,
    },
    model::{CallToolResponse, ContentBlock},
    service::RequestContext,
    tool_handler,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    ErrorData, RoleServer, ServerHandler,
};
use std::{future::Future, pin::Pin};

const NAME: &str = "jackalope";
const VERSION: &str = "0.1.0";
const INSTRUCTIONS: &str = "Use supplied launch context. Refresh project for shared-interface changes, scope uncertainty or new coordination needs. Use harness tools for relevant evidence, user questions and final verification.";

#[derive(Clone)]
struct Server {
    service: Coordinator,
    tools: ToolRouter<Server>,
}

/// The MCP routes of every tool this platform supports.
fn tool_router() -> ToolRouter<Server> {
    let mut router = ToolRouter::new();
    for tool in tools().iter().filter(|tool| tool.supported()) {
        router.add_route(ToolRoute::new_dyn(tool.mcp(), call));
    }
    router
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

type Called<'a> = Pin<Box<dyn Future<Output = Result<CallToolResponse, ErrorData>> + Send + 'a>>;

fn call(context: ToolCallContext<'_, Server>) -> Called<'_> {
    let service = context.service.service.clone();
    let name = context.name.to_string();
    let arguments = context.arguments.unwrap_or_default();
    let request = context.request_context;
    Box::pin(async move {
        let tool =
            super::find(&name).ok_or_else(|| ErrorData::invalid_params("tool not found", None))?;
        let headers = request_headers(&request)?;
        let args = Args::Json(serde_json::Value::Object(arguments));
        let mut result = match run(tool, &service, &headers, Transport::Mcp, args).await {
            Ok(Reply::ListChanged(value)) => {
                request
                    .peer
                    .notify_tool_list_changed()
                    .await
                    .map_err(|error| ErrorData::internal_error(error.to_string(), None))?;
                Reply::ListChanged(value).into_mcp()
            }
            Ok(reply) => reply.into_mcp(),
            Err(error) => error.into_mcp()?,
        };
        if let Some(update) = (!tool.client)
            .then(|| updates(&service, &headers))
            .flatten()
        {
            result
                .content
                .push(ContentBlock::text(update_text(&update)));
        }
        Ok(result.into())
    })
}

#[tool_handler(router = self.tools)]
impl ServerHandler for Server {
    fn supported_protocol_versions(
        &self,
    ) -> std::borrow::Cow<'static, [rmcp::model::ProtocolVersion]> {
        if Surface::configured() == Surface::Deferred {
            // Deferred discovery uses legacy in-stream notifications, not subscriptions/listen.
            return std::borrow::Cow::Owned(
                rmcp::model::ProtocolVersion::KNOWN_VERSIONS
                    .iter()
                    .filter(|version| **version < rmcp::model::ProtocolVersion::V_2026_07_28)
                    .cloned()
                    .collect(),
            );
        }
        std::borrow::Cow::Borrowed(rmcp::model::ProtocolVersion::KNOWN_VERSIONS)
    }

    fn get_info(&self) -> rmcp::model::ServerConfig {
        let mut capabilities = rmcp::model::ServerCapabilities::builder()
            .enable_tools()
            .build();
        if Surface::configured() == Surface::Deferred {
            capabilities.tools.as_mut().unwrap().list_changed = Some(true);
        }
        rmcp::model::ServerConfig::new(capabilities)
            .with_server_info(rmcp::model::Implementation::new(NAME, VERSION))
            .with_instructions(INSTRUCTIONS)
    }

    async fn list_tools(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<rmcp::model::ListToolsResult, ErrorData> {
        let headers = request_headers(&context)?;
        let caller = self
            .service
            .caller(&headers)
            .map_err(|status| ToolError::from(status).into_error_data())?;
        let queries = result_queries();
        let mut tools: Vec<_> = listed(&self.service, &caller.run)
            .into_iter()
            .map(|tool| presented(tool.mcp(), queries))
            .collect();
        tools.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(rmcp::model::ListToolsResult {
            result_type: Some(rmcp::model::ResultType::COMPLETE),
            tools,
            meta: None,
            next_cursor: None,
            ttl_ms: Some(0),
            cache_scope: Some(rmcp::model::CacheScope::Private),
        })
    }
}

/// A tool as the result-queries experiment presents it: without it, row
/// selection is left out of the connection tools' schemas.
fn presented(mut tool: rmcp::model::Tool, queries: bool) -> rmcp::model::Tool {
    if !queries && matches!(tool.name.as_ref(), "read_tool" | "execute_tool") {
        let mut schema = serde_json::Value::Object((*tool.input_schema).clone());
        omit_row_schema(&mut schema);
        if let serde_json::Value::Object(schema) = schema {
            tool.input_schema = std::sync::Arc::new(schema);
        }
    }
    if tool.name == "read_tool_result" {
        if queries {
            tool.description = Some("Query captured JSON without reexecuting the remote tool: {resultHandle,output:{rows:{pointer:'/structuredContent/items',whereEquals:{'/status':'open'},columns:['/id']}}}. Row paths are relative RFC 6901 pointers. Repeat output.rows.offset with selected.nextOffset for more complete JSON rows. Missing paths produce an error; never infer omitted data. Without output, reads original JSON by character offset/limit. Handles last for this attempt and its latest sixteen selected results.".into());
        } else {
            let mut schema = (*tool.input_schema).clone();
            if let Some(properties) = schema
                .get_mut("properties")
                .and_then(serde_json::Value::as_object_mut)
            {
                properties.remove("output");
            }
            schema.remove("$defs");
            tool.input_schema = std::sync::Arc::new(schema);
        }
    }
    tool
}

fn omit_row_schema(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(object) => {
            if let Some(properties) = object
                .get_mut("properties")
                .and_then(serde_json::Value::as_object_mut)
            {
                if properties.contains_key("jsonPointers") {
                    properties.remove("rows");
                }
            }
            if let Some(definitions) = object
                .get_mut("$defs")
                .and_then(serde_json::Value::as_object_mut)
            {
                definitions.remove("Rows");
            }
            for child in object.values_mut() {
                omit_row_schema(child);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                omit_row_schema(item);
            }
        }
        _ => {}
    }
}

async fn authorize(
    State(service): State<Coordinator>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    service.caller(request.headers())?;
    Ok(next.run(request).await)
}

pub(super) fn router(service: Coordinator) -> Router {
    let mut config = StreamableHttpServerConfig::default();
    config.legacy_session_mode = false;
    // A deferred surface announces tool-list changes, which need an event stream.
    config.json_response = Surface::configured() != Surface::Deferred;
    config.max_request_body_bytes = 65_536;
    let worker = service.clone();
    let tools = tool_router();
    let transport: StreamableHttpService<Server, LocalSessionManager> = StreamableHttpService::new(
        move || {
            Ok(Server {
                service: worker.clone(),
                tools: tools.clone(),
            })
        },
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
    fn ordinary_read_schemas_omit_experimental_row_fields_and_references() {
        for tool in tool_router()
            .list_all()
            .into_iter()
            .filter(|tool| matches!(tool.name.as_ref(), "read_tool" | "execute_tool"))
        {
            assert!(serde_json::to_value(&tool.input_schema)
                .unwrap()
                .to_string()
                .contains("#/$defs/Rows"));
            let schema = serde_json::to_value(&presented(tool, false).input_schema)
                .unwrap()
                .to_string();
            assert!(!schema.contains("#/$defs/Rows"));
            assert!(!schema.contains("\"rows\""));
            assert!(schema.contains("jsonPointers"));
        }
    }

    #[test]
    fn the_router_serves_each_supported_tool_with_its_table_definition() {
        let router = tool_router();
        for tool in tools() {
            assert_eq!(
                router.has_route(tool.name),
                tool.supported(),
                "{}",
                tool.name
            );
        }
        let verify = router.get("computer_verify").unwrap();
        assert!(verify.input_schema.get("required").is_none_or(|required| {
            !required
                .as_array()
                .unwrap()
                .contains(&serde_json::json!("command"))
        }));
        for name in [
            "ask_user",
            "record_validation_step",
            "record_decision",
            "message",
            "acknowledge_message",
        ] {
            let annotations = router.get(name).unwrap().annotations.as_ref().unwrap();
            assert_eq!(annotations.destructive_hint, Some(false), "{name}");
            assert_eq!(annotations.open_world_hint, Some(false), "{name}");
        }
    }
}
