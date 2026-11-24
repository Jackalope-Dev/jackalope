//! JSON-RPC 2.0 (without the `jsonrpc` member, as Codex writes it) over the stdio of
//! `codex app-server`.
//!
//! One reader thread owns the server's output. Responses go to the caller waiting on
//! their request ID; requests from the server and notifications go, in order, to the
//! session's driver. Any thread may write: the driver, approval threads answering the
//! server, and a steer or stop arriving from the app.

use super::super::agent_process;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Write;
use std::process::{ChildStdin, ChildStdout};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

/// JSON-RPC's "method not found".
const METHOD_NOT_FOUND: i64 = -32601;

/// A request Codex rejected or could not answer, with Codex's own message.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::commands::tasks) struct RpcError {
    pub code: Option<i64>,
    pub message: String,
}

impl RpcError {
    fn local(message: impl Into<String>) -> Self {
        Self {
            code: None,
            message: message.into(),
        }
    }

    /// The installed Codex does not have the method: Codex 0.156 answers an unknown
    /// method with an invalid-request error naming it as an `unknown variant`.
    pub(in crate::commands::tasks) fn missing_method(&self) -> bool {
        self.code == Some(METHOD_NOT_FOUND) || self.message.contains("unknown variant")
    }
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Codex lists every method it knows after an unknown one; the first clause says it.
        let message = match self.message.split_once(", expected one of") {
            Some((head, _)) => head,
            None => &self.message,
        };
        f.write_str(&message.chars().take(1000).collect::<String>())
    }
}

/// Something the server sent that is not a response to one of our requests.
#[derive(Debug)]
pub(super) enum Inbound {
    Request {
        id: Value,
        method: String,
        params: Value,
    },
    Notification {
        method: String,
        params: Value,
    },
    /// A line longer than the output limit, which was dropped.
    Oversized,
    /// The server closed its output: it exited or was stopped.
    Closed,
}

/// One line of server output.
#[derive(Debug)]
pub(super) enum Line {
    Response(u64, Result<Value, RpcError>),
    Inbound(Inbound),
    Invalid,
}

pub(super) fn classify(line: &str) -> Line {
    let Ok(Value::Object(mut message)) = serde_json::from_str::<Value>(line) else {
        return Line::Invalid;
    };
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .map(str::to_string);
    let params = message.remove("params").unwrap_or(Value::Null);
    match (method, message.remove("id")) {
        (Some(method), Some(id)) => Line::Inbound(Inbound::Request { id, method, params }),
        (Some(method), None) => Line::Inbound(Inbound::Notification { method, params }),
        (None, Some(id)) => {
            let Some(id) = id.as_u64() else {
                return Line::Invalid;
            };
            let result = match message.remove("error") {
                Some(error) => Err(RpcError {
                    code: error["code"].as_i64(),
                    message: error["message"]
                        .as_str()
                        .unwrap_or("Codex rejected the request without a reason.")
                        .to_string(),
                }),
                None => Ok(message.remove("result").unwrap_or(Value::Null)),
            };
            Line::Response(id, result)
        }
        (None, None) => Line::Invalid,
    }
}

type Waiter = mpsc::Sender<Result<Value, RpcError>>;

/// The writing half of a session and the requests waiting for their response.
pub(super) struct Connection {
    stdin: Mutex<ChildStdin>,
    next: AtomicU64,
    waiting: Arc<Mutex<Option<HashMap<u64, Waiter>>>>,
}

impl Connection {
    /// Starts reading `stdout`; what is not a response arrives on the returned channel.
    pub(super) fn start(
        stdin: ChildStdin,
        stdout: ChildStdout,
    ) -> (Arc<Self>, mpsc::Receiver<Inbound>) {
        let waiting: Arc<Mutex<Option<HashMap<u64, Waiter>>>> =
            Arc::new(Mutex::new(Some(HashMap::new())));
        let (sender, inbound) = mpsc::channel();
        let reader_waiting = waiting.clone();
        std::thread::spawn(move || {
            let _ = agent_process::read_lines(stdout, |line, truncated| {
                if truncated {
                    let _ = sender.send(Inbound::Oversized);
                    return;
                }
                match classify(&line) {
                    Line::Response(id, result) => {
                        let waiter = reader_waiting
                            .lock()
                            .unwrap()
                            .as_mut()
                            .and_then(|waiting| waiting.remove(&id));
                        if let Some(waiter) = waiter {
                            let _ = waiter.send(result);
                        }
                    }
                    Line::Inbound(inbound) => {
                        let _ = sender.send(inbound);
                    }
                    Line::Invalid => {}
                }
            });
            // Waiting callers see the session close rather than time out.
            reader_waiting.lock().unwrap().take();
            let _ = sender.send(Inbound::Closed);
        });
        (
            Arc::new(Self {
                stdin: Mutex::new(stdin),
                next: AtomicU64::new(1),
                waiting,
            }),
            inbound,
        )
    }

