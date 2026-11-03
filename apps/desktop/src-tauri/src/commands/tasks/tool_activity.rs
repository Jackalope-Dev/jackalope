use serde_json::Value;

pub(in crate::commands) fn preview(text: &str) -> String {
    if let Some((_, result)) = text.split_once("\nExit: ") {
        if let Some(code) = result
            .lines()
            .next()
            .and_then(|code| code.parse::<i64>().ok())
        {
            return if code == 0 {
                "Command finished".into()
            } else {
                format!("Command failed (exit {code})")
            };
        }
        return "Command finished".into();
    }
    text.lines()
        .next()
        .unwrap_or_default()
        .chars()
        .take(240)
        .collect()
}

/// A preview without the status OpenCode appends (`Reading a.rs · completed`),
/// and that status.
fn split_status(preview: &str) -> (&str, Option<&str>) {
    match preview.rsplit_once(" · ") {
        Some((base, status))
            if matches!(
                status,
                "pending" | "running" | "completed" | "error" | "failed"
            ) =>
        {
            (base, Some(status))
        }
        _ => (preview, None),
    }
}

/// What sort of step a [`preview`] describes: `read`, `edit`, `search`,
/// `command`, `check`, `failure` or `note` (narration and anything unknown).
pub(in crate::commands) fn kind(preview: &str) -> &'static str {
    let (base, status) = split_status(preview);
    let base = base.to_ascii_lowercase();
    if matches!(status, Some("error" | "failed"))
        || base.starts_with("command failed")
        || base.starts_with("permission denied")
        || base.ends_with("failed")
        || base.contains("were denied")
    {
        "failure"
    } else if base == "running project checks" {
        "check"
    } else if base.starts_with("reading") {
        "read"
    } else if ["editing", "writing", "changed "]
        .iter()
        .any(|verb| base.starts_with(verb))
        || base == "changed a file"
    {
        "edit"
    } else if base == "searching the project" {
        "search"
    } else if base.starts_with("running ") || base == "command finished" {
        "command"
    } else {
        "note"
    }
}

/// A preview as a step to show: the status suffix dropped unless it failed.
pub(in crate::commands) fn step_text(preview: &str) -> &str {
    match split_status(preview) {
        (base, Some("pending" | "running" | "completed")) => base,
        _ => preview,
    }
}

/// Whether a preview is one step rather than an update to one: OpenCode
/// reports a tool as running and again once it finishes, and Codex reports a
/// command starting and then its exit, so only one of each counts.
pub(in crate::commands) fn counts_as_step(preview: &str) -> bool {
    match split_status(preview) {
        (_, Some(status)) => matches!(status, "completed" | "error" | "failed"),
        (base, None) => base != "Command finished" && base != "Tool finished",
    }
}

pub(super) fn workspace_path(raw: &str, workspace: &str) -> Option<String> {
    let path = raw.replace('\\', "/");
    let root = workspace.replace('\\', "/");
    let root = root.trim_end_matches('/');
    let absolute = path.starts_with('/') || path.as_bytes().get(1) == Some(&b':');
    let relative = if absolute {
        let prefix = path.get(..root.len())?;
        let matches = if cfg!(windows) {
            prefix.eq_ignore_ascii_case(root)
        } else {
            prefix == root
        };
        if root.is_empty() || !matches || path.as_bytes().get(root.len()) != Some(&b'/') {
            return None;
        }
        &path[root.len() + 1..]
    } else {
        &path
    };
    let parts: Vec<_> = relative.split('/').filter(|part| *part != ".").collect();
    if parts.is_empty()
        || parts.iter().any(|part| part.is_empty() || *part == "..")
        || relative.len() > 240
        || relative.chars().any(|ch| ch.is_control() || ch == ':')
    {
        return None;
    }
    Some(parts.join("/"))
}

/// The program a shell command runs, without its arguments, which can hold
/// secrets. Skips `cd … &&`, environment assignments and `sh -c` wrappers.
fn program(command: &Value) -> Option<String> {
    let text = match command {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" "),
        _ => return None,
    };
    let segment = text
        .split("&&")
        .map(str::trim)
        .find(|segment| !segment.starts_with("cd ") && *segment != "cd")?;
    let mut words = segment
        .split_whitespace()
        .skip_while(|word| word.contains('=') && !word.starts_with('-'));
    let first = words.next()?;
    let name = first.rsplit(['/', '\\']).next()?.trim_matches(['"', '\'']);
    if matches!(name, "bash" | "sh" | "zsh" | "pwsh" | "powershell" | "cmd") {
        let rest: Vec<_> = words.collect();
        if let Some(index) = rest
            .iter()
            .position(|word| matches!(*word, "-c" | "-lc" | "-Command" | "/c" | "/C"))
        {
            let inner = rest[index + 1..].join(" ");
            let inner = inner.trim_matches(['"', '\'']);
            if !inner.is_empty() {
                return program(&Value::String(inner.into()));
            }
        }
    }
    let valid = !name.is_empty()
        && name.len() <= 32
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '+'));
    valid.then(|| name.to_string())
}

