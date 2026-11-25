//! Bounded, forgiving reads of CLI session files. These formats are undocumented and
//! change between CLI versions, so a line that does not parse, or has an unexpected
//! shape, is skipped rather than reported.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::VecDeque,
    fs::File,
    io::{BufRead, BufReader, Read},
    path::Path,
};

/// Decompressed bytes a summary reads from the start of a session file.
pub(super) const HEAD_BYTES: u64 = 1024 * 1024;
/// Decompressed bytes a transcript reads.
pub(super) const TRANSCRIPT_BYTES: u64 = 96 * 1024 * 1024;
/// A longer line (a large tool output, an embedded image) is skipped.
const LINE_BYTES: usize = 4 * 1024 * 1024;
/// The newest transcript entries kept; earlier ones are counted, not shown.
const TRANSCRIPT_ENTRIES: usize = 1_500;
const ENTRY_CHARS: usize = 20_000;
const TITLE_CHARS: usize = 120;
const SUMMARY_CHARS: usize = 200;
/// Attachments one message keeps references to.
const ATTACHMENTS: usize = 50;

/// The file as text, decompressing a `.zst` rollout, limited to `limit` bytes.
pub(super) fn open(path: &Path, limit: u64) -> Option<Box<dyn BufRead + Send>> {
    let file = File::open(path).ok()?;
    let compressed = path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(".zst"));
    if compressed {
        let decoder = ruzstd::decoding::StreamingDecoder::new(BufReader::new(file)).ok()?;
        Some(Box::new(BufReader::new(decoder.take(limit))))
    } else {
        Some(Box::new(BufReader::new(file.take(limit))))
    }
}

/// The JSON object on each line; blank, oversized and unparseable lines are skipped and
/// counted. A last line without its newline that does not parse is a write in progress,
/// counted apart from damaged lines.
pub(super) struct Lines<R> {
    reader: R,
    buffer: Vec<u8>,
    /// Lines that were not a JSON object, or were too long to keep.
    pub skipped: usize,
    /// Whether the file ended in an unfinished line.
    pub partial_tail: bool,
}

impl<R: BufRead> Lines<R> {
    pub(super) fn new(reader: R) -> Self {
        Self {
            reader,
            buffer: Vec::new(),
            skipped: 0,
            partial_tail: false,
        }
    }

    /// Discards the rest of a line that was too long to keep.
    fn skip_line(&mut self) -> bool {
        loop {
            let Ok(available) = self.reader.fill_buf() else {
                return false;
            };
            if available.is_empty() {
                return false;
            }
            if let Some(end) = available.iter().position(|&byte| byte == b'\n') {
                self.reader.consume(end + 1);
                return true;
            }
            let length = available.len();
            self.reader.consume(length);
        }
    }
}

impl<R: BufRead> Iterator for Lines<R> {
    type Item = Value;

    fn next(&mut self) -> Option<Value> {
        loop {
            self.buffer.clear();
            let read = (&mut self.reader)
                .take(LINE_BYTES as u64 + 1)
                .read_until(b'\n', &mut self.buffer)
                .ok()?;
            if read == 0 {
                return None;
            }
            let complete = self.buffer.last() == Some(&b'\n');
            if self.buffer.len() > LINE_BYTES && !complete {
                self.skipped += 1;
                if !self.skip_line() {
                    return None;
                }
                continue;
            }
            match serde_json::from_slice(&self.buffer) {
                Ok(value @ Value::Object(_)) => return Some(value),
                _ if self.buffer.iter().all(u8::is_ascii_whitespace) => {}
                _ if !complete => self.partial_tail = true,
                _ => self.skipped += 1,
            }
        }
    }
}

pub(super) fn lines(path: &Path, limit: u64) -> Option<Lines<Box<dyn BufRead + Send>>> {
    open(path, limit).map(Lines::new)
}

/// Text a CLI adds to the person's turn on its own: environment and instruction
/// blocks, slash-command records and reminders. Each opens with a line that is only
/// a tag, or with Codex's AGENTS.md heading.
pub(super) fn generated(text: &str) -> bool {
    let first = text.trim_start().lines().next().unwrap_or_default().trim();
    (first.starts_with('<') && first.ends_with('>'))
        || first.starts_with("# AGENTS.md instructions")
}

/// The first line of a prompt, trimmed for a list row.
pub(super) fn title(text: &str) -> Option<String> {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.is_empty() {
        return None;
    }
    let mut title: String = line.chars().take(TITLE_CHARS).collect();
    if line.chars().count() > TITLE_CHARS {
        title.push('…');
    }
    Some(title)
}

pub(super) fn text(value: &Value) -> Option<&str> {
    value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
}

/// One line of a summary, such as a tool's command or file, trimmed for display.
pub(super) fn summary(text: &str) -> Option<String> {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.is_empty() {
        return None;
    }
    let mut summary: String = line.chars().take(SUMMARY_CHARS).collect();
    if line.chars().count() > SUMMARY_CHARS {
        summary.push('…');
    }
    Some(summary)
}