    fn write(&self, value: &Value) -> Result<(), RpcError> {
        let mut line = value.to_string();
        line.push('\n');
        let mut stdin = self.stdin.lock().unwrap();
        stdin
            .write_all(line.as_bytes())
            .and_then(|()| stdin.flush())
            .map_err(|error| {
                RpcError::local(format!("Codex could not receive the request: {error}"))
            })
    }

    /// Sends `method` and waits up to `limit` for its result.
    pub(super) fn call(
        &self,
        method: &str,
        params: Value,
        limit: Duration,
    ) -> Result<Value, RpcError> {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (waiter, answer) = mpsc::channel();
        match self.waiting.lock().unwrap().as_mut() {
            Some(waiting) => waiting.insert(id, waiter),
            None => return Err(RpcError::local("Codex exited before it could answer.")),
        };
        if let Err(error) = self.write(&json!({"id": id, "method": method, "params": params})) {
            self.forget(id);
            return Err(error);
        }
        match answer.recv_timeout(limit) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.forget(id);
                Err(RpcError::local(format!(
                    "Codex did not answer {method} within {} seconds.",
                    limit.as_secs()
                )))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err(RpcError::local("Codex exited before it could answer."))
            }
        }
    }

    /// Sends `method` without waiting for its result.
    pub(super) fn send(&self, method: &str, params: Value) -> Result<(), RpcError> {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        self.write(&json!({"id": id, "method": method, "params": params}))
    }

    pub(super) fn notify(&self, method: &str, params: Value) -> Result<(), RpcError> {
        self.write(&json!({"method": method, "params": params}))
    }

    /// Answers the server's request `id`.
    pub(super) fn respond(&self, id: &Value, result: Value) {
        let _ = self.write(&json!({"id": id, "result": result}));
    }

    pub(super) fn reject(&self, id: &Value, message: &str) {
        let _ =
            self.write(&json!({"id": id, "error": {"code": METHOD_NOT_FOUND, "message": message}}));
    }

    fn forget(&self, id: u64) {
        if let Some(waiting) = self.waiting.lock().unwrap().as_mut() {
            waiting.remove(&id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_are_responses_requests_or_notifications() {
        let Line::Response(4, Ok(result)) = classify(r#"{"id":4,"result":{"turn":{"id":"t"}}}"#)
        else {
            panic!("response");
        };
        assert_eq!(result["turn"]["id"], "t");
        let Line::Response(15, Err(error)) = classify(
            r#"{"error":{"code":-32600,"message":"no rollout found for thread id 0000"},"id":15}"#,
        ) else {
            panic!("error response");
        };
        assert_eq!(error.code, Some(-32600));
        assert!(!error.missing_method());
        let Line::Inbound(Inbound::Request { id, method, params }) = classify(
            r#"{"method":"item/commandExecution/requestApproval","id":0,"params":{"command":"ls"}}"#,
        ) else {
            panic!("request");
        };
        assert_eq!(
            (id, method.as_str()),
            (json!(0), "item/commandExecution/requestApproval")
        );
        assert_eq!(params["command"], "ls");
        let Line::Inbound(Inbound::Notification { method, .. }) =
            classify(r#"{"method":"turn/started","params":{},"emittedAtMs":1}"#)
        else {
            panic!("notification");
        };
        assert_eq!(method, "turn/started");
        for invalid in [
            "",
            "[]",
            "not json",
            r#"{"id":"x","result":{}}"#,
            r#"{"result":{}}"#,
        ] {
            assert!(matches!(classify(invalid), Line::Invalid), "{invalid}");
        }
    }

    #[test]
    fn an_unknown_method_is_recognized_and_reported_without_the_method_list() {
        let Line::Response(_, Err(error)) = classify(
            r#"{"error":{"code":-32600,"message":"Invalid request: unknown variant `thread/rollback`, expected one of `initialize`, `thread/start`"},"id":16}"#,
        ) else {
            panic!("error response");
        };
        assert!(error.missing_method());
        assert_eq!(
            error.to_string(),
            "Invalid request: unknown variant `thread/rollback`"
        );
        assert!(RpcError {
            code: Some(-32601),
            message: "Method not found".into()
        }
        .missing_method());
    }
}
