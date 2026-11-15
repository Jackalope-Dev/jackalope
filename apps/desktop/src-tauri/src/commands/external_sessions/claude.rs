//! Claude Code's session store: `projects/<encoded working directory>/<session id>.jsonl`
//! under its configuration directory. The folder name is a lossy encoding of the
//! working directory, so the `cwd`, `gitBranch`, `sessionId` and `timestamp` fields of
//! the lines are read instead. Lines marked `isSidechain` belong to subagents; their
//! own files sit one level deeper, under `<session id>/subagents/`, and are not listed.

use super::{
    read::{self, Transcript},
    Summary,
};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub(super) const DEPTH: usize = 2;

pub(super) fn roots(home: &Path) -> Vec<PathBuf> {
    vec![home.join("projects")]
}

pub(super) fn is_session(name: &str) -> bool {
    name.ends_with(".jsonl")
}

fn sidechain(line: &Value) -> bool {
    line["isSidechain"].as_bool() == Some(true)
}

/// What the person typed in a `user` line: its text, or its text blocks. Tool results,
/// CLI-generated turns (`isMeta`) and command records are not prompts.
fn prompt(line: &Value) -> Option<String> {
    if line["type"] != "user" || line["isMeta"].as_bool() == Some(true) || sidechain(line) {
        return None;
    }
    let content = &line["message"]["content"];
    let text = match content {
        Value::String(text) => text.trim().to_string(),
        Value::Array(blocks) => blocks
            .iter()
            .filter(|block| block["type"] == "text")
            .filter_map(|block| read::text(&block["text"]))
            .collect::<Vec<_>>()
            .join("\n\n"),
        _ => return None,
    };
    (!text.is_empty() && !read::generated(&text)).then_some(text)
}

pub(super) fn summarize(lines: impl Iterator<Item = Value>) -> Option<Summary> {
    let mut summary: Option<Summary> = None;
    let mut named = None;
    for line in lines {
        match line["type"].as_str() {
            Some("ai-title") => named = named.or_else(|| read::title(line["aiTitle"].as_str()?)),
            Some("summary") => named = named.or_else(|| read::title(line["summary"].as_str()?)),
            _ => {}
        }
        if sidechain(&line) {
            continue;
        }
        if summary.is_none() {
            let (Some(id), Some(cwd)) = (line["sessionId"].as_str(), read::text(&line["cwd"]))
            else {
                continue;
            };
            if !super::valid_session(id) || !Path::new(cwd).is_absolute() {
                return None;
            }
            summary = Some(Summary {
                session_id: id.to_string(),
                cwd: cwd.to_string(),
                branch: read::text(&line["gitBranch"])
                    .filter(|branch| *branch != "HEAD")
                    .map(str::to_owned),
                title: None,
                started_at: read::text(&line["timestamp"]).map(str::to_owned),
            });
        }
        if let Some(text) = prompt(&line) {
            if let Some(summary) = summary.as_mut() {
                summary.title = read::title(&text);
                break;
            }
        }
    }
    let mut summary = summary?;
    summary.title = summary.title.or(named);
    Some(summary)
}

pub(super) fn transcript(line: &Value, transcript: &mut Transcript) {
    if sidechain(line) {
        transcript.subagent_lines += 1;
        return;
    }
    let at = line["timestamp"].as_str();
    if let Some(text) = prompt(line) {
        transcript.user(&text, at);
        return;
    }
    if line["type"] != "assistant" {
        return;
    }
    match &line["message"]["content"] {
        Value::String(text) if !text.trim().is_empty() => transcript.assistant(text.trim(), at),
        Value::Array(blocks) => {
            for block in blocks {
                match block["type"].as_str() {
                    Some("text") => {
                        if let Some(text) = read::text(&block["text"]) {
                            transcript.assistant(text, at);
                        }
                    }
                    Some("tool_use") => {
                        if let Some(name) = read::text(&block["name"]) {
                            transcript.tool(name, at);
                        }
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
}
