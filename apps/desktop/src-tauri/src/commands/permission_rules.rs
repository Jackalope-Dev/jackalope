//! Per-project "always allow" rules for agent permission requests.
//!
//! A rule is `Tool` or, for shell commands, `Bash:<program> <subcommand>`. Shell
//! rules only match simple commands: anything that chains, pipes, redirects or
//! substitutes could run more than the rule names, so it always asks.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

static RULES_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Rules {
    projects: HashMap<String, Vec<String>>,
}

pub fn path(preferences: &Path) -> PathBuf {
    preferences.join("permission-rules.json")
}

/// The rule that would cover this request and how to describe it, or `None`
/// when no standing rule can safely cover it.
pub fn rule_for(tool: &str, input: &Value) -> Option<(String, String)> {
    if tool != "Bash" {
        return Some((tool.to_string(), tool.to_string()));
    }
    let command = input["command"].as_str()?.trim();
    const UNSAFE: [&str; 9] = ["&&", "||", ";", "|", "`", "$(", ">", "<", "\n"];
    if command.is_empty() || UNSAFE.iter().any(|token| command.contains(token)) {
        return None;
    }
    let mut words = command.split_whitespace();
    let program = words.next()?;
    // Environment assignments would let a rule for `pnpm` run with any setup.
    if program.contains('=') {
        return None;
    }
    let prefix = match words.next() {
        Some(word) if !word.starts_with('-') && !word.contains(['/', '.', '\'', '"']) => {
            format!("{program} {word}")
        }
        _ => program.to_string(),
    };
    Some((format!("Bash:{prefix}"), format!("`{prefix}` commands")))
}

fn load(file: &Path) -> Rules {
    std::fs::read(file)
        .ok()
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_default()
}

pub fn allows(file: &Path, project: &str, tool: &str, input: &Value) -> bool {
    let Some((rule, _)) = rule_for(tool, input) else {
        return false;
    };
    let _guard = RULES_LOCK.lock();
    load(file)
        .projects
        .get(project)
        .is_some_and(|rules| rules.contains(&rule))
}

pub fn remember(file: &Path, project: &str, rule: &str) -> Result<(), String> {
    let _guard = RULES_LOCK.lock();
    let mut rules = load(file);
    let list = rules.projects.entry(project.to_string()).or_default();
    if !list.iter().any(|saved| saved == rule) {
        list.push(rule.to_string());
    }
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_vec_pretty(&rules).map_err(|e| e.to_string())?;
    let temporary = file.with_extension("json.tmp");
    std::fs::write(&temporary, data).map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, file).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn shell_rules_cover_a_program_and_subcommand_and_refuse_compound_commands() {
        let rule = |command: &str| rule_for("Bash", &json!({ "command": command })).map(|r| r.0);
        assert_eq!(
            rule("pnpm add @lopebase/adapter@0.4.1").as_deref(),
            Some("Bash:pnpm add")
        );
        assert_eq!(rule("ls -la").as_deref(), Some("Bash:ls"));
        assert_eq!(rule("node ./script.js").as_deref(), Some("Bash:node"));
        for unsafe_command in [
            "pnpm add x && rm -rf /",
            "cat a | sh",
            "echo $(whoami)",
            "pnpm test > out",
            "FOO=1 pnpm add x",
            "",
        ] {
            assert_eq!(rule(unsafe_command), None, "{unsafe_command}");
        }
        assert_eq!(rule_for("WebFetch", &json!({})).unwrap().0, "WebFetch");
    }

    #[test]
    fn remembered_rules_are_scoped_to_their_project() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-rules-{}", uuid::Uuid::new_v4()));
        let file = path(&directory);
        let add = json!({ "command": "pnpm add x" });
        assert!(!allows(&file, "one", "Bash", &add));
        remember(&file, "one", "Bash:pnpm add").unwrap();
        remember(&file, "one", "Bash:pnpm add").unwrap();
        assert!(allows(&file, "one", "Bash", &add));
        assert!(!allows(&file, "two", "Bash", &add));
        assert!(!allows(
            &file,
            "one",
            "Bash",
            &json!({ "command": "pnpm add x; rm y" })
        ));
        assert!(!allows(
            &file,
            "one",
            "Bash",
            &json!({ "command": "pnpm remove x" })
        ));
        let _ = std::fs::remove_dir_all(directory);
    }
}
