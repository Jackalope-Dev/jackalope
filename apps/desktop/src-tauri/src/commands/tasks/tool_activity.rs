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

/// How [`label`] and [`failure`] steps begin, lowercased.
const STEP_VERBS: [&str; 11] = [
    "running ",
    "reading ",
    "editing ",
    "writing ",
    "searching ",
    "using ",
    "finding ",
    "asking ",
    "starting ",
    "updating ",
    "tool request",
];

/// A failed tool call as a step: the [`label`] of what it was doing, and why when
/// the error matches a known cause. The error text itself is never kept, since it
/// can quote file contents or command output.
pub(in crate::commands) fn failure(step: Option<&str>, error: &str) -> String {
    let step = step.unwrap_or("Tool request");
    match failure_reason(error) {
        Some(reason) => format!("{step} failed: {reason}"),
        None => format!("{step} failed"),
    }
}

fn failure_reason(error: &str) -> Option<String> {
    let error: String = error.chars().take(2000).collect();
    let first = error.trim_start().lines().next().unwrap_or_default();
    if let Some(code) = first
        .strip_prefix("Exit code ")
        .and_then(|code| code.trim().parse::<i64>().ok())
    {
        return Some(format!("exit {code}"));
    }
    let error = error.to_ascii_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|needle| error.contains(needle));
    let reason = if has(&[
        "doesn't want to proceed",
        "user rejected",
        "was rejected",
        "declined",
    ]) {
        "you declined it"
    } else if has(&["hook"]) && has(&["block", "denied", "error"]) {
        "blocked by a hook"
    } else if has(&["permission denied", "eacces", "operation not permitted"])
        || has(&["permission"]) && has(&["denied", "not granted"])
    {
        "permission denied"
    } else if has(&["timed out", "timeout"]) {
        "timed out"
    } else if has(&["interrupted"]) {
        "interrupted"
    } else if has(&["command not found"]) {
        "command not found"
    } else if has(&["has not been read yet", "read it first"]) {
        "file not read first"
    } else if has(&["modified since", "changed since"]) {
        "file changed since it was read"
    } else if has(&[
        "string to replace not found",
        "old_string not found",
        "no match found",
    ]) {
        "text to replace not found"
    } else if has(&["no such file", "enoent", "does not exist", "file not found"]) {
        "file not found"
    } else if has(&[
        "inputvalidationerror",
        "invalid input",
        "invalid params",
        "invalid arguments",
    ]) {
        "invalid input"
    } else {
        return None;
    };
    Some(reason.into())
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
        || base
            .split_once(" failed: ")
            .is_some_and(|(step, _)| STEP_VERBS.iter().any(|verb| step.starts_with(verb)))
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

const SHELLS: [&str; 6] = ["bash", "sh", "zsh", "pwsh", "powershell", "cmd"];
const SHELL_COMMAND_FLAGS: [&str; 5] = ["-c", "-lc", "-Command", "/c", "/C"];

/// The program a shell command runs, without its arguments, which can hold
/// secrets. Looks past setup such as `cd … &&`, `export`, environment
/// assignments, wrappers like `env` and `timeout`, and `sh -c` quoting.
fn program(command: &Value) -> Option<String> {
    let script = match command {
        Value::String(text) => text.clone(),
        Value::Array(parts) => {
            let parts: Vec<_> = parts.iter().filter_map(Value::as_str).collect();
            // An argv such as ["bash", "-lc", "cd x && pnpm test"] keeps the
            // script as one element, so read it rather than the rejoined argv.
            let script_at = parts
                .first()
                .filter(|first| SHELLS.contains(&base_name(first)))
                .and_then(|_| {
                    parts
                        .iter()
                        .position(|part| SHELL_COMMAND_FLAGS.contains(part))
                });
            match script_at {
                Some(index) => parts[index + 1..].join(" "),
                None => parts.join(" "),
            }
        }
        _ => return None,
    };
    match script_program(&script, 0) {
        Found::Program(name) => Some(name),
        Found::Setup | Found::Unknown => None,
    }
}

enum Found {
    Program(String),
    /// Only setup such as `cd` or `export`; the program comes later.
    Setup,
    Unknown,
}

fn base_name(word: &str) -> &str {
    let word = word.trim_matches(['"', '\'']);
    word.rsplit(['/', '\\']).next().unwrap_or(word)
}

