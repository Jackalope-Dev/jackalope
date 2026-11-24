//! The Jackalope bridge for agents on a computer.
//!
//! The bridge listens only on this device's loopback, so the in-sandbox agent
//! serves a stand-in on the computer's loopback and queues each request it
//! receives (see `resources/computer/agent.py`). A run's `run_read` hands those
//! requests over; [`Relay`] forwards each to the bridge with the run's own
//! credential on a thread of its own, so a long call such as `ask_user` never
//! stalls output, and the answers go back through `run_answer`. The credential
//! stays on this device: the computer only holds the stand-in's own secret.
//!
//! Only control-plane calls belong here. Where each tool runs follows its
//! placement in the bridge's tool table ([`crate::commands::bridge::tools`]),
//! resolved for a run by [`super::runner`]: a runner with the local bridge
//! answers workspace tools itself, so they never arrive; desktop control acts
//! on the run's own computer (see [`crate::commands::computers::for_run`]).
//! Tools that would act on this device's copy of the workspace or use its
//! sign-ins are refused when called, and so is a workspace tool that should
//! have run on the computer. The bridge leaves unavailable tools out of
//! `tools/list` itself, from the attempt's attached placement
//! ([`super::runner::attach`]).
//!
//! Model provider requests from a run that keeps its API key on this device
//! arrive the same way and go to [`super::provider_proxy`], whose answers come
//! back in pieces. A run may have the relay for those alone, without a bridge.

use super::protocol::protocol;
use super::provider_proxy::{self, Flow, Grant};
pub(crate) use super::runner::Access;
use super::runner::Where;
use base64::Engine;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        mpsc::{channel, Receiver, Sender},
        Arc,
    },
    time::Duration,
};

/// `relay.answerLimit` of the computer protocol, as a constant for limits derived from it.
pub(crate) const ANSWER_LIMIT: usize = 512 * 1024;
/// `relay.artifactLimit` of the computer protocol.
pub(crate) const LARGE_ANSWER_LIMIT: usize = 16 * 1024 * 1024;
/// Told to an agent whose answer is too large to relay. The call itself ran.
const ANSWER_TOO_LARGE: &str = "The answer is larger than 512 KB, so it cannot reach this computer. The call itself ran: do not repeat a change. Ask for less, for example with output.jsonPointers, output.rows or output.maxChars, or page a captured result with read_tool_result.";

/// One answer to a bridge request.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Answer {
    pub call: String,
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
    /// Set for a streamed provider answer, which arrives in pieces.
    pub piece: Option<Piece>,
}

/// Where a piece of a streamed answer belongs.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Piece {
    /// Bytes of the answer before this piece; the runner appends each piece
    /// only at its offset, so one sent twice is harmless.
    pub offset: u64,
    pub last: bool,
    /// Provider response headers, sent with the first piece.
    pub headers: Vec<(String, String)>,
}

impl Answer {
    fn json(call: &str, status: u16, body: Value) -> Self {
        Self {
            call: call.into(),
            status,
            content_type: "application/json".into(),
            body: body.to_string().into_bytes(),
            piece: None,
        }
    }

    /// A refusal shaped for the caller: a tool error for an MCP tool call, a
    /// JSON-RPC error for other MCP requests, and an HTTP error otherwise.
    fn refused(call: &str, request: Option<&Value>, status: u16, message: &str) -> Self {
        match request.filter(|request| request["jsonrpc"] == "2.0" && !request["id"].is_null()) {
            Some(request) if request["method"] == "tools/call" => Self::json(
                call,
                200,
                json!({"jsonrpc":"2.0","id":request["id"],"result":{"content":[{"type":"text","text":message}],"isError":true}}),
            ),
            Some(request) => Self::json(
                call,
                200,
                json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":-32000,"message":message}}),
            ),
            None => Self::json(call, status, json!({ "error": message })),
        }
    }
}

