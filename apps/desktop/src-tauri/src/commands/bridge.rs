//! The bridge: every tool an attempt's agent can call, defined once.
//!
//! [`tools`] lists each tool with its name, input, description and hints, where
//! it executes ([`Placement`]), its HTTP route, the optional group a deferred
//! tool surface loads it with, who is offered it ([`Offer`]) and its handler.
//! The MCP server (`mcp`), the HTTP routes and help (`http`), the runner's
//! placement table (`computers::runner`), Codex's approval list and the
//! deferred surface's groups all read this table. A handler runs the same way
//! for both transports: [`run`] authorizes the request once, applies the
//! tool's call-time gate and hands the handler a [`Call`].

mod handlers;
mod http;
mod mcp;
mod permission;
mod table;
#[cfg(test)]
mod tests;

pub(in crate::commands) use http::help;
pub(crate) use http::{http_bootstrap, router};
pub(in crate::commands) use permission::{approve_computer_tool, approve_remote_execute};

use super::computers::runner::Placement;
use super::coordination::{Caller, Coordinator};
use super::experiments::{self, Experiment};
use super::tasks::{TaskRun, TaskRuntime};
use axum::http::{HeaderMap, StatusCode};
use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ContentBlock, JsonObject},
    schemars::JsonSchema,
    ErrorData,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::{
    borrow::Cow,
    collections::BTreeSet,
    future::Future,
    pin::Pin,
    sync::{Arc, OnceLock},
    time::Duration,
};

/// Every bridge tool, in the order the runner reports the tools it serves.
pub(crate) fn tools() -> &'static [Tool] {
    static TOOLS: OnceLock<Vec<Tool>> = OnceLock::new();
    TOOLS.get_or_init(table::tools)
}

pub(crate) fn find(name: &str) -> Option<&'static Tool> {
    tools().iter().find(|tool| tool.name == name)
}

/// One bridge tool.
pub(crate) struct Tool {
    pub name: &'static str,
    description: Cow<'static, str>,
    hints: Hints,
    pub placement: Placement,
    pub route: Option<Route>,
    /// The optional group a deferred tool surface loads the tool with.
    group: Option<Group>,
    offer: Offer,
    /// The tool's part of the HTTP contract in `GET /v1/help`.
    help: Option<Cow<'static, str>>,
    schema: Arc<JsonObject>,
    handler: Handler,
}

/// An HTTP route of a tool.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Route {
    /// Whether the input travels in the query string of a GET instead of a
    /// POST body.
    pub get: bool,
    pub path: &'static str,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Group {
    Browser,
    Desktop,
    Coordination,
}

impl Group {
    fn name(self) -> &'static str {
        match self {
            Group::Browser => "browser",
            Group::Desktop => "desktop",
            Group::Coordination => "coordination",
        }
    }
}

/// Which attempts a tool is offered to, beyond where its runner places it.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Offer {
    Always,
    /// Where desktop control works on this platform.
    Platform,
    /// Saved bots' conversations; refused to everyone else.
    Bots,
    /// Projects that allow agent questions to Jev.
    AgentQuestions,
    /// While the context-read experiment is on; refused otherwise.
    ContextRead,
    /// A deferred tool surface, which loads optional tools on request.
    Deferred,
    /// A trimmed surface lists it only when the attempt has connections to search.
    Connections,
    /// A trimmed surface lists it only when the attempt has a saved check.
    SavedCheck,
}

/// MCP tool annotations.
#[derive(Clone, Copy, Default)]
struct Hints {
    read_only: Option<bool>,
    destructive: Option<bool>,
    idempotent: Option<bool>,
    open_world: Option<bool>,
}

type Pending = Pin<Box<dyn Future<Output = Result<Reply, ToolError>> + Send>>;
type Handler = Box<dyn Fn(Call, Args) -> Pending + Send + Sync>;