pub(super) fn label(name: &str, input: &Value, workspace: &str) -> String {
    let verb = match name.to_ascii_lowercase().as_str() {
        "read" | "read_file" | "readfile" => Some("Reading"),
        "edit" | "edit_file" | "replace" | "str_replace" | "str_replace_editor" => Some("Editing"),
        "write" | "write_file" | "writefile" => Some("Writing"),
        "grep" | "glob" | "search" | "search_files" | "grep_search" | "list_directory" => {
            return "Searching the project".into()
        }
        "bash" | "powershell" | "shell" | "execute" | "command_execution" | "run_shell_command" => {
            return program(&input["command"]).map_or_else(
                || "Running a command".into(),
                |program| format!("Running {program}"),
            );
        }
        "mcp__jackalope__computer_verify" | "computer_verify" => {
            return "Running project checks".into()
        }
        _ => None,
    };
    if let Some(verb) = verb {
        let path = ["file_path", "filePath", "path", "target_file"]
            .into_iter()
            .filter_map(|key| input[key].as_str())
            .find_map(|raw| workspace_path(raw, workspace));
        return path.map_or_else(|| format!("{verb} a file"), |path| format!("{verb} {path}"));
    }
    let name: String = name
        .chars()
        .filter(|ch| !ch.is_control())
        .take(80)
        .collect();
    format!("Using {name}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn steps_are_classified_and_counted_once() {
        for (preview, expected) in [
            ("Reading src/a.rs", "read"),
            ("Reading src/a.rs · completed", "read"),
            ("Editing src/a.rs", "edit"),
            ("Changed src/a.rs", "edit"),
            ("Searching the project", "search"),
            ("Running pnpm", "command"),
            ("Running project checks", "check"),
            ("Command failed (exit 7)", "failure"),
            ("Running cargo · error", "failure"),
            ("Tool request failed", "failure"),
            ("I'll look at the session code first.", "note"),
        ] {
            assert_eq!(kind(preview), expected, "{preview}");
        }
        assert_eq!(step_text("Reading a.rs · completed"), "Reading a.rs");
        assert_eq!(step_text("Running cargo · error"), "Running cargo · error");
        assert!(counts_as_step("Reading a.rs"));
        assert!(counts_as_step("Reading a.rs · completed"));
        assert!(!counts_as_step("Reading a.rs · running"));
        assert!(!counts_as_step("Command finished"));
    }

    #[test]
    fn command_previews_keep_outcomes_without_shell_arguments_or_output() {
        assert_eq!(
            preview("private command\nExit: 0\nprivate output"),
            "Command finished"
        );
        assert_eq!(
            preview("private\nmultiline command\nExit: 7\noutput"),
            "Command failed (exit 7)"
        );
        assert_eq!(
            preview("private command\nExit: null\noutput"),
            "Command finished"
        );
        assert_eq!(preview("Reading src/a.rs\nmore"), "Reading src/a.rs");
    }

    #[test]
    fn file_activity_keeps_only_bounded_workspace_paths() {
        assert_eq!(
            workspace_path("C:\\work\\src\\a.rs", "C:/work"),
            Some("src/a.rs".into())
        );
        assert_eq!(workspace_path("./src/a.rs", ""), Some("src/a.rs".into()));
        for path in [
            "../private",
            "src/../../private",
            "C:/work-other/a",
            "/etc/passwd",
            "src/\nsecret",
            "src/./../private",
        ] {
            assert_eq!(workspace_path(path, "C:/work"), None, "{path}");
        }
        assert_eq!(
            label(
                "Edit",
                &json!({"file_path":"C:/work/src/a.rs", "new_string":"secret code"}),
                "C:/work"
            ),
            "Editing src/a.rs"
        );
        assert_eq!(
            label("Bash", &json!({"command":"echo secret"}), ""),
            "Running echo"
        );
        for (command, expected) in [
            (json!("TOKEN=secret pnpm test --filter x"), "Running pnpm"),
            (json!("cd /private && cargo test"), "Running cargo"),
            (json!("bash -lc 'git status --short'"), "Running git"),
            (
                json!(["/usr/bin/python3", "-c", "print(1)"]),
                "Running python3",
            ),
            (json!("$(cat secret)"), "Running a command"),
            (json!(42), "Running a command"),
        ] {
            assert_eq!(
                label("shell", &json!({ "command": command }), ""),
                expected,
                "{command}"
            );
        }
        assert_eq!(
            label("Read", &json!({"file_path":"/private/secret"}), "/work"),
            "Reading a file"
        );
    }
}