/// Forwards one run's bridge requests and collects their answers.
pub(crate) struct Relay {
    endpoint: String,
    token: String,
    access: Access,
    answer_limit: usize,
    in_flight: HashSet<String>,
    ready: Vec<Answer>,
    sender: Sender<Answer>,
    receiver: Receiver<Answer>,
    /// The run's provider grant, when its API key stays on this device.
    proxy: Option<Arc<Grant>>,
    /// Provider calls still streaming, each with its flow (stop flag and bytes
    /// waiting for the runner). An
    /// entry leaves when its last piece is delivered or the call is abandoned,
    /// so there are never more than the calls in flight.
    streams: HashMap<String, Flow>,
}

impl Relay {
    pub fn new(endpoint: &str, token: &str, access: Access) -> Self {
        let (sender, receiver) = channel();
        Self {
            endpoint: endpoint.trim_end_matches('/').to_string(),
            token: token.to_string(),
            access,
            answer_limit: ANSWER_LIMIT,
            in_flight: HashSet::new(),
            ready: Vec::new(),
            sender,
            receiver,
            proxy: None,
            streams: HashMap::new(),
        }
    }

    /// A relay for a run without a bridge, which carries only provider requests.
    pub fn provider_only(access: Access) -> Self {
        Self::new("", "", access)
    }

    /// Forwards the run's provider requests with `grant`.
    pub fn with_provider_proxy(mut self, grant: Option<Arc<Grant>>) -> Self {
        self.proxy = grant;
        self
    }

    /// Whether a provider answer is streaming, so reads should come sooner.
    pub fn streaming(&self) -> bool {
        !self.streams.is_empty()
    }

    /// Accepts answers up to `limit` bytes, for a runner that receives those
    /// above [`ANSWER_LIMIT`] as artifacts.
    pub fn with_answer_limit(mut self, limit: usize) -> Self {
        self.answer_limit = limit;
        self
    }

    /// Starts forwarding requests from a read. A request already being
    /// forwarded, handed over again after a reconnect, is skipped.
    pub fn accept(&mut self, calls: &[Value]) {
        for call in calls {
            let Some(id) = call["id"].as_str().map(str::to_string) else {
                continue;
            };
            if !self.in_flight.insert(id.clone()) {
                continue;
            }
            if provider_proxy::is_provider_call(call) {
                self.accept_provider(id, call);
                continue;
            }
            if self.endpoint.is_empty() {
                self.ready.push(Answer::refused(
                    &id,
                    decoded_json(call).as_ref(),
                    404,
                    "Jackalope's tools are not available to this run.",
                ));
                continue;
            }
            if let Some(answer) = screen(&id, call, &self.access) {
                self.ready.push(answer);
                continue;
            }
            if self.in_flight.len() > protocol().relay.pending_limit {
                self.ready.push(Answer::refused(
                    &id,
                    decoded_json(call).as_ref(),
                    503,
                    "Too many Jackalope tool calls are running. Try again shortly.",
                ));
                continue;
            }
            let (endpoint, token, sender, limit) = (
                self.endpoint.clone(),
                self.token.clone(),
                self.sender.clone(),
                self.answer_limit,
            );
            let call = call.clone();
            std::thread::spawn(move || {
                let answer = super::remote::block(forward(&endpoint, &token, &id, &call, limit));
                let _ = sender.send(answer);
            });
        }
    }

    fn accept_provider(&mut self, id: String, call: &Value) {
        let Some(grant) = self.proxy.clone() else {
            self.ready.push(Answer::refused(
                &id,
                None,
                404,
                "This run reaches its provider directly, not through Jackalope.",
            ));
            return;
        };
        if self.in_flight.len() > protocol().relay.pending_limit {
            self.ready.push(Answer::refused(
                &id,
                None,
                503,
                "Too many requests are waiting for Jackalope. Try again shortly.",
            ));
            return;
        }
        if self.streams.len() >= provider_proxy::STREAMS {
            self.ready.push(Answer::refused(
                &id,
                None,
                429,
                "Too many requests to the provider are streaming for this run. Try again shortly.",
            ));
            return;
        }
        let flow = Flow::default();
        self.streams.insert(id.clone(), flow.clone());
        let (sender, call) = (self.sender.clone(), call.clone());
        std::thread::spawn(move || {
            super::remote::block(provider_proxy::forward(grant, id, call, sender, flow));
        });
    }