impl Tool {
    /// A tool whose input is `I`.
    fn new<I, F, Fut, R>(
        name: &'static str,
        description: impl Into<Cow<'static, str>>,
        handler: F,
    ) -> Self
    where
        I: DeserializeOwned + JsonSchema + Send + 'static,
        F: Fn(Call, I) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<R, ToolError>> + Send + 'static,
        R: Into<Reply> + Send + 'static,
    {
        let schema = rmcp::handler::server::common::schema_for_input::<Parameters<I>>()
            .unwrap_or_else(|error| panic!("Invalid input schema for {name}: {error}"));
        let handler: Handler = Box::new(move |call: Call, args: Args| -> Pending {
            match args.parse::<I>() {
                Ok(input) => {
                    let pending = handler(call, input);
                    Box::pin(async move {
                        let reply: Result<Reply, ToolError> = pending.await.map(Into::into);
                        reply
                    })
                }
                Err(error) => Box::pin(std::future::ready(Err(ToolError::arguments(error)))),
            }
        });
        Self::with(name, description.into(), schema, handler)
    }

    /// A tool that takes no input.
    fn without_input<F, Fut, R>(
        name: &'static str,
        description: impl Into<Cow<'static, str>>,
        handler: F,
    ) -> Self
    where
        F: Fn(Call) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<R, ToolError>> + Send + 'static,
        R: Into<Reply> + Send + 'static,
    {
        let handler: Handler = Box::new(move |call: Call, _: Args| -> Pending {
            let pending = handler(call);
            Box::pin(async move {
                let reply: Result<Reply, ToolError> = pending.await.map(Into::into);
                reply
            })
        });
        Self::with(
            name,
            description.into(),
            rmcp::handler::server::common::schema_for_empty_input(),
            handler,
        )
    }

    fn with(
        name: &'static str,
        description: Cow<'static, str>,
        schema: Arc<JsonObject>,
        handler: Handler,
    ) -> Self {
        Self {
            name,
            description,
            hints: Hints::default(),
            placement: Placement::Control,
            route: None,
            group: None,
            offer: Offer::Always,
            help: None,
            schema,
            handler,
        }
    }

    fn read_only(mut self, value: bool) -> Self {
        self.hints.read_only = Some(value);
        self
    }

    fn destructive(mut self, value: bool) -> Self {
        self.hints.destructive = Some(value);
        self
    }

    fn idempotent(mut self, value: bool) -> Self {
        self.hints.idempotent = Some(value);
        self
    }

    fn open_world(mut self, value: bool) -> Self {
        self.hints.open_world = Some(value);
        self
    }

    fn placed(mut self, placement: Placement) -> Self {
        self.placement = placement;
        self
    }

    fn post(mut self, path: &'static str) -> Self {
        self.route = Some(Route { get: false, path });
        self
    }

    fn get(mut self, path: &'static str) -> Self {
        self.route = Some(Route { get: true, path });
        self
    }

    fn group(mut self, group: Group) -> Self {
        self.group = Some(group);
        self
    }

    fn offered(mut self, offer: Offer) -> Self {
        self.offer = offer;
        self
    }

    fn help(mut self, text: impl Into<Cow<'static, str>>) -> Self {
        self.help = Some(text.into());
        self
    }

    /// Whether the tool exists on this platform at all.
    fn supported(&self) -> bool {
        self.offer != Offer::Platform || super::desktop_control::platform::supported()
    }

    /// The MCP definition.
    fn mcp(&self) -> rmcp::model::Tool {
        let Hints {
            read_only,
            destructive,
            idempotent,
            open_world,
        } = self.hints;
        rmcp::model::Tool::new_with_raw(
            self.name,
            Some(self.description.clone()),
            self.schema.clone(),
        )
        .with_annotations(rmcp::model::ToolAnnotations::from_raw(
            None,
            read_only,
            destructive,
            idempotent,
            open_world,
        ))
    }

    /// Refuses a call the tool's offer does not allow, whatever the agent was listed.
    fn permits(&self, run: &TaskRun) -> Result<(), ToolError> {
        match self.offer {
            Offer::Bots if !is_bot(run) => Err(ToolError::status(
                StatusCode::FORBIDDEN,
                "Only saved bot conversations can use bot tools.",
            )),
            Offer::ContextRead if !context_read() => {
                Err(ToolError::refused("Source context reads are not enabled."))
            }
            _ => Ok(()),
        }
    }
}

