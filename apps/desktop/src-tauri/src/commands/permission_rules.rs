//! Per-project "always allow" rules for agent permission requests.
//!
//! A rule is `Tool` or, for shell commands, `Bash:<program> <subcommand>`. A
//! chained command (`&&`, `||`, `;`, `|`) is covered when every command in it
//! is. Anything that substitutes or redirects into files could run more than
//! its rules name, and chains through shells, interpreters or privilege tools
//! could run anything, so those always ask.

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

/// Programs that run whatever they are given, so a chain through them is
/// never covered by rules for its other commands.
const RUNNERS: [&str; 27] = [
    "sh",
    "bash",
    "zsh",
    "dash",
    "ksh",
    "fish",
    "ash",
    "busybox",
    "pwsh",
    "powershell",
    "cmd",
    "python",
    "python3",
    "node",
    "perl",
    "ruby",
    "php",
    "deno",
    "bun",
    "eval",
    "exec",
    "source",
    ".",
    "xargs",
    "sudo",
    "doas",
    "env",
];

/// Output redirections that write no file, so they do not stop a rule.
const QUIET: [&str; 5] = ["2>/dev/null", "> /dev/null", ">/dev/null", "2>&1", ">&2"];

/// The rules that would cover this request and how to describe them, or
/// `None` when no standing rule can safely cover it.
pub fn rule_for(tool: &str, input: &Value) -> Option<(Vec<String>, String)> {
    if tool != "Bash" {
        return Some((vec![tool.to_string()], tool.to_string()));
    }
    let mut command = input["command"].as_str()?.trim().to_string();
    for quiet in QUIET {
        command = command.replace(quiet, " ");
    }
    const UNSAFE: [&str; 4] = ["`", "$(", ">", "<"];
    if command.trim().is_empty() || UNSAFE.iter().any(|token| command.contains(token)) {
        return None;
    }
    let parts = super::permission_risk::chained_commands(&command)?;
    let chained = parts.len() > 1;
    let mut rules: Vec<String> = Vec::new();
    for part in &parts {
        let mut words = part.split_whitespace();
        let program = words.next()?;
        // Environment assignments would let a rule for `pnpm` run with any setup.
        if program.contains('=') || chained && RUNNERS.contains(&program) {
            return None;
        }
        let prefix = match words.next() {
            Some(word) if !word.starts_with('-') && !word.contains(['/', '.', '\'', '"']) => {
                format!("{program} {word}")
            }
            _ => program.to_string(),
        };
        if !rules.contains(&prefix) {
            rules.push(prefix);
        }
    }
    let named: Vec<String> = rules.iter().map(|prefix| format!("`{prefix}`")).collect();
    let label = match named.split_last() {
        Some((last, [])) => format!("{last} commands"),
        Some((last, rest)) => format!("{} and {last} commands", rest.join(", ")),
        None => return None,
    };
    Some((
        rules
            .into_iter()
            .map(|prefix| format!("Bash:{prefix}"))
            .collect(),
        label,
    ))
}

fn load(file: &Path) -> Rules {
    std::fs::read(file)
        .ok()
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_default()
}

pub fn allows(file: &Path, project: &str, tool: &str, input: &Value) -> bool {
    let Some((needed, _)) = rule_for(tool, input) else {
        return false;
    };
    let _guard = RULES_LOCK.lock();
    load(file)
        .projects
        .get(project)
        .is_some_and(|rules| needed.iter().all(|rule| rules.contains(rule)))
}

pub fn remember(file: &Path, project: &str, new: &[String]) -> Result<(), String> {
    let _guard = RULES_LOCK.lock();
    let mut rules = load(file);
    let list = rules.projects.entry(project.to_string()).or_default();
    for rule in new {
        if !list.contains(rule) {
            list.push(rule.clone());
        }
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
        let rule = |command: &str| {
            rule_for("Bash", &json!({ "command": command })).map(|(rules, _)| rules.join(" + "))
        };
        assert_eq!(
            rule("pnpm add @lopebase/adapter@0.4.1").as_deref(),
            Some("Bash:pnpm add")
        );
        assert_eq!(rule("ls -la").as_deref(), Some("Bash:ls"));
        assert_eq!(rule("node ./script.js").as_deref(), Some("Bash:node"));
        for unsafe_command in [
            "cat a | sh",
            "pnpm build && bash deploy.sh",
            "ls | xargs rm",
            "echo $(whoami)",
            "pnpm test > out",
            "FOO=1 pnpm add x",
            "git status && FOO=1 pnpm add x",
            "",
        ] {
            assert_eq!(rule(unsafe_command), None, "{unsafe_command}");
        }
        assert_eq!(rule_for("WebFetch", &json!({})).unwrap().0, ["WebFetch"]);
    }

    #[test]
    fn chained_commands_need_a_rule_for_every_command() {
        let (rules, label) = rule_for(
            "Bash",
            &json!({ "command": "git add -A && git commit -m \"a && b\" && git push 2>&1 | tail -5" }),
        )
        .unwrap();
        assert_eq!(
            rules,
            [
                "Bash:git add",
                "Bash:git commit",
                "Bash:git push",
                "Bash:tail"
            ]
        );
        assert_eq!(
            label,
            "`git add`, `git commit`, `git push` and `tail` commands"
        );
        let directory =
            std::env::temp_dir().join(format!("jackalope-rules-{}", uuid::Uuid::new_v4()));
        let file = path(&directory);
        let chain = json!({ "command": "pnpm lint; pnpm test" });
        remember(&file, "one", &["Bash:pnpm lint".to_string()]).unwrap();
        assert!(!allows(&file, "one", "Bash", &chain));
        remember(&file, "one", &["Bash:pnpm test".to_string()]).unwrap();
        assert!(allows(&file, "one", "Bash", &chain));
        assert!(!allows(
            &file,
            "one",
            "Bash",
            &json!({ "command": "pnpm lint; pnpm publish" })
        ));
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn remembered_rules_are_scoped_to_their_project() {
        let directory =
            std::env::temp_dir().join(format!("jackalope-rules-{}", uuid::Uuid::new_v4()));
        let file = path(&directory);
        let add = json!({ "command": "pnpm add x" });
        assert!(!allows(&file, "one", "Bash", &add));
        remember(&file, "one", &["Bash:pnpm add".to_string()]).unwrap();
        remember(&file, "one", &["Bash:pnpm add".to_string()]).unwrap();
        assert!(allows(&file, "one", "Bash", &add));
        assert!(!allows(&file, "two", "Bash", &add));
        assert!(!allows(
            &file,
            "one",
            "Bash",
            &json!({ "command": "pnpm add x; rm y" })
        ));
        let saved = std::fs::read_to_string(&file).unwrap();
        assert_eq!(saved.matches("Bash:pnpm add").count(), 1);
        assert!(!allows(
            &file,
            "one",
            "Bash",
            &json!({ "command": "pnpm remove x" })
        ));
        let _ = std::fs::remove_dir_all(directory);
    }
}