/// The first command a script runs past its setup.
fn script_program(script: &str, depth: u8) -> Found {
    if depth > 3 {
        return Found::Unknown;
    }
    for segment in segments(script) {
        match segment_program(segment, depth) {
            Found::Setup => continue,
            found => return found,
        }
    }
    Found::Setup
}

/// Splits a script at `&&`, `||`, `;`, `|`, `&` and newlines outside quotes.
/// Redirections such as `2>&1` stay intact.
fn segments(script: &str) -> Vec<&str> {
    let bytes = script.as_bytes();
    let mut parts = Vec::new();
    let (mut start, mut quote) = (0, None);
    for (index, &byte) in bytes.iter().enumerate() {
        match (quote, byte) {
            (Some(open), _) if byte == open => quote = None,
            (Some(_), _) => {}
            (None, b'\'' | b'"') => quote = Some(byte),
            (None, b'&')
                if matches!(index.checked_sub(1).map(|i| bytes[i]), Some(b'>' | b'<'))
                    || bytes.get(index + 1) == Some(&b'>') => {}
            (None, b';' | b'\n' | b'|' | b'&') => {
                parts.push(&script[start..index]);
                start = index + 1;
            }
            _ => {}
        }
    }
    parts.push(&script[start..]);
    parts
        .into_iter()
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect()
}

fn is_assignment(word: &str) -> bool {
    word.split_once('=').is_some_and(|(name, _)| {
        !name.is_empty()
            && !name.starts_with(|ch: char| ch.is_ascii_digit())
            && name
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    })
}