/// Which transport a call arrived on.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Transport {
    Mcp,
    Http,
}

impl Transport {
    /// How long a question waits for an answer before it returns pending. An
    /// MCP client waits within its tool timeout. An HTTP agent calls from a
    /// shell command whose own timeout may be a few seconds, and a timed-out
    /// command is retried as a second question, so it gets the question back
    /// at once and polls `user_response`.
    fn question_wait(self) -> Duration {
        match self {
            Transport::Mcp => Duration::from_secs(60),
            Transport::Http => Duration::from_millis(50),
        }
    }
}

/// What a handler receives besides its input.
pub(crate) struct Call {
    pub service: Coordinator,
    pub caller: Caller,
    pub transport: Transport,
}

impl Call {
    pub fn run(&self) -> &TaskRun {
        &self.caller.run
    }

    pub fn runtime(&self) -> &TaskRuntime {
        &self.service.runtime
    }
}

/// A tool's arguments as they arrived.
pub(crate) enum Args {
    Json(Value),
    /// A GET route's query string.
    Query(axum::http::Uri),
}

impl Args {
    fn parse<I: DeserializeOwned>(self) -> Result<I, String> {
        match self {
            Args::Json(value) => serde_json::from_value(value).map_err(|error| error.to_string()),
            Args::Query(uri) => axum::extract::Query::<I>::try_from_uri(&uri)
                .map(|axum::extract::Query(input)| input)
                .map_err(|error| error.body_text()),
        }
    }
}

/// A tool's result.
pub(crate) enum Reply {
    Json(Value),
    /// An MCP result passed on as it is; over HTTP, its JSON form.
    Result(CallToolResult),
    /// Text an MCP client reads as the whole result.
    Text(String),
    /// A result after which the attempt's MCP tool list changed.
    ListChanged(Value),
}

impl From<Value> for Reply {
    fn from(value: Value) -> Self {
        Reply::Json(value)
    }
}

impl From<CallToolResult> for Reply {
    fn from(result: CallToolResult) -> Self {
        Reply::Result(result)
    }
}

impl Reply {
    fn into_json(self) -> Value {
        match self {
            Reply::Json(value) | Reply::ListChanged(value) => value,
            Reply::Result(result) => serde_json::to_value(result).unwrap_or(Value::Null),
            Reply::Text(text) => Value::String(text),
        }
    }

    fn into_mcp(self) -> CallToolResult {
        match self {
            Reply::Json(value) | Reply::ListChanged(value) => CallToolResult::structured(value),
            Reply::Result(result) => result,
            Reply::Text(text) => CallToolResult::success(vec![ContentBlock::text(text)]),
        }
    }
}

/// `value` as a tool result.
pub(crate) fn json(value: impl Serialize) -> Result<Value, ToolError> {
    serde_json::to_value(value).map_err(|error| ToolError::failed(error.to_string()))
}

