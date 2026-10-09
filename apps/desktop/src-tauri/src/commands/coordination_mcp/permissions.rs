//! Claude Code `--permission-prompt-tool` decisions. Claude runs headless with
//! `acceptEdits`, so anything outside that mode reaches this tool instead of
//! being denied silently. Read-only actions are allowed automatically; the
//! rest becomes a task question the user answers in Jackalope.

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

pub(super) const ALLOW_ONCE: &str = "Allow once";
pub(super) const ALLOW_TASK: &str = "Allow for this task";
pub(super) const DENY: &str = "Deny";

// Per-attempt "Allow for this task" grants. Not persisted: a continuation is a
// new attempt and asks again.
static GRANTS: LazyLock<Mutex<HashMap<String, HashSet<String>>>> = LazyLock::new(Default::default);

const READ_ONLY_TOOLS: &[&str] = &[
    "Read",
    "Glob",
    "Grep",
    "LS",
    "NotebookRead",
    "TodoWrite",
    "WebSearch",
    "BashOutput",
];
const READ_ONLY_COMMANDS: &[&str] = &[
    "ls", "pwd", "cat", "head", "tail", "wc", "grep", "rg", "find", "tree", "file", "stat",
    "which", "diff", "du", "echo",
];
const READ_ONLY_GIT: &[&str] = &[
    "status",
    "diff",
    "log",
    "show",
    "rev-parse",
    "ls-files",
    "blame",
    "grep",
    "merge-base",
];

/// Grant key: Bash grants cover one exact command; other tools cover the tool.
pub(super) fn key(tool: &str, input: &Value) -> String {
    match (tool, input["command"].as_str()) {
        ("Bash", Some(command)) => format!("Bash:{}", command.trim()),
        _ => tool.to_owned(),
    }
}

pub(super) fn granted(run_id: &str, key: &str) -> bool {
    GRANTS
        .lock()
        .unwrap()
        .get(run_id)
        .is_some_and(|keys| keys.contains(key))
}

pub(super) fn grant(run_id: &str, key: String) {
    GRANTS
        .lock()
        .unwrap()
        .entry(run_id.to_owned())
        .or_default()
        .insert(key);
}

pub(super) fn automatic(tool: &str, input: &Value, verify: Option<&str>) -> bool {
    if READ_ONLY_TOOLS.contains(&tool) {
        return true;
    }
    tool == "Bash"
        && input["command"].as_str().is_some_and(|command| {
            verify.is_some_and(|check| !check.trim().is_empty() && check.trim() == command.trim())
                || read_only_command(command)
        })
}

fn read_only_command(command: &str) -> bool {
    // Any composition, substitution or redirection needs a human decision.
    if command.chars().any(|c| ";&|<>$`(){}\n\r\\".contains(c)) {
        return false;
    }
    let words: Vec<&str> = command.split_whitespace().collect();
    let Some((&program, args)) = words.split_first() else {
        return false;
    };
    // Flags that write files or run other programs.
    if args.iter().any(|arg| {
        [
            "-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fls", "--pre",
        ]
        .contains(arg)
            || arg.starts_with("--output")
            || arg.starts_with("--ext-diff")
            || arg.starts_with("-fprint")
            || arg.starts_with("--pre=")
    }) {
        return false;
    }
    if program == "git" {
        return args
            .iter()
            .find(|arg| !arg.starts_with('-'))
            .is_some_and(|sub| READ_ONLY_GIT.contains(sub))
            && !args
                .iter()
                .any(|arg| arg.starts_with("-c") || *arg == "--exec-path");
    }
    READ_ONLY_COMMANDS.contains(&program)
}

pub(super) fn question(tool: &str, input: &Value) -> String {
    let detail = match (input["command"].as_str(), input["description"].as_str()) {
        (Some(command), Some(description)) => format!("{description}\n\n{command}"),
        (Some(command), None) => command.to_owned(),
        _ => input.to_string(),
    };
    format!(
        "Claude requests permission to use {tool}:\n{}",
        detail.chars().take(3000).collect::<String>()
    )
}

pub(super) fn allow(input: &Value) -> String {
    json!({"behavior":"allow","updatedInput":input}).to_string()
}

pub(super) fn deny(message: &str) -> String {
    json!({"behavior":"deny","message":message}).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bash(command: &str) -> bool {
        automatic("Bash", &json!({ "command": command }), Some("pnpm verify"))
    }

    #[test]
    fn read_only_actions_are_allowed_without_asking() {
        assert!(automatic("Read", &json!({}), None));
        assert!(automatic("WebSearch", &json!({"query":"x"}), None));
        assert!(bash("git status --short"));
        assert!(bash("git log -5 --oneline"));
        assert!(bash("rg -n permission src"));
        assert!(bash("ls -la"));
        assert!(bash("pnpm verify"));
    }

    #[test]
    fn side_effects_and_compositions_need_the_user() {
        for command in [
            "rm -rf build",
            "pnpm install",
            "git commit -m x",
            "git push",
            "git branch new",
            "git -c core.pager=sh log",
            "ls; rm x",
            "cat a > b",
            "echo $(whoami)",
            "find . -delete",
            "find . -exec rm {} +",
            "rg --pre sh x",
            "git diff --output=x",
            "curl https://example.com",
        ] {
            assert!(!bash(command), "{command}");
        }
        assert!(!automatic("Write", &json!({}), None));
        assert!(!automatic("WebFetch", &json!({}), None));
        assert!(!automatic("mcp__other__tool", &json!({}), None));
    }

    #[test]
    fn task_grants_cover_exact_commands_only() {
        let input = json!({"command":"pnpm test"});
        grant("run-grant", key("Bash", &input));
        assert!(granted(
            "run-grant",
            &key("Bash", &json!({"command":" pnpm test "}))
        ));
        assert!(!granted(
            "run-grant",
            &key("Bash", &json!({"command":"pnpm test; rm x"}))
        ));
        assert!(!granted("other-run", &key("Bash", &input)));
    }

    #[test]
    fn decisions_use_the_permission_prompt_contract() {
        let input = json!({"command":"ls"});
        let allowed: Value = serde_json::from_str(&allow(&input)).unwrap();
        assert_eq!(allowed["behavior"], "allow");
        assert_eq!(allowed["updatedInput"], input);
        let denied: Value = serde_json::from_str(&deny("No")).unwrap();
        assert_eq!(denied, json!({"behavior":"deny","message":"No"}));
    }
}