    /// Answers ready to send, with consecutive pieces of one stream joined.
    /// Pieces of an abandoned stream that were already on their way are
    /// dropped here.
    pub fn answers(&mut self) -> Vec<Answer> {
        while let Ok(answer) = self.receiver.try_recv() {
            if answer.piece.is_none() || self.streams.contains_key(&answer.call) {
                self.ready.push(answer);
            }
        }
        coalesce(
            std::mem::take(&mut self.ready),
            protocol().provider_proxy.piece_limit,
        )
    }

    /// Marks an answer delivered, or keeps it to send again. Answers not sent
    /// must be returned in the order [`Relay::answers`] gave them, so a
    /// stream's pieces stay in order.
    pub fn delivered(&mut self, answer: Answer, sent: bool) {
        if !sent {
            self.ready.push(answer);
            return;
        }
        if let (Some(_), Some(flow)) = (&answer.piece, self.streams.get(&answer.call)) {
            flow.delivered(answer.body.len());
        }
        if answer.piece.as_ref().map_or(true, |piece| piece.last) {
            self.in_flight.remove(&answer.call);
            self.streams.remove(&answer.call);
        }
    }

    /// Stops a stream whose agent is no longer waiting for it.
    pub fn abandon(&mut self, call: &str) {
        if let Some(flow) = self.streams.remove(call) {
            flow.stop();
        }
        self.ready.retain(|answer| answer.call != call);
        self.in_flight.remove(call);
    }
}

impl Drop for Relay {
    /// A run that ended stops its provider streams.
    fn drop(&mut self) {
        for flow in self.streams.values() {
            flow.stop();
        }
    }
}

/// Joins each piece to the earlier piece of the same stream it continues,
/// up to `limit` bytes, so a stream of small events costs fewer requests.
fn coalesce(answers: Vec<Answer>, limit: usize) -> Vec<Answer> {
    let mut joined: Vec<Answer> = Vec::with_capacity(answers.len());
    for answer in answers {
        if let Some(piece) = &answer.piece {
            let earlier = joined
                .iter_mut()
                .rev()
                .find(|earlier| earlier.call == answer.call);
            if let Some(Answer {
                body,
                piece: Some(previous),
                ..
            }) = earlier
            {
                if !previous.last
                    && previous.offset + body.len() as u64 == piece.offset
                    && body.len() + answer.body.len() <= limit
                {
                    body.extend_from_slice(&answer.body);
                    previous.last = piece.last;
                    continue;
                }
            }
        }
        joined.push(answer);
    }
    joined
}

fn decoded(call: &Value) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(call["body"].as_str().unwrap_or_default())
        .unwrap_or_default()
}

fn decoded_json(call: &Value) -> Option<Value> {
    serde_json::from_slice(&decoded(call)).ok()
}

