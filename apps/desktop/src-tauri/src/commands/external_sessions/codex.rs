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
/// to the person's turn itself (environment, instructions), and references to the files
/// and images the person attached.
fn message(line: &Value, role: &str) -> Option<(String, Vec<String>)> {
    let item = &line["payload"];
    if line["type"] != "response_item" || item["type"] != "message" || item["role"] != role {
        return None;
    }
    let mut texts = Vec::new();
    let mut attachments = Vec::new();
    // Codex wraps a pasted image in `<image name=… path="…">` and `</image>` blocks.
    let mut image_path = None;
    for block in item["content"].as_array()? {
        match block["type"].as_str() {
            Some("input_text" | "output_text") => {
                let Some(text) = read::text(&block["text"]) else {
                    continue;
                };
                if let Some(files) = text.strip_prefix(FILES_HEADING) {
                    attachments.extend(
                        files
                            .lines()
                            .filter_map(|line| line.strip_prefix("## "))
                            .filter_map(|line| read::summary(line.rsplit(": ").next()?)),
                    );
                } else if read::generated(text) {
                    image_path = text
                        .strip_prefix("<image ")
                        .and_then(|tag| tag.split("path=\"").nth(1))
                        .and_then(|path| path.split('"').next())
                        .and_then(read::summary);
                } else {
                    texts.push(text);
                }
            }
            Some("input_image") => match image_path.take() {
                Some(path) => {
                    attachments.retain(|listed| *listed != path);
                    attachments.push(format!("Image ({path})"));
                }
                None => attachments.push("Image".to_string()),
            },
            _ => {}
        }
    }
    attachments.dedup();
    let text = texts.join("\n\n");
    (!text.is_empty() || !attachments.is_empty()).then_some((text, attachments))
}

/// How Codex lists the files a person mentioned, ahead of their prompt.
const FILES_HEADING: &str = "# Files mentioned by the user:";

/// What a call was given: its arguments (a JSON string), or the files a patch changes.
fn call_summary(item: &Value) -> Option<String> {
    if let Some(arguments) = item["arguments"].as_str() {
        return serde_json::from_str::<Value>(arguments)
            .ok()
            .and_then(|arguments| read::tool_input(&arguments));
    }
    let input = item["input"].as_str()?;
    let files: Vec<_> = input
        .lines()
        .filter_map(|line| {
            ["*** Update File: ", "*** Add File: ", "*** Delete File: "]
                .iter()
                .find_map(|prefix| line.strip_prefix(prefix))
        })
        .collect();
    if files.is_empty() {
        input.lines().find_map(read::summary)
    } else {
        read::summary(&files.join(", "))
    }
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
        .find_map(|line| message(&line, "user").filter(|(text, _)| !text.is_empty()))
        .and_then(|(text, _)| read::title(&text));
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
    if let Some((text, attachments)) = message(line, "user") {
        transcript.user_with(&text, attachments, at);
    } else if let Some((text, _)) = message(line, "assistant") {
        transcript.assistant(&text, at);
    } else if line["type"] == "response_item" {
        let item = &line["payload"];
        match item["type"].as_str() {
            Some("function_call" | "custom_tool_call") => {
                if let Some(name) = read::text(&item["name"]) {
                    transcript.tool(name, call_summary(item), at);
                }
            }
            Some("local_shell_call") => {
                transcript.tool("shell", read::tool_input(&item["action"]), at)
            }
            Some("web_search_call") => {
                transcript.tool("web_search", read::tool_input(&item["action"]), at)
            }
            _ => {}
        }
    }
}
