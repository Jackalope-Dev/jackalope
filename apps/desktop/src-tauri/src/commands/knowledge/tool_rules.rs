//! Tool rules: lessons the person promoted to a check on agents' tool calls.
//! A rule matches a shell command, file write or file edit by a regular
//! expression over the command or written text and/or a path glob. A warning
//! lets the call proceed and shows the agent the message; a denial blocks the
//! call with the message as the reason. Nothing here makes a rule on its own:
//! rules are saved only through the lesson editor.

use super::{learning, KnowledgeEntry, KnowledgeKind};
use crate::commands::tasks::TaskRuntime;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum ToolKind {
    Shell,
    Write,
    Edit,
}

impl ToolKind {
    fn noun(self) -> &'static str {
        match self {
            Self::Shell => "shell command",
            Self::Write => "file write",
            Self::Edit => "file edit",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuleAction {
    #[default]
    Warn,
    Deny,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolRule {
    pub tools: Vec<ToolKind>,
    /// A regular expression searched in the shell command or the text written.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub pattern: String,
    /// A glob over the workspace-relative path; without a `/` it matches the
    /// file name in any folder.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub path: String,
    #[serde(default)]
    pub action: RuleAction,
    pub message: String,
}

// Counted in characters, as the editor counts them.
const PATTERN_CHARS: usize = 500;
const PATH_CHARS: usize = 240;
const MESSAGE_CHARS: usize = 800;
/// Compiled size allowed for one pattern, so a large repetition is refused at
/// save time rather than built on every tool call.
const COMPILED_BYTES: usize = 1 << 20;
/// Text one call is matched against. Matching is linear in it.
const TEXT_BYTES: usize = 256 * 1024;

impl ToolRule {
    /// Trims and checks a rule before it is saved.
    pub fn normalize(&mut self) -> Result<(), String> {
        self.tools.sort();
        self.tools.dedup();
        self.pattern = self.pattern.trim().into();
        self.path = self.path.trim().replace('\\', "/");
        self.message = self.message.trim().into();
        if self.tools.is_empty() {
            return Err("Choose at least one kind of tool call for the rule.".into());
        }
        if self.pattern.is_empty() && self.path.is_empty() {
            return Err("Give the rule a pattern, a path, or both.".into());
        }
        if self.message.is_empty() || self.message.chars().count() > MESSAGE_CHARS {
            return Err(format!(
                "Give the rule a message up to {MESSAGE_CHARS} characters."
            ));
        }
        if self.pattern.chars().count() > PATTERN_CHARS {
            return Err(format!(
                "Keep the pattern to {PATTERN_CHARS} characters or fewer."
            ));
        }
        if self.path.chars().count() > PATH_CHARS {
            return Err(format!(
                "Keep the path to {PATH_CHARS} characters or fewer."
            ));
        }
        if !self.path.is_empty() && self.tools == [ToolKind::Shell] {
            return Err("A path applies to file writes and edits, not shell commands.".into());
        }
        if !self.pattern.is_empty() {
            regex(&self.pattern).map_err(|error| format!("The pattern is not valid: {error}"))?;
        }
        if !self.path.is_empty() {
            glob(&self.path).map_err(|error| format!("The path is not valid: {error}"))?;
        }
        Ok(())
    }
}

fn regex(pattern: &str) -> Result<regex::Regex, regex::Error> {
    regex::RegexBuilder::new(pattern)
        .size_limit(COMPILED_BYTES)
        .dfa_size_limit(COMPILED_BYTES)
        .build()
}

fn glob(path: &str) -> Result<globset::GlobMatcher, globset::Error> {
    globset::GlobBuilder::new(path.trim_start_matches("./"))
        .literal_separator(true)
        .build()
        .map(|glob| glob.compile_matcher())
}

/// One tool call as the rules see it: what it does, the command or text it
/// writes, and the files it touches relative to the workspace.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolCall {
    /// Usually one kind. A file change the agent does not say is a write or an
    /// edit (OpenCode asks `edit` permission for both) has both, so rules for
    /// either apply.
    pub kinds: Vec<ToolKind>,
    pub text: String,
    pub paths: Vec<String>,
}

impl ToolCall {
    /// A Claude Code tool call; `None` for tools rules do not cover.
    pub fn claude(tool: &str, input: &Value, workspace: &str) -> Option<Self> {
        let text = |key: &str| input[key].as_str().unwrap_or_default().to_string();
        let (kind, text) = match tool {
            "Bash" | "PowerShell" => (ToolKind::Shell, input["command"].as_str()?.to_string()),
            "Write" => (ToolKind::Write, text("content")),
            "Edit" => (ToolKind::Edit, text("new_string")),
            "NotebookEdit" => (ToolKind::Edit, text("new_source")),
            "MultiEdit" => (
                ToolKind::Edit,
                input["edits"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|edit| edit["new_string"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n"),
            ),
            _ => return None,
        };
        let paths = ["file_path", "notebook_path"]
            .iter()
            .filter_map(|key| input[*key].as_str())
            .map(|path| relative(path, workspace))
            .collect();
        Some(Self {
            kinds: vec![kind],
            text,
            paths,
        })
    }

    /// An ACP `session/request_permission` tool call (Kimi Code and custom ACP
    /// agents), merged with what earlier `tool_call` updates reported about it;
    /// see [`acp_kind`]. `None` for other tools and for a shell command that
    /// cannot be read. The automatic risk check reads requests through this too.
    pub fn acp(tool_call: &Value, workspace: &str) -> Option<Self> {
        let raw = &tool_call["rawInput"];
        let kind = acp_kind(tool_call)?;
        if kind == ToolKind::Shell {
            return Some(Self {
                kinds: vec![kind],
                text: command_text(raw)?,
                paths: vec![],
            });
        }
        // ACP `diff` content: the reported change to each file.
        let diffs: Vec<&Value> = tool_call["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|item| item["type"] == "diff")
            .collect();
        let mut text: Vec<&str> = ["new_string", "newText", "new_text", "content"]
            .iter()
            .filter_map(|key| raw[*key].as_str())
            .take(1)
            .collect();
        // Kimi's StrReplaceFile: `edit` is one `{old, new}` or a list of them.
        for edit in ["edit", "edits"] {
            match &raw[edit] {
                Value::Array(edits) => text.extend(edits.iter().filter_map(|e| e["new"].as_str())),
                single => text.extend(single["new"].as_str()),
            }
        }
        if text.is_empty() {
            text.extend(diffs.iter().filter_map(|diff| diff["newText"].as_str()));
        }
        let mut paths: Vec<String> = ["path", "file_path", "filePath", "abs_path"]
            .iter()
            .filter_map(|key| raw[*key].as_str())
            .chain(diffs.iter().filter_map(|diff| diff["path"].as_str()))
            .chain(
                tool_call["locations"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|location| location["path"].as_str()),
            )
            .map(|path| relative(path, workspace))
            .collect();
        paths.sort();
        paths.dedup();
        Some(Self {
            kinds: vec![kind],
            text: text.join("\n"),
            paths,
        })
    }

    /// An OpenCode `permission.asked` request. File text comes from the lines
    /// the reported diff adds. OpenCode's write, edit and patch tools all ask
    /// `edit` permission, so an `edit` request counts as both.
    pub fn opencode(
        permission: &str,
        patterns: &[String],
        metadata: &Value,
        workspace: &str,
    ) -> Option<Self> {
        match permission {
            "bash" => Some(Self {
                kinds: vec![ToolKind::Shell],
                text: command_text(metadata).unwrap_or_else(|| patterns.join("\n")),
                paths: vec![],
            }),
            "edit" | "write" | "patch" | "multiedit" => {
                let text = match metadata["diff"].as_str() {
                    Some(diff) => diff
                        .lines()
                        .filter(|line| line.starts_with('+') && !line.starts_with("+++"))
                        .map(|line| &line[1..])
                        .collect::<Vec<_>>()
                        .join("\n"),
                    None => metadata["content"].as_str().unwrap_or_default().into(),
                };
                // Patterns are relative to the Git worktree; the metadata has
                // absolute paths: `files` for a patch, `filepath` for one file.
                let files: Vec<&str> = metadata["files"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|file| file["filePath"].as_str())
                    .collect();
                let paths: Vec<String> = if !files.is_empty() {
                    files.iter().map(|path| relative(path, workspace)).collect()
                } else if let Some(path) = metadata["filepath"].as_str() {
                    vec![relative(path, workspace)]
                } else {
                    patterns
                        .iter()
                        .map(|path| relative(path, workspace))
                        .collect()
                };
                Some(Self {
                    kinds: match permission {
                        "write" => vec![ToolKind::Write],
                        "edit" => vec![ToolKind::Write, ToolKind::Edit],
                        _ => vec![ToolKind::Edit],
                    },
                    text,
                    paths,
                })
            }
            _ => None,
        }
    }

    fn noun(&self) -> &'static str {
        match self.kinds.as_slice() {
            [kind] => kind.noun(),
            _ => "file change",
        }
    }
}

/// The tool an ACP call's title names before any `:`, such as Kimi's `Shell`
/// in `Shell: pnpm test`.
pub fn acp_tool(tool_call: &Value) -> &str {
    tool_call["title"]
        .as_str()
        .unwrap_or_default()
        .split(':')
        .next()
        .unwrap_or_default()
        .trim()
}

/// Whether an ACP tool call runs a shell command, writes or edits a file.
/// Agents that send no `kind` are recognized by [`acp_tool`] (Kimi's `Shell`,
/// `WriteFile` and `StrReplaceFile`). An edit that only supplies new content
/// counts as a write.
pub fn acp_kind(tool_call: &Value) -> Option<ToolKind> {
    let raw = &tool_call["rawInput"];
    Some(match (tool_call["kind"].as_str(), acp_tool(tool_call)) {
        (Some("execute"), _) | (None, "Shell") => ToolKind::Shell,
        (None, "WriteFile") => ToolKind::Write,
        (None, "StrReplaceFile") => ToolKind::Edit,
        (Some("edit"), _) => {
            let old = ["old_string", "oldText", "old_text", "edit", "edits"]
                .iter()
                .any(|key| !raw[*key].is_null());
            if old || !raw["content"].is_string() {
                ToolKind::Edit
            } else {
                ToolKind::Write
            }
        }
        _ => return None,
    })
}

fn command_text(input: &Value) -> Option<String> {
    match &input["command"] {
        Value::String(text) => Some(text.clone()),
        Value::Array(parts) => parts
            .iter()
            .map(Value::as_str)
            .collect::<Option<Vec<_>>>()
            .map(|words| words.join(" ")),
        _ => input["cmd"].as_str().map(str::to_string),
    }
}

/// The path relative to the workspace when it lies inside it; otherwise the
/// path as given, which relative globs do not match. `.` and `..` are resolved
/// first, without touching the disk, so `src/../migrations/a.sql` matches
/// `migrations/*.sql`.
fn relative(path: &str, workspace: &str) -> String {
    let path = lexical(&path.replace('\\', "/"));
    let root = lexical(&workspace.replace('\\', "/"));
    let root = root.trim_end_matches('/');
    let inside = !root.is_empty()
        && path.len() > root.len()
        && path.as_bytes()[root.len()] == b'/'
        && if cfg!(windows) {
            path[..root.len()].eq_ignore_ascii_case(root)
        } else {
            path.starts_with(root)
        };
    if inside {
        path[root.len() + 1..].to_string()
    } else {
        path
    }
}

/// Resolves `.` and `..` segments and repeated slashes. A `..` above a
/// relative path's start is kept, so the path still cannot match a workspace glob.
fn lexical(path: &str) -> String {
    let absolute = path.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." if parts
                .last()
                .is_some_and(|last| *last != ".." && !last.ends_with(':')) =>
            {
                parts.pop();
            }
            ".." if absolute => {}
            part => parts.push(part),
        }
    }
    let joined = parts.join("/");
    if absolute {
        format!("/{joined}")
    } else {
        joined
    }
}

/// A rule that matched a tool call.
#[derive(Debug, Clone, PartialEq)]
pub struct RuleMatch {
    pub entry_id: String,
    pub title: String,
    pub action: RuleAction,
    pub message: String,
}

struct Compiled {
    entry_id: String,
    title: String,
    rule: ToolRule,
    pattern: Option<regex::Regex>,
    path: Option<globset::GlobMatcher>,
}

/// A project's rules, compiled once and checked against each tool call.
#[derive(Default)]
pub struct ToolRules {
    rules: Vec<Compiled>,
}

impl ToolRules {
    /// The rules of lessons that are available: turned on, not removed and
    /// not archived. A rule that no longer compiles (saved by a version with a
    /// different syntax) is skipped with a warning in the log.
    pub fn from_entries(entries: &[KnowledgeEntry]) -> Self {
        let rules = entries
            .iter()
            .filter(|entry| {
                entry.kind == KnowledgeKind::Memory
                    && entry.enabled
                    && !entry.dismissed
                    && !learning::lifecycle(entry).is_some_and(|state| state.archived())
            })
            .filter_map(|entry| {
                let rule = entry.tool_rule.clone()?;
                let skip = |error: String| {
                    eprintln!(
                        "Tool rule of lesson {} is skipped because it no longer compiles: {error}",
                        entry.id
                    );
                };
                let pattern = match rule.pattern.as_str() {
                    "" => None,
                    pattern => Some(regex(pattern).map_err(|e| skip(e.to_string())).ok()?),
                };
                let path = match rule.path.as_str() {
                    "" => None,
                    path => Some(glob(path).map_err(|e| skip(e.to_string())).ok()?),
                };
                Some(Compiled {
                    entry_id: entry.id.clone(),
                    title: entry.title.clone(),
                    rule,
                    pattern,
                    path,
                })
            })
            .collect();
        Self { rules }
    }

    /// The rules for a project, or none when its knowledge cannot be read.
    pub fn for_project(runtime: &TaskRuntime, project_id: &str, project_path: &str) -> Self {
        match runtime.knowledge.list(project_id, project_path) {
            Ok(entries) => Self::from_entries(&entries),
            Err(error) => {
                eprintln!("Tool rules could not be read: {error}");
                Self::default()
            }
        }
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    pub fn check(&self, call: &ToolCall) -> Vec<RuleMatch> {
        let mut end = call.text.len().min(TEXT_BYTES);
        while !call.text.is_char_boundary(end) {
            end -= 1;
        }
        let text = &call.text[..end];
        self.rules
            .iter()
            .filter(|compiled| {
                call.kinds
                    .iter()
                    .any(|kind| compiled.rule.tools.contains(kind))
            })
            .filter(|compiled| {
                compiled
                    .pattern
                    .as_ref()
                    .is_none_or(|pattern| pattern.is_match(text))
            })
            .filter(|compiled| {
                compiled.path.as_ref().is_none_or(|glob| {
                    call.paths.iter().any(|path| {
                        glob.is_match(path)
                            || !compiled.rule.path.contains('/')
                                && path
                                    .rsplit('/')
                                    .next()
                                    .is_some_and(|name| glob.is_match(name))
                    })
                })
            })
            .map(|compiled| RuleMatch {
                entry_id: compiled.entry_id.clone(),
                title: compiled.title.clone(),
                action: compiled.rule.action,
                message: compiled.rule.message.clone(),
            })
            .collect()
    }
}

/// What the agent is told when rules match: the reason for a denial, when any
/// rule denies, and the warnings to show while the call proceeds.
pub fn feedback(call: &ToolCall, matches: &[RuleMatch]) -> (Option<String>, Option<String>) {
    let lines = |action| {
        let lines: Vec<String> = matches
            .iter()
            .filter(|found| found.action == action)
            .map(|found| format!("Project rule \"{}\": {}", found.title, found.message))
            .collect();
        (!lines.is_empty()).then(|| lines.join("\n"))
    };
    let denied = lines(RuleAction::Deny).map(|lines| {
        format!(
            "Jackalope blocked this {} because it matches this project's tool rules.\n{lines}",
            call.noun()
        )
    });
    let warned = lines(RuleAction::Warn).map(|lines| {
        format!(
            "Jackalope: this {} matches this project's tool rules. It was allowed; follow the guidance.\n{lines}",
            call.noun()
        )
    });
    (denied, warned)
}

/// Checks a permission request from an agent that asks before acting
/// (OpenCode, ACP agents) and records each match in the attempt's activity.
/// Returns the denial reason when a rule blocks the call. These protocols have
/// no way to show a message on an allowed call, so a warning is only recorded.
pub fn check_request(
    runtime: &TaskRuntime,
    run_id: &str,
    label: &str,
    call: impl FnOnce(&str) -> Option<ToolCall>,
) -> Option<String> {
    let run = runtime.run_snapshot(run_id)?;
    let call = call(&run.workspace)?;
    let matches = ToolRules::for_project(runtime, &run.project_id, &run.project_path).check(&call);
    if matches.is_empty() {
        return None;
    }
    let label: String = label
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(160)
        .collect();
    runtime.update(run_id, |run| {
        for found in &matches {
            crate::commands::tasks::events::activity(run, &activity_line(found, &label));
        }
    });
    feedback(&call, &matches).0
}

/// The activity line recording one match. `label` is the short form of the
/// call, such as `Bash: git push`.
pub fn activity_line(found: &RuleMatch, label: &str) -> String {
    let verb = match found.action {
        RuleAction::Warn => "warned on",
        RuleAction::Deny => "denied",
    };
    format!("Tool rule \"{}\" {verb} {label}", found.title)
}

#[cfg(test)]
mod tests;
