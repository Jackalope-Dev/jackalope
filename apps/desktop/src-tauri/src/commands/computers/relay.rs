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
//! Tools that act on this device's screen, browser or local copy of the
//! workspace would act on the wrong machine for an agent on a computer, so they
//! are left out of `tools/list` and refused when called.

use base64::Engine;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::mpsc::{channel, Receiver, Sender},
    time::Duration,
};

/// MCP tools an agent on a computer cannot use: they act on this device.
pub(crate) const UNAVAILABLE_TOOLS: &[&str] = &[
    "browser_navigate",
    "browser_screenshot",
    "browser_snapshot",
    "browser_interact",
    "browser_configure",
    "browser_inspect",
    "browser_tabs",
    "browser_open_profile",
    "desktop_control",
    "computer_verify",
    "verification_output",
    "read_context",
    "peer_adopt",
    "permission_prompt",
];
/// REST routes behind the same tools.
const UNAVAILABLE_ROUTES: &[&str] = &[
    "/v1/browser/",
    "/v1/desktop/",
    "/v1/computer/verify",
    "/v1/computer/output",
    "/v1/peers/adopt",
    "/v1/native/output",
];
const REQUEST_LIMIT: usize = 64 * 1024;
/// Raw bytes per answer, which keeps each `run_answer` under the agent's 1 MB body limit.
pub(crate) const ANSWER_LIMIT: usize = 512 * 1024;
/// Calls forwarded at once; more are refused until one finishes.
const IN_FLIGHT_LIMIT: usize = 32;
const FORWARDED_HEADERS: &[&str] = &[
    "content-type",
    "accept",
    "mcp-protocol-version",
    "mcp-session-id",
    "last-event-id",
];

/// What the agent's tools are told about where they run.
pub(crate) const INSTRUCTIONS: &str = "\nYou run on a separate computer, not on the person's device. Jackalope's coordination, question and planning tools work as usual. The browser, desktop control, computer_verify, verification_output, read_context and peer_adopt tools are not available there: use your own shell and file tools, and run checks in the shell.\n";

/// One answer to a bridge request.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Answer {
    pub call: String,
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
}