fn segment_program(segment: &str, depth: u8) -> Found {
    let words: Vec<&str> = segment.split_whitespace().collect();
    let mut index = 0;
    while let Some(&raw) = words.get(index) {
        index += 1;
        let word = raw
            .trim_start_matches(['(', '{'])
            .trim_end_matches([')', '}']);
        if word.is_empty()
            || matches!(
                word,
                "!" | "if"
                    | "then"
                    | "do"
                    | "else"
                    | "elif"
                    | "while"
                    | "until"
                    | "time"
                    | "exec"
                    | "command"
                    | "builtin"
                    | "nohup"
            )
            || is_assignment(word)
        {
            continue;
        }
        if word.starts_with('#')
            || matches!(
                word,
                "cd" | "pushd"
                    | "popd"
                    | "export"
                    | "unset"
                    | "set"
                    | "source"
                    | "."
                    | "for"
                    | "["
                    | "[["
                    | "true"
                    | "false"
                    | ":"
                    | "case"
                    | "esac"
                    | "done"
                    | "fi"
                    | "select"
                    | "function"
                    | "local"
            )
        {
            return Found::Setup;
        }
        match word {
            "env" => {
                while words.get(index).is_some_and(|next| next.starts_with('-')) {
                    index += 1;
                }
                continue;
            }
            "timeout" => {
                while let Some(flag) = words.get(index).filter(|next| next.starts_with('-')) {
                    // `-s` and `-k` take a signal or a grace period.
                    index += if matches!(*flag, "-s" | "-k") { 2 } else { 1 };
                }
                // The duration, such as `60` or `5m`.
                index += 1;
                continue;
            }
            "nice" => {
                match words.get(index) {
                    Some(&"-n") => index += 2,
                    Some(next) if next.starts_with('-') => index += 1,
                    _ => {}
                }
                continue;
            }
            _ => {}
        }
        let name = base_name(word);
        if SHELLS.contains(&name) {
            if let Some(flag) = words[index..]
                .iter()
                .position(|word| SHELL_COMMAND_FLAGS.contains(word))
            {
                let script = words[index + flag + 1..].join(" ");
                let script = script.trim_matches(['"', '\'']);
                return script_program(script, depth + 1);
            }
        }
        let valid = !name.is_empty()
            && name.len() <= 32
            && name
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '+'));
        return if valid {
            Found::Program(name.to_string())
        } else {
            Found::Unknown
        };
    }
    Found::Setup
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
    match name {
        "mcp__jackalope__ask_user" | "ask_user" | "AskUserQuestion" => {
            return "Asking you a question".into()
        }
        "ToolSearch" => return "Finding tools".into(),
        "TodoWrite" | "update_plan" => return "Updating its plan".into(),
        "WebSearch" | "web_search" => return "Searching the web".into(),
        "WebFetch" => return "Reading a web page".into(),
        "Task" | "Agent" => return "Starting a helper agent".into(),
        _ => {}
    }
    let name: String = name
        .chars()
        .filter(|ch| !ch.is_control())
        .take(80)
        .collect();
    // An MCP tool reads as its own name and the server it came from.
    if let Some((server, tool)) = name
        .strip_prefix("mcp__")
        .and_then(|rest| rest.split_once("__"))
    {
        return format!("Using {} ({server})", tool.replace('_', " "));
    }
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
    fn commands_are_named_by_their_program_past_setup_and_wrappers() {
        for (command, expected) in [
            (json!("cd /work; pnpm test"), "Running pnpm"),
            (json!("cd /work\npnpm test"), "Running pnpm"),
            (
                json!("cd \"/my work\" && cd src && cargo test"),
                "Running cargo",
            ),
            (json!("export TOKEN=secret; pnpm build"), "Running pnpm"),
            (json!("source .env && node scripts/run.mjs"), "Running node"),
            (
                json!("env -i HOME=/x TOKEN=secret pnpm test"),
                "Running pnpm",
            ),
            (json!("timeout 60 cargo test"), "Running cargo"),
            (json!("timeout -s KILL 5m pnpm test"), "Running pnpm"),
            (json!("nice -n 10 cargo build"), "Running cargo"),
            (json!("(cd app && pnpm test)"), "Running pnpm"),
            (json!("if [ -f x ]; then pnpm test; fi"), "Running pnpm"),
            (json!("# check it\ngit status"), "Running git"),
            (json!("pnpm test 2>&1 | tail -5"), "Running pnpm"),
            (json!("cd x 2>&1 && pnpm test"), "Running pnpm"),
            (json!("bash -lc 'cd x && pnpm test'"), "Running pnpm"),
            (json!("cd /w && zsh -c \"go test ./...\""), "Running go"),
            (
                json!(["/bin/zsh", "-lc", "cd x && pnpm test"]),
                "Running pnpm",
            ),
            (json!("echo 'a; b'"), "Running echo"),
            (json!("cd /work"), "Running a command"),
            (json!("TOKEN=secret"), "Running a command"),
            (json!("cd x && $(cat secret)"), "Running a command"),
            (json!("$(cat secret); pnpm test"), "Running a command"),
            (json!("\"$HOME/bin/tool\" --key secret"), "Running tool"),
            (
                json!("bash -c 'bash -c \"bash -c sh -c x\"'"),
                "Running a command",
            ),
        ] {
            assert_eq!(
                label("Bash", &json!({ "command": command }), ""),
                expected,
                "{command}"
            );
        }
    }

    #[test]
    fn failures_name_the_step_and_a_known_reason_without_the_error_text() {
        for (step, error, expected) in [
            (Some("Running pnpm"), "Exit code 2\nsecret output", "Running pnpm failed: exit 2"),
            (
                Some("Editing src/a.rs"),
                "<tool_use_error>String to replace not found in file.\nString: secret</tool_use_error>",
                "Editing src/a.rs failed: text to replace not found",
            ),
            (
                Some("Editing src/a.rs"),
                "File has not been read yet. Read it first before writing to it.",
                "Editing src/a.rs failed: file not read first",
            ),
            (
                Some("Running git"),
                "The user doesn't want to proceed with this tool use. The tool use was rejected",
                "Running git failed: you declined it",
            ),
            (
                Some("Running rm"),
                "PreToolUse:Bash hook error: blocked secret",
                "Running rm failed: blocked by a hook",
            ),
            (Some("Reading a file"), "ENOENT: /secret", "Reading a file failed: file not found"),
            (Some("Running curl"), "Command timed out after 2m", "Running curl failed: timed out"),
            (None, "Permission to use Bash has been denied.", "Tool request failed: permission denied"),
            (None, "secret diagnostic", "Tool request failed"),
            (Some("Using ToolSearch"), "", "Using ToolSearch failed"),
        ] {
            let text = failure(step, error);
            assert_eq!(text, expected, "{error}");
            assert_eq!(kind(&text), "failure", "{text}");
            assert!(!text.contains("secret"), "{text}");
        }
        assert_eq!(kind("The build failed: it needs a key"), "note");
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
        assert_eq!(
            label("mcp__jackalope__ask_user", &json!({}), ""),
            "Asking you a question"
        );
        assert_eq!(label("ToolSearch", &json!({}), ""), "Finding tools");
        assert_eq!(
            label("mcp__linear__create_issue", &json!({}), ""),
            "Using create issue (linear)"
        );
    }
}