/// What a tool call was given, in one line: the first of the fields tools commonly
/// take (a command, file, pattern, address or description).
pub(super) fn tool_input(input: &Value) -> Option<String> {
    const FIELDS: [&str; 12] = [
        "command",
        "cmd",
        "file_path",
        "path",
        "notebook_path",
        "pattern",
        "url",
        "query",
        "description",
        "prompt",
        "skill",
        "subject",
    ];
    FIELDS.iter().find_map(|field| match &input[field] {
        Value::Array(parts) => summary(
            &parts
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" "),
        ),
        value => summary(text(value)?),
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
    Tools,
}

impl Role {
    #[cfg(test)]
    pub fn as_str(self) -> &'static str {
        match self {
            Role::User => "user",
            Role::Assistant => "assistant",
            Role::Tools => "tools",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub name: String,
    /// What it was given, in one line, when that can be read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

/// One entry of a transcript. Imported conversations save these, so new fields need
/// defaults.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptEntry {
    pub role: Role,
    #[serde(default)]
    pub text: String,
    /// Tool calls in order, for a `tools` entry.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<ToolCall>,
    /// Files and images the person attached, by name or path; their contents are not kept.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
}

/// Collects a transcript's entries, merging a reply written across several lines and
/// consecutive tool calls, and keeping only the newest `keep` entries.
pub(super) struct Transcript {
    pub entries: VecDeque<TranscriptEntry>,
    /// Entries left out from the start because the transcript is long.
    pub earlier: usize,
    /// Lines from subagents, which are not shown.
    pub subagent_lines: usize,
    /// The person's messages and the replies, including those left out.
    pub messages: usize,
    /// The time of the newest entry, when the CLI recorded one.
    pub last_at: Option<String>,
    /// Lines that could not be read; see [`Lines`].
    pub skipped_lines: usize,
    pub partial_tail: bool,
    keep: usize,
}

impl Default for Transcript {
    fn default() -> Self {
        Self::keeping(TRANSCRIPT_ENTRIES)
    }
}

impl Transcript {
    pub(super) fn keeping(keep: usize) -> Self {
        Self {
            entries: VecDeque::new(),
            earlier: 0,
            subagent_lines: 0,
            messages: 0,
            last_at: None,
            skipped_lines: 0,
            partial_tail: false,
            keep: keep.max(1),
        }
    }

    fn push(&mut self, entry: TranscriptEntry) {
        if entry.role != Role::Tools {
            self.messages += 1;
        }
        if self.entries.len() == self.keep {
            self.entries.pop_front();
            self.earlier += 1;
        }
        self.entries.push_back(entry);
    }

    fn seen(&mut self, at: Option<&str>) {
        if let Some(at) = at {
            self.last_at = Some(at.to_owned());
        }
    }

    fn capped(text: &str) -> String {
        let mut capped: String = text.chars().take(ENTRY_CHARS).collect();
        if capped.len() < text.len() {
            capped.push('…');
        }
        capped
    }

    pub(super) fn user(&mut self, text: &str, at: Option<&str>) {
        self.user_with(text, Vec::new(), at);
    }

    /// A message from the person, with references to what they attached.
    pub(super) fn user_with(&mut self, text: &str, attachments: Vec<String>, at: Option<&str>) {
        let text = Self::capped(text);
        if text.is_empty() && attachments.is_empty() {
            return;
        }
        self.seen(at);
        // Some CLI versions record the same prompt twice in a row.
        if self
            .entries
            .back()
            .is_some_and(|last| last.role == Role::User && last.text == text)
        {
            return;
        }
        self.push(TranscriptEntry {
            role: Role::User,
            text,
            tools: Vec::new(),
            attachments: attachments.into_iter().take(ATTACHMENTS).collect(),
            at: at.map(str::to_owned),
        });
    }

    pub(super) fn assistant(&mut self, text: &str, at: Option<&str>) {
        self.seen(at);
        if let Some(last) = self
            .entries
            .back_mut()
            .filter(|last| last.role == Role::Assistant)
        {
            if last.text.chars().count() < ENTRY_CHARS {
                last.text = Self::capped(&format!("{}\n\n{}", last.text, text));
            }
            return;
        }
        self.push(TranscriptEntry {
            role: Role::Assistant,
            text: Self::capped(text),
            tools: Vec::new(),
            attachments: Vec::new(),
            at: at.map(str::to_owned),
        });
    }

    pub(super) fn tool(&mut self, name: &str, summary: Option<String>, at: Option<&str>) {
        self.seen(at);
        let call = ToolCall {
            name: name.chars().take(80).collect(),
            summary,
        };
        if let Some(last) = self
            .entries
            .back_mut()
            .filter(|last| last.role == Role::Tools)
        {
            if last.tools.len() < 200 {
                last.tools.push(call);
            }
            return;
        }
        self.push(TranscriptEntry {
            role: Role::Tools,
            text: String::new(),
            tools: vec![call],
            attachments: Vec::new(),
            at: at.map(str::to_owned),
        });
    }
}
