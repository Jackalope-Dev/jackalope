//! Codex's session store: one rollout per thread, `rollout-<time>-<thread id>.jsonl`,
//! compressed to `.jsonl.zst` once idle, under `sessions/YYYY/MM/DD/` or
//! `archived_sessions/` of its home (Codex 0.156). The first line is the thread's
//! `session_meta`; the conversation follows as `response_item` lines.

use super::{
    read::{self, Transcript},
    Summary,
};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// How deep rollouts sit below a store root: year, month, day and file.
pub(in crate::commands) const DEPTH: usize = 4;

/// The folders under a Codex home that hold rollouts; `sessions` first.
pub(in crate::commands) fn roots(home: &Path) -> Vec<PathBuf> {
    vec![home.join("sessions"), home.join("archived_sessions")]
}

pub(super) fn is_session(name: &str) -> bool {
    name.starts_with("rollout-") && (name.ends_with(".jsonl") || name.ends_with(".jsonl.zst"))
}

/// The text of a `response_item` message from `role`, without the blocks Codex adds
/// to the person's turn itself (environment, instructions).
fn message(line: &Value, role: &str) -> Option<String> {
    let item = &line["payload"];
    if line["type"] != "response_item" || item["type"] != "message" || item["role"] != role {
        return None;
    }
    let text = item["content"]
        .as_array()?
        .iter()
        .filter(|block| matches!(block["type"].as_str(), Some("input_text" | "output_text")))
        .filter_map(|block| read::text(&block["text"]))
        .filter(|text| !read::generated(text))
        .collect::<Vec<_>>()
        .join("\n\n");
    (!text.is_empty()).then_some(text)
}

pub(super) fn summarize(mut lines: impl Iterator<Item = Value>) -> Option<Summary> {
    let first = lines.next()?;
    let meta = &first["payload"];
    if first["type"] != "session_meta" {
        return None;
    }
    // Threads Codex spawned itself (subagents, reviews) name their source as an object.
    if meta["source"].is_object() || meta["parent_thread_id"].is_string() {
        return None;
    }
    let id = meta["id"].as_str().filter(|id| super::valid_session(id))?;
    let cwd = read::text(&meta["cwd"]).filter(|cwd| Path::new(cwd).is_absolute())?;
    let title = lines
        .find_map(|line| message(&line, "user"))
        .and_then(|text| read::title(&text));
    Some(Summary {
        session_id: id.to_string(),
        cwd: cwd.to_string(),
        branch: read::text(&meta["git"]["branch"]).map(str::to_owned),
        title,
        started_at: read::text(&meta["timestamp"]).map(str::to_owned),
    })
}

pub(super) fn transcript(line: &Value, transcript: &mut Transcript) {
    let at = line["timestamp"].as_str();
    if let Some(text) = message(line, "user") {
        transcript.user(&text, at);
    } else if let Some(text) = message(line, "assistant") {
        transcript.assistant(&text, at);
    } else if line["type"] == "response_item" {
        let item = &line["payload"];
        match item["type"].as_str() {
            Some("function_call" | "custom_tool_call") => {
                if let Some(name) = read::text(&item["name"]) {
                    transcript.tool(name, at);
                }
            }
            Some("local_shell_call") => transcript.tool("shell", at),
            Some("web_search_call") => transcript.tool("web_search", at),
            _ => {}
        }
    }
}