/// Why a tool call failed, for both transports: an HTTP status and a JSON
/// `{"error"}` body, or an MCP error.
#[derive(Debug)]
pub(crate) struct ToolError {
    status: StatusCode,
    message: String,
    kind: ErrorKind,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum ErrorKind {
    /// The request cannot be done (MCP invalid request).
    Refused,
    /// The input is invalid (MCP invalid params).
    Invalid,
    /// The arguments do not match the tool's input.
    Arguments,
    /// Jackalope failed (MCP internal error).
    Failed,
    /// The person or a rule denied the call; MCP reports it as a tool error
    /// result the agent reads.
    Denied,
}

impl ToolError {
    pub fn refused(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message, ErrorKind::Refused)
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message, ErrorKind::Invalid)
    }

    pub fn failed(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            message,
            ErrorKind::Failed,
        )
    }

    pub fn denied(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, message, ErrorKind::Denied)
    }

    pub fn status(status: StatusCode, message: impl Into<String>) -> Self {
        let kind = if status.is_server_error() {
            ErrorKind::Failed
        } else {
            ErrorKind::Refused
        };
        Self::new(status, message, kind)
    }

    fn arguments(message: String) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message, ErrorKind::Arguments)
    }

    fn new(status: StatusCode, message: impl Into<String>, kind: ErrorKind) -> Self {
        Self {
            status,
            message: message.into(),
            kind,
        }
    }

    pub fn code(&self) -> StatusCode {
        self.status
    }

    pub fn message(&self) -> String {
        match self.kind {
            ErrorKind::Arguments => format!("Invalid arguments: {}", self.message),
            _ => self.message.clone(),
        }
    }

    /// The MCP form: a protocol error, or a tool error result for a denial.
    fn into_mcp(self) -> Result<CallToolResult, ErrorData> {
        match self.kind {
            ErrorKind::Denied => Ok(CallToolResult::error(vec![ContentBlock::text(
                self.message,
            )])),
            _ => Err(self.into_error_data()),
        }
    }

    fn into_error_data(self) -> ErrorData {
        match self.kind {
            ErrorKind::Refused | ErrorKind::Denied => {
                ErrorData::invalid_request(self.message, None)
            }
            ErrorKind::Invalid => ErrorData::invalid_params(self.message, None),
            // rmcp turns this prefix into a tool error result the model reads,
            // as it does for its own argument parsing.
            ErrorKind::Arguments => ErrorData::invalid_params(
                format!("failed to deserialize parameters: {}", self.message),
                None,
            ),
            ErrorKind::Failed => ErrorData::internal_error(self.message, None),
        }
    }
}

/// A bare status from authorization or the coordinator.
impl From<StatusCode> for ToolError {
    fn from(status: StatusCode) -> Self {
        let message = match status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                "This task no longer has access to the coordination bridge"
            }
            status if status.is_server_error() => {
                "The coordination bridge could not complete this request"
            }
            _ => "The coordination bridge could not accept this request",
        };
        Self::status(status, message)
    }
}

impl From<String> for ToolError {
    fn from(message: String) -> Self {
        Self::refused(message)
    }
}

/// Runs `tool` for the attempt `headers` authenticate.
async fn run(
    tool: &'static Tool,
    service: &Coordinator,
    headers: &HeaderMap,
    transport: Transport,
    args: Args,
) -> Result<Reply, ToolError> {
    let caller = service.caller(headers)?;
    tool.permits(&caller.run)?;
    let call = Call {
        service: service.clone(),
        caller,
        transport,
    };
    (tool.handler)(call, args).await
}

/// Runs the tool `name` as over HTTP, without delivering coordination updates.
#[cfg(test)]
pub(in crate::commands) async fn call(
    service: &Coordinator,
    headers: &HeaderMap,
    name: &str,
    input: Value,
) -> Result<Value, ToolError> {
    let tool = find(name).unwrap_or_else(|| panic!("{name} is not a bridge tool"));
    run(tool, service, headers, Transport::Http, Args::Json(input))
        .await
        .map(Reply::into_json)
}

/// Project updates for the attempt `headers` authenticate, delivered with a
/// successful result.
fn updates(service: &Coordinator, headers: &HeaderMap) -> Option<Value> {
    match service.checkpoint(headers) {
        Ok(update) => update,
        Err(_) => Some(
            json!({"notice":"Project updates are temporarily unavailable. Read inbox at your next checkpoint. Do not retry the completed tool operation to retrieve updates."}),
        ),
    }
}

fn update_text(update: &Value) -> String {
    format!("Jackalope coordinationUpdates: {update}")
}

/// Adds updates to an HTTP JSON result: to its `content` when it is an MCP
/// result, else as `coordinationUpdates`. Other values are left alone.
fn attach_updates(value: &mut Value, service: &Coordinator, headers: &HeaderMap) {
    if !value.is_object() {
        return;
    }
    let Some(update) = updates(service, headers) else {
        return;
    };
    if let Some(content) = value.get_mut("content").and_then(Value::as_array_mut) {
        content.push(json!({"type":"text","text":update_text(&update)}));
    } else if let Some(object) = value.as_object_mut() {
        object.insert("coordinationUpdates".into(), update);
    }
}

