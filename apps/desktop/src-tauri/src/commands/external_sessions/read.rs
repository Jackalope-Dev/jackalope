//! Bounded, forgiving reads of CLI session files. These formats are undocumented and
//! change between CLI versions, so a line that does not parse, or has an unexpected
//! shape, is skipped rather than reported.

use serde::Serialize;
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
const TRANSCRIPT_BYTES: u64 = 96 * 1024 * 1024;
/// A longer line (a large tool output, an embedded image) is skipped.
const LINE_BYTES: usize = 4 * 1024 * 1024;
/// The newest transcript entries kept; earlier ones are counted, not shown.
const TRANSCRIPT_ENTRIES: usize = 1_500;
const ENTRY_CHARS: usize = 20_000;
const TITLE_CHARS: usize = 120;

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

/// The JSON object on each line; blank, oversized and unparseable lines are skipped.
pub(super) struct Lines<R> {
    reader: R,
    buffer: Vec<u8>,
}

impl<R: BufRead> Lines<R> {
    pub(super) fn new(reader: R) -> Self {
        Self {
            reader,
            buffer: Vec::new(),
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
            if self.buffer.len() > LINE_BYTES && self.buffer.last() != Some(&b'\n') {
                if !self.skip_line() {
                    return None;
                }
                continue;
            }
            if let Ok(value @ Value::Object(_)) = serde_json::from_slice(&self.buffer) {
                return Some(value);
            }
        }
    }
}

pub(super) fn lines(path: &Path, limit: u64) -> Option<Lines<Box<dyn BufRead + Send>>> {
    open(path, limit).map(Lines::new)
}

pub(super) fn transcript_lines(path: &Path) -> Option<Lines<Box<dyn BufRead + Send>>> {
    lines(path, TRANSCRIPT_BYTES)
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

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptEntry {
    /// `user`, `assistant` or `tools`.
    pub role: &'static str,
    pub text: String,
    /// Tool names in call order, for a `tools` entry.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
}

/// Collects a transcript's entries, merging a reply written across several lines and
/// consecutive tool calls, and keeping only the newest entries.
#[derive(Default)]
pub(super) struct Transcript {
    pub entries: VecDeque<TranscriptEntry>,
    /// Entries left out from the start because the transcript is long.
    pub earlier: usize,
    /// Lines from subagents, which are not shown.
    pub subagent_lines: usize,
}

impl Transcript {
    fn push(&mut self, entry: TranscriptEntry) {
        if self.entries.len() == TRANSCRIPT_ENTRIES {
            self.entries.pop_front();
            self.earlier += 1;
        }
        self.entries.push_back(entry);
    }

    fn capped(text: &str) -> String {
        let mut capped: String = text.chars().take(ENTRY_CHARS).collect();
        if capped.len() < text.len() {
            capped.push('…');
        }
        capped
    }

    pub(super) fn user(&mut self, text: &str, at: Option<&str>) {
        let text = Self::capped(text);
        // Some CLI versions record the same prompt twice in a row.
        if self
            .entries
            .back()
            .is_some_and(|last| last.role == "user" && last.text == text)
        {
            return;
        }
        self.push(TranscriptEntry {
            role: "user",
            text,
            tools: Vec::new(),
            at: at.map(str::to_owned),
        });
    }

    pub(super) fn assistant(&mut self, text: &str, at: Option<&str>) {
        if let Some(last) = self
            .entries
            .back_mut()
            .filter(|last| last.role == "assistant")
        {
            if last.text.chars().count() < ENTRY_CHARS {
                last.text = Self::capped(&format!("{}\n\n{}", last.text, text));
            }
            return;
        }
        self.push(TranscriptEntry {
            role: "assistant",
            text: Self::capped(text),
            tools: Vec::new(),
            at: at.map(str::to_owned),
        });
    }

    pub(super) fn tool(&mut self, name: &str, at: Option<&str>) {
        let name: String = name.chars().take(80).collect();
        if let Some(last) = self.entries.back_mut().filter(|last| last.role == "tools") {
            if last.tools.len() < 200 {
                last.tools.push(name);
            }
            return;
        }
        self.push(TranscriptEntry {
            role: "tools",
            text: String::new(),
            tools: vec![name],
            at: at.map(str::to_owned),
        });
    }
}