/// Refuses requests that must not reach the bridge, before forwarding.
fn screen(id: &str, call: &Value, access: &Access) -> Option<Answer> {
    let method = call["method"].as_str().unwrap_or_default();
    let path = call["path"].as_str().unwrap_or_default();
    let body = decoded(call);
    let request: Option<Value> = serde_json::from_slice(&body).ok();
    let route = path.split('?').next().unwrap_or_default();
    if !["GET", "POST", "DELETE"].contains(&method)
        || path.contains("..")
        || !(route == "/mcp" || route.starts_with("/mcp/") || route.starts_with("/v1/"))
    {
        return Some(Answer::refused(
            id,
            None,
            404,
            "Not a Jackalope bridge route.",
        ));
    }
    if body.len() > protocol().relay.request_limit {
        return Some(Answer::refused(
            id,
            request.as_ref(),
            413,
            &protocol().relay.too_large,
        ));
    }
    let place = if route.starts_with("/mcp") {
        request
            .as_ref()
            .filter(|request| request["method"] == "tools/call")
            .and_then(|request| request["params"]["name"].as_str())
            .map_or(Where::Device, |name| access.tool(name))
    } else {
        access.route(route)
    };
    let message = match place {
        Where::Device => return None,
        Where::Unavailable => "This tool acts on the person's device or its copy of the workspace, so it is not available to an agent on a computer. Use your own shell and file tools.",
        // The computer's runner answers these itself; one arriving here would
        // act on this device's stale copy of the workspace.
        Where::Runner => "This tool runs on the computer itself, but the computer did not answer it. Call it again; if it keeps failing, use your own shell and file tools.",
    };
    Some(Answer::refused(id, request.as_ref(), 403, message))
}