impl Answer {
    fn json(call: &str, status: u16, body: Value) -> Self {
        Self {
            call: call.into(),
            status,
            content_type: "application/json".into(),
            body: body.to_string().into_bytes(),
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
    in_flight: HashSet<String>,
    ready: Vec<Answer>,
    sender: Sender<Answer>,
    receiver: Receiver<Answer>,
}

impl Relay {
    pub fn new(endpoint: &str, token: &str) -> Self {
        let (sender, receiver) = channel();
        Self {
            endpoint: endpoint.trim_end_matches('/').to_string(),
            token: token.to_string(),
            in_flight: HashSet::new(),
            ready: Vec::new(),
            sender,
            receiver,
        }
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
            if let Some(answer) = screen(&id, call) {
                self.ready.push(answer);
                continue;
            }
            if self.in_flight.len() > IN_FLIGHT_LIMIT {
                self.ready.push(Answer::refused(
                    &id,
                    decoded_json(call).as_ref(),
                    503,
                    "Too many Jackalope tool calls are running. Try again shortly.",
                ));
                continue;
            }
            let (endpoint, token, sender) = (
                self.endpoint.clone(),
                self.token.clone(),
                self.sender.clone(),
            );
            let call = call.clone();
            std::thread::spawn(move || {
                let answer = super::remote::block(forward(&endpoint, &token, &id, &call));
                let _ = sender.send(answer);
            });
        }
    }

    /// Answers ready to send.
    pub fn answers(&mut self) -> Vec<Answer> {
        while let Ok(answer) = self.receiver.try_recv() {
            self.ready.push(answer);
        }
        std::mem::take(&mut self.ready)
    }

    /// Marks an answer delivered, or keeps it to send again.
    pub fn delivered(&mut self, answer: Answer, sent: bool) {
        if sent {
            self.in_flight.remove(&answer.call);
        } else {
            self.ready.push(answer);
        }
    }
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
fn screen(id: &str, call: &Value) -> Option<Answer> {
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
    if body.len() > REQUEST_LIMIT {
        return Some(Answer::refused(
            id,
            request.as_ref(),
            413,
            "Bridge requests are limited to 64 KB.",
        ));
    }
    let unavailable = if route.starts_with("/mcp") {
        request
            .as_ref()
            .filter(|request| request["method"] == "tools/call")
            .and_then(|request| request["params"]["name"].as_str())
            .is_some_and(|name| UNAVAILABLE_TOOLS.contains(&name))
    } else {
        UNAVAILABLE_ROUTES
            .iter()
            .any(|blocked| route.starts_with(blocked))
    };
    unavailable.then(|| {
        Answer::refused(
            id,
            request.as_ref(),
            403,
            "This tool acts on the person's device, so it is not available to an agent on a computer. Use your own shell and file tools.",
        )
    })
}

async fn forward(endpoint: &str, token: &str, id: &str, call: &Value) -> Answer {
    let request = decoded_json(call);
    let failed = |message: &str| Answer::refused(id, request.as_ref(), 502, message);
    let method = match call["method"].as_str() {
        Some("GET") => reqwest::Method::GET,
        Some("DELETE") => reqwest::Method::DELETE,
        _ => reqwest::Method::POST,
    };
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(
            crate::commands::verification::BRIDGE_TIMEOUT_SECS + 60,
        ))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    else {
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
            if let (true, Some(value)) =
                (FORWARDED_HEADERS.contains(&name.as_str()), value.as_str())
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
    let body = if request
        .as_ref()
        .is_some_and(|r| r["method"] == "tools/list")
    {
        without_unavailable_tools(&body, &content_type)
    } else {
        body
    };
    if body.len() > ANSWER_LIMIT {
        return failed(
            "The tool's answer is larger than 512 KB, so it cannot reach a computer. Ask for less.",
        );
    }
    Answer {
        call: id.into(),
        status,
        content_type,
        body,
    }
}

/// Removes unavailable tools from a `tools/list` answer, sent as JSON or as
/// server-sent events.
pub(crate) fn without_unavailable_tools(body: &[u8], content_type: &str) -> Vec<u8> {
    let filter = |text: &str| -> Option<String> {
        let mut message: Value = serde_json::from_str(text).ok()?;
        let tools = message["result"]["tools"].as_array_mut()?;
        tools.retain(|tool| {
            !tool["name"]
                .as_str()
                .is_some_and(|name| UNAVAILABLE_TOOLS.contains(&name))
        });
        Some(message.to_string())
    };
    let Ok(text) = std::str::from_utf8(body) else {
        return body.to_vec();
    };
    if content_type.starts_with("text/event-stream") {
        let mut lines = Vec::new();
        for line in text.split('\n') {
            match line
                .strip_prefix("data:")
                .and_then(|data| filter(data.trim()))
            {
                Some(filtered) => lines.push(format!("data: {filtered}")),
                None => lines.push(line.to_string()),
            }
        }
        lines.join("\n").into_bytes()
    } else {
        filter(text).map_or_else(|| body.to_vec(), String::into_bytes)
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

    #[test]
    fn device_tools_are_refused_as_tool_errors() {
        let request = json!({"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"browser_navigate","arguments":{}}});
        let answer = screen("c", &call("POST", "/mcp", &request)).unwrap();
        assert_eq!(answer.status, 200);
        let body: Value = serde_json::from_slice(&answer.body).unwrap();
        assert_eq!(body["id"], 7);
        assert_eq!(body["result"]["isError"], true);
        let allowed = json!({"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"propose_subtask","arguments":{}}});
        assert!(screen("c", &call("POST", "/mcp", &allowed)).is_none());
        let list = json!({"jsonrpc":"2.0","id":9,"method":"tools/list"});
        assert!(screen("c", &call("POST", "/mcp", &list)).is_none());
    }

    #[test]
    fn device_routes_and_foreign_paths_are_refused() {
        for path in [
            "/v1/browser/navigate",
            "/v1/desktop/control",
            "/v1/computer/verify",
            "/v1/peers/adopt",
        ] {
            assert_eq!(
                screen("c", &call("POST", path, &json!({}))).unwrap().status,
                403
            );
        }
        for (method, path) in [
            ("POST", "/admin"),
            ("POST", "/v1/../x"),
            ("PUT", "/v1/messages"),
        ] {
            assert_eq!(
                screen("c", &call(method, path, &json!({}))).unwrap().status,
                404
            );
        }
        assert!(screen("c", &call("POST", "/v1/subtasks", &json!({}))).is_none());
        assert!(screen("c", &call("GET", "/v1/messages?after=3", &json!({}))).is_none());
        let large = json!({ "text": "x".repeat(REQUEST_LIMIT) });
        assert_eq!(
            screen("c", &call("POST", "/v1/messages", &large))
                .unwrap()
                .status,
            413
        );
    }

    #[test]
    fn tool_lists_omit_unavailable_tools() {
        let list = json!({"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"peers"},{"name":"browser_tabs"},{"name":"desktop_control"},{"name":"ask_user"}]}});
        let names = |body: &[u8]| -> Vec<String> {
            let text = std::str::from_utf8(body).unwrap();
            let json = text.trim().strip_prefix("data: ").unwrap_or(text);
            serde_json::from_str::<Value>(json).unwrap()["result"]["tools"]
                .as_array()
                .unwrap()
                .iter()
                .map(|tool| tool["name"].as_str().unwrap().to_string())
                .collect()
        };
        let filtered = without_unavailable_tools(list.to_string().as_bytes(), "application/json");
        assert_eq!(names(&filtered), ["peers", "ask_user"]);
        let events = format!("event: message\ndata: {list}\n\n");
        let filtered = without_unavailable_tools(events.as_bytes(), "text/event-stream");
        let data = std::str::from_utf8(&filtered)
            .unwrap()
            .lines()
            .find(|line| line.starts_with("data:"))
            .unwrap()
            .to_string();
        assert_eq!(names(data.as_bytes()), ["peers", "ask_user"]);
        assert_eq!(
            without_unavailable_tools(b"not json", "application/json"),
            b"not json"
        );
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
        let mut relay = Relay::new(&endpoint, "real-token");
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
        let body: Value = serde_json::from_slice(&answers[0].body).unwrap();
        assert_eq!(body["result"]["tools"].as_array().unwrap().len(), 1);
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
}
