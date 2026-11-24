//! App-server notifications in the transcript model Jackalope already keeps for Codex.
//!
//! The attempt record is built from `codex exec --json` events ([`consume_adapter_event`]),
//! and the app-server reports the same thread items with camelCase names and statuses.
//! Each notification of the current turn becomes the exec event it corresponds to, so the
//! activity, result, usage, tool counts and quota detection read it as before. What exec
//! never reported (streamed text, retries, warnings) becomes its own [`Effect`].
//!
//! [`consume_adapter_event`]: super::super::consume_adapter_event

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// How the current turn ended.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum TurnEnd {
    Completed,
    Failed(String),
    Interrupted,
}

/// Token use Codex reported for the turn: input (including cached), cached input and output.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct TurnUsage {
    pub input: u64,
    pub cached: u64,
    pub output: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub(super) enum Effect {
    /// An event in `codex exec --json` form.
    Event(Value),
    Activity(String),
    /// A line for the attempt's diagnostics, such as a configuration warning.
    Diagnostic(String),
    /// Streamed text of the agent message being written.
    Delta(String),
    MessageStart,
    /// Usage of a turn that ended without completing, which exec never reported.
    Usage(TurnUsage),
    Ended(TurnEnd),
}

/// Paths of the file changes in the current turn, by item ID. A file change approval
/// names only its item; the paths arrived when the item started.
pub(super) type FileChanges = Arc<Mutex<HashMap<String, Vec<String>>>>;

pub(super) struct Mapper {
    turn: String,
    usage: Option<TurnUsage>,
    pub(super) files: FileChanges,
}

impl Mapper {
    pub(super) fn new(turn: &str) -> Self {
        Self {
            turn: turn.to_string(),
            usage: None,
            files: Default::default(),
        }
    }

    fn current(&self, params: &Value) -> bool {
        params["turnId"].as_str() == Some(self.turn.as_str())
    }

    pub(super) fn map(&mut self, method: &str, params: &Value) -> Vec<Effect> {
        match method {
            "item/started" if self.current(params) => self.started(&params["item"]),
            "item/completed" if self.current(params) => completed(&params["item"])
                .map(|item| {
                    vec![Effect::Event(
                        json!({"type": "item.completed", "item": item}),
                    )]
                })
                .unwrap_or_else(|| other_item(&params["item"])),
            "item/agentMessage/delta" if self.current(params) => params["delta"]
                .as_str()
                .filter(|delta| !delta.is_empty())
                .map(|delta| vec![Effect::Delta(delta.to_string())])
                .unwrap_or_default(),
            "thread/tokenUsage/updated" if self.current(params) => {
                let last = &params["tokenUsage"]["last"];
                if let (Some(input), Some(output)) =
                    (last["inputTokens"].as_u64(), last["outputTokens"].as_u64())
                {
                    let usage = self.usage.get_or_insert_with(TurnUsage::default);
                    usage.input = usage.input.saturating_add(input);
                    usage.output = usage.output.saturating_add(output);
                    usage.cached = usage
                        .cached
                        .saturating_add(last["cachedInputTokens"].as_u64().unwrap_or(0));
                }
                vec![]
            }
            "turn/completed" if params["turn"]["id"].as_str() == Some(self.turn.as_str()) => {
                self.ended(&params["turn"])
            }
            "error" if self.current(params) => {
                let error = &params["error"];
                let message = readable(error["message"].as_str().unwrap_or_default());
                if params["willRetry"] == true {
                    return vec![Effect::Activity(format!("Codex is retrying: {message}"))];
                }
                vec![Effect::Event(failure("error", error, &message))]
            }
            "model/rerouted" if self.current(params) => {
                let to = params["toModel"].as_str().unwrap_or_default();
                vec![
                    Effect::Event(json!({"type": "model.rerouted", "model": to})),
                    Effect::Activity(format!(
                        "Codex moved this turn from {} to {to}.",
                        params["fromModel"]
                            .as_str()
                            .unwrap_or("the requested model")
                    )),
                ]
            }
            "mcpServer/startupStatus/updated" if params["status"] == "failed" => {
                vec![Effect::Activity(format!(
                    "Connection {} did not start in Codex: {}",
                    params["name"].as_str().unwrap_or("unknown"),
                    params["error"].as_str().unwrap_or("no reason given")
                ))]
            }
            "warning" | "deprecationNotice" | "guardianWarning" => params["message"]
                .as_str()
                .or(params["summary"].as_str())
                .map(|message| vec![Effect::Diagnostic(message.to_string())])
                .unwrap_or_default(),
            "configWarning" => params["summary"]
                .as_str()
                .map(|summary| vec![Effect::Diagnostic(summary.to_string())])
                .unwrap_or_default(),
            _ => vec![],
        }
    }

    fn started(&mut self, item: &Value) -> Vec<Effect> {
        match item["type"].as_str() {
            Some("agentMessage") => vec![Effect::MessageStart],
            Some("fileChange") => {
                if let Some(id) = item["id"].as_str() {
                    let paths = item["changes"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|change| change["path"].as_str().map(str::to_string))
                        .take(200)
                        .collect();
                    let mut files = self.files.lock().unwrap();
                    if files.len() < 500 {
                        files.insert(id.to_string(), paths);
                    }
                }
                vec![]
            }
            Some("commandExecution" | "mcpToolCall" | "webSearch") => completed(item)
                .map(|item| vec![Effect::Event(json!({"type": "item.started", "item": item}))])
                .unwrap_or_default(),
            _ => vec![],
        }
    }