fn is_bot(run: &TaskRun) -> bool {
    super::bot_hub::installed().is_some_and(|hub| hub.is_bot_run(run))
}

fn context_read() -> bool {
    experiments::is(Experiment::ContextRead, "on")
}

fn result_queries() -> bool {
    experiments::is(Experiment::ResultQueries, "on")
}

fn lean(run: &TaskRun) -> bool {
    run.efficiency.execution_profile.as_deref() == Some("lean")
}

/// How much of the tool list an MCP client is shown.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Surface {
    Full,
    /// Operations the attempt cannot use are left out.
    Available,
    /// Optional tools are left out until `discover_harness_tools` loads them.
    Deferred,
}

impl Surface {
    /// The experiment's surface. A deferred surface relies on tool-list
    /// change notifications, which the bridge sends over an event stream.
    fn configured() -> Self {
        if experiments::is(Experiment::ToolSurface, "deferred") {
            Surface::Deferred
        } else if experiments::is(Experiment::ToolSurface, "available") {
            Surface::Available
        } else {
            Surface::Full
        }
    }

    /// The surface one attempt gets. Only OpenCode reloads its tool list when
    /// told it changed, so other agents keep every tool listed.
    fn of(run: &TaskRun) -> Self {
        let adapter = run
            .account_binding
            .as_ref()
            .map_or(run.agent.as_str(), |binding| binding.adapter.as_str());
        let configured = Self::configured();
        if configured == Surface::Deferred && adapter == "opencode" && lean(run) {
            Surface::Deferred
        } else if configured == Surface::Available || lean(run) {
            Surface::Available
        } else {
            Surface::Full
        }
    }
}

/// The tools an attempt's MCP tool list shows.
fn listed(service: &Coordinator, run: &TaskRun) -> Vec<&'static Tool> {
    let access = super::computers::runner::for_run(&run.id);
    let surface = Surface::of(run);
    let trimmed = surface != Surface::Full;
    let check = run
        .verify_command
        .as_deref()
        .is_some_and(|command| !command.trim().is_empty());
    tools()
        .iter()
        .filter(|tool| tool.supported() && !access.tool_unavailable(tool.name))
        .filter(|tool| match tool.offer {
            Offer::Always | Offer::Platform => true,
            Offer::Bots => is_bot(run),
            Offer::AgentQuestions => {
                super::decisions::agent_questions::available(&service.runtime, &run.project_id)
            }
            Offer::ContextRead => context_read(),
            Offer::Deferred => surface == Surface::Deferred,
            Offer::Connections => !trimmed || service.runtime.mcp_broker.has_attempt(&run.id),
            Offer::SavedCheck => !trimmed || check,
        })
        .filter(|tool| {
            surface != Surface::Deferred
                || tool.group.is_none()
                || run.efficiency.discovered_harness_tools.contains(tool.name)
        })
        .collect()
}

/// The optional tools `names` asks for, by tool or group name; empty asks for all.
fn requested(names: &[String]) -> Result<BTreeSet<String>, &'static str> {
    let optional = || tools().iter().filter_map(|tool| Some((tool, tool.group?)));
    if names
        .iter()
        .any(|name| !optional().any(|(tool, group)| name == tool.name || name == group.name()))
        || names.len() > optional().count()
    {
        return Err("Select optional tool names or browser, desktop and coordination groups.");
    }
    Ok(optional()
        .filter(|(tool, group)| {
            names.is_empty()
                || names
                    .iter()
                    .any(|name| name == tool.name || name == group.name())
        })
        .map(|(tool, _)| tool.name.to_owned())
        .collect())
}

/// Codex approves each call of the tools that act on a browser or desktop.
pub(crate) fn codex_tool_policy() -> Value {
    Value::Object(
        tools()
            .iter()
            .filter(|tool| matches!(tool.group, Some(Group::Browser | Group::Desktop)))
            .map(|tool| (tool.name.into(), json!({"approval_mode":"approve"})))
            .collect(),
    )
}