async fn forward(endpoint: &str, token: &str, id: &str, call: &Value, limit: usize) -> Answer {
    let request = decoded_json(call);
    let failed = |message: &str| Answer::refused(id, request.as_ref(), 502, message);
    let method = match call["method"].as_str() {
        Some("GET") => reqwest::Method::GET,
        Some("DELETE") => reqwest::Method::DELETE,
        _ => reqwest::Method::POST,
    };
    let Ok(client) = crate::commands::http::client(Duration::from_secs(
        crate::commands::verification::BRIDGE_TIMEOUT_SECS + 60,
    )) else {
        return failed("Jackalope could not reach its bridge.");
    };
    let mut builder = client
        .request(
            method,
            format!("{endpoint}{}", call["path"].as_str().unwrap_or("/")),
        )
        .bearer_auth(token)
        .body(decoded(call));
    if let Some(headers) = call["headers"].as_object() {
        for (name, value) in headers {
            let name = name.to_ascii_lowercase();
            if let (true, Some(value)) = (protocol().relay.headers.contains(&name), value.as_str())
            {
                builder = builder.header(name, value);
            }
        }
    }
    let response = match builder.send().await {
        Ok(response) => response,
        Err(error) => {
            return failed(&format!(
                "Jackalope's bridge did not answer: {}",
                error.without_url()
            ))
        }
    };
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/json")
        .to_string();
    let body = match response.bytes().await {
        Ok(body) => body.to_vec(),
        Err(error) => {
            return failed(&format!(
                "Jackalope's bridge answer was cut off: {}",
                error.without_url()
            ))
        }
    };
    if body.len() > limit {
        return failed(&if limit == ANSWER_LIMIT {
            ANSWER_TOO_LARGE.to_string()
        } else {
            ANSWER_TOO_LARGE.replace("512 KB", &format!("{} MB", limit / (1024 * 1024)))
        });
    }
    Answer {
        call: id.into(),
        status,
        content_type,
        body,
        piece: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(method: &str, path: &str, body: &Value) -> Value {
        json!({
            "id": "0123456789abcdef0123",
            "method": method,
            "path": path,
            "headers": {"content-type": "application/json"},
            "body": base64::engine::general_purpose::STANDARD.encode(body.to_string()),
        })
    }

    fn access(devtools: bool, read_only: bool) -> Access {
        Access {
            runner: Default::default(),
            devtools,
            read_only,
        }
    }

    fn writer() -> Access {
        access(false, false)
    }

    fn tool_call(name: &str) -> Value {
        call(
            "POST",
            "/mcp",
            &json!({"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":name,"arguments":{}}}),
        )
    }

    #[test]
    fn device_tools_are_refused_as_tool_errors() {
        let answer = screen("c", &tool_call("browser_navigate"), &writer()).unwrap();
        assert_eq!(answer.status, 200);
        let body: Value = serde_json::from_slice(&answer.body).unwrap();
        assert_eq!(body["id"], 7);
        assert_eq!(body["result"]["isError"], true);
        let allowed = json!({"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"propose_subtask","arguments":{}}});
        assert!(screen("c", &call("POST", "/mcp", &allowed), &writer()).is_none());
        let list = json!({"jsonrpc":"2.0","id":9,"method":"tools/list"});
        assert!(screen("c", &call("POST", "/mcp", &list), &writer()).is_none());
        assert!(screen("c", &tool_call("desktop_control"), &writer()).is_none());
    }

    #[test]
    fn access_follows_the_computer_browser_and_read_only_attempts() {
        let everything = &access(true, true);
        for name in [
            "browser_navigate",
            "browser_tabs",
            "computer_verify",
            "read_context",
        ] {
            assert!(screen("c", &tool_call(name), &writer()).is_some(), "{name}");
            assert!(
                screen("c", &tool_call(name), everything).is_none(),
                "{name}"
            );
        }
        for name in ["browser_open_profile", "peer_adopt", "permission_prompt"] {
            assert!(
                screen("c", &tool_call(name), everything).is_some(),
                "{name}"
            );
        }
        let browser_only = &access(true, false);
        assert!(screen("c", &tool_call("browser_snapshot"), browser_only).is_none());
        assert!(screen("c", &tool_call("verification_output"), browser_only).is_some());
        for (path, open) in [
            ("/v1/browser/navigate", true),
            ("/v1/browser/profile", false),
            ("/v1/computer/verify", true),
            ("/v1/computer/output", true),
            ("/v1/peers/adopt", false),
            ("/v1/native/output", false),
            ("/v1/desktop/control", true),
        ] {
            assert_eq!(
                screen("c", &call("POST", path, &json!({})), everything).is_none(),
                open,
                "{path}"
            );
        }
        assert!(writer()
            .instructions()
            .contains("browser tools are not available"));
        assert!(everything.instructions().contains("own Chromium"));
        assert!(everything.instructions().contains("read-only workspace"));
    }

    #[test]
    fn a_runner_with_the_local_bridge_keeps_only_control_tools_here() {
        let current = Access {
            runner: super::super::runner::RunnerCapabilities::from_status(Some(&json!({
                "runs": 4,
                "capabilities": ["local-bridge", "browser", "workspace-tools", "policy-callbacks"],
            }))),
            devtools: false,
            read_only: false,
        };
        // Control tools, policy callbacks and runner events are forwarded.
        for name in [
            "ask_user",
            "message",
            "request_human_action",
            "execute_tool",
            "record_decision",
        ] {
            assert!(screen("c", &tool_call(name), &current).is_none(), "{name}");
        }
        for path in [
            "/v1/policy",
            "/v1/runner/event",
            "/v1/tools/approve",
            "/v1/human-action",
        ] {
            assert!(
                screen("c", &call("POST", path, &json!({})), &current).is_none(),
                "{path}"
            );
        }
        // Workspace tools are answered on the computer; one reaching this device is refused.
        for name in ["computer_verify", "browser_navigate", "read_context"] {
            let answer = screen("c", &tool_call(name), &current).unwrap();
            let body: Value = serde_json::from_slice(&answer.body).unwrap();
            let text = body["result"]["content"][0]["text"].as_str().unwrap();
            assert!(text.contains("runs on the computer"), "{text}");
        }
        assert_eq!(
            screen("c", &call("POST", "/v1/browser/tabs", &json!({})), &current)
                .unwrap()
                .status,
            403
        );
        // The tool list still offers them, since the computer serves them.
        assert_eq!(
            super::super::runner::offered(
                &current,
                ["browser_tabs", "computer_verify", "peer_adopt"]
            ),
            ["browser_tabs", "computer_verify"]
        );
    }

    #[test]
    fn device_routes_and_foreign_paths_are_refused() {
        for path in [
            "/v1/browser/navigate",
            "/v1/computer/verify",
            "/v1/peers/adopt",
        ] {
            assert_eq!(
                screen("c", &call("POST", path, &json!({})), &writer())
                    .unwrap()
                    .status,
                403
            );
        }
        for (method, path) in [
            ("POST", "/admin"),
            ("POST", "/v1/../x"),
            ("PUT", "/v1/messages"),
        ] {
            assert_eq!(
                screen("c", &call(method, path, &json!({})), &writer())
                    .unwrap()
                    .status,
                404
            );
        }
        assert!(screen("c", &call("POST", "/v1/subtasks", &json!({})), &writer()).is_none());
        // Approvals for tools of connections that run on the computer.
        assert!(screen(
            "c",
            &call("POST", "/v1/tools/approve", &json!({})),
            &writer()
        )
        .is_none());
        assert!(screen(
            "c",
            &call("GET", "/v1/messages?after=3", &json!({})),
            &writer()
        )
        .is_none());
        let large = json!({ "text": "x".repeat(protocol().relay.request_limit) });
        assert_eq!(
            screen("c", &call("POST", "/v1/messages", &large), &writer())
                .unwrap()
                .status,
            413
        );
    }

    #[test]
    fn oversized_calls_and_answers_are_clear_tool_errors() {
        use std::io::{BufRead, BufReader, Read, Write};
        let arguments =
            json!({"handle":"h","arguments":{"text":"x".repeat(protocol().relay.request_limit)}});
        let large = call(
            "POST",
            "/mcp",
            &json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"execute_tool","arguments":arguments}}),
        );
        let answer = screen("c", &large, &writer()).unwrap();
        assert_eq!(answer.status, 200);
        let body: Value = serde_json::from_slice(&answer.body).unwrap();
        assert_eq!(body["id"], 3);
        assert_eq!(body["result"]["isError"], true);
        let text = body["result"]["content"][0]["text"].as_str().unwrap();
        assert!(
            text.contains("64 KB") && text.contains("nothing ran"),
            "{text}"
        );

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for _ in 0..2 {
                let (stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line.trim().is_empty() {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse().unwrap();
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let reply = json!({"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"y".repeat(ANSWER_LIMIT)}]}}).to_string();
                let mut stream = stream;
                write!(
                    stream,
                    "HTTP/1.1 200 OK
content-type: application/json
content-length: {}
connection: close

{reply}",
                    reply.len()
                )
                .unwrap();
            }
        });
        let answer = |relay: Relay| {
            let mut relay = relay;
            relay.accept(&[call(
                "POST",
                "/mcp",
                &json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"read_tool","arguments":{"handle":"h"}}}),
            )]);
            let deadline = std::time::Instant::now() + Duration::from_secs(20);
            let mut answers = Vec::new();
            while answers.is_empty() && std::time::Instant::now() < deadline {
                answers = relay.answers();
                std::thread::sleep(Duration::from_millis(20));
            }
            assert_eq!(answers.len(), 1);
            answers.remove(0)
        };
        let refused = answer(Relay::new(&endpoint, "token", writer()));
        assert!(refused.body.len() < 4096);
        let body: Value = serde_json::from_slice(&refused.body).unwrap();
        assert_eq!(body["id"], 4);
        assert_eq!(body["result"]["isError"], true);
        let text = body["result"]["content"][0]["text"].as_str().unwrap();
        assert!(
            text.contains("512 KB") && text.contains("read_tool_result"),
            "{text}"
        );
        // A runner with artifacts receives the whole answer.
        let full =
            answer(Relay::new(&endpoint, "token", writer()).with_answer_limit(LARGE_ANSWER_LIMIT));
        server.join().unwrap();
        assert!(full.body.len() > ANSWER_LIMIT);
        let body: Value = serde_json::from_slice(&full.body).unwrap();
        assert!(body["result"]["isError"].is_null());
    }

    #[test]
    fn tool_lists_omit_unavailable_tools() {
        use super::super::runner::offered;
        let names = ["peers", "browser_tabs", "desktop_control", "ask_user"];
        assert_eq!(
            offered(&writer(), names),
            ["peers", "desktop_control", "ask_user"]
        );
        assert_eq!(offered(&access(true, false), names), names);
    }

    #[test]
    fn relay_forwards_with_the_run_credential_and_skips_repeats() {
        use std::io::{BufRead, BufReader, Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut headers = Vec::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line.trim().is_empty() {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
                headers.push(line.trim().to_string());
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let reply = r#"{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"peers"},{"name":"browser_tabs"}]}}"#;
            let mut stream = stream;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                reply.len()
            )
            .unwrap();
            (headers, body)
        });
        let mut relay = Relay::new(&endpoint, "real-token", writer());
        let list = call(
            "POST",
            "/mcp",
            &json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}),
        );
        relay.accept(&[list.clone()]);
        relay.accept(&[list]);
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        let mut answers = Vec::new();
        while answers.is_empty() && std::time::Instant::now() < deadline {
            answers = relay.answers();
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(answers.len(), 1);
        // The bridge's own answer is passed on as it is.
        let body: Value = serde_json::from_slice(&answers[0].body).unwrap();
        assert_eq!(body["result"]["tools"].as_array().unwrap().len(), 2);
        let (headers, body) = server.join().unwrap();
        assert!(headers
            .iter()
            .any(|h| h == "authorization: Bearer real-token"));
        assert!(headers
            .iter()
            .any(|h| h.starts_with("content-type: application/json")));
        assert_eq!(
            serde_json::from_slice::<Value>(&body).unwrap()["method"],
            "tools/list"
        );
        let answer = answers.pop().unwrap();
        relay.delivered(answer.clone(), false);
        assert_eq!(relay.answers(), [answer.clone()]);
        relay.delivered(answer, true);
        assert!(relay.in_flight.is_empty());
    }

    fn piece(call: &str, offset: u64, body: &[u8], last: bool) -> Answer {
        Answer {
            call: call.into(),
            status: 200,
            content_type: "text/event-stream".into(),
            body: body.to_vec(),
            piece: Some(Piece {
                offset,
                last,
                headers: Vec::new(),
            }),
        }
    }

    #[test]
    fn consecutive_pieces_of_a_stream_are_joined_up_to_the_limit() {
        let joined = coalesce(
            vec![
                piece("a", 0, b"", false),
                piece("a", 0, b"one", false),
                piece("b", 0, b"x", true),
                piece("a", 3, b"two", false),
                piece("a", 6, b"three", true),
            ],
            8,
        );
        let shape: Vec<(&str, u64, &[u8], bool)> = joined
            .iter()
            .map(|answer| {
                let piece = answer.piece.as_ref().unwrap();
                (
                    answer.call.as_str(),
                    piece.offset,
                    answer.body.as_slice(),
                    piece.last,
                )
            })
            .collect();
        assert_eq!(
            shape,
            [
                ("a", 0, b"onetwo".as_slice(), false),
                ("b", 0, b"x".as_slice(), true),
                ("a", 6, b"three".as_slice(), true),
            ]
        );
        // A gap is never closed by joining.
        let gap = coalesce(
            vec![piece("a", 0, b"ab", false), piece("a", 5, b"c", true)],
            64,
        );
        assert_eq!(gap.len(), 2);
    }

    #[test]
    fn abandoned_streams_stop_and_leave_nothing_behind() {
        let mut relay = Relay::provider_only(writer());
        let mut stops = Vec::new();
        for index in 0..500 {
            let call = format!("{index:020x}");
            let stop = Flow::default();
            relay.in_flight.insert(call.clone());
            relay.streams.insert(call.clone(), stop.clone());
            relay.sender.send(piece(&call, 0, b"early", false)).unwrap();
            relay.abandon(&call);
            // A piece already on its way when the agent hung up.
            relay.sender.send(piece(&call, 5, b"late", true)).unwrap();
            stops.push(stop);
        }
        assert!(stops.iter().all(Flow::stopped));
        assert!(relay.answers().is_empty());
        assert!(relay.streams.is_empty() && relay.in_flight.is_empty() && relay.ready.is_empty());
        assert!(!relay.streaming());

        // Delivering the last piece ends a stream; dropping the relay stops the rest.
        let stop = Flow::default();
        relay.in_flight.insert("live".into());
        relay.streams.insert("live".into(), stop.clone());
        relay.sender.send(piece("live", 0, b"a", false)).unwrap();
        let answers = relay.answers();
        assert_eq!(answers.len(), 1);
        relay.delivered(answers[0].clone(), true);
        assert!(relay.streaming());
        let other = Flow::default();
        relay.in_flight.insert("other".into());
        relay.streams.insert("other".into(), other.clone());
        relay.delivered(piece("live", 1, b"", true), true);
        assert!(!relay.streams.contains_key("live") && !relay.in_flight.contains("live"));
        assert!(!stop.stopped());
        drop(relay);
        assert!(other.stopped());
    }

    #[test]
    fn unsent_pieces_are_sent_again_in_order() {
        let mut relay = Relay::provider_only(writer());
        relay.in_flight.insert("s".into());
        relay.streams.insert("s".into(), Flow::default());
        relay.sender.send(piece("s", 0, b"ab", false)).unwrap();
        let first = relay.answers();
        relay.delivered(first[0].clone(), false);
        relay.sender.send(piece("s", 2, b"cd", true)).unwrap();
        let again = relay.answers();
        assert_eq!(again.len(), 1);
        assert_eq!(again[0].body, b"abcd");
        assert!(again[0].piece.as_ref().unwrap().last);
    }

    #[test]
    fn a_relay_without_a_bridge_carries_only_provider_requests() {
        let mut relay = Relay::provider_only(writer());
        relay.accept(&[tool_call("ask_user")]);
        let answers = relay.answers();
        assert_eq!(answers.len(), 1);
        let body: Value = serde_json::from_slice(&answers[0].body).unwrap();
        assert_eq!(body["result"]["isError"], true);
        let provider = json!({
            "id": "00112233445566778899",
            "method": "POST",
            "path": "/provider/anthropic/v1/messages",
            "headers": {},
            "body": "",
        });
        // Without a grant the provider request is refused, not forwarded.
        relay.accept(&[provider]);
        let answers = relay.answers();
        assert_eq!(answers.len(), 1);
        assert_eq!(answers[0].status, 404);
        assert!(!relay.streaming());
    }

    #[test]
    fn an_attempt_streams_a_bounded_number_of_provider_requests() {
        let grant = Arc::new(Grant::new(
            provider_proxy::Provider::Anthropic,
            "sk-ant-real-key-0123456789".into(),
            "http://127.0.0.1:9",
            Duration::from_secs(60),
        ));
        let mut relay = Relay::provider_only(writer()).with_provider_proxy(Some(grant));
        let request = |index: usize| {
            json!({
                "id": format!("{index:020x}"),
                "method": "POST",
                "path": "/provider/anthropic/v1/messages",
                "headers": {},
                "body": "",
            })
        };
        let calls: Vec<Value> = (0..provider_proxy::STREAMS + 1).map(request).collect();
        relay.accept(&calls);
        assert_eq!(relay.streams.len(), provider_proxy::STREAMS);
        // The one past the limit is refused at once, whole, without reaching the provider.
        let refused: Vec<&Answer> = relay.ready.iter().collect();
        assert_eq!(refused.len(), 1);
        assert_eq!(refused[0].status, 429);
        assert!(refused[0].piece.is_none());

        // Delivered pieces free their stream's buffer.
        let (call, flow) = relay
            .streams
            .iter()
            .next()
            .map(|(call, flow)| (call.clone(), flow.clone()))
            .unwrap();
        flow.held(10);
        relay.delivered(piece(&call, 0, b"0123", false), true);
        assert_eq!(flow.buffered(), 6);
        relay.delivered(piece(&call, 4, b"456789", false), true);
        assert_eq!(flow.buffered(), 0);
    }
}