    fn ended(&mut self, turn: &Value) -> Vec<Effect> {
        let usage = self.usage.take();
        match turn["status"].as_str() {
            Some("completed") => {
                let mut event = json!({"type": "turn.completed"});
                if let Some(usage) = usage {
                    event["usage"] = json!({
                        "input_tokens": usage.input,
                        "cached_input_tokens": usage.cached,
                        "output_tokens": usage.output,
                    });
                }
                vec![Effect::Event(event), Effect::Ended(TurnEnd::Completed)]
            }
            Some("interrupted") => {
                let mut effects: Vec<_> = usage.map(Effect::Usage).into_iter().collect();
                effects.push(Effect::Activity("Codex stopped the turn.".into()));
                effects.push(Effect::Ended(TurnEnd::Interrupted));
                effects
            }
            _ => {
                let error = &turn["error"];
                let message = readable(
                    error["message"]
                        .as_str()
                        .unwrap_or("Codex ended the turn without a reason."),
                );
                let mut effects: Vec<_> = usage.map(Effect::Usage).into_iter().collect();
                effects.push(Effect::Event(failure("turn.failed", error, &message)));
                effects.push(Effect::Ended(TurnEnd::Failed(message)));
                effects
            }
        }
    }
}

/// An `error` or `turn.failed` event. Codex's error kind goes in `code`, in the
/// snake_case its exec errors used, so quota detection recognizes usage limits.
fn failure(kind: &str, error: &Value, message: &str) -> Value {
    let code = error["codexErrorInfo"]
        .as_str()
        .or_else(|| {
            error["codexErrorInfo"]
                .as_object()
                .and_then(|info| info.keys().next())
                .map(String::as_str)
        })
        .map(snake);
    let mut event = json!({"type": kind, "error": {"message": message}});
    if kind == "error" {
        event["message"] = json!(message);
    }
    if let Some(code) = code.filter(|code| code != "other") {
        event["error"]["code"] = json!(code);
    }
    event
}

/// The message inside a provider error Codex passes on as JSON text.
fn readable(message: &str) -> String {
    serde_json::from_str::<Value>(message)
        .ok()
        .and_then(|value| {
            value["error"]["message"]
                .as_str()
                .or(value["message"].as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| message.to_string())
}

fn snake(camel: &str) -> String {
    let mut out = String::with_capacity(camel.len() + 4);
    for ch in camel.chars() {
        if ch.is_ascii_uppercase() {
            out.push('_');
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn status(item: &Value) -> Value {
    match item["status"].as_str() {
        Some("declined") => json!("failed"),
        Some(status) => json!(snake(status)),
        None => Value::Null,
    }
}

/// The exec form of a thread item, for the kinds exec reported.
fn completed(item: &Value) -> Option<Value> {
    let id = item["id"].clone();
    Some(match item["type"].as_str()? {
        "agentMessage" => json!({"id": id, "type": "agent_message", "text": item["text"]}),
        "commandExecution" => json!({
            "id": id,
            "type": "command_execution",
            "command": item["command"],
            "aggregated_output": item["aggregatedOutput"].as_str().unwrap_or_default(),
            "exit_code": item["exitCode"],
            "status": status(item),
        }),
        "fileChange" => json!({
            "id": id,
            "type": "file_change",
            "changes": item["changes"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|change| json!({"path": change["path"], "kind": change["kind"]["type"]}))
                .collect::<Vec<_>>(),
            "status": status(item),
        }),
        "mcpToolCall" => json!({
            "id": id,
            "type": "mcp_tool_call",
            "server": item["server"],
            "tool": item["tool"],
            "arguments": item["arguments"],
            "status": status(item),
            "error": item["error"],
        }),
        "webSearch" => {
            json!({"id": id, "type": "web_search", "query": item["query"], "text": item["query"]})
        }
        "collabAgentToolCall" => json!({
            "id": id,
            "type": "collab_tool_call",
            "tool": item["tool"],
            "status": status(item),
            "text": item["prompt"].as_str().unwrap_or_default(),
        }),
        _ => return None,
    })
}

/// Items exec did not report as events of their own.
fn other_item(item: &Value) -> Vec<Effect> {
    match item["type"].as_str() {
        Some("reasoning") => {
            let summary: Vec<&str> = item["summary"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter(|text| !text.trim().is_empty())
                .collect();
            if summary.is_empty() {
                return vec![];
            }
            vec![Effect::Event(json!({"type": "item.completed", "item": {
                "id": item["id"], "type": "reasoning", "text": summary.join("\n")
            }}))]
        }
        Some("plan") => item["text"]
            .as_str()
            .filter(|text| !text.trim().is_empty())
            .map(|text| vec![Effect::Activity(format!("Plan: {text}"))])
            .unwrap_or_default(),
        Some("contextCompaction") => {
            vec![Effect::Activity("Codex compacted the conversation.".into())]
        }
        _ => vec![],
    }
}
